/**
 * Test S3 upload flow — run with:
 *   npx tsx scripts/test-s3-upload.ts
 *
 * Tạo file dummy MP4 → upload S3 → verify → lưu metadata → xóa local
 */

import "dotenv/config";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { createWriteStream, createReadStream, unlinkSync, existsSync, statSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOADS_DIR = path.resolve(__dirname, "../data/downloads");
const META_FILE = path.resolve(__dirname, "../data/metadata.json");

// ── Check env vars ────────────────────────────────────────────────────────────
const required = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET_NAME", "AWS_REGION"];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`❌ Missing env vars: ${missing.join(", ")}`);
  console.error("   Make sure .env is configured");
  process.exit(1);
}

const BUCKET = process.env.S3_BUCKET_NAME!;
const REGION = process.env.AWS_REGION!;
const PREFIX = (process.env.S3_KEY_PREFIX || "videos/").replace(/\/$/, "");

// ── Create dummy test file ────────────────────────────────────────────────────
mkdirSync(DOWNLOADS_DIR, { recursive: true });
const testFilename = `test_upload_${Date.now()}.mp4`;
const testFilePath = path.join(DOWNLOADS_DIR, testFilename);

// Write a minimal valid-ish binary file (just some bytes — not real MP4)
const dummyContent = Buffer.alloc(1024 * 10, 0x00); // 10KB
dummyContent.write("ftyp", 4); // fake MP4 header
writeFileSync(testFilePath, dummyContent);
console.log(`✅ Created dummy test file: ${testFilename} (${(dummyContent.length / 1024).toFixed(1)}KB)`);

// ── Check if real video exists in downloads/ instead ─────────────────────────
const existingVideos = existsSync(DOWNLOADS_DIR)
  ? readdirSync(DOWNLOADS_DIR).filter((f: string) => f.endsWith(".mp4") && !f.startsWith("test_"))
  : [];

let uploadPath = testFilePath;
let uploadFilename = testFilename;
let isRealVideo = false;

if (existingVideos.length > 0) {
  const realVideo = existingVideos[0];
  const realVideoPath = path.join(DOWNLOADS_DIR, realVideo);
  const size = statSync(realVideoPath).size;
  if (size > 50_000) { // > 50KB = likely real video
    console.log(`\n📹 Found real video: ${realVideo} (${(size / 1024 / 1024).toFixed(2)}MB)`);
    const useReal = process.argv.includes("--real");
    if (useReal) {
      uploadPath = realVideoPath;
      uploadFilename = realVideo;
      isRealVideo = true;
      unlinkSync(testFilePath); // remove dummy
      console.log("   Using real video (--real flag)");
    } else {
      console.log("   Using dummy file (pass --real to upload the real video instead)");
    }
  }
}

// ── Upload to S3 ─────────────────────────────────────────────────────────────
const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const s3Key = `${PREFIX}/${uploadFilename}`;
const productName = "Tai nghe Sony WH-1000XM5 chống ồn"; // test with Vietnamese
const fileSize = statSync(uploadPath).size;

console.log(`\n☁️  Uploading to S3...`);
console.log(`   Bucket: ${BUCKET}`);
console.log(`   Key:    ${s3Key}`);
console.log(`   Size:   ${(fileSize / 1024).toFixed(1)}KB`);

try {
  const fileStream = createReadStream(uploadPath);

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: fileStream,
    ContentType: "video/mp4",
    ContentLength: fileSize,
    Metadata: {
      product_id: "test_001",
      product_name: encodeURIComponent(productName), // encode Vietnamese!
      prompt: encodeURIComponent("Test upload from script"),
    },
  }));

  const s3Url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${s3Key}`;
  console.log(`\n✅ Upload SUCCESS!`);
  console.log(`   S3 URL: ${s3Url}`);

  // ── Verify via HeadObject ───────────────────────────────────────────────────
  console.log(`\n🔍 Verifying via HeadObject...`);
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: s3Key }));
  console.log(`   Content-Length: ${head.ContentLength} bytes`);
  console.log(`   Content-Type:   ${head.ContentType}`);
  console.log(`   product_name:   ${decodeURIComponent(head.Metadata?.product_name || "")}`);
  console.log(`✅ Verified!`);

  // ── Save metadata to metadata.json ─────────────────────────────────────────
  const metadataId = `vid_${Date.now()}`;
  const entry = {
    id: metadataId,
    title: productName,
    description: "Test upload from script",
    tags: ["test", "s3"],
    source_url: "",
    s3_url: s3Url,
    s3_key: s3Key,
    s3_bucket: BUCKET,
    size_bytes: fileSize,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let existing: any[] = [];
  if (existsSync(META_FILE)) {
    try { existing = JSON.parse(readFileSync(META_FILE, "utf-8")); } catch { existing = []; }
  }
  existing.unshift(entry);
  writeFileSync(META_FILE, JSON.stringify(existing, null, 2), "utf-8");
  console.log(`\n📄 Metadata saved: data/metadata.json (id: ${metadataId})`);


  // ── Delete local file after S3 ─────────────────────────────────────────────
  unlinkSync(uploadPath);
  console.log(`🗑️  Deleted local file: ${uploadFilename}`);

  console.log(`\n🏁 S3 upload flow COMPLETE ✅`);
  console.log(`   S3 URL: ${s3Url}`);

} catch (err: any) {
  console.error(`\n❌ Upload FAILED: ${err.message}`);
  // cleanup dummy
  if (existsSync(testFilePath)) unlinkSync(testFilePath);
  process.exit(1);
}
