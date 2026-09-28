import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface Segment {
  id: string;
  speaker: "dudu" | "bubu";
  start: number;
}

const segments: Segment[] = [
  { id: "seg_01", speaker: "dudu", start: 0.5 },
  { id: "seg_02", speaker: "bubu", start: 4.5 },
  { id: "seg_03", speaker: "dudu", start: 7.2 },
  { id: "seg_04", speaker: "dudu", start: 10.5 },
  { id: "seg_05", speaker: "bubu", start: 13.2 },
  { id: "seg_06", speaker: "dudu", start: 15.8 },
  { id: "seg_07", speaker: "bubu", start: 20.2 },
  { id: "seg_08", speaker: "dudu", start: 21.6 },
  { id: "seg_09", speaker: "bubu", start: 25.0 },
  { id: "seg_10", speaker: "dudu", start: 26.8 },
  { id: "seg_11", speaker: "dudu", start: 29.5 },
  { id: "seg_12", speaker: "bubu", start: 33.0 },
  { id: "seg_13", speaker: "bubu", start: 36.2 },
  { id: "seg_14", speaker: "dudu", start: 39.5 },
  { id: "seg_15", speaker: "bubu", start: 42.0 },
  { id: "seg_16", speaker: "dudu", start: 45.4 },
  { id: "seg_17", speaker: "dudu", start: 49.5 },
  { id: "seg_18", speaker: "bubu", start: 52.6 },
  { id: "seg_19", speaker: "dudu", start: 55.6 }
];

async function main() {
  const videoPath = "/Users/letrongthien/Downloads/projects/affiliate/data/downloads/dudu-tap-chup-hinh-cho-mau-anh-bubu/dudu-tap-chup-hinh-cho-mau-anh-bubu_merged.mp4";
  const noVocalsPath = "/Users/letrongthien/Downloads/projects/affiliate/scratch/demucs_out/htdemucs/dudu_chup_hinh_orig_audio/no_vocals.wav";
  const tempAudioDir = "/Users/letrongthien/Downloads/projects/affiliate/scratch/dub_chup_hinh_audio";
  const finalVoicedVideo = "/Users/letrongthien/Downloads/projects/affiliate/data/downloads/dudu-tap-chup-hinh-cho-mau-anh-bubu/dudu-tap-chup-hinh-cho-mau-anh-bubu_voiced.mp4";
  const downloadsDest = "/Users/letrongthien/Downloads/dudu_tap_chup_hinh_voiced.mp4";

  console.log("🎛️ Bắt đầu hòa âm mới: no_vocals.wav (âm nền sạch 100%) + 19 câu thoại mới...");

  // input 0: video
  // input 1: no_vocals.wav (nhạc nền / SFX tách sạch lời thoại cũ)
  // input 2..20: 19 file thoại mới
  const inputArgs = [`-i "${noVocalsPath}"`];
  const delayFilters: string[] = [];
  const mixInputs: string[] = [];

  segments.forEach((s, idx) => {
    const filePath = path.join(tempAudioDir, `${s.id}_${s.speaker}.wav`);
    inputArgs.push(`-i "${filePath}"`);
    const inputIdx = idx + 2; // 0 là video, 1 là no_vocals
    const delayMs = Math.max(0, Math.round(s.start * 1000));
    const label = `a${inputIdx}`;
    delayFilters.push(`[${inputIdx}:a]adelay=${delayMs}|${delayMs}[${label}]`);
    mixInputs.push(`[${label}]`);
  });

  const numClips = mixInputs.length;
  // Gộp 19 câu thoại lại thành 1 stream thoại (volume chuẩn, normalize=0)
  // Trộn stream thoại với âm thanh nền gốc no_vocals (giữ âm nền ở 65% để tôn giọng mới)
  const filterComplex = `
    ${delayFilters.join("; ")};
    ${mixInputs.join("")}amix=inputs=${numClips}:normalize=0:dropout_transition=0[dialogue_mix];
    [1:a]volume=0.65[bg_clean];
    [bg_clean][dialogue_mix]amix=inputs=2:normalize=0:duration=first:dropout_transition=0[aout]
  `.replace(/\s+/g, " ").trim();

  const cmd = `ffmpeg -y -i "${videoPath}" ${inputArgs.join(" ")} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k -ar 48000 "${finalVoicedVideo}"`;

  console.log("⚡ Đang chạy FFmpeg muxing...");
  await execAsync(cmd, { maxBuffer: 30 * 1024 * 1024 });

  fs.copyFileSync(finalVoicedVideo, downloadsDest);
  console.log(`🎉 ĐÃ XUẤT THÀNH CÔNG VÀO CẢ 2 NƠI:`);
  console.log(`  1. ${finalVoicedVideo}`);
  console.log(`  2. ${downloadsDest}`);
}

main().catch(console.error);
