import puppeteer, { Browser, Page, ElementHandle } from "puppeteer";
import path from "path";
import fs from "fs";
import os from "os";
import { execSync } from "child_process";
import { ensureChromeRunning } from "./veoAutomation.js";

export interface TikTokUploadOptions {
  videoFilePath: string;
  title: string;
  caption?: string;
  tags?: string[];
  mode?: "post" | "draft"; // "post" = Đăng công khai, "draft" = Lưu bản nháp
  visibility?: "public" | "friends" | "private"; // "public" = Mọi người (công khai), "friends" = Bạn bè, "private" = Chỉ mình bạn
  debugPort?: number;
}

export interface TikTokUploadResult {
  success: boolean;
  mode: "post" | "draft";
  message: string;
  targetUrl?: string;
  error?: string;
}

const DEFAULT_DEBUG_PORT = parseInt(process.env.CHROME_DEBUG_PORT || "9222", 10);
const LOG_FILE = path.resolve(process.cwd(), "data/tiktok_bot.log");

function logBot(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(LOG_FILE, line + "\n", "utf8");
  } catch {}
}

/**
 * An toàn evaluate trong Puppeteer, tự động retry nếu Frame đang render lại
 * (ngăn lỗi: "Attempted to use detached Frame" hoặc "Execution context was destroyed")
 */
