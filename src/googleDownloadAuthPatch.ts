import axios from "axios";
import puppeteer from "puppeteer";

/**
 * Veo/Gemini video download URLs under *.google.com are authenticated by the
 * Chrome session. veoAutomation has an axios fallback when CDP download does
 * not create a file, but a plain axios request has no Google cookies and can
 * silently download the Google sign-in HTML as `*.mp4`.
 *
 * This bootstrap patch keeps the existing automation untouched while making
 * only Google user-content download requests reuse the logged-in Chrome
 * cookies. It also rejects HTML/login responses before veoAutomation writes
 * them as a video file.
 */

const originalGet = axios.get.bind(axios);
const COOKIE_CACHE_MS = 20_000;
const MAX_AUTH_DOWNLOAD_ATTEMPTS = 2;

let cachedCookieHeader = "";
let cookieCacheUntil = 0;

function isGoogleProtectedDownload(rawUrl: unknown): rawUrl is string {
  if (typeof rawUrl !== "string") return false;
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const isGoogleUserContent =
      host === "contribution.usercontent.google.com" ||
      host.endsWith(".usercontent.google.com") ||
      host.endsWith(".googleusercontent.com");

    return isGoogleUserContent && (
      url.pathname.includes("download") ||
      url.pathname.includes("videoplayback") ||
      url.searchParams.has("filename")
    );
  } catch {
    return false;
  }
}

function cookieMatchesHost(cookieDomain: string, hostname: string): boolean {
  const domain = cookieDomain.replace(/^\./, "").toLowerCase();
  const host = hostname.toLowerCase();
  return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
}

async function readGoogleCookiesFromChrome(downloadUrl: string, forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedCookieHeader && Date.now() < cookieCacheUntil) {
    return cachedCookieHeader;
  }

  const debugPort = process.env.CHROME_DEBUG_PORT || "9222";
  let browser: Awaited<ReturnType<typeof puppeteer.connect>> | undefined;

  try {
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${debugPort}`,
      defaultViewport: null,
    });

    const pages = await browser.pages();
    const page = pages.find((item) => item.url().includes("gemini.google.com")) || pages[0];
    if (!page) {
      console.warn("⚠️ [GoogleDownloadAuth] Chrome has no page to read cookies from.");
      return "";
    }

    const session = await page.createCDPSession();
    try {
      const result = await session.send("Network.getAllCookies") as { cookies?: Array<{ name: string; value: string; domain: string }> };
      const hostname = new URL(downloadUrl).hostname;
      const matchingCookies = (result.cookies || []).filter((cookie) => cookieMatchesHost(cookie.domain || "", hostname));
      const cookieHeader = matchingCookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");

      if (cookieHeader) {
        cachedCookieHeader = cookieHeader;
        cookieCacheUntil = Date.now() + COOKIE_CACHE_MS;
        console.log(`🔐 [GoogleDownloadAuth] Reusing ${matchingCookies.length} Chrome cookies for ${hostname}.`);
      } else {
        cachedCookieHeader = "";
        cookieCacheUntil = 0;
        console.warn(`⚠️ [GoogleDownloadAuth] No matching Chrome cookies found for ${hostname}.`);
      }

      return cookieHeader;
    } finally {
      await session.detach().catch(() => undefined);
    }
  } catch (error: any) {
    console.warn(`⚠️ [GoogleDownloadAuth] Cannot read Chrome cookies: ${error?.message || error}`);
    return "";
  } finally {
    browser?.disconnect();
  }
}

function describeBadResponse(response: any): string | null {
  const finalUrl = String(response?.request?.res?.responseUrl || response?.request?._redirectable?._currentUrl || "");
  const contentType = String(response?.headers?.["content-type"] || "").toLowerCase();

  if (/accounts\.google\.com|\/signin\//i.test(finalUrl)) {
    return `Google redirected the video download to login (${finalUrl || "accounts.google.com"})`;
  }
  if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
    return `Google returned HTML instead of video (${contentType || "text/html"})`;
  }
  return null;
}

(axios as any).get = async function authenticatedGoogleGet(url: unknown, config: any = {}) {
  if (!isGoogleProtectedDownload(url)) {
    return originalGet(url as any, config);
  }

  let lastError: any;

  for (let attempt = 1; attempt <= MAX_AUTH_DOWNLOAD_ATTEMPTS; attempt++) {
    try {
      const cookieHeader = await readGoogleCookiesFromChrome(url, attempt > 1);
      const headers = {
        ...(config?.headers || {}),
        Accept: "video/mp4,video/*;q=0.9,application/octet-stream;q=0.8,*/*;q=0.5",
        Referer: "https://gemini.google.com/",
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      };

      console.log(`⬇️ [GoogleDownloadAuth] Authenticated download attempt ${attempt}/${MAX_AUTH_DOWNLOAD_ATTEMPTS}...`);
      const response = await originalGet(url, {
        ...config,
        headers,
        maxRedirects: config?.maxRedirects ?? 6,
      });

      const badResponse = describeBadResponse(response);
      if (!badResponse) {
        return response;
      }

      response?.data?.destroy?.();
      cachedCookieHeader = "";
      cookieCacheUntil = 0;
      throw new Error(badResponse);
    } catch (error: any) {
      lastError = error;
      cachedCookieHeader = "";
      cookieCacheUntil = 0;
      console.warn(`⚠️ [GoogleDownloadAuth] Attempt ${attempt} failed: ${error?.message || error}`);
      if (attempt < MAX_AUTH_DOWNLOAD_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }
  }

  throw new Error(
    `Authenticated Google video download failed after ${MAX_AUTH_DOWNLOAD_ATTEMPTS} attempts: ${lastError?.message || lastError || "unknown error"}`,
  );
};

console.log("✅ [GoogleDownloadAuth] Authenticated Google video download guard enabled.");
