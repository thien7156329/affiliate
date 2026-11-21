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
  hasPlaylistWriteScope?: boolean;
  clientId?: string;
  redirectUri?: string;
  channelTitle?: string;
  channelId?: string;
  avatarUrl?: string;
  error?: string;
}

export interface YoutubePlaylistItem {
  id: string;
  title: string;
  description?: string;
  itemCount?: number;
  privacyStatus?: string;
  thumbnailUrl?: string;
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
  playlistId?: string;
  playlistTitle?: string;
  videoFormat?: "short" | "long";
}

export function normalizePlaylistTitleByFormat(
  rawTitle: string,
  videoFormat: "short" | "long" = "short"
): string {
  const trimmed = (rawTitle || "").replace(/[<>]/g, "").trim();
  if (!trimmed) return "";

  const targetTag = videoFormat === "long" ? "[Video Dài]" : "[Shorts]";
  const hasShortsTag = /\[\s*shorts?\s*\]|\(\s*shorts?\s*\)/i.test(trimmed);
  const hasLongTag = /\[\s*video\s*dài\s*\]|\(\s*video\s*dài\s*\)/i.test(trimmed);

  // If it has the opposite tag, replace it with targetTag
  if (videoFormat === "long" && hasShortsTag) {
    return trimmed
      .replace(/\[\s*shorts?\s*\]|\(\s*shorts?\s*\)/gi, targetTag)
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  if (videoFormat === "short" && hasLongTag) {
    return trimmed
      .replace(/\[\s*video\s*dài\s*\]|\(\s*video\s*dài\s*\)/gi, targetTag)
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  // Already tagged properly
  if ((videoFormat === "long" && hasLongTag) || (videoFormat === "short" && hasShortsTag)) {
    return trimmed;
  }

  // Insert format tag right after leading emoji(s) if present, otherwise prepend
  const leadingEmojiMatch = trimmed.match(/^((?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]\uFE0F?\s*)+)(.+)$/u);
  if (leadingEmojiMatch) {
    const emojiPart = leadingEmojiMatch[1].trim();
    const restText = leadingEmojiMatch[2].trim();
    return `${emojiPart} ${targetTag} ${restText}`;
  }

  return `${targetTag} ${trimmed}`;
}

export interface YoutubeUploadResult {
  success: boolean;
  videoId?: string;
  youtubeUrl?: string;
  shortsUrl?: string;
  title?: string;
  privacyStatus?: string;
  playlistId?: string;
  playlistTitle?: string;
  playlistUrl?: string;
  playlistWarning?: string;
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
      "https://www.googleapis.com/auth/youtube",
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
    const scopeStr = String(tokens?.scope || "");
    const hasPlaylistWriteScope =
      scopeStr.split(/\s+/).includes("https://www.googleapis.com/auth/youtube") ||
      scopeStr.includes("youtube.force-ssl");

    return {
      configured: true,
      authenticated: true,
      hasPlaylistWriteScope,
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
  // YouTube Data API limits total tag characters to 500.
  // CRITICAL: YouTube calculates tag bytes with quotes for tags with spaces (adding 2 characters) plus 1 byte per delimiter comma.
  let calculatedYtBytes = 0;
  for (const rawTag of tags) {
    const cleanTag = String(rawTag)
      .replace(/[<>]/g, "")
      .replace(/^#+/, "")
      .trim()
      .slice(0, 100);
    if (!cleanTag) continue;
    // Overhead: +2 if contains space, +1 for delimiter
    const tagCost = cleanTag.length + (cleanTag.includes(" ") ? 2 : 0) + 1;
    if (calculatedYtBytes + tagCost <= 420) {
      sanitizedTags.push(cleanTag);
      calculatedYtBytes += tagCost;
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

  let finalPlaylistId: string | undefined;
  let finalPlaylistTitle: string | undefined;
  let finalPlaylistUrl: string | undefined;
  let playlistWarning: string | undefined;

  if (params.playlistId || params.playlistTitle) {
    try {
      const plRes = await ensureAndAddVideoToPlaylist({
        videoId,
        playlistId: params.playlistId,
        playlistTitle: params.playlistTitle,
        privacyStatus,
        videoFormat: params.videoFormat,
      });
      finalPlaylistId = plRes.playlistId;
      finalPlaylistTitle = plRes.playlistTitle;
      finalPlaylistUrl = plRes.playlistId
        ? `https://www.youtube.com/playlist?list=${plRes.playlistId}`
        : undefined;
      if (plRes.warning) playlistWarning = plRes.warning;
    } catch (plErr: any) {
      playlistWarning = plErr.message;
      console.warn(`⚠️ [YouTube Playlist] Không thể thêm video vào playlist: ${plErr.message}`);
    }
  }

  return {
    success: true,
    videoId,
    youtubeUrl,
    shortsUrl,
    title,
    privacyStatus,
    playlistId: finalPlaylistId,
    playlistTitle: finalPlaylistTitle,
    playlistUrl: finalPlaylistUrl,
    playlistWarning,
  };
}

export async function listYoutubePlaylists(): Promise<YoutubePlaylistItem[]> {
  const oauth2Client = getOAuth2Client();
  const tokens = getStoredTokens();
  if (!oauth2Client || !tokens) return [];

  try {
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });
    const res = await youtube.playlists.list({
      part: ["snippet", "contentDetails", "status"],
      mine: true,
      maxResults: 50,
    });
    return (res.data.items || []).map((item) => ({
      id: item.id || "",
      title: item.snippet?.title || "Playlist không tên",
      description: item.snippet?.description || "",
      itemCount: item.contentDetails?.itemCount ?? 0,
      privacyStatus: item.status?.privacyStatus || "public",
      thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || undefined,
    })).filter((p) => Boolean(p.id));
  } catch (err: any) {
    console.warn(`⚠️ [YouTube Playlist] Không thể tải danh sách playlist: ${err.message}`);
    return [];
  }
}

export async function createYoutubePlaylist(
  title: string,
  description: string = "",
  privacyStatus: "public" | "unlisted" | "private" = "public"
): Promise<YoutubePlaylistItem> {
  const cleanTitle = title.replace(/[<>]/g, "").trim().slice(0, 140);
  if (!cleanTitle) throw new Error("Tên Playlist không được để trống!");

  const oauth2Client = getOAuth2Client();
  const tokens = getStoredTokens();
  if (!oauth2Client || !tokens) {
    throw new Error("Chưa đăng nhập kênh YouTube!");
  }

  // Check if playlist with exact same title already exists to prevent duplicates
  const existing = await listYoutubePlaylists();
  const matched = existing.find((p) => p.title.trim().toLowerCase() === cleanTitle.toLowerCase());
  if (matched) {
    return matched;
  }

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  try {
    const res = await youtube.playlists.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: cleanTitle,
          description: (description || `Tuyển tập video chuyên đề: ${cleanTitle}`).replace(/[<>]/g, "").slice(0, 4500),
          defaultLanguage: "vi",
        },
        status: {
          privacyStatus,
        },
      },
    });
    const item = res.data;
    console.log(`📂 [YouTube Playlist] Đã tạo Playlist mới "${cleanTitle}" (ID: ${item.id})`);
    return {
      id: item.id || "",
      title: item.snippet?.title || cleanTitle,
      description: item.snippet?.description || "",
      itemCount: 0,
      privacyStatus: item.status?.privacyStatus || privacyStatus,
    };
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes("insufficientPermissions") || msg.includes("Insufficient Permission")) {
      throw new Error(
        "Tài khoản YouTube hiện tại cần cấp thêm quyền Quản lý Playlist (1 click ở nút 'Cấp quyền Playlist' bên trên)."
      );
    }
    throw err;
  }
}

