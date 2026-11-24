import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import type {Voice, VoiceLine, VoiceScene, VoiceWord} from "../../src/shared/timings";
import {videoDir} from "./paths";
import {applyMap, tokens} from "./text";

export type NarrationLine = {
  text: string;
  fact?: string;
  caption?: string;
  /** Footage only (§5j): the transcript word range [a, b] this line is; its text is generated from it. */
  words?: [number, number];
  /** Footage only: `false` marks a line that asserts nothing checkable (an opinion, a greeting). */
  claim?: boolean;
  /** Extra silence (s) after this line, so a sound effect can play alone (story styles: footsteps, a scream…). */
  holdAfter?: number;
  /** Multi-voice stories: this line is read by another preset voice (a character), instead of voice.voice. */
  voice?: string;
  /** Character role name for this line (display/debug only). */
  role?: string;
  /** Voice effect: "ghost" = lower pitch, slow tremble, long echo. */
  fx?: "ghost" | "elder" | "child";
};
export type NarrationScene = {id: string; hold?: number; lines: NarrationLine[]};
export type NarrationVoice = {
  engine: string;
  voice?: string;
  model?: string;
  tempo?: number;
  /** Narrator pitch ratio (e.g. 0.9 = 10 % lower, length kept). Character lines keep their own pitch. */
  pitch?: number;
  /** Footage only: the sources.json id (kind "footage") of the filmed take. */
  source?: string;
};
export type Narration = {
  id: string;
  flow: string;
  visual: string[];
  language: string;
  voice: NarrationVoice;
  /** `adaptive`: the line gap follows the sentence (?, !, …, short beat, long breath, speaker change) instead of one fixed value. */
  pause: {line: number; scene: number; adaptive?: boolean};
  outroHold: number;
  pronounce?: Record<string, string>;
  spelling?: Record<string, string>;
  scenes: NarrationScene[];
};

export const DEFAULT_PAUSE = {line: 0.5, scene: 0.9};

export const loadNarration = (id: string): Narration => {
  const file = join(videoDir(id), "narration.json");
  const n = JSON.parse(readFileSync(file, "utf8")) as Narration;
  n.pause = {...DEFAULT_PAUSE, ...(n.pause ?? {})};
  n.voice = {tempo: 1, ...(n.voice ?? {engine: "say"})};
  n.outroHold = 0;
  n.scenes = n.scenes ?? [];
  return n;
};

export type FlatLine = {scene: string; index: number; global: number; text: string; spoken: string; display: string; first: boolean; holdAfter?: number; voice?: string; fx?: "ghost" | "elder" | "child"};

/** Every line in order, with spoken (`pronounce`) and display (`spelling`) forms. */
export const flatLines = (n: Narration): FlatLine[] => {
  const out: FlatLine[] = [];
  n.scenes.forEach((s) =>
    s.lines.forEach((l, index) =>
      out.push({
        scene: s.id,
        index,
        global: out.length,
        text: l.text,
        spoken: applyMap(l.text, n.pronounce),
        display: applyMap(l.text, n.spelling),
        first: index === 0,
        ...(l.holdAfter ? {holdAfter: Math.min(4, Math.max(0, l.holdAfter))} : {}),
        ...(l.voice ? {voice: l.voice} : {}),
        ...(l.fx ? {fx: l.fx} : {}),
      }),
    ),
  );
  return out;
};

/** Settings that change how the engine reads the script, and nothing else. */
export const engineKey = (n: Narration) =>
  createHash("sha1")
    .update(JSON.stringify({voice: n.voice, lines: flatLines(n).map((l) => (l.voice || l.fx ? [l.spoken, l.voice ?? "", l.fx ?? ""] : l.spoken))}))
    .digest("hex")
    .slice(0, 16);

/**
 * Hash of everything that changes voice.json: voice settings, pauses, both
 * maps, scene holds, scene ids and line texts. Same hash = no engine call.
 */
export const voiceHash = (n: Narration) =>
  createHash("sha1")
    .update(
      JSON.stringify({
        voice: n.voice,
        pause: n.pause,
        pronounce: n.pronounce ?? {},
        spelling: n.spelling ?? {},
        scenes: n.scenes.map((s) => ({id: s.id, hold: s.hold ?? 0, lines: s.lines.map((l) => l.text)})),
      }),
    )
    .digest("hex")
    .slice(0, 16);

/**
 * Display words of one line between `start` and `end`. With spoken word times
 * whose count equals the display word count, map 1:1; otherwise spread the
 * display words across the line by character weight.
 */
