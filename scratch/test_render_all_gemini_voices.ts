import "dotenv/config";
import fs from "fs";
import path from "path";
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

async function testAndSynthesizeVoiceFetch(
  text: string,
  voiceName: string,
  outWavPath: string,
  apiKey: string
): Promise<boolean> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Đọc bằng giọng tiếng Việt tự nhiên và truyền cảm: "${text}"`
          }
        ]
      }
    ],
    generationConfig: {
      responseModalities: ["audio"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName }
        }
      }
    }
  };

  try {
    let res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.status === 429) {
      console.warn(`⏳ [Rate Limit 429] Waiting 5 seconds before retrying "${voiceName}"...`);
      await new Promise(r => setTimeout(r, 5000));
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      console.warn(`❌ Voice "${voiceName}" failed (${res.status}): ${errJson.error?.message || res.statusText}`);
      return false;
    }

    const data = await res.json();
    const audioPart = data?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.mimeType?.startsWith("audio/"));
    if (!audioPart?.inlineData?.data) {
      console.warn(`⚠️ Voice "${voiceName}" returned no audio data.`);
      return false;
    }

    const mimeType: string = audioPart.inlineData.mimeType;
    const audioBuffer = Buffer.from(audioPart.inlineData.data, "base64");
    const rateMatch = mimeType.match(/rate=(\d+)/);
    const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
    const wavBuffer = buildWavBuffer(audioBuffer, sampleRate, 1, 16);

    fs.writeFileSync(outWavPath, wavBuffer);
    return true;
  } catch (err: any) {
    console.warn(`❌ Voice "${voiceName}" fetch error: ${err.message}`);
    return false;
  }
}

async function runRenderAllVoices() {
  console.log("============================================================");
  console.log("🎙️ TESTING & RENDERING ALL GEMINI TTS VOICE TYPES (NATIVE FETCH)");
  console.log("============================================================\n");

  const apiKey = process.env.GEMINI_API_KEY!;
  const inputVideo = "/Users/letrongthien/Downloads/projects/affiliate/data/downloads/meo-i-bien_1787540250680/meo-i-bien_part1_6ce1leyb.mp4";
  const outputDir = "/Users/letrongthien/Downloads/projects/affiliate/data/downloads";
  const ffmpeg = findFfmpeg();

  const dialogue = '🐱 Mèo Trắng: "Thi xong rồi! Cuối cùng tụi mình cũng được đi biển xả hơi sau những ngày học tập chăm chỉ rồi Mèo Nâu ơi!"';
  const cleanText = dialogue.replace(/^🐱\s*Mèo Trắng:\s*/i, "").replace(/"/g, "").trim();

  const subPng = path.join(outputDir, "sub_gemini_all_temp.png");
  await generateSubtitlePng({ text: dialogue, title: "Chuyến Đi Biển Của Mèo Trắng & Mèo Nâu" }, subPng);

  // Expanded voice candidates list
  const voiceCandidates = [
    { name: "Puck", desc: "Puck — Nam vui tươi, hoạt hình 3D Pixar" },
    { name: "Charon", desc: "Charon — Nam trầm ấm, tình cảm, người lớn" },
    { name: "Kore", desc: "Kore — Nữ tự nhiên, chắc chắn, chuẩn kể chuyện" },
    { name: "Fenrir", desc: "Fenrir — Nam năng động, bốc lửa, hào hứng" },
    { name: "Aoede", desc: "Aoede — Nữ dịu dàng, truyền cảm, tâm sự" },
    { name: "Zephyr", desc: "Zephyr — Nam tươi sáng, năng lượng tích cực" },
    { name: "Achernar", desc: "Achernar — Dịu êm, thư giãn" },
    { name: "Achird", desc: "Achird — Thân thiện, gần gũi" },
    { name: "Orpheus", desc: "Orpheus — Nam kể chuyện tự nhiên, sâu lắng" },
    { name: "Callisto", desc: "Callisto — Nữ trong trẻo, đáng yêu" },
    { name: "Despina", desc: "Despina — Nữ nhẹ nhàng, tâm sự" },
    { name: "Enceladus", desc: "Enceladus — Nam biểu cảm, nhẹ nhàng" },
    { name: "Laomedeia", desc: "Laomedeia — Nữ hoạt bát, nhanh nhẹn" },
    { name: "Rasalgethi", desc: "Rasalgethi — Nam hướng dẫn, tin tức" },
    { name: "Alnilam", desc: "Alnilam — Nam nghiêm túc, đáng tin" },
    { name: "Orus", desc: "Orus — Nam chắc chắn, đĩnh đạc" }
  ];

  const validVoicesFound: string[] = [];

  for (const item of voiceCandidates) {
    const outWav = path.join(outputDir, `gemini_voice_${item.name}.wav`);
    const outMp4 = path.join(outputDir, `test_gemini_voice_${item.name}.mp4`);

    console.log(`✨ Testing Voice: "${item.desc}"...`);
    const success = await testAndSynthesizeVoiceFetch(cleanText, item.name, outWav, apiKey);

    if (success && fs.existsSync(outWav)) {
      validVoicesFound.push(item.name);
      const cmd = `"${ffmpeg}" -y -i "${inputVideo}" -i "${subPng}" -i "${outWav}" ` +
        `-filter_complex "[0:v][1:v]overlay=0:0[vout];[2:a]adelay=300|300,apad[aout]" ` +
        `-map "[vout]" -map "[aout]" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 44100 -shortest "${outMp4}"`;

      execSync(cmd, { stdio: "ignore" });
      try { fs.unlinkSync(outWav); } catch {}

      console.log(`✅ Rendered Video: test_gemini_voice_${item.name}.mp4\n`);
    } else {
      console.log(`⏭️ Skipping "${item.name}" (not supported by current Gemini TTS API model)\n`);
    }

    // Small delay to avoid rate limit
    await new Promise(r => setTimeout(r, 2000));
  }

  try { fs.unlinkSync(subPng); } catch {}

  console.log("============================================================");
  console.log(`🎉 COMPLETED! Valid Supported Gemini Voices: [ ${validVoicesFound.join(", ")} ]`);
  console.log("============================================================");
}

runRenderAllVoices().catch(console.error);
