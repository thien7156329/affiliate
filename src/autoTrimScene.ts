/**
 * Auto-trim dead air at the END of a rendered Veo scene.
 *
 * Veo always renders a fixed-length clip (~8-10s). When the scene content
 * (dialogue / action) finishes earlier, the remainder is meaningless idle time.
 * This module detects where the content really ends and cuts the tail.
 *
 * Only the TAIL is trimmed (never the head), so every DUB_TIMELINE timestamp
 * (relative to scene start) used by videoDubbingService stays valid.
 *
 * Signals used:
 *  1. DUB_TIMELINE in the prompt → end of the last spoken interval.
 *  2. ffmpeg silencedetect → start of trailing audio silence.
 *  3. ffmpeg freezedetect  → start of trailing frozen frames.
 *
 * The original file is backed up as `<file>.orig.bak` (same convention as
 * /api/pipeline/trim-part-video), so "restore-part-video" still works.
 */
import { exec } from "node:child_process";
import * as fs from "node:fs";

export interface AutoTrimResult {
  trimmed: boolean;
  originalDuration: number;
  newDuration: number;
  cutAt?: number;
  reason: string;
}

const MIN_SCENE_SEC = Number(process.env.AUTO_TRIM_MIN_SEC || 3);
const TAIL_PAD_SEC = Number(process.env.AUTO_TRIM_PAD_SEC || 0.7);
const MIN_SAVING_SEC = Number(process.env.AUTO_TRIM_MIN_SAVING_SEC || 0.8);

export function isAutoTrimEnabled(): boolean {
  return !["0", "false", "off"].includes((process.env.AUTO_TRIM_SCENES || "true").toLowerCase());
}

function run(cmd: string): Promise<string> {
  return new Promise((resolve) => {
    // ffmpeg writes analysis logs to stderr; never reject so trimming is best-effort
    exec(cmd, { maxBuffer: 20 * 1024 * 1024 }, (_err, stdout, stderr) => resolve(`${stdout}\n${stderr}`));
  });
}

async function getDuration(ffmpeg: string, file: string): Promise<number> {
  const out = await run(`"${ffmpeg}" -hide_banner -i "${file}"`);
  const m = out.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

/** End time (sec) of the last spoken interval declared in DUB_TIMELINE, or null. */
export function getLastSpeechEndFromPrompt(prompt: string): number | null {
  if (!prompt) return null;
  const segRegex = /(\d+\.?\d*)\s*[–\-]\s*(\d+\.?\d*)s[,:]?\s*([\s\S]*?)(?=\d+\.?\d*\s*[–\-]\s*\d+\.?\d*s|$)/g;
  let lastEnd: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = segRegex.exec(prompt)) !== null) {
    const end = parseFloat(m[2]);
    const desc = m[3] || "";
    if (/no dialogue|dialogue[- ]free|mouths? closed;?\s*$/i.test(desc.slice(0, 60))) continue;
    if (!/\b(says?|delivers?|speaks?|line|nói|thoại)\b/i.test(desc)) continue;
    if (!isNaN(end) && end <= 12) lastEnd = Math.max(lastEnd ?? 0, end);
  }
  return lastEnd;
}

/**
 * End of the last SUSTAINED sound region (speech), ignoring short blips (< MIN_SOUND_SEC)
 * such as a sip, rustle or tiny sfx after the dialogue. Returns null when the audio never
 * goes silent (continuous ambient/music) so callers can fall back to the timeline.
 */
const MIN_SOUND_SEC = Number(process.env.AUTO_TRIM_MIN_SOUND_SEC || 0.6);
async function getLastSustainedSoundEnd(ffmpeg: string, file: string, duration: number): Promise<number | null> {
  const out = await run(`"${ffmpeg}" -hide_banner -i "${file}" -af silencedetect=noise=-32dB:d=0.5 -f null -`);
  const starts = [...out.matchAll(/silence_start:\s*(-?\d+(?:\.\d+)?)/g)].map(x => Math.max(0, parseFloat(x[1])));
  const ends = [...out.matchAll(/silence_end:\s*(\d+(?:\.\d+)?)/g)].map(x => parseFloat(x[1]));
  if (!starts.length) return null;

  // Build silence intervals, then derive the sound regions between them
  const silences = starts.map((s, i) => ({ s, e: ends[i] ?? duration }));
  const sounds: Array<{ s: number; e: number }> = [];
  let cursor = 0;
  for (const sil of silences) {
    if (sil.s > cursor + 0.01) sounds.push({ s: cursor, e: sil.s });
    cursor = Math.max(cursor, sil.e);
  }
  if (cursor < duration - 0.15) sounds.push({ s: cursor, e: duration });

  const sustained = sounds.filter(r => r.e - r.s >= MIN_SOUND_SEC);
  if (!sustained.length) return null;
  return sustained[sustained.length - 1].e;
}

