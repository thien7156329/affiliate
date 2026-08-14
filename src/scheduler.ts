/**
 * Scheduler — Automatically runs the affiliate pipeline on a cron schedule.
 * Default: 8 AM, 12 PM, 6 PM every day.
 *
 * Pipeline: Product → Gemini Prompt → Veo Video → S3 Upload → TikTok Publish
 *
 * NOTE: node-cron is dynamically imported so the server won't crash
 * if the package is not yet installed. Install with: npm install node-cron
 */

import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCTS_FILE = path.resolve(__dirname, "../data/products.json");

export interface Product {
  id: string;
  name: string;
  category: string;
  affiliate_url: string;
  hashtags: string[];
  image_url?: string;
  images?: string[];
  description?: string;
  enabled: boolean;
}

export interface PipelineResult {
  product_id: string;
  product_name: string;
  success: boolean;
  prompt?: string;
  local_path?: string;
  s3_url?: string;
  s3_key?: string;
  metadata_id?: string;
  tiktok_video_id?: string;
  tiktok_status?: string;
  error?: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
}

// Pipeline state tracking
let isRunning = false;
let lastRunResults: PipelineResult[] = [];
let scheduledJobs: any[] = [];

export function getPipelineStatus() {
  return {
    is_running: isRunning,
    last_run_results: lastRunResults,
    scheduled_count: scheduledJobs.length,
  };
}

async function mergeVideoSegments(segmentPaths: string[], outputPath: string): Promise<void> {
  const { writeFileSync, unlinkSync } = await import("fs");
  
  if (segmentPaths.length === 1) {
    const { copyFileSync } = await import("fs");
    copyFileSync(segmentPaths[0], outputPath);
    console.log(`ℹ️ [Merge] Only one segment succeeded. Used as output directly: ${outputPath}`);
    return;
  }

  const listFilePath = outputPath + ".txt";
  const listContent = segmentPaths.map(p => `file '${path.resolve(p)}'`).join("\n");
  writeFileSync(listFilePath, listContent, "utf-8");

  console.log(`🎬 [Merge] Concatenating ${segmentPaths.length} video segments using FFmpeg...`);
  
  const execPromise = (cmd: string) => new Promise<void>((resolve, reject) => {
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error(`FFmpeg output stderr:\n${stderr}`);
        reject(new Error(stderr || err.message));
      } else {
        resolve();
      }
    });
  });

  try {
    await execPromise(`ffmpeg -y -f concat -safe 0 -i "${listFilePath}" -c copy "${outputPath}"`);
    console.log(`✅ [Merge] Concatenation completed successfully: ${outputPath}`);
  } catch (err: any) {
    console.warn(`⚠️ [Merge] Copy-concatenation failed: ${err.message}. Trying full re-encode merge...`);
    try {
      await execPromise(`ffmpeg -y -f concat -safe 0 -i "${listFilePath}" "${outputPath}"`);
      console.log(`✅ [Merge] Fallback concatenation completed successfully: ${outputPath}`);
    } catch (fallbackErr: any) {
      try { unlinkSync(listFilePath); } catch {}
      throw new Error(`FFmpeg concatenation failed: ${fallbackErr.message}`);
    }
  }

  try { unlinkSync(listFilePath); } catch {}
}

async function extractThumbnailWithFfmpeg(videoPath: string, outputPath: string): Promise<boolean> {
  console.log(`📸 [Thumbnail] Extracting thumbnail frame from ${videoPath} using FFmpeg...`);
  return new Promise<boolean>((resolve) => {
    exec(`ffmpeg -y -i "${videoPath}" -ss 00:00:01 -vframes 1 -q:v 2 "${outputPath}"`, (err) => {
      if (err) {
        console.warn(`⚠️ [Thumbnail] FFmpeg thumbnail extraction failed: ${err.message}`);
        resolve(false);
      } else {
        console.log(`✅ [Thumbnail] Thumbnail saved to: ${outputPath}`);
        resolve(true);
      }
    });
  });
}

function slugify(text: string): string {
  return text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-_]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function loadProducts(): Promise<Product[]> {
  if (!existsSync(PRODUCTS_FILE)) return [];
  const raw = await fs.readFile(PRODUCTS_FILE, "utf-8");
  return (JSON.parse(raw) as Product[]).filter((p) => p.enabled !== false);
}

