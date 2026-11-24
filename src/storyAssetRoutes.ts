/**
 * Story-style assets for the Shorts Studio (shorts-kit calls these over HTTP):
 *   POST /api/story-assets/image  {prompt, refs?: string[], out: string, label?: string}
 *        → one large illustration drawn by Gemini Web (prompt sent verbatim, refs uploaded for character consistency)
 *   POST /api/story-assets/clip   {prompt, image: string, out: string}
 *        → short silent clip animated from `image` by Veo (Gemini Web)
 * Both reuse the logged-in Chrome on CHROME_DEBUG_PORT and run one at a time (one Gemini session).
 * `out` must sit under shorts-kit/public/.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { Express, Request, Response } from "express";
import { generateSingleSceneImage } from "./sceneImageGenerator.js";
import { ensureChromeRunning, generateVeoVideo } from "./veoAutomation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "shorts-kit", "public");
const TMP_DIR = path.join(ROOT, "data", "downloads", "story");
const CHROME_DEBUG_PORT = process.env.CHROME_DEBUG_PORT || "9222";

let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
};

const safeOut = (p: unknown): string | null => {
  if (typeof p !== "string" || !p) return null;
  const abs = path.resolve(p);
  return abs.startsWith(PUBLIC_DIR + path.sep) ? abs : null;
};

const drawImage = async (prompt: string, refs: string[], out: string, label: string) => {
  const puppeteer = (await import("puppeteer")).default;
  await ensureChromeRunning();
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CHROME_DEBUG_PORT}`, defaultViewport: null });
  const work = path.join(TMP_DIR, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(work, { recursive: true });
  try {
    const res = await generateSingleSceneImage(browser, prompt, refs, 0, "story", work, undefined, label, undefined, "raw");
    if (!res.success || !res.imagePath || !fs.existsSync(res.imagePath)) throw new Error(res.error || "Gemini returned no image");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(res.imagePath, out);
    return { ok: true, out, ms: res.durationMs };
  } finally {
    try { browser.disconnect(); } catch {}
    fs.rmSync(work, { recursive: true, force: true });
  }
};

export function registerStoryAssetRoutes(app: Express) {
  app.post("/api/story-assets/image", async (req: Request, res: Response) => {
    const out = safeOut(req.body?.out);
    const prompt = String(req.body?.prompt || "").trim();
    if (!out || !prompt) return res.status(400).json({ ok: false, error: "prompt and out (under shorts-kit/public) required" });
    const refs: string[] = (Array.isArray(req.body?.refs) ? req.body.refs : []).filter(
      (r: unknown) => typeof r === "string" && fs.existsSync(r),
    );
    try {
      const r = await serial(() => drawImage(prompt, refs, out, String(req.body?.label || "Character reference sheet(s)")));
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  app.post("/api/story-assets/clip", async (req: Request, res: Response) => {
    const out = safeOut(req.body?.out);
    const image = String(req.body?.image || "");
    const prompt = String(req.body?.prompt || "").trim();
    if (!out || !prompt || !fs.existsSync(image)) return res.status(400).json({ ok: false, error: "prompt, image and out required" });
    try {
      const r = await serial(async () => {
        const v = await generateVeoVideo(prompt, image, { rawPrompt: true });
        const src = v.localPath && fs.existsSync(v.localPath) ? v.localPath : null;
        if (!v.success || !src) throw new Error(v.error || "Veo returned no video");
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.copyFileSync(src, out);
        return { ok: true, out, ms: v.durationMs };
      });
      res.json(r);
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
}
