import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, "../data");
const CONFIG_FILE = path.join(DATA_DIR, "facebook_config.json");

export interface FacebookPageInfo {
  id: string;
  name: string;
  category?: string;
  avatarUrl?: string;
  accessToken: string;
  canPost: boolean;
}

export interface FacebookConfig {
  accessToken: string;
  pageId?: string;
}

export interface FacebookStatus {
  success: boolean;
  configured: boolean;
  authenticated: boolean;
  tokenType?: "user" | "page";
  userName?: string;
  userId?: string;
  pages: Array<{
    id: string;
    name: string;
    category?: string;
    avatarUrl?: string;
    canPost: boolean;
  }>;
  selectedPage?: {
    id: string;
    name: string;
    category?: string;
    avatarUrl?: string;
  };
  error?: string;
}

export interface FacebookUploadParams {
  filePath: string;
  title: string;
  description: string;
  pageId?: string;
  videoType?: "reel" | "feed" | "auto"; // "reel" = Video ngắn (Reels/Shorts), "feed" = Video chuẩn
}

export interface FacebookUploadResult {
  success: boolean;
  videoId?: string;
  postUrl?: string;
  reelUrl?: string;
  videoType?: "reel" | "feed";
  pageId?: string;
  pageName?: string;
  error?: string;
}


/**
 * Lấy cấu hình Facebook từ file config hoặc process.env
 */
export function getFacebookConfig(): FacebookConfig {
  let fileConfig: Partial<FacebookConfig> = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch {}

  const accessToken = (
    process.env.FB_ACCESS_TOKEN ||
    process.env.FACEBOOK_ACCESS_TOKEN ||
    fileConfig.accessToken ||
    ""
  ).trim();

  const pageId = (
    process.env.FB_PAGE_ID ||
    process.env.FACEBOOK_PAGE_ID ||
    fileConfig.pageId ||
    ""
  ).trim();

  return { accessToken, pageId };
}

/**
 * Lưu cấu hình Facebook vào data/facebook_config.json và cập nhật runtime env
 */
export function saveFacebookConfig(config: Partial<FacebookConfig>): FacebookConfig {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const current = getFacebookConfig();
  const updated: FacebookConfig = {
    accessToken: config.accessToken !== undefined ? config.accessToken.trim() : current.accessToken,
    pageId: config.pageId !== undefined ? config.pageId.trim() : current.pageId,
  };

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2), "utf-8");

  // Đồng bộ sang process.env
  if (updated.accessToken) process.env.FB_ACCESS_TOKEN = updated.accessToken;
  if (updated.pageId) process.env.FB_PAGE_ID = updated.pageId;

  return updated;
}

/**
 * Kiểm tra token và lấy thông tin User / Fanpages từ Graph API
 */
export async function getFacebookStatus(): Promise<FacebookStatus> {
  const config = getFacebookConfig();

  if (!config.accessToken) {
    return {
      success: true,
      configured: false,
      authenticated: false,
      pages: [],
      error: "Chưa cấu hình FB_ACCESS_TOKEN trong .env hoặc cài đặt.",
    };
  }

  try {
    // 1. Kiểm tra thông tin chủ sở hữu token (/me)
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name,picture.type(large)&access_token=${encodeURIComponent(
        config.accessToken
      )}`
    );
    const meData = await meRes.json();

    if (meData.error) {
      return {
        success: false,
        configured: true,
        authenticated: false,
        pages: [],
        error: meData.error.message || "Token Facebook không hợp lệ hoặc đã hết hạn.",
      };
    }

    const userName = meData.name;
    const userId = meData.id;

    // 2. Thử lấy danh sách các Fanpage mà tài khoản này quản lý (/me/accounts)
    const accountsRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,category,access_token,tasks,picture.type(large)&access_token=${encodeURIComponent(
        config.accessToken
      )}`
    );
    const accountsData = await accountsRes.json();

    const pages: FacebookPageInfo[] = [];

    if (accountsData?.data && Array.isArray(accountsData.data)) {
      for (const p of accountsData.data) {
        const canPost = Array.isArray(p.tasks)
          ? p.tasks.includes("CREATE_CONTENT") || p.tasks.includes("MANAGE")
          : true;
        pages.push({
          id: p.id,
          name: p.name,
          category: p.category,
          avatarUrl: p.picture?.data?.url || "",
          accessToken: p.access_token || config.accessToken,
          canPost,
        });
      }
    }

    // 3. Nếu /me/accounts không có trang nào nhưng /me thành công:
    // Có thể chính token này là Page Access Token trực tiếp
    let tokenType: "user" | "page" = "user";
    if (pages.length === 0) {
      // Kiểm tra xem /me có phải là Page hay không
      const pageCheckRes = await fetch(
        `https://graph.facebook.com/v21.0/me?fields=id,name,category,picture.type(large)&access_token=${encodeURIComponent(
          config.accessToken
        )}`
      );
      const pageCheckData = await pageCheckRes.json();
      if (pageCheckData && !pageCheckData.error) {
        tokenType = "page";
        pages.push({
          id: pageCheckData.id,
          name: pageCheckData.name,
          category: pageCheckData.category,
          avatarUrl: pageCheckData.picture?.data?.url || "",
          accessToken: config.accessToken,
          canPost: true,
        });
      }
    }

    // 4. Chọn page hiện tại
    let selectedPage: FacebookPageInfo | undefined;
    if (config.pageId) {
      selectedPage = pages.find((p) => p.id === config.pageId);
    }
    if (!selectedPage && pages.length > 0) {
      selectedPage = pages[0];
    }

    return {
      success: true,
      configured: true,
      authenticated: true,
      tokenType,
      userName,
      userId,
      pages: pages.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        avatarUrl: p.avatarUrl,
        canPost: p.canPost,
      })),
      selectedPage: selectedPage
        ? {
            id: selectedPage.id,
            name: selectedPage.name,
            category: selectedPage.category,
            avatarUrl: selectedPage.avatarUrl,
          }
        : undefined,
    };
  } catch (err: any) {
    return {
      success: false,
      configured: true,
      authenticated: false,
      pages: [],
      error: `Lỗi kết nối Facebook Graph API: ${err.message}`,
    };
  }
}

