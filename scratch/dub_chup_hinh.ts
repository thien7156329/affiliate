import "dotenv/config";
import fs from "fs";
import path from "path";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import { generateVietnameseTts } from "../src/ttsHelper.js";

const execAsync = promisify(exec);

interface Segment {
  id: string;
  speaker: "dudu" | "bubu";
  start: number;
  end: number;
  text: string;
}

const segments: Segment[] = [
  // Part 1 (0s - 10s)
  {
    id: "seg_01",
    speaker: "dudu",
    start: 0.5,
    end: 4.1,
    text: "Hôm nay nắng đẹp quá, Bubu ơi, tớ muốn tập chụp hình chuyên nghiệp."
  },
  {
    id: "seg_02",
    speaker: "bubu",
    start: 4.5,
    end: 6.8,
    text: "Chụp hình á? Nhưng tớ, tớ ngại lắm."
  },
  {
    id: "seg_03",
    speaker: "dudu",
    start: 7.2,
    end: 9.8,
    text: "Đừng lo, cậu sẽ là siêu mẫu gấu xinh nhất."
  },

  // Part 2 (10s - 20s)
  {
    id: "seg_04",
    speaker: "dudu",
    start: 10.5,
    end: 12.8,
    text: "Ok ok, góc này, ánh sáng này, perfect!"
  },
  {
    id: "seg_05",
    speaker: "bubu",
    start: 13.2,
    end: 15.5,
    text: "Tớ, tớ đứng đây có được không?"
  },
  {
    id: "seg_06",
    speaker: "dudu",
    start: 15.8,
    end: 19.5,
    text: "Đúng rồi, cậu đứng đó, ánh sáng chiếu lên lông cậu đẹp lắm."
  },

  // Part 3 (20s - 29s)
  {
    id: "seg_07",
    speaker: "bubu",
    start: 20.2,
    end: 21.2,
    text: "Như thế này nè!"
  },
  {
    id: "seg_08",
    speaker: "dudu",
    start: 21.6,
    end: 24.5,
    text: "Wow, đẹp quá! Giữ nguyên dáng nhé BuBu ơi."
  },
  {
    id: "seg_09",
    speaker: "bubu",
    start: 25.0,
    end: 26.5,
    text: "Này, tớ ngại nè!"
  },
  {
    id: "seg_10",
    speaker: "dudu",
    start: 26.8,
    end: 28.8,
    text: "Tự tin lên nào, một hai ba..."
  },

  // Part 4 (29s - 39s)
  {
    id: "seg_11",
    speaker: "dudu",
    start: 29.5,
    end: 32.5,
    text: "Siêu mẫu gấu tạo dáng nè, click click! Đẹp xỉu!"
  },
  {
    id: "seg_12",
    speaker: "bubu",
    start: 33.0,
    end: 35.8,
    text: "Góc này nữa, này nữa, chụp hình vui quá!"
  },
  {
    id: "seg_13",
    speaker: "bubu",
    start: 36.2,
    end: 38.5,
    text: "Tớ thích làm người mẫu lắm nha!"
  },

  // Part 5 (39s - 49s)
  {
    id: "seg_14",
    speaker: "dudu",
    start: 39.5,
    end: 41.5,
    text: "Kìa BuBu, ảnh đẹp quá xá luôn!"
  },
  {
    id: "seg_15",
    speaker: "bubu",
    start: 42.0,
    end: 45.0,
    text: "Wow, tớ... tớ thật sự trông dễ thương lắm sao?"
  },
  {
    id: "seg_16",
    speaker: "dudu",
    start: 45.4,
    end: 48.5,
    text: "Không chỉ dễ thương đâu, mà là siêu siêu xinh luôn á!"
  },

  // Part 6 (49s - 59s)
  {
    id: "seg_17",
    speaker: "dudu",
    start: 49.5,
    end: 52.2,
    text: "Chúc mừng siêu mẫu gấu BuBu ra mắt thành công!"
  },
  {
    id: "seg_18",
    speaker: "bubu",
    start: 52.6,
    end: 55.2,
    text: "Và chúc mừng nhiếp ảnh gia DuDu tài ba nữa nè!"
  },
  {
    id: "seg_19",
    speaker: "dudu",
    start: 55.6,
    end: 58.5,
    text: "Hẹn lần sau chụp nữa nha, bạn thân mãi mãi!"
  }
];

