/**
 * audioVideoMuxer.ts
 *
 * Places character dialogue audio segments at exact timestamps onto a video track
 * using FFmpeg complex filter `adelay` + `amix`.
 */

import { exec, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { SynthesizedAudioSegment } from "./multiVoiceSynthesizer.js";

function getFfmpeg(): string {
  for (const c of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"]) {
    try { execSync(`"${c}" -version`, { stdio: "ignore" }); return c; } catch {}
  }
  return "ffmpeg";
}

/**
 * Mux timestamped audio segments onto video
 */
export async function muxTimestampedAudioSegments(
  videoPath: string,
  audioSegments: SynthesizedAudioSegment[],
  outputPath: string
): Promise<string> {
  const ffmpeg = getFfmpeg();

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  if (audioSegments.length === 0) {
    fs.copyFileSync(videoPath, outputPath);
    return outputPath;
  }

  const existingAudioSegments = audioSegments.filter(s => fs.existsSync(s.audio_path));
  if (existingAudioSegments.length === 0) {
    fs.copyFileSync(videoPath, outputPath);
    return outputPath;
  }

  // Build FFmpeg command
  const inputArgs = existingAudioSegments.map(s => `-i "${s.audio_path}"`).join(" ");
  const delayFilters: string[] = [];
  const mixInputs: string[] = [];

  existingAudioSegments.forEach((s, idx) => {
    const inputIndex = idx + 1; // 0 is video
    const delayMs = Math.max(0, Math.round(s.start * 1000));
    const label = `a${inputIndex}`;
    
    if (delayMs > 20) {
      delayFilters.push(`[${inputIndex}:a]adelay=${delayMs}|${delayMs}[${label}]`);
    } else {
      delayFilters.push(`[${inputIndex}:a]anull[${label}]`);
    }
    mixInputs.push(`[${label}]`);
  });

  const numAudioInputs = mixInputs.length;
  let filterComplex = "";

  // Check if original video has an audio stream
  let hasOrigAudio = false;
  try {
    const probe = execSync(`"${ffmpeg}" -i "${videoPath}" 2>&1`, { encoding: "utf8" });
    hasOrigAudio = probe.includes("Audio:");
  } catch {}

  if (hasOrigAudio) {
    // Preserve original Gemini audio track (ambient sound, suối, nhạc nền) at 35% volume under dialogue
    if (numAudioInputs === 1) {
      filterComplex = `${delayFilters[0]}; [0:a]volume=0.35[bg]; [bg]${mixInputs[0]}amix=inputs=2:duration=first:dropout_transition=0[aout]`;
    } else {
      filterComplex = `${delayFilters.join("; ")}; ${mixInputs.join("")}amix=inputs=${numAudioInputs}:normalize=0:dropout_transition=0[dialogue_mix]; [0:a]volume=0.35[bg]; [bg][dialogue_mix]amix=inputs=2:duration=first:dropout_transition=0[aout]`;
    }
  } else {
    // Video has no audio track, use dialogue mix directly
    if (numAudioInputs === 1) {
      filterComplex = `${delayFilters[0]}; ${mixInputs[0]}anull[aout]`;
    } else {
      filterComplex = `${delayFilters.join("; ")}; ${mixInputs.join("")}amix=inputs=${numAudioInputs}:normalize=0:dropout_transition=0[aout]`;
    }
  }

  const cmd = `"${ffmpeg}" -y -i "${videoPath}" ${inputArgs} ` +
    `-filter_complex "${filterComplex}" ` +
    `-map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -ar 44100 -shortest "${outputPath}"`;

  console.log(`🎬 [AudioVideoMuxer] Muxing ${numAudioInputs} dialogue audio clips onto video...`);

  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 15 * 1024 * 1024 }, (err, _out, stderr) => {
      if (err) {
        // Fallback: If video copy fails (e.g. keyframe offset), re-encode video
        const fallbackCmd = `"${ffmpeg}" -y -i "${videoPath}" ${inputArgs} ` +
          `-filter_complex "${filterComplex}" ` +
          `-map 0:v -map "[aout]" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -shortest "${outputPath}"`;
        
        exec(fallbackCmd, { maxBuffer: 15 * 1024 * 1024 }, (fErr, _fOut, fStderr) => {
          if (fErr) reject(new Error(fStderr || fErr.message));
          else resolve(outputPath);
        });
      } else {
        resolve(outputPath);
      }
    });
  });
}