/**
 * Lấy Access Token của một Page cụ thể
 */
async function getPageAccessToken(targetPageId: string): Promise<{ token: string; pageName: string }> {
  const config = getFacebookConfig();
  if (!config.accessToken) {
    throw new Error("Chưa cấu hình FB_ACCESS_TOKEN");
  }

  // Thử tìm trong /me/accounts
  try {
    const accountsRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(
        config.accessToken
      )}`
    );
    const accountsData = await accountsRes.json();
    if (accountsData?.data && Array.isArray(accountsData.data)) {
      const match = accountsData.data.find((p: any) => p.id === targetPageId);
      if (match?.access_token) {
        return { token: match.access_token, pageName: match.name };
      }
    }
  } catch {}

  // Fallback: nếu chính token trong env đã là Page token
  try {
    const meRes = await fetch(
      `https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(
        config.accessToken
      )}`
    );
    const meData = await meRes.json();
    if (meData?.id === targetPageId) {
      return { token: config.accessToken, pageName: meData.name || "Fanpage" };
    }
  } catch {}

  // Nếu targetPageId không truyền hoặc không tìm thấy, dùng config.accessToken
  return { token: config.accessToken, pageName: "Fanpage" };
}

/**
 * Đăng video ngắn dưới dạng Facebook Reels (3-Phase Publishing API)
 */
async function uploadReelToFacebookInternal(
  filePath: string,
  targetPageId: string,
  pageAccessToken: string,
  pageName: string,
  caption: string
): Promise<FacebookUploadResult> {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;

  console.log(`🎬 [Facebook Reels] Bước 1/3: Khởi tạo phiên upload Reel cho "${pageName}" (${targetPageId})...`);

  // 1. Phase 1: Start
  const startRes = await fetch(`https://graph.facebook.com/v21.0/${targetPageId}/video_reels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      upload_phase: "start",
      access_token: pageAccessToken,
    }),
  });
  const startData = await startRes.json();

  if (startData.error || !startData.upload_url || !startData.video_id) {
    throw new Error(
      startData.error?.message || "Không thể khởi tạo phiên Reels API trên Facebook."
    );
  }

  const { video_id: videoId, upload_url: uploadUrl } = startData;
  console.log(`🎬 [Facebook Reels] Đã cấp Video ID: ${videoId}. Bước 2/3: Đang truyền dữ liệu video (${(fileSize / (1024 * 1024)).toFixed(2)} MB)...`);

  // 2. Phase 2: Transfer binary
  const fileBuffer = await fs.promises.readFile(filePath);
  const transferRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${pageAccessToken}`,
      offset: "0",
      file_size: String(fileSize),
      "Content-Type": "application/octet-stream",
    },
    body: fileBuffer,
  });
  const transferData = await transferRes.json();

  if (transferData.error) {
    throw new Error(transferData.error?.message || "Lỗi truyền dữ liệu file sang máy chủ Meta Reels.");
  }

  console.log(`🎬 [Facebook Reels] Đã tải xong dữ liệu. Bước 3/3: Hoàn tất xuất bản Reel...`);

  // 3. Phase 3: Finish
  const finishRes = await fetch(`https://graph.facebook.com/v21.0/${targetPageId}/video_reels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      upload_phase: "finish",
      access_token: pageAccessToken,
      video_id: videoId,
      video_state: "PUBLISHED",
      description: caption,
    }),
  });
  const finishData = await finishRes.json();

  if (finishData.error) {
    throw new Error(finishData.error?.message || "Lỗi xác nhận xuất bản Facebook Reel.");
  }

  const reelUrl = `https://www.facebook.com/reel/${videoId}`;
  const postUrl = `https://www.facebook.com/${targetPageId}/videos/${videoId}`;

  console.log(`🎉 [Facebook Reels] Xuất bản Reel thành công! ID: ${videoId}, Reel: ${reelUrl}`);

  return {
    success: true,
    videoId,
    postUrl,
    reelUrl,
    videoType: "reel",
    pageId: targetPageId,
    pageName,
  };
}

