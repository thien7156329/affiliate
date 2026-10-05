import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");
const CONFIG_FILE = path.join(DATA_DIR, "youtube_config.json");
const TOKENS_FILE = path.join(DATA_DIR, "youtube_tokens.json");

export interface YoutubeConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface YoutubeChannelStatus {
  configured: boolean;
  authenticated: boolean;
  clientId?: string;
  redirectUri?: string;
  channelTitle?: string;
  channelId?: string;
  avatarUrl?: string;
  error?: string;
}

export interface YoutubeUploadParams {
  filePath: string;
  thumbnailPath?: string;
  title: string;
  description: string;
  tags?: string[];
  privacyStatus?: "public" | "unlisted" | "private";
  madeForKids?: boolean;
  categoryId?: string;
}

export interface YoutubeUploadResult {
  success: boolean;
  videoId?: string;
  youtubeUrl?: string;
  shortsUrl?: string;
  title?: string;
  privacyStatus?: string;
  error?: string;
}

export function getYoutubeConfig(): YoutubeConfig {
  let fileConfig: Partial<YoutubeConfig> = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {}

  const port = process.env.PORT || "3400";
  const defaultRedirect = `http://localhost:${port}/api/youtube/callback`;

  return {
    clientId: (process.env.YOUTUBE_CLIENT_ID || fileConfig.clientId || "").trim(),
    clientSecret: (process.env.YOUTUBE_CLIENT_SECRET || fileConfig.clientSecret || "").trim(),
    redirectUri: (process.env.YOUTUBE_REDIRECT_URI || fileConfig.redirectUri || defaultRedirect).trim(),
  };
}

export function saveYoutubeConfig(config: Partial<YoutubeConfig>): YoutubeConfig {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const current = getYoutubeConfig();
  const updated: YoutubeConfig = {
    clientId: config.clientId !== undefined ? config.clientId.trim() : current.clientId,
    clientSecret: config.clientSecret !== undefined ? config.clientSecret.trim() : current.clientSecret,
    redirectUri: config.redirectUri !== undefined ? config.redirectUri.trim() : current.redirectUri,
  };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

function getStoredTokens(): any | null {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      return JSON.parse(fs.readFileSync(TOKENS_FILE, "utf-8"));
    }
  } catch {}
  return null;
}

function saveStoredTokens(tokens: any): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), "utf-8");
}

export function getOAuth2Client() {
  const config = getYoutubeConfig();
  if (!config.clientId || !config.clientSecret) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  const tokens = getStoredTokens();
  if (tokens) {
    oauth2Client.setCredentials(tokens);
  }

  oauth2Client.on("tokens", (newTokens) => {
    const existing = getStoredTokens() || {};
    const merged = { ...existing, ...newTokens };
    saveStoredTokens(merged);
    console.log("🔑 [YouTube] Refreshed and persisted OAuth tokens.");
  });

  return oauth2Client;
}

export function getYoutubeAuthUrl(): string {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    throw new Error("Chưa cấu hình Google Client ID & Client Secret!");
  }

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "select_account consent",
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
    ],
  });
}

export async function handleYoutubeAuthCallback(code: string): Promise<any> {
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    throw new Error("Chưa cấu hình Google Client ID & Client Secret!");
  }

  const { tokens } = await oauth2Client.getToken(code);
  saveStoredTokens(tokens);
  oauth2Client.setCredentials(tokens);
  console.log("✅ [YouTube] Successfully authorized and stored tokens!");
  return tokens;
}

export async function getYoutubeStatus(): Promise<YoutubeChannelStatus> {
  const config = getYoutubeConfig();
  const configured = !!(config.clientId && config.clientSecret);
  const tokens = getStoredTokens();

  if (!configured) {
    return {
      configured: false,
      authenticated: false,
      clientId: "",
      redirectUri: config.redirectUri,
    };
  }

  if (!tokens) {
    return {
      configured: true,
      authenticated: false,
      clientId: config.clientId ? `${config.clientId.slice(0, 12)}...` : "",
      redirectUri: config.redirectUri,
    };
  }

  try {
    const oauth2Client = getOAuth2Client();
    if (!oauth2Client) throw new Error("Could not initialize OAuth client");

    const youtube = google.youtube({ version: "v3", auth: oauth2Client });
    const res = await youtube.channels.list({
      part: ["snippet"],
      mine: true,
    });

    const channel = res.data.items?.[0];
    return {
      configured: true,
      authenticated: true,
      clientId: config.clientId ? `${config.clientId.slice(0, 12)}...` : "",
      redirectUri: config.redirectUri,
      channelTitle: channel?.snippet?.title || "Kênh YouTube của bạn",
      channelId: channel?.id || undefined,
      avatarUrl: channel?.snippet?.thumbnails?.default?.url || undefined,
    };
  } catch (err: any) {
    return {
      configured: true,
      authenticated: false,
      clientId: config.clientId ? `${config.clientId.slice(0, 12)}...` : "",
      redirectUri: config.redirectUri,
      error: `Token hết hạn hoặc lỗi xác thực: ${err.message}`,
    };
  }
}

