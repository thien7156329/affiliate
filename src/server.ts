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
import { existsSync, createWriteStream, mkdirSync, readdirSync, rmSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { S3Client, PutObjectCommand, HeadBucketCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { Readable } from "stream";
import { z } from "zod";
import { generateVideoPrompt, generateVideoDescriptionVi, callBedrock } from "./promptGenerator.js";
import { generateVeoVideo } from "./veoAutomation.js";
import {
  runPipelineForProduct,
  runAllProducts,
  loadProducts,
  getPipelineStatus,
  startScheduler,
} from "./scheduler.js";
// localtunnel is imported dynamically in startTunnel() to avoid crash if not installed

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
  description?: string;
  prompt?: string;
  tags: string[];
  source_url: string;
  s3_url: string;
  s3_bucket: string;
  s3_key: string;
  size_bytes: number;
  tiktok_video_id?: string;
  tiktok_status?: "published" | "mock" | "failed";
  thumbnail_url?: string;
  images?: string[];
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

// ─── Metadata Storage Helpers ─────────────────────────────────────────────────
async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await fs.mkdir(DATA_DIR, { recursive: true });
    console.log(`📂 Created data directory: ${DATA_DIR}`);
  }
}

async function loadMetadata(): Promise<VideoMetadata[]> {
  await ensureDataDir();
  try {
    if (!existsSync(METADATA_FILE)) return [];
    const raw = await fs.readFile(METADATA_FILE, "utf-8");
    return JSON.parse(raw) as VideoMetadata[];
  } catch {
    return [];
  }
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
  
  try {
    const response = await axios.get(imageUrl, {
      responseType: "stream",
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      }
    });

    const contentType = String(response.headers["content-type"] ?? "image/jpeg");
    const stream = response.data as Readable;

    // Generate extension and key
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
    console.error(`⚠️ Failed to upload image to S3: ${err.message}`);
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
      description: "Generate a Veo cinematic prompt from an affiliate product name using Gemini Flash API. Optionally supply a product image to guide the generation style.",
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

app.use(express.json({ limit: "10mb" }));

// Serve Web Dashboard from /public folder
const PUBLIC_DIR = path.resolve(__dirname, "../public");
if (existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  console.log(`🌐 Dashboard: http://localhost:${process.env.PORT || 3400}/`);
}

// Serve downloaded videos directly — stream via /downloads/:file
const DOWNLOADS_DIR_STATIC = path.resolve(__dirname, "../data/downloads");
mkdirSync(DOWNLOADS_DIR_STATIC, { recursive: true });
app.use("/downloads", express.static(DOWNLOADS_DIR_STATIC));

// API: list all downloaded videos
app.get("/api/videos/local", (_req: any, res: any) => {
  try {
    const files = readdirSync(DOWNLOADS_DIR_STATIC)
      .filter(f => f.endsWith(".mp4") || f.endsWith(".webm"))
      .map(f => {
        const stat = require("fs").statSync(path.join(DOWNLOADS_DIR_STATIC, f));
        return {
          filename: f,
          url: `/downloads/${f}`,
          size_mb: (stat.size / 1024 / 1024).toFixed(2),
          created_at: stat.mtime.toISOString(),
        };
      })
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
      total: list.length,
      page,
      limit,
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


// ── REST: Lấy danh sách sản phẩm ─────────────────────────────────────────────
app.get("/api/products", async (_req: any, res: any) => {
  try {
    const products = await loadProducts();
    res.json({ success: true, data: products, total: products.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/products", async (req: any, res: any) => {
  try {
    const { name, category = "tech", affiliate_url = "", hashtags = [], image_url = "", description = "", images = [] } = req.body;
    if (!name) return res.status(400).json({ success: false, error: "name is required" });

    // Upload main thumbnail image to S3
    let finalImageUrl = image_url;
    if (image_url && !image_url.includes(".amazonaws.com/")) {
      finalImageUrl = await uploadImageToS3(image_url);
    }

    // Upload gallery images to S3
    const finalImagesList: string[] = [];
    if (Array.isArray(images) && images.length > 0) {
      for (const img of images) {
        if (img) {
          const uploaded = await uploadImageToS3(img);
          finalImagesList.push(uploaded);
        }
      }
    }

    const DATA_FILE = path.resolve(__dirname, "../data/products.json");
    let products = [];
    if (existsSync(DATA_FILE)) {
      const raw = await fs.readFile(DATA_FILE, "utf-8");
      products = JSON.parse(raw);
    }
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
    };
    products.push(newProduct);
    await fs.writeFile(DATA_FILE, JSON.stringify(products, null, 2), "utf-8");
    res.json({ success: true, data: newProduct });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── REST: Cập nhật sản phẩm ───────────────────────────────────────────────────
app.put("/api/products/:id", async (req: any, res: any) => {
  try {
    const { name, category, affiliate_url, hashtags, enabled, image_url, description, images } = req.body;
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
    if (name !== undefined) products[idx].name = name;
    if (category !== undefined) products[idx].category = category;
    if (affiliate_url !== undefined) products[idx].affiliate_url = affiliate_url;
    if (hashtags !== undefined) products[idx].hashtags = hashtags;
    if (enabled !== undefined) products[idx].enabled = enabled;
    if (description !== undefined) products[idx].description = description;

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


// ── REST: Universal Product Crawler (Shopee, Lazada, TikTok, Tiki, etc.) ───────
app.post("/api/crawl/product", async (req: any, res: any) => {
  const { url } = req.body;
  if (!url || typeof url !== "string") {
    return res.status(400).json({ success: false, error: "Missing URL" });
  }

  let browser: any = null;
  try {
    console.log(`🕷️  Universal crawl: ${url}`);
    const puppeteer = await import("puppeteer");

    browser = await puppeteer.default.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor",
        "--lang=vi-VN,vi",
        "--window-size=1440,900",
        "--user-data-dir=/tmp/puppeteer-crawl",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // Rotate through realistic user agents
    const userAgents = [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
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
      // Hide webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // Fake plugins
      Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
      // Fake languages
      Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
      // Fake platform
      Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
      // Override chrome
      window.chrome = { runtime: {} };
    })()`);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });

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
    const raw = await page.evaluate(`(function() {

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
      const htmlContent = await page.content();
      await fs.writeFile(path.join(DATA_DIR, "crawled_page.html"), htmlContent, "utf-8");
      await page.screenshot({ path: path.join(DATA_DIR, "crawled_screenshot.png") });
      console.log(`📸 Debug files saved: /data/crawled_page.html & /data/crawled_screenshot.png`);
    } catch (debugErr: any) {
      console.warn("⚠️ Failed to save debug files:", debugErr.message);
    }

    await browser.close();
    browser = null;

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
      if (/thực phẩm|bánh kẹo|snack|cafe|cà phê|trà sữa|đồ uống|gạo|mì gói|nước ngọt/i.test(t)) {
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
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

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
    if (browser) { try { await browser.close(); } catch {} }
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

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ success: false, error: "GEMINI_API_KEY not configured" });
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

app.post("/api/pipeline/run", async (req: any, res: any) => {
  try {
    const {
      product_id,
      product_name,
      category = "tech",
      dry_run = false,
      upload_s3 = true,
      publish_tiktok = true,
    } = req.body;

    let product;
    if (product_id) {
      const products = await loadProducts();
      product = products.find((p: any) => p.id === product_id);
      if (!product) return res.status(404).json({ success: false, error: `Product not found: ${product_id}` });
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
      return res.json({ success: true, status: "already_running", message: "Chrome already running with debug port" });
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

    // Launch Chrome
    const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    const { spawn } = await import("child_process");
    const proc = spawn(chromePath, [
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${chromeAutoDir}`,
      "--no-first-run",
      "--no-default-browser-check",
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
    await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });

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
      { name: "generate_prompt", description: "Sinh Veo prompt từ tên sản phẩm dùng Gemini Flash" },
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

// ─── Start Server ─────────────────────────────────────────────────────────────
async function main() {
  await ensureDataDir();

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

  app.listen(PORT, () => {
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
    console.log("║   → generate_prompt    (Gemini Flash → Veo prompt)         ║");
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
}

main().catch((err) => {
  console.error("💥 Fatal error:", err);
  process.exit(1);
});
