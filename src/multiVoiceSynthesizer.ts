/**
 * multiVoiceSynthesizer.ts
 *
 * Generates multi-speaker audio with character voice consistency.
 * Maps `speaker` ID to fixed Character Voice Definition (ElevenLabs or Character Pitch Shift).
 */

import axios from "axios";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { getCharacter, loadCharacters, CharacterDefinition } from "./characterRegistry.js";
import { DialogueSegment } from "./videoAnalyzer.js";
import { generateVietnameseTts } from "./ttsHelper.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.resolve(__dirname, "../data/downloads");

function getFfmpeg(): string {
  for (const c of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"]) {
    try { execSync(`"${c}" -version`, { stdio: "ignore" }); return c; } catch {}
  }
  return "ffmpeg";
}

export interface SynthesizedAudioSegment {
  segment_id: string;
  speaker: string;
  start: number;
  end: number;
  audio_path: string;
}

/**
 * Generate speech for a single dialogue segment using ElevenLabs API or Character Pitch fallback.
 */
export async function generateSegmentAudio(
  segment: DialogueSegment,
  character: CharacterDefinition,
  outWavPath: string
): Promise<string> {
  const ffmpeg = getFfmpeg();

  // ─── Option A: Agy Gemini TTS (Default & Primary) ──────────────────────
  try {
    const cleanText = segment.text.replace(/🐶|👔|🐱|❤️|✨|🐻|\"/g, "").trim();
    const voiceTarget = character.voice_id || character.id || "Puck";
    console.log(`🔊 [VoiceSynth-Agy] Generating speech for "${character.name}" (Voice target: ${voiceTarget}) via Gemini...`);
    await generateVietnameseTts(cleanText, outWavPath, voiceTarget);
    return outWavPath;
  } catch (err: any) {
    console.warn(`⚠️ [VoiceSynth-Agy] Gemini TTS failed: ${err.message}. Falling back to local character pitch synthesis.`);
  }

  // ─── Option B: Local Character Pitch Synthesis (macOS say + FFmpeg) ────
  const tempAiff = outWavPath.replace(/\.wav$/, ".aiff");
  const tempRawWav = outWavPath.replace(/\.wav$/, "_raw.wav");
  const cleanText = segment.text.replace(/🐶|👔|🐱|❤️|✨|\"/g, "").trim();

  const rate = Math.round((character.voice_settings?.speech_rate || 170));
  execSync(`say -v "Linh" -r ${rate} -o "${tempAiff}" "${cleanText.replace(/"/g, '\\"')}"`);

  // Convert AIFF -> WAV
  execSync(`"${ffmpeg}" -y -i "${tempAiff}" -ar 44100 -ac 2 "${tempRawWav}"`);
  try { fs.unlinkSync(tempAiff); } catch {}

  // Giữ nguyên chất giọng tự nhiên, tuyệt đối KHÔNG bóp méo tần số (no pitch warping/chipmunk effect)
  fs.copyFileSync(tempRawWav, outWavPath);
  try { fs.unlinkSync(tempRawWav); } catch {}

  console.log(`🔊 [VoiceSynth] Pure natural audio generated for ${character.name}: ${path.basename(outWavPath)}`);
  return outWavPath;
}

/**
 * Generate audio for all dialogue segments in a video scene
 */
export async function generateMultiVoiceDialogueAudio(
  segments: DialogueSegment[]
): Promise<SynthesizedAudioSegment[]> {
  const characters = await loadCharacters();
  const results: SynthesizedAudioSegment[] = [];

  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const charDef = characters[seg.speaker] || characters["xam"] || {
      id: seg.speaker,
      name: seg.speaker,
      provider: "macos_say",
      voice_id: "default",
      voice_settings: { pitch_shift: 1.0, speech_rate: 175 }
    };

    const outWav = path.join(TEMP_DIR, `dialogue_seg_${Date.now()}_${i + 1}.wav`);
    await generateSegmentAudio(seg, charDef, outWav);

    results.push({
      segment_id: seg.id || `seg_${i + 1}`,
      speaker: seg.speaker,
      start: seg.start,
      end: seg.end,
      audio_path: outWav
    });
  }

  return results;
}
