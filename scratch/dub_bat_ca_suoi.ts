import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { generateSpeechWithVieneu } from "../src/vieneuClient.js";

const execAsync = promisify(exec);

interface DialogueLine {
  id: string;
  speaker: "DuDu_NamChinh" | "Mai Bé Phương";
  startSec: number;
  text: string;
}

const dialogueLines: DialogueLine[] = [
  // Part 1 (0 - 10s)
  {
    id: "p1_dudu",
    speaker: "DuDu_NamChinh",
    startSec: 0.6,
    text: "BuBu đi sát bên anh nhé, hôm nay anh em mình cùng bắt cá ở suối!"
  },
  {
    id: "p1_bubu",
    speaker: "Mai Bé Phương",
    startSec: 5.1,
    text: "Dạ! Em sẽ theo anh DuDu thật ngoan!"
  },

  // Part 2 (10 - 20s)
  {
    id: "p2_bubu",
    speaker: "Mai Bé Phương",
    startSec: 13.5,
    text: "Anh DuDu ơi, đá ướt quá… em sợ bị trượt."
  },
  {
    id: "p2_dudu",
    speaker: "DuDu_NamChinh",
    startSec: 16.0,
    text: "Có anh đây rồi. Em bước chậm thôi, chúng mình sẽ qua an toàn."
  },

  // Part 3 (20 - 30s)
  {
    id: "p3_dudu",
    speaker: "DuDu_NamChinh",
    startSec: 23.0,
    text: "BuBu nhìn kìa, cá đang bơi về phía chúng mình. Em giữ vợt thật nhẹ nhé!"
  },
  {
    id: "p3_bubu",
    speaker: "Mai Bé Phương",
    startSec: 27.2,
    text: "Em thấy rồi! Chúng lấp lánh như những đồng xu bạc!"
  },

  // Part 4 (30 - 40s)
  {
    id: "p4_bubu",
    speaker: "Mai Bé Phương",
    startSec: 34.2,
    text: "Anh DuDu ơi, chúng mình bắt được một bạn cá rồi!"
  },
  {
    id: "p4_dudu",
    speaker: "DuDu_NamChinh",
    startSec: 37.5,
    text: "Giỏi lắm! Vì hai anh em biết bình tĩnh và phối hợp cùng nhau đấy."
  },

  // Part 5 (40 - 50s)
  {
    id: "p5_bubu",
    speaker: "Mai Bé Phương",
    startSec: 41.2,
    text: "Anh DuDu, mình thả bạn cá về nhà nhé? Bạn ấy chắc đang nhớ gia đình."
  },
  {
    id: "p5_dudu",
    speaker: "DuDu_NamChinh",
    startSec: 45.2,
    text: "Ừ, em gái của anh thật tốt bụng. Niềm vui đẹp nhất là biết yêu thương."
  },

  // Part 6 (50 - 60s)
  {
    id: "p6_bubu",
    speaker: "Mai Bé Phương",
    startSec: 50.2,
    text: "Hôm nay em học được cách bắt cá, lại còn giúp bạn cá trở về nhà!"
  },
  {
    id: "p6_dudu",
    speaker: "DuDu_NamChinh",
    startSec: 54.8,
    text: "Anh cũng học được rằng chuyến đi vui nhất là chuyến đi có hai anh em mình bên nhau."
  }
];