export async function runPipelineForProduct(
  product: Product,
  options: { dryRun?: boolean; uploadToS3?: boolean; publishTikTok?: boolean } = {}
): Promise<PipelineResult> {
  const { dryRun = false, uploadToS3 = true, publishTikTok = true } = options;
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  let veoResult: any = null;
  let segmentFiles: string[] = [];

  console.log(`\n${"─".repeat(60)}`);
  console.log(`🚀 [Pipeline] Starting (Multi-Segment): ${product.name} (${product.id})`);
  console.log(`   DryRun: ${dryRun} | S3: ${uploadToS3} | TikTok: ${publishTikTok}`);
  console.log(`${"─".repeat(60)}`);

  try {
    // Step 1: Generate Veo prompts & Vietnamese caption
    console.log(`\n📝 [Pipeline 1/4] Generating 3 consistent Veo prompts & Vietnamese caption...`);
    const { generateThreeVideoPrompts, generateVideoDescriptionVi } = await import("./promptGenerator.js");
    const promptsObj = await generateThreeVideoPrompts(product.name, product.category, product.image_url, product.description);
    const descriptionVi = await generateVideoDescriptionVi(product.name, product.category, product.image_url);

    const mergedPromptStr = `1: ${promptsObj.prompt1}\n2: ${promptsObj.prompt2}\n3: ${promptsObj.prompt3}`;

    if (dryRun) {
      console.log(`🧪 [Pipeline] DRY RUN — stopping after prompt generation`);
      return {
        product_id: product.id,
        product_name: product.name,
        success: true,
        prompt: mergedPromptStr,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      };
    }

    // Step 2: Generate 3 video segments in parallel using Puppeteer + Veo
    console.log(`\n🎬 [Pipeline 2/4] Generating 3 Veo video segments in parallel (3 tabs)...`);
    const { generateVeoVideoParallel } = await import("./veoAutomation.js");
    const { existsSync, unlinkSync } = await import("fs");
    
    const prompts = [promptsObj.prompt1, promptsObj.prompt2, promptsObj.prompt3];
    const productSlug = slugify(product.name) || "video";
    const downloadsDir = path.resolve(__dirname, "../data/downloads");

    const parallelRes = await generateVeoVideoParallel(prompts, product.image_url, productSlug);
    segmentFiles = parallelRes.localPaths;

    if (segmentFiles.length === 0) {
      throw new Error(`All video segments failed to generate. Errors: ${parallelRes.errors.join("; ")}`);
    }

    // Sort segment files to ensure proper concatenation order (part1, part2, part3)
    segmentFiles.sort((a, b) => {
      const getIndex = (filePath: string) => {
        const match = filePath.match(/_part(\d+)_/);
        return match ? parseInt(match[1], 10) : 99;
      };
      return getIndex(a) - getIndex(b);
    });

    console.log(`✅ [Pipeline] Successfully generated segments in order:`, segmentFiles);

    console.log(`\n🎬 [Pipeline] Merging successfully generated video segments...`);
    const mergedVideoFilename = `${productSlug}_${Date.now()}.mp4`;
    const mergedVideoPath = path.join(downloadsDir, mergedVideoFilename);
    
    // Concatenate the videos using FFmpeg
    await mergeVideoSegments(segmentFiles, mergedVideoPath);

    // Extract thumbnail from the merged video
    const mergedThumbFilename = `${productSlug}_${Date.now()}_thumb.jpg`;
    const mergedThumbPath = path.join(downloadsDir, mergedThumbFilename);
    const thumbSuccess = await extractThumbnailWithFfmpeg(mergedVideoPath, mergedThumbPath);

    // Clean up temporary individual segment files
    for (const segmentFile of segmentFiles) {
      if (segmentFile !== mergedVideoPath) {
        try {
          if (existsSync(segmentFile)) {
            unlinkSync(segmentFile);
            console.log(`🗑️  [Pipeline] Deleted temporary segment file: ${segmentFile}`);
          }
        } catch {}
      }
    }

    // Set veoResult to contain the final merged video paths
    veoResult = {
      success: true,
      localPath: mergedVideoPath,
      thumbnailPath: thumbSuccess ? mergedThumbPath : undefined,
      videoUrl: "(concatenated video)",
      prompt: mergedPromptStr,
      durationMs: Date.now() - startTime
    };

    let s3Url = "";
    let s3Key = "";
    let metadataId = "";
    let tiktokVideoId = "";
    let tiktokStatus = "skipped";

    if (uploadToS3) {
      // Step 3: Upload to S3 using AWS SDK
      console.log(`\n☁️  [Pipeline 3/4] Uploading to S3...`);
      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { createReadStream, statSync } = await import("fs");

      const s3 = new S3Client({
        region: process.env.AWS_REGION || "us-east-1",
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      });

      const bucket = process.env.S3_BUCKET_NAME!;
      const prefix = (process.env.S3_KEY_PREFIX || "videos/").replace(/\/$/, "");
      const filename = path.basename(veoResult.localPath);
      s3Key = `${prefix}/${filename}`;

      const fileStream = createReadStream(veoResult.localPath);
      const fileSize = statSync(veoResult.localPath).size;

      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: fileStream,
        ContentType: "video/mp4",
        ContentLength: fileSize,
        Metadata: {
          product_id: product.id,
          product_name: encodeURIComponent(product.name),
          prompt: encodeURIComponent(mergedPromptStr.slice(0, 512)),
        },
      }));

      s3Url = `https://${bucket}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com/${s3Key}`;
      console.log(`✅ [Pipeline] Uploaded to S3: ${s3Url}`);

      let s3ThumbUrl = "";
      let s3ThumbKey = "";

      // Upload thumbnail to S3 if it exists
      if (veoResult.thumbnailPath) {
        console.log(`☁️  [Pipeline] Uploading video thumbnail to S3...`);
        const thumbFilename = path.basename(veoResult.thumbnailPath);
        s3ThumbKey = `${prefix}/${thumbFilename}`;
        const thumbStream = createReadStream(veoResult.thumbnailPath);
        const thumbSize = statSync(veoResult.thumbnailPath).size;

        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: s3ThumbKey,
          Body: thumbStream,
          ContentType: "image/jpeg",
          ContentLength: thumbSize,
          Metadata: {
            product_id: product.id,
            type: "thumbnail",
          },
        }));

        s3ThumbUrl = `https://${bucket}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com/${s3ThumbKey}`;
        console.log(`✅ [Pipeline] Thumbnail uploaded to S3: ${s3ThumbUrl}`);

        // Delete local thumbnail
        try {
          unlinkSync(veoResult.thumbnailPath);
          console.log(`🗑️  [Pipeline] Deleted local thumbnail: ${veoResult.thumbnailPath}`);
        } catch {
          console.warn(`⚠️  [Pipeline] Could not delete local thumbnail: ${veoResult.thumbnailPath}`);
        }
      }

      // Delete local file after successful S3 upload
      try {
        unlinkSync(veoResult.localPath);
        console.log(`🗑️  [Pipeline] Deleted local file: ${veoResult.localPath}`);
      } catch {
        console.warn(`⚠️  [Pipeline] Could not delete local file: ${veoResult.localPath}`);
      }

      // Automatically update the product in products.json with the generated image
      if (s3ThumbUrl && product.id) {
        try {
          if (existsSync(PRODUCTS_FILE)) {
            const rawProds = await fs.readFile(PRODUCTS_FILE, "utf-8");
            const prods = JSON.parse(rawProds) as any[];
            const idx = prods.findIndex(p => p.id === product.id);
            if (idx !== -1) {
              prods[idx].image_url = s3ThumbUrl;
              await fs.writeFile(PRODUCTS_FILE, JSON.stringify(prods, null, 2), "utf-8");
              console.log(`⚙️  [Pipeline] Updated product ${product.id} image_url in products.json`);
            }
          }
        } catch (prodErr: any) {
          console.warn(`⚠️  [Pipeline] Failed to update products.json: ${prodErr.message}`);
        }
      }

      // Save metadata to data/metadata.json (aligned with server.ts)
      const metaFile = path.resolve(__dirname, "../data/metadata.json");
      metadataId = `vid_${Date.now()}`;
      
      const entry = {
        id: metadataId,
        title: product.name,
        description: descriptionVi,
        prompt: mergedPromptStr,
        tags: product.hashtags || [],
        source_url: veoResult.videoUrl || "",
        s3_url: s3Url,
        s3_key: s3Key,
        s3_bucket: bucket,
        thumbnail_url: s3ThumbUrl || undefined,
        size_bytes: fileSize,
        tiktok_video_id: tiktokVideoId || undefined,
        tiktok_status: (tiktokStatus === "mock" ? "mock" : (tiktokStatus === "published" ? "published" : undefined)) as any,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      let existing: any[] = [];
      try {
        if (existsSync(metaFile)) {
          const raw = await fs.readFile(metaFile, "utf-8");
          existing = JSON.parse(raw);
        }
      } catch { existing = []; }

      existing.unshift(entry);
      await fs.writeFile(metaFile, JSON.stringify(existing, null, 2), "utf-8");
      console.log(`📄 [Pipeline] Metadata saved to data/metadata.json (id: ${metadataId})`);

      if (publishTikTok) {
        // Step 4: Publish to TikTok
        console.log(`\n📱 [Pipeline 4/4] Publishing to TikTok...`);
        console.log("🎭 [Pipeline] TikTok MOCK mode — skipping real publish");
        tiktokVideoId = `mock_${Date.now()}`;
        tiktokStatus = "mock";
      }
    }

    const result: PipelineResult = {
      product_id: product.id,
      product_name: product.name,
      success: true,
      prompt: mergedPromptStr,
      local_path: uploadToS3 ? "(deleted after S3 upload)" : veoResult.localPath,
      s3_url: s3Url,
      s3_key: s3Key,
      metadata_id: metadataId,
      tiktok_video_id: tiktokVideoId,
      tiktok_status: tiktokStatus,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    };

    console.log(`\n✅ [Pipeline] COMPLETED: ${product.name}`);
    console.log(`   S3: ${s3Url || "(skipped)"}`);
    console.log(`   TikTok: ${tiktokVideoId || "(skipped)"}`);
    return result;

  } catch (err: any) {
    console.error(`\n❌ [Pipeline] FAILED for ${product.name}: ${err.message}`);
    
    // Cleanup temporary segment files on failure
    if (typeof segmentFiles !== "undefined" && Array.isArray(segmentFiles)) {
      try {
        const { unlinkSync, existsSync } = await import("fs");
        for (const f of segmentFiles) {
          if (existsSync(f)) {
            unlinkSync(f);
            console.log(`🗑️  [Pipeline] Cleaned up temporary segment file on failure: ${f}`);
          }
        }
      } catch {}
    }

    // Cleanup local temp files if they were generated
    if (veoResult) {
      try {
        const { unlinkSync, existsSync } = await import("fs");
        if (veoResult.localPath && existsSync(veoResult.localPath)) {
          unlinkSync(veoResult.localPath);
          console.log(`🗑️  [Pipeline] Cleaned up local file on failure: ${veoResult.localPath}`);
        }
        if (veoResult.thumbnailPath && existsSync(veoResult.thumbnailPath)) {
          unlinkSync(veoResult.thumbnailPath);
          console.log(`🗑️  [Pipeline] Cleaned up local thumbnail on failure: ${veoResult.thumbnailPath}`);
        }
      } catch (cleanupErr: any) {
        console.warn(`⚠️  [Pipeline] Failed to clean up files on pipeline failure: ${cleanupErr.message}`);
      }
    }
    return {
      product_id: product.id,
      product_name: product.name,
      success: false,
      error: err.message,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    };
  }
}

