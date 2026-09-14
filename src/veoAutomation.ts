/**
 * Veo Automation — Uses Puppeteer to automate:
 * 1. Connect to the currently running Chrome (Remote Debugging) — OR launch new
 * 2. Type Veo prompt into Gemini Web
 * 3. Wait for video generation to complete
 * 4. Intercept video MP4 URL from network requests
 * 5. Download MP4 to local storage
 *
 * SETUP (one-time): Launch Chrome with remote debugging enabled:
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *     --remote-debugging-port=9222 --no-first-run --no-default-browser-check
 *
 * Then set in .env:
 *   CHROME_DEBUG_PORT=9222
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync, execFileSync, execFile, spawn } from "child_process";
import os from "os";
import axios from "axios";
import { randomUUID } from "crypto";

/**
 * Gets the name of the currently active macOS application process.
 */
export function getFrontmostApp(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    return execSync(
      `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
      { encoding: "utf8", timeout: 1000 }
    ).trim();
  } catch {
    return null;
  }
}

/**
 * Restores macOS window focus to the user's previously active application
 * so Chrome automation never steals typing or mouse focus.
 */
export function restoreUserFocus(targetApp?: string | null): void {
  if (process.platform !== "darwin") return;
  const app = targetApp && targetApp !== "Google Chrome" ? targetApp : null;
  if (!app) return;
  try {
    execFileSync(
      "osascript",
      ["-e", `tell application "System Events" to set frontmost of (first process whose name is "${app}") to true`],
      { timeout: 1000, stdio: "ignore" }
    );
  } catch {}
}

/**
 * Ensures the Chrome window is placed off-screen so it never renders over or flashes on the user's workspace.
 */
export async function ensureWindowOffscreen(page: any): Promise<void> {
  try {
    const session = await page.createCDPSession();
    const { windowId } = await session.send("Browser.getWindowForTarget");
    if (windowId) {
      await session.send("Browser.setWindowBounds", {
        windowId,
        bounds: {
          windowState: "normal",
          left: 3000,
          top: 100,
          width: 1280,
          height: 900,
        },
      });
    }
    await session.detach();
  } catch {}
}

/**
 * Opens a new Puppeteer page completely in the background:
 * 1. Captures the user's current frontmost app.
 * 2. Creates the new tab.
 * 3. Locks window bounds off-screen (left: 3000, top: 100).
 * 4. Instantly restores focus to the user's active application.
 */
export async function createBackgroundPage(browser: any): Promise<any> {
  const prevApp = getFrontmostApp();
  const page = await browser.newPage();
  await ensureWindowOffscreen(page);
  restoreUserFocus(prevApp);
  return page;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOADS_DIR = path.resolve(__dirname, "../data/downloads");

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

/**
 * Resolves container path to host machine path when running in Docker with host Chrome.
 */
export function toHostPath(containerPath: string): string {
  if (!containerPath) return containerPath;
  const isDocker = fs.existsSync("/.dockerenv") || process.env.DOCKER === "true";
  if (!isDocker) return containerPath;

  const hostWorkspace = process.env.HOST_WORKSPACE_DIR || "/Users/letrongthien/Downloads/projects/affiliate";
  if (containerPath.startsWith("/app/")) {
    return path.join(hostWorkspace, containerPath.slice(5));
  }
  if (containerPath.startsWith("/app")) {
    return path.join(hostWorkspace, containerPath.slice(4));
  }
  return containerPath;
}

const CHROME_USER_DATA_DIR =
  process.env.CHROME_USER_DATA_DIR ||
  `${process.env.HOME}/Library/Application Support/Google/Chrome`;
const CHROME_PROFILE = process.env.CHROME_PROFILE || "Default";
const CHROME_DEBUG_PORT = process.env.CHROME_DEBUG_PORT || "9222";
const GEMINI_VEO_URL = "https://gemini.google.com/app";

export interface VeoResult {
  success: boolean;
  localPath?: string;
  thumbnailPath?: string;
  videoUrl?: string;
  error?: string;
  prompt: string;
  durationMs: number;
  connectionMode?: "remote" | "profile_copy";
}


/**
 * Open Gemini Web via Puppeteer and generate a Veo video from the given prompt.
 *
 * Connection strategy:
 *   1. Try to connect to existing Chrome on CHROME_DEBUG_PORT (fast, keeps login)
 *   2. Fall back to launching Chrome with a full profile copy
 */
export async function generateVeoVideo(prompt: string, imageUrl?: string): Promise<VeoResult> {
  const startTime = Date.now();
  let browser: any = null;
  let page: any = null;
  let ownsBrowser = false; // Whether WE launched the browser (need to close it)
  let localImagePath: string | null = null;

  // ── Cleanup old temp files in downloads directory (> 10 minutes old) ─────
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const now = Date.now();
    const tenMinutesAgo = now - 10 * 60 * 1000;
    for (const file of files) {
      if (file.startsWith("gemini_upload_") || file.startsWith("veo_")) {
        const filePath = path.join(DOWNLOADS_DIR, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs < tenMinutesAgo) {
            fs.unlinkSync(filePath);
            console.log(`🗑️  [VeoAuto] Cleaned up old temp file: ${file}`);
          }
        } catch {}
      }
    }
  } catch (err: any) {
    console.warn(`⚠️  [VeoAuto] Failed to run downloads cleanup: ${err.message}`);
  }

  console.log(`🎬 [VeoAuto] Starting video generation for prompt:\n   "${prompt.slice(0, 80)}..."`);
  if (imageUrl) {
    console.log(`   Product image: ${imageUrl}`);
  }

  // Download image if imageUrl is provided
  if (imageUrl) {
    try {
      console.log(`📸 [VeoAuto] Downloading product image for Gemini: ${imageUrl}`);
      let fetchUrl = imageUrl;
      if (imageUrl.includes(".amazonaws.com/")) {
        const parts = imageUrl.split(".amazonaws.com/");
        if (parts.length > 1) {
          const key = parts[1];
          const port = process.env.PORT || "3400";
          fetchUrl = `http://127.0.0.1:${port}/api/products/image-proxy?key=${encodeURIComponent(key)}`;
        }
      } else if (imageUrl.startsWith("/")) {
        const port = process.env.PORT || "3400";
        fetchUrl = `http://127.0.0.1:${port}${imageUrl}`;
      }

      const response = await axios.get(fetchUrl, { responseType: "arraybuffer", timeout: 15000 });
      const contentType = String(response.headers["content-type"] ?? "image/jpeg");
      const ext = contentType.split("/")[1] || "jpg";
      const tempFilename = `gemini_upload_${randomUUID().split("-")[0]}.${ext}`;
      localImagePath = path.join(DOWNLOADS_DIR, tempFilename);
      fs.writeFileSync(localImagePath, response.data);
      console.log(`✅ [VeoAuto] Downloaded product image to local path: ${localImagePath}`);
    } catch (err: any) {
      console.warn(`⚠️  [VeoAuto] Failed to download product image for upload: ${err.message}`);
      localImagePath = null;
    }
  }

  try {
    // Dynamic import
    let puppeteer: any;
    try {
      // @ts-ignore
      puppeteer = (await import("puppeteer")).default;
    } catch {
      throw new Error("puppeteer is not installed. Run: npm install puppeteer");
    }

    // ── Auto-launch ChromeAuto if not already running ────────────────────────
    await ensureChromeRunning();

    // ── Strategy 1: Connect to existing Chrome via Remote Debugging ──────────
    let connectionMode: "remote" | "profile_copy" = "remote";
    try {
      const debugUrl = `http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version`;
      const checkRes = await fetch(debugUrl).catch(() => null);

      if (checkRes && checkRes.ok) {
        const info = await checkRes.json() as any;
        console.log(`🔗 [VeoAuto] Connecting to existing Chrome: ${info.Browser}`);
        browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${CHROME_DEBUG_PORT}`,
          defaultViewport: null,
        });
        ownsBrowser = false;
        console.log("✅ [VeoAuto] Connected to running Chrome (keeps your session!)");
      } else {
        throw new Error("No Chrome on debug port");
      }
    } catch (connectErr: any) {
      // ── Strategy 2: Launch Chrome with full profile copy ─────────────────
      console.log(`⚠️  [VeoAuto] Cannot connect to debug port: ${connectErr.message}`);
      console.log("🔄 [VeoAuto] Falling back to profile copy launch...");

      connectionMode = "profile_copy";
      const tempProfileDir = copyProfileToTemp();

      browser = await puppeteer.launch({
        executablePath: getChromePath(),
        userDataDir: tempProfileDir,
        args: [
          `--profile-directory=${CHROME_PROFILE}`,
          "--window-position=3000,100",
          "--window-size=1280,900",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
        ],
        headless: false,
        defaultViewport: { width: 1280, height: 900 },
      });
      ownsBrowser = true;
    }

    page = await createBackgroundPage(browser);

    // Enable CDP session to intercept file downloads
    const client = await page.createCDPSession();
    const downloadDir = path.resolve(__dirname, "../data/downloads");
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
    await client.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: toHostPath(downloadDir),
    }).catch(() => {});

    // Intercept network responses to capture video URLs
    let capturedVideoUrl: string | null = null;
    let isPromptSubmitted = false;
    page.on("response", async (response: any) => {
      if (!isPromptSubmitted) return;
      const url = response.url();
      const contentType = response.headers()["content-type"] || "";
      const isVideo = contentType.includes("video/") ||
        url.includes(".mp4") || url.includes("videoplayback") ||
        url.includes("video-downloads") || url.includes("generativelanguage") ||
        url.includes("aiusercontent") || url.includes("usercontent.google") ||
        (url.includes("google") && (contentType.includes("octet-stream") && url.length > 100));

      if (isVideo && !capturedVideoUrl && !url.startsWith("blob:")) {
        capturedVideoUrl = url;
        console.log(`🎯 [VeoAuto] Captured video URL: ${url.slice(0, 100)}`);
      }
    });

    console.log(`🌐 [VeoAuto] Opening Gemini Web: ${GEMINI_VEO_URL}`);
    await page.goto(GEMINI_VEO_URL, { waitUntil: "networkidle2", timeout: 60_000 });

    // Check login status
    const isLoggedIn = await page.evaluate(() => {
      return !document.querySelector('a[href*="signin"], button[data-label="Sign in"], .sign-in-btn');
    });
    if (!isLoggedIn) {
      console.warn("⚠️  [VeoAuto] Gemini page may not be logged in");
    }

    // ── Navigate to Gemini Video section ─────────────────────────────────────
    console.log("🎥 [VeoAuto] Clicking Video tab in sidebar...");
    try {
      // Wait for sidebar to render
      await page.waitForSelector(
        '[data-test-id="videos-side-nav-entry-button"] a, a[href="/videos"]',
        { timeout: 10_000 }
      );

      // Use evaluate to dispatch a real MouseEvent (triggers Angular router)
      const navClicked = await page.evaluate(() => {
        const link = document.querySelector('[data-test-id="videos-side-nav-entry-button"] a') as HTMLAnchorElement
          || document.querySelector('a[href="/videos"]') as HTMLAnchorElement;
        if (!link) return false;
        link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
      });

      if (navClicked) {
        console.log("✅ [VeoAuto] Video tab clicked — waiting for Video UI to load...");
        await new Promise(r => setTimeout(r, 3000));

        // Verify navigation worked by checking page content
        const inVideoSection = await page.evaluate(() =>
          document.body?.innerText?.includes("Video") &&
          (window.location.href.includes("video") || !!document.querySelector('[data-test-id*="video"]'))
        );
        console.log(`🎥 [VeoAuto] Video section loaded: ${inVideoSection}`);
      }
    } catch (err: any) {
      console.warn(`⚠️  [VeoAuto] Video tab navigation failed: ${err.message} — using main chat fallback`);
    }

    // Wait for input textarea (works in both chat and Video UI)
    console.log("⏳ [VeoAuto] Waiting for input textarea...");
    await page.waitForSelector(
      'rich-textarea [contenteditable="true"], textarea, [contenteditable="true"]',
      { timeout: 30_000 }
    );

    // ── Upload file if provided ──────────────────────────────────────────────
    if (localImagePath && fs.existsSync(localImagePath)) {
      console.log(`📤 [VeoAuto] Uploading image to Gemini: ${localImagePath}`);
      try {
        // 1. Click the upload button (+ icon)
        console.log("🖱️ [VeoAuto] Finding and clicking the upload/tools button...");
        const btnClicked = await page.evaluate(() => {
          const btn = document.querySelector('button[aria-label*="Nội dung tải lên"]') as HTMLButtonElement
            || document.querySelector('button[aria-label*="Upload"]') as HTMLButtonElement
            || document.querySelector('button[aria-label*="công cụ"]') as HTMLButtonElement
            || Array.from(document.querySelectorAll('button')).find(b => b.innerHTML.includes('plus') || b.getAttribute('aria-label')?.includes('Nội dung tải lên'));
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        });
        console.log(`🖱️ [VeoAuto] Upload button clicked: ${btnClicked}`);
        await new Promise(r => setTimeout(r, 1000));

        // 2. Click the "Tải lên từ máy tính" option
        console.log("🖱️ [VeoAuto] Finding and clicking 'Tải lên từ máy tính' menu option...");
        const optionClicked = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('button, [role="menuitem"], .mat-mdc-menu-item, span, div'));
          const uploadItem = items.find(el => {
            const text = el.textContent?.trim() || "";
            return text === "Tải lên từ máy tính" || 
                   text === "Upload from computer" || 
                   text === "Tải lên từ thiết bị" || 
                   text === "Upload from device" ||
                   text.includes("máy tính") ||
                   text.includes("computer");
          }) as HTMLElement;
          if (uploadItem) {
            uploadItem.click();
            return true;
          }
          return false;
        });
        console.log(`🖱️ [VeoAuto] Menu uploader option clicked: ${optionClicked}`);
        await new Promise(r => setTimeout(r, 1000));

        // Wait for at least one file input to appear on the page
        await page.waitForSelector('input[type="file"]', { timeout: 8000 });

        // Log all inputs to backend console for debugging
        const allInputsInfo = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('input[type="file"]')).map((el: any, i) => {
            return `#${i}: id="${el.id}" class="${el.className}" accept="${el.getAttribute('accept')}" parent="${el.parentElement?.tagName}" outer=${el.outerHTML.slice(0, 120)}`;
          });
        });
        console.log(`ℹ️ [VeoAuto] Found inputs:`, allInputsInfo);
        
        // Find the correct file input using advanced heuristic search
        const fileInputHandle = await page.evaluateHandle(() => {
          const inputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
          if (inputs.length === 0) return null;
          
          // Heuristic 0: Find the input that is closest to the active prompt textarea in the DOM tree
          const textarea = document.querySelector('rich-textarea [contenteditable="true"], textarea, [contenteditable="true"]');
          if (textarea) {
            let parent = textarea.parentElement;
            while (parent) {
              const fileInput = parent.querySelector('input[type="file"]') as HTMLInputElement;
              if (fileInput) {
                return fileInput;
              }
              parent = parent.parentElement;
            }
          }
          
          // Heuristic 1: Try to find one inside chat-input or rich-textarea or form
          let match = inputs.find(input => 
            input.closest('chat-input') || 
            input.closest('rich-textarea') || 
            input.closest('form') ||
            input.closest('.chat-input-container')
          );
          if (match) return match;
          
          // Heuristic 2: Try to find one that accepts images/videos or multiple files
          match = inputs.find(input => {
            const accept = input.getAttribute('accept') || '';
            return accept.includes('image') || input.hasAttribute('multiple');
          });
          if (match) return match;
          
          // Heuristic 3: Fallback to the last file input on the page
          return inputs[inputs.length - 1];
        });

        if (fileInputHandle) {
          // Focus the input first
          await page.evaluate((input: any) => {
            if (input) input.focus();
          }, fileInputHandle);

          // Upload the file path
          await (fileInputHandle as any).uploadFile(toHostPath(localImagePath));
          console.log("✅ [VeoAuto] Image uploaded to Gemini file input");
          
          // Wait 4.5s for upload progress to complete and display thumbnail preview
          await new Promise(r => setTimeout(r, 4500));
        } else {
          console.warn("⚠️  [VeoAuto] File input element not found via handle search");
        }
      } catch (uploadErr: any) {
        console.warn(`⚠️  [VeoAuto] Failed to upload image via Puppeteer: ${uploadErr.message}`);
      }
    }

    // Set text in the contenteditable div via DOM injection to prevent typing/clear lag
    console.log("✏️  [VeoAuto] Typing prompt via DOM...");
    const inputSelector = 'rich-textarea [contenteditable="true"], textarea, [contenteditable="true"]';
    await page.evaluate((sel: string, text: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      if (el) {
        el.focus();
        el.innerText = text;
        // Dispatch input and change events to trigger Angular bindings
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Dispatch dummy spaces to update any keyboard listener states
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));
      }
    }, inputSelector, prompt);

    await new Promise(r => setTimeout(r, 1000));

    // Take screenshot to verify before submitting
    const debugDir = path.resolve(__dirname, "../data/debug");
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    await page.screenshot({ path: path.join(debugDir, "before_submit.png") }).catch(() => {});

    // Submit prompt using DOM click on Generate/Send button
    const submitted = await page.evaluate(() => {
      const selectors = [
        'button[aria-label="Gửi tin nhắn"]',
        'button[aria-label*="Gửi" i]',
        'button[aria-label*="Generate" i]',
        'button[aria-label*="Tạo" i]',
        'button[aria-label*="Send" i]',
        'button.send-button',
        'mat-icon[fonticon="arrow_upward"]',
        'button mat-icon[data-mat-icon-name="arrow_upward"]',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel) as HTMLButtonElement;
        // Verify button is not inside a menu, dialog list, or sidebar list
        if (btn && !btn.disabled && !btn.closest('mat-menu-panel') && !btn.closest('navigation-list') && !btn.closest('.sidebar-list') && !btn.closest('[role="menu"]')) {
          btn.click();
          return true;
        }
      }
      
      const btns = Array.from(document.querySelectorAll('button'));
      const targetBtn = btns.find(b => {
        // Bypass buttons inside menus or sidebars to avoid misclicking menu options like "Ghim" / "Pin"
        if (b.closest('mat-menu-panel') || b.closest('navigation-list') || b.closest('.sidebar-list') || b.closest('[role="menu"]') || b.closest('.context-menu')) {
          return false;
        }

        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const text = (b.textContent || '').toLowerCase();
        const html = (b.innerHTML || '').toLowerCase();

        // Exclude menu options explicitly
        const isMenuOption = aria.includes('ghim') || aria.includes('pin') || aria.includes('xóa') || aria.includes('delete') || 
                             aria.includes('sổ') || aria.includes('note') || aria.includes('chia') || aria.includes('share') || 
                             aria.includes('đổi') || aria.includes('rename') || text.includes('ghim') || text.includes('pin') ||
                             text.includes('xóa') || text.includes('delete') || text.includes('chia') || text.includes('share') ||
                             text.includes('đổi') || text.includes('rename');
        if (isMenuOption) return false;

        return aria.includes('generate') || aria.includes('tạo') || aria.includes('gửi') || aria.includes('send') ||
               text.includes('generate') || text.includes('tạo') || text.includes('gửi') || text.includes('send') ||
               html.includes('send') || html.includes('gửi') || html.includes('mat-icon-name="send"');
      });
      if (targetBtn) {
        targetBtn.click();
        return true;
      }
      return false;
    });

    if (submitted) {
      console.log("📤 [VeoAuto] Prompt submitted via Generate/Send button");
    } else {
      console.log("⚠️  [VeoAuto] Generate button not found, falling back to keyboard Enter");
      await page.focus(inputSelector).catch(() => {});
      await page.keyboard.press("Enter");
      console.log("📤 [VeoAuto] Prompt submitted via keyboard Enter");
    }
    isPromptSubmitted = true;

    console.log("⏳ [VeoAuto] Waiting for Veo to generate video (up to 7 minutes)...");
    const screenshotDir = path.resolve(__dirname, "../data/debug");
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

    const pollStart = Date.now();
    const MAX_WAIT_MS = 7 * 60 * 1000;
    let found = false;
    let hasRefreshed = false;
    let downloadButtonClicked = false;

    while (Date.now() - pollStart < MAX_WAIT_MS) {
      await new Promise(r => setTimeout(r, 5000));
      const elapsed = Math.round((Date.now() - pollStart) / 1000);

      // Network-intercepted MP4 → done immediately
      if (capturedVideoUrl) {
        console.log(`🎯 [VeoAuto] Video URL captured via network (${elapsed}s)`);
        found = true;
        break;
      }

      // Proactive check: look for video elements directly (even without "ready" text)
      if (!found) {
        const proactiveVideoSrc = await page.evaluate(() => {
          const videos = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[];
          for (let i = videos.length - 1; i >= 0; i--) {
            const src = videos[i].src || videos[i].currentSrc;
            if (src && !src.startsWith("blob:") && (src.includes("google") || src.includes(".mp4") || src.includes("usercontent"))) {
              return src;
            }
          }
          return null;
        }).catch(() => null);

        if (proactiveVideoSrc) {
          capturedVideoUrl = proactiveVideoSrc;
          found = true;
          console.log(`🎯 [VeoAuto] Proactive video detection at ${elapsed}s: ${proactiveVideoSrc.slice(0, 80)}...`);
          break;
        }
      }

      // Periodic debug screenshots
      if (elapsed % 60 === 0 || elapsed === 10) {
        const ssPath = path.join(screenshotDir, `gemini_${elapsed}s.png`);
        await page.screenshot({ path: ssPath, fullPage: false }).catch(() => {});
        console.log(`📸 [VeoAuto] Debug screenshot at ${elapsed}s: ${ssPath}`);
      }

      // ── After 5 minutes (300s) → reload ONCE ────────────────────────────────
      if (!hasRefreshed && elapsed >= 300) {
        hasRefreshed = true;
        console.log(`🔄 [VeoAuto] 5 minutes passed — reloading page to fix Gemini freeze...`);
        await page.reload({ waitUntil: "networkidle2", timeout: 30_000 }).catch(() => {});
        console.log(`✅ [VeoAuto] Page reloaded — checking conversation for completed video...`);
        await new Promise(r => setTimeout(r, 4000));
      }

      // Check DOM: video ready text + download button
      const pageResult = await page.evaluate(() => {
        // Detect "Your video is ready!" message (English + Vietnamese)
        const bodyText = document.body?.innerText || "";
        const videoReady = bodyText.includes("Your video is ready") ||
                           bodyText.includes("video is ready") ||
                           bodyText.includes("Video của bạn đã sẵn sàng") ||
                           bodyText.includes("video đã sẵn sàng") ||
                           bodyText.includes("video đã được tạo") ||
                           bodyText.includes("video đã xong");

        // Find download button (English + Vietnamese labels)
        const downloadBtn = document.querySelector(
          'button[aria-label*="Download" i], button[aria-label*="download" i], ' +
          'button[aria-label*="Tải" i], button[aria-label*="tải" i], ' +
          'a[download], [data-mat-icon-name="download"]'
        );

        const errorText = document.querySelector(
          '.error-container, [class*="error-message"]'
        )?.textContent?.trim().slice(0, 100);

        return { videoReady, hasDownload: !!downloadBtn, errorText };
      }).catch(() => ({ videoReady: false, hasDownload: false, errorText: null }));

      if (pageResult.videoReady || pageResult.hasDownload) {
        // Try to get video source directly first to avoid navigation-inducing clicks
        const videoSrc = await page.evaluate(() => {
          const downloadBtns = Array.from(document.querySelectorAll('button[aria-label*="Download" i], button[aria-label*="download" i], button[aria-label*="Tải" i], button[aria-label*="tải" i], a[download]'));
          if (downloadBtns.length > 0) {
            const latestBtn = downloadBtns[downloadBtns.length - 1];
            let parent = latestBtn.parentElement;
            let cardContainer = null;
            for (let depth = 0; depth < 12 && parent; parent = parent.parentElement, depth++) {
              if (parent.tagName === 'MESSAGE-CONTENT' || 
                  parent.tagName === 'MS-MESSAGE-CONTENT' || 
                  parent.classList.contains('message-content') || 
                  parent.classList.contains('model-response') ||
                  parent.querySelector('video')) {
                cardContainer = parent;
                break;
              }
            }
            if (cardContainer) {
              const video = cardContainer.querySelector('video') as HTMLVideoElement | null;
              if (video && (video.src || video.currentSrc)) {
                return video.src || video.currentSrc;
              }
              const source = cardContainer.querySelector('video source') as HTMLSourceElement | null;
              if (source && source.src) {
                return source.src;
              }
            }
          }
          // Fallback: If multiple videos are on the page, get the last one
          const videos = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[];
          if (videos.length > 0) {
            const latestVideo = videos[videos.length - 1];
            if (latestVideo && (latestVideo.src || latestVideo.currentSrc)) {
              return latestVideo.src || latestVideo.currentSrc;
            }
          }
          return null;
        }).catch(() => null);

        if (videoSrc) {
          capturedVideoUrl = videoSrc;
          found = true;
          console.log(`🎯 [VeoAuto] Found video element src directly: ${videoSrc.slice(0, 60)}...`);
          break;
        }

        if (!downloadButtonClicked) {
          console.log(`⬇️  [VeoAuto] Video ready at ${elapsed}s — clicking Download button...`);

          // Click download button as fallback (click the latest download button in the DOM)
          const clicked = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll("button, a")).filter(el => {
              const aria = el.getAttribute("aria-label")?.toLowerCase() || "";
              const title = el.getAttribute("title")?.toLowerCase() || "";
              const text = (el.textContent || "").toLowerCase();
              return aria.includes("download") || title.includes("download") ||
                     aria.includes("tải") || title.includes("tải") ||
                     text.includes("tải video") || text.includes("tải về") || text.includes("tải xuống");
            });
            if (buttons.length > 0) {
              const latestBtn = buttons[buttons.length - 1] as HTMLElement;
              latestBtn.click();
              return true;
            }
            return false;
          });

          if (clicked) {
            downloadButtonClicked = true;
            console.log(`✅ [VeoAuto] Download button clicked — waiting for file...`);
            // Wait up to 15s for the file to appear in downloads
            for (let i = 0; i < 15; i++) {
              await new Promise(r => setTimeout(r, 1000));
              const files = fs.readdirSync(downloadDir).filter(f =>
                (f.endsWith(".mp4") || f.endsWith(".webm")) && !f.endsWith(".crdownload")
              );
              if (files.length > 0) {
                capturedVideoUrl = path.join(downloadDir, files[files.length - 1]);
                console.log(`🎬 [VeoAuto] File downloaded: ${capturedVideoUrl}`);
                found = true;
                break;
              }
            }
            if (found) break;
          }
        } else {
          console.log(`⏳ [VeoAuto] Download button fallback already clicked. Waiting for network URL or download completion...`);
        }
      }

      if (capturedVideoUrl) { found = true; break; }

      if (pageResult.errorText) {
        console.warn(`⚠️  [VeoAuto] Gemini error (${elapsed}s): ${pageResult.errorText}`);
      }

      const refreshNote = !hasRefreshed ? ` | auto-reload in ${Math.max(0, 480 - elapsed)}s` : "";
      console.log(`⏳ [VeoAuto] Still waiting... ${elapsed}s elapsed${refreshNote}`);
    }

    if (!found && !capturedVideoUrl) {
      const ssPath = path.join(screenshotDir, `gemini_timeout.png`);
      await page.screenshot({ path: ssPath }).catch(() => {});
      console.log(`📸 [VeoAuto] Timeout screenshot: ${ssPath}`);
      throw new Error(`Timeout after 15 minutes. Check debug screenshot: ${ssPath}`);
    }

    if (!capturedVideoUrl) {
      capturedVideoUrl = await page.evaluate(() => {
        const videos = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[];
        if (videos.length > 0) {
          const latestVideo = videos[videos.length - 1];
          if (latestVideo) return latestVideo.src || latestVideo.currentSrc || null;
        }
        const sources = Array.from(document.querySelectorAll("video source")) as HTMLSourceElement[];
        if (sources.length > 0) {
          const latestSource = sources[sources.length - 1];
          if (latestSource) return latestSource.src || null;
        }
        return null;
      });
    }

    if (!capturedVideoUrl) {
      throw new Error("Could not capture video URL from Gemini Web");
    }

    console.log(`✅ [VeoAuto] Video URL captured: ${capturedVideoUrl.slice(0, 80)}...`);

    const filename = `veo_${randomUUID().split("-")[0]}_${Date.now()}.mp4`;
    const localPath = path.join(DOWNLOADS_DIR, filename);
    let downloadedFile: string | null = null;

    if (capturedVideoUrl.startsWith("blob:")) {
      console.log(`📦 [VeoAuto] Detected blob URL. Downloading via page-context base64 conversion...`);
      try {
        const base64Data = await page.evaluate(async (url: string) => {
          const response = await fetch(url);
          const blob = await response.blob();
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              const base64 = result.split(',')[1];
              resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }, capturedVideoUrl);

        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(localPath, buffer);
        downloadedFile = localPath;
        console.log(`✅ [VeoAuto] Blob video downloaded and saved to: ${localPath}`);
      } catch (blobErr: any) {
        console.error(`❌ [VeoAuto] Failed to download blob video: ${blobErr.message}`);
      }
    }

    if (!downloadedFile) {
      // ── Download via Chrome (uses session cookies) — NOT axios (no cookies) ──
      console.log(`⬇️  [VeoAuto] Downloading via Chrome session (has cookies)...`);
      await client.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: toHostPath(DOWNLOADS_DIR),
      });

      // Navigate to the video URL in a new tab — Chrome will download it
      const dlPage = await createBackgroundPage(browser);
      await dlPage.goto(capturedVideoUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});

      // Wait for the .mp4 file to appear (up to 30s)
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const files = fs.readdirSync(DOWNLOADS_DIR).filter(f =>
          (f.endsWith(".mp4") || f.endsWith(".webm")) && !f.endsWith(".crdownload")
        );
        if (files.length > 0) {
          // Get the most recently modified file
          const newest = files.sort((a, b) => {
            const sa = fs.statSync(path.join(DOWNLOADS_DIR, a));
            const sb = fs.statSync(path.join(DOWNLOADS_DIR, b));
            return sb.mtimeMs - sa.mtimeMs;
          })[0];
          downloadedFile = path.join(DOWNLOADS_DIR, newest);
          break;
        }
      }
      await dlPage.close().catch(() => {});

      if (!downloadedFile) {
        // Fallback: try axios with cookies from page
        console.warn("⚠️  [VeoAuto] CDP download didn't produce file — trying axios fallback...");
        await downloadFile(capturedVideoUrl, localPath);
        downloadedFile = localPath;
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`✅ [VeoAuto] Video downloaded to: ${downloadedFile} (${Math.round(durationMs / 1000)}s)`);

    // Extract thumbnail frame (JPG) from the downloaded video using FFmpeg
    let thumbnailPath: string | undefined = undefined;
    if (downloadedFile) {
      const thumbFilename = path.basename(downloadedFile).replace(/\.[^/.]+$/, "") + "_thumb.jpg";
      const localThumbPath = path.join(DOWNLOADS_DIR, thumbFilename);
      
      let thumbSuccess = false;
      try {
        const ffmpegCmd = fs.existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
        const { execSync } = await import("child_process");
        execSync(`"${ffmpegCmd}" -y -i "${downloadedFile}" -ss 00:00:01 -vframes 1 -q:v 2 "${localThumbPath}"`, { stdio: "ignore" });
        thumbSuccess = true;
      } catch (err: any) {
        console.warn(`⚠️ [VeoAuto] FFmpeg thumbnail extraction failed: ${err.message}`);
      }

      if (thumbSuccess) {
        thumbnailPath = localThumbPath;
        console.log(`📸 [VeoAuto] Thumbnail saved: ${path.basename(localThumbPath)}`);
      }
    }

    return { success: true, localPath: downloadedFile, thumbnailPath, videoUrl: capturedVideoUrl, prompt, durationMs, connectionMode };

  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    console.error(`❌ [VeoAuto] Error: ${err.message}`);
    return { success: false, error: err.message, prompt, durationMs };
  } finally {
    if (localImagePath && fs.existsSync(localImagePath)) {
      try { fs.unlinkSync(localImagePath); } catch {}
    }
    if (page) {
      try {
        await page.close();
        console.log("📄 [VeoAuto] Gemini tab closed");
      } catch (err: any) {
        console.warn(`⚠️  [VeoAuto] Failed to close Gemini tab: ${err.message}`);
      }
    }
    if (ownsBrowser && browser) {
      await browser.close();
      console.log("🔒 [VeoAuto] Chrome browser closed");
      cleanupTempProfiles();
    } else if (browser) {
      // Disconnect without closing user's Chrome
      browser.disconnect?.();
      console.log("🔌 [VeoAuto] Disconnected from Chrome (kept running)");
    }
  }
}