async function main() {
  const videoPath = "/Users/letrongthien/Downloads/projects/affiliate/data/downloads/gau-dudu-va-bubu-i-bat-ca-o-suoi/gau-dudu-va-bubu-i-bat-ca-o-suoi_merged.mp4";
  const noVocalsPath = "/Users/letrongthien/Downloads/projects/affiliate/scratch/bat_ca_dub/demucs_out/htdemucs/bat_ca_orig_audio/no_vocals.wav";
  const tempAudioDir = "/Users/letrongthien/Downloads/projects/affiliate/scratch/bat_ca_dub/audio_segments";
  const finalProjectVideo = "/Users/letrongthien/Downloads/projects/affiliate/data/downloads/gau-dudu-va-bubu-i-bat-ca-o-suoi/gau-dudu-va-bubu-i-bat-ca-o-suoi_voiced.mp4";
  const finalDownloadsVideo = path.join(process.env.HOME || "/Users/letrongthien", "Downloads/gau_dudu_va_bubu_bat_ca_suoi_voiced.mp4");

  if (!fs.existsSync(tempAudioDir)) {
    fs.mkdirSync(tempAudioDir, { recursive: true });
  }

  console.log("🎙️ 1. Sinh toàn bộ 12 câu thoại bằng giọng DuDu_NamChinh (Mới) và Mai Bé Phương (VieNeu)...");
  for (const line of dialogueLines) {
    const outPath = path.join(tempAudioDir, `${line.id}.wav`);
    console.log(`  - [${line.speaker}] (${line.startSec}s): "${line.text}"`);
    await generateSpeechWithVieneu({
      text: line.text,
      outputPath: outPath,
      voice: line.speaker,
      temperature: 0.35,
      topP: 0.9,
      applyWatermark: false
    });
  }
  console.log("✅ Đã tạo xong toàn bộ 12 file thoại chuẩn!");

  console.log("🎛️ 2. Hòa âm: no_vocals.wav (100% âm nền suối, tiếng bước chân, BGM) + 12 câu thoại mới...");
  // Input 0: no_vocals.wav
  // Input 1..12: 12 câu thoại
  const inputArgs = [`-i "${noVocalsPath}"`];
  const delayFilters: string[] = [];
  const mixInputs: string[] = [];

  dialogueLines.forEach((line, idx) => {
    const segmentPath = path.join(tempAudioDir, `${line.id}.wav`);
    inputArgs.push(`-i "${segmentPath}"`);
    const inputIdx = idx + 1; // 0 là no_vocals
    const delayMs = Math.max(0, Math.round(line.startSec * 1000));
    const label = `a${inputIdx}`;
    delayFilters.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs}[${label}]`);
    mixInputs.push(`[${label}]`);
  });

  const mixedDialogueWav = "/Users/letrongthien/Downloads/projects/affiliate/scratch/bat_ca_dub/dialogue_mixed_track.wav";
  const fullMixFilter = `${delayFilters.join(";")};${mixInputs.join("")}amix=inputs=${dialogueLines.length}:dropout_transition=0:normalize=0,volume=1.25[voices];[0:a]volume=0.85[bg];[bg][voices]amix=inputs=2:duration=first,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;

  const mixCmd = `ffmpeg -y ${inputArgs.join(" ")} -filter_complex "${fullMixFilter}" -map "[aout]" -ar 48000 -c:a pcm_s16le "${mixedDialogueWav}"`;
  console.log("🚀 Đang render track âm thanh hòa âm hoàn chỉnh...");
  await execAsync(mixCmd);
  console.log("✅ Đã hoàn thành track âm thanh:", mixedDialogueWav);

  console.log("🎬 3. Mux track âm thanh vào video gốc (giữ nguyên 100% hình ảnh)...");
  const muxCmd = `ffmpeg -y -i "${videoPath}" -i "${mixedDialogueWav}" -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k "${finalProjectVideo}"`;
  await execAsync(muxCmd);
  console.log("💾 Đã lưu vào dự án:", finalProjectVideo);

  fs.copyFileSync(finalProjectVideo, finalDownloadsVideo);
  console.log("💾 Đã sao chép vào Downloads:", finalDownloadsVideo);

  console.log("\n🎉 HOÀN TẤT LỒNG TIẾNG CHO VIDEO BẮT CÁ Ở SUỐI!");
}

main().catch((err) => {
  console.error("❌ Lỗi:", err);
  process.exit(1);
});