export function disconnectYoutube(): boolean {
  try {
    if (fs.existsSync(TOKENS_FILE)) {
      fs.unlinkSync(TOKENS_FILE);
    }
    return true;
  } catch {
    return false;
  }
}

export async function uploadVideoToYouTube(params: YoutubeUploadParams): Promise<YoutubeUploadResult> {
  const { filePath, thumbnailPath, title, description, tags = [], privacyStatus = "public", madeForKids = false, categoryId = "1" } = params;

  if (!fs.existsSync(filePath)) {
    throw new Error(`File video không tồn tại tại: ${filePath}`);
  }

  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) {
    throw new Error("Chưa cấu hình Google Client ID & Client Secret!");
  }

  const tokens = getStoredTokens();
  if (!tokens) {
    throw new Error("Chưa đăng nhập / liên kết tài khoản YouTube!");
  }

  // YouTube Data API v3 strictly forbids '<' and '>' characters in title, description, and tags.
  // Including them causes: "The request metadata specifies an invalid video description."
  const sanitizedTitle = (title || "Video Hoạt Hình #Shorts")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 100);

  const sanitizedDescription = (description || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 5000);

  const sanitizedTags: string[] = [];
  let totalTagsLength = 0;
  for (const rawTag of tags) {
    const cleanTag = String(rawTag).replace(/[<>]/g, "").trim().slice(0, 100);
    if (cleanTag && totalTagsLength + cleanTag.length + 1 <= 480) {
      sanitizedTags.push(cleanTag);
      totalTagsLength += cleanTag.length + 1;
    }
  }

  console.log(`\n🚀 [YouTube Upload] Bắt đầu upload video "${sanitizedTitle}" lên YouTube...`);
  console.log(`   File: ${filePath} (${(fs.statSync(filePath).size / (1024 * 1024)).toFixed(1)} MB)`);
  if (thumbnailPath) console.log(`   Thumbnail / Avatar: ${thumbnailPath}`);
  console.log(`   Privacy: ${privacyStatus} | Made for kids: ${madeForKids} | Category: ${categoryId}`);

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });

  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title: sanitizedTitle,
        description: sanitizedDescription,
        tags: sanitizedTags,
        categoryId,
        defaultLanguage: "vi",
        defaultAudioLanguage: "vi",
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: madeForKids,
      },
    },
    media: {
      body: fs.createReadStream(filePath),
    },
  });

  const videoId = response.data.id;
  if (!videoId) {
    throw new Error("YouTube API không trả về Video ID sau khi upload!");
  }

  // Upload custom thumbnail / avatar if provided
  if (thumbnailPath && fs.existsSync(thumbnailPath)) {
    try {
      console.log(`🖼️ [YouTube Thumbnail] Đang tải avatar/thumbnail lên cho video ${videoId}...`);
      const ext = path.extname(thumbnailPath).toLowerCase();
      const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
      await youtube.thumbnails.set({
        videoId,
        media: {
          mimeType,
          body: fs.createReadStream(thumbnailPath),
        },
      });
      console.log(`✅ [YouTube Thumbnail] Đã đặt thumbnail/avatar thành công cho video ${videoId}!`);
    } catch (thumbErr: any) {
      console.warn(`⚠️ [YouTube Thumbnail] Không thể đặt thumbnail (${thumbErr.message}). Kênh cần xác minh số điện thoại trên YouTube để bật quyền đặt thumbnail tùy chỉnh.`);
    }
  }

  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const shortsUrl = `https://www.youtube.com/shorts/${videoId}`;

  console.log(`🎉 [YouTube Upload] Upload thành công! Video ID: ${videoId}`);
  console.log(`   Watch URL: ${youtubeUrl}`);
  console.log(`   Shorts URL: ${shortsUrl}`);

  return {
    success: true,
    videoId,
    youtubeUrl,
    shortsUrl,
    title,
    privacyStatus,
  };
}

export async function updateVideoThumbnail(videoId: string, thumbnailPath: string): Promise<boolean> {
  if (!fs.existsSync(thumbnailPath)) {
    throw new Error(`File thumbnail không tồn tại: ${thumbnailPath}`);
  }
  const oauth2Client = getOAuth2Client();
  if (!oauth2Client) throw new Error("Chưa cấu hình Google Client ID & Client Secret!");
  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  const ext = path.extname(thumbnailPath).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
  await youtube.thumbnails.set({
    videoId,
    media: {
      mimeType,
      body: fs.createReadStream(thumbnailPath),
    },
  });
  console.log(`✅ [YouTube Thumbnail] Đã cập nhật avatar/thumbnail thành công cho video ${videoId}!`);
  return true;
}