export const lineWords = (
  display: string,
  line: number,
  start: number,
  end: number,
  spoken?: {start: number; end: number}[] | null,
): VoiceWord[] => {
  const toks = tokens(display);
  if (spoken && spoken.length === toks.length && toks.length > 0) {
    return toks.map((t, i) => ({text: t.text, start: spoken[i].start, end: spoken[i].end, line, ...(t.brk ? {brk: t.brk} : {})}));
  }
  const weights = toks.map((t) => t.text.length + 2 + (t.brk === "sentence" ? 4 : t.brk === "clause" ? 2 : 0));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let at = start;
  return toks.map((t, i) => {
    const d = ((end - start) * weights[i]) / total;
    const w: VoiceWord = {text: t.text, start: at, end: at + d * 0.92, line, ...(t.brk ? {brk: t.brk} : {})};
    at += d;
    return w;
  });
};

/** Adaptive line gap: a story teller breathes by meaning, not by a metronome. */
const lineGap = (n: Narration, lines: FlatLine[], i: number) => {
  const base = n.pause.line;
  if (!n.pause.adaptive) return base;
  const cur = lines[i];
  const next = lines[i + 1];
  const text = cur.display.trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  let k = 1;
  if (/(…|\.{3})["”')\]]*$/.test(text)) k = 1.6; // trailing off: let it hang
  else if (/[?]["”')\]]*$/.test(text)) k = 1.25; // question: give the listener a beat
  else if (/[!]["”')\]]*$/.test(text)) k = 1.15;
  if (words <= 6) k *= 1.25; // short punchy sentence = dramatic beat
  else if (words >= 20) k *= 1.1; // long sentence: breathe after it
  const spokenBy = (l?: FlatLine) => l?.voice ?? "";
  if (spokenBy(cur) !== spokenBy(next)) k *= spokenBy(cur) && spokenBy(next) ? 0.85 : 1.15; // dialogue back-and-forth tighter; narrator ↔ character a touch longer
  return Math.min(2.2, Math.max(0.3, base * k));
};

/** Gap after line `i`: a scene pause (+ the scene's hold) at a scene change, else a line pause. */
export const gapAfter = (n: Narration, lines: FlatLine[], i: number) => {
  const next = lines[i + 1];
  if (!next) return 0;
  const extra = lines[i].holdAfter ?? 0;
  if (extra > 0) return (next.scene !== lines[i].scene ? n.pause.scene : lineGap(n, lines, i)) + extra;
  if (next.scene !== lines[i].scene) {
    const hold = n.scenes.find((s) => s.id === lines[i].scene)?.hold ?? 0;
    return n.pause.scene + hold;
  }
  return lineGap(n, lines, i);
};

export const scenesFromLines = (vlines: VoiceLine[]): VoiceScene[] => {
  const out: VoiceScene[] = [];
  for (const l of vlines) {
    const last = out[out.length - 1];
    if (last && last.id === l.scene) last.end = l.end;
    else out.push({id: l.scene, start: l.start, end: l.end});
  }
  return out;
};

/** SECONDS_PER_WORD for an estimated voice.json, before any TTS. */
export const SECONDS_PER_WORD = 0.33;

/** voice.json written by `bun run new` so Studio works before TTS. Lint rejects it. */
export const estimateVoice = (n: Narration): Voice => {
  const lines = flatLines(n);
  const vlines: VoiceLine[] = [];
  const vwords: VoiceWord[] = [];
  let t = 0;
  lines.forEach((l, i) => {
    const count = Math.max(1, tokens(l.display).length);
    const start = t;
    const end = start + count * SECONDS_PER_WORD;
    vlines.push({scene: l.scene, index: l.index, text: l.display, start, end});
    vwords.push(...lineWords(l.display, i, start, end));
    t = end + gapAfter(n, lines, i);
  });
  const duration = vlines.length ? vlines[vlines.length - 1].end : 1;
  return {
    hash: voiceHash(n),
    estimated: true,
    engine: "estimate",
    duration,
    audio: null,
    words: vwords,
    lines: vlines,
    scenes: scenesFromLines(vlines),
  };
};

export const writeVoice = (path: string, v: Voice) => {
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const clean: Voice = {
    ...v,
    duration: round(v.duration),
    words: v.words.map((w) => ({...w, start: round(w.start), end: round(w.end)})),
    lines: v.lines.map((l) => ({...l, start: round(l.start), end: round(l.end)})),
    scenes: v.scenes.map((s) => ({...s, start: round(s.start), end: round(s.end)})),
  };
  // one word per line keeps diffs readable
  const body = JSON.stringify(clean, null, 2);
  return Bun.write(path, `${body}\n`);
};