/** Start of trailing frozen video (no visual change until the end), or null. */
async function getTrailingFreezeStart(ffmpeg: string, file: string, duration: number): Promise<number | null> {
  const out = await run(`"${ffmpeg}" -hide_banner -i "${file}" -vf freezedetect=n=0.003:d=0.8 -map 0:v:0 -f null -`);
  const starts = [...out.matchAll(/freeze_start:\s*(\d+(?:\.\d+)?)/g)].map(x => parseFloat(x[1]));
  const ends = [...out.matchAll(/freeze_end:\s*(\d+(?:\.\d+)?)/g)].map(x => parseFloat(x[1]));
  if (!starts.length) return null;
  const lastStart = starts[starts.length - 1];
  const lastEnd = ends.length ? ends[ends.length - 1] : null;
  if (lastEnd === null || lastEnd < lastStart || lastEnd >= duration - 0.15) return lastStart;
  return null;
}

/**
 * Detect content end and trim the dead-air tail in place.
 * Best-effort: never throws; on any failure the original video is kept.
 */
export async function autoTrimSceneTail(videoPath: string, prompt: string = ""): Promise<AutoTrimResult> {
  const noop = (reason: string, d = 0): AutoTrimResult => ({ trimmed: false, originalDuration: d, newDuration: d, reason });
  try {
    if (!isAutoTrimEnabled()) return noop("AUTO_TRIM_SCENES disabled");
    if (!videoPath || !fs.existsSync(videoPath)) return noop("video not found");

    const { getFfmpegCmd } = await import("./scheduler.js");
    const ffmpeg = getFfmpegCmd();
    const duration = await getDuration(ffmpeg, videoPath);
    if (!duration || duration <= MIN_SCENE_SEC + MIN_SAVING_SEC) return noop("clip already short", duration);

    const speechEnd = getLastSpeechEndFromPrompt(prompt);
    const [soundEnd, freezeStart] = await Promise.all([
      getLastSustainedSoundEnd(ffmpeg, videoPath, duration),
      getTrailingFreezeStart(ffmpeg, videoPath, duration),
    ]);

    let cutAt: number | null = null;
    let reason = "";

    if (speechEnd !== null) {
      // Dialogue scene: content ends after the last line + a short closed-mouth beat.
      // Veo may speak later than planned → never cut before the real speech audio ends.
      const plannedCut = speechEnd + TAIL_PAD_SEC;
      if (soundEnd !== null && soundEnd < duration - 0.15) {
        cutAt = Math.max(plannedCut, soundEnd + TAIL_PAD_SEC);
        reason = `thoại kết thúc ~${Math.max(speechEnd, soundEnd).toFixed(1)}s (timeline ${speechEnd.toFixed(1)}s, audio ${soundEnd.toFixed(1)}s)`;
      } else if (plannedCut + 1.5 < duration) {
        // Ambient audio runs to the end: trust timeline with a larger safety pad.
        cutAt = plannedCut + 0.8;
        reason = `thoại kết thúc ~${speechEnd.toFixed(1)}s (timeline, có âm nền)`;
      }
    } else if (freezeStart !== null) {
      // Non-dialogue scene: cut only when the picture literally stops moving.
      cutAt = freezeStart + 0.3;
      reason = `hình ảnh đứng yên từ ${freezeStart.toFixed(1)}s`;
    }

    if (cutAt === null) return noop("không phát hiện khoảng chết ở cuối", duration);
    cutAt = Math.max(MIN_SCENE_SEC, Math.min(cutAt, duration));
    if (duration - cutAt < MIN_SAVING_SEC) return noop(`chỉ dư ${(duration - cutAt).toFixed(1)}s, giữ nguyên`, duration);

    const backupPath = `${videoPath}.orig.bak`;
    if (!fs.existsSync(backupPath)) fs.copyFileSync(videoPath, backupPath);

    const tmp = `${videoPath}.autotrim_${Date.now()}.mp4`;
    // Re-encode for frame-accurate cut + short audio fade-out to avoid a click at the cut point
    const fadeStart = Math.max(0, cutAt - 0.25).toFixed(3);
    const probe = await run(`"${ffmpeg}" -hide_banner -i "${backupPath}"`);
    const hasAudio = /Stream #.*Audio:/.test(probe);
    const audioArgs = hasAudio
      ? `-af "afade=t=out:st=${fadeStart}:d=0.25" -c:a aac -b:a 192k -ar 48000`
      : "-an";
    await run(
      `"${ffmpeg}" -y -i "${backupPath}" -t ${cutAt.toFixed(3)} -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p ` +
      `${audioArgs} -movflags +faststart "${tmp}"`
    );

    if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 50_000) {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      return noop("ffmpeg trim failed, giữ bản gốc", duration);
    }
    fs.renameSync(tmp, videoPath);
    const newDuration = await getDuration(ffmpeg, videoPath);
    console.log(`✂️ [AutoTrim] ${videoPath.split("/").pop()}: ${duration.toFixed(1)}s → ${newDuration.toFixed(1)}s (${reason})`);
    return { trimmed: true, originalDuration: duration, newDuration, cutAt, reason };
  } catch (err: any) {
    console.warn(`⚠️ [AutoTrim] Skipped: ${err?.message || err}`);
    return noop(`error: ${err?.message || err}`);
  }
}