/**
  * Extract a frame from a local video file using Puppeteer page injection (dependency-free)
  */
export async function extractVideoFrame(
  browser: any,
  videoFilePath: string,
  outputImagePath: string
): Promise<boolean> {
  console.log(`📸 [VeoAuto] Extracting frame from video: ${path.basename(videoFilePath)}`);
  let page: any = null;
  try {
    page = await createBackgroundPage(browser);
    const absoluteVideoPath = path.resolve(videoFilePath);
    const fileUrl = `file://${absoluteVideoPath}`;
    
    // Set viewport matching vertical/horizontal layout (defaulting to clean bounds)
    await page.setViewport({ width: 540, height: 960 });

    // Load simple HTML page that displays video
    await page.setContent(`
      <html>
        <body style="margin:0; padding:0; background:#000; overflow:hidden; display:flex; align-items:center; justify-content:center;">
          <video id="vid" src="${fileUrl}" style="width:100vw; height:100vh; object-fit:contain;" muted></video>
        </body>
      </html>
    `);
    
    // Seek to 2.5s to capture a meaningful frame (preventing black screen at 0.0s/fade-in)
    await page.evaluate(async () => {
      const vid = document.getElementById("vid") as HTMLVideoElement;
      return new Promise<void>((resolve, reject) => {
        vid.onloadedmetadata = () => {
          vid.currentTime = 2.5; // 2.5 seconds in
        };
        vid.onseeked = () => {
          resolve();
        };
        vid.onerror = (e) => {
          reject(new Error("Video element failed to load local file"));
        };
        // Timeout backup
        setTimeout(resolve, 5000);
      });
    });

    // Wait short rendering buffer
    await new Promise(r => setTimeout(r, 800));
    
    const videoEl = await page.$("#vid");
    if (videoEl) {
      await videoEl.screenshot({ path: outputImagePath, type: "jpeg", quality: 80 });
      console.log(`📸 [VeoAuto] Thumbnail saved: ${path.basename(outputImagePath)}`);
      return true;
    }
    return false;
  } catch (err: any) {
    console.warn(`⚠️ [VeoAuto] Could not extract thumbnail frame: ${err.message}`);
    return false;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}


async function downloadFile(url: string, destPath: string): Promise<void> {
  console.log(`⬇️  [VeoAuto] Downloading video file...`);
  const writer = fs.createWriteStream(destPath);

  const response = await axios.get(url, {
    responseType: "stream",
    timeout: 300_000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  return new Promise((resolve, reject) => {
    const stream = response.data;
    stream.on("error", (err: any) => {
      console.warn(`⚠️ [VeoAuto] Download stream error: ${err.message}`);
      writer.destroy();
      reject(err);
    });
    writer.on("finish", resolve);
    writer.on("error", (err: any) => {
      stream.destroy();
      reject(err);
    });
    stream.pipe(writer);
  });
}

function copyProfileToTemp(): string {
  const tempDir = path.join(os.tmpdir(), `veo_chrome_${randomUUID().split("-")[0]}`);
  const srcProfile = path.join(CHROME_USER_DATA_DIR, CHROME_PROFILE);
  const destProfile = path.join(tempDir, CHROME_PROFILE);

  if (!fs.existsSync(srcProfile)) {
    throw new Error(
      `Chrome profile not found at: ${srcProfile}\nCheck CHROME_USER_DATA_DIR and CHROME_PROFILE in .env`
    );
  }

  console.log(`📂 [VeoAuto] Copying Chrome profile: ${srcProfile} → ${tempDir}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    execSync(`cp -r "${srcProfile}" "${destProfile}"`, {
      stdio: "ignore",
      timeout: 60_000,
    });
  } catch (err: any) {
    console.warn(`⚠️  [VeoAuto] Some profile files skipped (normal): ${err.message?.slice(0, 80)}`);
  }

  // Remove lock files so the new Chrome instance can start
  const lockFiles = ["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"];
  for (const lock of lockFiles) {
    const lockPath = path.join(destProfile, lock);
    if (fs.existsSync(lockPath)) {
      try { fs.rmSync(lockPath, { force: true }); } catch { /* ignore */ }
    }
  }

  console.log(`✅ [VeoAuto] Profile copied to: ${tempDir}`);
  return tempDir;
}

function cleanupTempProfiles(): void {
  try {
    const entries = fs.readdirSync(os.tmpdir());
    for (const entry of entries) {
      if (entry.startsWith("veo_chrome_")) {
        execSync(`rm -rf "${path.join(os.tmpdir(), entry)}"`, { stdio: "ignore" });
      }
    }
    console.log("🧹 [VeoAuto] Temp profiles cleaned up");
  } catch { /* non-critical */ }
}

/**
 * Auto-launch ChromeAuto Chrome with remote debugging if not already running.
 * This runs automatically before every video generation.
 */
export async function ensureChromeRunning(): Promise<void> {
  const debugUrl = `http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version`;

  // Check if Chrome is already running with debug port
  try {
    const res = await fetch(debugUrl);
    if (res.ok) {
      console.log(`✅ [VeoAuto] Chrome already running on port ${CHROME_DEBUG_PORT}`);
      // Ensure existing window is kept off-screen so it never covers user's workspace
      try {
        const puppeteer = (await import("puppeteer")).default;
        const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CHROME_DEBUG_PORT}`, defaultViewport: null });
        const pages = await browser.pages();
        if (pages.length > 0) {
          await ensureWindowOffscreen(pages[0]);
        }
        browser.disconnect();
      } catch {}
      return;
    }
  } catch { /* not running, will launch below */ }

  const chromePath = getChromePath();
  const chromeAutoDir = path.join(os.homedir(), "ChromeAuto");

  if (!fs.existsSync(chromeAutoDir)) {
    console.warn(`⚠️  [VeoAuto] ChromeAuto directory not found: ${chromeAutoDir}`);
    console.warn(`   Run setup: mkdir -p ~/ChromeAuto && cp -r ~/Library/Application\\ Support/Google/Chrome/Profile\\ 2 ~/ChromeAuto/Default`);
    return;
  }

  const prevApp = getFrontmostApp();
  console.log(`🚀 [VeoAuto] Auto-launching ChromeAuto in background (offscreen, port ${CHROME_DEBUG_PORT})...`);

  // Remove lock files before launch
  const lockFiles = ["Default/SingletonLock", "Default/SingletonCookie", "SingletonLock"];
  for (const lock of lockFiles) {
    const p = path.join(chromeAutoDir, lock);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }

  // Launch Chrome in background offscreen (detached)
  const chromeProcess = spawn(
    chromePath || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    [
      `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
      `--user-data-dir=${chromeAutoDir}`,
      "--window-position=3000,100",
      "--window-size=1280,900",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-mode",
      "--disable-blink-features=AutomationControlled",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-features=CalculatePageVisibilityState",
      "--mute-audio",
    ],
    { detached: true, stdio: "ignore" }
  );
  chromeProcess.unref();

  // On macOS: immediately restore user focus so launching Chrome never steals focus
  restoreUserFocus(prevApp);

  // Wait for Chrome to be ready (up to 8 seconds)
  console.log("⏳ [VeoAuto] Waiting for Chrome to start...");
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(debugUrl);
      if (res.ok) {
        console.log(`✅ [VeoAuto] ChromeAuto launched and ready in background! (${(i + 1) * 0.5}s)`);
        restoreUserFocus(prevApp);
        return;
      }
    } catch { /* still starting */ }
  }

  console.warn("⚠️  [VeoAuto] Chrome may not have started with debug port — will try to continue anyway");
}

function getChromePath(): string {
  const customPath = process.env.CHROME_EXECUTABLE_PATH;
  if (customPath && fs.existsSync(customPath)) return customPath;

  const macPath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(macPath)) return macPath;

  console.warn("⚠️  Chrome not found at default path, using bundled Chromium (no saved session)");
  return "";
}

export async function extractThreeKeyframes(
  videoFilePath: string,
  outputDir: string
): Promise<string[]> {
  console.log(`📸 [VeoAuto] Extracting 3 keyframes (start, mid, end) from video: ${path.basename(videoFilePath)}`);
  const baseName = path.basename(videoFilePath, path.extname(videoFilePath));
  const ts = Date.now();
  const f1 = path.join(outputDir, `${baseName}_frame1_${ts}.jpg`);
  const f2 = path.join(outputDir, `${baseName}_frame2_${ts}.jpg`);
  const f3 = path.join(outputDir, `${baseName}_frame3_${ts}.jpg`);

  const ffmpegCmd = fs.existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
  const ffprobeCmd = ffmpegCmd.replace(/ffmpeg(["']?)$/, "ffprobe$1");
  const { execSync } = await import("child_process");

  // Get duration in seconds via ffprobe
  let duration = 10.0;
  try {
    const out = execSync(`"${ffprobeCmd}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoFilePath}"`, { encoding: "utf-8" });
    const parsed = parseFloat(out.trim());
    if (!isNaN(parsed) && parsed > 1) duration = parsed;
  } catch {}

  const t1 = 0.5;
  const t2 = (duration / 2).toFixed(2);
  const t3 = Math.max(1.0, duration - 0.5).toFixed(2);

  const frames: string[] = [];

  try {
    // Frame 1: Beginning (0.5s)
    execSync(`"${ffmpegCmd}" -y -i "${videoFilePath}" -ss ${t1} -vframes 1 -q:v 2 "${f1}"`, { stdio: "ignore" });
    if (fs.existsSync(f1) && fs.statSync(f1).size > 1000) frames.push(f1);
  } catch {}

  try {
    // Frame 2: Middle (50%)
    execSync(`"${ffmpegCmd}" -y -i "${videoFilePath}" -ss ${t2} -vframes 1 -q:v 2 "${f2}"`, { stdio: "ignore" });
    if (fs.existsSync(f2) && fs.statSync(f2).size > 1000) frames.push(f2);
  } catch {}

  try {
    // Frame 3: End (duration - 0.5s)
    execSync(`"${ffmpegCmd}" -y -i "${videoFilePath}" -ss ${t3} -vframes 1 -q:v 2 "${f3}"`, { stdio: "ignore" });
    if (fs.existsSync(f3) && fs.statSync(f3).size > 1000) frames.push(f3);
  } catch {}

  console.log(`📸 [VeoAuto] Extracted ${frames.length} keyframe image(s) accurately (timestamps: ${t1}s, ${t2}s, ${t3}s)`);
  return frames;
}

/**
 * Builds a comprehensive, cinematic prompt for Veo that includes both visual motion & character dialogue.
 */
export function buildVeoScenePrompt(
  prompt: string,
  dialogue?: string,
  sceneIndex?: number
): string {
  let cleanPrompt = prompt ? prompt.trim() : "";
  let dialogueText = dialogue ? dialogue.trim() : "";

  // Extract dialogue if already formatted inside prompt
  if (/THOẠI TIẾNG VIỆT:/i.test(cleanPrompt)) {
    const parts = cleanPrompt.split(/THOẠI TIẾNG VIỆT:/i);
    cleanPrompt = parts[0].trim();
    if (!dialogueText && parts[1]) {
      dialogueText = parts[1].trim();
    }
  } else if (/DIALOGUE:/i.test(cleanPrompt)) {
    const parts = cleanPrompt.split(/DIALOGUE:/i);
    cleanPrompt = parts[0].trim();
    if (!dialogueText && parts[1]) {
      dialogueText = parts[1].trim();
    }
  }

  const sections: string[] = [];
  if (sceneIndex !== undefined && sceneIndex > 0) {
    sections.push(`🎬 SEAMLESS CONTINUOUS SEQUEL & MATCH-CUT (Part ${sceneIndex + 1} of 6):
- OPENING MATCH-CUT: This scene begins IMMEDIATELY where Part ${sceneIndex} ended. Seamlessly match the ending character body posture, facing direction, held props, and camera momentum from the previous part.
- SEAMLESS CONTINUITY: Maintain 100% exact character continuity (same fur/clothing, scale, face, height), same room environment coordinates, seamless lighting temperature, and smooth motion flow with ZERO abrupt jumps or disorienting cuts.`);
  } else {
    sections.push(`🎬 CINEMATIC ESTABLISHING SCENE (Part 1 of 6):
- Establish the 3D Pixar world with smooth cinematic camera movement, setting the stage, character presence, and lighting tone for the continuous 6-part storyline.`);
  }

  sections.push(`Scene Action & Motion:\n${cleanPrompt}`);

  if (dialogueText) {
    sections.push(`Character Dialogue & Expressive Speaking (Lip-sync & Voiceover):\n- Spoken Lines: "${dialogueText}"\n- Characters naturally speak their lines with animated mouth movements, expressive facial gestures, and lively body language matching the dialogue.`);
  }

  // Enforce Chibi Character Proportions Lock to prevent Veo from morphing cute characters into adults
  const isChibiOrPlush = /chibi|bear|plush|teddy|cute|cartoon|bubu|dudu/i.test(cleanPrompt);
  if (isChibiOrPlush) {
    sections.push(`CRITICAL CHARACTER PROPORTIONS MANDATE:
- STUBBY CHIBI BODY: All characters MUST strictly remain adorable miniature chibi plush teddy bears with oversized spherical round heads (1:1 or 1:2 head-to-body ratio), chubby bellies, and short stubby arms and legs with cute toddler waddling movement.
- STRICT NEGATIVE DIRECTIVE: Do NOT stretch characters into tall, adult, elongated, or realistic human proportions. Absolutely NO adult limb proportions, NO realistic humanoid anatomy.`);
  }

  sections.push(`Cinematography: High-end 3D Disney Pixar aesthetic, fluid character animation, vibrant cinematic lighting, crisp details, 60fps.`);

  return sections.join("\n\n");
}

export async function generateVeoVideoParallel(
  prompts: string[],
  imageUrl?: string,
  productSlug: string = "video",
  customOutputDir?: string,
  sceneImagePaths?: string[],
  dialogues?: string[]
): Promise<{ success: boolean; localPaths: string[]; errors: string[]; durationMs: number }> {
  const startTime = Date.now();
  let browser: any = null;
  let ownsBrowser = false;
  let localImagePath: string | null = null;
  const outputDir = customOutputDir || DOWNLOADS_DIR;
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  // Note: Old files are preserved for review and cleaned up daily at 10:00 AM UTC+7 via Cron Job

  console.log(`🎬 [VeoAuto] Starting PARALLEL video generation for ${prompts.length} prompts...`);
  if (sceneImagePaths && sceneImagePaths.length > 0) {
    console.log(`🖼️  [VeoAuto] Received ${sceneImagePaths.length} pre-generated scene keyframe image(s) from Gemini.`);
  }

  // Download image if imageUrl is provided
  if (imageUrl) {
    try {
      console.log(`📸 [VeoAuto] Downloading product image for Gemini: ${imageUrl}`);
      let fetchUrl = imageUrl;
      if (imageUrl.includes(".amazonaws.com/")) {
        const parts = imageUrl.split(".amazonaws.com/");
        if (parts.length > 1) {
          const key = parts[1];
          const port = process.env.PORT || "3400";
          fetchUrl = `http://127.0.0.1:${port}/api/products/image-proxy?key=${encodeURIComponent(key)}`;
        }
      } else if (imageUrl.startsWith("/")) {
        const port = process.env.PORT || "3400";
        fetchUrl = `http://127.0.0.1:${port}${imageUrl}`;
      }

      const response = await axios.get(fetchUrl, { responseType: "arraybuffer", timeout: 15000 });
      const contentType = String(response.headers["content-type"] ?? "image/jpeg");
      const ext = contentType.split("/")[1] || "jpg";
      const tempFilename = `gemini_upload_${randomUUID().split("-")[0]}.${ext}`;
      localImagePath = path.join(DOWNLOADS_DIR, tempFilename);
      fs.writeFileSync(localImagePath, response.data);
      console.log(`✅ [VeoAuto] Downloaded product image to local path: ${localImagePath}`);
    } catch (err: any) {
      console.warn(`⚠️  [VeoAuto] Failed to download product image: ${err.message}`);
      localImagePath = null;
    }
  }

  try {
    let puppeteer: any;
    try {
      // @ts-ignore
      puppeteer = (await import("puppeteer")).default;
    } catch {
      throw new Error("puppeteer is not installed. Run: npm install puppeteer");
    }

    await ensureChromeRunning();

    // Connect to or launch Chrome
    let connectionMode: "remote" | "profile_copy" = "remote";
    try {
      const debugUrl = `http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version`;
      const checkRes = await fetch(debugUrl).catch(() => null);

      if (checkRes && checkRes.ok) {
        const info = await checkRes.json() as any;
        console.log(`🔗 [VeoAuto] Connecting to existing Chrome: ${info.Browser}`);
        browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${CHROME_DEBUG_PORT}`,
          defaultViewport: null,
        });
        ownsBrowser = false;
        console.log("✅ [VeoAuto] Connected to running Chrome");
      } else {
        throw new Error("No Chrome on debug port");
      }
    } catch (connectErr: any) {
      console.log(`⚠️  [VeoAuto] Debug port unavailable: ${connectErr.message}`);
      connectionMode = "profile_copy";
      const tempProfileDir = copyProfileToTemp();

      browser = await puppeteer.launch({
        executablePath: getChromePath(),
        userDataDir: tempProfileDir,
        args: [
          `--profile-directory=${CHROME_PROFILE}`,
          "--window-position=3000,100",
          "--window-size=1280,900",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
        ],
        headless: false,
        defaultViewport: { width: 1280, height: 900 },
      });
      ownsBrowser = true;
    }

    // Run generations sequentially (one by one) to respect Gemini account limits
    console.log(`🚀 [VeoAuto] Spawning ${prompts.length} pages/tabs sequentially...`);
    const results = [];
    for (let i = 0; i < prompts.length; i++) {
      console.log(`🎬 [VeoAuto] Starting segment ${i + 1}/${prompts.length}...`);
      
      let uploadFilePath: string | string[] | null = localImagePath;
      const dialogueText = (dialogues && dialogues[i]) ? dialogues[i] : undefined;
      let finalPrompt = buildVeoScenePrompt(prompts[i], dialogueText, i);
      
      // Check if pre-generated scene keyframe image exists for this segment
      if (i > 0) {
        // Chain visual continuity by attaching the ending keyframe of the previous video
        let foundPrevSuccessful = false;
        for (let j = i - 1; j >= 0; j--) {
          const prevRes = results[j];
          if (prevRes && prevRes.success && prevRes.localPath && fs.existsSync(prevRes.localPath)) {
            const keyframes = await extractThreeKeyframes(prevRes.localPath, outputDir);
            if (keyframes.length > 0) {
              const endFrame = keyframes[keyframes.length - 1];
              if (sceneImagePaths && sceneImagePaths[i] && fs.existsSync(sceneImagePaths[i])) {
                uploadFilePath = [endFrame, sceneImagePaths[i]];
              } else {
                uploadFilePath = keyframes;
              }
              console.log(`🔗 [VeoAuto] Segment ${i + 1} chaining continuity from Part ${j + 1} video ending frame!`);
              foundPrevSuccessful = true;
              break;
            }
          }
        }
        if (!foundPrevSuccessful && sceneImagePaths && sceneImagePaths[i] && fs.existsSync(sceneImagePaths[i])) {
          uploadFilePath = sceneImagePaths[i];
          console.log(`📸 [VeoAuto] Segment ${i + 1} will upload pre-generated scene keyframe image: ${path.basename(sceneImagePaths[i])}`);
        }
      } else if (sceneImagePaths && sceneImagePaths[0] && fs.existsSync(sceneImagePaths[0])) {
        uploadFilePath = sceneImagePaths[0];
        console.log(`📸 [VeoAuto] Segment 1 using pre-generated scene keyframe image: ${path.basename(sceneImagePaths[0])}`);
      }

      // Wait a few seconds between segments to avoid hitting Google's rate limits
      if (i > 0) {
        const delayMs = Math.floor(Math.random() * 3000) + 3000; // 3 to 6 seconds delay
        console.log(`⏳ [VeoAuto] Sleeping for ${delayMs}ms to respect Gemini rate limits...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      
      const res = await runSingleVeoAutomation(browser, finalPrompt, uploadFilePath, i, productSlug, outputDir);
      results.push(res);
    }

    const localPaths: string[] = [];
    const errors: string[] = [];
    let successCount = 0;

    for (const res of results) {
      if (res.success && res.localPath) {
        localPaths.push(res.localPath);
        successCount++;
      } else {
        errors.push(res.error || "Unknown error");
      }
    }

    return {
      success: successCount > 0,
      localPaths,
      errors,
      durationMs: Date.now() - startTime
    };

  } catch (err: any) {
    return {
      success: false,
      localPaths: [],
      errors: [err.message],
      durationMs: Date.now() - startTime
    };
  } finally {
    // Cleanup local image upload file
    if (localImagePath && fs.existsSync(localImagePath)) {
      try { fs.unlinkSync(localImagePath); } catch {}
    }
    // Close browser if we launched it
    if (ownsBrowser && browser) {
      await browser.close();
      cleanupTempProfiles();
    } else if (browser) {
      try {
        browser.disconnect?.();
      } catch {}
    }
  }
}

