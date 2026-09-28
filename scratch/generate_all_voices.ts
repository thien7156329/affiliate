import "dotenv/config";
import fs from "fs";
import path from "path";
import { generateVietnameseTts } from "../src/ttsHelper.js";

const VOICES = [
  { 
    name: "Aoede", 
    role: "BuBu / Gấu Trắng / Bé gái hoạt hình", 
    tone: "Nữ / Bé gái (Soprano)", 
    desc: "Trong trẻo, ngọt ngào, ngân vang, vui tươi, nhí nhảnh", 
    text: "Xin chào bạn, mình là Aoede! Giọng của mình rất trong trẻo, ngọt ngào và đáng yêu, rất hợp cho các nhân vật hoạt hình hoạt bát nè!" 
  },
  { 
    name: "Charon", 
    role: "DuDu / Gấu Nâu / Anh trai ấm áp", 
    tone: "Nam (Baritone)", 
    desc: "Trầm ấm, điềm tĩnh, hiền lành, từ tốn, ân cần", 
    text: "Xin chào bạn, tôi là Charon. Chất giọng của tôi trầm ấm, từ tốn và điềm đạm, rất phù hợp cho nhân vật anh trai hoặc người kể chuyện ấm áp." 
  },
  { 
    name: "Puck", 
    role: "Cún con / Chú bé tinh nghịch", 
    tone: "Nam / Bé trai (Tenor)", 
    desc: "Lém lỉnh, tinh nghịch, nhanh nhẹn, tràn đầy năng lượng", 
    text: "Hê lô mọi người, mình là Puck đây! Giọng mình cực kỳ lém lỉnh, tinh nghịch và tràn đầy năng lượng, nghe là thấy vui liền luôn á!" 
  },
  { 
    name: "Kore", 
    role: "Chị gái / Cô giáo / Kể chuyện cổ tích", 
    tone: "Nữ (Mezzo-soprano)", 
    desc: "Dịu dàng, nhẹ nhàng, sâu lắng, truyền cảm", 
    text: "Chào bạn, mình là Kore. Giọng của mình mang phong cách dịu dàng, ấm áp và truyền cảm, rất thích hợp để kể những câu chuyện ngọt ngào." 
  },
  { 
    name: "Fenrir", 
    role: "Sếp Shiba / Chú gấu bố / Người dẫn chuyện", 
    tone: "Nam (Bass-Baritone)", 
    desc: "Dày dặn, uy lực, đĩnh đạc, chững chạc, dứt khoát", 
    text: "Tôi là Fenrir. Với chất giọng nam dày dặn, đĩnh đạc và uy lực, tôi sẽ mang lại sự chuyên nghiệp và đáng tin cậy cho câu chuyện của bạn." 
  },
  { 
    name: "Zephyr", 
    role: "Bạn trẻ gen Z năng động", 
    tone: "Nam (Tenor)", 
    desc: "Tươi trẻ, phóng khoáng, tự nhiên", 
    text: "Xin chào, mình là Zephyr. Giọng mình tươi trẻ, phóng khoáng và tự nhiên cho các bạn trẻ." 
  },
  { 
    name: "Callisto", 
    role: "Quý cô sang chảnh / Tự tin", 
    tone: "Nữ (Contralto)", 
    desc: "Quyến rũ, tự tin, cuốn hút", 
    text: "Xin chào, tôi là Callisto. Giọng tôi mang phong thái tự tin, sang trọng và đầy cuốn hút." 
  }
];

async function main() {
  const outputDir = path.resolve("./data/downloads/all_gemini_voices");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log(`🎙️ [VoiceDemo] Bắt đầu tạo demo các giọng đọc Gemini 3.1 Flash TTS...`);
  console.log(`📁 Thư mục lưu: ${outputDir}\n`);

  const results: any[] = [];

  for (let i = 0; i < VOICES.length; i++) {
    const v = VOICES[i];
    const outPath = path.join(outputDir, `${v.name}.wav`);

    // Skip if already generated and valid
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000 && v.name === "Aoede") {
      console.log(`⚡ [${i + 1}/${VOICES.length}] Đã có sẵn: ${v.name}.wav, bỏ qua...`);
      results.push({ ...v, path: outPath, status: "Thành công" });
      continue;
    }

    console.log(`⏳ [${i + 1}/${VOICES.length}] Đang tạo: ${v.name} (${v.tone})...`);
    
    let success = false;
    let attempts = 0;

    while (!success && attempts < 3) {
      attempts++;
      try {
        await generateVietnameseTts(v.text, outPath, v.name);
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 10000) {
          console.log(`✅ [${v.name}] Thành công -> ${path.basename(outPath)} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
          success = true;
          results.push({ ...v, path: outPath, status: "Thành công" });
        } else {
          throw new Error("File output rỗng");
        }
      } catch (err: any) {
        console.warn(`⚠️ [${v.name}] Thử lại lần ${attempts}: ${err.message}`);
        // Wait 15s before retry to reset quota bucket
        await new Promise(r => setTimeout(r, 15000));
      }
    }

    if (!success) {
      results.push({ ...v, path: outPath, status: "Lỗi" });
    }

    // Friendly delay 6s to avoid RPM 10 limit
    if (i < VOICES.length - 1) {
      console.log(`💤 Đợi 6 giây chống chạm hạn mức Google...`);
      await new Promise(r => setTimeout(r, 6000));
    }
  }

  // Generate README
  const indexContent = `# 🎙️ DANH SÁCH MẪU GIỌNG LỒNG TIẾNG GEMINI 3.1 FLASH TTS

Thư mục lưu trữ: \`${outputDir}\`

| STT | Tên giọng | Tông giọng | Nhân vật / Vai diễn gợi ý | Đặc điểm âm thanh | File Audio Mẫu |
| :---: | :--- | :--- | :--- | :--- | :--- |
${results.map((r, idx) => `| ${idx + 1} | **${r.name}** | ${r.tone} | ${r.role} | ${r.desc} | [\`${path.basename(r.path)}\`](./${path.basename(r.path)}) |`).join("\n")}

---
*Mẹo: Tất cả các file trên được tạo trực tiếp từ model Google Gemini \`gemini-3.1-flash-tts-preview\`.*
`;

  fs.writeFileSync(path.join(outputDir, "README.md"), indexContent, "utf-8");
  console.log(`\n🎉 HOÀN THÀNH TẤT CẢ CÁC GIỌNG MẪU TẠI: ${outputDir}`);
}

main().catch(err => console.error("Lỗi:", err));
