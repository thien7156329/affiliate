import "dotenv/config";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { execSync, exec } from "child_process";

/**
 * Generates Vietnamese speech audio directly using Gemini 2.5 Flash TTS.
 *
 * Priority:
 * 1. Gemini 2.5 Flash TTS (using GEMINI_API_KEY) — supports prebuilt voices (Puck, Charon, Kore, Fenrir, Aoede)
 * 2. macOS built-in `say` command with voice "Linh" (vi_VN) — ZERO config, offline
 * 3. Google Cloud TTS (if GOOGLE_CLOUD_TTS_KEY is set)
 * 4. Google Translate TTS (unofficial free fallback)
 */
export async function generateVietnameseTts(text: string, targetPath: string, voiceIdOrName?: string): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    throw new Error("❌ [Gemini TTS Error] GEMINI_API_KEY is missing in .env!");
  }

  const wavPath = targetPath.replace(/\.(mp3|m4a|aac)$/i, ".wav");

  try {
    await generateWithGeminiTts(text, wavPath, geminiKey, voiceIdOrName);
    console.log(`🔊 [Gemini TTS] Generated speech for voice "${voiceIdOrName || 'Puck'}": ${path.basename(wavPath)}`);
    return wavPath;
  } catch (err: any) {
    console.warn(`⚠️ [Gemini TTS] Failed (${err.message}). Trying macOS say fallback...`);
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
    throw new Error(`TTS Generation failed for text: "${text}": ${err.message}`);
  }
}

// Track last call time globally to throttle requests and avoid 429 Rate Limit
let lastGeminiCallTime = 0;

