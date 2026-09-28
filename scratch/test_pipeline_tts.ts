import { generateVietnameseTts } from "../src/ttsHelper.js";

async function main() {
  console.log("1. Generating Nam Chính (DuDu_NamChinh)...");
  const male = await generateVietnameseTts(
    "Chào các bạn, mình là DuDu, hôm nay chính thức làm giọng nam chính trong các video nè!",
    "scratch/test_main_male_pipeline.wav",
    "dudu"
  );
  console.log("🎉 Male ready:", male);

  console.log("2. Generating Nữ Chính (Mai Bé Phương)...");
  const female = await generateVietnameseTts(
    "Hello mọi người, mình là Mai Bé Phương, giọng nữ chính siêu nhí nhảnh nè!",
    "scratch/test_main_female_pipeline.wav",
    "mai_be_phuong"
  );
  console.log("🎉 Female ready:", female);
}

main().catch(console.error);
