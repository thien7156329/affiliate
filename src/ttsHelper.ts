import "dotenv/config";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { execSync, exec } from "child_process";

/**
 * High-level Vietnamese TTS generator.
 * Priority:
 * 1. VieNeu TTS (Voice clone cho DuDu_NamChinh & Mai Bé Phương)
 * 2. macOS built-in `say` command with voice "Linh" (vi_VN) — ZERO config, offline
 */
export async function generateVietnameseTts(text: string, targetPath: string, voiceIdOrName?: string): Promise<string> {
  const wavPath = targetPath.replace(/\.(mp3|m4a|aac)$/i, ".wav");
  const vLower = (voiceIdOrName || "").toLowerCase();

  // 1. Priority 1: VieNeu TTS for Main Characters (Nữ chính Mai Bé Phương & Nam chính DuDu)
  const isVieneu = vLower.includes("mai") || vLower.includes("phương") || vLower.includes("vieneu") || vLower.includes("dudu") || vLower.includes("bubu");
  if (isVieneu) {
    try {
      const { generateSpeechWithVieneu } = await import("./vieneuClient.js");
      let voiceName = "Mai Bé Phương";
      if (vLower.includes("dudu")) {
        voiceName = "DuDu_NamChinh";
      } else if (vLower.includes("bubu") || vLower.includes("part4")) {
        voiceName = "BuBu_Part4";
      }
      await generateSpeechWithVieneu({
        text,
        outputPath: wavPath,
        voice: voiceName,
        temperature: 0.4,
        topP: 0.9,
        applyWatermark: false,
      });
      const roleLabel = voiceName === "DuDu_NamChinh" ? "Nam Chính" : "Nữ Chính";
      console.log(`🔊 [VieNeu TTS (${roleLabel})] Generated clean speech for "${voiceName}": ${path.basename(wavPath)}`);
      return wavPath;
    } catch (viErr: any) {
      console.warn(`⚠️ [VieNeu TTS] Failed (${viErr.message}). Falling back to local offline say...`);
    }
  }

  // 2. Fallback: macOS say
  try {
    const aiffPath = targetPath.replace(/\.(mp3|wav|m4a|aac)$/i, ".aiff");
    const ffmpegCmd = findFfmpeg();
    execSync(`say -v "Linh" -o "${aiffPath}" "${text.replace(/"/g, '\\"')}"`, { timeout: 15000 });
    if (fs.existsSync(aiffPath)) {
      execSync(`"${ffmpegCmd}" -y -i "${aiffPath}" -ar 44100 -ac 2 "${wavPath}"`, { timeout: 15000 });
      fs.unlinkSync(aiffPath);
      return wavPath;
    }
  } catch {}

  throw new Error(`TTS Generation failed for text: "${text}"`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function findFfmpeg(): string {
  const candidates = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"];
  for (const c of candidates) {
    try { execSync(`"${c}" -version`, { stdio: "ignore" }); return c; } catch {}
  }
  return "ffmpeg";
}

function buildWavBuffer(pcmData: Buffer, sampleRate: number, numChannels: number, bitsPerSample: number): Buffer {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmData]);
}

function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let boundary = remaining.lastIndexOf(" ", maxLen);
    if (boundary <= 0) boundary = maxLen;
    chunks.push(remaining.substring(0, boundary));
    remaining = remaining.substring(boundary).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider 1: ElevenLabs Multilingual V2 (Supports Voice ID & Character Mapping)
// ─────────────────────────────────────────────────────────────────────────────
async function resolveElevenLabsVoiceId(voiceIdOrName: string | undefined, apiKey: string): Promise<string> {
  const queryName = (voiceIdOrName || "Anh").trim();

  // 1. Direct ElevenLabs Voice ID (alphanumeric 18+ chars)
  if (/^[a-zA-Z0-9_-]{18,}$/.test(queryName)) {
    return queryName;
  }

  // 2. Query user's account voice list to find matching voice name (e.g. "Anh", "Đức", "Trang", "Tuan", "Trung")
  try {
    const res = await axios.get("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
      timeout: 10000
    });
    const voices: any[] = res.data?.voices || [];
    const q = queryName.toLowerCase();

    const matched = voices.find((v) => v.name.toLowerCase().includes(q));
    if (matched) {
      console.log(`🎯 [ElevenLabs] Mapped character voice "${queryName}" → Voice ID: ${matched.voice_id} ("${matched.name}")`);
      return matched.voice_id;
    }

    // Try matching any Vietnamese voice in user account
    const viVoice = voices.find((v) => 
      (v.labels && (v.labels.language === "vi" || v.labels.language === "vietnamese")) ||
      v.name.toLowerCase().includes("vietnam") ||
      v.name.toLowerCase().includes("anh") ||
      v.name.toLowerCase().includes("đức") ||
      v.name.toLowerCase().includes("trang") ||
      v.name.toLowerCase().includes("tuan")
    );
    if (viVoice) {
      console.log(`🎯 [ElevenLabs] Fallback match voice "${viVoice.name}" (ID: ${viVoice.voice_id})`);
      return viVoice.voice_id;
    }

    if (voices.length > 0) return voices[0].voice_id;
  } catch (err: any) {
    console.warn(`⚠️ [ElevenLabs] Voice lookup API warning: ${err.message}`);
  }

  // Fallback default voice ID if lookup fails
  return "21m00Tcm4TlvDq8ikWAM";
}

async function generateWithElevenLabsTts(
  text: string,
  targetPath: string,
  voiceIdOrName: string | undefined,
  apiKey: string
): Promise<string> {
  const voiceId = await resolveElevenLabsVoiceId(voiceIdOrName, apiKey);
  const cleanText = text.replace(/🐱|👔|🐶|❤️|✨|🐻|\"/g, "").trim();
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  const res = await axios.post(
    url,
    {
      text: cleanText,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.75,
        similarity_boost: 0.85,
        style: 0.15,
        use_speaker_boost: true
      }
    },
    {
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json"
      },
      responseType: "arraybuffer",
      timeout: 30000
    }
  );

  const tempMp3 = targetPath.replace(/\.(wav|mp3)$/i, ".mp3");
  fs.writeFileSync(tempMp3, Buffer.from(res.data));

  const wavPath = targetPath.replace(/\.(mp3|m4a|aac)$/i, ".wav");
  const ffmpegCmd = findFfmpeg();
  execSync(`"${ffmpegCmd}" -y -i "${tempMp3}" -ar 44100 -ac 2 "${wavPath}"`, { timeout: 15000 });
  try { fs.unlinkSync(tempMp3); } catch {}

  console.log(`🔊 [ElevenLabs TTS] Speech synthesized successfully (Voice: "${voiceIdOrName || 'default'}", ID: ${voiceId}): ${path.basename(wavPath)}`);
  return wavPath;
}
