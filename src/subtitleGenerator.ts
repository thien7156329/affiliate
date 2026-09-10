/**
 * subtitleGenerator.ts
 *
 * Uses Puppeteer (already a project dependency) to screenshot an HTML page
 * with styled subtitle text, producing a transparent-background PNG overlay.
 * Zero additional npm packages required.
 *
 * Output PNG is overlaid onto the video using FFmpeg's `overlay` filter.
 */

import { exec, execSync } from "child_process";
import fs from "fs";
import path from "path";

export interface SubtitleOptions {
  text: string;           // Dialogue text (Vietnamese)
  title?: string;         // Story title (optional, shown at top)
  videoWidth?: number;
  videoHeight?: number;
}

/** Word-wrap text to max chars per line */
function wrapLines(text: string, maxChars: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars) {
      if (cur) lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur.trim());
  return lines;
}

/** Escape HTML special chars */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Builds the HTML used for screenshot.
 * Background is transparent (Puppeteer screenshots with omitBackground).
 */
function buildHtml(opts: SubtitleOptions): string {
  const w = opts.videoWidth ?? 720;
  const h = opts.videoHeight ?? 1280;
  const lines = wrapLines(opts.text, 26);

  const dialogueHtml = lines
    .map(l => `<div class="line">${esc(l)}</div>`)
    .join("");

  const titleHtml = opts.title
    ? `<div class="title-pill">${esc(opts.title)}</div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: ${w}px;
    height: ${h}px;
    background: transparent;
    overflow: hidden;
    font-family: "Arial", "Helvetica Neue", "Noto Sans", sans-serif;
  }

  /* ── Story Title ── */
  .title-pill {
    position: absolute;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.58);
    color: #FFE066;
    font-size: 22px;
    font-weight: 700;
    padding: 6px 18px;
    border-radius: 20px;
    white-space: nowrap;
    text-shadow: 0 1px 4px rgba(0,0,0,0.7);
    letter-spacing: 0.5px;
  }

  /* ── Dialogue Subtitle ── */
  .dialogue {
    position: absolute;
    bottom: 80px;
    left: 0;
    right: 0;
    text-align: center;
    padding: 0 24px;
  }
  .line {
    display: block;
    font-size: 34px;
    font-weight: 800;
    color: #FFFFFF;
    line-height: 1.45;
    /* TikTok-style: thick black outline via text-shadow */
    text-shadow:
      -2px -2px 0 #000,
       2px -2px 0 #000,
      -2px  2px 0 #000,
       2px  2px 0 #000,
      -3px  0   0 #000,
       3px  0   0 #000,
       0   -3px 0 #000,
       0    3px 0 #000;
    letter-spacing: 0.2px;
  }
</style>
</head>
<body>
  ${titleHtml}
  <div class="dialogue">${dialogueHtml}</div>
</body>
</html>`;
}

/**
 * Generates a subtitle PNG overlay using Puppeteer (already installed).
 * Returns path to PNG, or null on failure.
 */
export async function generateSubtitlePng(opts: SubtitleOptions, outPath: string): Promise<string | null> {
  const w = opts.videoWidth ?? 720;
  const h = opts.videoHeight ?? 1280;

  const htmlContent = buildHtml(opts);
  const htmlPath = outPath.replace(/\.png$/, "_sub.html");
  fs.writeFileSync(htmlPath, htmlContent, "utf-8");

  try {
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--no-zygote", "--single-process"]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(`file://${path.resolve(htmlPath)}`, { waitUntil: "load" });

    await page.screenshot({
      path: outPath as `${string}.png`,
      omitBackground: true,          // transparent background
      clip: { x: 0, y: 0, width: w, height: h }
    });

    await browser.close();
    try { fs.unlinkSync(htmlPath); } catch {}
    return outPath;
  } catch (err: any) {
    console.warn(`⚠️ [Subtitle] Puppeteer subtitle render failed: ${err.message}`);
    try { fs.unlinkSync(htmlPath); } catch {}
    return null;
  }
}

