import {existsSync} from "node:fs";
import {join} from "node:path";
import {must} from "../proc";
import {p} from "../paths";
import type {Engine} from "./types";
import {resolveVoice} from "./voice_clones";

/**
 * VieNeu-TTS (https://github.com/pnnbao97/VieNeu-TTS): Vietnamese voices,
 * offline on CPU, Apache-2.0 code and weights, 48 kHz. Runs through a small
 * Python bridge (vieneu_bridge.py) that loads the model once and reads one
 * line per file, like `say`. No word timestamps: words are spread over the
 * line, as with `say` and `edge`.
 *
 * Setup once:
 *   uv venv --python 3.12 .venv-vieneu && uv pip install --python .venv-vieneu/bin/python vieneu
 * The first run downloads the model (~600 MB) into .cache/vieneu/.
 *
 * narration.json voice:
 *   "voice": a preset name ("Thiện Minh", "Mai Anh", ...) or a path to a 3-8 s
 *            reference .wav to clone (only voices you have the right to use);
 *   "model": "v3turbo" (default) or "v3nano".
 * List presets: .venv-vieneu/bin/python scripts/lib/engines/vieneu_bridge.py --voices
 * Watermark: VieNeu adds an inaudible AI-audio watermark (Perth) only when
 * installed as `vieneu[watermark]`; the plain install above adds none.
 */
const python = () => {
  if (process.env.VIENEU_PYTHON) return process.env.VIENEU_PYTHON;
  const venv = p(".venv-vieneu", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return existsSync(venv) ? venv : "python3";
};

export const vieneu: Engine = {
  name: "vieneu",
  defaultVoice: "Thiện Minh",
  synth: async (lines, voice, work) => {
    const job = join(work, "vieneu-job.json");
    await Bun.write(
      job,
      JSON.stringify({
        lines: lines.map((l) => l.spoken),
        voice: resolveVoice(voice.voice ?? vieneu.defaultVoice),
        // per-line character voices (multi-voice stories); null → the narrator voice
        voices: lines.map((l) => resolveVoice(l.voice) ?? null),
        mode: voice.model ?? "",
        out: work,
        cache: p(".cache", "vieneu"),
      }),
    );
    try {
      // model load + first-run download + every line: allow a long time
      await must(python(), [p("scripts/lib/engines/vieneu_bridge.py"), job], {timeoutMs: 90 * 60_000, inherit: true});
    } catch (e) {
      const msg = (e as Error).message;
      throw new Error(
        /ENOENT|No module named/.test(msg)
          ? "VieNeu is not installed. Run: uv venv --python 3.12 .venv-vieneu && uv pip install --python .venv-vieneu/bin/python vieneu"
          : msg,
      );
    }
    // Narrator pitch (voice.pitch < 1 = deeper): shift pitch, keep length, add a little chest (in place).
    const pitch = Number(voice.pitch) || 1;
    if (Math.abs(pitch - 1) > 0.01) {
      for (const [i, l] of lines.entries()) {
        if (l.voice || l.fx) continue;
        const f = join(work, `line-${i}.wav`);
        const tmp = join(work, `line-${i}.pitch.wav`);
        await must("ffmpeg", [
          "-y", "-v", "error", "-i", f, "-af",
          `asetrate=48000*${pitch},aresample=48000,atempo=${(1 / pitch).toFixed(4)},equalizer=f=120:t=q:w=1:g=${pitch < 1 ? 3 : 0}`,
          tmp,
        ]);
        await must("mv", [tmp, f]);
      }
    }
    // age voices: elders lower, slower, with a slight tremble; children higher (length kept)
    const AGE_FX: Record<string, string> = {
      elder: "asetrate=48000*0.9,aresample=48000,atempo=1.04,tremolo=f=6:d=0.12,equalizer=f=150:t=q:w=1:g=2",
      child: "asetrate=48000*1.16,aresample=48000,atempo=0.88",
    };
    for (const [i, l] of lines.entries()) {
      const chain = l.fx ? AGE_FX[l.fx] : undefined;
      if (!chain) continue;
      const f = join(work, `line-${i}.wav`);
      const tmp = join(work, `line-${i}.age.wav`);
      await must("ffmpeg", ["-y", "-v", "error", "-i", f, "-af", chain, tmp]);
      await must("mv", [tmp, f]);
    }
    // "ghost" lines: pitch down ~12 %, slow tremble, long hall echo (in place).
    for (const [i, l] of lines.entries()) {
      if (l.fx !== "ghost") continue;
      const f = join(work, `line-${i}.wav`);
      const tmp = join(work, `line-${i}.ghost.wav`);
      await must("ffmpeg", [
        "-y", "-v", "error", "-i", f, "-af",
        "asetrate=48000*0.88,aresample=48000,atempo=1.08,tremolo=f=5:d=0.25,aecho=0.8:0.85:120|260|520:0.45|0.3|0.2,apad=pad_dur=0.6,volume=1.1",
        tmp,
      ]);
      await must("mv", [tmp, f]);
    }
    return lines.map((_, i) => ({file: join(work, `line-${i}.wav`), lines: [{start: 0, end: Number.POSITIVE_INFINITY, words: null}]}));
  },
};