/**
 * Tải file video lên Fanpage Facebook qua Graph Video API (Hỗ trợ Reels / Shorts và Standard Video)
 */
export async function uploadVideoToFacebook(
  params: FacebookUploadParams
): Promise<FacebookUploadResult> {
  const { filePath, title, description, pageId, videoType = "reel" } = params;

  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      error: `File video không tồn tại trên server: ${filePath}`,
    };
  }

  const config = getFacebookConfig();
  const targetPageId = pageId || config.pageId;

  if (!targetPageId) {
    // Nếu chưa có targetPageId, thử lấy page đầu tiên từ status
    const status = await getFacebookStatus();
    if (status.pages.length === 0) {
      return {
        success: false,
        error:
          "Không tìm thấy Fanpage nào được liên kết với token này. Hãy đảm bảo token có quyền 'pages_show_list' và 'pages_manage_posts'.",
      };
    }
    return uploadVideoToFacebook({
      ...params,
      pageId: status.pages[0].id,
    });
  }

  const { token: pageAccessToken, pageName } = await getPageAccessToken(targetPageId);

  // Tạo caption hoàn chỉnh
  let caption = description.trim();
  if (title && !caption.includes(title)) {
    caption = `${title.trim()}\n\n${caption}`;
  }

  // 1. Thử đăng dạng Facebook Reel nếu videoType là "reel" hoặc "auto"
  if (videoType === "reel" || videoType === "auto") {
    try {
      const reelResult = await uploadReelToFacebookInternal(
        filePath,
        targetPageId,
        pageAccessToken,
        pageName,
        caption
      );
      return reelResult;
    } catch (reelErr: any) {
      console.warn(`⚠️ [Facebook Reels] Đăng Reel gặp lỗi (${reelErr.message}). Đang tự động chuyển sang upload Video chuẩn...`);
      // Tiếp tục xuống dưới để fallback sang standard video upload
    }
  }

  // 2. Standard Video Upload (Graph Video API)
  try {
    console.log(`🚀 [Facebook] Bắt đầu đẩy video chuẩn lên Fanpage: "${pageName}" (${targetPageId})...`);
    console.log(`📁 File: ${filePath}`);

    const fileBuffer = await fs.promises.readFile(filePath);
    const blob = new Blob([fileBuffer], { type: "video/mp4" });

    const formData = new FormData();
    formData.append("access_token", pageAccessToken);
    if (title) formData.append("title", title);
    if (caption) formData.append("description", caption);
    formData.append("source", blob, path.basename(filePath));

    // Endpoint Graph Video API
    const uploadUrl = `https://graph-video.facebook.com/v21.0/${targetPageId}/videos`;

    const res = await fetch(uploadUrl, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();

    if (data.error) {
      console.error("❌ [Facebook API Error]:", data.error);
      return {
        success: false,
        error: data.error.message || `Lỗi Facebook Graph API (Code: ${data.error.code})`,
        pageId: targetPageId,
        pageName,
      };
    }

    const videoId = data.id;
    const postUrl = `https://www.facebook.com/${targetPageId}/videos/${videoId}`;

    console.log(`✅ [Facebook] Đẩy video lên FB thành công! ID: ${videoId}, URL: ${postUrl}`);

    return {
      success: true,
      videoId,
      postUrl,
      reelUrl: `https://www.facebook.com/reel/${videoId}`,
      videoType: "feed",
      pageId: targetPageId,
      pageName,
    };
  } catch (err: any) {
    console.error("❌ [Facebook Upload Exception]:", err);
    return {
      success: false,
      error: `Lỗi upload lên Facebook: ${err.message}`,
      pageId: targetPageId,
      pageName,
    };
  }
}

