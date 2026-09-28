import "dotenv/config";
import fs from "fs";
import path from "path";
import { generateMultiVoiceDialogueAudio } from "../src/multiVoiceSynthesizer";
import { muxTimestampedAudioSegments } from "../src/audioVideoMuxer";
import { DialogueSegment } from "../src/videoAnalyzer";

async function main() {
  const videoPath = "/Users/letrongthien/Downloads/projects/affiliate/data/downloads/gau-dudu-va-bubu-cung-i-ngam-hoa-anh-ao/gau-dudu-va-bubu-cung-i-ngam-hoa-anh-ao_merged.mp4";
  const outputDir = "/Users/letrongthien/Downloads/projects/affiliate/data/downloads/voice_demos";
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, "gau-dudu-va-bubu-cung-i-ngam-hoa-anh-ao_voiced.mp4");

  console.log(`🎬 [Dubbing] Source video: ${videoPath}`);
  console.log(`🎯 [Dubbing] Target output: ${outputPath}`);

  // 12 dialogue lines across 6 scenes (each scene is 10 seconds)
  const segments: DialogueSegment[] = [
    // Scene 1 (0s - 10s)
    {
      id: "seg_1",
      speaker: "dudu",
      start: 1.0,
      end: 4.5,
      text: "BuBu ơi! Nay trời đẹp quá! Đi ngắm hoa anh đào nhé!",
      emotion: "excited"
    },
    {
      id: "seg_2",
      speaker: "bubu",
      start: 5.0,
      end: 9.0,
      text: "He he! Tớ có sẵn giỏ picnic roài! Mochi hoa anh đào ngon ơi là ngon!",
      emotion: "happy"
    },
    // Scene 2 (10s - 20s)
    {
      id: "seg_3",
      speaker: "dudu",
      start: 11.0,
      end: 14.5,
      text: "BuBu đi nhanh lên! Hoa anh đào đang đợi mình kìa!",
      emotion: "excited"
    },
    {
      id: "seg_4",
      speaker: "bubu",
      start: 15.0,
      end: 19.0,
      text: "Wow... đẹp quá đi! Cánh hoa bay như tuyết hồng vậy nè!",
      emotion: "amazed"
    },
    // Scene 3 (20s - 30s)
    {
      id: "seg_5",
      speaker: "dudu",
      start: 21.0,
      end: 25.0,
      text: "Oa oa oa... Đẹp xỉu up xỉu down luôn BuBu ơi!",
      emotion: "amazed"
    },
    {
      id: "seg_6",
      speaker: "bubu",
      start: 25.5,
      end: 29.0,
      text: "Hắt xì! He he, hoa vừa hôn tớ kìa!",
      emotion: "playful"
    },
    // Scene 4 (30s - 40s)
    {
      id: "seg_7",
      speaker: "dudu",
      start: 31.0,
      end: 34.5,
      text: "Mmm... Mochi dâu ngọt lịm tim luôn nha!",
      emotion: "happy"
    },
    {
      id: "seg_8",
      speaker: "bubu",
      start: 35.0,
      end: 39.0,
      text: "Lemonade hoa anh đào cũng mê ly! Vị hoa tan chảy trong miệng á!",
      emotion: "joyful"
    },
    // Scene 5 (40s - 50s)
    {
      id: "seg_9",
      speaker: "dudu",
      start: 41.0,
      end: 45.0,
      text: "Cánh hoa hây hây... Tớ muốn bắt một cánh mang về nhà!",
      emotion: "playful"
    },
    {
      id: "seg_10",
      speaker: "bubu",
      start: 45.5,
      end: 49.0,
      text: "Và tớ... hụp! Bắt được rồi nè! Của tớ nhé!",
      emotion: "triumphant"
    },
    // Scene 6 (50s - 60s)
    {
      id: "seg_11",
      speaker: "dudu",
      start: 51.0,
      end: 54.5,
      text: "Hôm nay vui quá nhỉ BuBu... Mình sẽ nhớ mãi ngày hôm nay.",
      emotion: "warm"
    },
    {
      id: "seg_12",
      speaker: "bubu",
      start: 55.0,
      end: 59.0,
      text: "Ừhmm... Lần sau mình lại đi cùng nhau nha. Giờ thì... ngủ một chút đã...",
      emotion: "sleepy"
    }
  ];

  console.log(`🎙️ [Step 1] Synthesizing ${segments.length} dialogue audio clips with Agy Gemini TTS...`);
  const audioSegments = await generateMultiVoiceDialogueAudio(segments);

  console.log(`🎬 [Step 2] Muxing timestamped dialogue audio clips onto video track...`);
  await muxTimestampedAudioSegments(videoPath, audioSegments, outputPath);

  console.log(`✨ [Success] Voiced video created successfully: ${outputPath}`);
}

main().catch(err => {
  console.error("❌ [Error] Dubbing failed:", err);
});
