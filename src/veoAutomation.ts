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
import { execSync, execFileSync } from "child_process";
import os from "os";
import axios from "axios";
import { randomUUID } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOWNLOADS_DIR = path.resolve(__dirname, "../data/downloads");

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
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

    page = await browser.newPage();

    // Enable CDP session to intercept file downloads
    const client = await page.createCDPSession();
    const downloadDir = path.resolve(__dirname, "../data/downloads");
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
    await client.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDir,
    }).catch(() => {});

    // Intercept network responses to capture video URLs
    let capturedVideoUrl: string | null = null;
    page.on("response", async (response: any) => {
      const url = response.url();
      const contentType = response.headers()["content-type"] || "";
      const isVideo = contentType.includes("video/") ||
        url.includes(".mp4") || url.includes("videoplayback") ||
        url.includes("video-downloads") || url.includes("generativelanguage") ||
        url.includes("aiusercontent") || url.includes("usercontent.google") ||
        (url.includes("google") && (contentType.includes("octet-stream") && url.length > 100));

      if (isVideo && !capturedVideoUrl) {
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
          await (fileInputHandle as any).uploadFile(localImagePath);
          console.log("✅ [VeoAuto] Image uploaded to Gemini file input");
          
          // Dispatch events manually so Gemini's Angular upload handler processes the file
          await page.evaluate((input: any) => {
            if (input) {
              input.dispatchEvent(new Event("change", { bubbles: true }));
              input.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }, fileInputHandle);
          
          // Wait 4.5s for upload progress to complete and display thumbnail preview
          await new Promise(r => setTimeout(r, 4500));
        } else {
          console.warn("⚠️  [VeoAuto] File input element not found via handle search");
        }
      } catch (uploadErr: any) {
        console.warn(`⚠️  [VeoAuto] Failed to upload image via Puppeteer: ${uploadErr.message}`);
      }
    }

    // Focus and type prompt
    const inputSelector = 'rich-textarea [contenteditable="true"], textarea, [contenteditable="true"]';
    await page.click(inputSelector).catch(() => {});
    await new Promise(r => setTimeout(r, 500));

    // Clear any existing text first
    await page.keyboard.down("Meta");
    await page.keyboard.press("a");
    await page.keyboard.up("Meta");
    await page.keyboard.press("Backspace");

    const promptToType = prompt;

    await page.type(inputSelector, promptToType, { delay: 15 });
    console.log("✏️  [VeoAuto] Prompt typed successfully");

    // Take screenshot to verify before submitting
    const debugDir = path.resolve(__dirname, "../data/debug");
    if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
    await page.screenshot({ path: path.join(debugDir, "before_submit.png") }).catch(() => {});

    await page.keyboard.press("Enter");
    console.log("📤 [VeoAuto] Prompt submitted");

    console.log("⏳ [VeoAuto] Waiting for Veo to generate video (up to 8 minutes)...");
    const screenshotDir = path.resolve(__dirname, "../data/debug");
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

    const pollStart = Date.now();
    const MAX_WAIT_MS = 10 * 60 * 1000;
    let found = false;
    let hasRefreshed = false;

    while (Date.now() - pollStart < MAX_WAIT_MS) {
      await new Promise(r => setTimeout(r, 5000));
      const elapsed = Math.round((Date.now() - pollStart) / 1000);

      // Network-intercepted MP4 → done immediately
      if (capturedVideoUrl) {
        console.log(`🎯 [VeoAuto] Video URL captured via network (${elapsed}s)`);
        found = true;
        break;
      }

      // ── After 8 minutes (480s) → reload ONCE ────────────────────────────────
      if (!hasRefreshed && elapsed >= 480) {
        hasRefreshed = true;
        console.log(`🔄 [VeoAuto] 8 minutes passed — reloading page to fix Gemini freeze...`);
        await page.reload({ waitUntil: "networkidle2", timeout: 30_000 }).catch(() => {});
        console.log(`✅ [VeoAuto] Page reloaded — checking conversation for completed video...`);
        await new Promise(r => setTimeout(r, 4000));
      }

      // Check DOM: video ready text + download button
      const pageResult = await page.evaluate(() => {
        // Detect "Your video is ready!" message
        const bodyText = document.body?.innerText || "";
        const videoReady = bodyText.includes("Your video is ready") ||
                           bodyText.includes("video is ready");

        // Find download button (exact from Gemini video player)
        const downloadBtn = document.querySelector(
          'button[aria-label*="Download" i], button[aria-label*="download" i], ' +
          'a[download], [data-mat-icon-name="download"]'
        );

        const errorText = document.querySelector(
          '.error-container, [class*="error-message"]'
        )?.textContent?.trim().slice(0, 100);

        return { videoReady, hasDownload: !!downloadBtn, errorText };
      }).catch(() => ({ videoReady: false, hasDownload: false, errorText: null }));

      if (pageResult.videoReady || pageResult.hasDownload) {
        console.log(`⬇️  [VeoAuto] Video ready at ${elapsed}s — clicking Download button...`);

        // Click download button
        const clicked = await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll("button, a")).find(el => {
            const aria = el.getAttribute("aria-label")?.toLowerCase() || "";
            const title = el.getAttribute("title")?.toLowerCase() || "";
            return aria.includes("download") || title.includes("download");
          });
          if (btn) { (btn as HTMLElement).click(); return true; }
          return false;
        });

        if (clicked) {
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
      }

      if (capturedVideoUrl) { found = true; break; }

      if (pageResult.errorText) {
        console.warn(`⚠️  [VeoAuto] Gemini error (${elapsed}s): ${pageResult.errorText}`);
      }

      const refreshNote = !hasRefreshed ? ` | auto-reload in ${Math.max(0, 480 - elapsed)}s` : "";
      console.log(`⏳ [VeoAuto] Still waiting... ${elapsed}s elapsed${refreshNote}`);

      // Screenshot at 5s, 30s, 60s, after reload
      if ([5, 30, 60, 485].includes(elapsed) || elapsed % 60 === 0) {
        const ssPath = path.join(screenshotDir, `gemini_${elapsed}s.png`);
        await page.screenshot({ path: ssPath, fullPage: false }).catch(() => {});
        console.log(`📸 [VeoAuto] Screenshot: ${ssPath}`);
      }
    }

    if (!found && !capturedVideoUrl) {
      const ssPath = path.join(screenshotDir, `gemini_timeout.png`);
      await page.screenshot({ path: ssPath }).catch(() => {});
      console.log(`📸 [VeoAuto] Timeout screenshot: ${ssPath}`);
      throw new Error(`Timeout after 15 minutes. Check debug screenshot: ${ssPath}`);
    }

    if (!capturedVideoUrl) {
      capturedVideoUrl = await page.evaluate(() => {
        const video = document.querySelector("video") as HTMLVideoElement | null;
        if (video) return video.src || video.currentSrc || null;
        const source = document.querySelector("video source") as HTMLSourceElement | null;
        if (source) return source.src || null;
        return null;
      });
    }

    if (!capturedVideoUrl) {
      throw new Error("Could not capture video URL from Gemini Web");
    }

    console.log(`✅ [VeoAuto] Video URL captured: ${capturedVideoUrl.slice(0, 80)}...`);

    const filename = `veo_${randomUUID().split("-")[0]}_${Date.now()}.mp4`;
    const localPath = path.join(DOWNLOADS_DIR, filename);

    // ── Download via Chrome (uses session cookies) — NOT axios (no cookies) ──
    console.log(`⬇️  [VeoAuto] Downloading via Chrome session (has cookies)...`);
    await client.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: DOWNLOADS_DIR,
    });

    // Navigate to the video URL in a new tab — Chrome will download it
    const dlPage = await browser.newPage();
    await dlPage.goto(capturedVideoUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});

    // Wait for the .mp4 file to appear (up to 30s)
    let downloadedFile: string | null = null;
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

    const durationMs = Date.now() - startTime;
    console.log(`✅ [VeoAuto] Video downloaded to: ${downloadedFile} (${Math.round(durationMs / 1000)}s)`);

    // Extract thumbnail frame (JPG) from the downloaded video using active Puppeteer session
    let thumbnailPath: string | undefined = undefined;
    if (downloadedFile) {
      const thumbFilename = path.basename(downloadedFile).replace(/\.[^/.]+$/, "") + "_thumb.jpg";
      const localThumbPath = path.join(DOWNLOADS_DIR, thumbFilename);
      const thumbSuccess = await extractVideoFrame(browser, downloadedFile, localThumbPath);
      if (thumbSuccess) {
        thumbnailPath = localThumbPath;
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
    page = await browser.newPage();
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
    
    // Seek to 1s to capture a meaningful frame (preventing black screen at 0.0s)
    await page.evaluate(async () => {
      const vid = document.getElementById("vid") as HTMLVideoElement;
      return new Promise<void>((resolve, reject) => {
        vid.onloadedmetadata = () => {
          vid.currentTime = 1.0; // 1 second in
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

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
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
async function ensureChromeRunning(): Promise<void> {
  const debugUrl = `http://127.0.0.1:${CHROME_DEBUG_PORT}/json/version`;

  // Check if Chrome is already running with debug port
  try {
    const res = await fetch(debugUrl);
    if (res.ok) {
      console.log(`✅ [VeoAuto] Chrome already running on port ${CHROME_DEBUG_PORT}`);
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

  console.log(`🚀 [VeoAuto] Auto-launching ChromeAuto with debug port ${CHROME_DEBUG_PORT}...`);

  // Remove lock files before launch
  const lockFiles = ["Default/SingletonLock", "Default/SingletonCookie", "SingletonLock"];
  for (const lock of lockFiles) {
    const p = path.join(chromeAutoDir, lock);
    if (fs.existsSync(p)) fs.rmSync(p, { force: true });
  }

  // Launch Chrome in background (detached)
  const { spawn } = await import("child_process");
  const chromeProcess = spawn(
    chromePath || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    [
      `--remote-debugging-port=${CHROME_DEBUG_PORT}`,
      `--user-data-dir=${chromeAutoDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-mode",
    ],
    { detached: true, stdio: "ignore" }
  );
  chromeProcess.unref();

  // Wait for Chrome to be ready (up to 8 seconds)
  console.log("⏳ [VeoAuto] Waiting for Chrome to start...");
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(debugUrl);
      if (res.ok) {
        console.log(`✅ [VeoAuto] ChromeAuto launched and ready! (${(i + 1) * 0.5}s)`);
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

export async function generateVeoVideoParallel(
  prompts: string[],
  imageUrl?: string,
  productSlug: string = "video"
): Promise<{ success: boolean; localPaths: string[]; errors: string[]; durationMs: number }> {
  const startTime = Date.now();
  let browser: any = null;
  let ownsBrowser = false;
  let localImagePath: string | null = null;

  // ── Cleanup old temp files in downloads directory (> 10 minutes old) ─────
  try {
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const now = Date.now();
    const tenMinutesAgo = now - 10 * 60 * 1000;
    for (const file of files) {
      if (file.startsWith("gemini_upload_") || file.startsWith("veo_") || file.startsWith("part_")) {
        const filePath = path.join(DOWNLOADS_DIR, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs < tenMinutesAgo) {
            fs.rmSync(filePath, { recursive: true, force: true });
            console.log(`🗑️  [VeoAuto] Cleaned up old temp file/folder: ${file}`);
          }
        } catch {}
      }
    }
  } catch (err: any) {
    console.warn(`⚠️  [VeoAuto] Failed to run downloads cleanup: ${err.message}`);
  }

  console.log(`🎬 [VeoAuto] Starting PARALLEL video generation for ${prompts.length} prompts...`);

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

    // Run generations in parallel!
    console.log(`🚀 [VeoAuto] Spawning ${prompts.length} pages/tabs in parallel...`);
    const results = await Promise.all(
      prompts.map((prompt, i) =>
        runSingleVeoAutomation(browser, prompt, localImagePath, i, productSlug)
      )
    );

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
  localImagePath: string | null,
  index: number,
  productSlug: string
): Promise<VeoResult> {
  const startTime = Date.now();
  let page: any = null;
  let tabDownloadDir: string | null = null;

  try {
    page = await browser.newPage();
    console.log(`📄 [VeoAuto-Tab ${index + 1}] Opened new tab`);

    const client = await page.createCDPSession();
    const pageRunId = Math.random().toString(36).substring(2, 10);
    tabDownloadDir = path.join(DOWNLOADS_DIR, `part_${index + 1}_${pageRunId}`);
    if (!fs.existsSync(tabDownloadDir)) fs.mkdirSync(tabDownloadDir, { recursive: true });

    await client.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: tabDownloadDir,
    }).catch(() => {});

    // Intercept network responses to capture video URL
    let capturedVideoUrl: string | null = null;
    page.on("response", async (response: any) => {
      const url = response.url();
      const contentType = response.headers()["content-type"] || "";
      const isVideo = contentType.includes("video/") ||
        url.includes(".mp4") || url.includes("videoplayback") ||
        url.includes("video-downloads") || url.includes("generativelanguage") ||
        url.includes("aiusercontent") || url.includes("usercontent.google") ||
        (url.includes("google") && (contentType.includes("octet-stream") && url.length > 100));

      if (isVideo && !capturedVideoUrl) {
        capturedVideoUrl = url;
        console.log(`🎯 [VeoAuto-Tab ${index + 1}] Captured video URL: ${url.slice(0, 100)}`);
      }
    });

    console.log(`🌐 [VeoAuto-Tab ${index + 1}] Navigating to Gemini Web...`);
    await page.goto(GEMINI_VEO_URL, { waitUntil: "networkidle2", timeout: 60_000 });

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

    // Upload image if provided
    if (localImagePath && fs.existsSync(localImagePath)) {
      console.log(`📤 [VeoAuto-Tab ${index + 1}] Uploading image...`);
      try {
        await page.evaluate(() => {
          const btn = document.querySelector('button[aria-label*="Nội dung tải lên"]') as HTMLButtonElement
            || document.querySelector('button[aria-label*="Upload"]') as HTMLButtonElement
            || document.querySelector('button[aria-label*="công cụ"]') as HTMLButtonElement
            || Array.from(document.querySelectorAll('button')).find(b => b.innerHTML.includes('plus') || b.getAttribute('aria-label')?.includes('Nội dung tải lên'));
          if (btn) btn.click();
        });
        await new Promise(r => setTimeout(r, 1000));

        await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('button, [role="menuitem"], .mat-mdc-menu-item, span, div'));
          const uploadItem = items.find(el => {
            const text = el.textContent?.trim() || "";
            return text === "Tải lên từ máy tính" || text === "Upload from computer" || text.includes("máy tính");
          }) as HTMLElement;
          if (uploadItem) uploadItem.click();
        });
        await new Promise(r => setTimeout(r, 1000));

        await page.waitForSelector('input[type="file"]', { timeout: 8000 });
        const fileInputHandle = await page.evaluateHandle(() => {
          const inputs = Array.from(document.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
          if (inputs.length === 0) return null;
          const textarea = document.querySelector('rich-textarea [contenteditable="true"], textarea, [contenteditable="true"]');
          if (textarea) {
            let parent = textarea.parentElement;
            while (parent) {
              const fileInput = parent.querySelector('input[type="file"]') as HTMLInputElement;
              if (fileInput) return fileInput;
              parent = parent.parentElement;
            }
          }
          return inputs[inputs.length - 1];
        });

        if (fileInputHandle) {
          await page.evaluate((input: any) => { if (input) input.focus(); }, fileInputHandle);
          await (fileInputHandle as any).uploadFile(localImagePath);
          await page.evaluate((input: any) => {
            if (input) {
              input.dispatchEvent(new Event("change", { bubbles: true }));
              input.dispatchEvent(new Event("input", { bubbles: true }));
            }
          }, fileInputHandle);
          await new Promise(r => setTimeout(r, 4500));
        }
      } catch (uploadErr: any) {
        console.warn(`⚠️  [VeoAuto-Tab ${index + 1}] Image upload failed: ${uploadErr.message}`);
      }
    }

    // Type prompt
    await page.click(inputSelector).catch(() => {});
    await new Promise(r => setTimeout(r, 500));

    await page.keyboard.down("Meta");
    await page.keyboard.press("a");
    await page.keyboard.up("Meta");
    await page.keyboard.press("Backspace");

    await page.type(inputSelector, prompt, { delay: 15 });
    console.log(`✏️  [VeoAuto-Tab ${index + 1}] Prompt typed`);

    await page.keyboard.press("Enter");
    console.log(`📤 [VeoAuto-Tab ${index + 1}] Prompt submitted`);

    // Poll for video generation
    const pollStart = Date.now();
    const MAX_WAIT_MS = 10 * 60 * 1000;
    let found = false;
    let hasRefreshed = false;

    while (Date.now() - pollStart < MAX_WAIT_MS) {
      await new Promise(r => setTimeout(r, 5000));
      const elapsed = Math.round((Date.now() - pollStart) / 1000);

      if (capturedVideoUrl) {
        found = true;
        break;
      }

      if (!hasRefreshed && elapsed >= 480) {
        hasRefreshed = true;
        console.log(`🔄 [VeoAuto-Tab ${index + 1}] Reloading page to fix freeze...`);
        await page.reload({ waitUntil: "networkidle2", timeout: 30_000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 4000));
      }

      const pageResult = await page.evaluate(() => {
        const bodyText = document.body?.innerText || "";
        const videoReady = bodyText.includes("Your video is ready") || bodyText.includes("video is ready");
        const downloadBtn = document.querySelector('button[aria-label*="Download" i], button[aria-label*="download" i], a[download]');
        const errorText = document.querySelector('.error-container, [class*="error-message"]')?.textContent?.trim().slice(0, 100);
        return { videoReady, hasDownload: !!downloadBtn, errorText };
      }).catch(() => ({ videoReady: false, hasDownload: false, errorText: null }));

      if (pageResult.videoReady || pageResult.hasDownload) {
        console.log(`⬇️  [VeoAuto-Tab ${index + 1}] Video ready. Clicking download...`);
        const clicked = await page.evaluate(() => {
          const btn = Array.from(document.querySelectorAll("button, a")).find(el => {
            const aria = el.getAttribute("aria-label")?.toLowerCase() || "";
            const title = el.getAttribute("title")?.toLowerCase() || "";
            return aria.includes("download") || title.includes("download");
          });
          if (btn) { (btn as HTMLElement).click(); return true; }
          return false;
        });

        if (clicked) {
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
        const video = document.querySelector("video") as HTMLVideoElement | null;
        if (video) return video.src || video.currentSrc || null;
        return null;
      });
    }

    if (!capturedVideoUrl) {
      throw new Error(`Could not find video URL on Tab ${index + 1}`);
    }

    console.log(`` + `✅ [VeoAuto-Tab ${index + 1}] Video URL captured: ${capturedVideoUrl.slice(0, 60)}...`);

    // Download file
    const targetFilename = `${productSlug}_part${index + 1}_${pageRunId}.mp4`;
    const targetPath = path.join(DOWNLOADS_DIR, targetFilename);

    let downloadedFile: string | null = null;

    // Trigger tab-specific CDP download
    const dlPage = await browser.newPage();
    const dlClient = await dlPage.createCDPSession();
    await dlClient.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: tabDownloadDir!,
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
    if (page) await page.close().catch(() => {});
  }
}

