/**
 * Affiliate MCP Server
 * ─────────────────────────────────────────────────────────
 * Flow: Gemini/Veo → upload_video() → save_metadata() → publish_tiktok()
 *
 * MCP Tools:
 *   - upload_video    : Download video từ URL → Upload lên AWS S3
 *   - save_metadata   : Lưu metadata video vào JSON local
 *   - publish_tiktok  : Publish video lên TikTok (mock mode mặc định)
 *
 * REST Endpoints:
 *   GET  /health            - Health check
 *   GET  /api/videos        - Lấy danh sách video metadata
 *   GET  /api/videos/:id    - Lấy metadata theo ID
 *   DELETE /api/videos/:id  - Xóa metadata
 *   POST /mcp               - MCP StreamableHTTP endpoint
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import axios from "axios";
import fs from "fs/promises";
import { existsSync, createWriteStream, mkdirSync, readdirSync, rmSync, unlinkSync, readFileSync, writeFileSync, statSync, renameSync } from "fs";
import { execSync } from "child_process";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const require = createRequire(import.meta.url);
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { S3Client, PutObjectCommand, HeadBucketCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "stream";
import { z } from "zod";
import { generateVideoPrompt, generateVideoDescriptionVi, callBedrock, generatePromptsWithAiConsensus, sendSessionFeedback } from "./promptGenerator.js";
import { generateVeoVideo, ensureChromeRunning, toHostPath } from "./veoAutomation.js";
import puppeteer from "puppeteer";
import http2 from "http2";
import { concatenateVideos } from "./subtitleGenerator.js";
import { loadCharacters, upsertCharacter, deleteCharacter } from "./characterRegistry.js";
import { analyzeVideoDialogueTimestamps } from "./videoAnalyzer.js";
import { generateMultiVoiceDialogueAudio } from "./multiVoiceSynthesizer.js";
import { muxTimestampedAudioSegments } from "./audioVideoMuxer.js";
import {
  runPipelineForProduct,
  runAllProducts,
  loadProducts,
  getPipelineStatus,
  startScheduler,
  parseTextPromptToObj,
} from "./scheduler.js";
import { startChromeBridge } from "./chromeBridge.js";
// ─── Process Error Handlers (Prevents nodemon crashes on network ECONNRESET) ──
process.on("uncaughtException", (err: any) => {
  if (err?.code === "ECONNRESET" || err?.message?.includes("aborted") || err?.message?.includes("socket")) {
    console.warn(`⚠️ [Server] Handled socket/network ECONNRESET error (preventing crash): ${err.message}`);
  } else {
    console.error("⚠️ [Server] Uncaught Exception:", err);
  }
});

process.on("unhandledRejection", (reason: any) => {
  console.warn("⚠️ [Server] Unhandled Rejection:", reason?.message || reason);
});

// ─── Constants ────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const METADATA_FILE = path.join(DATA_DIR, "metadata.json");

const PORT = parseInt(process.env.PORT || "3400");
const S3_BUCKET = process.env.S3_BUCKET_NAME || "";
const S3_PREFIX = process.env.S3_KEY_PREFIX || "videos/";
const IS_MOCK_TIKTOK = !process.env.TIKTOK_API_KEY || process.env.TIKTOK_API_KEY === "mock";

// ─── Types ────────────────────────────────────────────────────────────────────
interface VideoMetadata {
  id: string;
  title: string;
  product_name?: string;
  description?: string;
  prompt?: string;
  tags: string[];
  source_url?: string;
  s3_url: string;
  s3_bucket?: string;
  s3_key?: string;
  local_path?: string;
  stream_url?: string;
  size_bytes?: number;
  tiktok_video_id?: string;
  tiktok_status?: "published" | "mock" | "failed";
  thumbnail_url?: string;
  images?: string[];
  caption?: string;
  description_vi?: string;
  created_at: string;
  updated_at: string;
}

// ─── AWS S3 Client ────────────────────────────────────────────────────────────
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "ap-southeast-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  },
});

// ─── FFmpeg & Thumbnail Helpers ──────────────────────────────────────────────
function getFfmpegCmd(): string {
  try {
    const ffmpegStatic = require("ffmpeg-static");
    if (ffmpegStatic && existsSync(ffmpegStatic)) return ffmpegStatic;
  } catch {}
  if (existsSync("/opt/homebrew/bin/ffmpeg")) return "/opt/homebrew/bin/ffmpeg";
  if (existsSync("/usr/local/bin/ffmpeg")) return "/usr/local/bin/ffmpeg";
  return "ffmpeg";
}

function extractVideoThumbnailSync(videoPath: string, outputPath: string): boolean {
  try {
    const ffmpeg = getFfmpegCmd();
    execSync(`"${ffmpeg}" -y -ss 00:00:01 -i "${videoPath}" -vframes 1 -q:v 2 "${outputPath}" 2>/dev/null`);
    return existsSync(outputPath);
  } catch (err: any) {
    console.warn(`⚠️ [Thumbnail] Extraction failed for ${videoPath}: ${err.message}`);
    return false;
  }
}

// ─── Metadata Storage Helpers ─────────────────────────────────────────────────
async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log(`📂 Created data directory: ${DATA_DIR}`);
  }
}

const DELETED_VIDEOS_FILE = path.resolve(DATA_DIR, "deleted_videos.json");

function loadDeletedVideoPaths(): Set<string> {
  try {
    if (existsSync(DELETED_VIDEOS_FILE)) {
      const raw = readFileSync(DELETED_VIDEOS_FILE, "utf-8");
      return new Set(JSON.parse(raw));
    }
  } catch {}
  return new Set();
}

function markVideoPathDeleted(p: string): void {
  try {
    const set = loadDeletedVideoPaths();
    set.add(p);
    writeFileSync(DELETED_VIDEOS_FILE, JSON.stringify(Array.from(set), null, 2), "utf-8");
  } catch {}
}

async function syncLocalDownloadsToMetadata(existingList: VideoMetadata[]): Promise<VideoMetadata[]> {
  const downloadsDir = path.resolve(__dirname, "../data/downloads");
  if (!existsSync(downloadsDir)) return existingList;

  const deletedPaths = loadDeletedVideoPaths();
  let modified = false;
  let list = [...existingList];

  // 1. DEDUPLICATION STEP:
  // If an official pipeline entry (id not starting with vid_sync_) exists for a video,
  // purge any duplicate vid_sync_ entry that was prematurely registered while the pipeline was uploading/processing.
  const officialEntries = list.filter(item => !item.id.startsWith("vid_sync_"));
  const deduplicatedList: VideoMetadata[] = [];

  for (const item of list) {
    if (item.id.startsWith("vid_sync_")) {
      const itemBase = item.local_path 
        ? path.basename(item.local_path) 
        : (item.s3_url ? path.basename(item.s3_url) : "");
      
      const matchingOfficial = officialEntries.find(off => {
        const offBase = off.local_path 
          ? path.basename(off.local_path) 
          : (off.s3_url ? path.basename(off.s3_url) : (off.s3_key ? path.basename(off.s3_key) : ""));
        
        if (itemBase && offBase && itemBase === offBase) return true;
        if (itemBase && off.s3_url && off.s3_url.includes(itemBase)) return true;
        if (itemBase && off.s3_key && off.s3_key.includes(itemBase)) return true;
        if (item.local_path && off.local_path && path.resolve(item.local_path) === path.resolve(off.local_path)) return true;
        return false;
      });

      if (matchingOfficial) {
        // Link local_path to official entry if missing
        if (!matchingOfficial.local_path && item.local_path) {
          matchingOfficial.local_path = item.local_path;
        }
        console.log(`🧹 [SyncMetadata] Purged duplicate vid_sync entry "${item.title}" (${item.id}) - official entry is "${matchingOfficial.title}" (${matchingOfficial.id})`);
        modified = true;
        continue; // Drop the duplicate vid_sync entry
      }
    }
    deduplicatedList.push(item);
  }

  list = deduplicatedList;

  const helperScanDir = (dir: string): string[] => {
    let results: string[] = [];
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results = results.concat(helperScanDir(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith(".mp4") || entry.name.endsWith(".webm"))) {
          results.push(fullPath);
        }
      }
    } catch {}
    return results;
  };

  const allVideoFiles = helperScanDir(downloadsDir);

  const dirMap = new Map<string, string[]>();
  for (const filePath of allVideoFiles) {
    const dir = path.dirname(filePath);
    if (!dirMap.has(dir)) dirMap.set(dir, []);
    dirMap.get(dir)!.push(filePath);
  }

  for (const [dir, files] of dirMap.entries()) {
    const mainVideo = files.find(f => 
      !f.includes("_voiced") && 
      !f.includes("_part") && 
      (
        f.endsWith("_raw_original.mp4") || 
        f.endsWith("_merged.mp4") ||
        path.basename(f).startsWith("stitched_") ||
        path.basename(f).startsWith("uploaded_")
      )
    ) || (dir === downloadsDir ? files.find(f => !f.includes("_voiced") && !f.includes("_part")) : null);

    if (!mainVideo) continue;

    const relativePath = "/downloads/" + path.relative(downloadsDir, mainVideo);
    
    // Check if explicitly deleted by user
    if (
      deletedPaths.has(relativePath) || 
      (mainVideo && deletedPaths.has(mainVideo)) || 
      deletedPaths.has(dir) || 
      deletedPaths.has(path.basename(dir))
    ) {
      continue;
    }
    
    const baseMain = path.basename(mainVideo);
    let matchedItem: VideoMetadata | undefined = undefined;

    const isAlreadyPresent = list.some(item => {
      if (item.local_path && path.resolve(item.local_path) === path.resolve(mainVideo)) {
        matchedItem = item;
        return true;
      }
      if (item.s3_url && (item.s3_url.includes(baseMain) || item.s3_url === relativePath)) {
        matchedItem = item;
        return true;
      }
      if (item.stream_url && (item.stream_url.includes(baseMain) || item.stream_url === relativePath)) {
        matchedItem = item;
        return true;
      }
      if (item.s3_key && item.s3_key.includes(baseMain)) {
        matchedItem = item;
        return true;
      }
      return false;
    });

    // If already present but lacks local_path, attach it now
    if (isAlreadyPresent && matchedItem && !(matchedItem as VideoMetadata).local_path) {
      (matchedItem as VideoMetadata).local_path = mainVideo;
      modified = true;
    }

    if (!isAlreadyPresent) {
      // Don't auto-register video files that were created very recently (within 2 minutes) in timestamped pipeline folders (e.g. name_1788762007710),
      // because the pipeline is still in progress (uploading to S3, generating TTS, etc.) and will register its own rich metadata entry!
      const folderName = path.basename(dir);
      const isTimestampedJobDir = /_\d{10,}$/.test(folderName);
      try {
        const fileStat = statSync(mainVideo);
        const fileAgeMs = Date.now() - fileStat.mtimeMs;
        if (isTimestampedJobDir && fileAgeMs < 120000) {
          // Skip premature auto-registration during active pipeline run
          continue;
        }
      } catch {}

      const fileNameStr = path.basename(mainVideo, path.extname(mainVideo));
      
      let cleanTitle = folderName.split("_")[0].replace(/-/g, " ");
      cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);

      // Auto-extract thumbnail
      const thumbFilename = `${fileNameStr}_thumb.jpg`;
      const thumbFullPath = path.join(dir, thumbFilename);
      let thumbUrl = "";
      if (!existsSync(thumbFullPath)) {
        extractVideoThumbnailSync(mainVideo, thumbFullPath);
      }
      if (existsSync(thumbFullPath)) {
        thumbUrl = "/downloads/" + path.relative(downloadsDir, thumbFullPath);
      }

      const stat = statSync(mainVideo);
      const newEntry: VideoMetadata = {
        id: `vid_sync_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        product_name: cleanTitle,
        title: cleanTitle,
        description: `Video ghép từ FFmpeg (${fileNameStr})`,
        tags: ["#affiliate", "#bemeow", "#ffmpeg"],
        source_url: "(concatenated video)",
        s3_url: relativePath,
        local_path: mainVideo,
        thumbnail_url: thumbUrl,
        images: thumbUrl ? [thumbUrl] : [],
        size_bytes: stat.size,
        created_at: stat.mtime.toISOString(),
        updated_at: stat.mtime.toISOString()
      };

      list.unshift(newEntry);
      modified = true;
      console.log(`✨ [SyncMetadata] Auto-registered local video in Kho Video: ${cleanTitle} (${relativePath}) [Thumb: ${thumbUrl || "none"}]`);
    }
  }

  // Backfill missing thumbnails for any existing items
  for (const item of list) {
    if (!item.thumbnail_url || item.thumbnail_url === "") {
      let candidateVideo = item.local_path;
      if (!candidateVideo || !existsSync(candidateVideo)) {
        if (item.s3_url && item.s3_url.startsWith("/downloads/")) {
          candidateVideo = path.join(downloadsDir, item.s3_url.replace(/^\/downloads\//, ""));
        }
      }
      if (candidateVideo && existsSync(candidateVideo)) {
        const itemDir = path.dirname(candidateVideo);
        const itemFileBase = path.basename(candidateVideo, path.extname(candidateVideo));
        const itemThumbPath = path.join(itemDir, `${itemFileBase}_thumb.jpg`);
        if (!existsSync(itemThumbPath)) {
          extractVideoThumbnailSync(candidateVideo, itemThumbPath);
        }
        if (existsSync(itemThumbPath)) {
          const relativeThumb = "/downloads/" + path.relative(downloadsDir, itemThumbPath);
          item.thumbnail_url = relativeThumb;
          if (!item.images || item.images.length === 0) item.images = [relativeThumb];
          modified = true;
          console.log(`🖼️ [SyncMetadata] Auto-extracted thumbnail for: ${item.title} -> ${relativeThumb}`);
        }
      }
    }
  }

  if (modified) {
    await saveMetadata(list);
  }

  return list;
}

async function loadMetadata(): Promise<VideoMetadata[]> {
  await ensureDataDir();
  let list: VideoMetadata[] = [];
  try {
    if (existsSync(METADATA_FILE)) {
      const raw = await fs.readFile(METADATA_FILE, "utf-8");
      list = JSON.parse(raw) as VideoMetadata[];
    }
  } catch {
    list = [];
  }
  return await syncLocalDownloadsToMetadata(list);
}

async function saveMetadata(list: VideoMetadata[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(METADATA_FILE, JSON.stringify(list, null, 2), "utf-8");
}

async function appendMetadata(entry: VideoMetadata): Promise<void> {
  const list = await loadMetadata();
  list.push(entry);
  await saveMetadata(list);
}

// ─── S3 Upload Helper ─────────────────────────────────────────────────────────
async function uploadUrlToS3(
  videoUrl: string,
  s3Key: string
): Promise<{ s3Url: string; sizeBytes: number }> {
  console.log(`⬇️  Downloading video from: ${videoUrl}`);

  const response = await axios.get(videoUrl, {
    responseType: "stream",
    timeout: 300_000, // 5 phút
    headers: { "User-Agent": "affiliate-mcp-server/1.0" },
  });

  const contentLength = parseInt(String(response.headers["content-length"] ?? "0"), 10);
  const contentType = String(response.headers["content-type"] ?? "video/mp4");
  const stream = response.data as Readable;
  stream.on("error", (err) => {
    console.warn(`⚠️ [uploadUrlToS3] Stream error: ${err.message}`);
  });

  console.log(`☁️  Uploading to S3: s3://${S3_BUCKET}/${s3Key} (content-type: ${contentType})`);

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: stream,
      ContentType: contentType,
      // Uncomment below to make files public via ACL (nếu bucket cho phép)
      // ACL: "public-read",
    },
  });

  // Progress tracking
  upload.on("httpUploadProgress", (progress) => {
    if (progress.total) {
      const pct = Math.round(((progress.loaded || 0) / progress.total) * 100);
      process.stdout.write(`\r   Upload progress: ${pct}%`);
    }
  });

  await upload.done();
  process.stdout.write("\n");

  const s3Url = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || "ap-southeast-1"}.amazonaws.com/${s3Key}`;
  console.log(`✅ Uploaded to S3: ${s3Url}`);

  return { s3Url, sizeBytes: contentLength };
}

async function uploadImageToS3(imageUrl: string, prefix: string = "images"): Promise<string> {
  if (!imageUrl || !imageUrl.startsWith("http") || imageUrl.includes(".amazonaws.com/")) return imageUrl;
  if (!S3_BUCKET) return imageUrl;
  
  try {
    const response = await axios.get(imageUrl, {
      responseType: "stream",
      timeout: 5000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      }
    });

    const contentType = String(response.headers["content-type"] ?? "image/jpeg");
    const stream = response.data as Readable;

    const ext = contentType.split("/")[1] || "jpg";
    const filename = `img_${randomUUID().split("-")[0]}.${ext}`;
    const s3Key = `${prefix}/${filename}`;

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: stream,
        ContentType: contentType,
      },
    });

    await upload.done();
    const s3Url = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || "ap-southeast-1"}.amazonaws.com/${s3Key}`;
    console.log(`✅ Image uploaded to S3: ${s3Url}`);
    return s3Url;
  } catch (err: any) {
    console.warn(`⚠️ S3 image upload skipped/failed: ${err.message}. Using original URL.`);
    return imageUrl;
  }
}

// ─── Pre-signed URL Generator ─────────────────────────────────────────────────
// Dùng khi bucket PRIVATE (Block Public Access = ON)
// TikTok hoặc bất kỳ ai cần pull video → dùng URL này (có hạn 1 giờ)
async function generatePresignedUrl(s3Key: string, expiresInSeconds = 3600): Promise<string> {
  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

// ─── TikTok Publish Helper (Mock) ─────────────────────────────────────────────
async function publishToTikTok(params: {
  s3Url: string;
  s3Key?: string;      // Truyền vào để generate pre-signed URL (bucket private)
  title: string;
  tags: string[];
}): Promise<{ tiktokVideoId: string; status: "published" | "mock"; videoUrl: string }> {
  // Nếu có s3Key → generate pre-signed URL (bucket private, bảo mật hơn)
  // Nếu không → dùng trực tiếp s3Url (bucket public)
  let videoUrl = params.s3Url;
  if (params.s3Key && S3_BUCKET) {
    videoUrl = await generatePresignedUrl(params.s3Key);
    console.log(`🔐 Generated pre-signed URL (expires 1h): ${videoUrl.split("?")[0]}?...`);
  }

  if (IS_MOCK_TIKTOK) {
    // Mock mode — log & return fake ID
    console.log("🎭 [TikTok MOCK] Would publish:", {
      title: params.title,
      tags: params.tags,
      videoUrl,
    });
    const fakeId = `mock_tiktok_${randomUUID().split("-")[0]}`;
    return { tiktokVideoId: fakeId, status: "mock", videoUrl };
  }

  // ── Real TikTok Content Posting API (swap thật vào đây) ──
  // Tham khảo: https://developers.tiktok.com/doc/content-posting-api-get-started
  // const tiktokResp = await axios.post(
  //   "https://open.tiktokapis.com/v2/post/publish/video/init/",
  //   { post_info: { title: params.title, privacy_level: "PUBLIC_TO_EVERYONE" },
  //     source_info: { source: "PULL_FROM_URL", video_url: videoUrl } },
  //   { headers: { Authorization: `Bearer ${process.env.TIKTOK_API_KEY}` } }
  // );
  // return { tiktokVideoId: tiktokResp.data.data.publish_id, status: "published", videoUrl };
  throw new Error("Real TikTok API not implemented yet. Set TIKTOK_API_KEY=mock to use mock mode.");
}

// ─── MCP Server Setup ─────────────────────────────────────────────────────────
function createMcpServer() {
  const server = new McpServer({
    name: "affiliate-mcp-server",
    version: "1.0.0",
  });

  // ── Tool 1: upload_video ──────────────────────────────────────────────────────
  server.registerTool(
    "upload_video",
    {
      description:
        "Download a video from a URL (e.g., from Veo or any public URL) and upload it to AWS S3. Returns the S3 URL and file details.",
      inputSchema: {
        video_url: z.string().url().describe("Public URL of the video to download and upload"),
        title: z.string().min(1).describe("Title of the video (used for S3 key naming)"),
        tags: z.array(z.string()).default([]).describe("Tags or hashtags for the video"),
      },
    },
    async ({ video_url, title, tags }) => {
    try {
      if (!S3_BUCKET) {
        return {
          content: [{ type: "text", text: "❌ S3_BUCKET_NAME is not configured in .env" }],
          isError: true,
        };
      }

      // Tạo S3 key từ title + timestamp
      const safeTitle = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 60);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const s3Key = `${S3_PREFIX}${timestamp}_${safeTitle}.mp4`;

      const { s3Url, sizeBytes } = await uploadUrlToS3(video_url, s3Key);

      const result = {
        success: true,
        s3_url: s3Url,
        bucket: S3_BUCKET,
        key: s3Key,
        size_bytes: sizeBytes,
        title,
        tags,
        uploaded_at: new Date().toISOString(),
      };

      console.log("✅ [upload_video] Done:", result);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err: any) {
      const msg = `❌ upload_video failed: ${err.message}`;
      console.error(msg, err);
      return {
        content: [{ type: "text", text: msg }],
        isError: true,
      };
    }
  }
);

// ── Tool 2: save_metadata ─────────────────────────────────────────────────────
  server.registerTool(
  "save_metadata",
  {
    description:
      "Save video metadata (title, tags, S3 URL, source URL) to local JSON storage. Returns the unique video ID.",
    inputSchema: {
      s3_url: z.string().url().describe("S3 URL of the uploaded video"),
      s3_bucket: z.string().default("").describe("S3 bucket name"),
      s3_key: z.string().default("").describe("S3 object key"),
      source_url: z.string().url().describe("Original source URL of the video (e.g., from Veo)"),
      title: z.string().min(1).describe("Title of the video"),
      description: z.string().optional().describe("Optional description of the video"),
      tags: z.array(z.string()).default([]).describe("Tags or hashtags"),
      size_bytes: z.number().default(0).describe("File size in bytes"),
    },
  },
  async ({ s3_url, s3_bucket, s3_key, source_url, title, description, tags, size_bytes }) => {
    try {
      const id = randomUUID();
      const now = new Date().toISOString();

      const entry: VideoMetadata = {
        id,
        title,
        description,
        tags,
        source_url,
        s3_url,
        s3_bucket,
        s3_key,
        size_bytes,
        created_at: now,
        updated_at: now,
      };

      await appendMetadata(entry);

      const result = { success: true, id, saved: true, created_at: now };
      console.log("✅ [save_metadata] Saved:", id, title);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      const msg = `❌ save_metadata failed: ${err.message}`;
      console.error(msg);
      return {
        content: [{ type: "text", text: msg }],
        isError: true,
      };
    }
  }
);

// ── Tool 3: publish_tiktok ────────────────────────────────────────────────────
  server.registerTool(
  "publish_tiktok",
  {
    description:
      "Publish a video to TikTok using its S3 URL. Currently in MOCK mode — set TIKTOK_API_KEY in .env to switch to real API. Also updates the metadata record with TikTok video ID.",
    inputSchema: {
      s3_url: z.string().url().describe("S3 URL of the video to publish"),
      title: z.string().min(1).describe("TikTok post title/caption"),
      tags: z.array(z.string()).default([]).describe("Hashtags for the TikTok post"),
      metadata_id: z
        .string()
        .optional()
        .describe("Optional: ID from save_metadata to update with TikTok info"),
    },
  },
  async ({ s3_url, title, tags, metadata_id }) => {
    try {
      const { tiktokVideoId, status } = await publishToTikTok({ s3Url: s3_url, title, tags });

      // Nếu có metadata_id → update record
      if (metadata_id) {
        const list = await loadMetadata();
        const idx = list.findIndex((v) => v.id === metadata_id);
        if (idx !== -1) {
          list[idx].tiktok_video_id = tiktokVideoId;
          list[idx].tiktok_status = status;
          list[idx].updated_at = new Date().toISOString();
          await saveMetadata(list);
          console.log(`📝 Updated metadata ${metadata_id} with TikTok ID: ${tiktokVideoId}`);
        }
      }

      const result = {
        success: true,
        tiktok_video_id: tiktokVideoId,
        status,
        mode: IS_MOCK_TIKTOK ? "mock" : "real",
        title,
        tags,
        published_at: new Date().toISOString(),
      };

      console.log(`✅ [publish_tiktok] ${status}:`, tiktokVideoId);

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err: any) {
      const msg = `❌ publish_tiktok failed: ${err.message}`;
      console.error(msg);
      return {
        content: [{ type: "text", text: msg }],
        isError: true,
      };
      }
    }
  );

  // ── Tool 4: generate_prompt ───────────────────────────────────────────────────
  server.registerTool(
    "generate_prompt",
    {
      description: "Generate a Veo cinematic prompt using AGY Gemini 3.8 first, with model fallback. Optionally supply a product image to guide the generation style.",
      inputSchema: {
        product_name: z.string().min(1).describe("The affiliate product name"),
        category: z
          .enum(["tech", "beauty", "fashion", "food", "fitness"])
          .default("tech")
          .describe("The product category"),
        product_image_url: z.string().optional().describe("Optional product image URL to guide style and color palette"),
        product_description: z.string().optional().describe("Optional product description to guide prompt details"),
      },
    },
    async ({ product_name, category, product_image_url, product_description }) => {
      try {
        const prompt = await generateVideoPrompt(product_name, category, product_image_url, product_description);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, product_name, category, prompt }, null, 2),
            },
          ],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `❌ generate_prompt failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ── Tool 5: generate_video ────────────────────────────────────────────────────
  server.registerTool(
    "generate_video",
    {
      description:
        "Use Puppeteer to open Gemini Web (with an active Chrome profile logged in to Gemini Advanced) to generate a Veo video from a prompt and download the resulting MP4. Optionally attach a product image to guide the generation.",
      inputSchema: {
        veo_prompt: z.string().min(10).describe("The English Veo cinematic prompt"),
        product_image_url: z.string().optional().describe("Optional S3 proxy or raw product image URL to upload alongside prompt"),
      },
    },
    async ({ veo_prompt, product_image_url }) => {
      try {
        console.log("🎬 [MCP generate_video] Bắt đầu tạo video Veo...");
        const result = await generateVeoVideo(veo_prompt, product_image_url);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: result.success,
                  local_path: result.localPath,
                  video_url: result.videoUrl,
                  duration_ms: result.durationMs,
                  error: result.error,
                },
                null,
                2
              ),
            },
          ],
          isError: !result.success,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `❌ generate_video failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // ── Tool 6: run_full_pipeline ─────────────────────────────────────────────────
  server.registerTool(
    "run_full_pipeline",
    {
      description:
        "Run the complete automated affiliate pipeline for a product: Generate Prompt -> Generate Veo Video -> Upload to S3 -> Save Metadata -> Publish to TikTok.",
      inputSchema: {
        product_id: z.string().optional().describe("Optional product ID from products.json"),
        product_name: z.string().optional().describe("Optional product name (used if product_id is not provided)"),
        category: z
          .enum(["tech", "beauty", "fashion", "food", "fitness"])
          .default("tech")
          .describe("Product category"),
        dry_run: z
          .boolean()
          .default(false)
          .describe("If true, only generates the prompt without generating the video"),
        upload_s3: z.boolean().default(true).describe("Whether to upload the generated video to S3"),
        publish_tiktok: z.boolean().default(true).describe("Whether to publish the video to TikTok"),
      },
    },
    async ({ product_id, product_name, category, dry_run, upload_s3, publish_tiktok }) => {
      try {
        let product;
        if (product_id) {
          const products = await loadProducts();
          product = products.find((p) => p.id === product_id);
          if (!product) throw new Error(`Product not found: ${product_id}`);
        } else if (product_name) {
          product = {
            id: `adhoc_${randomUUID().split("-")[0]}`,
            name: product_name,
            category,
            affiliate_url: "",
            hashtags: [`#${product_name.toLowerCase().replace(/\s+/g, "")}`, "#affiliate"],
            enabled: true,
          };
        } else {
          throw new Error("Phải cung cấp product_id hoặc product_name");
        }

        const result = await runPipelineForProduct(product, {
          dryRun: dry_run,
          uploadToS3: upload_s3,
          publishTikTok: publish_tiktok,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: !result.success,
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `❌ run_full_pipeline failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// ─── Express App ──────────────────────────────────────────────────────────────
const app = express();

// Request logger for debugging Gemini requests
app.use((req, _res, next) => {
  console.log(`🌐 [Gemini Probe] ${req.method} ${req.url} - User-Agent: ${req.headers["user-agent"]}`);
  next();
});

// Strip /affiliate prefix if request arrives with /affiliate/mcp (e.g. from cloudflare tunnel or proxy)
app.use((req, _res, next) => {
  if (req.url.startsWith("/affiliate")) {
    req.url = req.url.replace(/^\/affiliate/, "") || "/";
  }
  next();
});

app.use(
  cors({
    origin: "*",
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    exposedHeaders: ["mcp-session-id"],
  })
);

app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ limit: "500mb", extended: true }));

// Serve Web Dashboard: React app (client/dist) or legacy /public folder
const CLIENT_DIST_DIR = path.resolve(__dirname, "../client/dist");
const PUBLIC_DIR = path.resolve(__dirname, "../public");

// Real-time development support: Proxy UI to Vite dev server (port 5173) if active, else serve client/dist
app.use(async (req, res, next) => {
  if (
    req.path.startsWith("/api") ||
    req.path.startsWith("/downloads") ||
    req.path.startsWith("/health") ||
    req.path.startsWith("/mcp") ||
    req.path.startsWith("/sse")
  ) {
    return next();
  }

  // In development: check if Vite dev server is running on port 5173 for real-time HMR
  // Only proxy to Vite when accessed via localhost — external domains (e.g. Cloudflare Tunnel)
  // must get the production build because Vite HMR WebSocket won't work through the tunnel.
  const hostHeader = req.headers.host || "";
  const isLocalRequest = hostHeader.startsWith("localhost") || hostHeader.startsWith("127.0.0.1");
  if (process.env.NODE_ENV !== "production" && isLocalRequest) {
    try {
      const viteUrl = `http://127.0.0.1:5173${req.originalUrl}`;
      const viteResp = await fetch(viteUrl, {
        method: req.method,
        headers: { ...req.headers, host: "127.0.0.1:5173" } as any,
      });
      if (viteResp.ok || viteResp.status === 304) {
        res.status(viteResp.status);
        viteResp.headers.forEach((val, key) => {
          if (key !== "content-encoding" && key !== "transfer-encoding") {
            res.setHeader(key, val);
          }
        });
        const arrayBuf = await viteResp.arrayBuffer();
        return res.send(Buffer.from(arrayBuf));
      }
    } catch {
      // Vite dev server not running on 5173, continue to static dist
    }
  }

  const clientDistIndex = path.resolve(CLIENT_DIST_DIR, "index.html");
  if (existsSync(clientDistIndex)) {
    return express.static(CLIENT_DIST_DIR, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith(".html") || filePath.endsWith(".js") || filePath.endsWith(".css")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          res.setHeader("Pragma", "no-cache");
          res.setHeader("Expires", "0");
        }
      }
    })(req, res, next);
  }
  return express.static(PUBLIC_DIR)(req, res, next);
});


// Serve downloaded videos directly — stream via /downloads/:file
const DOWNLOADS_DIR_STATIC = path.resolve(__dirname, "../data/downloads");
mkdirSync(DOWNLOADS_DIR_STATIC, { recursive: true });
app.use("/downloads", express.static(DOWNLOADS_DIR_STATIC));

// API: list all downloaded videos (recursively scanning all product folders)
app.get("/api/videos/local", (_req: any, res: any) => {
  try {
    const scanDir = (dir: string, base: string = ""): any[] => {
      let results: any[] = [];
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = base ? `${base}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          results = results.concat(scanDir(fullPath, relPath));
        } else if (entry.isFile() && (entry.name.endsWith(".mp4") || entry.name.endsWith(".webm"))) {
          const stat = statSync(fullPath);
          results.push({
            filename: entry.name,
            rel_path: relPath,
            url: `/downloads/${relPath}`,
            size_mb: (stat.size / 1024 / 1024).toFixed(2),
            created_at: stat.mtime.toISOString(),
          });
        }
      }
      return results;
    };
    const files = scanDir(DOWNLOADS_DIR_STATIC)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    res.json({ success: true, count: files.length, videos: files });
  } catch (err: any) {
    res.json({ success: true, count: 0, videos: [] });
  }
});

// Detailed Request logger for debugging Gemini requests
app.use((req, _res, next) => {
  if (req.url.includes("mcp") || req.url.includes("oauth")) {
    console.log(`📡 [GEMINI INCOMING] ${req.method} ${req.originalUrl || req.url}`);
    console.log(`   Headers:`, JSON.stringify(req.headers));
    if (req.body && Object.keys(req.body).length > 0) {
      console.log(`   Body:`, JSON.stringify(req.body));
    }
  }
  next();
});

// Inject required Accept header for MCP endpoint
app.use("/mcp", (req, _res, next) => {
  req.headers["accept"] = "application/json, text/event-stream";
  const rawIdx = req.rawHeaders.findIndex((h) => h.toLowerCase() === "accept");
  if (rawIdx !== -1) {
    req.rawHeaders[rawIdx + 1] = "application/json, text/event-stream";
  } else {
    req.rawHeaders.push("Accept", "application/json, text/event-stream");
  }
  next();
});

// ── OAuth2 Mock Endpoints (Tắt OAuth để Gemini Spark nhận diện đây là Public MCP Server không cần Client ID/Secret)
// app.get([
//   "/.well-known/oauth-protected-resource",
//   "/.well-known/oauth-protected-resource/affiliate/mcp",
//   "/.well-known/openid-configuration"
// ], (req, res) => { ... });

// ── Health Check ──────────────────────────────────────────────────────────────
app.get("/health", async (_req, res) => {
  const videos = await loadMetadata();
  res.json({
    status: "ok",
    server: "affiliate-mcp-server",
    version: "1.0.0",
    port: PORT,
    tiktok_mode: IS_MOCK_TIKTOK ? "mock" : "real",
    s3_bucket: S3_BUCKET || "(not configured)",
    s3_region: process.env.AWS_REGION || "ap-southeast-1",
    total_videos: videos.length,
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ── REST: List all videos ─────────────────────────────────────────────────────
app.get("/api/videos", async (req: any, res: any) => {
  try {
    const list = await loadMetadata();
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const start = (page - 1) * limit;
    const paginated = list.slice(start, start + limit);

    // Generate pre-signed URL for streaming secure private S3 files + normalize legacy objects
    const dataWithPresigned = await Promise.all(
      paginated.map(async (v: any) => {
        let streamUrl = v.s3_url;
        if (v.s3_key && S3_BUCKET) {
          try {
            streamUrl = await generatePresignedUrl(v.s3_key, 7200); // 2 hours
          } catch (e: any) {
            console.warn(`⚠️ [S3] Failed to generate presigned URL for ${v.s3_key}:`, e.message);
          }
        }
        
        // Normalize old database format compatibility
        return {
          ...v,
          title: v.title || v.product_name || "Untitled",
          description: v.description || v.prompt || "No description available",
          tags: v.tags || (v.category ? [`#${v.category}`] : []),
          stream_url: streamUrl
        };
      })
    );

    res.json({
      success: true,
      data: dataWithPresigned,
      videos: dataWithPresigned,
      total: list.length,
      page,
      limit,
      totalPages: Math.ceil(list.length / limit) || 1,
      has_more: start + limit < list.length,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Get video by ID ─────────────────────────────────────────────────────
app.get("/api/videos/:id", async (req: any, res: any) => {
  try {
    const list = await loadMetadata();
    const video = list.find((v) => v.id === req.params.id) as any;
    if (!video) {
      return res.status(404).json({ success: false, error: "Video not found" });
    }
    let streamUrl = video.s3_url;
    if (video.s3_key && S3_BUCKET) {
      try {
        streamUrl = await generatePresignedUrl(video.s3_key, 7200);
      } catch (e: any) {
        console.warn(`⚠️ [S3] Failed to generate presigned URL for ${video.s3_key}:`, e.message);
      }
    }
    
    // Normalize old format compatibility
    const normalized = {
      ...video,
      title: video.title || video.product_name || "Untitled",
      description: video.description || video.prompt || "No description available",
      tags: video.tags || (video.category ? [`#${video.category}`] : []),
      stream_url: streamUrl
    };
    
    res.json({ success: true, data: normalized });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});



// ── REST: Delete video by ID ──────────────────────────────────────────────────
app.delete("/api/videos/:id", async (req: any, res: any) => {
  try {
    const list = await loadMetadata();
    const idx = list.findIndex((v) => v.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: "Video not found" });
    }
    const [removed] = list.splice(idx, 1);
    await saveMetadata(list);

    // Track as deleted so auto-sync never revives it
    if (removed.s3_url) markVideoPathDeleted(removed.s3_url);
    if (removed.local_path) markVideoPathDeleted(removed.local_path);
    if (removed.stream_url) markVideoPathDeleted(removed.stream_url);

    // Delete local physical video and thumbnail files
    try {
      if (removed.local_path && existsSync(removed.local_path)) {
        unlinkSync(removed.local_path);
        console.log(`🗑️ [DeleteVideo] Removed local file: ${removed.local_path}`);
        const thumbPath = removed.local_path.replace(/\.mp4$/i, "_thumb.jpg");
        if (existsSync(thumbPath)) {
          unlinkSync(thumbPath);
          console.log(`🗑️ [DeleteVideo] Removed thumbnail: ${thumbPath}`);
        }
      }
      if (removed.s3_url && removed.s3_url.startsWith("/downloads/")) {
        const downloadsDir = path.resolve(__dirname, "../data/downloads");
        const fullLocalPath = path.join(downloadsDir, removed.s3_url.replace(/^\/downloads\//, ""));
        if (existsSync(fullLocalPath)) {
          unlinkSync(fullLocalPath);
          console.log(`🗑️ [DeleteVideo] Removed local file: ${fullLocalPath}`);
          const thumbPath = fullLocalPath.replace(/\.mp4$/i, "_thumb.jpg");
          if (existsSync(thumbPath)) unlinkSync(thumbPath);
        }
      }
    } catch (cleanErr: any) {
      console.warn(`⚠️ [DeleteVideo] Error removing physical files: ${cleanErr.message}`);
    }

    res.json({ success: true, deleted: removed.id, title: removed.title });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Update video details by ID ──────────────────────────────────────────
app.put("/api/videos/:id", async (req: any, res: any) => {

  try {
    const { title, description, tags, images, thumbnail_url } = req.body;
    const list = await loadMetadata();
    const idx = list.findIndex((v) => v.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: "Video not found" });
    }
    
    if (title !== undefined) list[idx].title = title;
    if (description !== undefined) list[idx].description = description;
    if (req.body.caption !== undefined) list[idx].caption = req.body.caption;
    if (req.body.description_vi !== undefined) list[idx].description_vi = req.body.description_vi;
    if (tags !== undefined) list[idx].tags = tags;
    if (images !== undefined) list[idx].images = images;
    if (thumbnail_url !== undefined) list[idx].thumbnail_url = thumbnail_url;
    
    list[idx].updated_at = new Date().toISOString();
    
    await saveMetadata(list);
    res.json({ success: true, data: list[idx] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Generate/Regenerate Vietnamese caption using Gemini API ────────────
app.post("/api/pipeline/generate-caption", async (req: any, res: any) => {
  try {
    const { productName, category, imageUrl } = req.body;
    if (!productName) {
      return res.status(400).json({ success: false, error: "Missing productName" });
    }
    console.log(`🤖 [CaptionGen] Regenerating caption for: "${productName}" (${category || "tech"})`);
    const caption = await generateVideoDescriptionVi(productName, category || "tech", imageUrl);
    res.json({ success: true, caption });
  } catch (err: any) {
    console.error(`❌ [CaptionGen] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Upload Video (Base64 dataUrl -> Local Disk / S3) ──────────────────
app.post("/api/upload/video", async (req: any, res: any) => {
  try {
    const { dataUrl, filename } = req.body;
    if (!dataUrl || typeof dataUrl !== "string") {
      return res.status(400).json({ success: false, error: "Missing dataUrl" });
    }

    const match = dataUrl.match(/^data:(video\/[a-zA-Z0-9\+\-]+);base64,(.+)$/);
    let buffer: Buffer;
    let ext = "mp4";

    if (match) {
      const mimeType = match[1];
      ext = mimeType.split("/")[1] || "mp4";
      if (ext === "quicktime") ext = "mov";
      buffer = Buffer.from(match[2], "base64");
    } else {
      buffer = Buffer.from(dataUrl, "base64");
    }

    const nameWithoutExt = (filename || "uploaded").replace(/\.[^/.]+$/, "");
    const safeName = nameWithoutExt
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .slice(0, 30);
    const uniqueFilename = `uploaded_vid_${Date.now()}_${safeName}.${ext}`;
    const downloadsDir = path.resolve(__dirname, "../data/downloads");
    await fs.mkdir(downloadsDir, { recursive: true });
    const localPath = path.join(downloadsDir, uniqueFilename);
    await fs.writeFile(localPath, buffer);
    const localUrl = `/downloads/${uniqueFilename}`;

    console.log(`✅ [UploadVideo] Saved video locally: ${localUrl}`);
    return res.json({ 
      success: true, 
      url: localUrl, 
      local_path: localPath, 
      filename: uniqueFilename,
      title: filename ? filename.replace(/\.[^/.]+$/, "") : "Uploaded Video"
    });
  } catch (err: any) {
    console.error(`❌ [UploadVideo] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Concatenate multiple videos into a single video ───────────────────
app.post("/api/videos/concat", async (req: any, res: any) => {
  try {
    const { video_ids, video_paths, video_urls, title } = req.body;
    const pathsInput = (Array.isArray(video_paths) && video_paths.length >= 2)
      ? video_paths
      : (Array.isArray(video_urls) && video_urls.length >= 2)
      ? video_urls
      : null;
    const videoPaths: string[] = [];
    const list = await loadMetadata();
    const downloadsDir = path.resolve(__dirname, "../data/downloads");
    mkdirSync(downloadsDir, { recursive: true });

    if (pathsInput) {
      for (const p of pathsInput) {
        let resolvedPath = p;

        if (p.startsWith("http://") || p.startsWith("https://")) {
          // Download remote/s3 video to local temp file
          try {
            const tempFile = path.join(downloadsDir, `temp_concat_${Date.now()}_${randomUUID().slice(0, 6)}.mp4`);
            const response = await axios.get(p, { responseType: "arraybuffer", timeout: 60000 });
            await fs.writeFile(tempFile, Buffer.from(response.data));
            resolvedPath = tempFile;
          } catch (dlErr: any) {
            console.error(`[Concat] Failed to download URL ${p}:`, dlErr.message);
            return res.status(400).json({ success: false, error: `Failed to download video: ${dlErr.message}` });
          }
        } else if (p.startsWith("/downloads/")) {
          resolvedPath = path.resolve(__dirname, "..", p.replace(/^\//, ""));
        }
        
        // Fallback check if path has double extension or missing extension or relative filename
        if (!existsSync(resolvedPath)) {
          const basename = path.basename(p);
          const candidate1 = path.join(downloadsDir, basename);
          const candidate2 = path.join(downloadsDir, basename.replace(/\.mp4\.mp4$/, ".mp4"));
          const candidate3 = path.join(downloadsDir, basename.replace(/_mp4\.mp4$/, ".mp4"));

          if (existsSync(candidate1)) resolvedPath = candidate1;
          else if (existsSync(candidate2)) resolvedPath = candidate2;
          else if (existsSync(candidate3)) resolvedPath = candidate3;
          else {
            // Search directory for matching file prefix
            const allFiles = readdirSync(downloadsDir);
            const matched = allFiles.find(f => f.includes(basename.slice(0, 20)));
            if (matched) {
              resolvedPath = path.join(downloadsDir, matched);
            } else {
              return res.status(404).json({ success: false, error: `File not found: ${p}` });
            }
          }
        }
        videoPaths.push(resolvedPath);
      }
    } else if (Array.isArray(video_ids) && video_ids.length >= 2) {
      for (const id of video_ids) {
        const v = list.find((item: any) => item.id === id);
        if (!v) {
          return res.status(404).json({ success: false, error: `Video with ID ${id} not found` });
        }

        let resolvedPath = v.local_path;
        if (!resolvedPath || !existsSync(resolvedPath)) {
          if (v.stream_url && v.stream_url.startsWith("/downloads/")) {
            resolvedPath = path.resolve(__dirname, "..", v.stream_url.replace(/^\//, ""));
          } else if (v.s3_key) {
            const downloadsDir = path.resolve(__dirname, "../data/downloads");
            mkdirSync(downloadsDir, { recursive: true });
            const tempFile = path.join(downloadsDir, `temp_concat_${Date.now()}_${randomUUID().slice(0, 6)}.mp4`);
            const streamUrl = await generatePresignedUrl(v.s3_key, 3600);
            const response = await axios.get(streamUrl, { responseType: "arraybuffer" });
            await fs.writeFile(tempFile, Buffer.from(response.data));
            resolvedPath = tempFile;
          }
        }

        if (!resolvedPath || !existsSync(resolvedPath)) {
          return res.status(404).json({ success: false, error: `Local file for video "${v.title || id}" not found` });
        }

        videoPaths.push(resolvedPath);
      }
    } else {
      return res.status(400).json({ success: false, error: "Must provide at least 2 videos to concatenate" });
    }

    const finalTitle = title || `Stitched Story (${videoPaths.length} videos)`;
    const safeTitle = finalTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30);
    mkdirSync(downloadsDir, { recursive: true });
    const outputFilename = `stitched_${Date.now()}_${safeTitle}.mp4`;
    const outputPath = path.join(downloadsDir, outputFilename);

    console.log(`🎬 [Concat] Merging ${videoPaths.length} videos into ${outputPath}...`);
    await concatenateVideos(videoPaths, outputPath);

    // Upload to S3 if bucket is configured
    let s3Url = `/downloads/${outputFilename}`;
    let s3Key = "";
    if (S3_BUCKET) {
      try {
        const fileStream = await fs.readFile(outputPath);
        s3Key = `videos/${outputFilename}`;
        const upload = new Upload({
          client: s3Client,
          params: {
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: fileStream,
            ContentType: "video/mp4",
          },
        });
        await upload.done();
        s3Url = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || "ap-southeast-1"}.amazonaws.com/${s3Key}`;
        console.log(`✅ [Concat] Uploaded concatenated video to S3: ${s3Url}`);
      } catch (s3Err: any) {
        console.warn(`⚠️ [Concat] S3 upload failed, using local stream URL: ${s3Err.message}`);
      }
    }

    const firstVideo = list.find((v: any) => video_ids && v.id === video_ids[0]);

    const newVideo: VideoMetadata = {
      id: `vid_concat_${randomUUID().split("-")[0]}`,
      product_name: finalTitle,
      title: finalTitle,
      prompt: `Concatenated video stitched from ${videoPaths.length} clips`,
      description: `Chuỗi video được nối liền từ ${videoPaths.length} phân cảnh.`,
      tags: ["#affiliate", "#stitched", "#fullvideo"],
      s3_url: s3Url,
      s3_key: s3Key,
      local_path: outputPath,
      thumbnail_url: firstVideo?.thumbnail_url || "",
      images: firstVideo?.images || [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    list.unshift(newVideo);
    await saveMetadata(list);

    res.json({ success: true, video: newVideo });
  } catch (err: any) {
    console.error(`❌ [Concat] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Character Registry Endpoints ─────────────────────────────────────
app.get("/api/characters", async (req: any, res: any) => {
  try {
    const list = await loadCharacters();
    res.json({ success: true, data: Object.values(list) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/characters", async (req: any, res: any) => {
  try {
    const character = req.body;
    if (!character.id || !character.name) {
      return res.status(400).json({ success: false, error: "Character id and name are required" });
    }
    const updated = await upsertCharacter(character);
    res.json({ success: true, character: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/characters/:id", async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const ok = await deleteCharacter(id);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Analyze Video Dialogue Timestamps & Sync Character Voices ───────
app.post("/api/pipeline/analyze-voice-sync", async (req: any, res: any) => {
  try {
    const { video_id, video_path, script } = req.body;
    const list = await loadMetadata();
    let resolvedPath = video_path;

    if (!resolvedPath && video_id) {
      const v = list.find((item: any) => item.id === video_id);
      if (v) {
        resolvedPath = v.local_path;
        if (!resolvedPath || !existsSync(resolvedPath)) {
          if (v.stream_url && v.stream_url.startsWith("/downloads/")) {
            resolvedPath = path.resolve(__dirname, "..", v.stream_url.replace(/^\//, ""));
          }
        }
      }
    }

    if (resolvedPath && resolvedPath.startsWith("/downloads/")) {
      resolvedPath = path.resolve(__dirname, "..", resolvedPath.replace(/^\//, ""));
    }

    if (!resolvedPath || !existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, error: "Target video file not found on disk" });
    }

    const charactersObj = await loadCharacters();
    const knownCharIds = Object.keys(charactersObj);

    // 1. Analyze timestamps using Gemini 2.5
    console.log(`🤖 [VoiceSync] Step 1: Analyzing dialogue timestamps for ${path.basename(resolvedPath)}...`);
    const analysis = await analyzeVideoDialogueTimestamps(resolvedPath, script, knownCharIds);

    // 2. Synthesize audio per segment with character voice consistency
    console.log(`🎙️ [VoiceSync] Step 2: Synthesizing ${analysis.segments.length} character audio clips...`);
    const audioSegments = await generateMultiVoiceDialogueAudio(analysis.segments);

    // 3. Mux timestamped audio onto video
    const outputFilename = `voiced_sync_${Date.now()}_${path.basename(resolvedPath)}`;
    const downloadsDir = path.resolve(__dirname, "../data/downloads");
    mkdirSync(downloadsDir, { recursive: true });
    const outputPath = path.join(downloadsDir, outputFilename);

    console.log(`🎬 [VoiceSync] Step 3: Muxing audio clips onto video...`);
    await muxTimestampedAudioSegments(resolvedPath, audioSegments, outputPath);

    // 4. Clean intermediate audio files
    for (const seg of audioSegments) {
      try { await fs.unlink(seg.audio_path); } catch {}
    }

    // 5. Upload to S3 if configured
    let s3Url = `/downloads/${outputFilename}`;
    let s3Key = "";
    if (S3_BUCKET) {
      try {
        const fileStream = await fs.readFile(outputPath);
        s3Key = `videos/${outputFilename}`;
        const upload = new Upload({
          client: s3Client,
          params: {
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: fileStream,
            ContentType: "video/mp4",
          },
        });
        await upload.done();
        s3Url = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || "ap-southeast-1"}.amazonaws.com/${s3Key}`;
      } catch (s3Err: any) {
        console.warn(`⚠️ [VoiceSync] S3 upload failed: ${s3Err.message}`);
      }
    }

    // Extract thumbnail for voiced video
    const thumbFilename = `${path.basename(outputPath, ".mp4")}_thumb.jpg`;
    const thumbPath = path.join(downloadsDir, thumbFilename);
    let voicedThumbUrl = "";
    if (extractVideoThumbnailSync(outputPath, thumbPath)) {
      voicedThumbUrl = `/downloads/${thumbFilename}`;
    }

    const newVideo: VideoMetadata = {
      id: `vid_voiced_${randomUUID().split("-")[0]}`,
      product_name: "Voiced Video (Gemini + ElevenLabs Sync)",
      title: `Voiced Sync - ${path.basename(resolvedPath, ".mp4")}`,
      prompt: `Video synchronized with fixed character voice IDs and Gemini timestamps`,
      description: `Video đã được tự động phân tích mốc thời gian và lồng giọng chuẩn từng nhân vật.`,
      tags: ["#affiliate", "#voiced", "#voicesync", "#elevenlabs"],
      s3_url: s3Url,
      s3_key: s3Key,
      local_path: outputPath,
      thumbnail_url: voicedThumbUrl,
      images: voicedThumbUrl ? [voicedThumbUrl] : [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    list.unshift(newVideo);
    await saveMetadata(list);

    res.json({
      success: true,
      analysis,
      video: newVideo
    });
  } catch (err: any) {
    console.error(`❌ [VoiceSync] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Manual Trim Start of Video (Cut initial freeze-frame & Re-upload to S3) ──
app.post("/api/videos/trim-start", async (req: any, res: any) => {
  try {
    const { video_id, video_url, local_path } = req.body;
    const trimSeconds = Math.max(0.1, Math.min(30, parseFloat(req.body.trim_seconds) || 0.6));
    console.log(`✂️  [TrimStart] Requested trim of ${trimSeconds}s for video:`, { video_id, video_url, local_path });

    const list = await loadMetadata();
    let targetVideo: VideoMetadata | undefined = undefined;
    if (video_id) {
      targetVideo = list.find((v) => v.id === video_id);
    }

    const downloadsDir = path.resolve(__dirname, "../data/downloads");
    let resolvedPath: string | null = null;

    // 1. Try local_path from request
    if (local_path && existsSync(local_path)) {
      resolvedPath = local_path;
    }

    // 2. Try targetVideo.local_path
    if (!resolvedPath && targetVideo?.local_path && existsSync(targetVideo.local_path)) {
      resolvedPath = targetVideo.local_path;
    }

    // 3. Try to locate by filename in downloadsDir (including subdirectories)
    const candidateUrls = [video_url, targetVideo?.s3_url, targetVideo?.stream_url].filter(Boolean) as string[];
    if (!resolvedPath && candidateUrls.length > 0) {
      for (const rawUrl of candidateUrls) {
        let cleanUrl = rawUrl.split("?")[0];
        const base = path.basename(cleanUrl);
        if (base && base.endsWith(".mp4")) {
          // Check direct downloadsDir
          const direct = path.join(downloadsDir, base);
          if (existsSync(direct)) {
            resolvedPath = direct;
            break;
          }
          // Search recursively in downloadsDir
          const findRecursive = (dir: string): string | null => {
            if (!existsSync(dir)) return null;
            const entries = readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) {
                const found = findRecursive(full);
                if (found) return found;
              } else if (entry.name === base) {
                return full;
              }
            }
            return null;
          };
          const found = findRecursive(downloadsDir);
          if (found) {
            resolvedPath = found;
            break;
          }
        }
      }
    }

    // 4. If still not found locally but we have a remote URL, download it temporarily
    if (!resolvedPath && candidateUrls.length > 0) {
      const fetchUrl = candidateUrls.find((u) => u.startsWith("http://") || u.startsWith("https://"));
      if (fetchUrl) {
        console.log(`📥 [TrimStart] Downloading video from ${fetchUrl} for trimming...`);
        const base = path.basename(fetchUrl.split("?")[0]) || `downloaded_trim_${Date.now()}.mp4`;
        const tempLocal = path.join(downloadsDir, base);
        const resp = await axios.get(fetchUrl, { responseType: "arraybuffer", timeout: 30000 });
        writeFileSync(tempLocal, Buffer.from(resp.data));
        if (existsSync(tempLocal)) {
          resolvedPath = tempLocal;
        }
      }
    }

    if (!resolvedPath || !existsSync(resolvedPath)) {
      return res.status(404).json({
        success: false,
        error: "Không tìm thấy file video trên hệ thống để thực hiện cắt."
      });
    }

    console.log(`✂️  [TrimStart] Executing FFmpeg trim on: ${resolvedPath} (cutting first ${trimSeconds}s)...`);
    const ffmpeg = getFfmpegCmd();
    const tempTrimmed = resolvedPath.replace(/\.mp4$/, `_trimtemp_${Date.now()}.mp4`);

    // Execute FFmpeg trim
    execSync(
      `"${ffmpeg}" -y -ss ${trimSeconds} -i "${resolvedPath}" -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart "${tempTrimmed}"`,
      { stdio: "ignore" }
    );

    if (!existsSync(tempTrimmed) || statSync(tempTrimmed).size < 1000) {
      throw new Error("FFmpeg trim failed: output file is invalid or too small");
    }

    // Replace original file with trimmed version
    renameSync(tempTrimmed, resolvedPath);
    console.log(`✅ [TrimStart] Replaced original video with trimmed file: ${resolvedPath}`);

    // Update thumbnail frame
    const thumbFilename = `${path.basename(resolvedPath, ".mp4")}_thumb.jpg`;
    const thumbPath = path.join(path.dirname(resolvedPath), thumbFilename);
    let newThumbUrl = targetVideo?.thumbnail_url || "";
    if (extractVideoThumbnailSync(resolvedPath, thumbPath)) {
      newThumbUrl = "/downloads/" + path.relative(downloadsDir, thumbPath);
    }

    // Re-upload to S3 if configured
    let s3Url = targetVideo?.s3_url || `/downloads/${path.relative(downloadsDir, resolvedPath)}`;
    let s3Key = targetVideo?.s3_key || "";
    if (S3_BUCKET) {
      try {
        console.log(`☁️  [TrimStart] Re-uploading trimmed video to S3...`);
        const fileBuffer = readFileSync(resolvedPath);
        if (!s3Key) {
          s3Key = `videos/${path.basename(resolvedPath)}`;
        }
        const upload = new Upload({
          client: s3Client,
          params: {
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: fileBuffer,
            ContentType: "video/mp4",
          },
        });
        await upload.done();
        s3Url = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || "ap-southeast-1"}.amazonaws.com/${s3Key}`;
        console.log(`✅ [TrimStart] Uploaded trimmed video to S3: ${s3Url}`);

        // Upload thumbnail to S3 as well
        if (existsSync(thumbPath)) {
          const thumbBuffer = readFileSync(thumbPath);
          const s3ThumbKey = `videos/${path.basename(thumbPath)}`;
          const thumbUpload = new Upload({
            client: s3Client,
            params: {
              Bucket: S3_BUCKET,
              Key: s3ThumbKey,
              Body: thumbBuffer,
              ContentType: "image/jpeg",
            },
          });
          await thumbUpload.done();
          newThumbUrl = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || "ap-southeast-1"}.amazonaws.com/${s3ThumbKey}`;
        }
      } catch (s3Err: any) {
        console.warn(`⚠️ [TrimStart] S3 re-upload failed: ${s3Err.message}`);
      }
    }

    // Update database entry in metadata.json
    const newStat = statSync(resolvedPath);
    if (targetVideo) {
      targetVideo.size_bytes = newStat.size;
      targetVideo.updated_at = new Date().toISOString();
      targetVideo.local_path = resolvedPath;
      targetVideo.s3_url = s3Url;
      targetVideo.s3_key = s3Key;
      if (newThumbUrl) {
        targetVideo.thumbnail_url = newThumbUrl;
        if (!targetVideo.images || targetVideo.images.length === 0) {
          targetVideo.images = [newThumbUrl];
        }
      }
      await saveMetadata(list);
    }

    // Generate fresh presigned URL for playback if using S3
    let streamUrl = s3Url;
    if (s3Key && S3_BUCKET) {
      try {
        streamUrl = await generatePresignedUrl(s3Key, 7200);
      } catch {}
    }
    // Append timestamp for cache-busting
    const separator = streamUrl.includes("?") ? "&" : "?";
    streamUrl = `${streamUrl}${separator}t=${Date.now()}`;

    res.json({
      success: true,
      message: `Đã cắt ${trimSeconds}s đầu video và cập nhật lên S3 thành công!`,
      trim_seconds: trimSeconds,
      video: {
        ...(targetVideo || {}),
        id: targetVideo?.id || video_id,
        stream_url: streamUrl,
        s3_url: s3Url,
        thumbnail_url: newThumbUrl,
        size_bytes: newStat.size
      }
    });
  } catch (err: any) {
    console.error(`❌ [TrimStart] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/products", async (req: any, res: any) => {
  try {
    const products = await loadProducts();
    // Sort strictly by created_at descending (newest first)
    products.sort((a: any, b: any) => {
      const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tB - tA;
    });

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const start = (page - 1) * limit;
    const paginated = products.slice(start, start + limit);
    res.json({
      success: true,
      data: paginated,
      products: paginated,
      total: products.length,
      page,
      limit,
      totalPages: Math.ceil(products.length / limit) || 1,
      has_more: start + limit < products.length
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/products", async (req: any, res: any) => {
  try {
    const { name, category = "tech", affiliate_url = "", hashtags = [], image_url = "", description = "", images = [] } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "name is required" });

    // Upload main thumbnail image to S3 (non-blocking fallback)
    let finalImageUrl = image_url;
    if (image_url && !image_url.includes(".amazonaws.com/")) {
      finalImageUrl = await uploadImageToS3(image_url).catch(() => image_url);
    }

    // Upload gallery images to S3 in parallel safely
    let finalImagesList: string[] = [];
    if (Array.isArray(images) && images.length > 0) {
      finalImagesList = await Promise.all(
        images.map((img: string) => (img ? uploadImageToS3(img).catch(() => img) : Promise.resolve("")))
      ).then((res) => res.filter(Boolean));
    }

    const DATA_FILE = path.resolve(__dirname, "../data/products.json");
    let products = [];
    if (existsSync(DATA_FILE)) {
      const raw = await fs.readFile(DATA_FILE, "utf-8");
      products = JSON.parse(raw);
    }

    const nowIso = new Date().toISOString();
    const newProduct = {
      id: `prod_${randomUUID().split("-")[0]}`,
      name,
      category,
      affiliate_url,
      hashtags,
      image_url: finalImageUrl,
      images: finalImagesList.length > 0 ? finalImagesList : (finalImageUrl ? [finalImageUrl] : []),
      description,
      enabled: true,
      created_at: req.body.created_at || nowIso,
      updated_at: nowIso,
      promptsObj: req.body.promptsObj || undefined,
      scene_images: req.body.scene_images || undefined,
      scene_urls: req.body.scene_urls || undefined,
      consensus_feedback: req.body.consensus_feedback || undefined,
      debate_messages: req.body.debate_messages || undefined,
      part_feedback: req.body.part_feedback || undefined,
    };
    products.unshift(newProduct);
    await fs.writeFile(DATA_FILE, JSON.stringify(products, null, 2), "utf-8");
    res.json({ success: true, data: newProduct });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Cập nhật sản phẩm ───────────────────────────────────────────────────
app.put("/api/products/:id", async (req: any, res: any) => {
  try {
    const {
      name, category, affiliate_url, hashtags, enabled, image_url, description,
      images, promptsObj, scene_images, scene_urls, consensus_feedback,
      debate_messages, part_feedback
    } = req.body;
    const DATA_FILE = path.resolve(__dirname, "../data/products.json");
    if (!existsSync(DATA_FILE)) {
      return res.status(404).json({ success: false, error: "Products file not found" });
    }
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const products = JSON.parse(raw) as any[];
    const idx = products.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }
    
    // Update fields if provided
    products[idx].updated_at = new Date().toISOString();
    if (!products[idx].created_at) {
      products[idx].created_at = products[idx].updated_at;
    }
    if (name !== undefined) products[idx].name = name;
    if (category !== undefined) products[idx].category = category;
    if (affiliate_url !== undefined) products[idx].affiliate_url = affiliate_url;
    if (hashtags !== undefined) products[idx].hashtags = hashtags;
    if (enabled !== undefined) products[idx].enabled = enabled;
    if (description !== undefined) products[idx].description = description;
    if (promptsObj !== undefined) products[idx].promptsObj = promptsObj;
    if (scene_images !== undefined) products[idx].scene_images = scene_images;
    if (scene_urls !== undefined) products[idx].scene_urls = scene_urls;
    if (consensus_feedback !== undefined) products[idx].consensus_feedback = consensus_feedback;
    if (debate_messages !== undefined) products[idx].debate_messages = debate_messages;
    if (part_feedback !== undefined) products[idx].part_feedback = part_feedback;

    if (image_url !== undefined) {
      let finalImageUrl = image_url;
      if (image_url && !image_url.includes(".amazonaws.com/")) {
        finalImageUrl = await uploadImageToS3(image_url);
      }
      products[idx].image_url = finalImageUrl;
    }

    if (images !== undefined && Array.isArray(images)) {
      const finalImagesList: string[] = [];
      for (const img of images) {
        if (img) {
          const uploaded = await uploadImageToS3(img);
          finalImagesList.push(uploaded);
        }
      }
      products[idx].images = finalImagesList;
    }

    await fs.writeFile(DATA_FILE, JSON.stringify(products, null, 2), "utf-8");
    res.json({ success: true, data: products[idx] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Xóa sản phẩm ────────────────────────────────────────────────────────
app.delete("/api/products/:id", async (req: any, res: any) => {
  try {
    const DATA_FILE = path.resolve(__dirname, "../data/products.json");
    if (!existsSync(DATA_FILE)) {
      return res.status(404).json({ success: false, error: "Products file not found" });
    }
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    const products = JSON.parse(raw) as any[];
    const filtered = products.filter((p) => p.id !== req.params.id);
    
    if (products.length === filtered.length) {
      return res.status(404).json({ success: false, error: "Product not found" });
    }

    await fs.writeFile(DATA_FILE, JSON.stringify(filtered, null, 2), "utf-8");
    res.json({ success: true, message: "Product deleted successfully" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Upload Image (Base64 dataUrl -> S3 or local disk fallback) ─────────
app.post("/api/upload/image", async (req: any, res: any) => {
  try {
    const { dataUrl, filename } = req.body;
    if (!dataUrl || typeof dataUrl !== "string") {
      return res.status(400).json({ success: false, error: "Missing dataUrl" });
    }

    const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9\+\-]+);base64,(.+)$/);
    let buffer: Buffer;
    let mimeType = "image/jpeg";
    let ext = "jpg";

    if (match) {
      mimeType = match[1];
      ext = mimeType.split("/")[1] || "jpg";
      if (ext === "jpeg") ext = "jpg";
      buffer = Buffer.from(match[2], "base64");
    } else {
      buffer = Buffer.from(dataUrl, "base64");
    }

    const safeName = (filename || "uploaded")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .slice(0, 30);
    const uniqueFilename = `img_${Date.now()}_${safeName}.${ext}`;

    if (S3_BUCKET) {
      try {
        const s3Key = `images/${uniqueFilename}`;
        const upload = new Upload({
          client: s3Client,
          params: {
            Bucket: S3_BUCKET,
            Key: s3Key,
            Body: buffer,
            ContentType: mimeType,
          },
        });
        await upload.done();
        const s3Url = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || "ap-southeast-1"}.amazonaws.com/${s3Key}`;
        console.log(`✅ [UploadImage] Uploaded to S3: ${s3Url}`);
        return res.json({ success: true, url: s3Url });
      } catch (s3Err: any) {
        console.warn(`⚠️ [UploadImage] S3 upload failed (${s3Err.message}), falling back to local storage.`);
      }
    }

    const localDir = path.resolve(__dirname, "../data/downloads");
    await fs.mkdir(localDir, { recursive: true });
    const localPath = path.join(localDir, uniqueFilename);
    await fs.writeFile(localPath, buffer);
    const localUrl = `/downloads/${uniqueFilename}`;
    console.log(`✅ [UploadImage] Saved locally: ${localUrl}`);
    return res.json({ success: true, url: localUrl });
  } catch (err: any) {
    console.error(`❌ [UploadImage] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});


function extractShopeeIds(url: string) {
  let match = url.match(/[iI]\.(\d+)\.(\d+)/);
  if (match) {
    return { shopId: match[1], itemId: match[2] };
  }
  match = url.match(/product\/(\d+)\/(\d+)/);
  if (match) {
    return { shopId: match[1], itemId: match[2] };
  }
  return null;
}

function extractProductNameFromUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    let pathname = decodeURIComponent(url.pathname);
    const shopeeMatch = pathname.match(/^\/([^\/]+)-i\.\d+\.\d+/);
    if (shopeeMatch) {
      return shopeeMatch[1].replace(/-/g, " ").trim();
    }
    const lazadaMatch = pathname.match(/^\/products\/([^\/-]+)/);
    if (lazadaMatch) {
      return lazadaMatch[1].replace(/-/g, " ").trim();
    }
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length > 0) {
      const last = parts[parts.length - 1];
      const clean = last.split(".")[0].replace(/-i\.\d+\.\d+/, "").replace(/-/g, " ").trim();
      if (clean.length > 3) return clean;
    }
  } catch {}
  return "";
}

function nativeHttp2Get(apiUrlStr: string, cookieStr: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(apiUrlStr);
      const client = http2.connect(parsed.origin);

      const req = client.request({
        ":path": parsed.pathname + parsed.search,
        ":method": "GET",
        "cookie": cookieStr,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "accept": "application/json",
        "referer": "https://shopee.vn/",
        "x-requested-with": "XMLHttpRequest"
      });

      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
      });

      req.on("end", () => {
        client.close();
        resolve(data);
      });

      req.on("error", (err) => {
        client.close();
        reject(err);
      });

      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

// ── REST: Universal Product Crawler (Shopee, Lazada, TikTok, Tiki, etc.) ───────
app.post("/api/crawl/product", async (req: any, res: any) => {
  let { url } = req.body;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ success: false, error: "Missing URL" });
  }

  // Clean Shopee URL to strip query parameters that force login redirects
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname.includes("shopee.vn")) {
      parsedUrl.searchParams.delete("is_from_login");
      url = parsedUrl.toString();
    }
  } catch {}

  let browser: any = null;
  let page: any = null;
  let connected = false;
  let tempProfileDir: string | null = null;
  try {
    console.log(`🕷️  Universal crawl: ${url}`);
    
    // Auto-launch ChromeAuto with remote debugging if not already running (exactly like veoAutomation does!)
    try {
      await ensureChromeRunning();
    } catch (chromeErr: any) {
      console.warn(`⚠️ [Crawl] Failed to ensure Chrome running: ${chromeErr.message}`);
    }

    let raw: any = null;
    const shopeeIds = extractShopeeIds(url);

    // Grab Shopee cookies from the user's running Chrome window on port 9222
    let grabbedCookies: any[] = [];
    try {
      const debugPort = process.env.CHROME_DEBUG_PORT || "9222";
      const debugUrl = `http://127.0.0.1:${debugPort}/json/version`;
      const checkRes = await fetch(debugUrl).catch(() => null);
      if (checkRes && checkRes.ok) {
        console.log(`🔗 [Crawl] Grabbing active cookies from Chrome port ${debugPort}...`);
        
        // Wrap everything in a 4-second timeout to prevent server hang
        await Promise.race([
          (async () => {
            const tempBrowser = await puppeteer.connect({
              browserURL: `http://127.0.0.1:${debugPort}`,
            });
            const page = await tempBrowser.newPage();
            try {
              const client = await page.target().createCDPSession();
              const { cookies } = await client.send("Network.getAllCookies");
              grabbedCookies = cookies
                .filter((c: any) => c.domain.includes("shopee.vn"))
                .map((c: any) => ({
                  name: c.name,
                  value: c.value,
                  domain: c.domain,
                  path: c.path,
                  expires: c.expires,
                  httpOnly: c.httpOnly,
                  secure: c.secure,
                  sameSite: c.sameSite as any,
                }));
              console.log(`✅ [Crawl] Grabbed ${grabbedCookies.length} Shopee cookies successfully!`);
            } finally {
              await page.close().catch(() => {});
              await tempBrowser.disconnect().catch(() => {});
            }
          })(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout grabbing cookies")), 4000))
        ]);
      }
    } catch (cookieErr: any) {
      console.warn(`⚠️ [Crawl] Failed to grab active cookies: ${cookieErr.message}`);
    }

    // Strategy 0: Direct Native HTTP/2 API fetch (using grabbed active session cookies!)
    if (shopeeIds) {
      const { shopId, itemId } = shopeeIds;
      const apiUrl = `https://shopee.vn/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`;
      console.log(`📡 [Crawl] Attempting direct Native HTTP/2 API fetch with active cookies: ${apiUrl}`);
      
      const cookieHeader = grabbedCookies.map(c => `${c.name}=${c.value}`).join("; ");
      if (cookieHeader) {
        try {
          const rawJson = await nativeHttp2Get(apiUrl, cookieHeader);
          const apiRes = JSON.parse(rawJson);
          if (apiRes && apiRes.data && apiRes.data.name) {
            const item = apiRes.data;
            const priceMin = item.price_min || item.price || 0;
            const displayPrice = priceMin > 0 ? (priceMin / 100000).toLocaleString("vi-VN") + " ₫" : "";
            raw = {
              name: item.name,
              price: displayPrice,
              rating: item.item_rating?.rating_star ? item.item_rating.rating_star.toFixed(1) : "",
              ratingCount: item.item_rating?.rating_count ? item.item_rating.rating_count.reduce((a: number, b: number) => a + b, 0).toString() : "",
              description: item.description || "",
              images: (item.images || []).map((img: string) => `https://down-vn.img.susercontent.com/file/${img}`),
              breadcrumb: item.categories?.map((c: any) => c.display_name).join(" > ") || "",
              url: url,
              jsonldFound: true
            };
            console.log(`✅ [Crawl] Direct HTTP/2 API fetch SUCCEEDED! Title: "${raw.name}"`);
          } else {
            console.warn(`⚠️ [Crawl] Direct HTTP/2 API returned error status: ${apiRes.error || rawJson.slice(0, 200)}`);
          }
        } catch (apiErr: any) {
          console.warn(`⚠️ [Crawl] Direct HTTP/2 API fetch failed: ${apiErr.message}`);
        }
      } else {
        console.log(`⚠️ [Crawl] No active cookies available for direct HTTP/2 API fetch.`);
      }
    }

    if (!raw) {
      console.log("🔄 [Crawl] Falling back to background Puppeteer scraper...");
      const DATA_DIR = path.resolve(__dirname, "../data");
      tempProfileDir = path.resolve(DATA_DIR, `crawler_profile_temp_${Date.now()}`);
      
      const debugPort = process.env.CHROME_DEBUG_PORT || "9222";
      const debugUrl = `http://127.0.0.1:${debugPort}/json/version`;
      const checkRes = await fetch(debugUrl).catch(() => null);

      if (checkRes && checkRes.ok) {
        console.log(`🔗 [Crawl] Connecting to existing Chrome on port ${debugPort}...`);
        browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${debugPort}`,
          defaultViewport: null,
        });
        connected = true;
      } else {
        console.log("🔄 [Crawl] Existing Chrome not running. Launching new background Chrome...");
        browser = await puppeteer.launch({
          headless: true, // Run headless so it is completely invisible!
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-blink-features=AutomationControlled",
            "--disable-web-security",
            "--lang=vi-VN,vi",
            "--window-size=1440,900",
            "--disable-backgrounding-occluded-windows", // Prevents Chrome from freezing off-screen windows
            "--disable-renderer-backgrounding",
            "--disable-background-timer-throttling",
            "--disable-features=CalculatePageVisibilityState", // Forces page to remain active/visible off-screen
            `--user-data-dir=${tempProfileDir}`,
          ],
        });
        connected = false;
      }

      page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });

      if (grabbedCookies && grabbedCookies.length > 0) {
        await page.setCookie(...grabbedCookies);
      }

      // Rotate through realistic user agents (Chrome only)
      const userAgents = [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
      ];
      await page.setUserAgent(userAgents[Math.floor(Math.random() * userAgents.length)]);
      await page.setExtraHTTPHeaders({
        "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "upgrade-insecure-requests": "1",
      });

      // Stealth: hide automation fingerprints
      await page.evaluateOnNewDocument(`(function() {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
        window.chrome = { runtime: {} };
      })()`);

      console.log(`🌐 [Crawl] Navigating to product page: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });

      // Update shopeeIds based on the redirected URL (crucial for short URLs like shope.ee)
      const currentUrl = page.url();
      const activeShopeeIds = extractShopeeIds(currentUrl) || shopeeIds;

      // Strategy 2: Browser-context API fetch inside product page context (inherits session & cookies)
      if (activeShopeeIds) {
        const { shopId, itemId } = activeShopeeIds;
        try {
          console.log(`📡 [Crawl] Attempting browser-context API fetch on shopee.vn (shopId: ${shopId}, itemId: ${itemId})...`);
          const apiResult = await page.evaluate(async (sId: any, iId: any) => {
            try {
              const res = await fetch(`/api/v4/item/get?itemid=${iId}&shopid=${sId}`);
              if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
              const json = await res.json();
              return { success: true, data: json.data };
            } catch (err: any) {
              return { success: false, error: err.message };
            }
          }, shopId, itemId);

          if (apiResult.success && apiResult.data && apiResult.data.name) {
            const item = apiResult.data;
            const priceMin = item.price_min || item.price || 0;
            const displayPrice = priceMin > 0 ? (priceMin / 100000).toLocaleString("vi-VN") + " ₫" : "";
            raw = {
              name: item.name,
              price: displayPrice,
              rating: item.item_rating?.rating_star ? item.item_rating.rating_star.toFixed(1) : "",
              ratingCount: item.item_rating?.rating_count ? item.item_rating.rating_count.reduce((a: number, b: number) => a + b, 0).toString() : "",
              description: item.description || "",
              images: (item.images || []).map((img: string) => `https://down-vn.img.susercontent.com/file/${img}`),
              breadcrumb: item.categories?.map((c: any) => c.display_name).join(" > ") || "",
              url: url,
              jsonldFound: true
            };
            console.log(`✅ [Crawl] Browser-context Shopee API fetch SUCCEEDED! Title: "${raw.name}", images: ${raw.images.length}`);
          } else {
            console.warn(`⚠️ [Crawl] Browser-context API fetch returned error: ${apiResult.error}`);
          }
        } catch (apiErr: any) {
          console.warn(`⚠️ [Crawl] Browser-context API fetch failed: ${apiErr.message}`);
        }
      }

      if (!raw) {
        console.log("🔄 [Crawl] API fetch failed, falling back to standard DOM scraping...");
        // Wait 4s for React to hydrate
        await new Promise((r) => setTimeout(r, 4000));

        // Scroll through full page to trigger lazy-loaded content (description, gallery)
        await page.evaluate(`
          (function() {
            var total = document.body.scrollHeight;
            var step = Math.floor(total / 6);
            var pos = 0;
            var tid = setInterval(function() {
              pos += step;
              window.scrollTo(0, pos);
              if (pos >= total) { clearInterval(tid); window.scrollTo(0, 0); }
            }, 300);
          })()
        `);
        await new Promise((r) => setTimeout(r, 2500));

        const pageTitle = await page.title();
        console.log(`📄 Page: "${pageTitle}" | host: ${new URL(url).hostname}`);

    // ── Universal 4-layer extraction (as string to avoid esbuild __name) ─────
    raw = await page.evaluate(`(function() {

      // ═══ LAYER 0: Window global state (Shopee/Lazada/TikTok embed full data here) ═══
      var windowData = {};
      try {
        // Deep search helper to find product details inside window variables
        function searchObj(obj, maxDepth) {
          if (!obj || maxDepth <= 0) return null;
          if (typeof obj !== 'object') return null;
          
          var hasDesc = (obj.description || obj.desc) && (obj.name || obj.title || obj.productName || obj.displayName);
          var hasImgs = obj.images || obj.image || obj.imgList || obj.imageUrls || obj.productImages;
          
          if (hasDesc && hasImgs && typeof (obj.description || obj.desc) === 'string' && (obj.description || obj.desc).length > 150) {
            return obj;
          }
          
          for (var k in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, k)) {
              if (k === 'window' || k === 'document' || k === 'parent' || k === 'top' || k === 'location' || k === 'navigator' || k === 'router') continue;
              try {
                var found = searchObj(obj[k], maxDepth - 1);
                if (found) return found;
              } catch(e) {}
            }
          }
          return null;
        }

        var globals = [
          window.__next_data__, 
          window.pageStateData, 
          window.__NEXT_DATA__, 
          window.__INITIAL_STATE__, 
          window.pageData, 
          window.__tikiData__,
          window._state,
          window.state
        ];
        for (var g = 0; g < globals.length; g++) {
          if (globals[g]) {
            var res = searchObj(globals[g], 5);
            if (res) { windowData = res; break; }
          }
        }
      } catch(e) {}

      // Helper: extract Shopee CDN images from image hash array
      function shopeeImgUrl(hash) {
        if (!hash) return '';
        if (hash.indexOf('http') === 0) return hash;
        return 'https://down-vn.img.susercontent.com/file/' + hash;
      }

      // ═══ LAYER 1: JSON-LD Structured Data (most precise — Google Product schema) ═══
      var jsonld = {};
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var s = 0; s < scripts.length; s++) {
        try {
          var parsed = JSON.parse(scripts[s].textContent);
          var items = Array.isArray(parsed['@graph']) ? parsed['@graph'] : [parsed];
          for (var item of items) {
            if (item['@type'] === 'Product' || item['@type'] === 'ItemPage') {
              jsonld = item;
              break;
            }
          }
          if (jsonld['@type']) break;
        } catch(e) {}
      }

      function fromJsonLd(key) {
        return (jsonld[key] || '').toString().trim();
      }
      function jsonLdPrice() {
        var offers = jsonld.offers || {};
        if (Array.isArray(offers)) offers = offers[0] || {};
        return (offers.price || offers.lowPrice || '').toString();
      }
      function jsonLdImages() {
        var imgs = jsonld.image || [];
        if (typeof imgs === 'string') imgs = [imgs];
        return imgs.slice(0, 4);
      }
      function jsonLdRating() {
        var r = jsonld.aggregateRating || {};
        return (r.ratingValue || '').toString();
      }
      function jsonLdRatingCount() {
        var r = jsonld.aggregateRating || {};
        return (r.reviewCount || r.ratingCount || '').toString();
      }

      // ═══ LAYER 2: Open Graph / Twitter Card meta tags (universal, server-rendered) ═══
      function getMeta(prop) {
        var el = document.querySelector(
          'meta[property="' + prop + '"], meta[name="' + prop + '"]'
        );
        return el ? (el.getAttribute('content') || '').trim() : '';
      }
      function getAllMeta(prop) {
        var els = document.querySelectorAll('meta[property="' + prop + '"]');
        var result = [];
        for (var i = 0; i < els.length; i++) {
          var c = els[i].getAttribute('content') || '';
          if (c) result.push(c);
        }
        return result;
      }

      // ═══ LAYER 3: DOM selectors (universal + common patterns) ═══
      function getText(sel) {
        var el = document.querySelector(sel);
        return el ? (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
      }
      function getAttr(sel, attr) {
        var el = document.querySelector(sel);
        return el ? (el.getAttribute(attr) || '').trim() : '';
      }
      function firstText() {
        for (var i = 0; i < arguments.length; i++) {
          var v = getText(arguments[i]);
          if (v) return v;
        }
        return '';
      }

      // ═══ LAYER 4: Heading-relative scraper (obfuscation fallback) ═══
      function findDescriptionByHeadingText() {
        var specText = '';
        var descText = '';
        try {
          var headings = document.querySelectorAll('h2, h3, h4, h5, div, span, p');
          for (var i = 0; i < headings.length; i++) {
            var txt = (headings[i].textContent || '').trim().toLowerCase();
            if (txt === 'mô tả sản phẩm' || txt === 'product description' || txt === 'mô tả') {
              var el = headings[i];
              for (var depth = 0; depth < 4; depth++) {
                if (!el) break;
                var sibling = el.nextElementSibling;
                while (sibling) {
                  var sibTxt = (sibling.innerText || sibling.textContent || '').trim();
                  if (sibTxt.length > 100) {
                    descText = sibling.innerText || sibling.textContent;
                    break;
                  }
                  sibling = sibling.nextElementSibling;
                }
                if (descText) break;
                el = el.parentElement;
              }
            } else if (txt === 'chi tiết sản phẩm' || txt === 'thông tin sản phẩm' || txt === 'thông số kỹ thuật') {
              var el = headings[i];
              for (var depth = 0; depth < 4; depth++) {
                if (!el) break;
                var sibling = el.nextElementSibling;
                while (sibling) {
                  var sibTxt = (sibling.innerText || sibling.textContent || '').trim();
                  if (sibTxt.length > 50) {
                    specText = sibling.innerText || sibling.textContent;
                    break;
                  }
                  sibling = sibling.nextElementSibling;
                }
                if (specText) break;
                el = el.parentElement;
              }
            }
          }
        } catch(e) {}
        
        if (descText && specText) {
          return specText + '\\n\\n' + descText;
        }
        return descText || specText || '';
      }


      // ── NAME ─────────────────────────────────────────────────────────────────
      var name =
        fromJsonLd('name') ||
        windowData.name ||
        windowData.displayName ||
        windowData.productName ||
        getMeta('og:title') ||
        getMeta('twitter:title') ||
        firstText('h1', '[data-testid="pdp-product-title"]', '[class*="product-title"]',
          '[class*="pdp-header"] h1', '[class*="product-briefing"] [class*="name"]',
          '[class*="item-title"]', '[class*="title--wrap"]', '.product-name') ||
        document.title.replace(/[-|–].*(Shopee|Lazada|Tiki|Sendo|TikTok).*$/i, '').trim() ||
        document.title;

      // ── PRICE ─────────────────────────────────────────────────────────────────
      var price =
        jsonLdPrice() ||
        windowData.price ||
        getMeta('product:price:amount') ||
        getMeta('og:price:amount') ||
        firstText('[class*="product-price__current"]', '[class*="pdp-price"]',
          '[class*="price--current"]', '[class*="flash-sale-price"]', '[class*="sale-price"]',
          '[class*="discountPrice"]', '[data-testid="pdp-product-price"]',
          '[class*="prc-"]', '.product-price-value', '[class*="price-container"]');

      // ── RATING ─────────────────────────────────────────────────────────────────
      var rating =
        jsonLdRating() ||
        windowData.rating ||
        getAttr('[itemprop="ratingValue"]', 'content') ||
        firstText('[class*="product-rating__label"]', '[class*="shopee-rating"]',
          '[class*="rating__stars"]', '[class*="pdp-review-summary__rating"]',
          '[class*="rate-"]', '.rating-score');

      var ratingCount =
        jsonLdRatingCount() ||
        windowData.ratingCount ||
        getAttr('[itemprop="reviewCount"]', 'content') ||
        firstText('[class*="product-rating__count"]', '[class*="rating__count"]',
          '[class*="pdp-review-summary__count"]', '[class*="review-count"]');

      // ── DESCRIPTION ─────────────────────────────────────────────────────────────
      var windowDesc = windowData.description || windowData.desc || (windowData.item && (windowData.item.description || windowData.item.desc)) || '';
      var headingDesc = findDescriptionByHeadingText();
      var description = (
        windowDesc ||
        headingDesc ||
        fromJsonLd('description') ||
        firstText('[class*="product-description"]', '[class*="pdp-product-desc"]',
          '[class*="item-detail"]', '[class*="description--detail"]',
          '[data-testid="pdp-product-description"]', '.product-description',
          '[class*="desc--content"]', '[class*="qNEd3A"]') ||
        getMeta('og:description') ||
        getMeta('description') ||
        getMeta('twitter:description')
      );
      if (description) description = description.trim().slice(0, 4000);

      // ── IMAGES ─────────────────────────────────────────────────────────────────
      var seen = {};
      var imgs = [];

      function addImg(src) {
        if (imgs.length >= 10 || !src) return;
        // Normalize protocol-relative and domain-relative URLs
        if (src.indexOf('//') === 0) {
          src = 'https:' + src;
        } else if (src.indexOf('/') === 0) {
          src = window.location.origin + src;
        }
        var clean = src
          .replace(/_\\d{2,4}x\\d{2,4}(\\.(jpg|png|webp))/gi, '$1')
          .replace(/\\.(jpg|png|webp)_\\d+.*$/i, '.$1')
          .split('?')[0];
        if (!clean || clean.length < 10) clean = src.split('?')[0];
        if (!seen[clean] && clean.indexOf('http') === 0 &&
            clean.indexOf('/icon') === -1 && clean.indexOf('avatar') === -1 &&
            clean.indexOf('.gif') === -1 && clean.indexOf('/logo') === -1 &&
            clean.indexOf('banner') === -1) {
          seen[clean] = true;
          imgs.push(clean);
        }
      }

      // Window state images
      var wImgs = windowData.images || windowData.image || (windowData.item && (windowData.item.images || windowData.item.image)) || [];
      if (typeof wImgs === 'string') wImgs = [wImgs];
      for (var wi = 0; wi < wImgs.length; wi++) {
        var wImg = wImgs[wi];
        if (typeof wImg === 'string') addImg(shopeeImgUrl(wImg));
        else if (wImg && wImg.url) addImg(wImg.url);
        else if (wImg && wImg.image_url) addImg(wImg.image_url);
      }

      // JSON-LD images
      var jImgs = jsonLdImages();
      for (var ji = 0; ji < jImgs.length; ji++) addImg(jImgs[ji]);

      // OG images
      var ogImgs = getAllMeta('og:image');
      for (var oi = 0; oi < ogImgs.length; oi++) addImg(ogImgs[oi]);

      // DOM images & background-images
      var domImgs = document.querySelectorAll('img, [style*="background-image"], [style*="background"], [class*="carousel"] div');
      for (var di = 0; di < domImgs.length; di++) {
        var el = domImgs[di];
        var s = '';
        if (el.tagName === 'IMG') {
          s = el.src || el.getAttribute('data-src') || el.getAttribute('data-lazy-src') || el.getAttribute('data-original') || '';
        } else {
          var bg = el.style.backgroundImage || el.getAttribute('style') || '';
          if (bg.indexOf('url(') > -1) {
            var start = bg.indexOf('url(') + 4;
            var end = bg.indexOf(')', start);
            if (end > start) {
              var srcUrl = bg.substring(start, end).replace(/['"]/g, '').trim();
              if (srcUrl.indexOf('http') === 0) s = srcUrl;
            }
          }
        }
        if (s && s.indexOf('data:') !== 0) addImg(s);
      }

      // ── BREADCRUMB ─────────────────────────────────────────────────────────────
      var breadcrumb =
        firstText('[class*="breadcrumb"]', 'nav[aria-label*="bread"]', '.breadcrumb', '[class*="crumb"]') ||
        document.title;

      return {
        name: name,
        price: price,
        rating: rating,
        ratingCount: ratingCount,
        description: description,
        images: imgs,
        breadcrumb: breadcrumb,
        url: window.location.href,
        jsonldFound: !!jsonld['@type']
      };
    })()`);

      // Debug: save page content & screenshot to help inspect why selectors or state might be missing
      try {
        const DATA_DIR = path.resolve(__dirname, "../data");
        const htmlContent = await page.content();
        await fs.writeFile(path.join(DATA_DIR, "crawled_page.html"), htmlContent, "utf-8");
        await page.screenshot({ path: path.join(DATA_DIR, "crawled_screenshot.png") });
        console.log(`📸 Debug files saved: /data/crawled_page.html & /data/crawled_screenshot.png`);
      } catch (debugErr: any) {
        console.warn("⚠️ Failed to save debug files:", debugErr.message);
      }
    }

    if (browser) {
      if (connected) {
        if (page) await page.close().catch(() => {});
        browser.disconnect();
      } else {
        await browser.close().catch(() => {});
        // Clean up temp profile dir to avoid disk pollution
        try {
          if (tempProfileDir && existsSync(tempProfileDir)) {
            rmSync(tempProfileDir, { recursive: true, force: true });
          }
        } catch {}
      }
      browser = null;
    }
    } // Closes outer if (!raw) block

    if (raw && (
      raw.name.includes("Shopee Việt Nam") || 
      raw.name.includes("Shopee Vietnam") || 
      raw.name.includes("Login Required") ||
      raw.name === "Shopee"
    )) {
      console.warn(`⚠️  [Crawl] Scraped title "${raw.name}" indicates a blocked state. Forcing fallback.`);
      raw = null;
    }

    if (!raw || !raw.name || raw.name.trim().length === 0) {
      const fallbackName = extractProductNameFromUrl(url);
      if (fallbackName && !/^\d+$/.test(fallbackName)) {
        raw = {
          name: fallbackName,
          price: "",
          rating: "",
          ratingCount: "",
          description: "",
          images: [],
          breadcrumb: "",
          url: url,
          jsonldFound: false
        };
        console.log(`⚠️  [Crawl] Crawling blocked. Using URL slug fallback name: "${fallbackName}"`);
      } else {
        raw = {
          name: "Sản phẩm Shopee",
          price: "",
          rating: "",
          ratingCount: "",
          description: "",
          images: [],
          breadcrumb: "",
          url: url,
          jsonldFound: false
        };
        console.log(`⚠️  [Crawl] Crawling blocked and no name slug in URL. Using generic name.`);
      }
    }

    const hostname = new URL(url).hostname.replace("www.", "");
    console.log(`✅ [${hostname}] name="${raw.name}" price="${raw.price}" imgs=${raw.images?.length} jsonld=${raw.jsonldFound}`);

    // ── Auto-detect category ─────────────────────────────────────────────────
    const detectCategory = (text: string): string => {
      const t = text.toLowerCase();
      
      // 1. Tech
      if (/điện thoại|laptop|máy tính|keyboard|bàn phím|chuột máy tính|headphone|tai nghe|cáp sạc|dây cáp|củ sạc|dock sạc|sạc dự phòng|\btech\b|gaming|iphone|samsung|camera|đồng hồ thông minh/i.test(t)) {
        return "tech";
      }
      // 2. Beauty
      if (/kem dưỡng|dưỡng da|mỹ phẩm|son môi|serum|toner|skincare|nước hoa|chăm sóc da|chăm sóc răng|chăm sóc cơ thể|tắm|gội|kem đánh răng|beauty|collagen|mặt nạ/i.test(t)) {
        return "beauty";
      }
      // 3. Fashion
      if (/áo|quần|váy|giày|túi xách|ví da|thời trang|fashion|phụ kiện thời trang|dép|sandal|sneaker/i.test(t)) {
        return "fashion";
      }
      // 4. Food
      if (/thực phẩm|bánh kẹo|snack|cafe|cà phê|trà sữa|đồ uống|gạo|mì gói|nước ngọt|ăn vặt|kẹo|milo|cacao|socola|chocolate|hạt|sữa|bánh/i.test(t)) {
        return "food";
      }
      // 5. Fitness
      if (/phòng gym|thể thao|fitness|sport|yoga|chạy bộ|xe đạp thể thao|dụng cụ tập/i.test(t)) {
        return "fitness";
      }
      
      return "tech"; // default fallback
    };

    const combined = `${raw.breadcrumb} ${raw.name} ${raw.description}`;
    const category = detectCategory(combined);

    // ── Gemini AI rewrite (Structured JSON Mode to extract caption + dynamic hashtags) ──
    let aiDescription = "";
    let hashtags: string[] = [];
    const GEMINI_API_KEY = process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.GEMINI_API_KEY || "";

    if (GEMINI_API_KEY && raw.name) {
      try {
        const systemPrompt = `You are a professional Vietnamese affiliate marketing copywriter and editor.
Your task is to take the scraped product description and rewrite it into a highly professional, well-formatted, and persuasive presentation.

CRITICAL RULES:
1. DO NOT summarize, compress, or omit any unique specifications, variants, or features. You must preserve ALL relevant information from the original description:
   - All unique variants, lines, models, or options.
   - All unique technologies, active ingredients, formulas, benefits, and specifications.
   - Complete step-by-step usage directions and safety warnings.
   - Product details such as origin, expiry date, manufacturer, and weight.
2. DETECT AND STRIP SEO TAG CLOUDS: Scraped descriptions from Shopee/Lazada often contain a massive block of search tags or keyword lists at the bottom or top (e.g. repetitive lists of tags/keywords like 'kem đánh răng trắng răng', 'kem danh rang trang rang', 'làm trắng răng', 'closeup kem đánh răng', etc. written continuously without sentence structure). You MUST completely DELETE this block of keyword clouds. Do not rewrite them, do not format them, just delete them entirely from the final caption.
3. REWRITE the text to make it read smoothly, sound professional, and look clean. Use professional formatting:
   - Use vibrant emojis to demarcate sections.
   - Use bold markdown titles for sections.
   - Keep paragraph structures clean with blank line separators.
   - Make it look premium, structured, and high-converting.
4. The output MUST be a JSON object matching this exact schema:
{
  "caption": "The rewritten full product description in Vietnamese (with all unique details and sections preserved, duplicate spam and SEO keyword lists completely removed).",
  "hashtags": ["An array of 3-8 relevant lowercase, alphanumeric-only hashtags starting with #, dynamically generated based on the brand, name, variant terms, and specific product benefits."]
}
5. IF the product description is empty or missing, you MUST write a highly detailed, persuasive product review description from scratch in Vietnamese based only on the name, brand, and category, describing its potential benefits, flavor/features, and appeal.

Hashtags Rules (Extremely Strict):
- Max count: Generate exactly 3 to 8 hashtags. Do not exceed 8.
- Format: Must be lowercase, alphanumeric-only (letters and numbers), starting with '#'. Absolutely no spaces, hyphens, periods, or special characters.
- Specificity & Relevance: Keep hashtags 100% relevant to the product. DO NOT generate general lifestyle, viral, or unrelated tags (e.g. do not output #trending, #xuhuong, #hot, #reviewsanpham, #sanphamhot, #unboxing).
- First 2-3 tags must be the brand name and product line (e.g. #closeup, #whitenow).
- Category & Benefit: Next 2-3 tags must be the category and primary benefit (e.g. #kemdanhrang, #lamtrangrang).
- Accent Handling: For key Vietnamese words (like làm trắng răng or chăm sóc da), include both the standard accented version and the diacritics-free version (e.g. #trangrang and #trắngrăng).
- Clean up: Never output pure numbers (e.g. #100), weight/volume units (e.g. #100g, #50ml), platform names (e.g. #shopee, #lazada), or generic empty tags (e.g. #beauty, #tech, #skincare, #lamde) unless they are highly specific to the product (e.g. #skincare is OK for face serum, but NOT for toothpaste).`;

        const userMsg = `Platform: ${hostname}
Product: "${raw.name}"
Price: ${raw.price || "chưa rõ"}
Rating: ${raw.rating || "N/A"} (${raw.ratingCount || ""} đánh giá)
Full description:
${raw.description.slice(0, 2500)}

Write a comprehensive Vietnamese affiliate caption and generate dynamic hashtags:`;

        const resText = await callBedrock(systemPrompt, userMsg, undefined, true);
        let text = resText.trim();
        // Strip potential markdown backticks just in case
        if (text.startsWith("```")) {
          text = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        }

        try {
          const parsed = JSON.parse(text);
          aiDescription = parsed.caption || "";
          if (Array.isArray(parsed.hashtags)) {
            hashtags = parsed.hashtags.map((h: string) => {
              let clean = h.trim().toLowerCase();
              // Strip special characters, keeping only alphanumeric and standard accented Vietnamese characters
              clean = clean.replace(/[^a-z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi, "");
              // Exclude pure numbers or weights like 100g, 50ml
              const isSpam = /^\d+$/g.test(clean) || /^\d+(g|ml|kg|cm|mm|oz|pcs|v)$/i.test(clean);
              if (clean && !isSpam) {
                return "#" + clean;
              }
              return "";
            }).filter(Boolean);
          }
        } catch (jsonErr) {
          console.warn("⚠️ Failed to parse structured JSON from Bedrock, fallback to text:", text);
          aiDescription = text;
        }
      } catch (e: any) {
        console.warn("⚠️ Gemini rewrite failed:", e.message);
      }
    }

    // Dynamic fallback if Gemini failed or returned no hashtags
    if (hashtags.length === 0) {
      const tagsSet = new Set<string>();
      const nameLower = raw.name.toLowerCase();

      // 1. Extract words from product name (removing accents for standard lowercase tags)
      const removeAccents = (str: string): string => {
        return str.normalize("NFD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/đ/g, "d")
                  .replace(/Đ/g, "D");
      };

      const words = nameLower.split(/[\s,\-\|_\/\+]+/).map((w: string) => w.trim()).filter(Boolean);
      const stopWords = new Set(["cho", "cua", "voi", "nhu", "va", "nhung", "chinh", "hang", "tot", "nhat", "sieu", "hot", "gia", "re", "mua", "ban", "new", "pro", "max", "full", "size"]);

      words.forEach((w: string) => {
        const clean = removeAccents(w).replace(/[^a-z0-9]/g, '');
        const isSpam = /^\d+$/g.test(clean) || /^\d+(g|ml|kg|cm|mm|oz|pcs|v)$/i.test(clean);
        if (clean.length >= 3 && !stopWords.has(clean) && !isSpam) {
          tagsSet.add("#" + clean);
        }
      });
      
      const specificTags = Array.from(tagsSet).slice(0, 5);
      
      // 2. Category fallback tags
      const fallbackMap: Record<string, string[]> = {
        tech:    ["#tech", "#congnghe", "#thietbicongnghe", "#phukientech"],
        beauty:  ["#beauty", "#skincare", "#lamdep", "#chamsocda", "#mypham"],
        fashion: ["#fashion", "#thoitrang", "#ootd", "#style", "#outfit"],
        food:    ["#food", "#amthuc", "#anngon", "#anvat"],
        fitness: ["#fitness", "#thethao", "#gym", "#suckhoe"],
      };
      
      const catTags = fallbackMap[category] || fallbackMap.tech;
      hashtags = [...new Set([...specificTags, ...catTags])].slice(0, 8);
    }

    res.json({
      success: true,
      data: {
        name:           raw.name,
        price:          raw.price,
        rating:         raw.rating,
        ratingCount:    raw.ratingCount,
        category,
        images:         raw.images,
        rawDescription: raw.description.slice(0, 2000),
        aiDescription,
        hashtags,
        sourceUrl:      url,
        platform:       hostname,
      },
    });
  } catch (err: any) {
    if (browser) {
      try {
        if (connected) {
          if (page) await page.close().catch(() => {});
          browser.disconnect();
        } else {
          await browser.close();
        }
      } catch {}
    }
    console.error("❌ Crawl error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── REST: Regenerate crawl description and hashtags using Gemini AI ─────────
app.post("/api/crawl/regenerate-description", async (req: any, res: any) => {
  try {
    const { name, rawDescription, price, rating, ratingCount, platform } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: "Missing product name" });
    }

    const GEMINI_API_KEY = process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.GEMINI_API_KEY || "";
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ success: false, error: "GEMINI_API_KEY/AWS_BEARER_TOKEN_BEDROCK not configured" });
    }

    console.log(`🤖 [CrawlRegen] Regenerating AI description for: "${name}"`);

    const systemPrompt = `You are a professional Vietnamese affiliate marketing copywriter and editor.
Your task is to take the scraped product description and rewrite it into a highly professional, well-formatted, and persuasive presentation.

CRITICAL RULES:
1. DO NOT summarize, compress, or omit any unique specifications, variants, or features. You must preserve ALL relevant information from the original description:
   - All unique variants, lines, models, or options.
   - All unique technologies, active ingredients, formulas, benefits, and specifications.
   - Complete step-by-step usage directions and safety warnings.
   - Product details such as origin, expiry date, manufacturer, and weight.
2. DETECT AND STRIP SEO TAG CLOUDS: Scraped descriptions from Shopee/Lazada often contain a massive block of search tags or keyword lists at the bottom or top (e.g. repetitive lists of tags/keywords like 'kem đánh răng trắng răng', 'kem danh rang trang rang', 'làm trắng răng', 'closeup kem đánh răng', etc. written continuously without sentence structure). You MUST completely DELETE this block of keyword clouds. Do not rewrite them, do not format them, just delete them entirely from the final caption.
3. REWRITE the text to make it read smoothly, sound professional, and look clean. Use professional formatting:
   - Use vibrant emojis to demarcate sections.
   - Use bold markdown titles for sections.
   - Keep paragraph structures clean with blank line separators.
   - Make it look premium, structured, and high-converting.
4. The output MUST be a JSON object matching this exact schema:
{
  "caption": "The rewritten full product description in Vietnamese (with all unique details and sections preserved, duplicate spam and SEO keyword lists completely removed).",
  "hashtags": ["An array of 3-8 relevant lowercase, alphanumeric-only hashtags starting with #, dynamically generated based on the brand, name, variant terms, and specific product benefits."]
}

Hashtags Rules (Extremely Strict):
- Max count: Generate exactly 3 to 8 hashtags. Do not exceed 8.
- Format: Must be lowercase, alphanumeric-only (letters and numbers), starting with '#'. Absolutely no spaces, hyphens, periods, or special characters.
- Specificity & Relevance: Keep hashtags 100% relevant to the product. DO NOT generate general lifestyle, viral, or unrelated tags (e.g. do not output #trending, #xuhuong, #hot, #reviewsanpham, #sanphamhot, #unboxing).
- First 2-3 tags must be the brand name and product line (e.g. #closeup, #whitenow).
- Category & Benefit: Next 2-3 tags must be the category and primary benefit (e.g. #kemdanhrang, #lamtrangrang).
- Accent Handling: For key Vietnamese words (like làm trắng răng or chăm sóc da), include both the standard accented version and the diacritics-free version (e.g. #trangrang and #trắngrăng).
- Clean up: Never output pure numbers (e.g. #100), weight/volume units (e.g. #100g, #50ml), platform names (e.g. #shopee, #lazada), or generic empty tags (e.g. #beauty, #tech, #skincare, #lamde) unless they are highly specific to the product (e.g. #skincare is OK for face serum, but NOT for toothpaste).`;

    const userMsg = `Platform: ${platform || "shopee.vn"}
Product: "${name}"
Price: ${price || "chưa rõ"}
Rating: ${rating || "N/A"} (${ratingCount || ""} đánh giá)
Full description:
${(rawDescription || "").slice(0, 2500)}

Write a comprehensive Vietnamese affiliate caption and generate dynamic hashtags:`;

    const resText = await callBedrock(systemPrompt, userMsg, undefined, true);
    let text = resText.trim();
    if (text.startsWith("```")) {
      text = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    let aiDescription = "";
    let hashtags: string[] = [];
    try {
      const parsed = JSON.parse(text);
      aiDescription = parsed.caption || "";
      if (Array.isArray(parsed.hashtags)) {
        hashtags = parsed.hashtags.map((h: string) => {
          let clean = h.trim().toLowerCase();
          clean = clean.replace(/[^a-z0-9àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi, "");
          const isSpam = /^\d+$/g.test(clean) || /^\d+(g|ml|kg|cm|mm|oz|pcs|v)$/i.test(clean);
          if (clean && !isSpam) {
            return "#" + clean;
          }
          return "";
        }).filter(Boolean);
      }
    } catch (jsonErr) {
      aiDescription = text;
    }

    res.json({ success: true, aiDescription, hashtags });
  } catch (err: any) {
    console.error(`❌ [CrawlRegen] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── REST: Upload image to S3 (accepts base64 dataUrl via JSON) ───────────────
app.post("/api/upload/image", async (req: any, res: any) => {
  try {
    const { dataUrl, filename = "image.jpg" } = req.body;
    if (!dataUrl || !dataUrl.startsWith("data:")) {
      return res.status(400).json({ success: false, error: "Missing or invalid dataUrl" });
    }

    // Parse data URL: data:<mime>;base64,<data>
    const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ success: false, error: "Invalid dataUrl format" });
    }
    const mimeType = matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, "base64");

    if (buffer.byteLength > 10 * 1024 * 1024) {
      return res.status(400).json({ success: false, error: "Image too large (max 10MB)" });
    }

    const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
    const s3Key = `images/${Date.now()}_${randomUUID().split("-")[0]}.${ext}`;

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: buffer,
        ContentType: mimeType,
      },
    });
    await upload.done();

    const imageUrl = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || "us-east-1"}.amazonaws.com/${s3Key}`;
    console.log(`🖼️ Image uploaded to S3: ${imageUrl}`);

    res.json({ success: true, url: imageUrl, key: s3Key });
  } catch (err: any) {
    console.error("Image upload error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── REST: Secure S3 Image Proxy (for private bucket images display) ──────────
app.get("/api/products/image-proxy", async (req: any, res: any) => {
  try {
    const key = req.query.key;
    if (!key || typeof key !== "string") {
      return res.status(400).json({ success: false, error: "Missing image key" });
    }

    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    });

    const data = await s3Client.send(command);
    if (!data.Body) {
      return res.status(404).json({ success: false, error: "Image body empty" });
    }

    // Set Content-Type from S3 or fallback to image/jpeg
    res.setHeader("Content-Type", data.ContentType || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=31536000");

    // Stream the body to the response
    const stream = data.Body as any;
    stream.pipe(res);
  } catch (err: any) {
    console.error("Image proxy error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});


// ── REST: Kích hoạt pipeline cho 1 sản phẩm ──────────────────────────────────
// ── REST: Batch pipeline — run multiple products sequentially ─────────────────
const batchStatus: Record<string, any> = {};

app.post("/api/pipeline/batch", async (req: any, res: any) => {
  const {
    products,           // Array of { product_name, category }
    dry_run = false,
    upload_s3 = false,
    publish_tiktok = false,
  } = req.body;

  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: "products must be a non-empty array" });
  }

  const batchId = randomUUID().slice(0, 8);
  batchStatus[batchId] = {
    batch_id: batchId,
    total: products.length,
    completed: 0,
    failed: 0,
    running: true,
    results: [],
    started_at: new Date().toISOString(),
  };

  // Respond immediately with batch_id
  res.json({ success: true, batch_id: batchId, total: products.length, message: `Batch started — ${products.length} products queued sequentially` });

  // Process sequentially in background
  (async () => {
    for (const item of products) {
      const { product_name, category = "tech" } = item;
      console.log(`\n🔄 [Batch ${batchId}] Processing: "${product_name}" (${batchStatus[batchId].completed + 1}/${products.length})`);
      try {
        const result = await runPipelineForProduct(
          { id: `adhoc_${Date.now()}`, name: product_name, category, affiliate_url: "", hashtags: [], enabled: true },
          { dryRun: dry_run, uploadToS3: upload_s3, publishTikTok: publish_tiktok }
        );
        batchStatus[batchId].results.push(result);
        batchStatus[batchId].completed++;
        console.log(`✅ [Batch ${batchId}] Done: "${product_name}"`);
      } catch (err: any) {
        batchStatus[batchId].results.push({ product_name, success: false, error: err.message });
        batchStatus[batchId].failed++;
        console.error(`❌ [Batch ${batchId}] Failed: "${product_name}" — ${err.message}`);
      }
      // Small pause between items to avoid rate limiting
      if (batchStatus[batchId].completed + batchStatus[batchId].failed < products.length) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    batchStatus[batchId].running = false;
    batchStatus[batchId].finished_at = new Date().toISOString();
    console.log(`\n🏁 [Batch ${batchId}] Finished! ${batchStatus[batchId].completed}/${products.length} succeeded`);
  })();
});

app.get("/api/pipeline/batch/:batchId", (req: any, res: any) => {
  const status = batchStatus[req.params.batchId];
  if (!status) return res.status(404).json({ error: "Batch not found" });
  res.json(status);
});

// ── REST: Send Live Director Feedback to Active 2-AI Debate Session ─────────
app.post("/api/prompts/feedback", (req: any, res: any) => {
  try {
    const { session_id, feedback } = req.body || {};
    if (!session_id || !feedback || !String(feedback).trim()) {
      return res.status(400).json({ success: false, error: "session_id và nội dung góp ý (feedback) là bắt buộc" });
    }
    const ok = sendSessionFeedback(String(session_id), String(feedback));
    if (!ok) {
      return res.status(404).json({ success: false, error: "Phiên tranh biện không hoạt động hoặc đã kết thúc" });
    }
    console.log(`📢 [API /prompts/feedback] Received human director feedback for session ${session_id}: "${feedback}"`);
    res.json({ success: true, message: "Đã gửi góp ý đến 2 AI thành công!" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Revise Specific Scene Prompts via AI ─────────────────────────────
app.post("/api/prompts/revise-scene", async (req: any, res: any) => {
  if (req.setTimeout) req.setTimeout(180000);
  if (res.setTimeout) res.setTimeout(180000);
  try {
    const {
      product_name = "Sản phẩm",
      category = "tech",
      prompts_obj = {},
      scene_indices = [2, 5],
      feedback = "",
      image_url,
      feedback_image_url,
    } = req.body || {};

    if (!feedback || !String(feedback).trim()) {
      return res.status(400).json({ success: false, error: "Nội dung yêu cầu chỉnh sửa (feedback) là bắt buộc" });
    }

    const { reviseScenePrompts } = await import("./promptGenerator.js");
    const result = await reviseScenePrompts(
      product_name,
      category,
      prompts_obj,
      scene_indices,
      feedback,
      image_url,
      feedback_image_url
    );

    res.json({
      success: true,
      prompts_obj: result.promptsObj,
      revision_note: result.revisionNote,
      ai1_proposal: result.ai1Proposal,
      ai2_audit: result.ai2Audit,
    });
  } catch (err: any) {
    console.error(`❌ [API /prompts/revise-scene] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Real-time SSE Stream 2-AI Sửa Kịch Bản theo Part ────────────────────
app.post("/api/prompts/revise-scene-stream", async (req: any, res: any) => {
  if (req.setTimeout) req.setTimeout(300000);
  if (res.setTimeout) res.setTimeout(300000);
  try {
    req.socket?.setTimeout(0);
    res.socket?.setTimeout(0);
  } catch {}

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const sendEvent = (event: any) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.flush?.();
    } catch {}
  };

  const keepAliveInterval = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
      res.flush?.();
    } catch {}
  }, 3000);

  try {
    const {
      product_name = "Sản phẩm",
      category = "tech",
      prompts_obj = {},
      scene_indices = [2, 5],
      feedback = "",
      image_url,
      feedback_image_url,
    } = req.body || {};

    if (!feedback || !String(feedback).trim()) {
      sendEvent({ type: "error", error: "Nội dung yêu cầu chỉnh sửa (feedback) là bắt buộc" });
      clearInterval(keepAliveInterval);
      return res.end();
    }

    const { reviseScenePrompts } = await import("./promptGenerator.js");
    const result = await reviseScenePrompts(
      product_name,
      category,
      prompts_obj,
      scene_indices,
      feedback,
      image_url,
      feedback_image_url,
      (evt) => {
        sendEvent(evt);
      }
    );

    sendEvent({ type: "complete", stage: "done", result });
  } catch (err: any) {
    console.error(`❌ [API /prompts/revise-scene-stream] Error: ${err.message}`);
    sendEvent({ type: "error", error: err.message });
  } finally {
    clearInterval(keepAliveInterval);
    try {
      res.end();
    } catch {}
  }
});

// ── REST: Generate Prompts with 2-AI Consensus Debate ───────────────────────
app.post("/api/prompts/consensus", async (req: any, res: any) => {
  // Allow multi-round unbounded debate without connection timeout (30 minutes)
  if (req.setTimeout) req.setTimeout(1800000);
  if (res.setTimeout) res.setTimeout(1800000);
  try {
    req.socket?.setTimeout(0);
    res.socket?.setTimeout(0);
  } catch {}
  try {
    const { product_name, category = "tech", product_image_url, product_description, scene_count = 6, user_feedback } = req.body;
    if (!product_name) {
      return res.status(400).json({ success: false, error: "product_name is required" });
    }
    const count = parseInt(scene_count, 10) === 3 ? 3 : 6;
    const result = await generatePromptsWithAiConsensus(
      product_name,
      category,
      product_image_url,
      product_description,
      count,
      30,
      undefined,
      user_feedback
    );
    res.json(result);
  } catch (err: any) {
    console.error(`❌ [API /prompts/consensus] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Generate Prompts with 2-AI Consensus Debate (Real-time SSE Stream) ──
app.post("/api/prompts/consensus-stream", async (req: any, res: any) => {
  if (req.setTimeout) req.setTimeout(1800000);
  if (res.setTimeout) res.setTimeout(1800000);
  try {
    req.socket?.setTimeout(0);
    res.socket?.setTimeout(0);
  } catch {}

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const sendEvent = (event: any) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.flush?.();
    } catch {}
  };

  const keepAliveInterval = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
      res.flush?.();
    } catch {}
  }, 4000);

  try {
    const {
      product_name,
      category = "tech",
      product_image_url,
      product_description,
      scene_count = 6,
      user_feedback,
      session_id,
      previous_proposal,
      start_round = 1
    } = req.body;

    if (!product_name) {
      sendEvent({ type: "error", error: "product_name is required" });
      clearInterval(keepAliveInterval);
      return res.end();
    }

    const actualSessionId = session_id || randomUUID();
    sendEvent({ type: "connected", session_id: actualSessionId });

    const count = parseInt(scene_count, 10) === 3 ? 3 : 6;
    const result = await generatePromptsWithAiConsensus(
      product_name,
      category,
      product_image_url,
      product_description,
      count,
      30,
      (evt) => {
        sendEvent(evt);
      },
      user_feedback,
      actualSessionId,
      previous_proposal,
      Number(start_round) || 1
    );

    sendEvent({ type: "complete", result });
  } catch (err: any) {
    console.error(`❌ [API /prompts/consensus-stream] Error: ${err.message}`);
    sendEvent({ type: "error", error: err.message });
  } finally {
    clearInterval(keepAliveInterval);
    try {
      res.end();
    } catch {}
  }
});

// ── REST: Tạo 6 ảnh phân cảnh bằng Gemini (Storyboard Images) ───────────────────
app.post("/api/pipeline/generate-scene-images", async (req: any, res: any) => {
  // Set 15-minute timeout for generating 6 high-detail scene images sequentially
  if (req.setTimeout) req.setTimeout(900000);
  if (res.setTimeout) res.setTimeout(900000);
  try {
    const {
      product_id,
      product_name = "scene",
      image_url,
      prompts,
      dialogues,
      prompts_obj,
      render_mode = "browser",
    } = req.body;

    let targetImageUrl = image_url;
    let targetProductName = product_name;
    let promptList: string[] = [];
    let dialogueList: string[] = [];

    if (product_id) {
      const products = await loadProducts();
      const product = products.find((p: any) => p.id === product_id);
      if (product) {
        targetProductName = product.name || targetProductName;
        targetImageUrl = targetImageUrl || product.image_url || (product.images && product.images[0]);
        if (!prompts && product.promptsObj) {
          const parsed = parseTextPromptToObj(product.promptsObj);
          if (parsed) {
            promptList = [1, 2, 3, 4, 5, 6].map(i => parsed[`prompt${i}`] || (i === 1 ? parsed.prompt : "")).filter(Boolean);
            dialogueList = [1, 2, 3, 4, 5, 6].map(i => parsed[`dialogue${i}`] || "");
          }
        }
      }
    }

    if (prompts_obj) {
      const parsed = parseTextPromptToObj(prompts_obj);
      if (parsed) {
        promptList = [1, 2, 3, 4, 5, 6].map(i => parsed[`prompt${i}`] || (i === 1 ? parsed.prompt : "")).filter(Boolean);
        dialogueList = [1, 2, 3, 4, 5, 6].map(i => parsed[`dialogue${i}`] || "");
      }
    } else if (Array.isArray(prompts) && prompts.length > 0) {
      promptList = prompts;
    }

    if (Array.isArray(dialogues)) {
      dialogueList = dialogues;
    }

    if (!targetImageUrl) {
      return res.status(400).json({ success: false, error: "image_url là bắt buộc để Gemini phân tích và tạo ảnh phân cảnh" });
    }

    let generatedPromptsObj: any = null;
    if (promptList.length === 0) {
      console.log(`🤖 [API /generate-scene-images] Chưa có prompt phân cảnh, tự động sinh 6 prompts bằng AI cho "${targetProductName}"...`);
      try {
        const { generatePromptsWithAiConsensus } = await import("./promptGenerator.js");
        const autoGen = await generatePromptsWithAiConsensus(targetProductName, "pets", targetImageUrl);
        if (autoGen && autoGen.promptsObj) {
          generatedPromptsObj = autoGen.promptsObj;
          promptList = [1, 2, 3, 4, 5, 6].map((i) => autoGen.promptsObj[`prompt${i}`] || (i === 1 ? autoGen.promptsObj.prompt : "")).filter(Boolean);
          dialogueList = [1, 2, 3, 4, 5, 6].map((i) => autoGen.promptsObj[`dialogue${i}`] || "");
        }
      } catch (promptGenErr: any) {
        console.warn(`⚠️ [API /generate-scene-images] Tự động sinh prompt thất bại: ${promptGenErr.message}`);
      }
    }

    if (promptList.length === 0) {
      return res.status(400).json({ success: false, error: "Cần ít nhất 1 prompt phân cảnh để tạo ảnh. Vui lòng tạo prompt trước!" });
    }

    console.log(`\n🎨 [API /generate-scene-images] Bắt đầu tạo ${promptList.length} ảnh phân cảnh cho "${targetProductName}"...`);
    const { generateAllSceneImages } = await import("./sceneImageGenerator.js");
    const productSlug = targetProductName
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-_]/g, "")
      .replace(/[\s_]+/g, "-") || "scene";

    // 1 Parent Folder for the product: data/downloads/${productSlug}/
    // All scene images and videos live together inside this single parent folder
    const jobFolder = productSlug;
    const mainDir = path.resolve(__dirname, `../data/downloads/${jobFolder}`);
    const scenesDir = path.join(mainDir, "scenes");
    if (!existsSync(scenesDir)) await fs.mkdir(scenesDir, { recursive: true });

    console.log(`📁 [API /generate-scene-images] Lưu ảnh vào thư mục phân cảnh: ${scenesDir}`);
    const genRes = await generateAllSceneImages(promptList, targetImageUrl, productSlug, scenesDir, dialogueList);

    // Build accessible relative URLs for browser preview
    const webUrls = genRes.sceneImagePaths.map(p => {
      const filename = path.basename(p);
      return `/downloads/${jobFolder}/scenes/${filename}`;
    });

    res.json({
      success: genRes.success,
      product_name: targetProductName,
      job_folder: jobFolder,
      scenes_folder: scenesDir,
      scene_image_paths: genRes.sceneImagePaths,
      scene_images: webUrls,
      prompts_obj: generatedPromptsObj,
      results: genRes.results,
      errors: genRes.errors,
      duration_ms: genRes.durationMs,
    });
  } catch (err: any) {
    console.error(`❌ [API /generate-scene-images] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Tạo 1 ảnh phân cảnh đơn lẻ (Progressive Realtime Scene Generation) ─────────
app.post("/api/pipeline/generate-single-scene-image", async (req: any, res: any) => {
  if (req.setTimeout) req.setTimeout(180000);
  if (res.setTimeout) res.setTimeout(180000);
  try {
    const {
      product_name = "scene",
      image_url,
      scene_index = 0,
      prompt,
      dialogue,
      job_folder,
      scene_1_path,
      reference_part_index,
      custom_reference_image_path,
      reference_label,
      redraw_instructions,
      render_mode = "browser",
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ success: false, error: "prompt phân cảnh là bắt buộc" });
    }

    const productSlug = product_name
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-_]/g, "")
      .replace(/[\s_]+/g, "-") || "scene";

    // 1 Parent Folder for the product: data/downloads/${productSlug}/
    const activeJobFolder = job_folder || productSlug;
    const mainDir = path.resolve(__dirname, `../data/downloads/${activeJobFolder}`);
    const scenesDir = path.join(mainDir, "scenes");
    if (!existsSync(scenesDir)) await fs.mkdir(scenesDir, { recursive: true });

    // Resolve custom reference image if specified
    let targetRefPath: string | undefined = undefined;
    let targetRefLabel: string = reference_label || "";

    if (custom_reference_image_path && typeof custom_reference_image_path === "string") {
      let resolved = custom_reference_image_path;
      if (resolved.startsWith("/downloads/")) {
        resolved = path.resolve(__dirname, `../data${resolved}`);
      }
      if (existsSync(resolved)) {
        targetRefPath = resolved;
      }
    }

    if (!targetRefPath && reference_part_index !== undefined && reference_part_index !== null) {
      const refIdx = parseInt(reference_part_index, 10);
      if (!isNaN(refIdx) && refIdx >= 0) {
        const candidatePng = path.join(scenesDir, `scene_${refIdx + 1}.png`);
        const candidateJpg = path.join(scenesDir, `scene_${refIdx + 1}.jpg`);
        if (existsSync(candidatePng)) {
          targetRefPath = candidatePng;
          if (!targetRefLabel) targetRefLabel = `Part ${refIdx + 1}`;
        } else if (existsSync(candidateJpg)) {
          targetRefPath = candidateJpg;
          if (!targetRefLabel) targetRefLabel = `Part ${refIdx + 1}`;
        }
      }
    }

    console.log(`\n🎨 [API /generate-single-scene-image] Bắt đầu tạo Cảnh ${scene_index + 1} cho "${product_name}"... (Mode: ${render_mode}, Ref: ${targetRefLabel || (scene_index === 0 ? "Ảnh Gốc" : "Part 1")}, Ghi chú: ${redraw_instructions ? `"${redraw_instructions}"` : "None"})`);
    const { generateSingleSceneImageStandalone } = await import("./sceneImageGenerator.js");

    const result = await generateSingleSceneImageStandalone(
      prompt,
      image_url,
      scene_index,
      productSlug,
      scenesDir,
      dialogue,
      scene_1_path,
      targetRefPath,
      targetRefLabel,
      redraw_instructions
    );

    const filename = result.imagePath ? path.basename(result.imagePath) : `scene_${scene_index + 1}.png`;
    const webUrl = `/downloads/${activeJobFolder}/scenes/${filename}`;

    res.json({
      success: result.success,
      scene_index,
      job_folder: activeJobFolder,
      scene_image_path: result.imagePath,
      scene_image_url: webUrl,
      error: result.error,
      duration_ms: result.durationMs,
    });
  } catch (err: any) {
    console.error(`❌ [API /generate-single-scene-image] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Tạo 1 video phân cảnh đơn lẻ qua Veo (Single Scene Veo Generation) ─
app.post("/api/pipeline/generate-single-scene-video", async (req: any, res: any) => {
  if (req.setTimeout) req.setTimeout(600000); // 10 minutes timeout for Veo video gen
  if (res.setTimeout) res.setTimeout(600000);
  try {
    const {
      product_name = "scene",
      scene_index = 0,
      prompt,
      dialogue,
      image_url,
      scene_image_path,
      job_folder,
      render_mode = "browser",
      aspect_ratio = "16:9",
      duration_seconds = 10,
    } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ success: false, error: "prompt phân cảnh là bắt buộc" });
    }

    const productSlug = product_name
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-_]/g, "")
      .replace(/[\s_]+/g, "-") || "scene";

    const activeJobFolder = job_folder || productSlug;
    const outputDir = path.resolve(__dirname, `../data/downloads/${activeJobFolder}`);
    if (!existsSync(outputDir)) await fs.mkdir(outputDir, { recursive: true });

    console.log(`\n🌐 [API /generate-single-scene-video] Render Video Part ${scene_index + 1} bằng Trình duyệt Chrome...`);
    const { generateSingleVeoSegment } = await import("./veoAutomation.js");
    const result = await generateSingleVeoSegment(
      prompt,
      scene_index,
      image_url,
      productSlug,
      outputDir,
      scene_image_path,
      dialogue
    );

    if (!result.success || !result.localPath) {
      return res.status(500).json({
        success: false,
        error: result.error || `Tạo video phân cảnh ${scene_index + 1} thất bại`,
        scene_index,
        duration_ms: result.durationMs,
      });
    }

    const filename = path.basename(result.localPath);
    const webUrl = `/downloads/${activeJobFolder}/${filename}`;
    const voicedFilename = result.voicedPath ? path.basename(result.voicedPath) : null;
    const voicedWebUrl = voicedFilename ? `/downloads/${activeJobFolder}/${voicedFilename}` : null;

    res.json({
      success: true,
      scene_index,
      job_folder: activeJobFolder,
      video_path: result.localPath,     // Bản gốc giữ 100% âm thanh & giọng gốc do Gemini tạo
      video_url: webUrl,
      voiced_path: result.voicedPath || null, // Bản lồng tiếng đi kèm
      voiced_url: voicedWebUrl,
      duration_ms: result.durationMs,
    });
  } catch (err: any) {
    console.error(`❌ [API /generate-single-scene-video] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Helper: Lấy thời lượng video chính xác bằng ffprobe / ffmpeg ────────────
function getVideoDurationWithFfmpeg(videoPath: string, defaultDur: number = 0): number {
  try {
    const { execSync } = require("child_process");
    for (const probe of ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe", "ffprobe"]) {
      try {
        const out = execSync(`"${probe}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
        const d = parseFloat(out.trim());
        if (!isNaN(d) && d > 0) return d;
      } catch {}
    }
    const { getFfmpegCmd } = require("./scheduler.js");
    const ffmpeg = getFfmpegCmd();
    try {
      execSync(`"${ffmpeg}" -i "${videoPath}"`, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    } catch (e: any) {
      const match = (e.stderr || "").toString().match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      if (match) {
        const hours = parseFloat(match[1]) || 0;
        const mins = parseFloat(match[2]) || 0;
        const secs = parseFloat(match[3]) || 0;
        const total = hours * 3600 + mins * 60 + secs;
        if (total > 0) return total;
      }
    }
  } catch {}
  return defaultDur;
}

// ── REST: Cắt / Trim Video của Part cụ thể ──────────────────────────────────
app.post("/api/pipeline/trim-part-video", async (req: any, res: any) => {
  try {
    const {
      product_name = "scene",
      job_folder,
      scene_index = 0,
      start_sec = 0,
      end_sec,
      from_original = false,
    } = req.body || {};

    const productSlug = product_name
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-_]/g, "")
      .replace(/[\s_]+/g, "-") || "scene";

    const activeJobFolder = job_folder || productSlug;
    const downloadsDir = path.resolve(__dirname, `../data/downloads/${activeJobFolder}`);
    if (!existsSync(downloadsDir)) {
      return res.status(404).json({ success: false, error: `Thư mục không tồn tại: ${downloadsDir}` });
    }

    const partNum = scene_index + 1;
    const files = await fs.readdir(downloadsDir);
    const partVideoFile = files.find(
      f => f.endsWith(".mp4") && f.includes(`_part${partNum}_`) && !f.includes("_merged") && !f.includes(".orig") && !f.includes(".bak")
    );

    if (!partVideoFile) {
      return res.status(404).json({ success: false, error: `Không tìm thấy video Part ${partNum} trong thư mục ${activeJobFolder}` });
    }

    const inputVideoPath = path.join(downloadsDir, partVideoFile);
    const backupPath = path.join(downloadsDir, `${partVideoFile}.orig.bak`);
    const legacyBackupPath = path.join(downloadsDir, `${partVideoFile}.orig.mp4`);

    // Create backup of original before first trim if not already existing
    if (!existsSync(backupPath)) {
      if (existsSync(legacyBackupPath)) {
        await fs.rename(legacyBackupPath, backupPath);
      } else {
        await fs.copyFile(inputVideoPath, backupPath);
      }
      console.log(`💾 [TrimVideo] Created backup of original video: ${backupPath}`);
    }

    const { getFfmpegCmd } = await import("./scheduler.js");
    const ffmpeg = getFfmpegCmd();
    const tempTrimmed = path.join(downloadsDir, `temp_trim_${Date.now()}.mp4`);

    const sourceVideoPath = (from_original && existsSync(backupPath)) ? backupPath : inputVideoPath;
    const startSec = Math.max(0, parseFloat(String(start_sec)) || 0);
    
    let durationArg = "";
    let expectedDuration = 0;
    if (end_sec !== undefined && end_sec !== null && String(end_sec).trim() !== "") {
      const endSec = parseFloat(String(end_sec));
      if (endSec > startSec) {
        const dur = endSec - startSec;
        expectedDuration = dur;
        durationArg = `-t ${dur.toFixed(3)}`;
      }
    }

    const { exec, execSync } = await import("child_process");

    // Check if source video has audio
    let hasAudio = false;
    try {
      const probeOut = execSync(`"/opt/homebrew/bin/ffprobe" -v error -show_streams -select_streams a -of json "${sourceVideoPath}"`, { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] });
      const parsed = JSON.parse(probeOut);
      hasAudio = Array.isArray(parsed.streams) && parsed.streams.length > 0;
    } catch {
      hasAudio = true; // Default to keep audio if probe fails
    }

    const audioCodec = hasAudio ? "-c:a aac -b:a 192k -ar 48000" : "-an";
    const trimCmd = `"${ffmpeg}" -y -ss ${startSec} -i "${sourceVideoPath}" ${durationArg} -avoid_negative_ts make_zero -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -r 30 ${audioCodec} "${tempTrimmed}"`;
    console.log(`✂️ [TrimVideo] Cutting Part ${partNum} (start: ${startSec}s, ${durationArg || 'to: end'})...`);

    await new Promise<void>((resolve, reject) => {
      exec(trimCmd, (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve();
      });
    });

    // Replace the active part file with the trimmed file
    await fs.rename(tempTrimmed, inputVideoPath);

    // Read new duration reliably
    const newDuration = getVideoDurationWithFfmpeg(inputVideoPath, expectedDuration || 0);

    const webUrl = `/downloads/${activeJobFolder}/${partVideoFile}?t=${Date.now()}`;
    console.log(`✅ [TrimVideo] Trimmed Part ${partNum} successfully! New duration: ${newDuration.toFixed(2)}s`);

    res.json({
      success: true,
      message: `Đã cắt video Part ${partNum} thành công (thời lượng mới: ${newDuration.toFixed(1)}s)`,
      part_number: partNum,
      video_url: webUrl,
      duration_sec: newDuration,
      video_path: inputVideoPath,
      has_backup: true
    });
  } catch (err: any) {
    console.error(`❌ [API /trim-part-video] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Khôi phục Video Gốc của Part trước khi cắt ────────────────────────
app.post("/api/pipeline/restore-part-video", async (req: any, res: any) => {
  try {
    const {
      product_name = "scene",
      job_folder,
      scene_index = 0,
    } = req.body || {};

    const productSlug = product_name
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-_]/g, "")
      .replace(/[\s_]+/g, "-") || "scene";

    const activeJobFolder = job_folder || productSlug;
    const downloadsDir = path.resolve(__dirname, `../data/downloads/${activeJobFolder}`);
    const partNum = scene_index + 1;

    const files = await fs.readdir(downloadsDir);
    const partVideoFile = files.find(
      f => f.endsWith(".mp4") && f.includes(`_part${partNum}_`) && !f.includes("_merged") && !f.includes(".orig") && !f.includes(".bak")
    );

    if (!partVideoFile) {
      return res.status(404).json({ success: false, error: `Không tìm thấy video Part ${partNum}` });
    }

    const inputVideoPath = path.join(downloadsDir, partVideoFile);
    let backupPath = path.join(downloadsDir, `${partVideoFile}.orig.bak`);
    if (!existsSync(backupPath)) {
      const legacyBackup = path.join(downloadsDir, `${partVideoFile}.orig.mp4`);
      if (existsSync(legacyBackup)) {
        backupPath = legacyBackup;
      }
    }

    if (!existsSync(backupPath)) {
      return res.status(400).json({ success: false, error: `Không có bản video gốc nào được lưu cho Part ${partNum}` });
    }

    // Restore from backup
    await fs.copyFile(backupPath, inputVideoPath);
    console.log(`🔄 [RestoreVideo] Restored original video for Part ${partNum}`);

    const origDuration = getVideoDurationWithFfmpeg(inputVideoPath, 0);
    const webUrl = `/downloads/${activeJobFolder}/${partVideoFile}?t=${Date.now()}`;

    res.json({
      success: true,
      message: `Đã khôi phục video gốc cho Part ${partNum} thành công!`,
      part_number: partNum,
      video_url: webUrl,
      duration_sec: origDuration,
      video_path: inputVideoPath
    });
  } catch (err: any) {
    console.error(`❌ [API /restore-part-video] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Ghép toàn bộ các Part Video thành Video Hoàn Chỉnh ────────────────
app.post("/api/pipeline/merge-job-videos", async (req: any, res: any) => {
  if (req.setTimeout) req.setTimeout(300000);
  if (res.setTimeout) res.setTimeout(300000);
  try {
    const {
      product_id,
      product_name = "product",
      job_folder,
      upload_s3 = true,
      publish_tiktok = false,
    } = req.body || {};

    const productSlug = product_name
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-_]/g, "")
      .replace(/[\s_]+/g, "-") || "product";

    const activeJobFolder = job_folder || productSlug;

    // Load product if product_id is provided
    let product: any = null;
    if (product_id) {
      const products = await loadProducts();
      product = products.find((p) => p.id === product_id);
    }
    if (!product) {
      product = {
        id: product_id || `prod_${Date.now()}`,
        name: product_name,
        category: "tech",
        affiliate_url: "",
        hashtags: [],
        enabled: true,
      };
    }

    console.log(`\n🎬 [API /merge-job-videos] Ghép các file Part Video cho "${product_name}" (folder: ${activeJobFolder})...`);
    const { mergeJobVideoSegments } = await import("./scheduler.js");

    const result = await mergeJobVideoSegments(
      productSlug,
      activeJobFolder,
      product,
      upload_s3,
      publish_tiktok
    );

    res.json(result);
  } catch (err: any) {
    console.error(`❌ [API /merge-job-videos] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Lồng tiếng VieNeu (DuDu_NamChinh & Mai Bé Phương) cho Video ───────
app.post("/api/pipeline/dub-video", async (req: any, res: any) => {
  if (req.setTimeout) req.setTimeout(300000);
  if (res.setTimeout) res.setTimeout(300000);
  try {
    const {
      product_id,
      product_name = "product",
      job_folder,
      prompts_obj,
      dudu_voice = "DuDu_NamChinh",
      bubu_voice = "Mai Bé Phương",
      script_text,
      upload_s3 = false,
      bgm_volume = 0.7,
      voice_temperature = 0.35,
      speaker_voices = {},
    } = req.body || {};

    const productSlug = product_name
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-_]/g, "")
      .replace(/[\s_]+/g, "-") || "product";

    const activeJobFolder = job_folder || productSlug;

    const products = await loadProducts();
    let product: any = null;
    if (product_id) {
      product = products.find((p) => p.id === product_id);
    }
    if (!product && product_name) {
      const nameLower = product_name.trim().toLowerCase();
      product = products.find((p) => p.name && p.name.trim().toLowerCase() === nameLower)
        || products.find((p) => p.name && (p.name.toLowerCase().includes(productSlug) || productSlug.includes(p.name.toLowerCase())));
    }

    console.log(`\n🎙️ [API /dub-video] Lồng tiếng video cho "${product_name}" (folder: ${activeJobFolder})...`);
    const { dubVideoWithVieneu } = await import("./videoDubbingService.js");

    const result = await dubVideoWithVieneu({
      productSlug,
      jobFolder: activeJobFolder,
      product,
      promptsObj: prompts_obj || product?.prompts_obj || product?.promptsObj,
      duduVoice: dudu_voice,
      bubuVoice: bubu_voice,
      scriptText: script_text,
      uploadToS3: upload_s3,
      bgmVolume: bgm_volume,
      voiceTemperature: voice_temperature,
      speakerVoices: speaker_voices,
    });

    // Register every successful dubbed render as its own Kho Video item.
    // Optionally upload the rendered file and thumbnail when the UI's S3
    // checkbox is enabled.
    const voicedPath = result.voicedVideoPath;
    const voicedFilename = result.voicedFilename;
    const voicedStat = statSync(voicedPath);
    const voicedDir = path.dirname(voicedPath);
    const thumbFilename = `${path.basename(voicedFilename, path.extname(voicedFilename))}_thumb.jpg`;
    const thumbPath = path.join(voicedDir, thumbFilename);
    const localVideoUrl = `/downloads/${activeJobFolder}/${voicedFilename}`;
    const localThumbUrl = `/downloads/${activeJobFolder}/${thumbFilename}`;
    const hasThumbnail = extractVideoThumbnailSync(voicedPath, thumbPath);

    let finalVideoUrl = localVideoUrl;
    let finalThumbUrl = hasThumbnail ? localThumbUrl : (product?.thumbnail_url || "");
    let voicedS3Key = "";

    if (upload_s3 && S3_BUCKET && process.env.AWS_ACCESS_KEY_ID) {
      try {
        const prefix = S3_PREFIX.replace(/\/$/, "");
        voicedS3Key = `${prefix}/${voicedFilename}`;
        await new Upload({
          client: s3Client,
          params: {
            Bucket: S3_BUCKET,
            Key: voicedS3Key,
            Body: await fs.readFile(voicedPath),
            ContentType: "video/mp4",
          },
        }).done();
        finalVideoUrl = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || "ap-southeast-1"}.amazonaws.com/${voicedS3Key}`;

        if (hasThumbnail) {
          const thumbKey = `${prefix}/${thumbFilename}`;
          await new Upload({
            client: s3Client,
            params: {
              Bucket: S3_BUCKET,
              Key: thumbKey,
              Body: await fs.readFile(thumbPath),
              ContentType: "image/jpeg",
            },
          }).done();
          finalThumbUrl = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION || "ap-southeast-1"}.amazonaws.com/${thumbKey}`;
        }
        console.log(`☁️ [VideoDubbing] Uploaded dubbed video to S3: ${finalVideoUrl}`);
      } catch (uploadErr: any) {
        voicedS3Key = "";
        finalVideoUrl = localVideoUrl;
        console.warn(`⚠️ [VideoDubbing] S3 upload failed, keeping local Kho Video entry: ${uploadErr.message}`);
      }
    }

    const nowIso = new Date().toISOString();
    const metadataEntry: VideoMetadata = {
      id: `vid_dubbed_${Date.now()}_${randomUUID().split("-")[0]}`,
      product_name: product?.name || product_name,
      title: `${product?.name || product_name} (Lồng tiếng)`,
      description: `Bản lồng tiếng ${result.totalLines} câu, tự động đồng bộ theo timeline nhân vật.`,
      prompt: product?.promptsObj || product?.prompts_obj
        ? JSON.stringify(product?.promptsObj || product?.prompts_obj)
        : "",
      tags: [...new Set([...(product?.hashtags || product?.tags || []), "#longtieng", "#voicesync"])],
      source_url: finalVideoUrl,
      s3_url: finalVideoUrl,
      s3_bucket: voicedS3Key ? S3_BUCKET : "",
      s3_key: voicedS3Key,
      local_path: voicedPath,
      stream_url: finalVideoUrl,
      size_bytes: voicedStat.size,
      thumbnail_url: finalThumbUrl,
      images: finalThumbUrl ? [finalThumbUrl] : [],
      created_at: nowIso,
      updated_at: nowIso,
    };

    const metadata = await loadMetadata();
    const existingIndex = metadata.findIndex(item => item.local_path && path.resolve(item.local_path) === path.resolve(voicedPath));
    if (existingIndex >= 0) metadata[existingIndex] = metadataEntry;
    else metadata.unshift(metadataEntry);
    await saveMetadata(metadata);
    console.log(`🎞️ [VideoDubbing] Added to Kho Video: ${metadataEntry.title}`);

    res.json({
      ...result,
      streamUrl: finalVideoUrl,
      s3Url: voicedS3Key ? finalVideoUrl : "",
      metadata: metadataEntry,
    });
  } catch (err: any) {
    console.error(`❌ [API /dub-video] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Kiểm tra trạng thái các file Part Ảnh & Video trong job folder ──────
app.get("/api/pipeline/job-parts-status", async (req: any, res: any) => {
  try {
    const job_folder = req.query.job_folder as string;
    const product_name = (req.query.product_name as string) || "scene";

    const productSlug = product_name
      .toString()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-_]/g, "")
      .replace(/[\s_]+/g, "-") || "scene";

    const activeJobFolder = job_folder || productSlug;
    const downloadsDir = path.resolve(__dirname, `../data/downloads/${activeJobFolder}`);
    const scenesDir = path.join(downloadsDir, "scenes");

    const parts: any[] = [];
    for (let i = 1; i <= 6; i++) {
      // Check scene image
      const imgPath = path.join(scenesDir, `scene_${i}.png`);
      const hasImg = existsSync(imgPath);
      const imgUrl = hasImg ? `/downloads/${activeJobFolder}/scenes/scene_${i}.png` : null;

      // Check part video (Original Gemini & Companion Voiced)
      let videoFile: string | null = null;
      let videoPath: string | null = null;
      let videoUrl: string | null = null;
      let videoMtime: number = 0;

      let voicedVideoFile: string | null = null;
      let voicedVideoPath: string | null = null;
      let voicedVideoUrl: string | null = null;
      let voicedVideoMtime: number = 0;

      if (existsSync(downloadsDir)) {
        const files = await fs.readdir(downloadsDir);
        for (const f of files) {
          if (!f.endsWith(".mp4") || f.includes("_merged") || f.includes(".orig") || f.includes(".bak")) continue;
          const match = f.match(new RegExp(`_part${i}_`, "i"));
          if (match) {
            const fullP = path.join(downloadsDir, f);
            const st = statSync(fullP);
            if (f.includes("_voiced")) {
              if (st.mtimeMs > voicedVideoMtime) {
                voicedVideoMtime = st.mtimeMs;
                voicedVideoFile = f;
                voicedVideoPath = fullP;
                voicedVideoUrl = `/downloads/${activeJobFolder}/${f}`;
              }
            } else {
              if (st.mtimeMs > videoMtime) {
                videoMtime = st.mtimeMs;
                videoFile = f;
                videoPath = fullP;
                videoUrl = `/downloads/${activeJobFolder}/${f}`;
              }
            }
          }
        }
      }

      parts.push({
        part_index: i - 1,
        part_number: i,
        image: {
          exists: hasImg,
          url: imgUrl,
          path: hasImg ? imgPath : null,
        },
        video: {
          exists: !!videoPath,
          url: videoUrl,
          path: videoPath,
          filename: videoFile,
        },
        voiced_video: {
          exists: !!voicedVideoPath,
          url: voicedVideoUrl,
          path: voicedVideoPath,
          filename: voicedVideoFile,
        },
      });
    }

    const mergedPath = path.join(downloadsDir, `${productSlug}_merged.mp4`);
    const hasMerged = existsSync(mergedPath);
    const mergedUrl = hasMerged ? `/downloads/${activeJobFolder}/${productSlug}_merged.mp4` : null;

    let voicedFile: string | null = null;
    let voicedPath: string | null = null;
    let voicedUrl: string | null = null;
    let latestVoicedMtime = 0;

    if (existsSync(downloadsDir)) {
      const files = await fs.readdir(downloadsDir);
      for (const f of files) {
        if (!f.endsWith(".mp4") || f.includes(".orig") || f.includes(".bak")) continue;
        if (f.startsWith(productSlug) && (f.includes("_longtieng_") || f.includes("_voiced"))) {
          const fullP = path.join(downloadsDir, f);
          const st = statSync(fullP);
          if (st.mtimeMs > latestVoicedMtime) {
            latestVoicedMtime = st.mtimeMs;
            voicedFile = f;
            voicedPath = fullP;
            voicedUrl = `/downloads/${activeJobFolder}/${f}`;
          }
        }
      }
    }

    res.json({
      success: true,
      job_folder: activeJobFolder,
      parts,
      merged_video: {
        exists: hasMerged,
        url: mergedUrl,
        path: hasMerged ? mergedPath : null,
      },
      voiced_video: {
        exists: !!voicedPath,
        url: voicedUrl,
        path: voicedPath,
        filename: voicedFile,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/pipeline/run", async (req: any, res: any) => {
  try {
    const {
      product_id,
      product_name,
      category = "tech",
      dry_run = false,
      upload_s3 = true,
      publish_tiktok = true,
      prompts_obj,
      custom_prompts,
      use_ai_consensus = true,
      user_feedback,
      scene_image_paths,
      auto_generate_scene_images = true,
    } = req.body;

    const customPromptsObj = prompts_obj || custom_prompts;

    let product;
    if (product_id) {
      const products = await loadProducts();
      product = products.find((p: any) => p.id === product_id);
      if (!product) return res.status(404).json({ success: false, error: `Product not found: ${product_id}` });
      
      // Save prompt immediately to products.json if custom prompt was supplied
      if (customPromptsObj) {
        const DATA_FILE = path.resolve(__dirname, "../data/products.json");
        if (existsSync(DATA_FILE)) {
          const raw = await fs.readFile(DATA_FILE, "utf-8");
          const allProds = JSON.parse(raw) as any[];
          const idx = allProds.findIndex(p => p.id === product_id);
          if (idx !== -1) {
            allProds[idx].promptsObj = customPromptsObj;
            product.promptsObj = customPromptsObj;
            await fs.writeFile(DATA_FILE, JSON.stringify(allProds, null, 2), "utf-8");
            console.log(`💾 [API] Saved custom prompt into products.json for product ID: ${product_id}`);
          }
        }
      }
    } else if (product_name) {
      product = {
        id: `adhoc_${randomUUID().split("-")[0]}`,
        name: product_name,
        category,
        affiliate_url: "",
        hashtags: [`#${product_name.toLowerCase().replace(/\s+/g, "")}`, "#affiliate"],
        promptsObj: customPromptsObj,
        enabled: true,
      };
    } else {
      return res.status(400).json({ success: false, error: "product_id hoặc product_name là bắt buộc" });
    }

    // Chạy pipeline không đồng bộ (trả về 202 Accepted ngay)
    const runId = randomUUID();
    res.status(202).json({
      success: true,
      message: "Pipeline đã được kích hoạt",
      run_id: runId,
      product: product.name,
      dry_run,
    });

    // Chạy pipeline trong background
    runPipelineForProduct(product, {
      dryRun: dry_run,
      uploadToS3: upload_s3,
      publishTikTok: publish_tiktok,
      customPromptsObj,
      useAiConsensus: Boolean(use_ai_consensus),
      userFeedback: user_feedback ? String(user_feedback).trim() : undefined,
      sceneImagePaths: Array.isArray(scene_image_paths) ? scene_image_paths : undefined,
      autoGenerateSceneImages: Boolean(auto_generate_scene_images),
    }).then((result) => {
      console.log(`\n📊 [API /pipeline/run] Kết quả run_id=${runId}:`, JSON.stringify(result, null, 2));
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Chạy pipeline cho tất cả sản phẩm ─────────────────────────────────
app.post("/api/pipeline/run-all", async (req: any, res: any) => {
  const status = getPipelineStatus();
  if (status.is_running) {
    return res.status(409).json({ success: false, error: "Pipeline đang chạy, thử lại sau" });
  }
  const { dry_run = false } = req.body || {};
  res.status(202).json({ success: true, message: "Đã kích hoạt pipeline cho tất cả sản phẩm", dry_run });
  runAllProducts({ dryRun: dry_run }).then((results) => {
    console.log(`\n📊 [API /pipeline/run-all] Tổng kết: ${results.length} sản phẩm`);
  });
});

// ── REST: Xem trạng thái pipeline ────────────────────────────────────────────
app.get("/api/pipeline/status", (_req: any, res: any) => {
  res.json({ success: true, ...getPipelineStatus() });
});

// ── REST: Dừng / Hủy Pipeline (Stop / Cancel Pipeline) ────────────────────────
app.post("/api/pipeline/stop", async (_req: any, res: any) => {
  try {
    const { stopPipeline } = await import("./scheduler.js");
    const result = stopPipeline();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/pipeline/cancel", async (_req: any, res: any) => {
  try {
    const { stopPipeline } = await import("./scheduler.js");
    const result = stopPipeline();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Test toàn bộ flow (1 lệnh curl / mở browser) ───────────────────────
// Usage:
//   GET /api/test                          → full flow với sản phẩm mặc định
//   GET /api/test?dry_run=true             → chỉ sinh prompt, không mở Chrome
//   GET /api/test?product=Sony+WH1000XM5  → test với sản phẩm khác
//   GET /api/test?category=beauty          → đổi category
// ── REST: Auto-launch ChromeAuto + open Gemini for login ─────────────────────
app.post("/api/chrome/start", async (_req: any, res: any) => {
  try {
    const chromeAutoDir = path.join(process.env.HOME || "~", "ChromeAuto");
    const debugPort = process.env.CHROME_DEBUG_PORT || "9222";

    // Check if already running
    const alreadyRunning = await fetch(`http://localhost:${debugPort}/json/version`).then(r => r.ok).catch(() => false);
    if (alreadyRunning) {
      // If user explicitly pressed Start Chrome, move window on-screen so they can see and log in
      try {
        const pup = (await import("puppeteer")).default;
        const browser = await pup.connect({ browserURL: `http://localhost:${debugPort}`, defaultViewport: null });
        const [page] = await browser.pages();
        if (page) {
          const session = await page.createCDPSession();
          const { windowId } = await session.send("Browser.getWindowForTarget");
          if (windowId) {
            await session.send("Browser.setWindowBounds", {
              windowId,
              bounds: { windowState: "normal", left: 100, top: 100, width: 1280, height: 900 },
            });
          }
          await session.detach();
        }
        browser.disconnect();
      } catch {}
      return res.json({ success: true, status: "already_running", message: "Chrome moved to screen for you to log in!" });
    }

    // Setup ChromeAuto dir if not exists
    if (!existsSync(chromeAutoDir)) {
      mkdirSync(chromeAutoDir, { recursive: true });
      console.log(`📁 [Chrome] Created ChromeAuto directory: ${chromeAutoDir}`);
    }

    // Remove lock files
    for (const lock of ["Default/SingletonLock", "Default/SingletonCookie", "SingletonLock"]) {
      const p = path.join(chromeAutoDir, lock);
      if (existsSync(p)) rmSync(p, { force: true });
    }

    // Launch Chrome (on-screen by default when explicitly requested via /start)
    const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const { spawn } = await import("child_process");
    const isHidden = _req.body?.mode === "hidden";
    const windowPos = isHidden ? "--window-position=10,40" : "--window-position=100,100";
    const windowSize = isHidden ? "--window-size=680,540" : "--window-size=1280,900";
    const proc = spawn(chromePath, [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${chromeAutoDir}`,
      windowPos,
      windowSize,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-mode",
      "--disable-blink-features=AutomationControlled",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=CalculatePageVisibilityState",
    ], { detached: true, stdio: "ignore" });
    proc.unref();

    // Wait up to 6s for Chrome to be ready
    let ready = false;
    for (let i = 0; i < 12; i++) {
      await new Promise(r => setTimeout(r, 500));
      ready = await fetch(`http://localhost:${debugPort}/json/version`).then(r => r.ok).catch(() => false);
      if (ready) break;
    }

    if (!ready) {
      return res.status(500).json({ success: false, error: "Chrome started but debug port not ready. Check if ChromeAuto needs login first." });
    }

    // Open Gemini tab for user to login
    const { default: pup } = await import("puppeteer").catch(() => ({ default: null }));
    if (pup) {
      const browser = await pup.connect({ browserURL: `http://localhost:${debugPort}`, defaultViewport: null });
      const page = await browser.newPage();
      await page.goto("https://gemini.google.com/", { waitUntil: "domcontentloaded" });
      browser.disconnect();
    }

    res.json({ success: true, status: "launched", message: `Chrome launched! Please log in to Gemini in the Chrome window, then click Generate.` });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Hide Chrome window offscreen (background mode) ───────────────────────
app.post("/api/chrome/hide", async (_req: any, res: any) => {
  try {
    const debugPort = process.env.CHROME_DEBUG_PORT || "9222";
    const pup = (await import("puppeteer")).default;
    const browser = await pup.connect({ browserURL: `http://127.0.0.1:${debugPort}`, defaultViewport: null });
    const pages = await browser.pages();
    if (pages.length > 0) {
      const session = await pages[0].createCDPSession();
      const { windowId } = await session.send("Browser.getWindowForTarget");
      if (windowId) {
        await session.send("Browser.setWindowBounds", {
          windowId,
          bounds: { windowState: "normal", left: 1300, top: 890, width: 480, height: 400 },
        });
      }
      await session.detach();
    }
    browser.disconnect();

    // Restore focus to user app on macOS
    try {
      const { execSync, execFile } = await import("child_process");
      const activeApp = execSync(`osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`, { encoding: "utf8", timeout: 1000 }).trim();
      if (activeApp && activeApp !== "Google Chrome") {
        execFile("osascript", ["-e", `tell application "System Events" to set frontmost of (first process whose name is "${activeApp}") to true`], () => {});
      }
    } catch {}

    res.json({ success: true, message: "Chrome moved offscreen (hidden in background)" });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── REST: Show Chrome window on-screen (interactive login mode) ────────────────
app.post("/api/chrome/show", async (_req: any, res: any) => {
  try {
    const debugPort = process.env.CHROME_DEBUG_PORT || "9222";
    const pup = (await import("puppeteer")).default;
    const browser = await pup.connect({ browserURL: `http://127.0.0.1:${debugPort}`, defaultViewport: null });
    const pages = await browser.pages();
    if (pages.length > 0) {
      const session = await pages[0].createCDPSession();
      const { windowId } = await session.send("Browser.getWindowForTarget");
      if (windowId) {
        await session.send("Browser.setWindowBounds", {
          windowId,
          bounds: { windowState: "normal", left: 100, top: 100, width: 1280, height: 900 },
        });
      }
      await session.detach();
    }
    browser.disconnect();
    res.json({ success: true, message: "Chrome moved to main screen (visible)" });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── REST: Check Chrome + Gemini login status ──────────────────────────────────
app.get("/api/chrome/status", async (_req: any, res: any) => {
  const debugPort = process.env.CHROME_DEBUG_PORT || "9222";

  // Only check if debug port responds — NO opening Chrome tabs
  let running = false;
  let browserInfo = "";
  try {
    const res2 = await fetch(`http://localhost:${debugPort}/json/version`, { signal: AbortSignal.timeout(2000) });
    if (res2.ok) {
      const info = await res2.json() as any;
      running = true;
      browserInfo = info.Browser || "";
    }
  } catch { /* not running */ }

  // Infer logged-in status: ChromeAuto dir exists + Chrome is running = likely logged in
  const chromeAutoDir = path.join(process.env.HOME || "", "ChromeAuto", "Default");
  const hasProfile = existsSync(chromeAutoDir);
  const geminiLoggedIn = running && hasProfile;

  res.json({ success: true, chrome_running: running, gemini_logged_in: geminiLoggedIn, browser: browserInfo });
});