async function runSingleVeoAutomation(
  browser: any,
  prompt: string,
  localImagePath: string | string[] | null,
  index: number,
  productSlug: string,
  customOutputDir?: string
): Promise<VeoResult> {
  const startTime = Date.now();
  let page: any = null;
  let tabDownloadDir: string | null = null;

  try {
    page = await createBackgroundPage(browser);
    console.log(`📄 [VeoAuto-Tab ${index + 1}] Opened new tab`);

    const client = await page.createCDPSession();
    const pageRunId = Math.random().toString(36).substring(2, 10);
    tabDownloadDir = path.join(DOWNLOADS_DIR, `part_${index + 1}_${pageRunId}`);
    if (!fs.existsSync(tabDownloadDir)) fs.mkdirSync(tabDownloadDir, { recursive: true });

    await client.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: toHostPath(tabDownloadDir),
    }).catch(() => {});

    // Intercept network responses to capture video URL
    let capturedVideoUrl: string | null = null;
    let isPromptSubmitted = false;
    page.on("response", async (response: any) => {
      if (!isPromptSubmitted) return;
      const url = response.url();
      const contentType = response.headers()["content-type"] || "";
      const isVideo = contentType.includes("video/") ||
        url.includes(".mp4") || url.includes("videoplayback") ||
        url.includes("video-downloads") || url.includes("generativelanguage") ||
        url.includes("aiusercontent") || url.includes("usercontent.google") ||
        (url.includes("google") && (contentType.includes("octet-stream") && url.length > 100));

      if (isVideo && !capturedVideoUrl && !url.startsWith("blob:")) {
        capturedVideoUrl = url;
        console.log(`🎯 [VeoAuto-Tab ${index + 1}] Captured video URL: ${url.slice(0, 100)}`);
      }
    });

    console.log(`🌐 [VeoAuto-Tab ${index + 1}] Navigating to Gemini Web...`);
    await page.goto(GEMINI_VEO_URL, { waitUntil: "networkidle2", timeout: 60_000 });

    // Click "New chat" to clean the active session so we don't fetch old videos/buttons from chat history
    try {
      console.log(`🧹 [VeoAuto-Tab ${index + 1}] Cleaning session (clicking New Chat)...`);
      await page.evaluate(() => {
        const btn = document.querySelector('[data-test-id="new-chat-button"]') as HTMLElement
          || Array.from(document.querySelectorAll('a, button, [role="button"]')).find(el => {
               const text = (el.textContent || '').toLowerCase();
               const aria = (el.getAttribute('aria-label') || '').toLowerCase();
               return text.includes('new chat') || text.includes('cuộc trò chuyện mới') || text.includes('trò chuyện mới') ||
                      aria.includes('new chat') || aria.includes('cuộc trò chuyện mới') || aria.includes('trò chuyện mới');
             }) as HTMLElement;
        if (btn) {
          btn.click();
        }
      });
      await new Promise(r => setTimeout(r, 2000));
    } catch (err: any) {
      console.warn(`⚠️  [VeoAuto-Tab ${index + 1}] Failed to click New Chat: ${err.message}`);
    }

    // Sidebar navigation click
    try {
      await page.waitForSelector('[data-test-id="videos-side-nav-entry-button"] a, a[href="/videos"]', { timeout: 10_000 });
      await page.evaluate(() => {
        const link = document.querySelector('[data-test-id="videos-side-nav-entry-button"] a') as HTMLAnchorElement
          || document.querySelector('a[href="/videos"]') as HTMLAnchorElement;
        if (link) link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      });
      await new Promise(r => setTimeout(r, 3000));
    } catch {}

    const inputSelector = 'rich-textarea [contenteditable="true"], textarea, [contenteditable="true"]';
    await page.waitForSelector(inputSelector, { timeout: 30_000 });

    // Upload image or video if provided
    const pathsToUpload: string[] = Array.isArray(localImagePath)
      ? localImagePath.filter(p => p && fs.existsSync(p))
      : (localImagePath && fs.existsSync(localImagePath) ? [localImagePath] : []);

    if (pathsToUpload.length > 0) {
      const prevApp = getFrontmostApp();
      const isVideo = pathsToUpload.some(p => p.endsWith(".mp4") || p.endsWith(".webm"));
      console.log(`📤 [VeoAuto-Tab ${index + 1}] Uploading ${pathsToUpload.length} file(s) (isVideo=${isVideo})...`);
      try {
        // Step 1: Detect if a file input already exists in the active input container to prevent opening the menu again
        let fileInputHandle = await page.evaluateHandle(() => {
          const activeInputArea = document.querySelector('rich-textarea, chat-input, .input-area, .text-input-container');
          if (activeInputArea) {
            const input = activeInputArea.querySelector('input[type="file"]') as HTMLInputElement;
            if (input) return input;
          }
          return null;
        });

        // Step 2: If no file input in container, click upload (+) menu to reveal file input
        if (!fileInputHandle || (await fileInputHandle.jsonValue()) === null) {
          console.log(`🖱️ [VeoAuto-Tab ${index + 1}] Opening upload menu...`);
          await page.evaluate(() => {
            const textarea = document.querySelector('rich-textarea [contenteditable="true"], textarea, [contenteditable="true"]');
            let inputContainer: Element | null = null;
            if (textarea) {
              let parent = textarea.parentElement;
              for (let depth = 0; depth < 8 && parent; parent = parent.parentElement, depth++) {
                if (parent.tagName === 'CHAT-INPUT' || 
                    parent.classList.contains('input-area') || 
                    parent.querySelector('button[aria-label*="tải"], button[aria-label*="Upload"], button[aria-label*="công cụ"]')) {
                  inputContainer = parent;
                  break;
                }
              }
            }

            const scope = inputContainer || document;
            const btn = scope.querySelector('button[aria-label*="Nội dung tải lên"]') as HTMLButtonElement
              || scope.querySelector('button[aria-label*="Upload"]') as HTMLButtonElement
              || scope.querySelector('button[aria-label*="công cụ"]') as HTMLButtonElement
              || Array.from(scope.querySelectorAll('button')).find(b => b.innerHTML.includes('plus') || b.getAttribute('aria-label')?.includes('Nội dung tải lên') || b.getAttribute('aria-label')?.includes('Upload'));

            if (btn) {
              btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
            }
          });
          restoreUserFocus(prevApp);
          await new Promise(r => setTimeout(r, 1200));

          await page.evaluate(() => {
            const container = document.querySelector('.cdk-overlay-container') || document;
            const items = Array.from(container.querySelectorAll('button, [role="menuitem"], .mat-mdc-menu-item, .menu-item'));
            const uploadItem = items.find(el => {
              const text = el.textContent?.trim() || "";
              return text === "Tải lên từ máy tính" || 
                     text === "Upload from computer" || 
                     text === "Tải lên từ thiết bị" || 
                     text === "Upload from device" ||
                     text === "Tải lên" ||
                     text.includes("máy tính") ||
                     text.includes("computer");
            }) as HTMLElement;
            if (uploadItem) {
              uploadItem.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
            }
          });
          restoreUserFocus(prevApp);
          await new Promise(r => setTimeout(r, 1200));
        }

        // Wait up to 10s for the file input to appear/be active if we had to open it
        await page.waitForSelector('input[type="file"]', { timeout: 10000 });

        fileInputHandle = await page.evaluateHandle(() => {
          const activeInputArea = document.querySelector('rich-textarea, chat-input, .input-area, .text-input-container');
          if (activeInputArea) {
            const input = activeInputArea.querySelector('input[type="file"]') as HTMLInputElement;
            if (input) return input;
          }
          const textarea = document.querySelector('rich-textarea [contenteditable="true"], textarea, [contenteditable="true"]');
          if (textarea) {
            let parent = textarea.parentElement;
            while (parent) {
              const fileInput = parent.querySelector('input[type="file"]') as HTMLInputElement;
              if (fileInput) return fileInput;
              parent = parent.parentElement;
            }
          }
          const inputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
          const mediaInput = inputs.find(i => {
            const accept = i.getAttribute('accept') || '';
            return accept.includes('image') || accept.includes('video') || accept.includes('*');
          });
          if (mediaInput) return mediaInput;
          return inputs[inputs.length - 1];
        });

        if (fileInputHandle) {
          await page.evaluate((input: any) => { if (input) input.focus(); }, fileInputHandle);
          const hostPaths = pathsToUpload.map(toHostPath);
          await (fileInputHandle as any).uploadFile(...hostPaths);
          restoreUserFocus(prevApp);
          
          // Wait for upload processing (images are fast: 4.5s vs 35s for videos)
          const waitTime = isVideo ? 35000 : 4500;
          await new Promise(r => setTimeout(r, waitTime));
        }
      } catch (uploadErr: any) {
        console.warn(`⚠️  [VeoAuto-Tab ${index + 1}] File upload failed: ${uploadErr.message}`);
      } finally {
        restoreUserFocus(prevApp);
      }
    }

    // Set text in the contenteditable div via DOM injection to prevent typing and focus conflicts between tabs
    const prevAppTyping = getFrontmostApp();
    console.log(`✏️  [VeoAuto-Tab ${index + 1}] Typing prompt via DOM...`);
    await page.evaluate((sel: string, text: string) => {
      const el = document.querySelector(sel) as HTMLElement;
      if (el) {
        el.focus();
        el.innerText = text;
        // Dispatch input and change events to trigger Angular bindings
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Dispatch dummy spaces to update any keyboard listener states
        el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));
      }
    }, inputSelector, prompt);
    restoreUserFocus(prevAppTyping);

    // Count existing videos and download buttons on page before submitting prompt
    const initialVideoCount = await page.evaluate(() => document.querySelectorAll("video").length).catch(() => 0);
    const initialDownloadCount = await page.evaluate(() => 
      document.querySelectorAll('button[aria-label*="Download" i], button[aria-label*="download" i], button[aria-label*="Tải" i], button[aria-label*="tải" i], a[download]').length
    ).catch(() => 0);
    console.log(`📊 [VeoAuto-Tab ${index + 1}] Initial counts before submit: videos=${initialVideoCount}, downloads=${initialDownloadCount}`);

    await new Promise(r => setTimeout(r, 1000));

    // Submit prompt using DOM click on Generate/Send button
    const submitted = await page.evaluate(() => {
      const selectors = [
        'button[aria-label="Gửi tin nhắn"]',
        'button[aria-label*="Gửi" i]',
        'button[aria-label*="Generate" i]',
        'button[aria-label*="Tạo" i]',
        'button[aria-label*="Send" i]',
        'button.send-button',
        'mat-icon[fonticon="arrow_upward"]',
        'button mat-icon[data-mat-icon-name="arrow_upward"]',
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel) as HTMLButtonElement;
        // Verify button is not inside a menu, dialog list, or sidebar list
        if (btn && !btn.disabled && !btn.closest('mat-menu-panel') && !btn.closest('navigation-list') && !btn.closest('.sidebar-list') && !btn.closest('[role="menu"]')) {
          btn.click();
          return true;
        }
      }
      
      const btns = Array.from(document.querySelectorAll('button'));
      const targetBtn = btns.find(b => {
        // Bypass buttons inside menus or sidebars to avoid misclicking menu options like "Ghim" / "Pin"
        if (b.closest('mat-menu-panel') || b.closest('navigation-list') || b.closest('.sidebar-list') || b.closest('[role="menu"]') || b.closest('.context-menu')) {
          return false;
        }

        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const text = (b.textContent || '').toLowerCase();
        const html = (b.innerHTML || '').toLowerCase();

        // Exclude menu options explicitly
        const isMenuOption = aria.includes('ghim') || aria.includes('pin') || aria.includes('xóa') || aria.includes('delete') || 
                             aria.includes('sổ') || aria.includes('note') || aria.includes('chia') || aria.includes('share') || 
                             aria.includes('đổi') || aria.includes('rename') || text.includes('ghim') || text.includes('pin') ||
                             text.includes('xóa') || text.includes('delete') || text.includes('chia') || text.includes('share') ||
                             text.includes('đổi') || text.includes('rename');
        if (isMenuOption) return false;

        return aria.includes('generate') || aria.includes('tạo') || aria.includes('gửi') || aria.includes('send') ||
               text.includes('generate') || text.includes('tạo') || text.includes('gửi') || text.includes('send') ||
               html.includes('send') || html.includes('gửi') || html.includes('mat-icon-name="send"');
      });
      if (targetBtn) {
        targetBtn.click();
        return true;
      }
      return false;
    });

    if (submitted) {
      console.log(`📤 [VeoAuto-Tab ${index + 1}] Prompt submitted via Generate/Send button`);
    } else {
      console.log(`⚠️  [VeoAuto-Tab ${index + 1}] Generate button not found, falling back to keyboard Enter`);
      await page.focus(inputSelector).catch(() => {});
      await page.keyboard.press("Enter");
      console.log(`📤 [VeoAuto-Tab ${index + 1}] Prompt submitted via keyboard Enter`);
    }
    isPromptSubmitted = true;

    // Poll for video generation
    const pollStart = Date.now();
    const MAX_WAIT_MS = 7 * 60 * 1000;
    let found = false;
    let hasRefreshed = false;
    let downloadButtonClicked = false;

    while (Date.now() - pollStart < MAX_WAIT_MS) {
      await new Promise(r => setTimeout(r, 5000));
      const elapsed = Math.round((Date.now() - pollStart) / 1000);

      if (capturedVideoUrl) {
        found = true;
        break;
      }

      // Proactive check: look for new video elements even before "video ready" text appears
      if (!found) {
        const proactiveVideoSrc = await page.evaluate((initCount: number) => {
          const videos = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[];
          // Only check if there are NEW video elements since we submitted
          if (videos.length > initCount) {
            for (let i = videos.length - 1; i >= initCount; i--) {
              const src = videos[i].src || videos[i].currentSrc;
              if (src && !src.startsWith("blob:") && (src.includes("google") || src.includes(".mp4") || src.includes("usercontent"))) {
                return src;
              }
            }
          }
          return null;
        }, initialVideoCount).catch(() => null);

        if (proactiveVideoSrc) {
          capturedVideoUrl = proactiveVideoSrc;
          found = true;
          console.log(`🎯 [VeoAuto-Tab ${index + 1}] Proactive video detection! Found new video at ${elapsed}s: ${proactiveVideoSrc.slice(0, 80)}...`);
          break;
        }
      }

      // Periodic screenshots for debugging (every 60s)
      if (elapsed % 60 === 0 || elapsed === 10) {
        const ssDir = path.resolve(__dirname, "../data/debug");
        if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
        const ssPath = path.join(ssDir, `veo_tab${index + 1}_${elapsed}s.png`);
        await page.screenshot({ path: ssPath, fullPage: false }).catch(() => {});
        console.log(`📸 [VeoAuto-Tab ${index + 1}] Debug screenshot: ${ssPath}`);
      }

      if (!hasRefreshed && elapsed >= 300) {
        hasRefreshed = true;
        console.log(`🔄 [VeoAuto-Tab ${index + 1}] Reloading page to fix freeze...`);
        await page.reload({ waitUntil: "networkidle2", timeout: 30_000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 4000));
      }

      const pageResult = await page.evaluate((initialDownloadCount: number) => {
        const bodyText = document.body?.innerText || "";
        const videoReady = bodyText.includes("Your video is ready") || bodyText.includes("video is ready") ||
                           bodyText.includes("Video của bạn đã sẵn sàng") ||
                           bodyText.includes("video đã sẵn sàng") ||
                           bodyText.includes("video đã được tạo") ||
                           bodyText.includes("video đã xong");
        const downloadBtns = document.querySelectorAll('button[aria-label*="Download" i], button[aria-label*="download" i], button[aria-label*="Tải" i], button[aria-label*="tải" i], a[download]');
        const hasDownload = downloadBtns.length > initialDownloadCount;
        const errorText = document.querySelector('.error-container, [class*="error-message"]')?.textContent?.trim().slice(0, 100);
        return { videoReady, hasDownload, errorText };
      }, initialDownloadCount).catch(() => ({ videoReady: false, hasDownload: false, errorText: null }));

      if (pageResult.videoReady || pageResult.hasDownload) {
        // Try to get video source directly from DOM
        const videoSrc = await page.evaluate((initialVideoCount: number) => {
          // Check all video tags directly
          const videos = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[];
          for (let i = videos.length - 1; i >= 0; i--) {
            const src = videos[i].src || videos[i].currentSrc;
            if (src && (src.includes("google") || src.includes("blob:") || src.includes(".mp4") || src.includes("videoplayback"))) {
              return src;
            }
          }
          // Also check <source> tags
          const sources = Array.from(document.querySelectorAll("video source")) as HTMLSourceElement[];
          for (let i = sources.length - 1; i >= 0; i--) {
            if (sources[i].src) return sources[i].src;
          }
          return null;
        }, initialVideoCount).catch(() => null);

        if (videoSrc) {
          capturedVideoUrl = videoSrc;
          found = true;
          console.log(`🎯 [VeoAuto-Tab ${index + 1}] Found video element src directly: ${videoSrc.slice(0, 80)}...`);
          break;
        }

        if (!downloadButtonClicked) {
          console.log(`⬇️  [VeoAuto-Tab ${index + 1}] Video ready. Clicking download as fallback...`);
          const clicked = await page.evaluate((initialDownloadCount: number) => {
            const buttons = Array.from(document.querySelectorAll("button, a")).filter(el => {
              const aria = (el.getAttribute("aria-label") || "").toLowerCase();
              const title = (el.getAttribute("title") || "").toLowerCase();
              const text = (el.textContent || "").toLowerCase();
              const html = el.outerHTML.toLowerCase();
              return (
                aria.includes("download") || aria.includes("tải") ||
                title.includes("download") || title.includes("tải") ||
                text.includes("download") || text.includes("tải") ||
                html.includes("download") || html.includes("tải video")
              );
            });
            if (buttons.length > 0) {
              const latestBtn = buttons[buttons.length - 1] as HTMLElement;
              latestBtn.click();
              return true;
            }
            return false;
          }, initialDownloadCount);

          if (clicked) {
            downloadButtonClicked = true;
            // Wait for file in isolated tab directory
            for (let k = 0; k < 15; k++) {
              await new Promise(r => setTimeout(r, 1000));
              const files = fs.readdirSync(tabDownloadDir!).filter(f =>
                (f.endsWith(".mp4") || f.endsWith(".webm")) && !f.endsWith(".crdownload")
              );
              if (files.length > 0) {
                capturedVideoUrl = path.join(tabDownloadDir!, files[files.length - 1]);
                found = true;
                break;
              }
            }
            if (found) break;
          }
        } else {
          console.log(`⏳ [VeoAuto-Tab ${index + 1}] Download button fallback already clicked. Waiting for network URL or download completion...`);
        }
      }

      if (capturedVideoUrl) { found = true; break; }
      if (pageResult.errorText) {
        console.warn(`⚠️  [VeoAuto-Tab ${index + 1}] Gemini error: ${pageResult.errorText}`);
      }
    }

    if (!found && !capturedVideoUrl) {
      throw new Error(`Timeout waiting for video on Tab ${index + 1}`);
    }

    if (!capturedVideoUrl) {
      capturedVideoUrl = await page.evaluate(() => {
        const videos = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[];
        if (videos.length > 0) {
          const latestVideo = videos[videos.length - 1];
          if (latestVideo) return latestVideo.src || latestVideo.currentSrc || null;
        }
        return null;
      });
    }

    if (!capturedVideoUrl) {
      throw new Error(`Could not find video URL on Tab ${index + 1}`);
    }

    console.log(`` + `✅ [VeoAuto-Tab ${index + 1}] Video URL captured: ${capturedVideoUrl.slice(0, 60)}...`);

    // Download file
    const targetFilename = `${productSlug}_part${index + 1}_${pageRunId}.mp4`;
    const targetPath = path.join(customOutputDir || DOWNLOADS_DIR, targetFilename);

    let downloadedFile: string | null = null;

    if (capturedVideoUrl.startsWith("blob:")) {
      console.log(`📦 [VeoAuto-Tab ${index + 1}] Detected blob URL. Downloading via page-context base64 conversion...`);
      try {
        const base64Data = await page.evaluate(async (url: string) => {
          const response = await fetch(url);
          const blob = await response.blob();
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const result = reader.result as string;
              const base64 = result.split(',')[1];
              resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }, capturedVideoUrl);

        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(targetPath, buffer);
        downloadedFile = targetPath;
        console.log(`✅ [VeoAuto-Tab ${index + 1}] Blob video downloaded and saved to: ${targetPath}`);
      } catch (blobErr: any) {
        console.error(`❌ [VeoAuto-Tab ${index + 1}] Failed to download blob video: ${blobErr.message}`);
      }
    }

    if (!downloadedFile) {
      // Trigger tab-specific CDP download
      const dlPage = await createBackgroundPage(browser);
      const dlClient = await dlPage.createCDPSession();
      await dlClient.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: toHostPath(tabDownloadDir!),
      }).catch(() => {});

      await dlPage.goto(capturedVideoUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});

      // Wait for file in isolated folder
      for (let k = 0; k < 30; k++) {
        await new Promise(r => setTimeout(r, 1000));
        const files = fs.readdirSync(tabDownloadDir!).filter(f =>
          (f.endsWith(".mp4") || f.endsWith(".webm")) && !f.endsWith(".crdownload")
        );
        if (files.length > 0) {
          const newest = files.sort((a, b) => {
            const sa = fs.statSync(path.join(tabDownloadDir!, a));
            const sb = fs.statSync(path.join(tabDownloadDir!, b));
            return sb.mtimeMs - sa.mtimeMs;
          })[0];
          downloadedFile = path.join(tabDownloadDir!, newest);
          break;
        }
      }
      await dlPage.close().catch(() => {});

      if (!downloadedFile) {
        console.warn(`⚠️  [VeoAuto-Tab ${index + 1}] CDP download failed. Trying Axios download...`);
        await downloadFile(capturedVideoUrl, targetPath);
        downloadedFile = targetPath;
      } else {
        // Move downloaded file to targetPath
        fs.renameSync(downloadedFile, targetPath);
        downloadedFile = targetPath;
        console.log(`✅ [VeoAuto-Tab ${index + 1}] Video downloaded & renamed to: ${targetPath}`);
      }

    }

    // Clean up temporary tab download directory
    try {
      if (tabDownloadDir && fs.existsSync(tabDownloadDir)) {
        fs.rmSync(tabDownloadDir, { recursive: true, force: true });
      }
    } catch {}

    const durationMs = Date.now() - startTime;
    return { success: true, localPath: targetPath, videoUrl: capturedVideoUrl, prompt, durationMs };

  } catch (err: any) {
    const durationMs = Date.now() - startTime;
    console.error(`❌ [VeoAuto-Tab ${index + 1}] Error: ${err.message}`);
    
    // Clean up temporary tab download directory on error
    try {
      if (tabDownloadDir && fs.existsSync(tabDownloadDir)) {
        fs.rmSync(tabDownloadDir, { recursive: true, force: true });
      }
    } catch {}

    return { success: false, error: err.message, prompt, durationMs };
  } finally {
    if (localImagePath) {
      const pathsArr = Array.isArray(localImagePath) ? localImagePath : [localImagePath];
      for (const p of pathsArr) {
        if (p && p.includes("_frame") && fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch {}
        }
      }
    }
    if (page) await page.close().catch(() => {});
  }
}