async function safeEvaluate<T>(
  page: Page,
  fn: (...args: any[]) => T,
  ...args: any[]
): Promise<T | null> {
  for (let i = 0; i < 5; i++) {
    try {
      if (page.isClosed()) return null;
      return await page.evaluate(fn, ...args);
    } catch (err: any) {
      const msg = err.message || "";
      if (
        msg.includes("detached Frame") ||
        msg.includes("Execution context was destroyed") ||
        msg.includes("Cannot find context") ||
        msg.includes("Target closed")
      ) {
        logBot(`⚠️ Frame đang re-render (${msg.slice(0, 45)}...), thử lại lần ${i + 1}/5...`);
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      throw err;
    }
  }
  return null;
}

/**
 * Đợi trạng thái DOM thỏa mãn điều kiện, an toàn trước detached frames
 */
async function waitForElementState(
  page: Page,
  predicate: () => boolean,
  timeoutMs = 60000,
  intervalMs = 1000
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (page.isClosed()) return false;
    try {
      const res = await page.evaluate(predicate);
      if (res) return true;
    } catch {
      // Bỏ qua lỗi tạm thời khi frame bị reload
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Kiểm tra xem ~/ChromeAuto có file Cookies chứa session TikTok không
 */
function hasChromeAutoTikTokCookies(): boolean {
  try {
    const cookiePath = path.join(os.homedir(), "ChromeAuto/Default/Cookies");
    if (!fs.existsSync(cookiePath)) return false;
    const buffer = fs.readFileSync(cookiePath);
    return buffer.includes(Buffer.from("tiktok.com")) && buffer.includes(Buffer.from("sessionid"));
  } catch {
    return false;
  }
}

/**
 * Kiểm tra trạng thái kết nối TikTok Studio qua Chrome DevTools Protocol
 */
export async function checkTikTokConnection(
  port: number = DEFAULT_DEBUG_PORT,
  autoLaunch: boolean = true
): Promise<{
  connected: boolean;
  loggedIn: boolean;
  username?: string;
  message: string;
}> {
  try {
    let versionRes = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);

    // Nếu Chrome chưa chạy và cho phép tự khởi động, khởi động ChromeAuto
    if ((!versionRes || !versionRes.ok) && autoLaunch) {
      logBot(`🌐 [TikTokBot] Chrome chưa mở trên port ${port}, đang tự động khởi chạy ChromeAuto...`);
      try {
        await ensureChromeRunning();
        versionRes = await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null);
      } catch (err: any) {
        logBot(`⚠️ [TikTokBot] Không thể tự khởi chạy ChromeAuto: ${err.message}`);
      }
    }

    if (!versionRes || !versionRes.ok) {
      return {
        connected: false,
        loggedIn: false,
        message: `Chrome chưa mở cổng Remote Debugging (port ${port}). Hãy bấm 'Mở Chrome TikTok' để khởi động tự động.`,
      };
    }

    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${port}`,
      defaultViewport: null,
    });

    const page = (await browser.pages())[0] || (await browser.newPage());
    const client = await page.createCDPSession();

    // Kiểm tra cookies TikTok
    const cookieRes = await client.send("Network.getCookies", {
      urls: ["https://www.tiktok.com", "https://tiktok.com", "https://seller-vn.tiktok.com"],
    });

    const hasSession = cookieRes.cookies.some((c) =>
      ["sessionid", "sessionid_ss", "sid_tt", "uid_tt"].includes(c.name)
    );

    await client.detach().catch(() => {});
    browser.disconnect();

    if (!hasSession) {
      const chromeAutoHasCookies = hasChromeAutoTikTokCookies();
      if (chromeAutoHasCookies) {
        return {
          connected: true,
          loggedIn: false,
          message: "Chrome đang mở không có tài khoản TikTok. Hãy bấm 'Khởi động lại Chrome TikTok' để kết nối đúng tài khoản.",
        };
      }
      return {
        connected: true,
        loggedIn: false,
        message: "Chrome đang mở nhưng chưa đăng nhập TikTok. Hãy bấm 'Mở Chrome TikTok' để đăng nhập vào tài khoản của bạn.",
      };
    }

    return {
      connected: true,
      loggedIn: true,
      username: "TikTok Studio (Le / Mây TV)",
      message: "Đã sẵn sàng tải lên TikTok Studio!",
    };
  } catch (err: any) {
    return {
      connected: false,
      loggedIn: false,
      message: `Lỗi kết nối Chrome: ${err.message}`,
    };
  }
}

/**
 * Khởi động hoặc đưa ChromeAuto lên trước màn hình, mở tab TikTok Studio
 */
export async function launchOrFocusTikTokChrome(
  port: number = DEFAULT_DEBUG_PORT
): Promise<{
  success: boolean;
  connected: boolean;
  loggedIn: boolean;
  message: string;
}> {
  try {
    logBot(`🚀 [TikTokBot] Khởi động / Kiểm tra phiên ChromeAuto cho TikTok (port ${port})...`);

    // Kiểm tra xem port hiện tại có TikTok session không
    let status = await checkTikTokConnection(port, false);
    if (status.connected && !status.loggedIn && hasChromeAutoTikTokCookies()) {
      logBot(`🔄 [TikTokBot] Phát hiện phiên Chrome trên port ${port} không phải ChromeAuto, ngắt để mở đúng ChromeAuto...`);
      try {
        const lsofOutput = execSync(`lsof -ti :${port}`, { encoding: "utf8" }).trim();
        if (lsofOutput) {
          const pids = lsofOutput.split(/\s+/).filter(Boolean);
          for (const pid of pids) {
            try {
              process.kill(parseInt(pid, 10), "SIGKILL");
            } catch {}
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch {}
    }

    // Đảm bảo ChromeAuto đang chạy
    await ensureChromeRunning();
    await new Promise((r) => setTimeout(r, 1000));

    // Kết nối và mở tab TikTok Studio Upload
    const browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${port}`,
      defaultViewport: null,
    });

    const pages = await browser.pages();
    let tiktokPage = pages.find((p) => p.url().includes("tiktok.com"));

    if (!tiktokPage) {
      tiktokPage = await browser.newPage();
      await tiktokPage.goto("https://www.tiktok.com/tiktokstudio/upload?from=upload", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      }).catch(() => {});
    } else {
      await tiktokPage.bringToFront();
    }

    // Đưa cửa sổ lên trước
    try {
      const session = await tiktokPage.createCDPSession();
      const { windowId } = await session.send("Browser.getWindowForTarget");
      if (windowId) {
        await session.send("Browser.setWindowBounds", {
          windowId,
          bounds: { windowState: "normal", left: 100, top: 100, width: 1280, height: 900 },
        });
      }
      await session.detach();
    } catch {}

    browser.disconnect();

    // Kiểm tra lại trạng thái sau khi mở
    status = await checkTikTokConnection(port, false);
    return {
      success: true,
      connected: status.connected,
      loggedIn: status.loggedIn,
      message: status.loggedIn
        ? "Đã mở TikTok Studio thành công và tài khoản đã sẵn sàng!"
        : "Đã mở cửa sổ Chrome. Vui lòng đăng nhập tài khoản TikTok trên trình duyệt, sau đó bấm 'Làm mới'!",
    };
  } catch (err: any) {
    logBot(`❌ [TikTokBot] Lỗi khởi chạy Chrome: ${err.message}`);
    return {
      success: false,
      connected: false,
      loggedIn: false,
      message: `Không thể khởi động Chrome: ${err.message}`,
    };
  }
}