// Provider 2: Gemini 2.5 Flash TTS with Smart Rate-Limiter & Exponential Backoff
async function generateWithGeminiTts(text: string, wavPath: string, apiKey: string, voiceIdOrName?: string): Promise<void> {
  // Support key rotation if multiple keys are provided via GEMINI_API_KEYS or GEMINI_API_KEY (separated by comma)
  const rawKeys = (process.env.GEMINI_API_KEYS || apiKey || "").split(",").map(k => k.trim()).filter(Boolean);
  let keyIndex = 0;

  // 1. Proactive Rate Limiting (Throttle): Ensure 10 seconds gap between consecutive calls
  const now = Date.now();
  const timeSinceLastCall = now - lastGeminiCallTime;
  const minIntervalMs = 10000; // 10s delay proactively prevents 429
  if (timeSinceLastCall < minIntervalMs) {
    const waitMs = minIntervalMs - timeSinceLastCall;
    console.log(`⏳ [Smart Rate Limiter] Throttling request for ${(waitMs / 1000).toFixed(1)}s to stay under Gemini RPM limit...`);
    await new Promise(r => setTimeout(r, waitMs));
  }
  lastGeminiCallTime = Date.now();

  // Map voice names to valid Gemini 2.5 Flash TTS prebuilt voices
  const validVoices = [
    "Puck", "Charon", "Kore", "Fenrir", "Aoede",
    "Zephyr", "Achernar", "Achird", "Orpheus", "Callisto",
    "Despina", "Enceladus", "Laomedeia", "Rasalgethi", "Alnilam", "Orus"
  ];
  // Core 4 Voices selected by User:
  // - Achernar: Nữ chính 1 (Dịu êm, truyền cảm, tâm sự, Mẹ/Nữ 1)
  // - Enceladus: Nữ chính 2 (Trong trẻo, biểu cảm nhẹ nhàng, Bé gái/Nữ 2)
  // - Puck: Nam chính 1 (Nhí nhảnh, vui tươi 3D Pixar, Mèo Trắng/Bé trai)
  // - Charon: Nam chính 2 (Trầm ấm, tình cảm, đĩnh đạc, Mèo Nâu/Bố)
  let chosenVoice = "Puck";
  if (voiceIdOrName) {
    const matched = validVoices.find(v => v.toLowerCase() === voiceIdOrName.toLowerCase());
    if (matched) {
      chosenVoice = matched;
    } else if (
      voiceIdOrName.toLowerCase().includes("gai2") ||
      voiceIdOrName.toLowerCase().includes("female2") ||
      voiceIdOrName.toLowerCase().includes("nu2")
    ) {
      chosenVoice = "Enceladus";
    } else if (
      voiceIdOrName.toLowerCase().includes("gai") ||
      voiceIdOrName.toLowerCase().includes("female") ||
      voiceIdOrName.toLowerCase().includes("me") ||
      voiceIdOrName.toLowerCase().includes("nu")
    ) {
      chosenVoice = "Achernar";
    } else if (
      voiceIdOrName.toLowerCase().includes("bo") ||
      voiceIdOrName.toLowerCase().includes("nau") ||
      voiceIdOrName.toLowerCase().includes("male2") ||
      voiceIdOrName.toLowerCase().includes("nam2")
    ) {
      chosenVoice = "Charon";
    } else if (
      voiceIdOrName.toLowerCase().includes("trai") ||
      voiceIdOrName.toLowerCase().includes("trang") ||
      voiceIdOrName.toLowerCase().includes("male") ||
      voiceIdOrName.toLowerCase().includes("nam")
    ) {
      chosenVoice = "Puck";
    }
  }

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Đọc bằng tiếng Việt với giọng lồng tiếng phim hoạt hình 3D Pixar rực rỡ, ngắt nghỉ vô cùng tự nhiên và cảm xúc: "${text}"`
          }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ["audio"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: chosenVoice.toLowerCase() }
        }
      }
    }
  };

  // 2. Exponential Backoff Retry Loop for 429 Rate Limits
  let attempts = 0;
  const maxAttempts = 4;

  while (attempts < maxAttempts) {
    attempts++;
    const currentKey = rawKeys[keyIndex % rawKeys.length];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${currentKey}`;

    try {
      const response = await axios.post(url, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 30000,
      });

      const candidate = response.data?.candidates?.[0];
      const audioPart = candidate?.content?.parts?.find((p: any) => p.inlineData?.mimeType?.startsWith("audio/"));

      if (!audioPart?.inlineData?.data) {
        throw new Error(`Gemini TTS: No audio data in response.`);
      }

      const mimeType: string = audioPart.inlineData.mimeType;
      const audioBuffer = Buffer.from(audioPart.inlineData.data, "base64");
      const rateMatch = mimeType.match(/rate=(\d+)/);
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
      const wavBuffer = buildWavBuffer(audioBuffer, sampleRate, 1, 16);
      fs.writeFileSync(wavPath, wavBuffer);
      return; // Success!

    } catch (err: any) {
      const is429 = err.response?.status === 429 || err.message?.includes("429");
      if (is429 && attempts < maxAttempts) {
        // If we have multiple keys, try rotating to the next key immediately
        if (rawKeys.length > 1) {
          keyIndex++;
          console.warn(`🔄 [Smart Rate Limiter] Key #${keyIndex} rate limited (429). Rotating to Key #${(keyIndex % rawKeys.length) + 1}...`);
          await new Promise(r => setTimeout(r, 2000));
        } else {
          // Exponential backoff delay: 15s -> 30s -> 45s
          const backoffDelayMs = attempts * 15000;
          console.warn(`⏳ [Smart Rate Limiter 429] Gemini RPM window full. Retrying attempt ${attempts}/${maxAttempts} in ${backoffDelayMs / 1000}s...`);
          await new Promise(r => setTimeout(r, backoffDelayMs));
        }
      } else {
        throw err;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider 3: Google Cloud TTS
// ─────────────────────────────────────────────────────────────────────────────
async function generateWithGoogleCloudTts(text: string, targetPath: string, apiKey: string): Promise<void> {
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
  const payload = {
    input: { text },
    voice: { languageCode: "vi-VN", ssmlGender: "NEUTRAL", name: "vi-VN-Chirp3-HD-Aoede" },
    audioConfig: { audioEncoding: "MP3", speakingRate: 1.05, pitch: 2.0 }
  };
  const response = await axios.post(url, payload, { headers: { "Content-Type": "application/json" }, timeout: 20000 });
  if (!response.data?.audioContent) throw new Error("Google Cloud TTS: No audioContent in response.");
  fs.writeFileSync(targetPath, Buffer.from(response.data.audioContent, "base64"));
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider 4: Google Translate TTS
// ─────────────────────────────────────────────────────────────────────────────
async function generateWithGoogleTranslateTts(text: string, targetPath: string): Promise<void> {
  const chunks = chunkText(text, 200);
  const buffers: Buffer[] = [];
  for (const chunk of chunks) {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=vi&client=tw-ob`;
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
      timeout: 10000,
    });
    buffers.push(Buffer.from(response.data));
  }
  fs.writeFileSync(targetPath, Buffer.concat(buffers));
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