/**
 * Generates a single Veo video segment for a specific part/scene.
 * Uses existing running Chrome or launches isolated Chrome.
 */
export async function generateSingleVeoSegment(
  prompt: string,
  sceneIndex: number,
  imageUrl?: string,
  productSlug: string = "scene",
  customOutputDir?: string,
  sceneImagePath?: string,
  dialogue?: string
): Promise<VeoResult> {
  const startTime = Date.now();
  let browser: any = null;
  let ownsBrowser = false;
  let localImagePath: string | string[] | null = null;
  let downloadedTempImage: string | null = null;

  const outputDir = customOutputDir || DOWNLOADS_DIR;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 1. Resolve image to upload: check if previous video segment exists to chain ending frame
  let prevEndFrame: string | null = null;
  if (sceneIndex > 0) {
    try {
      const files = fs.readdirSync(outputDir);
      const prevVideo = files.find(f => f.endsWith(".mp4") && f.includes(`_part${sceneIndex}_`) && !f.includes("_merged"));
      if (prevVideo) {
        const prevVideoPath = path.join(outputDir, prevVideo);
        const kfs = await extractThreeKeyframes(prevVideoPath, outputDir);
        if (kfs.length > 0) {
          prevEndFrame = kfs[kfs.length - 1];
          console.log(`🔗 [VeoAuto-Single] Chaining Part ${sceneIndex + 1} with Part ${sceneIndex} video end-frame for seamless continuity`);
        }
      }
    } catch {}
  }

  // Always pair ending frame with scene image so Veo gets both continuity + correct content
  if (prevEndFrame) {
    const directScenePng = path.join(outputDir, "scenes", `scene_${sceneIndex + 1}.png`);
    const directSceneJpg = path.join(outputDir, "scenes", `scene_${sceneIndex + 1}.jpg`);
    if (sceneImagePath && fs.existsSync(sceneImagePath)) {
      localImagePath = [prevEndFrame, sceneImagePath];
      console.log(`📸 [VeoAuto-Single] Uploading: prev end-frame + specified scene keyframe for Part ${sceneIndex + 1}`);
    } else if (fs.existsSync(directScenePng)) {
      localImagePath = [prevEndFrame, directScenePng];
      console.log(`📸 [VeoAuto-Single] Uploading: prev end-frame + scene_${sceneIndex + 1}.png for Part ${sceneIndex + 1}`);
    } else if (fs.existsSync(directSceneJpg)) {
      localImagePath = [prevEndFrame, directSceneJpg];
      console.log(`📸 [VeoAuto-Single] Uploading: prev end-frame + scene_${sceneIndex + 1}.jpg for Part ${sceneIndex + 1}`);
    } else {
      localImagePath = prevEndFrame;
      console.log(`⚠️ [VeoAuto-Single] Only uploading prev end-frame (no scene image found for Part ${sceneIndex + 1})`);
    }
  } else {
    const directScenePng = path.join(outputDir, "scenes", `scene_${sceneIndex + 1}.png`);
    const directSceneJpg = path.join(outputDir, "scenes", `scene_${sceneIndex + 1}.jpg`);

    if (sceneImagePath && fs.existsSync(sceneImagePath)) {
      localImagePath = sceneImagePath;
      console.log(`📸 [VeoAuto-Single] Using specified scene keyframe: ${path.basename(sceneImagePath)}`);
    } else if (fs.existsSync(directScenePng)) {
      localImagePath = directScenePng;
      console.log(`📸 [VeoAuto-Single] Using local Part ${sceneIndex + 1} scene image: ${path.basename(directScenePng)}`);
    } else if (fs.existsSync(directSceneJpg)) {
      localImagePath = directSceneJpg;
      console.log(`📸 [VeoAuto-Single] Using local Part ${sceneIndex + 1} scene image: ${path.basename(directSceneJpg)}`);
    } else if (imageUrl) {
      let localFound = false;
      if (imageUrl.startsWith("/downloads/")) {
        const cleanRel = imageUrl.split("?")[0].replace("/downloads/", "");
        const fullLocal = path.resolve(DOWNLOADS_DIR, cleanRel);
        if (fs.existsSync(fullLocal)) {
          localImagePath = fullLocal;
          localFound = true;
          console.log(`📸 [VeoAuto-Single] Using local file for Part ${sceneIndex + 1}: ${path.basename(fullLocal)}`);
        }
      }

      if (!localFound) {
        try {
          console.log(`📥 [VeoAuto-Single] Downloading image for Part ${sceneIndex + 1}...`);
          let fetchUrl = imageUrl;
          if (imageUrl.includes(".amazonaws.com/")) {
            const parts = imageUrl.split(".amazonaws.com/");
            if (parts.length > 1) {
              const key = parts[1];
              const port = process.env.PORT || "3400";
              fetchUrl = `http://127.0.0.1:${port}/api/products/image-proxy?key=${encodeURIComponent(key)}`;
            }
          } else if (imageUrl.startsWith("/")) {
            const port = process.env.PORT || "3400";
            fetchUrl = `http://127.0.0.1:${port}${imageUrl}`;
          }

          const response = await axios.get(fetchUrl, { responseType: "arraybuffer", timeout: 15000 });
          const contentType = String(response.headers["content-type"] ?? "image/jpeg");
          const ext = contentType.split("/")[1] || "jpg";
          const tempFilename = `scene_${sceneIndex + 1}_reference.${ext}`;
          downloadedTempImage = path.join(DOWNLOADS_DIR, tempFilename);
          fs.writeFileSync(downloadedTempImage, response.data);
          localImagePath = downloadedTempImage;
          console.log(`✅ [VeoAuto-Single] Downloaded image: ${downloadedTempImage}`);
        } catch (err: any) {
          console.warn(`⚠️  [VeoAuto-Single] Failed to download image: ${err.message}`);
        }
      }
    }
  }

  try {
    let puppeteer: any;
    try {
      // @ts-ignore
      puppeteer = (await import("puppeteer")).default;
    } catch {
      throw new Error("puppeteer is not installed. Run: npm install puppeteer");
    }

    await ensureChromeRunning();

    try {
      const debugUrl = `http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version`;
      const checkRes = await fetch(debugUrl).catch(() => null);

      if (checkRes && checkRes.ok) {
        const info = (await checkRes.json()) as any;
        console.log(`🔗 [VeoAuto-Single] Connecting to existing Chrome: ${info.Browser}`);
        browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${CHROME_DEBUG_PORT}`,
          defaultViewport: null,
        });
        ownsBrowser = false;
      } else {
        throw new Error("No Chrome on debug port");
      }
    } catch (connectErr: any) {
      console.log(`⚠️  [VeoAuto-Single] Debug port unavailable: ${connectErr.message}, launching isolated profile...`);
      const tempProfileDir = copyProfileToTemp();

      browser = await puppeteer.launch({
        executablePath: getChromePath(),
        userDataDir: tempProfileDir,
        args: [
          `--profile-directory=${CHROME_PROFILE}`,
          "--window-position=3000,100",
          "--window-size=1280,900",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
        ],
        headless: false,
        defaultViewport: { width: 1280, height: 900 },
      });
      ownsBrowser = true;
    }

    const finalPrompt = buildVeoScenePrompt(prompt, dialogue, sceneIndex);
    console.log(`🎬 [VeoAuto-Single] Running Veo generation for Part ${sceneIndex + 1}... ${dialogue ? `(Thoại: "${dialogue.slice(0, 50)}...")` : "(Không thoại)"}`);
    const result = await runSingleVeoAutomation(
      browser,
      finalPrompt,
      localImagePath,
      sceneIndex,
      productSlug,
      outputDir
    );

    return result;
  } catch (err: any) {
    console.error(`❌ [VeoAuto-Single] Error: ${err.message}`);
    return {
      success: false,
      error: err.message,
      prompt,
      durationMs: Date.now() - startTime,
    };
  } finally {
    if (downloadedTempImage && fs.existsSync(downloadedTempImage)) {
      try { fs.unlinkSync(downloadedTempImage); } catch {}
    }
    if (ownsBrowser && browser) {
      await browser.close();
      cleanupTempProfiles();
    } else if (browser) {
      try {
        browser.disconnect?.();
      } catch {}
    }
  }
}