/**
 * Tự động đăng hoặc lưu nháp video lên TikTok Studio qua Puppeteer Bot
 */
export async function uploadVideoToTikTokViaBot(
  options: TikTokUploadOptions
): Promise<TikTokUploadResult> {
  const {
    videoFilePath,
    title,
    caption = "",
    tags = [],
    mode = "post",
    visibility = "public",
    debugPort = DEFAULT_DEBUG_PORT,
  } = options;

  logBot(`\n🎵 [TikTokBot] Bắt đầu tiến trình upload video:`);
  logBot(`   File: ${videoFilePath}`);
  logBot(`   Title: ${title}`);
  logBot(`   Chế độ: ${mode === "post" ? "🚀 ĐĂNG CÔNG KHAI" : "📝 LƯU BẢN NHÁP"}`);
  logBot(`   Quyền riêng tư: ${visibility.toUpperCase()}`);

  if (!fs.existsSync(videoFilePath)) {
    throw new Error(`Không tìm thấy file video tại: ${videoFilePath}`);
  }

  // Chuẩn bị toàn bộ Caption + Hashtags sạch sẽ không trùng lặp
  const tagSet = new Set<string>();
  const addTag = (raw: string) => {
    const cleaned = raw.replace(/^#/, "").replace(/\s+/g, "").trim();
    if (cleaned) tagSet.add(`#${cleaned}`);
  };

  tags.forEach(addTag);
  if (tagSet.size < 2 && ((caption || "").match(/#[\p{L}\p{N}_]+/gu) || []).length < 2) {
    ["MayTV", "HaiHuoc", "3DAnimation", "Comedy", "FunnyShorts"].forEach(addTag);
  }

  // Ghép Caption và Hashtags chuẩn TikTok (tránh ký tự \n làm crash React ErrorBoundary của Draft.js).
  // Caption từ UI thường đã có sẵn Tiêu đề ở dòng đầu và Hashtag ở cuối → không lặp lại lần 2.
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  let capBody = (caption || "").trim();
  if (capBody && norm(capBody).startsWith(norm(title))) {
    capBody = capBody.slice(title.trim().length).trim();
  }
  // Hashtag đã có trong caption → bỏ khỏi caption body, gom chung vào 1 dòng tag duy nhất
  const captionTags = capBody.match(/#[\p{L}\p{N}_]+/gu) || [];
  capBody = capBody.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ").replace(/[ \t]+/g, " ").trim();
  const finalTags = new Set<string>();
  for (const t of [...captionTags, ...tagSet]) {
    const key = t.toLowerCase();
    if (![...finalTags].some((x) => x.toLowerCase() === key)) finalTags.add(t);
  }
  const formattedTags = Array.from(finalTags);

  const captionParts: string[] = [title.trim()];
  if (capBody) captionParts.push(capBody.replace(/\s*\r?\n+\s*/g, " - ").replace(/^-\s*|\s*-$/g, ""));
  if (formattedTags.length > 0) captionParts.push(formattedTags.join(" "));
  const fullCaptionText = captionParts.join(" | ");
  logBot(`   Caption: ${fullCaptionText.slice(0, 160)}${fullCaptionText.length > 160 ? "…" : ""}`);

  // Đảm bảo ChromeAuto đang chạy
  await ensureChromeRunning();

  // Kết nối Chrome
  let browser: Browser;
  try {
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${debugPort}`,
      defaultViewport: null,
    });
  } catch (err: any) {
    throw new Error(
      `Không thể kết nối Chrome qua port ${debugPort}. Hãy bấm nút 'Mở Chrome TikTok' để khởi chạy.`
    );
  }

  const page: Page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  try {
    // Dọn các tab upload cũ bị treo nếu có
    const existingPages = await browser.pages();
    for (const p of existingPages) {
      if (p !== page && p.url().includes("tiktokstudio/upload")) {
        await p.close().catch(() => {});
      }
    }

    logBot(`🌐 [TikTokBot] Đang mở TikTok Studio Upload...`);
    await page.goto("https://www.tiktok.com/tiktokstudio/upload?from=upload", {
      waitUntil: "domcontentloaded",
      timeout: 35000,
    });

    // Chờ 3 giây kiểm tra xem có bị chuyển hướng sang login không
    await new Promise((r) => setTimeout(r, 3000));
    if (page.url().includes("/login")) {
      throw new Error(
        "Tài khoản TikTok chưa đăng nhập hoặc phiên đăng nhập đã hết hạn. Vui lòng đăng nhập TikTok trên Chrome rồi thử lại!"
      );
    }

    // Tìm input file upload (tìm cả ở main document lẫn iframe nếu có)
    logBot(`📤 [TikTokBot] Tìm kiếm input file upload...`);
    let fileInput: ElementHandle<HTMLInputElement> | null = null;

    for (let attempt = 0; attempt < 15; attempt++) {
      const directInput = await page.$("input[type=file]");
      if (directInput) {
        fileInput = directInput as ElementHandle<HTMLInputElement>;
        break;
      }
      for (const frame of page.frames()) {
        const frameInput = await frame.$("input[type=file]");
        if (frameInput) {
          fileInput = frameInput as ElementHandle<HTMLInputElement>;
          break;
        }
      }
      if (fileInput) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    if (!fileInput) {
      throw new Error(
        "Không tìm thấy khung tải file video của TikTok Studio. Hãy kiểm tra tab TikTok trên Chrome."
      );
    }

    logBot(`📤 [TikTokBot] Đang inject file video vào TikTok Studio (${videoFilePath})...`);
    await fileInput.uploadFile(path.resolve(videoFilePath));
    logBot(`⏳ [TikTokBot] Đã đưa file vào form, chờ TikTok xử lý và hiển thị khung mô tả...`);

    // Chờ khung soạn thảo Draft.js hydrate span text đầy đủ
    const editorReady = await waitForElementState(
      page,
      () => {
        const span = document.querySelector(".notranslate.public-DraftEditor-content span[data-text=\"true\"]");
        return !!span;
      },
      45000
    );

    if (!editorReady) {
      logBot("⚠️ Khung editor chưa sẵn sàng sau 45s, tiếp tục kiểm tra...");
    }

    await new Promise((r) => setTimeout(r, 2500));

    // Điền Tiêu đề và Caption vào khung soạn thảo Draft.js (dùng safeEvaluate chống detached frame)
    logBot(`✍️ [TikTokBot] Đang cập nhật caption và hashtags...`);
    const insertResult = await safeEvaluate(
      page,
      (textToInsert: string) => {
        const editor = document.querySelector(".notranslate.public-DraftEditor-content") as HTMLElement;
        if (!editor) return false;

        editor.focus();
        const sel = window.getSelection();
        sel?.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(editor);
        sel?.addRange(range);

        document.execCommand("delete", false);
        document.execCommand("insertText", false, textToInsert);
        return true;
      },
      fullCaptionText
    );

    // Nếu execCommand không thành công, thử gõ bằng bàn phím
    if (!insertResult) {
      const editorHandle = await page.$(".notranslate.public-DraftEditor-content");
      if (editorHandle) {
        await editorHandle.click().catch(() => {});
        await page.keyboard.down("Meta");
        await page.keyboard.press("KeyA");
        await page.keyboard.up("Meta");
        await page.keyboard.press("Backspace");
        await page.keyboard.type(fullCaptionText, { delay: 10 });
      }
    }

    await new Promise((r) => setTimeout(r, 2000));

    // Đóng các tooltip / popup thông báo hướng dẫn của TikTok Studio nếu có
    await safeEvaluate(page, () => {
      const allBtns = Array.from(document.querySelectorAll("button"));
      const dismissBtn = allBtns.find((b) => {
        const t = (b.innerText || b.textContent || "").trim().toLowerCase();
        return t === "đã hiểu" || t === "got it" || t === "bỏ qua";
      });
      if (dismissBtn) dismissBtn.click();
    });

    // ── THIẾT LẬP QUYỀN RIÊNG TƯ / CHẾ ĐỘ HIỂN THỊ (PUBLIC / MỌI NGƯỜI) ──
    const targetVal = visibility === "private" ? "1" : visibility === "friends" ? "2" : "0";
    const targetLabel =
      visibility === "private"
        ? "Riêng tư (Chỉ mình bạn)"
        : visibility === "friends"
        ? "Bạn bè"
        : "Công khai (Mọi người)";
    logBot(`👁️ [TikTokBot] Đang kiểm tra và thiết lập quyền riêng tư: ${targetLabel}...`);

    const setVisibilityResult = await safeEvaluate(
      page,
      async (valStr: string) => {
        // Tìm combobox chọn quyền xem
        const comboboxes = Array.from(
          document.querySelectorAll("button[role=\"combobox\"], .Select__trigger")
        );
        const visCombo = comboboxes.find((b: any) => {
          const t = (b.innerText || b.textContent || "").trim().toLowerCase();
          return (
            t.includes("mọi người") ||
            t.includes("bạn bè") ||
            t.includes("chỉ mình") ||
            t.includes("everyone") ||
            t.includes("private") ||
            t.includes("friends") ||
            t.includes("public")
          );
        }) as HTMLElement | undefined;

        if (!visCombo) return { success: false, reason: "Không tìm thấy nút chọn quyền riêng tư" };

        const currentText = (visCombo.innerText || visCombo.textContent || "").trim().toLowerCase();
        const isAlreadyTarget =
          (valStr === "0" && (currentText.includes("mọi người") || currentText.includes("everyone") || currentText.includes("public"))) ||
          (valStr === "1" && (currentText.includes("chỉ mình") || currentText.includes("only you") || currentText.includes("private"))) ||
          (valStr === "2" && (currentText.includes("bạn bè") || currentText.includes("friends")));

        // Nếu đã ở đúng quyền hiển thị mục tiêu, giữ nguyên không click mở dropdown
        if (isAlreadyTarget) {
          return { success: true, text: (visCombo.innerText || "").trim(), alreadySet: true };
        }

        // Nếu chưa đúng, chủ động click mở dropdown
        visCombo.click();
        await new Promise((r) => setTimeout(r, 600));

        // Tìm option tương ứng qua id: option-"0", option-"1", option-"2" hoặc text
        const options = Array.from(document.querySelectorAll("[role=\"option\"], .Select__item"));
        const opt = options.find((o: any) => {
          const id = (o.getAttribute("id") || "").toLowerCase();
          const v = o.getAttribute("data-value") || "";
          const t = (o.innerText || o.textContent || "").toLowerCase();
          if (valStr === "0") {
            return id.includes("\"0\"") || id.includes("0") || v === "\"0\"" || t.includes("mọi người") || t.includes("everyone") || t.includes("public");
          }
          if (valStr === "1") {
            return id.includes("\"1\"") || id.includes("1") || v === "\"1\"" || t.includes("chỉ mình") || t.includes("only you") || t.includes("private");
          }
          if (valStr === "2") {
            return id.includes("\"2\"") || id.includes("2") || v === "\"2\"" || t.includes("bạn bè") || t.includes("friends");
          }
          return false;
        }) as HTMLElement | undefined;

        if (opt) {
          opt.click();
          await new Promise((r) => setTimeout(r, 500));
          return { success: true, text: (visCombo.innerText || "").trim() };
        }

        // Đóng dropdown nếu không khớp option
        visCombo.click();
        return { success: false, reason: "Không tìm thấy option tương ứng trong menu" };
      },
      targetVal
    );

    if (setVisibilityResult?.success) {
      logBot(`✅ [TikTokBot] Đã áp dụng quyền riêng tư: ${setVisibilityResult.text || targetLabel}`);
    } else {
      logBot(`⚠️ [TikTokBot] Cảnh báo quyền riêng tư: ${setVisibilityResult?.reason || "Không thể chuyển quyền"}`);
    }

    await new Promise((r) => setTimeout(r, 1000));

    if (mode === "draft") {
      // ── CHẾ ĐỘ: LƯU BẢN NHÁP ──
      logBot(`⏳ [TikTokBot] Đang chờ nút 'Lưu bản nháp' sẵn sàng...`);
      const isDraftReady = await waitForElementState(
        page,
        () => {
          const btns = Array.from(document.querySelectorAll("button"));
          const draftBtn = btns.find((b) => {
            const t = (b.innerText || b.textContent || "").trim().toLowerCase();
            return (
              (t.includes("lưu bản nháp") || t.includes("bản nháp") || t.includes("save draft") || t.includes("draft")) &&
              !b.disabled &&
              b.getAttribute("aria-disabled") !== "true"
            );
          });
          return !!draftBtn;
        },
        90000 // Chờ tối đa 90 giây cho video dung lượng lớn
      );

      if (!isDraftReady) {
        throw new Error("Hết thời gian chờ video xử lý hoặc nút 'Lưu bản nháp' không sẵn sàng.");
      }

      logBot(`📝 [TikTokBot] Nhấn nút 'Lưu bản nháp'...`);
      const clicked = await safeEvaluate(page, () => {
        const btns = Array.from(document.querySelectorAll("button"));
        const draftBtn = btns.find((b) => {
          const t = (b.innerText || b.textContent || "").trim().toLowerCase();
          return (
            (t.includes("lưu bản nháp") || t.includes("bản nháp") || t.includes("save draft") || t.includes("draft")) &&
            !b.disabled &&
            b.getAttribute("aria-disabled") !== "true"
          );
        });
        if (draftBtn) {
          draftBtn.click();
          return true;
        }
        return false;
      });

      if (!clicked) {
        throw new Error("Không thể click nút 'Lưu bản nháp'. Có thể video đang xử lý.");
      }

      // Đợi chuyển hướng sang tab draft hoặc hiển thị xác nhận
      await waitForElementState(
        page,
        () => {
          const href = window.location.href;
          const body = document.body.innerText || document.body.textContent || "";
          return (
            href.includes("tab=draft") ||
            body.includes("Bản nháp") ||
            body.includes("Draft") ||
            body.includes("đã lưu")
          );
        },
        25000
      );

      logBot(`✅ [TikTokBot] Đã lưu bản nháp thành công vào TikTok Studio!`);
      return {
        success: true,
        mode: "draft",
        message: "Đã lưu bản nháp video thành công vào TikTok Studio! Bạn có thể kiểm tra và gắn link TikTok Shop trên điện thoại trước khi đăng.",
        targetUrl: page.url(),
      };
    } else {
      // ── CHẾ ĐỘ: ĐĂNG CÔNG KHAI ──
      logBot(`⏳ [TikTokBot] Đang chờ nút 'Đăng' sẵn sàng...`);
      const isPostReady = await waitForElementState(
        page,
        () => {
          const btns = Array.from(document.querySelectorAll("button"));
          const postBtn = btns.find((b) => {
            const t = (b.innerText || b.textContent || "").trim().toLowerCase();
            return (
              (t === "đăng" || t === "post" || t.includes("đăng ngay")) &&
              !b.disabled &&
              b.getAttribute("aria-disabled") !== "true"
            );
          });
          return !!postBtn;
        },
        90000 // Chờ tối đa 90 giây
      );

      if (!isPostReady) {
        throw new Error("Hết thời gian chờ video xử lý hoặc nút 'Đăng' không sẵn sàng.");
      }

      logBot(`🚀 [TikTokBot] Nhấn nút 'Đăng'...`);
      const clicked = await safeEvaluate(page, () => {
        const btns = Array.from(document.querySelectorAll("button"));
        const postBtn = btns.find((b) => {
          const t = (b.innerText || b.textContent || "").trim().toLowerCase();
          return (
            (t === "đăng" || t === "post" || t.includes("đăng ngay")) &&
            !b.disabled &&
            b.getAttribute("aria-disabled") !== "true"
          );
        });
        if (postBtn) {
          postBtn.click();
          return true;
        }
        return false;
      });

      if (!clicked) {
        throw new Error("Không thể click nút 'Đăng'. Nút có thể đang bị vô hiệu hóa.");
      }

      // Xử lý popup xác nhận nếu có (Ví dụ: Kiểm tra bản quyền âm thanh -> Vẫn đăng / Xác nhận)
      await new Promise((r) => setTimeout(r, 2000));
      await safeEvaluate(page, () => {
        const btns = Array.from(document.querySelectorAll("button"));
        const confirmBtn = btns.find((b) => {
          const t = (b.innerText || b.textContent || "").trim().toLowerCase();
          return (
            (t === "vẫn đăng" ||
              t === "xác nhận" ||
              t === "tiếp tục đăng" ||
              t === "đăng ngay" ||
              t === "post anyway" ||
              t === "confirm") &&
            !b.disabled &&
            b.getAttribute("aria-disabled") !== "true"
          );
        });
        if (confirmBtn) {
          confirmBtn.click();
        }
      });

      // Đợi phản hồi hoàn tất đăng
      await waitForElementState(
        page,
        () => {
          const href = window.location.href;
          const body = document.body.innerText || document.body.textContent || "";
          return (
            href.includes("/content") ||
            body.includes("Quản lý bài đăng") ||
            body.includes("Đã tải lên video") ||
            body.includes("Bài đăng của bạn đã được xuất bản") ||
            body.includes("Video của bạn đã được đăng") ||
            body.includes("Manage posts")
          );
        },
        35000
      );

      logBot(`🎉 [TikTokBot] Đã đăng video thành công lên trang cá nhân TikTok!`);
      return {
        success: true,
        mode: "post",
        message: "Đã đăng video thành công lên kênh TikTok của bạn! 🎉",
        targetUrl: page.url(),
      };
    }
  } catch (err: any) {
    logBot(`❌ [TikTokBot] Lỗi trong quá trình upload: ${err.message}`);
    throw err;
  } finally {
    await new Promise((r) => setTimeout(r, 2000));
    await page.close().catch(() => {});
    browser.disconnect();
  }
}