/**
 * Overlay subtitle PNG onto a video using FFmpeg's overlay filter.
 * Merges audio with adelay + atempo + apad if provided.
 */
export async function burnSubtitlePngOntoVideo(
  videoPath: string,
  subtitlePngPath: string,
  outputPath: string,
  audioPath?: string,
  audioDelayMs: number = 0,
  atempoFilter: string = ""
): Promise<string> {
  const getFfmpegCmd = (): string => {
    for (const c of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"]) {
      try { execSync(`"${c}" -version`, { stdio: "ignore" }); return c; } catch {}
    }
    return "ffmpeg";
  };
  const ffmpeg = getFfmpegCmd();

  return new Promise((resolve, reject) => {
    let cmd: string;
    const hasPng = subtitlePngPath && fs.existsSync(subtitlePngPath);
    const hasAudio = audioPath && fs.existsSync(audioPath);

    if (hasPng && hasAudio) {
      const ap: string[] = [];
      if (audioDelayMs > 50) ap.push(`adelay=${audioDelayMs}|${audioDelayMs}`);
      if (atempoFilter) ap.push(atempoFilter);
      ap.push("apad");
      const af = ap.join(",");
      cmd = `"${ffmpeg}" -y -i "${videoPath}" -i "${subtitlePngPath}" -i "${audioPath}" ` +
        `-filter_complex "[0:v][1:v]overlay=0:0[vout];[2:a]${af}[aout]" ` +
        `-map "[vout]" -map "[aout]" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 "${outputPath}"`;
    } else if (hasAudio) {
      const ap: string[] = [];
      if (audioDelayMs > 50) ap.push(`adelay=${audioDelayMs}|${audioDelayMs}`);
      if (atempoFilter) ap.push(atempoFilter);
      ap.push("apad");
      const af = ap.join(",");
      cmd = `"${ffmpeg}" -y -i "${videoPath}" -i "${audioPath}" ` +
        `-filter_complex "[1:a]${af}[aout]" ` +
        `-map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -ar 44100 "${outputPath}"`;
    } else if (hasPng) {
      cmd = `"${ffmpeg}" -y -i "${videoPath}" -i "${subtitlePngPath}" ` +
        `-filter_complex "[0:v][1:v]overlay=0:0[vout]" ` +
        `-map "[vout]" -map 0:a? -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 "${outputPath}"`;
    } else {
      cmd = `"${ffmpeg}" -y -i "${videoPath}" -c:v copy -c:a copy "${outputPath}"`;
    }
    exec(cmd, (err, _out, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(outputPath));
  });
}

/**
 * Concatenate multiple MP4 videos together into a single video file.
 */
export async function concatenateVideos(
  videoPaths: string[],
  outputPath: string
): Promise<string> {
  const getFfmpegCmd = (): string => {
    for (const c of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"]) {
      try { execSync(`"${c}" -version`, { stdio: "ignore" }); return c; } catch {}
    }
    return "ffmpeg";
  };
  const ffmpeg = getFfmpegCmd();

  if (videoPaths.length === 0) {
    throw new Error("No video paths provided for concatenation");
  }
  if (videoPaths.length === 1) {
    fs.copyFileSync(videoPaths[0], outputPath);
    return outputPath;
  }

  const existing = videoPaths.filter(p => fs.existsSync(p));
  if (existing.length === 0) {
    throw new Error("None of the specified video paths exist on disk");
  }

  const txtFile = outputPath + "_concat_list.txt";
  const listContent = existing.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(txtFile, listContent, "utf-8");

  const cmd = `"${ffmpeg}" -y -f concat -safe 0 -i "${txtFile}" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 "${outputPath}"`;

  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 15 * 1024 * 1024 }, (err, _stdout, stderr) => {
      try { fs.unlinkSync(txtFile); } catch {}
      if (err) {
        reject(new Error(stderr || err.message));
      } else {
        resolve(outputPath);
      }
    });
  });
}