// ── REST: Click Download button on current Gemini video ──────────────────────
app.post("/api/chrome/download", async (_req: any, res: any) => {
  const debugPort = process.env.CHROME_DEBUG_PORT || "9222";
  try {
    const { default: pup } = await import("puppeteer");
    const browser = await pup.connect({ browserURL: `http://localhost:${debugPort}`, defaultViewport: null });

    // Find the active tab showing Gemini
    const pages = await browser.pages();
    const geminiPage = pages.find((p: any) => p.url().includes("gemini.google.com")) || pages[pages.length - 1];

    // Setup CDP download to save to data/downloads/
    const client = await geminiPage.createCDPSession();
    const downloadDir = path.join(process.cwd(), "data/downloads");
    mkdirSync(downloadDir, { recursive: true });
    await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: toHostPath(downloadDir) });

    // Take screenshot for debug
    const ssPath = path.join(process.cwd(), "data/debug/before_download.png");
    await geminiPage.screenshot({ path: ssPath }).catch(() => {});

    // Click the download button in Gemini video player
    // Button selectors based on Gemini's video player UI
    const downloadSelectors = [
      'button[aria-label*="Download" i]',
      'button[aria-label*="download" i]',
      '[data-mat-icon-name="download"]',
      'button mat-icon[data-mat-icon-name="download"]',
      '.mat-mdc-icon-button[aria-label*="download" i]',
      'a[download]',
    ];

    let clicked = false;
    for (const sel of downloadSelectors) {
      try {
        await geminiPage.waitForSelector(sel, { timeout: 3000 });
        await geminiPage.click(sel);
        clicked = true;
        console.log(`⬇️  [Download] Clicked: ${sel}`);
        break;
      } catch { /* try next */ }
    }

    if (!clicked) {
      // Try evaluating in page to find download button
      clicked = await geminiPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button, a")).find(el => {
          const aria = el.getAttribute("aria-label")?.toLowerCase() || "";
          const title = el.getAttribute("title")?.toLowerCase() || "";
          return aria.includes("download") || title.includes("download");
        });
        if (btn) { (btn as HTMLElement).click(); return true; }
        return false;
      });
    }

    await new Promise(r => setTimeout(r, 3000));
    browser.disconnect();

    // Check if file appeared in downloads
    const files = readdirSync(downloadDir).filter((f: string) => f.endsWith(".mp4") || f.endsWith(".webm"));

    res.json({
      success: clicked,
      clicked,
      files_in_downloads: files,
      screenshot: ssPath,
      message: clicked ? `Download clicked! Files: ${files.join(", ") || "pending..."}` : "Download button not found",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Publish video to TikTok ────────────────────────────────────────────
app.post("/api/videos/:id/publish", async (req: any, res: any) => {
  try {
    const list = await loadMetadata();
    const video = list.find((v) => v.id === req.params.id);
    if (!video) {
      return res.status(404).json({ success: false, error: "Video not found" });
    }

    console.log(`📱 [TikTok] Publishing video: "${video.title}"...`);
    const { tiktokVideoId, status } = await publishToTikTok({
      s3Url: video.s3_url,
      s3Key: video.s3_key,
      title: video.title,
      tags: video.tags || [],
    });

    // Update metadata record
    const idx = list.findIndex((v) => v.id === req.params.id);
    if (idx !== -1) {
      list[idx].tiktok_video_id = tiktokVideoId;
      list[idx].tiktok_status = status;
      list[idx].updated_at = new Date().toISOString();
      await saveMetadata(list);
      console.log(`📝 [TikTok] Updated metadata ${req.params.id} with TikTok ID: ${tiktokVideoId}`);
    }

    res.json({
      success: true,
      tiktok_video_id: tiktokVideoId,
      status,
      mode: IS_MOCK_TIKTOK ? "mock" : "real",
      message: IS_MOCK_TIKTOK
        ? "Video published successfully in MOCK mode!"
        : "Video published successfully to TikTok!",
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


app.get("/api/test", async (req: any, res: any) => {
  const dryRun   = req.query.dry_run === "true" || req.query.dry_run === "1";
  const productName = (req.query.product as string) || "AKKO 3068B keyboard";
  const category = (req.query.category as string) || "tech";

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🧪 [TEST] Triggering full pipeline test`);
  console.log(`   Product : ${productName}`);
  console.log(`   Category: ${category}`);
  console.log(`   DryRun  : ${dryRun}`);
  console.log(`${"═".repeat(60)}`);

  const product = {
    id: `test_${randomUUID().split("-")[0]}`,
    name: productName,
    category,
    affiliate_url: "",
    hashtags: [`#${productName.toLowerCase().replace(/\s+/g, "")}`, "#affiliate", "#test"],
    enabled: true,
  };

  // Run pipeline synchronously so the HTTP response contains the full result
  try {
    const result = await runPipelineForProduct(product, {
      dryRun,
      uploadToS3: false,       // Safe default for testing
      publishTikTok: false,    // Safe default for testing
    });

    const emoji = result.success ? "✅" : "❌";
    console.log(`\n${emoji} [TEST] Done in ${result.duration_ms}ms`);

    res.json({
      success: result.success,
      test_config: { product_name: productName, category, dry_run: dryRun },
      result,
      tips: {
        full_flow:     `curl "http://localhost:${PORT}/api/test"`,
        dry_run_only:  `curl "http://localhost:${PORT}/api/test?dry_run=true"`,
        custom_product:`curl "http://localhost:${PORT}/api/test?product=Sony+WH1000XM5&category=tech"`,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── MCP StreamableHTTP & SSE Transports ───────────────────────────────────────
const mcpTransports: Map<string, StreamableHTTPServerTransport> = new Map();
const sseTransports: Map<string, SSEServerTransport> = new Map();

// SSE Message Handler (cho SSE Transport)
app.post("/mcp/messages", async (req: any, res: any) => {
  const sessionId = req.query.sessionId as string;
  const transport = sseTransports.get(sessionId);
  if (transport) {
    await transport.handlePostMessage(req, res, req.body);
  } else {
    res.status(400).json({ error: "Session not found" });
  }
});

app.post("/mcp", async (req: any, res: any) => {
  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    let transport: StreamableHTTPServerTransport;

    if (sessionId && mcpTransports.has(sessionId)) {
      transport = mcpTransports.get(sessionId)!;
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          mcpTransports.set(id, transport);
          console.log(`🔗 MCP StreamableHTTP session initialized: ${id}`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          mcpTransports.delete(transport.sessionId);
          console.log(`🔌 MCP session closed: ${transport.sessionId}`);
        }
      };

      const server = createMcpServer();
      await server.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  } catch (err: any) {
    console.error("❌ MCP request error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal MCP server error", message: err.message });
    }
  }
});

app.get("/mcp", async (req: any, res: any) => {
  const accept = (req.headers["accept"] || "").toLowerCase();
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  // Nếu client gửi Accept: text/event-stream (chuẩn MCP SSE Transport)
  if (accept.includes("text/event-stream") || req.query.transport === "sse") {
    console.log("⚡ [SSE Transport] Gemini/Client khởi tạo kết nối SSE...");
    
    // Đặt header chống buffering cho Nginx/Cloudflare HTTP/2 stream
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    // Tạo URL tuyệt đối (Absolute URL) theo khuyến nghị MCP Client
    const host = req.headers["x-forwarded-host"] || req.headers.host || "dev.thienstyle.xyz";
    const proto = req.headers["x-forwarded-proto"] || "https";
    const baseUrl = `${proto}://${host}`;
    const msgPath = `${baseUrl}${req.originalUrl.includes("/affiliate") ? "/affiliate" : ""}/mcp/messages`;

    const transport = new SSEServerTransport(msgPath, res);
    sseTransports.set(transport.sessionId, transport);

    transport.onclose = () => {
      sseTransports.delete(transport.sessionId);
      console.log(`🔌 SSE session closed: ${transport.sessionId}`);
    };

    const server = createMcpServer();
    await server.connect(transport);
    return;
  }

  // StreamableHTTP session ID nếu có
  if (sessionId && mcpTransports.has(sessionId)) {
    const transport = mcpTransports.get(sessionId)!;
    await transport.handleRequest(req, res);
    return;
  }

  // Mặc định: Trả về JSON Discovery cho Gemini / MCP clients probe
  return res.status(200).json({
    name: "affiliate-mcp-server",
    version: "2.0.0",
    description: "Affiliate Automation MCP Server: Veo video generation pipeline → S3 → TikTok",
    protocol: "mcp",
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    tools: [
      { name: "upload_video", description: "Download video từ URL → Upload lên AWS S3" },
      { name: "save_metadata", description: "Lưu video metadata vào JSON storage" },
      { name: "publish_tiktok", description: "Publish video lên TikTok" },
      { name: "generate_prompt", description: "Sinh Veo prompt bằng AGY Gemini 3.8, GLM-5 kiểm định ở chế độ consensus" },
      { name: "generate_video", description: "Tạo video Veo qua Puppeteer + Gemini Web" },
      { name: "run_full_pipeline", description: "Chạy toàn bộ pipeline affiliate từ A-Z" },
    ],
  });
});

app.delete("/mcp", async (req: any, res: any) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !mcpTransports.has(sessionId)) {
    return res.status(400).json({ error: "Missing or invalid mcp-session-id" });
  }
  const transport = mcpTransports.get(sessionId)!;
  await transport.handleRequest(req, res);
});

// ── SPA Fallback Routing ───────────────────────────────────────────────────
app.use((req: any, res: any, next: any) => {
  if (req.method !== "GET") return next();
  if (
    req.path.startsWith("/api") ||
    req.path.startsWith("/downloads") ||
    req.path.startsWith("/health") ||
    req.path.startsWith("/mcp") ||
    req.path.startsWith("/sse")
  ) {
    return next();
  }
  const clientDistIndex = path.resolve(CLIENT_DIST_DIR, "index.html");
  if (existsSync(clientDistIndex)) {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    return res.sendFile(clientDistIndex);
  }
  next();
});

// ─── Start Server ─────────────────────────────────────────────────────────────
async function main() {
  await ensureDataDir();
  startChromeBridge();

  // Check S3 connectivity (non-blocking warning)
  if (S3_BUCKET) {
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
      console.log(`✅ S3 bucket connected: ${S3_BUCKET}`);
    } catch (err: any) {
      console.warn(`⚠️  S3 bucket check failed (${S3_BUCKET}): ${err.message}`);
      console.warn("   → Server will still start; S3 uploads will fail until credentials are valid.");
    }
  } else {
    console.warn("⚠️  S3_BUCKET_NAME not set — upload_video tool will return error.");
  }

  const httpServer = app.listen(PORT, () => {
    httpServer.timeout = 0; // Disable socket inactivity timeout
    httpServer.keepAliveTimeout = 1800000; // 30 minutes
    httpServer.headersTimeout = 1800000; // 30 minutes
    if ((httpServer as any).requestTimeout !== undefined) {
      (httpServer as any).requestTimeout = 1800000;
    }
    console.log("");
    console.log("╔════════════════════════════════════════════════════════════╗");
    console.log("║       🚀 Affiliate Automation MCP Server v2.0 started!     ║");
    console.log("╠════════════════════════════════════════════════════════════╣");
    console.log(`║  HTTP:      http://localhost:${PORT}                          ║`);
    console.log(`║  MCP:       http://localhost:${PORT}/mcp                      ║`);
    console.log(`║  Health:    http://localhost:${PORT}/health                   ║`);
    console.log(`║  Videos:    http://localhost:${PORT}/api/videos               ║`);
    console.log(`║  Products:  http://localhost:${PORT}/api/products             ║`);
    console.log(`║  Pipeline:  http://localhost:${PORT}/api/pipeline/run         ║`);
    console.log("╠════════════════════════════════════════════════════════════╣");
    console.log(`║  TikTok:  ${IS_MOCK_TIKTOK ? "🎭 MOCK mode" : "✅ Real API"}                            ║`);
    console.log(`║  S3:      ${S3_BUCKET ? `✅ ${S3_BUCKET}` : "⚠️  Not configured"}           ║`);
    console.log("╠════════════════════════════════════════════════════════════╣");
    console.log("║  📌 MCP Tools:                                             ║");
    console.log("║   → upload_video       (download URL → S3)                 ║");
    console.log("║   → save_metadata      (lưu metadata JSON)                 ║");
    console.log("║   → publish_tiktok     (publish lên TikTok)                ║");
    console.log("║   → generate_prompt    (AGY 3.8 → GLM-5 audit → Veo)       ║");
    console.log("║   → generate_video     (Puppeteer → Gemini Web → MP4)      ║");
    console.log("║   → run_full_pipeline  (Full A-Z automation)               ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    console.log("");

    // Khởi động Cronjob scheduler nếu không tắt qua ENV
    if (process.env.DISABLE_SCHEDULER !== "true") {
      startScheduler();
    } else {
      console.log("⏸️  Scheduler disabled (DISABLE_SCHEDULER=true)");
    }
  });

  httpServer.setTimeout(900000); // 15 minutes
  httpServer.keepAliveTimeout = 900000;
  httpServer.headersTimeout = 905000;
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