async function main() {
  const videoPath = "/Users/letrongthien/Downloads/projects/affiliate/data/downloads/dudu-tap-chup-hinh-cho-mau-anh-bubu/dudu-tap-chup-hinh-cho-mau-anh-bubu_merged.mp4";
  const tempAudioDir = "/Users/letrongthien/Downloads/projects/affiliate/scratch/dub_chup_hinh_audio";
  const outputPath = "/Users/letrongthien/Downloads/projects/affiliate/data/downloads/dudu-tap-chup-hinh-cho-mau-anh-bubu/dudu-tap-chup-hinh-cho-mau-anh-bubu_voiced.mp4";

  if (!fs.existsSync(tempAudioDir)) {
    fs.mkdirSync(tempAudioDir, { recursive: true });
  }

  console.log(`🎬 Bắt đầu lồng tiếng cho video: ${videoPath}`);
  console.log(`📌 Số lượng câu thoại: ${segments.length}`);

  // 1. Sinh âm thanh từng câu thoại
  const audioFiles: { path: string; start: number }[] = [];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const outClip = path.join(tempAudioDir, `${s.id}_${s.speaker}.wav`);
    const voiceName = s.speaker === "dudu" ? "dudu" : "mai_be_phuong";

    console.log(`🔊 [${i + 1}/${segments.length}] Đang sinh thoại (${s.speaker.toUpperCase()} - ${s.start}s): "${s.text}"`);
    await generateVietnameseTts(s.text, outClip, voiceName);
    audioFiles.push({ path: outClip, start: s.start });
  }

  // 2. Trộn âm thanh vào video gốc bằng FFmpeg
  console.log("🎛️ Đang muxing audio vào video gốc với sidechain ducking để giữ trọn vẹn âm thanh nền...");

  const inputArgs = audioFiles.map(a => `-i "${a.path}"`).join(" ");
  const delayFilters: string[] = [];
  const mixInputs: string[] = [];

  audioFiles.forEach((a, idx) => {
    const inputIdx = idx + 1; // 0 là video
    const delayMs = Math.max(0, Math.round(a.start * 1000));
    const label = `a${inputIdx}`;
    delayFilters.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs}[${label}]`);
    mixInputs.push(`[${label}]`);
  });

  const numClips = mixInputs.length;
  // Gộp tất cả câu thoại mới thành 1 stream dialogue_mix
  // Dùng sidechaincompress để khi có thoại thì âm nền gốc tự giảm nhẹ (-14dB), khi hết thoại thì âm nền gốc tự tăng 100%!
  const filterComplex = `
    ${delayFilters.join("; ")};
    ${mixInputs.join("")}amix=inputs=${numClips}:normalize=0:dropout_transition=0[dialogue_mix];
    [0:a][dialogue_mix]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=300[ducked_bg];
    [ducked_bg][dialogue_mix]amix=inputs=2:duration=first:dropout_transition=0[aout]
  `.replace(/\s+/g, " ").trim();

  const cmd = `ffmpeg -y -i "${videoPath}" ${inputArgs} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -ar 48000 -shortest "${outputPath}"`;

  await execAsync(cmd, { maxBuffer: 30 * 1024 * 1024 });

  console.log(`✅ Xuất video hoàn tất: ${outputPath}`);

  // Copy sang Downloads để user xem ngay
  const downloadsDest = "/Users/letrongthien/Downloads/dudu_tap_chup_hinh_voiced.mp4";
  fs.copyFileSync(outputPath, downloadsDest);
  console.log(`🎉 Đã copy vào: ${downloadsDest}`);
}

main().catch(err => {
  console.error("❌ Lỗi lồng tiếng:", err);
  process.exit(1);
});