export async function ensureAndAddVideoToPlaylist(params: {
  videoId: string;
  playlistId?: string;
  playlistTitle?: string;
  privacyStatus?: "public" | "unlisted" | "private";
  videoFormat?: "short" | "long";
}): Promise<{ playlistId?: string; playlistTitle?: string; warning?: string }> {
  const oauth2Client = getOAuth2Client();
  const tokens = getStoredTokens();
  if (!oauth2Client || !tokens) {
    return { warning: "Chưa kết nối YouTube" };
  }

  const fmt: "short" | "long" = params.videoFormat === "long" ? "long" : "short";
  let targetId = (params.playlistId || "").trim();
  let targetTitle = (params.playlistTitle || "").trim();

  // Safeguard: verify targetId doesn't belong to the opposite format (e.g. putting Long 16:9 into [Shorts] or Short 9:16 into [Video Dài])
  if (targetId) {
    const existingList = await listYoutubePlaylists();
    const foundById = existingList.find((p) => p.id === targetId);
    if (foundById) {
      const isShortsPl = /\[\s*shorts?\s*\]|\(\s*shorts?\s*\)/i.test(foundById.title);
      const isLongPl = /\[\s*video\s*dài\s*\]|\(\s*video\s*dài\s*\)/i.test(foundById.title);
      if ((fmt === "long" && isShortsPl) || (fmt === "short" && isLongPl)) {
        console.log(
          `🔀 [YouTube Playlist] Tách biệt định dạng: Bỏ qua playlist "${foundById.title}" vì video đang đăng là ${fmt === "long" ? "Video Dài 16:9" : "Shorts 9:16"}.`
        );
        targetId = "";
        targetTitle = normalizePlaylistTitleByFormat(targetTitle || foundById.title, fmt);
      } else if (!targetTitle) {
        targetTitle = foundById.title;
      }
    }
  }

  if (!targetId && targetTitle) {
    targetTitle = normalizePlaylistTitleByFormat(targetTitle, fmt);
    const descPrefix =
      fmt === "long"
        ? "Tuyển tập Video Dài (16:9) phân tích chuyên sâu"
        : "Tuyển tập Video Ngắn (YouTube Shorts 9:16) súc tích";
    const created = await createYoutubePlaylist(
      targetTitle,
      `${descPrefix} — ${targetTitle}`,
      params.privacyStatus || "public"
    );
    targetId = created.id;
    targetTitle = created.title;
  }

  if (!targetId) return {};

  const youtube = google.youtube({ version: "v3", auth: oauth2Client });
  try {
    await youtube.playlistItems.insert({
      part: ["snippet"],
      requestBody: {
        snippet: {
          playlistId: targetId,
          resourceId: {
            kind: "youtube#video",
            videoId: params.videoId,
          },
        },
      },
    });
    console.log(`✅ [YouTube Playlist] Đã thêm video ${params.videoId} vào Playlist "${targetTitle || targetId}"!`);
    return { playlistId: targetId, playlistTitle: targetTitle };
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg.includes("insufficientPermissions") || msg.includes("Insufficient Permission")) {
      return {
        playlistId: targetId,
        playlistTitle: targetTitle,
        warning: "Cần bấm '🔄 Cấp quyền Playlist' 1 lần để tự động gán video vào Danh sách phát trên YouTube.",
      };
    }
    throw err;
  }
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