export async function runAllProducts(options = {}): Promise<PipelineResult[]> {
  if (isRunning) {
    console.warn("⚠️  [Scheduler] Pipeline already running, skipping this trigger");
    return [];
  }

  isRunning = true;
  lastRunResults = [];

  try {
    const products = await loadProducts();
    console.log(`\n🗓️  [Scheduler] Starting run for ${products.length} product(s)...`);

    for (const product of products) {
      const result = await runPipelineForProduct(product, options);
      lastRunResults.push(result);

      // Wait 10 seconds between products to avoid rate limiting
      if (products.indexOf(product) < products.length - 1) {
        console.log("⏸️  Waiting 10 seconds before next product...");
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      }
    }

    console.log(`\n🏁 [Scheduler] Run complete — ${products.length} product(s) processed`);
    return lastRunResults;
  } finally {
    isRunning = false;
  }
}

export async function startScheduler() {
  // Dynamic import node-cron
  let cron: any;
  try {
    // @ts-ignore — package types available after npm install node-cron completes
    cron = (await import("node-cron")).default;
  } catch {
    console.warn("⚠️  [Scheduler] node-cron not installed — scheduler disabled. Run: npm install node-cron");
    return [];
  }

  const cronExpressions = (process.env.CRON_SCHEDULE || "0 8,12,18 * * *").split(";");

  console.log("\n⏰ [Scheduler] Starting cron jobs:");

  for (const expr of cronExpressions) {
    const trimmed = expr.trim();
    if (!cron.validate(trimmed)) {
      console.warn(`⚠️  [Scheduler] Invalid cron expression: "${trimmed}"`);
      continue;
    }

    const job = cron.schedule(trimmed, async () => {
      console.log(`\n⏰ [Scheduler] Cron triggered at ${new Date().toISOString()}`);
      await runAllProducts();
    });

    scheduledJobs.push(job);
    console.log(`   ✅ Registered cron: "${trimmed}"`);
  }

  console.log("   Scheduler running in background...\n");
  return scheduledJobs;
}

export function stopScheduler() {
  scheduledJobs.forEach((job) => job.stop());
  scheduledJobs = [];
  console.log("⛔ [Scheduler] All cron jobs stopped");
}
