import "dotenv/config";
import fs from "fs";
import path from "path";
import https from "https";
import { execSync } from "child_process";
import { generateSubtitlePng } from "../src/subtitleGenerator.js";

function findFfmpeg(): string {
  for (const c of ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "ffmpeg"]) {
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

async function synthesizeGeminiVoiceHttps(
  text: string,
  voiceName: string,
  outWavPath: string,
  apiKey: string
): Promise<boolean> {
  const payload = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: `Đọc bằng giọng tiếng Việt tự nhiên, truyền cảm: "${text}"` }]
      }
    ],
    generationConfig: {
      responseModalities: ["audio"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voiceName.toLowerCase() }
        }
      }
    }
  });

  return new Promise<boolean>((resolve) => {
    const options = {
      hostname: "generativelanguage.googleapis.com",
      port: 443,
      path: `/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        if (res.statusCode !== 200) {
          console.warn(`❌ Voice "${voiceName}" returned HTTP ${res.statusCode}: ${data.substring(0, 150)}`);
          return resolve(false);
        }
        try {
          const parsed = JSON.parse(data);
          const audioPart = parsed?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.mimeType?.startsWith("audio/"));
          if (!audioPart?.inlineData?.data) {
            console.warn(`⚠️ Voice "${voiceName}" has no audio data.`);
            return resolve(false);
          }

          const mimeType: string = audioPart.inlineData.mimeType;
          const audioBuffer = Buffer.from(audioPart.inlineData.data, "base64");
          const rateMatch = mimeType.match(/rate=(\d+)/);
          const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
          const wavBuffer = buildWavBuffer(audioBuffer, sampleRate, 1, 16);

          fs.writeFileSync(outWavPath, wavBuffer);
          resolve(true);
        } catch (e: any) {
          console.warn(`❌ Voice "${voiceName}" parse error: ${e.message}`);
          resolve(false);
        }
      });
    });

    req.on("error", (err) => {
      console.warn(`❌ Request error for "${voiceName}": ${err.message}`);
      resolve(false);
    });

    req.setTimeout(25000, () => {
      req.destroy();
      console.warn(`⏳ Timeout for "${voiceName}"`);
      resolve(false);
    });

    req.write(payload);
    req.end();
  });
}

async function runRenderNewVoicesOnly() {
  console.log("============================================================");
  console.log("✨ RENDERING NEW GEMINI VOICE TYPES ONLY (KEY ROTATION ENABLED)");
  console.log("============================================================\n");

  const rawKeys = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean);
  let keyIndex = 0;

  const inputVideo = "/Users/letrongthien/Downloads/projects/affiliate/data/downloads/meo-i-bien_1787540250680/meo-i-bien_part1_6ce1leyb.mp4";
  const outputDir = "/Users/letrongthien/Downloads/projects/affiliate/data/downloads";
  const ffmpeg = findFfmpeg();

  const dialogue = '🐱 Mèo Trắng: "Thi xong rồi! Cuối cùng tụi mình cũng được đi biển xả hơi sau những ngày học tập chăm chỉ rồi Mèo Nâu ơi!"';
  const cleanText = dialogue.replace(/^🐱\s*Mèo Trắng:\s*/i, "").replace(/"/g, "").trim();

  const subPng = path.join(outputDir, "sub_gemini_new_temp.png");
  await generateSubtitlePng({ text: dialogue, title: "Chuyến Đi Biển Của Mèo Trắng & Mèo Nâu" }, subPng);

  // ONLY NEW Gemini Voice candidates (excluding Puck, Charon, Kore, Fenrir, Aoede)
  const newVoiceCandidates = [
    { name: "Rasalgethi", desc: "Rasalgethi — Nam đọc thông tin, hướng dẫn, tin tức" },
    { name: "Alnilam", desc: "Alnilam — Nam giọng chắc chắn, nghiêm túc" },
    { name: "Algenib", desc: "Algenib — Nam truyền cảm, ấm áp" },
    { name: "Algieba", desc: "Algieba — Nam rõ ràng, tin cậy" }
  ];

  const renderedVoices: string[] = [];

  for (const item of newVoiceCandidates) {
    const outWav = path.join(outputDir, `new_voice_${item.name}.wav`);
    const outMp4 = path.join(outputDir, `test_new_voice_${item.name}.mp4`);

    if (fs.existsSync(outMp4)) {
      console.log(`⏩ Already rendered "${item.name}". Skipping...`);
      renderedVoices.push(item.name);
      continue;
    }

    console.log(`✨ Synthesizing NEW Voice: "${item.desc}"...`);
    let currentApiKey = rawKeys[keyIndex % rawKeys.length];
    let success = await synthesizeGeminiVoiceHttps(cleanText, item.name, outWav, currentApiKey);

    // If rate limited (429), rotate key immediately and retry
    if (!success && !fs.existsSync(outWav)) {
      keyIndex++;
      currentApiKey = rawKeys[keyIndex % rawKeys.length];
      console.warn(`🔄 [Key Rotation] Switching to Key #${(keyIndex % rawKeys.length) + 1} and retrying "${item.name}"...`);
      await new Promise(r => setTimeout(r, 2000));
      success = await synthesizeGeminiVoiceHttps(cleanText, item.name, outWav, currentApiKey);
    }

    if (success && fs.existsSync(outWav)) {
      renderedVoices.push(item.name);
      const cmd = `"${ffmpeg}" -y -i "${inputVideo}" -i "${subPng}" -i "${outWav}" ` +
        `-filter_complex "[0:v][1:v]overlay=0:0[vout];[2:a]adelay=300|300,apad[aout]" ` +
        `-map "[vout]" -map "[aout]" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -shortest "${outMp4}"`;

      execSync(cmd, { stdio: "ignore" });
      try { fs.unlinkSync(outWav); } catch {}

      console.log(`✅ Rendered Video: test_new_voice_${item.name}.mp4\n`);
    } else {
      console.log(`⏭️ Voice "${item.name}" skipped.\n`);
    }

    await new Promise(r => setTimeout(r, 3000));
  }

  try { fs.unlinkSync(subPng); } catch {}

  console.log("============================================================");
  console.log(`🎉 ALL NEW VOICE RENDERS COMPLETED!`);
  console.log(`Rendered New Voices: [ ${renderedVoices.join(", ")} ]`);
  console.log("============================================================");
}

runRenderNewVoicesOnly().catch(console.error);
