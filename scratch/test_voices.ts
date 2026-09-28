import { generateVietnameseTts } from "../src/ttsHelper.ts";
import fs from "fs";
import path from "path";

async function main() {
  const demoDir = path.resolve("./data/downloads/voice_demos");
  if (!fs.existsSync(demoDir)) fs.mkdirSync(demoDir, { recursive: true });

  const demos = [
    {
      voice: "Aoede",
      text: "Chào bạn, mình là Aoede. Giọng của mình rất dịu dàng, ấm áp và truyền cảm, rất hợp cho các video review mỹ phẩm hoặc kể chuyện tâm sự.",
      out: path.join(demoDir, "demo_Aoede.wav")
    },
    {
      voice: "Kore",
      text: "Xin chào mọi người! Mình là Kore nè! Giọng mình cực kỳ trẻ trung, năng động, rất bắt tai để làm video TikTok bắt trend triệu view đó nha!",
      out: path.join(demoDir, "demo_Kore.wav")
    },
    {
      voice: "Fenrir",
      text: "Tôi là Fenrir. Với chất giọng nam trầm, đĩnh đạc và uy lực, tôi sẽ mang lại sự chuyên nghiệp và đáng tin cậy cho video quảng bá sản phẩm của bạn.",
      out: path.join(demoDir, "demo_Fenrir.wav")
    }
  ];

  for (const d of demos) {
    console.log(`\n🎙️ Đang tạo giọng mẫu cho: ${d.voice}...`);
    try {
      const res = await generateVietnameseTts(d.text, d.out, d.voice);
      console.log(`✅ Thành công tạo: ${res}`);
    } catch (e: any) {
      console.error(`❌ Lỗi tạo ${d.voice}:`, e.message);
    }
  }
  console.log("\n✨ Hoàn tất toàn bộ 3 giọng mẫu!");
}

main();
