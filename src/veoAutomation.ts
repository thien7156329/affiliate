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
import { optimizeImageBuffer } from "./imageOptimizer.js";
import { normalizeVisualStyle, sanitizePromptForVisualStyle } from "./worldStyles.js";
import { sanitizePromptForVeoPolicy, sanitizeVeoDialogueForLipSync } from "./promptValidator.js";

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
 * Positioned far to the left with a small size — effectively hidden but still functioning.
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
          right: 2100,
          top: 30,
          width: 900,
          height: 900,
        },
      });
    }
    await session.detach();
  } catch {}
}

const activeVeoPages = new Set<any>();
let lastVeoAbortTimestamp = 0;

export function isVeoTaskAborted(taskStartTime: number): boolean {
  return lastVeoAbortTimestamp > 0 && taskStartTime <= lastVeoAbortTimestamp;
}

export async function abortAllActiveVeoTasks(): Promise<number> {
  lastVeoAbortTimestamp = Date.now();
  const pages = Array.from(activeVeoPages);
  activeVeoPages.clear();
  let closed = 0;
  for (const p of pages) {
    try {
      await p.close();
      closed++;
    } catch {}
  }
  console.log(`⛔ [VeoAuto] Aborted all active Veo/Image tasks (closed ${closed} browser tabs).`);
  return closed;
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
  activeVeoPages.add(page);
  try {
    page.on?.("close", () => {
      activeVeoPages.delete(page);
    });
  } catch {}
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
  voicedPath?: string;
  voicedUrl?: string;
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
/** Lower-case fragments of Gemini's "out of today's quota" answers (image or video). */
export const GEMINI_QUOTA_PHRASES = [
  "upgrade your subscription",
  "nâng cấp gói",
  "reached your limit",
  "reached the limit",
  "đã đạt đến giới hạn",
  "đạt giới hạn",
  "try again tomorrow",
  "thử lại vào ngày mai",
  "hết lượt",
];

export async function generateVeoVideo(
  prompt: string,
  imageUrl?: string,
  opts?: { rawPrompt?: boolean },
): Promise<VeoResult> {
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

  // rawPrompt: the caller (story style) wrote the whole prompt; skip the live-action/3D wrapper.
  const finalPrompt = opts?.rawPrompt ? prompt : buildVeoScenePrompt(prompt);
  console.log(`🎬 [VeoAuto] Starting video generation for prompt:\n   "${finalPrompt.slice(0, 80)}..."`);
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

      // A file already on this machine (e.g. a story panel) is read directly instead of fetched.
      const isLocalFile = fs.existsSync(imageUrl);
      const response = isLocalFile ? null : await axios.get(fetchUrl, { responseType: "arraybuffer", timeout: 15000 });
      const rawContentType = isLocalFile
        ? (/\.png$/i.test(imageUrl) ? "image/png" : "image/jpeg")
        : String(response!.headers["content-type"] ?? "image/jpeg");
      const mime = rawContentType.split(";")[0].trim().toLowerCase();
      const cleanExt = mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
      const ext = cleanExt === "jpeg" ? "jpg" : cleanExt;
      const rawBuffer = isLocalFile ? fs.readFileSync(imageUrl) : Buffer.from(response!.data);
      const { buffer, ext: optimizedExt } = await optimizeImageBuffer(rawBuffer, {
        maxWidth: 1920,
        maxHeight: 1920,
        quality: 82,
      });
      const tempFilename = `gemini_upload_${randomUUID().split("-")[0]}.${optimizedExt || ext}`;
      localImagePath = path.join(DOWNLOADS_DIR, tempFilename);
      fs.writeFileSync(localImagePath, buffer);
      console.log(`✅ [VeoAuto] Downloaded and optimized product image to local path: ${localImagePath}`);
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
          "--window-position=10,40",
          "--window-size=680,540",
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
      const contentType = (response.headers()["content-type"] || "").toLowerCase();

      // Exclude Gemini LLM endpoints, RPC calls, avatars, and upload URLs
      if (url.includes("generativelanguage.googleapis.com") || url.includes("batchexecute") || url.includes("google.com/upload") || url.includes("aiusercontent.google.com/image")) {
        return;
      }

      const isVideo = contentType.startsWith("video/") ||
        url.includes(".mp4") || url.includes("videoplayback") ||
        url.includes("video-downloads");

      if (isVideo && !capturedVideoUrl && !url.startsWith("blob:")) {
        capturedVideoUrl = url;
        console.log(`🎯 [VeoAuto] Captured genuine video URL: ${url.slice(0, 100)}`);
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
    // Direct URL navigation is more reliable than clicking sidebar links
    console.log("🎥 [VeoAuto] Navigating directly to Gemini Video page...");
    try {
      // Strategy 1: Direct URL navigation to Video page
      const currentUrl = await page.url();
      if (!currentUrl.includes("/video")) {
        await page.goto("https://gemini.google.com/app/video", { waitUntil: "networkidle2", timeout: 30_000 });
        await new Promise(r => setTimeout(r, 3000));
      }

      // Verify we're on the Video page
      const videoPageCheck = await page.evaluate(() => {
        const url = window.location.href;
        const bodyText = document.body?.innerText || "";
        const hasVideoHeading = bodyText.includes("Tạo video") || bodyText.includes("Create video");
        const hasVideoUrl = url.includes("/video");
        return { url, hasVideoHeading, hasVideoUrl };
      });
      console.log(`🎥 [VeoAuto] Video page check — URL: ${videoPageCheck.hasVideoUrl}, Heading: ${videoPageCheck.hasVideoHeading}`);

      // Strategy 2: If URL navigation failed, try sidebar click
      if (!videoPageCheck.hasVideoUrl && !videoPageCheck.hasVideoHeading) {
        console.log("⚠️  [VeoAuto] Direct URL nav failed, trying sidebar click...");
        const sidebarClicked = await page.evaluate(() => {
          // Try sidebar link
          const link = document.querySelector('[data-test-id="videos-side-nav-entry-button"] a') as HTMLAnchorElement
            || document.querySelector('a[href="/videos"]') as HTMLAnchorElement
            || document.querySelector('a[href*="video"]') as HTMLAnchorElement
            || Array.from(document.querySelectorAll('a')).find(a => {
              const text = (a.textContent || '').toLowerCase();
              return text === 'video' || text === 'videos';
            }) as HTMLAnchorElement;
          if (link) {
            link.click();
            return true;
          }
          return false;
        });
        if (sidebarClicked) {
          await new Promise(r => setTimeout(r, 3000));
          console.log("✅ [VeoAuto] Sidebar Video link clicked");
        }
      }

      // Strategy 3: If still not on Video page, force-select "Tạo video" from tools dropdown
      const stillNotVideo = await page.evaluate(() => {
        const url = window.location.href;
        const bodyText = document.body?.innerText || "";
        return !url.includes("/video") && !bodyText.includes("Tạo video") && !bodyText.includes("Create video");
      });

      if (stillNotVideo) {
        console.log("⚠️  [VeoAuto] Still not on Video page, trying to select 'Tạo video' from tools menu...");
        // Click the tools/attachment button to open menu
        await page.evaluate(() => {
          const toolsBtn = document.querySelector('button[aria-label*="công cụ"]') as HTMLButtonElement
            || document.querySelector('button[aria-label*="tools"]') as HTMLButtonElement
            || document.querySelector('.add-content-button button') as HTMLButtonElement
            || Array.from(document.querySelectorAll('button')).find(b =>
              b.innerHTML.includes('add') || b.getAttribute('aria-label')?.includes('+')
            ) as HTMLButtonElement;
          if (toolsBtn) toolsBtn.click();
        });
        await new Promise(r => setTimeout(r, 1000));

        // Select "Tạo video" option
        const videoModeSelected = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('button, [role="menuitem"], span, div'));
          const videoItem = items.find(el => {
            const text = (el.textContent || '').trim();
            return text === 'Tạo video' || text === 'Create video' || text === 'Generate video';
          }) as HTMLElement;
          if (videoItem) {
            videoItem.click();
            return true;
          }
          return false;
        });
        if (videoModeSelected) {
          console.log("✅ [VeoAuto] 'Tạo video' mode selected from tools menu");
          await new Promise(r => setTimeout(r, 2000));
        } else {
          console.warn("⚠️  [VeoAuto] Could not find 'Tạo video' option — video may generate via chat fallback");
        }
      }
    } catch (err: any) {
      console.warn(`⚠️  [VeoAuto] Video navigation failed: ${err.message} — using chat fallback`);
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
        // Step 0: Check if input[type="file"] already exists in DOM to avoid opening menu unnecessarily
        let fileInputHandle = await page.evaluateHandle(() => {
          const imageInput = document.querySelector('input[type="file"][accept*="image"]') as HTMLInputElement;
          if (imageInput) return imageInput;
          const activeArea = document.querySelector('rich-textarea, chat-input, .input-area, .text-input-container');
          return (activeArea?.querySelector('input[type="file"]') as HTMLInputElement) || null;
        });

        if (!fileInputHandle || (await fileInputHandle.jsonValue()) === null) {
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
          // Note: In Gemini, clicking the (+) button ALREADY mounts the <input type="file"> elements in DOM.
          // DO NOT click 'Tệp' / 'Upload from computer' because that triggers input.click(),
          // which opens the OS-level native Finder / File Dialog modal that cannot be closed by script!
          await new Promise(r => setTimeout(r, 600));
        }

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
        if (!fileInputHandle || (await fileInputHandle.jsonValue()) === null) {
          fileInputHandle = await page.evaluateHandle(() => {
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
        }

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

          // Automatically close any open menu, dialog, or overlay backdrop
          await page.evaluate(() => {
            const backdrops = Array.from(document.querySelectorAll('.cdk-overlay-backdrop, .mat-overlay-backdrop, .modal-backdrop'));
            backdrops.forEach(b => (b as HTMLElement).click());
            const closeBtn = document.querySelector('button[aria-label*="Đóng" i], button[aria-label*="Close" i], .mat-mdc-dialog-container button[aria-label*="close" i]') as HTMLElement;
            if (closeBtn) closeBtn.click();
          });
          await page.keyboard.press('Escape').catch(() => {});
          await new Promise(r => setTimeout(r, 500));
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
    }, inputSelector, finalPrompt);

    await new Promise(r => setTimeout(r, 1000));

    // ── Enable "Add sound" toggle if available ─────────────────────────────
    console.log("🔊 [VeoAuto] Checking for 'Add sound' toggle...");
    const soundEnabled = await page.evaluate(() => {
      // Strategy 1: Find toggle/checkbox/switch containing "Add sound" or "Thêm âm thanh" text
      const allLabels = Array.from(document.querySelectorAll('label, span, div, p, button'));
      const soundLabel = allLabels.find(el => {
        const text = (el.textContent || '').trim().toLowerCase();
        return text === 'add sound' || text === 'thêm âm thanh' || 
               text.includes('add sound') || text.includes('âm thanh');
      }) as HTMLElement | null;
      
      if (soundLabel) {
        // Find associated toggle/checkbox/switch near the label
        const parent = soundLabel.closest('.toggle-container, .setting-row, .option-row, mat-slide-toggle, label, [role="switch"]') || soundLabel.parentElement;
        if (parent) {
          // Check for mat-slide-toggle
          const slideToggle = parent.querySelector('mat-slide-toggle, [role="switch"]') as HTMLElement;
          if (slideToggle) {
            const isChecked = slideToggle.classList.contains('mat-mdc-slide-toggle-checked') || 
                              slideToggle.getAttribute('aria-checked') === 'true';
            if (!isChecked) {
              slideToggle.click();
              return 'toggled_on';
            }
            return 'already_on';
          }
          
          // Check for regular checkbox
          const checkbox = parent.querySelector('input[type="checkbox"]') as HTMLInputElement;
          if (checkbox && !checkbox.checked) {
            checkbox.click();
            return 'toggled_on';
          } else if (checkbox?.checked) {
            return 'already_on';
          }
          
          // Try clicking the label/button itself as toggle
          const clickTarget = parent.querySelector('button, [role="switch"], .toggle') as HTMLElement;
          if (clickTarget) {
            clickTarget.click();
            return 'clicked_toggle';
          }
        }
        // Fallback: click the label itself
        soundLabel.click();
        return 'clicked_label';
      }
      
      // Strategy 2: Find any mat-slide-toggle or switch near sound-related aria labels
      const toggles = Array.from(document.querySelectorAll('mat-slide-toggle, [role="switch"]'));
      for (const toggle of toggles) {
        const nearby = toggle.closest('.setting-row, .option-row, label');
        const nearbyText = (nearby?.textContent || toggle.getAttribute('aria-label') || '').toLowerCase();
        if (nearbyText.includes('sound') || nearbyText.includes('âm thanh') || nearbyText.includes('audio')) {
          const isChecked = (toggle as HTMLElement).classList.contains('mat-mdc-slide-toggle-checked') || 
                            toggle.getAttribute('aria-checked') === 'true';
          if (!isChecked) {
            (toggle as HTMLElement).click();
            return 'toggled_on';
          }
          return 'already_on';
        }
      }
      
      return 'not_found';
    });
    console.log(`🔊 [VeoAuto] Sound toggle result: ${soundEnabled}`);
    if (soundEnabled === 'toggled_on' || soundEnabled === 'clicked_toggle' || soundEnabled === 'clicked_label') {
      await new Promise(r => setTimeout(r, 500));
    }

    // Take screenshot to verify before submitting
    const debugDir = path.resolve(__dirname, "../data/debug");
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    await page.screenshot({ path: path.join(debugDir, "before_submit.png") }).catch(() => {});

    // Submit prompt using DOM click on Generate/Send button
    const submitted = await page.evaluate(() => {
      // 1. Search strictly inside the input area container first
      const inputArea = document.querySelector('input-area-v2, .input-area, .chat-input-container, input-container, fieldset.input-area-container');
      if (inputArea) {
        const areaSendBtn = inputArea.querySelector(
          '.send-button button, .send-button-container button, gem-icon-button.send-button button, button[aria-label="Send message"], button[aria-label="Gửi tin nhắn"], button mat-icon[data-mat-icon-name="arrow_upward"], button mat-icon[fonticon="arrow_upward"]'
        ) as HTMLElement | null;
        if (areaSendBtn) {
          const btn = (areaSendBtn.tagName === 'BUTTON' ? areaSendBtn : areaSendBtn.closest('button')) as HTMLButtonElement | null;
          if (btn && !btn.disabled) {
            btn.click();
            return true;
          }
        }
      }

      // 2. High-priority dedicated Send button selectors (strictly excluding sidebar/history/menus)
      const selectors = [
        '.send-button button',
        '.send-button-container button',
        'gem-icon-button.send-button button',
        'button[aria-label="Send message"]',
        'button[aria-label="Gửi tin nhắn"]',
        'button mat-icon[data-mat-icon-name="arrow_upward"]',
        'button mat-icon[fonticon="arrow_upward"]',
      ];
      for (const sel of selectors) {
        const target = document.querySelector(sel) as HTMLElement | null;
        if (target) {
          const btn = (target.tagName === 'BUTTON' ? target : target.closest('button')) as HTMLButtonElement | null;
          if (
            btn &&
            !btn.disabled &&
            !btn.closest('side-navigation-v2, bard-sidenav-container, bard-sidenav-content, mat-menu-panel, [role="navigation"], [role="menu"], aside, nav, .sidebar-list')
          ) {
            btn.click();
            return true;
          }
        }
      }
      
      // 3. Fallback: Search buttons ONLY within main chat / input area (never sidebar)
      const mainArea = document.querySelector('chat-window, .main-content, main, .content-container') || document;
      const btns = Array.from(mainArea.querySelectorAll('button'));
      const targetBtn = btns.find(b => {
        if (b.closest('side-navigation-v2, bard-sidenav-container, bard-sidenav-content, mat-menu-panel, [role="navigation"], [role="menu"], aside, nav, .sidebar-list, .context-menu')) {
          return false;
        }

        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const text = (b.textContent || '').toLowerCase();
        const html = (b.innerHTML || '').toLowerCase();

        return aria === 'send message' || aria === 'gửi tin nhắn' || aria === 'send' || aria === 'gửi' ||
               text === 'send' || text === 'gửi' ||
               html.includes('data-mat-icon-name="arrow_upward"') || html.includes('fonticon="arrow_upward"');
      });
      if (targetBtn && !targetBtn.disabled) {
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
      if (isVeoTaskAborted(startTime)) {
        throw new Error("Đã hủy tiến trình render video theo yêu cầu");
      }
      await new Promise(r => setTimeout(r, 5000));
      if (isVeoTaskAborted(startTime)) {
        throw new Error("Đã hủy tiến trình render video theo yêu cầu");
      }
      const elapsed = Math.round((Date.now() - pollStart) / 1000);

      // Network-intercepted MP4 → done immediately
      if (capturedVideoUrl) {
        console.log(`🎯 [VeoAuto] Video URL captured via network (${elapsed}s)`);
        found = true;
        break;
      }

      // Out of daily Veo quota → Gemini answers with an upgrade/limit message and never makes a video.
      if (elapsed >= 10) {
        const quotaText: string | null = await page.evaluate((phrases: string[]) => {
          const els = Array.from(document.querySelectorAll("message-content, model-response, .model-response"));
          for (const el of els) {
            const t = (el.textContent || "").trim();
            if (phrases.some((p) => t.toLowerCase().includes(p))) return t.slice(0, 200);
          }
          return null;
        }, GEMINI_QUOTA_PHRASES).catch(() => null);
        if (quotaText) throw new Error(`QUOTA: Gemini hết lượt tạo video hôm nay — "${quotaText}"`);
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
        // Detect "Your video is ready!" message (English + Vietnamese), excluding loading message "check back to see when your video is ready"
        const bodyText = document.body?.innerText || "";
        const isGeneratingMsg = bodyText.includes("when your video is ready") ||
                                bodyText.includes("I'm generating your video") ||
                                bodyText.includes("Đang tạo video");
        const videoReady = !isGeneratingMsg && (
                           bodyText.includes("Your video is ready") ||
                           bodyText.includes("Video của bạn đã sẵn sàng") ||
                           bodyText.includes("video đã sẵn sàng") ||
                           bodyText.includes("video đã được tạo") ||
                           bodyText.includes("video đã xong"));

        // Find genuine download video button (exclude upload buttons like 'Nội dung tải lên' / 'Upload')
        const allBtns = Array.from(document.querySelectorAll('button, a[download]'));
        const downloadBtn = allBtns.find(b => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const text = (b.textContent || '').toLowerCase();
          // Exclude upload buttons
          if (aria.includes('tải lên') || aria.includes('upload') || text.includes('tải lên') || text.includes('upload')) return false;
          return aria.includes('tải xuống') || aria.includes('tải video') || aria.includes('download') ||
                 text.includes('tải xuống') || text.includes('download') || b.hasAttribute('download');
        });

        const errorText = document.querySelector(
          '.error-container, [class*="error-message"]'
        )?.textContent?.trim().slice(0, 100);

        return { videoReady, hasDownload: !!downloadBtn, errorText };
      }).catch(() => ({ videoReady: false, hasDownload: false, errorText: null }));

      // Veo video generation takes at least 20-30s. Ignore premature DOM triggers before 20s
      if (elapsed < 20) {
        continue;
      }

      if (pageResult.videoReady || pageResult.hasDownload) {
        // Try to get video source directly first to avoid navigation-inducing clicks
        const videoSrc = await page.evaluate(() => {
          const allBtns = Array.from(document.querySelectorAll('button, a[download]'));
          const downloadBtns = allBtns.filter(b => {
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            const text = (b.textContent || '').toLowerCase();
            if (aria.includes('tải lên') || aria.includes('upload') || text.includes('tải lên') || text.includes('upload')) return false;
            return aria.includes('tải xuống') || aria.includes('tải video') || aria.includes('download') ||
                   text.includes('tải xuống') || text.includes('download') || b.hasAttribute('download');
          });
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

    if (!downloadedFile || !fs.existsSync(downloadedFile) || fs.statSync(downloadedFile).size < 300_000) {
      const size = downloadedFile && fs.existsSync(downloadedFile) ? fs.statSync(downloadedFile).size : 0;
      throw new Error(`File video tải về không hợp lệ hoặc chưa hoàn tất (${size} bytes). Gemini chưa hoàn tất render video!`);
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
      "--window-position=10,40",
      "--window-size=680,540",
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

  // Xóa frame cũ của cùng video để tránh cache stale (giữ output dir sạch)
  try {
    const existingFrames = fs.readdirSync(outputDir).filter(f =>
      f.startsWith(baseName + "_frame") && f.endsWith(".jpg")
    );
    for (const oldFrame of existingFrames) {
      try { fs.unlinkSync(path.join(outputDir, oldFrame)); } catch {}
    }
    if (existingFrames.length > 0) {
      console.log(`🧹 [VeoAuto] Đã xóa ${existingFrames.length} frame cũ của ${baseName} để tránh cache stale`);
    }
  } catch {}

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
 * Structure: Character Design → User Scene → Style → Dialogue → Motion → Accessories → Constraints
 * Designed for clean renders with natural dialogue flow.
 */
export interface VeoUploadContext {
  hasSceneKeyframe?: boolean;
  hasPrevVideoFrame?: boolean;
  totalUploaded?: number;
}

export function buildVeoScenePrompt(
  prompt: string,
  dialogue?: string,
  sceneIndex?: number,
  visualStyle: string = "real",
  uploadContext?: VeoUploadContext
): string {
  const mode = normalizeVisualStyle(visualStyle);
  const isReal = mode === "real";
  const isStickman = mode === "stickman";
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

  // 1. Sanitize according to visualStyle ("real" vs "3d" vs "stickman") and Veo 3 safety policies
  cleanPrompt = sanitizePromptForVisualStyle(cleanPrompt, mode)
    .replace(/^(Scene \d+:?\s*|Phân cảnh \d+:?\s*)/i, "")
    .trim();
  cleanPrompt = sanitizeVeoDialogueForLipSync(sanitizePromptForVeoPolicy(cleanPrompt, mode).sanitized);

  // 2. Strip legacy boilerplate if present
  cleanPrompt = cleanPrompt.replace(/WORLD STYLE BIBLE —[\s\S]*?(?=\n\n|$)/gi, '').trim();

  const sections: string[] = [];
  const hasStoryboard = Boolean(uploadContext?.hasSceneKeyframe);
  const hasPrevFrame = Boolean(uploadContext?.hasPrevVideoFrame);
  const hasAnyUpload = (uploadContext?.totalUploaded ?? (hasStoryboard || hasPrevFrame ? 1 : 0)) > 0;

  // Clear, unambiguous directive teaching Veo 3 how to combine the 9:16 continuity frame + 2x3 sequential storyboard into ONE seamless 9:16 video
  // while keeping the Scene Prompt as the supreme authority for cast, outfits, props, and plot!
  if (isReal) {
    sections.push(
      hasStoryboard && hasPrevFrame
        ? "Using Image 1 (previous scene's 9:16 frame) for recurring character facial likeness & 9:16 vertical framing, follow Image 2 (the 2x3 sequential storyboard sheet: top-left Panel 1 = 0.0s start → bottom-right Panel 6 = end) and the Scene Prompt below for THIS scene's exact cast, outfits, props, setting, and chronological action beats to render ONE continuous borderless LIVE-ACTION 9:16 vertical cinema shot (no grid lines or split panels in the output video):"
        : hasStoryboard
          ? "Follow the sequential action beats in the attached 2x3 storyboard sheet chronologically (top-left Panel 1 = 0.0s start → bottom-right Panel 6 = end) and the Scene Prompt below to render ONE continuous borderless LIVE-ACTION 9:16 vertical cinema shot (no grid lines or split panels in the output video):"
          : hasAnyUpload
            ? "Using the attached reference image for recurring character likeness & visual style while strictly obeying the Scene Prompt below for THIS scene's cast, outfits, props, and actions, render ONE continuous photorealistic LIVE-ACTION 9:16 vertical cinema shot:"
            : "Render ONE continuous borderless photorealistic LIVE-ACTION 9:16 vertical cinema shot strictly following the Scene Prompt below:"
    );
  } else if (isStickman) {
    sections.push(
      hasStoryboard && hasPrevFrame
        ? "Using Image 1 for recurring character continuity and following Image 2 (the 2x3 sequential storyboard sheet: Panel 1 → Panel 6) plus the Scene Prompt below for THIS scene's cast, outfits, props, setting, and timeline action, render ONE continuous borderless 2D Chibi Comic Marshmallow Stickman 9:16 vertical video (no grid lines in video):"
        : hasStoryboard
          ? "Follow the sequential action beats in the attached 2x3 storyboard sheet chronologically (Panel 1 → Panel 6) and the Scene Prompt below to render ONE continuous borderless 2D Chibi Comic Marshmallow Stickman 9:16 vertical video (no grid lines or split panels in the output video):"
          : hasAnyUpload
            ? "Using the attached reference frame for style continuity while strictly following the Scene Prompt below for THIS scene's cast, outfits, props, and actions, render ONE continuous 2D Chibi Comic Marshmallow Stickman 9:16 vertical video:"
            : "Render ONE continuous borderless 2D Chibi Comic Marshmallow Stickman 9:16 vertical video strictly following the Scene Prompt below:"
    );
  } else {
    sections.push(
      hasStoryboard && hasPrevFrame
        ? "Using Image 1 (previous scene's 9:16 frame) for recurring character likeness & 9:16 vertical framing, follow Image 2 (the 2x3 sequential storyboard sheet: top-left Panel 1 = 0.0s start → bottom-right Panel 6 = end) and the Scene Prompt below for THIS scene's exact cast, outfits, props, setting, and chronological action beats to render ONE continuous borderless cinematic 3D 9:16 vertical shot (no grid lines or split panels in the video):"
        : hasStoryboard
          ? "Follow the sequential action beats in the attached 2x3 storyboard sheet chronologically (top-left Panel 1 = 0.0s start → bottom-right Panel 6 = end) and the Scene Prompt below to render ONE continuous borderless cinematic 3D 9:16 vertical shot (no grid lines or split panels in the video):"
          : hasAnyUpload
            ? "Using the attached reference image for recurring character likeness & visual style while strictly obeying the Scene Prompt below for THIS scene's cast, outfits, props, and actions, render ONE continuous high-fidelity cinematic 3D 9:16 vertical shot:"
            : "Render ONE continuous borderless high-fidelity cinematic 3D 9:16 vertical shot strictly following the Scene Prompt below:"
    );
  }
  sections.push(cleanPrompt);

  // Only append standalone dialogue block if DUB_TIMELINE does NOT already embed the spoken lines
  const alreadyHasDubTimeline = /DUB_TIMELINE\s*:/i.test(cleanPrompt);
  if (dialogueText && !alreadyHasDubTimeline) {
    const safeDialogue = sanitizeVeoDialogueForLipSync(dialogueText);
    const formattedDialogue = safeDialogue.split(/\n/).map(l => l.trim()).filter(Boolean).join("\n");
    sections.push(
      `Vietnamese lip-sync performance (3/4 inward angle, natural eye contact):\n${formattedDialogue}`
    );
  }

  // Concise, high-signal Single-Take Motion & Object Permanence Lock
  if (isReal) {
    sections.push(
      "Continuity & Object Permanence Lock: Single continuous camera take (no split grids). Every held prop, container, and garment stays 100% solid, intact, and naturally held from first to last frame without vanishing or morphing. Maintain steady 0.3s lead-in and lead-out motion beats for smooth scene transitions. Photorealistic live-action cinema (no 3D CGI, no cartoon)."
    );
  } else if (isStickman) {
    sections.push(
      "Continuity & Object Permanence Lock: Single continuous 2D cel-shaded take (no split grids). Bold black outlines, white round marshmallow heads, and all held cosplay props stay 100% solid and intact throughout the shot without vanishing."
    );
  } else {
    sections.push(
      "Continuity & Object Permanence Lock: Single continuous cinematic 3D camera take (no split grids). Realistic PBR textures and all held props/accessories stay 100% solid and naturally held from first to last frame without vanishing or morphing, with smooth lead-in/lead-out motion for seamless transitions."
    );
  }

  return sections.join("\n\n");
}

/**
 * Resolves a list of image URLs or local file paths into local accessible file paths.
 * Downloads remote images, optimizes them, and keeps track of temporary downloaded files to clean up.
 */
async function resolveAndDownloadImages(
  sources: (string | undefined | null)[],
  outputDir: string,
  prefix: string = "ref_upload",
  maxImages: number = 6
): Promise<{ localImagePaths: string[]; tempFilesToClean: string[] }> {
  const localImagePaths: string[] = [];
  const tempFilesToClean: string[] = [];
  const seenPathsOrUrls = new Set<string>();

  for (const rawSource of sources) {
    if (localImagePaths.length >= maxImages) break;
    if (!rawSource || typeof rawSource !== "string") continue;
    const src = rawSource.trim();
    if (!src || seenPathsOrUrls.has(src)) continue;
    seenPathsOrUrls.add(src);

    // 1. Direct local file check
    if (fs.existsSync(src)) {
      const resolved = path.resolve(src);
      if (!localImagePaths.includes(resolved)) {
        localImagePaths.push(resolved);
      }
      continue;
    }

    // 2. Local downloads folder check
    if (src.startsWith("/downloads/")) {
      const relPath = src.split("?")[0].replace("/downloads/", "");
      const fullPath = path.resolve(DOWNLOADS_DIR, relPath);
      if (fs.existsSync(fullPath)) {
        if (!localImagePaths.includes(fullPath)) {
          localImagePaths.push(fullPath);
        }
        continue;
      }
    }

    // 3. Relative to outputDir
    const relOutputDirPath = path.resolve(outputDir, src);
    if (fs.existsSync(relOutputDirPath)) {
      if (!localImagePaths.includes(relOutputDirPath)) {
        localImagePaths.push(relOutputDirPath);
      }
      continue;
    }

    // 4. Remote URL download (http, https, s3, etc.)
    try {
      let fetchUrl = src;
      if (src.includes(".amazonaws.com/")) {
        const parts = src.split(".amazonaws.com/");
        if (parts.length > 1) {
          const key = parts[1];
          const port = process.env.PORT || "3400";
          fetchUrl = `http://127.0.0.1:${port}/api/products/image-proxy?key=${encodeURIComponent(key)}`;
        }
      } else if (src.startsWith("/")) {
        const port = process.env.PORT || "3400";
        fetchUrl = `http://127.0.0.1:${port}${src}`;
      }

      console.log(`📸 [VeoAuto] Downloading reference image: ${fetchUrl.slice(0, 80)}...`);
      const response = await axios.get(fetchUrl, { responseType: "arraybuffer", timeout: 20000 });
      const rawContentType = String(response.headers["content-type"] ?? "image/jpeg");
      const mime = rawContentType.split(";")[0].trim().toLowerCase();
      const cleanExt = mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
      const ext = cleanExt === "jpeg" ? "jpg" : cleanExt;
      const rawBuffer = Buffer.from(response.data);
      const { buffer, ext: optimizedExt } = await optimizeImageBuffer(rawBuffer, {
        maxWidth: 1920,
        maxHeight: 1920,
        quality: 82,
      });

      const tempFilename = `${prefix}_${randomUUID().split("-")[0]}.${optimizedExt || ext}`;
      const tempPath = path.join(DOWNLOADS_DIR, tempFilename);
      fs.writeFileSync(tempPath, buffer);
      localImagePaths.push(tempPath);
      tempFilesToClean.push(tempPath);
      console.log(`✅ [VeoAuto] Downloaded and optimized reference image: ${path.basename(tempPath)}`);
    } catch (err: any) {
      console.warn(`⚠️  [VeoAuto] Failed to download reference image (${src.slice(0, 50)}...): ${err.message}`);
    }
  }

  return { localImagePaths, tempFilesToClean };
}

export async function generateVeoVideoParallel(
  prompts: string[],
  imageUrl?: string | string[],
  productSlug: string = "video",
  customOutputDir?: string,
  sceneImagePaths?: string[],
  dialogues?: string[],
  referenceImagePaths?: string[],
  options?: {
    includePrevFrame?: boolean | string;
    refImagesMode?: string;
    prevFrameParts?: number[];
    visualStyle?: string;
  }
): Promise<{ success: boolean; localPaths: string[]; errors: string[]; durationMs: number }> {
  const startTime = Date.now();
  let browser: any = null;
  let ownsBrowser = false;
  const outputDir = customOutputDir || DOWNLOADS_DIR;
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const rawPrevOpt = options?.includePrevFrame;
  const includePrev = rawPrevOpt !== false && rawPrevOpt !== 'no' && rawPrevOpt !== 'false';
  const refMode = options?.refImagesMode || 'all';

  // Note: Old files are preserved for review and cleaned up daily at 10:00 AM UTC+7 via Cron Job

  console.log(`🎬 [VeoAuto] Starting PARALLEL video generation for ${prompts.length} prompts (PrevFrame: ${includePrev ? 'CÓ' : 'KHÔNG'}, RefMode: ${refMode})...`);
  if (sceneImagePaths && sceneImagePaths.length > 0) {
    console.log(`🖼️  [VeoAuto] Received ${sceneImagePaths.length} pre-generated scene keyframe image(s) from Gemini.`);
  }

  // Collect and resolve reference images according to refMode
  const rawRefSources: string[] = [];
  if (refMode !== 'none') {
    if (Array.isArray(referenceImagePaths)) rawRefSources.push(...referenceImagePaths);
    if (Array.isArray(imageUrl)) rawRefSources.push(...imageUrl);
    else if (typeof imageUrl === "string" && imageUrl.trim()) rawRefSources.push(imageUrl.trim());
  }

  const { localImagePaths: allLocalReferenceImages, tempFilesToClean } = await resolveAndDownloadImages(
    rawRefSources,
    outputDir,
    "ref_orig"
  );
  if (allLocalReferenceImages.length > 0) {
    console.log(`🖼️  [VeoAuto] Đã tải/chuẩn bị sẵn ${allLocalReferenceImages.length} ảnh gốc liên quan: [${allLocalReferenceImages.map(p => path.basename(p)).join(", ")}]`);
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
          "--window-position=10,40",
          "--window-size=680,540",
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
      
      const dialogueText = (dialogues && dialogues[i]) ? dialogues[i] : undefined;
      const pathsToUpload: string[] = [];
      let hasSceneKeyframe = false;
      let hasPrevVideoFrame = false;

      // 1. Ảnh #1: Frame cuối 9:16 của Part trước (khóa tỷ lệ toàn màn hình 9:16 không viền + đồng nhất mặt/trang phục)
      if (includePrev && i > 0) {
        for (let j = i - 1; j >= 0; j--) {
          const prevRes = results[j];
          if (prevRes && prevRes.success && prevRes.localPath && fs.existsSync(prevRes.localPath)) {
            const keyframes = await extractThreeKeyframes(prevRes.localPath, outputDir);
            if (keyframes.length > 0) {
              const endFrame = keyframes[keyframes.length - 1];
              if (endFrame && fs.existsSync(endFrame) && !pathsToUpload.includes(endFrame)) {
                pathsToUpload.push(endFrame);
                hasPrevVideoFrame = true;
                console.log(`🔗 [VeoAuto] Segment ${i + 1}: Ảnh #1 (Frame 9:16 nối nhân vật từ Part ${j + 1}) = ${path.basename(endFrame)}.`);
              }
              break;
            }
          }
        }
      }

      // 2. Ảnh #2: Bảng Storyboard 2x3 6 nhịp thời gian của chính Part này (scene_X.png)
      const currentSceneImg = (refMode !== 'none' && sceneImagePaths && sceneImagePaths[i] && fs.existsSync(sceneImagePaths[i]))
        ? sceneImagePaths[i]
        : null;
      if (currentSceneImg && !pathsToUpload.includes(currentSceneImg)) {
        pathsToUpload.push(currentSceneImg);
        hasSceneKeyframe = true;
        console.log(`📸 [VeoAuto] Segment ${i + 1}: Ảnh #${pathsToUpload.length} (Storyboard 6 nhịp của cảnh) = ${path.basename(currentSceneImg)}.`);
      }

      // 3. Nếu chưa có scene_X.png mới fallback sang ảnh gốc tham chiếu
      if (refMode !== 'none' && !currentSceneImg) {
        if (refMode === 'current_only' && allLocalReferenceImages.length > 0 && !pathsToUpload.includes(allLocalReferenceImages[0])) {
          pathsToUpload.push(allLocalReferenceImages[0]);
          console.log(`📸 [VeoAuto] Segment ${i + 1}: Kèm 1 ảnh gốc hiện tại (${path.basename(allLocalReferenceImages[0])}).`);
        } else if (refMode === 'all') {
          for (const origImg of allLocalReferenceImages) {
            if (origImg && fs.existsSync(origImg) && !pathsToUpload.includes(origImg)) {
              pathsToUpload.push(origImg);
            }
          }
        }
      }

      const finalPrompt = buildVeoScenePrompt(
        prompts[i],
        dialogueText,
        i,
        options?.visualStyle || "real",
        { hasSceneKeyframe, hasPrevVideoFrame, totalUploaded: pathsToUpload.length }
      );

      console.log(`🚀 [VeoAuto] Segment ${i + 1} [PrevFrame: ${includePrev ? 'CÓ' : 'KHÔNG'}, RefMode: ${refMode}] sẽ upload TỔNG CỘNG ${pathsToUpload.length} tấm ảnh: [${pathsToUpload.map(p => path.basename(p)).join(", ")}]`);
      const uploadParam = pathsToUpload.length === 0 ? null : (pathsToUpload.length === 1 ? pathsToUpload[0] : pathsToUpload);

      // Wait a few seconds between segments to avoid hitting Google's rate limits
      if (i > 0) {
        const delayMs = Math.floor(Math.random() * 3000) + 3000; // 3 to 6 seconds delay
        console.log(`⏳ [VeoAuto] Sleeping for ${delayMs}ms to respect Gemini rate limits...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      
      const res = await runSingleVeoAutomation(browser, finalPrompt, uploadParam, i, productSlug, outputDir);
      results.push(res);
      if (!res.success || !res.localPath) {
        console.error(`⛔ [VeoAuto] Segment ${i + 1} thất bại (${res.error || "Không tạo được video"}). Dừng ngay không tự upload/render lại.`);
        break;
      }
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
    // Cleanup temporary downloaded reference files
    for (const tempPath of tempFilesToClean) {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
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

    // Intercept network responses to capture genuine video URL
    let capturedVideoUrl: string | null = null;
    let isPromptSubmitted = false;
    page.on("response", async (response: any) => {
      if (!isPromptSubmitted) return;
      const url = response.url();
      const contentType = (response.headers()["content-type"] || "").toLowerCase();

      // Strictly exclude Gemini chat API streaming endpoints, RPC, and upload artifacts
      if (url.includes("generativelanguage.googleapis.com") || url.includes("batchexecute") || url.includes("google.com/upload") || url.includes("aiusercontent.google.com/image")) {
        return;
      }

      const isVideo = contentType.startsWith("video/") ||
        url.includes(".mp4") || url.includes("videoplayback") ||
        url.includes("video-downloads");

      if (isVideo && !capturedVideoUrl && !url.startsWith("blob:")) {
        capturedVideoUrl = url;
        console.log(`🎯 [VeoAuto-Tab ${index + 1}] Captured genuine video URL: ${url.slice(0, 100)}`);
      }
    });

    // ── Navigate to Gemini Video section ─────────────────────────────────────
    console.log(`🎥 [VeoAuto-Tab ${index + 1}] Navigating to Gemini Video page...`);
    try {
      // Strategy 1: Direct URL navigation to Video page (/app/videos or /app/video)
      const currentUrl = await page.url();
      if (!currentUrl.includes("/video")) {
        await page.goto("https://gemini.google.com/app/videos", { waitUntil: "networkidle2", timeout: 30_000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 2500));
      }

      // Verify we're on the Video page
      const videoPageCheck = await page.evaluate(() => {
        const url = window.location.href;
        const bodyText = document.body?.innerText || "";
        const hasVideoHeading = bodyText.includes("Tạo video") || bodyText.includes("Create video");
        const hasVideoUrl = url.includes("/video");
        return { url, hasVideoHeading, hasVideoUrl };
      });
      console.log(`🎥 [VeoAuto-Tab ${index + 1}] Video page check — URL: ${videoPageCheck.hasVideoUrl}, Heading: ${videoPageCheck.hasVideoHeading}`);

      // Strategy 2: If URL navigation failed, try sidebar button / link click
      if (!videoPageCheck.hasVideoUrl && !videoPageCheck.hasVideoHeading) {
        console.log(`⚠️  [VeoAuto-Tab ${index + 1}] Direct URL nav failed, trying sidebar Video button...`);
        const sidebarClicked = await page.evaluate(() => {
          const allEls = Array.from(document.querySelectorAll('a, button, [role="button"], [role="menuitem"], side-nav-item, .side-nav-button, div, span'));
          const videoBtn = allEls.find(el => {
            const inNav = el.closest('side-navigation-v2, bard-sidenav-container, bard-sidenav-content, [role="navigation"], aside, nav, .sidebar');
            const text = (el.textContent || '').trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            const testId = (el.getAttribute('data-test-id') || '').toLowerCase();
            const isVideoLabel = text === 'video' || text === 'videos' || text === 'tạo video';
            const hasVideoAttr = aria.includes('video') || testId.includes('video');
            return isVideoLabel || (inNav && hasVideoAttr);
          }) as HTMLElement | undefined;
          if (videoBtn) {
            videoBtn.click();
            return true;
          }
          return false;
        });
        if (sidebarClicked) {
          await new Promise(r => setTimeout(r, 3000));
          console.log(`✅ [VeoAuto-Tab ${index + 1}] Sidebar Video link clicked`);
        }
      }

      // Strategy 3: If still not on Video page, force-select "Tạo video" from tools dropdown
      const stillNotVideo = await page.evaluate(() => {
        const url = window.location.href;
        const bodyText = document.body?.innerText || "";
        return !url.includes("/video") && !bodyText.includes("Tạo video") && !bodyText.includes("Create video");
      });

      if (stillNotVideo) {
        console.log(`⚠️  [VeoAuto-Tab ${index + 1}] Still not on Video page, trying to select 'Tạo video' from tools menu...`);
        await page.evaluate(() => {
          const toolsBtn = document.querySelector('button[aria-label*="công cụ"]') as HTMLButtonElement
            || document.querySelector('button[aria-label*="tools"]') as HTMLButtonElement
            || document.querySelector('.add-content-button button') as HTMLButtonElement
            || Array.from(document.querySelectorAll('button')).find(b =>
              b.innerHTML.includes('add') || b.getAttribute('aria-label')?.includes('+')
            ) as HTMLButtonElement;
          if (toolsBtn) toolsBtn.click();
        });
        await new Promise(r => setTimeout(r, 1000));

        const videoModeSelected = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('button, [role="menuitem"], span, div'));
          const videoItem = items.find(el => {
            const text = (el.textContent || '').trim();
            return text === 'Tạo video' || text === 'Create video' || text === 'Generate video';
          }) as HTMLElement;
          if (videoItem) {
            videoItem.click();
            return true;
          }
          return false;
        });
        if (videoModeSelected) {
          console.log(`✅ [VeoAuto-Tab ${index + 1}] 'Tạo video' mode selected from tools menu`);
          await new Promise(r => setTimeout(r, 2000));
        } else {
          console.warn(`⚠️  [VeoAuto-Tab ${index + 1}] Could not find 'Tạo video' option — video may generate via chat fallback`);
        }
      }
    } catch (err: any) {
      console.warn(`⚠️  [VeoAuto-Tab ${index + 1}] Video navigation failed: ${err.message} — using chat fallback`);
    }

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
        // Step 1: Detect if a file input already exists in DOM or container to prevent opening the menu unnecessarily
        let fileInputHandle = await page.evaluateHandle(() => {
          const imageInput = document.querySelector('input[type="file"][accept*="image"]') as HTMLInputElement;
          if (imageInput) return imageInput;
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

          // Note: In Gemini, clicking the (+) button ALREADY mounts the <input type="file"> elements in DOM.
          // DO NOT click 'Tệp' / 'Upload from computer' because that triggers input.click(),
          // which opens the OS-level native Finder / File Dialog modal that cannot be closed by script!
          await new Promise(r => setTimeout(r, 600));
        }

        // Wait up to 10s for the file input to appear/be active if we had to open it
        await page.waitForSelector('input[type="file"]', { timeout: 10000 });

        fileInputHandle = await page.evaluateHandle(() => {
          // Priority 1: image-specific file input
          const imageInput = document.querySelector('input[type="file"][accept*="image"]') as HTMLInputElement;
          if (imageInput) return imageInput;

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
          
          // Wait for upload processing (scaled based on number of images: min 5s, 1.8s per image)
          const waitTime = isVideo ? 35000 : Math.max(5000, pathsToUpload.length * 1800);
          await new Promise(r => setTimeout(r, waitTime));

          // Automatically close any open menu, modal, dialog, or overlay backdrop
          await page.evaluate(() => {
            const backdrops = Array.from(document.querySelectorAll('.cdk-overlay-backdrop, .mat-overlay-backdrop, .modal-backdrop'));
            backdrops.forEach(b => (b as HTMLElement).click());
            const closeBtn = document.querySelector('button[aria-label*="Đóng" i], button[aria-label*="Close" i], .mat-mdc-dialog-container button[aria-label*="close" i]') as HTMLElement;
            if (closeBtn) closeBtn.click();
          });
          await page.keyboard.press('Escape').catch(() => {});
          await new Promise(r => setTimeout(r, 400));
        }
      } catch (uploadErr: any) {
        console.warn(`⚠️  [VeoAuto-Tab ${index + 1}] File upload failed: ${uploadErr.message}`);
      } finally {
        restoreUserFocus(prevApp);
        // Ensure any lingering menu or backdrop is closed
        await page.keyboard.press('Escape').catch(() => {});
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
    // ── Enable "Add sound" toggle if available ─────────────────────────────
    console.log(`🔊 [VeoAuto-Tab ${index + 1}] Checking for 'Add sound' toggle...`);
    try {
      const soundEnabled = await page.evaluate(() => {
        // Strategy 1: Find toggle/checkbox/switch containing "Add sound" or "Thêm âm thanh" text
        const allLabels = Array.from(document.querySelectorAll('label, [role="switch"], mat-slide-toggle, .toggle, span'));
        const soundLabel = allLabels.find(el => {
          const text = (el.textContent || '').trim().toLowerCase();
          return text === 'add sound' || text === 'thêm âm thanh' || 
                 text.includes('add sound') || text.includes('âm thanh');
        }) as HTMLElement;

        if (soundLabel) {
          const parent = soundLabel.closest('.toggle-container, .setting-row, .option-row, mat-slide-toggle, label, [role="switch"]') || soundLabel.parentElement;
          if (parent) {
            const toggleInput = parent.querySelector('input[type="checkbox"]') as HTMLInputElement;
            if (toggleInput && !toggleInput.checked) {
              toggleInput.click();
              return 'toggled_on';
            }
            const switchEl = parent.querySelector('[role="switch"]') as HTMLElement;
            if (switchEl && switchEl.getAttribute('aria-checked') !== 'true') {
              switchEl.click();
              return 'clicked_switch';
            }
            const matToggle = parent.querySelector('mat-slide-toggle') as HTMLElement;
            if (matToggle && !matToggle.classList.contains('mat-mdc-slide-toggle-checked')) {
              matToggle.click();
              return 'clicked_mat_toggle';
            }
            const isAlreadyOn = parent.classList.contains('active') ||
                                parent.classList.contains('checked') ||
                                parent.getAttribute('aria-checked') === 'true';
            if (!isAlreadyOn) {
              (parent as HTMLElement).click();
              return 'clicked_parent';
            }
            return 'already_on';
          }
          soundLabel.click();
          return 'clicked_label';
        }

        // Strategy 2: Find any mat-slide-toggle or switch near sound-related aria labels
        const switches = Array.from(document.querySelectorAll('mat-slide-toggle, [role="switch"]'));
        for (const sw of switches) {
          const ariaLabel = (sw.getAttribute('aria-label') || '').toLowerCase();
          const nearbyText = (sw.parentElement?.textContent || '').toLowerCase();
          if (nearbyText.includes('sound') || nearbyText.includes('âm thanh') || nearbyText.includes('audio')) {
            const isChecked = sw.getAttribute('aria-checked') === 'true' ||
                              sw.classList.contains('mat-mdc-slide-toggle-checked');
            if (!isChecked) {
              (sw as HTMLElement).click();
              return 'toggled_on';
            }
            return 'already_on';
          }
        }
        return 'not_found';
      });
      console.log(`🔊 [VeoAuto-Tab ${index + 1}] Sound toggle result: ${soundEnabled}`);
      if (soundEnabled === 'toggled_on' || soundEnabled === 'clicked_toggle' || soundEnabled === 'clicked_label') {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (soundErr: any) {
      console.warn(`⚠️  [VeoAuto-Tab ${index + 1}] Sound toggle check error: ${soundErr.message}`);
    }

    await new Promise(r => setTimeout(r, 1000));

    // Submit prompt using DOM click on Generate/Send button
    const submitted = await page.evaluate(() => {
      // 1. Search strictly inside the input area container first
      const inputArea = document.querySelector('input-area-v2, .input-area, .chat-input-container, input-container, fieldset.input-area-container');
      if (inputArea) {
        const areaSendBtn = inputArea.querySelector(
          '.send-button button, .send-button-container button, gem-icon-button.send-button button, button[aria-label="Send message"], button[aria-label="Gửi tin nhắn"], button mat-icon[data-mat-icon-name="arrow_upward"], button mat-icon[fonticon="arrow_upward"]'
        ) as HTMLElement | null;
        if (areaSendBtn) {
          const btn = (areaSendBtn.tagName === 'BUTTON' ? areaSendBtn : areaSendBtn.closest('button')) as HTMLButtonElement | null;
          if (btn && !btn.disabled) {
            btn.click();
            return true;
          }
        }
      }

      // 2. High-priority dedicated Send button selectors (strictly excluding sidebar/history/menus)
      const selectors = [
        '.send-button button',
        '.send-button-container button',
        'gem-icon-button.send-button button',
        'button[aria-label="Send message"]',
        'button[aria-label="Gửi tin nhắn"]',
        'button mat-icon[data-mat-icon-name="arrow_upward"]',
        'button mat-icon[fonticon="arrow_upward"]',
      ];
      for (const sel of selectors) {
        const target = document.querySelector(sel) as HTMLElement | null;
        if (target) {
          const btn = (target.tagName === 'BUTTON' ? target : target.closest('button')) as HTMLButtonElement | null;
          if (
            btn &&
            !btn.disabled &&
            !btn.closest('side-navigation-v2, bard-sidenav-container, bard-sidenav-content, mat-menu-panel, [role="navigation"], [role="menu"], aside, nav, .sidebar-list')
          ) {
            btn.click();
            return true;
          }
        }
      }
      
      // 3. Fallback: Search buttons ONLY within main chat / input area (never sidebar)
      const mainArea = document.querySelector('chat-window, .main-content, main, .content-container') || document;
      const btns = Array.from(mainArea.querySelectorAll('button'));
      const targetBtn = btns.find(b => {
        if (b.closest('side-navigation-v2, bard-sidenav-container, bard-sidenav-content, mat-menu-panel, [role="navigation"], [role="menu"], aside, nav, .sidebar-list, .context-menu')) {
          return false;
        }

        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const text = (b.textContent || '').toLowerCase();
        const html = (b.innerHTML || '').toLowerCase();

        return aria === 'send message' || aria === 'gửi tin nhắn' || aria === 'send' || aria === 'gửi' ||
               text === 'send' || text === 'gửi' ||
               html.includes('data-mat-icon-name="arrow_upward"') || html.includes('fonticon="arrow_upward"');
      });
      if (targetBtn && !targetBtn.disabled) {
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
      if (isVeoTaskAborted(startTime)) {
        throw new Error("Đã hủy tiến trình render video theo yêu cầu");
      }
      await new Promise(r => setTimeout(r, 5000));
      if (isVeoTaskAborted(startTime)) {
        throw new Error("Đã hủy tiến trình render video theo yêu cầu");
      }
      const elapsed = Math.round((Date.now() - pollStart) / 1000);

      // Periodic screenshots for debugging (every 60s)
      if (elapsed % 60 === 0 || elapsed === 10) {
        const ssDir = path.resolve(__dirname, "../data/debug");
        if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
        const ssPath = path.join(ssDir, `veo_tab${index + 1}_${elapsed}s.png`);
        await page.screenshot({ path: ssPath, fullPage: false }).catch(() => {});
        console.log(`📸 [VeoAuto-Tab ${index + 1}] Debug screenshot: ${ssPath}`);
      }

      // Early detection: If Gemini refused video generation due to policy or capability (check from 10s onwards)
      if (elapsed >= 10 && !found) {
        const refusalText = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll("message-content, .model-response, model-response, .response-container"));
          for (const el of els) {
            if (el.closest("user-query, .user-query, rich-textarea, input-area-v2, .input-area, .file-preview")) continue;
            const txt = (el.textContent || "").trim();
            if (
              txt.includes("Tôi không thể tạo video") ||
              txt.includes("không thể tạo video") ||
              txt.includes("I cannot generate video") ||
              txt.includes("I can't generate video") ||
              txt.includes("I can't make that type of video") ||
              txt.includes("I can't make videos") ||
              txt.includes("I cannot make videos") ||
              txt.includes("I cannot make that type of video") ||
              txt.includes("show minors in dangerous") ||
              txt.includes("compromising situations") ||
              txt.includes("Can I help you with something else?") ||
              txt.includes("can't generate that video") ||
              txt.includes("cannot generate that video") ||
              txt.includes("video policy guidelines") ||
              txt.includes("policy guidelines") ||
              txt.includes("Try describing another idea") ||
              txt.includes("không thể tạo nội dung") ||
              txt.includes("against our safety guidelines") ||
              txt.includes("vi phạm chính sách") ||
              txt.includes("third-party content") ||
              txt.includes("interests of third-party")
            ) {
              return txt.slice(0, 300);
            }
          }
          return null;
        }).catch(() => null);

        if (refusalText) {
          console.error(`❌ [VeoAuto-Tab ${index + 1}] Gemini refusal detected at ${elapsed}s: ${refusalText}`);
          return {
            success: false,
            error: `Gemini từ chối tạo video: "${refusalText}"`,
            prompt,
            durationMs: Date.now() - startTime,
          };
        }
      }

      // CRITICAL GATE: Veo diffusion physically takes 30-90 seconds to render a 10s video.
      // Any video element detection under 20s is guaranteed to be a false positive (e.g. LLM text stream, upload thumbnail).
      if (elapsed < 20) {
        console.log(`⏳ [VeoAuto-Tab ${index + 1}] Rendering in progress (${elapsed}s elapsed)...`);
        continue;
      }

      if (capturedVideoUrl) {
        found = true;
        break;
      }

      // Proactive check: look for new video elements created after prompt submission
      if (!found) {
        const proactiveVideoSrc = await page.evaluate((initCount: number) => {
          // Check if there are newly added video elements
          const videos = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[];
          if (videos.length > initCount) {
            for (let i = videos.length - 1; i >= initCount; i--) {
              const v = videos[i];
              const src = v.src || v.currentSrc || v.querySelector("source")?.src;
              if (src && (src.includes(".mp4") || src.includes("videoplayback") || src.includes("google") || src.startsWith("blob:"))) {
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

      // Early detection: If Gemini mistakenly generated an image instead of a video
      if (elapsed >= 35 && !found) {
        const imageMistake = await page.evaluate(() => {
          const videos = Array.from(document.querySelectorAll("video"));
          if (videos.length > 0) return false;
          const respImages = Array.from(document.querySelectorAll('message-content img, .model-response img, .response-container img, [data-test-id*="image-response"] img, img.generated-image')) as HTMLImageElement[];
          return respImages.some(img => {
            const src = img.src || "";
            return (src.includes("googleusercontent.com") || src.includes("aiusercontent.com") || src.includes("blob:")) && (img.naturalWidth > 150 || img.width > 150);
          });
        }).catch(() => false);

        if (imageMistake) {
          console.warn(`⚠️ [VeoAuto-Tab ${index + 1}] Gemini generated an IMAGE instead of a VIDEO!`);
          const ssDir = path.resolve(__dirname, "../data/debug");
          if (!fs.existsSync(ssDir)) fs.mkdirSync(ssDir, { recursive: true });
          await page.screenshot({ path: path.join(ssDir, `veo_tab${index + 1}_image_mistake.png`) }).catch(() => {});
          return {
            success: false,
            error: "Gemini đã tạo nhầm hình ảnh tĩnh (Imagen) thay vì video (Veo). Hãy nhấn Render lại, hệ thống đã nạp chỉ thị ép buộc Video.",
            prompt,
            durationMs: Date.now() - startTime,
          };
        }
      }

      if (!hasRefreshed && elapsed >= 300) {
        hasRefreshed = true;
        console.log(`🔄 [VeoAuto-Tab ${index + 1}] Reloading page to fix freeze...`);
        await page.reload({ waitUntil: "networkidle2", timeout: 30_000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 4000));
      }

      const pageResult = await page.evaluate((initialDownloadCount: number) => {
        const bodyText = document.body?.innerText || "";
        const videos = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[];
        const hasNewVideo = videos.length > 0;
        const isGeneratingMsg = bodyText.includes("when your video is ready") ||
                                bodyText.includes("I'm generating your video") ||
                                bodyText.includes("Đang tạo video");
        const videoReady = hasNewVideo || (!isGeneratingMsg && (
                           bodyText.includes("Your video is ready") ||
                           bodyText.includes("Video của bạn đã sẵn sàng") ||
                           bodyText.includes("video đã sẵn sàng") ||
                           bodyText.includes("video đã được tạo") ||
                           bodyText.includes("video đã xong")));

        const allButtons = Array.from(document.querySelectorAll('button, a, [data-mat-icon-name="download"]'));
        const downloadBtns = allButtons.filter(el => {
          const aria = (el.getAttribute('aria-label') || '').toLowerCase();
          const title = (el.getAttribute('title') || '').toLowerCase();
          const text = (el.textContent || '').toLowerCase();
          // STRICTLY EXCLUDE "Tải lên" (Upload) buttons
          if (aria.includes('tải lên') || aria.includes('upload') || text.includes('tải lên')) return false;
          return (
            aria.includes('tải video') || aria.includes('tải xuống') || aria.includes('tải về') ||
            aria.includes('download video') || aria.includes('download') ||
            title.includes('tải xuống') || title.includes('download') ||
            text.includes('tải video') || text.includes('tải xuống') || text.includes('tải về') ||
            el.hasAttribute('download') || !!el.querySelector('[data-mat-icon-name="download"]')
          );
        });

        const hasDownload = downloadBtns.length > initialDownloadCount;
        const errorText = document.querySelector('.error-container, [class*="error-message"]')?.textContent?.trim().slice(0, 100);
        return { videoReady, hasDownload, errorText };
      }, initialDownloadCount).catch(() => ({ videoReady: false, hasDownload: false, errorText: null }));

      if (pageResult.videoReady || pageResult.hasDownload) {
        // Try to get video source directly from DOM
        const videoSrc = await page.evaluate((initialVideoCount: number) => {
          const videos = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[];
          for (let i = videos.length - 1; i >= 0; i--) {
            const src = videos[i].src || videos[i].currentSrc;
            if (src && (src.includes("google") || src.includes("blob:") || src.includes(".mp4") || src.includes("videoplayback"))) {
              return src;
            }
          }
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
          console.log(`⬇️  [VeoAuto-Tab ${index + 1}] Video ready at ${elapsed}s. Clicking download as fallback...`);
          const clicked = await page.evaluate((initialDownloadCount: number) => {
            const allButtons = Array.from(document.querySelectorAll("button, a, [data-mat-icon-name='download']"));
            const buttons = allButtons.filter(el => {
              const aria = (el.getAttribute("aria-label") || "").toLowerCase();
              const title = (el.getAttribute("title") || "").toLowerCase();
              const text = (el.textContent || "").toLowerCase();
              // STRICTLY EXCLUDE "Tải lên" / "Upload" buttons
              if (aria.includes("tải lên") || aria.includes("upload") || text.includes("tải lên")) return false;
              return (
                aria.includes("tải video") || aria.includes("tải xuống") || aria.includes("tải về") ||
                aria.includes("download video") || aria.includes("download") ||
                title.includes("tải xuống") || title.includes("download") ||
                text.includes("tải video") || text.includes("tải xuống") || text.includes("tải về") ||
                el.hasAttribute("download") || !!el.querySelector('[data-mat-icon-name="download"]')
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

    // Strict validation: Video file MUST exist and be larger than 300KB (valid MP4)
    if (!downloadedFile || !fs.existsSync(targetPath) || fs.statSync(targetPath).size < 300_000) {
      const size = fs.existsSync(targetPath) ? fs.statSync(targetPath).size : 0;
      throw new Error(`File video Part ${index + 1} không hợp lệ hoặc chưa tải xong (${size} bytes). Gemini chưa hoàn tất render video!`);
    }

    // Cut meaningless idle tail: keep only the real content of this step
    try {
      const { autoTrimSceneTail } = await import("./autoTrimScene.js");
      await autoTrimSceneTail(targetPath, prompt);
    } catch (trimErr: any) {
      console.warn(`⚠️  [VeoAuto-Tab ${index + 1}] Auto-trim skipped: ${trimErr?.message || trimErr}`);
    }

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
  dialogue?: string,
  referenceImages?: string[],
  options?: {
    includePrevFrame?: boolean | string;
    refImagesMode?: string;
    prevFrameParts?: number[];
    visualStyle?: string;
  }
): Promise<VeoResult> {
  const startTime = Date.now();
  let browser: any = null;
  let ownsBrowser = false;

  const outputDir = customOutputDir || DOWNLOADS_DIR;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const rawPrevOpt = options?.includePrevFrame;
  const includePrev = rawPrevOpt !== false && rawPrevOpt !== 'no' && rawPrevOpt !== 'false';
  const refMode = options?.refImagesMode || 'all';

  // Helper to extract end frame from a specific 1-based Part video in outputDir
  const resolveEndFrameFromPartVideo = async (targetPartNum: number): Promise<string | null> => {
    try {
      const files = fs.readdirSync(outputDir);
      let activePartFilename: string | null = null;
      const activeVersionsFile = path.join(outputDir, "active_versions.json");
      if (fs.existsSync(activeVersionsFile)) {
        try {
          const actMap = JSON.parse(fs.readFileSync(activeVersionsFile, "utf-8"));
          if (actMap[`part${targetPartNum}`]) {
            activePartFilename = actMap[`part${targetPartNum}`];
          }
        } catch {}
      }

      let chosenVideo: string | null = null;
      if (activePartFilename && fs.existsSync(path.join(outputDir, activePartFilename))) {
        chosenVideo = activePartFilename;
      } else {
        const matchingVideos = files
          .filter(
            (f) =>
              f.endsWith(".mp4") &&
              f.includes(`_part${targetPartNum}_`) &&
              !f.includes("_merged") &&
              !f.includes("_voiced") &&
              !f.includes("_longtieng")
          )
          .map((f) => ({ name: f, mtime: fs.statSync(path.join(outputDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        if (matchingVideos.length > 0) chosenVideo = matchingVideos[0].name;
      }

      if (chosenVideo) {
        const videoFullPath = path.join(outputDir, chosenVideo);
        console.log(`🔗 [VeoAuto-Single] Trích xuất hình từ Video Part ${targetPartNum}: ${chosenVideo}`);
        const kfs = await extractThreeKeyframes(videoFullPath, outputDir);
        if (kfs.length > 0) {
          return kfs[kfs.length - 1];
        }
      }
    } catch {}
    return null;
  };

  // 1. Resolve scene image of the current step (nếu không phải mode 'none')
  let currentSceneImage: string | null = null;
  if (refMode !== 'none') {
    const directScenePng = path.join(outputDir, "scenes", `scene_${sceneIndex + 1}.png`);
    const directSceneJpg = path.join(outputDir, "scenes", `scene_${sceneIndex + 1}.jpg`);

    if (sceneImagePath && fs.existsSync(sceneImagePath)) {
      currentSceneImage = path.resolve(sceneImagePath);
      console.log(`📸 [VeoAuto-Single] Using specified scene keyframe for Part ${sceneIndex + 1}: ${path.basename(sceneImagePath)}`);
    } else if (fs.existsSync(directScenePng)) {
      currentSceneImage = directScenePng;
      console.log(`📸 [VeoAuto-Single] Using local Part ${sceneIndex + 1} scene image: ${path.basename(directScenePng)}`);
    } else if (fs.existsSync(directSceneJpg)) {
      currentSceneImage = directSceneJpg;
      console.log(`📸 [VeoAuto-Single] Using local Part ${sceneIndex + 1} scene image: ${path.basename(directSceneJpg)}`);
    }
  }

  // 2. Resolve frame(s) from previous video step(s)
  const prevVideoFrames: string[] = [];
  if (includePrev) {
    const targetPartsToExtract: number[] = [];
    if (Array.isArray(options?.prevFrameParts) && options.prevFrameParts.length > 0) {
      for (const p of options.prevFrameParts) {
        if (Number.isFinite(p) && p >= 1 && !targetPartsToExtract.includes(p)) {
          targetPartsToExtract.push(p);
        }
      }
    } else if (typeof rawPrevOpt === "string" && rawPrevOpt.startsWith("part_")) {
      const pNum = parseInt(rawPrevOpt.replace("part_", ""), 10);
      if (Number.isFinite(pNum) && pNum >= 1) targetPartsToExtract.push(pNum);
    } else if (rawPrevOpt === "all_prev") {
      for (let p = 1; p <= sceneIndex; p++) {
        targetPartsToExtract.push(p);
      }
    } else if (sceneIndex > 0) {
      targetPartsToExtract.push(sceneIndex);
    }

    for (const pNum of targetPartsToExtract) {
      const framePath = await resolveEndFrameFromPartVideo(pNum);
      if (framePath && fs.existsSync(framePath) && !prevVideoFrames.includes(framePath)) {
        prevVideoFrames.push(framePath);
      }
    }
  }

  // 3. Resolve reference images theo refMode
  const rawRefSources: string[] = [];
  const extraLocalRefFrames: string[] = [];
  if (refMode === 'all') {
    if (Array.isArray(referenceImages)) rawRefSources.push(...referenceImages);
    if (imageUrl && !rawRefSources.includes(imageUrl)) rawRefSources.push(imageUrl);
  } else if (refMode === 'current_only' && !currentSceneImage) {
    if (Array.isArray(referenceImages) && referenceImages.length > 0) rawRefSources.push(referenceImages[0]);
    else if (imageUrl) rawRefSources.push(imageUrl);
  } else if (refMode === 'prev_videos') {
    for (let p = 1; p <= Math.max(1, sceneIndex); p++) {
      const fPath = await resolveEndFrameFromPartVideo(p);
      if (fPath && fs.existsSync(fPath) && !extraLocalRefFrames.includes(fPath)) {
        extraLocalRefFrames.push(fPath);
      }
    }
  } else if (typeof refMode === 'string' && refMode.startsWith('prev_video_')) {
    const pNum = parseInt(refMode.replace('prev_video_', ''), 10);
    if (Number.isFinite(pNum) && pNum >= 1) {
      const fPath = await resolveEndFrameFromPartVideo(pNum);
      if (fPath && fs.existsSync(fPath) && !extraLocalRefFrames.includes(fPath)) {
        extraLocalRefFrames.push(fPath);
      }
    }
  } else if (refMode === 'prev_scenes') {
    for (let p = 1; p <= Math.max(1, sceneIndex); p++) {
      const sPng = path.join(outputDir, "scenes", `scene_${p}.png`);
      const sJpg = path.join(outputDir, "scenes", `scene_${p}.jpg`);
      if (fs.existsSync(sPng)) extraLocalRefFrames.push(sPng);
      else if (fs.existsSync(sJpg)) extraLocalRefFrames.push(sJpg);
    }
  }

  const { localImagePaths: downloadedRefImages, tempFilesToClean } = await resolveAndDownloadImages(
    rawRefSources,
    outputDir,
    `ref_part${sceneIndex + 1}`
  );

  // 4. Kết hợp upload chuẩn:
  //    - Ảnh #1: Frame 9:16 cuối của Part trước (khóa tỷ lệ 9:16 full-screen không viền + đồng nhất mặt/trang phục)
  //    - Ảnh #2: Bảng Storyboard 2x3 6 nhịp thời gian của Part hiện tại (scene_X.png) để Veo diễn đúng từng nhịp & đạo cụ từ đầu đến cuối cảnh!
  const pathsToUpload: string[] = [];
  let hasSceneKeyframe = false;
  let hasPrevVideoFrame = false;

  for (const pf of prevVideoFrames) {
    if (pf && fs.existsSync(pf) && !pathsToUpload.includes(pf)) {
      pathsToUpload.push(pf);
      hasPrevVideoFrame = true;
      console.log(`🔗 [VeoAuto-Single] Part ${sceneIndex + 1}: Ảnh #${pathsToUpload.length} (Frame 9:16 nối nhân vật từ video trước) = ${path.basename(pf)}.`);
    }
  }

  if (refMode !== 'none' && currentSceneImage && fs.existsSync(currentSceneImage) && !pathsToUpload.includes(currentSceneImage)) {
    pathsToUpload.push(currentSceneImage);
    hasSceneKeyframe = true;
    console.log(`📸 [VeoAuto-Single] Part ${sceneIndex + 1}: Ảnh #${pathsToUpload.length} (Storyboard 2x3 6 nhịp thời gian) = ${path.basename(currentSceneImage)}.`);
  }

  if (refMode !== 'none') {
    for (const extraFrame of extraLocalRefFrames) {
      if (extraFrame && fs.existsSync(extraFrame) && !pathsToUpload.includes(extraFrame)) {
        pathsToUpload.push(extraFrame);
        console.log(`🎬 [VeoAuto-Single] Part ${sceneIndex + 1}: Kèm hình tham chiếu từ phân cảnh trước (${path.basename(extraFrame)}).`);
      }
    }
    if (!currentSceneImage) {
      for (const refImg of downloadedRefImages) {
        if (refImg && fs.existsSync(refImg) && !pathsToUpload.includes(refImg)) {
          pathsToUpload.push(refImg);
        }
      }
    }
  }

  console.log(`📸 [VeoAuto-Single] Part ${sceneIndex + 1} [PrevFrame: ${String(rawPrevOpt ?? includePrev)}, RefMode: ${refMode}] UPLOAD TỔNG CỘNG ${pathsToUpload.length} TẤM: [${pathsToUpload.map(p => path.basename(p)).join(", ")}]`);
  const uploadFilePath = pathsToUpload.length === 0 ? null : (pathsToUpload.length === 1 ? pathsToUpload[0] : pathsToUpload);

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
          "--window-position=10,40",
          "--window-size=680,540",
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

    const finalPrompt = buildVeoScenePrompt(
      prompt,
      dialogue,
      sceneIndex,
      options?.visualStyle || "real",
      { hasSceneKeyframe, hasPrevVideoFrame, totalUploaded: pathsToUpload.length }
    );
    console.log(`🎬 [VeoAuto-Single] Running Veo generation for Part ${sceneIndex + 1}... ${dialogue ? `(Thoại: "${dialogue.slice(0, 50)}...")` : "(Không thoại)"}`);
    const result = await runSingleVeoAutomation(
      browser,
      finalPrompt,
      uploadFilePath,
      sceneIndex,
      productSlug,
      outputDir
    );

    if (!result.success) {
      console.error(`⛔ [VeoAuto-Single] Part ${sceneIndex + 1} gặp lỗi (${result.error}). Dừng ngay không tự upload/render lại lần 2.`);
    }

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
    for (const tempPath of tempFilesToClean) {
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
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
