/**
 * Shorts Studio (9:16) & Video Dài (16:9) — REST bridge
 * ─────────────────────────────────────────────────────────
 * Main server (Node) ⇄ shorts-kit preview server (Bun, port 7788).
 * The heavy pipeline (AI script → TTS → Remotion render) lives in
 * shorts-kit/scripts/lib/ai_studio.ts and needs Bun, so job actions are
 * proxied to `bun run preview`, which is auto-started when unreachable.
 * Listing / files / S3 + DB sync are done here directly from disk.
 *
 * Studio videos are stored in metadata.json with `source: "shorts-studio"`
 * and are excluded from the Dashboard list (see isStudioVideo).
 */
import path from "path";
import { existsSync, readFileSync, readdirSync, statSync, createReadStream, mkdirSync, writeFileSync } from "fs";
import { spawn } from "child_process";
import axios from "axios";
import { Upload } from "@aws-sdk/lib-storage";
import type { S3Client } from "@aws-sdk/client-s3";

export interface ShortsStudioDeps {
  rootDir: string; // project root (contains shorts-kit/)
  loadMetadata: () => Promise<any[]>;
  saveMetadata: (list: any[]) => Promise<void>;
  s3Client: S3Client;
  s3Bucket: string;
  s3Prefix: string;
}

const SCENE_ORDER = ["hook", "problem", "layer1", "layer2", "hardest", "payoff", "share"];
const SKIP_DIRS = new Set(["_template", "gallery"]);
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** True for any video created by Shorts Studio / Video Dài studio. */
export function isStudioVideo(v: any): boolean {
  if (!v) return false;
  if (v.source === "shorts-studio") return true;
  const id = String(v.id || "");
  return id.startsWith("shorts_") || id.startsWith("long_");
}

export function registerShortsStudioRoutes(app: any, deps: ShortsStudioDeps) {
  const KIT = path.resolve(deps.rootDir, "shorts-kit");
  const PREVIEW_PORT = Number(process.env.SHORTS_PREVIEW_PORT || 7788);
  const PREVIEW = `http://127.0.0.1:${PREVIEW_PORT}`;
  const region = process.env.AWS_REGION || "ap-southeast-1";

  // ── Preview (Bun) server management ─────────────────────────────────────
  let startingPreview: Promise<void> | null = null;
  const previewAlive = async () => {
    try {
      await axios.get(`${PREVIEW}/api/studio/jobs`, { timeout: 2500 });
      return true;
    } catch {
      return false;
    }
  };
  const ensurePreview = async () => {
    if (await previewAlive()) return;
    if (!startingPreview) {
      startingPreview = (async () => {
        const bunBin = [process.env.BUN_PATH, path.join(process.env.HOME || "", ".bun/bin/bun"), "/opt/homebrew/bin/bun", "/usr/local/bin/bun"]
          .filter(Boolean)
          .find((p) => existsSync(p as string)) || "bun";
        console.log(`🚀 [ShortsStudio] Starting shorts-kit preview server on :${PREVIEW_PORT}...`);
        // KHÔNG dùng `bun run preview`: script đó chạy `bun --watch` (sửa code là server restart → giết job đang render)
        // và `kill -9` mọi thứ trên cổng 7788. Chạy thẳng, không watch → job sống sót khi sửa code.
        const child = spawn(bunBin as string, ["scripts/preview.ts", "--port", String(PREVIEW_PORT)], {
          cwd: KIT,
          detached: true,
          stdio: "ignore",
          env: { ...process.env, PREVIEW_PORT: String(PREVIEW_PORT) },
        });
        child.unref();
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 1000));
          if (await previewAlive()) return;
        }
        throw new Error(`Không khởi động được shorts-kit preview server (cổng ${PREVIEW_PORT})`);
      })().finally(() => {
        startingPreview = null;
      });
    }
    await startingPreview;
  };
  const preview = async (method: "get" | "post" | "delete", p: string, body?: any) => {
    await ensurePreview();
    const res = await axios.request({
      method,
      url: `${PREVIEW}${p}`,
      data: body,
      headers: { "x-sk-preview": "1", "Content-Type": "application/json" },
      timeout: 600_000, // nghe thử giọng VieNeu lần đầu nạp model có thể >2 phút
      validateStatus: () => true,
    });
    if (res.status >= 400) throw new Error(res.data?.error || `preview ${p} → HTTP ${res.status}`);
    return res.data;
  };

  // ── Disk helpers ────────────────────────────────────────────────────────
  const readText = (p: string) => {
    try {
      return existsSync(p) ? readFileSync(p, "utf8").trim() : "";
    } catch {
      return "";
    }
  };
  const readNarration = (id: string): any | null => {
    try {
      return JSON.parse(readFileSync(path.join(KIT, "src", "videos", id, "narration.json"), "utf8"));
    } catch {
      return null;
    }
  };
  const mtime = (p: string) => {
    try {
      return statSync(p).mtimeMs;
    } catch {
      return 0;
    }
  };
  const rel = (abs: string) => path.relative(KIT, abs).split(path.sep).join("/");

  // Original create params, saved at click time so a failed job can be restarted.
  const REQ_DIR = path.join(KIT, ".cache", "studio-requests");
  const saveRequest = (id: string, data: any) => {
    try {
      mkdirSync(REQ_DIR, { recursive: true });
      writeFileSync(path.join(REQ_DIR, `${id}.json`), JSON.stringify(data, null, 2));
    } catch {
      /* best effort */
    }
  };
  const loadRequest = (id: string): any | null => {
    try {
      return JSON.parse(readFileSync(path.join(REQ_DIR, `${id}.json`), "utf8"));
    } catch {
      return null;
    }
  };

  const filesOf = (id: string, aspect: string) => {
    const outDir = path.join(KIT, aspect === "16:9" ? "out-long" : "out", id);
    const pick = (...names: string[]) => {
      for (const n of names) {
        const p = path.join(outDir, n);
        if (existsSync(p)) return p;
      }
      return null;
    };
    const upload = pick(`${id}-upload.mp4`);
    const draft = pick(`${id}-loud.mp4`, `${id}.mp4`);
    const cover = pick(`${id}-cover.jpg`, `${id}-cover.png`);
    const voiceP = path.join(KIT, "public", "audio", id, "voice.mp3");
    return {
      outDir,
      abs: { upload, draft, cover, voice: existsSync(voiceP) ? voiceP : null },
      rel: {
        uploadMp4: upload ? rel(upload) : null,
        draftMp4: draft ? rel(draft) : null,
        coverJpg: cover ? rel(cover) : null,
        voiceWav: existsSync(voiceP) ? rel(voiceP) : null,
      },
    };
  };

  /** narration.json → saved create request → out-long/<id> exists. A job that died right after
   *  `bun run new` still has the template narration (no aspectRatio) and must not fall into 9:16. */
  const aspectOf = (id: string, nar: any): "9:16" | "16:9" => {
    const r = nar?.aspectRatio || loadRequest(id)?.aspectRatio;
    if (r === "16:9" || r === "9:16") return r;
    return existsSync(path.join(KIT, "out-long", id)) ? "16:9" : "9:16";
  };
  const dbIdFor = (id: string, aspect: string) => `${aspect === "16:9" ? "long" : "shorts"}_${id}`;
  const findDb = (list: any[], id: string, aspect: string) =>
    list.find((v) => v.id === dbIdFor(id, aspect)) ||
    list.find((v) => v.shorts_id === id) ||
    list.find((v) => v.id === `shorts_${id}` || v.id === `long_${id}`) ||
    null;

  const parseCaption = (caption: string) => {
    const lines = caption.split(/\r?\n/);
    const title = (lines.find((l) => l.trim()) || "").trim();
    const tags = Array.from(new Set(caption.match(/#[\p{L}\p{N}_]+/gu) || []));
    return { title, tags };
  };

  const listStudioIds = (): string[] => {
    const dir = path.join(KIT, "src", "videos");
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter((n) => !SKIP_DIRS.has(n) && ID_RE.test(n) && existsSync(path.join(dir, n, "narration.json")));
  };

  /** Video type for the list filter: brief "**Style:**" line first, then the files the style leaves behind. */
  const styleOf = (id: string): string => {
    const m = readText(path.join(KIT, "briefs", `${id}.md`)).match(/\*\*Style:\*\*\s*([a-z-]+)/i);
    if (m) return m[1].toLowerCase();
    const vdir = path.join(KIT, "src", "videos", id);
    if (existsSync(path.join(vdir, "story.json"))) return "story";
    if (existsSync(path.join(vdir, "explainer.json"))) return "stickman-explainer";
    if (readText(path.join(vdir, "World.tsx")).includes("StickmanStage")) return "stickman";
    return "other";
  };

  const buildEntry = (id: string, dbList: any[], runningIds: Set<string>) => {
    const nar = readNarration(id) || {};
    const aspect = aspectOf(id, nar);
    const f = filesOf(id, aspect);
    const caption = readText(path.join(f.outDir, "caption.txt"));
    const pinned = readText(path.join(f.outDir, "pinned-comment.txt"));
    const { title, tags } = parseCaption(caption);
    const dbVideo = findDb(dbList, id, aspect);
    const steps: [string, boolean][] = [
      ["tts", Boolean(f.abs.voice)],
      ["render", Boolean(f.abs.draft)],
      ["cover", Boolean(f.abs.cover)],
      ["encode", Boolean(f.abs.upload)],
    ];
    const done = steps.filter(([, ok]) => ok).length;
    const next = steps.find(([, ok]) => !ok)?.[0] ?? null;
    const sentences: string[] = (nar.scenes || []).flatMap((s: any) => (s.lines || []).map((l: any) => l.text));
    return {
      id,
      flow: nar.flow || "H",
      style: styleOf(id),
      aspectRatio: aspect,
      state: runningIds.has(id) ? "progress" : f.abs.upload ? "ready" : "attention",
      progress: { done, total: steps.length, nextStep: next },
      updatedAt: Math.max(mtime(path.join(KIT, "src", "videos", id, "narration.json")), f.abs.upload ? mtime(f.abs.upload) : 0),
      files: f.rel,
      title: dbVideo?.title || title || id,
      caption,
      description: caption,
      pinnedComment: pinned,
      tags: dbVideo?.tags?.length ? dbVideo.tags : tags,
      narrationSummary: sentences.slice(0, 3).join(" "),
      dbVideo,
      s3Synced: Boolean(dbVideo?.s3_key),
    };
  };

  const listJobsSafe = async (): Promise<any[]> => {
    try {
      const res = await axios.get(`${PREVIEW}/api/studio/jobs`, { timeout: 2500 });
      return (res.data?.jobs || []).map((j: any) => ({
        jobId: j.id,
        videoId: j.id,
        topic: j.prompt,
        style: j.style,
        aspectRatio: j.aspectRatio || "9:16",
        status: j.status,
        step: j.step,
        progress: j.progress,
        logs: j.logs || [],
        error: j.error,
        startedAt: j.startedAt,
        reviewMode: j.reviewMode || "all",
        reviewIndex: j.reviewIndex,
        chapters: (j.chapters || []).map((c: any) => ({
          n: c.n,
          from: c.from,
          to: c.to,
          // ready once its draft has been rendered (v is set then)
          url: c.v ? `/api/shorts-studio/file/${c.file}?v=${c.v}` : null,
        })),
      }));
    } catch {
      return [];
    }
  };

  let cachedVoices: any[] = [];
  const getVoices = async () => {
    if (cachedVoices.length) return cachedVoices;
    try {
      const res = await axios.get(`${PREVIEW}/api/studio/voices`, { timeout: 2500 });
      cachedVoices = (res.data?.voices || []).map((v: any) => {
        const label = String(v.label || v.voice);
        const male = /\bnam\b/i.test(label) && !/nữ/i.test(label);
        return {
          id: v.id,
          label,
          gender: male ? "male" : "female",
          accent: /bắc/i.test(label) ? "Bắc" : /trung/i.test(label) ? "Trung" : "Nam",
          trained: /đã train/i.test(label),
        };
      });
    } catch {
      /* preview offline — client keeps its defaults */
    }
    return cachedVoices;
  };

  // Keep preview warm in background so the first click is fast.
  ensurePreview().catch((e) => console.warn(`⚠️ [ShortsStudio] ${e.message}`));

  // ── S3 + DB sync ────────────────────────────────────────────────────────
  const uploadFile = async (abs: string, key: string, contentType: string) => {
    const up = new Upload({
      client: deps.s3Client,
      params: { Bucket: deps.s3Bucket, Key: key, Body: createReadStream(abs), ContentType: contentType },
    });
    await up.done();
    return `https://${deps.s3Bucket}.s3.${region}.amazonaws.com/${key}`;
  };

  const syncVideo = async (id: string, payload: { title?: string; caption?: string; tags?: string[]; forceS3Upload?: boolean } = {}) => {
    const nar = readNarration(id);
    if (!nar) throw new Error(`Không tìm thấy video "${id}"`);
    const aspect = aspectOf(id, nar);
    const f = filesOf(id, aspect);
    const mp4 = f.abs.upload || f.abs.draft;
    if (!mp4) throw new Error(`Video "${id}" chưa render xong (thiếu file MP4)`);

    const fileCaption = readText(path.join(f.outDir, "caption.txt"));
    const parsed = parseCaption(fileCaption);
    const list = await deps.loadMetadata();
    let entry = findDb(list, id, aspect);
    const now = new Date().toISOString();
    const isNew = !entry;
    if (!entry) {
      entry = { id: dbIdFor(id, aspect), created_at: now, images: [] };
      list.push(entry);
    }

    const caption = payload.caption ?? entry.caption ?? fileCaption;
    entry.title = payload.title || entry.title || parsed.title || id;
    entry.caption = caption;
    entry.description = caption;
    entry.description_vi = caption;
    entry.tags = payload.tags?.length ? payload.tags : entry.tags?.length ? entry.tags : parsed.tags;
    entry.aspect_ratio = aspect;
    entry.video_format = aspect === "16:9" ? "long" : "short";
    entry.source = "shorts-studio";
    entry.shorts_id = id;
    entry.local_path = mp4;
    entry.stream_url = `/api/shorts-studio/file/${rel(mp4)}`;
    entry.updated_at = now;

    // UI luôn gửi forceS3Upload=true → bỏ qua; chỉ upload khi chưa có trên S3 hoặc MP4 đã render lại
    // (tránh upload lại 60–100MB mỗi lần bấm "Đăng Đa Nền Tảng" / "Lưu").
    const needUpload = deps.s3Bucket && (isNew || !entry.s3_key || (entry.s3_mtime || 0) < mtime(mp4));
    if (needUpload) {
      const key = `${deps.s3Prefix}${entry.id}_${Date.now()}.mp4`;
      entry.s3_url = await uploadFile(mp4, key, "video/mp4");
      entry.s3_bucket = deps.s3Bucket;
      entry.s3_key = key;
      entry.s3_mtime = mtime(mp4);
      entry.size_bytes = statSync(mp4).size;
      if (f.abs.cover) {
        const ext = path.extname(f.abs.cover).slice(1);
        const thumb = await uploadFile(f.abs.cover, `images/${entry.id}_cover_${Date.now()}.${ext}`, ext === "png" ? "image/png" : "image/jpeg");
        entry.thumbnail_url = thumb;
        entry.images = [thumb];
      }
    } else if (!entry.s3_url) {
      entry.s3_url = entry.stream_url;
    }

    // S3 upload can take 20–30s: re-read the DB and replace only this record, so YouTube /
    // Facebook / TikTok links saved meanwhile are not overwritten by our stale copy.
    const fresh = await deps.loadMetadata();
    const idx = fresh.findIndex((v) => v.id === entry.id);
    if (idx >= 0) {
      const latest = fresh[idx];
      for (const k of Object.keys(latest)) {
        if (/^(youtube_|fb_|tiktok_)|^is_published$/.test(k) && latest[k] != null) entry[k] = latest[k];
      }
      fresh[idx] = entry;
    } else {
      fresh.push(entry);
    }
    await deps.saveMetadata(fresh);
    return entry;
  };

  // ── Routes ──────────────────────────────────────────────────────────────
  app.get("/api/shorts-studio/overview", async (req: any, res: any) => {
    try {
      const format = String(req.query.format || "short");
      const [dbList, jobs, voices] = await Promise.all([deps.loadMetadata(), listJobsSafe(), getVoices()]);
      const running = new Set(jobs.filter((j) => j.status === "running" || j.status === "review").map((j) => j.videoId));
      const videos = listStudioIds()
        .map((id) => buildEntry(id, dbList, running))
        .filter((v) => (format === "long" ? v.aspectRatio === "16:9" : v.aspectRatio !== "16:9"))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      res.json({ success: true, videos, jobs, voices });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/shorts-studio/create", async (req: any, res: any) => {
    try {
      const b = req.body || {};
      const prompt = String(b.prompt || b.topic || "").trim();
      if (!prompt) return res.status(400).json({ ok: false, error: "Thiếu ý tưởng / nội dung" });
      const voiceId = b.voiceId || b.voice;
      const data = await preview("post", "/api/studio/create", {
        id: b.id || b.customId,
        prompt,
        style: b.style,
        // UI gửi "auto" | "topic" | "content" — cả 3 đều cần Opus viết/chia kịch bản
        mode: b.mode === "manual" ? "manual" : "ai",
        duration: b.duration,
        aspectRatio: b.aspectRatio,
        // UI may pick Opus / Opus low / Sonnet; the preview server validates it against its allowlist.
        model: b.model || process.env.SCRIPTWRITER_MODEL || "claude-opus-5-5-medium",
        voiceId,
        reviewMode: b.reviewMode === "chapter" ? "chapter" : "all",
      });
      const j = data.job;
      saveRequest(j.id, {
        prompt,
        style: b.style,
        mode: b.mode === "manual" ? "manual" : "ai",
        duration: b.duration,
        aspectRatio: b.aspectRatio,
        voiceId,
        model: b.model,
        reviewMode: b.reviewMode === "chapter" ? "chapter" : "all",
      });
      res.json({ ok: true, job: { jobId: j.id, videoId: j.id, topic: j.prompt, style: j.style, aspectRatio: j.aspectRatio, status: j.status, step: j.step, progress: j.progress, logs: j.logs } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Chapter review: Next (continue) or Re-render the chapter draft ──────
  for (const action of ["next", "redo"] as const) {
    app.post(`/api/shorts-studio/${action}/:id`, async (req: any, res: any) => {
      try {
        await preview("post", `/api/studio/${action}/${encodeURIComponent(req.params.id)}`, {});
        res.json({ ok: true });
      } catch (err: any) {
        res.status(500).json({ ok: false, error: err.message });
      }
    });
  }

  // ── Stop a running job (kills claude/agy/tts/render child processes) ────
  app.post("/api/shorts-studio/cancel/:id", async (req: any, res: any) => {
    try {
      await preview("post", `/api/studio/cancel/${encodeURIComponent(req.params.id)}`, {});
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Restart a failed / lost job: continue from where it stopped ─────────
  app.post("/api/shorts-studio/restart/:id", async (req: any, res: any) => {
    try {
      const id = req.params.id;
      if (!ID_RE.test(id)) return res.status(400).json({ ok: false, error: "ID không hợp lệ" });
      const jobs = await listJobsSafe();
      if (jobs.some((j) => j.videoId === id && (j.status === "running" || j.status === "review"))) {
        return res.status(409).json({ ok: false, error: "Video này đang chạy rồi" });
      }
      const toJob = (j: any) => ({ jobId: j.id, videoId: j.id, topic: j.prompt, aspectRatio: j.aspectRatio, status: j.status, step: j.step, progress: j.progress, logs: j.logs });

      // A) Kịch bản + hoạt cảnh đã có (brief được ghi sau bước AI) → chạy tiếp TTS → render → encode → sync
      const briefPath = path.join(KIT, "briefs", `${id}.md`);
      if (existsSync(briefPath) && readNarration(id)) {
        const data = await preview("post", `/api/studio/rebuild/${encodeURIComponent(id)}`, {});
        return res.json({ ok: true, resumedFrom: "tts", job: toJob(data.job) });
      }

      // B) Chết trước khi AI viết xong → làm lại từ ý tưởng gốc, giữ nguyên ID
      const saved = loadRequest(id);
      if (!saved?.prompt) {
        return res.status(404).json({ ok: false, error: "Không còn ý tưởng gốc của video này — hãy Xóa và tạo lại" });
      }
      await preview("delete", `/api/video/${encodeURIComponent(id)}`);
      const data = await preview("post", "/api/studio/create", {
        ...saved,
        id,
        model: saved.model || process.env.SCRIPTWRITER_MODEL || "claude-opus-5-5-medium",
      });
      saveRequest(data.job.id, saved);
      res.json({ ok: true, resumedFrom: "script", job: toJob(data.job) });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/shorts-studio/rebuild", async (req: any, res: any) => {
    try {
      const { videoId, voice, sentences } = req.body || {};
      if (!videoId) return res.status(400).json({ ok: false, error: "Thiếu videoId" });
      // sentence ids look like "<scene>#<n>"; new ones inherit the previous sentence's scene
      let lastScene = "hook";
      const lines = (Array.isArray(sentences) ? sentences : []).map((s: any) => {
        const scene = String(s.id || "").split("#")[0];
        if (SCENE_ORDER.includes(scene)) lastScene = scene;
        return { scene: lastScene, text: String(s.text || "") };
      });
      const data = await preview("post", `/api/studio/rebuild/${encodeURIComponent(videoId)}`, { lines, voiceId: voice });
      const j = data.job;
      res.json({ ok: true, job: { jobId: j.id, videoId: j.id, topic: j.prompt, aspectRatio: j.aspectRatio, status: j.status, step: j.step, progress: j.progress, logs: j.logs } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/shorts-studio/voice-sample", async (req: any, res: any) => {
    try {
      const { voice, voiceId, text } = req.body || {};
      const data = await preview("post", "/api/studio/voice-sample", { voiceId: voiceId || voice, text });
      const relPath = String(data.audioUrl || "").replace(/^\/file\//, "");
      res.json({ ok: true, audioUrl: `/api/shorts-studio/file/${relPath}` });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/shorts-studio/sync/:id", async (req: any, res: any) => {
    try {
      const video = await syncVideo(req.params.id, req.body || {});
      res.json({ success: true, video });
    } catch (err: any) {
      console.error(`❌ [ShortsStudio] Sync ${req.params.id}: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/shorts-studio/video/:id", async (req: any, res: any) => {
    try {
      const id = req.params.id;
      const nar = readNarration(id);
      if (!nar) return res.status(404).json({ success: false, error: "Không tìm thấy video" });
      const entry = buildEntry(id, await deps.loadMetadata(), new Set());
      const sentences = (nar.scenes || []).flatMap((s: any) =>
        (s.lines || []).map((l: any, i: number) => ({ id: `${s.id}#${i + 1}`, scene: s.id, text: l.text })),
      );
      res.json({
        success: true,
        ...entry,
        captionText: entry.dbVideo?.caption || entry.caption,
        narration: { voice: nar.voice ? `${nar.voice.engine}:${nar.voice.voice}` : undefined, sentences },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete("/api/shorts-studio/video/:id", async (req: any, res: any) => {
    try {
      const id = req.params.id;
      if (!ID_RE.test(id)) return res.status(400).json({ ok: false, error: "ID không hợp lệ" });
      await preview("delete", `/api/video/${encodeURIComponent(id)}`);
      const list = await deps.loadMetadata();
      const next = list.filter((v) => !(v.shorts_id === id || v.id === `shorts_${id}` || v.id === `long_${id}`));
      if (next.length !== list.length) await deps.saveMetadata(next);
      res.json({ ok: true, success: true, id });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post("/api/shorts-studio/video/:id/toggle-published", async (req: any, res: any) => {
    try {
      const id = req.params.id;
      const nar = readNarration(id);
      const aspect = aspectOf(id, nar);
      let list = await deps.loadMetadata();
      let entry = findDb(list, id, aspect);
      if (!entry) {
        await syncVideo(id);
        list = await deps.loadMetadata();
        entry = findDb(list, id, aspect);
      }
      if (!entry) throw new Error("Không tạo được bản ghi DB cho video");
      const current =
        entry.is_published !== undefined
          ? Boolean(entry.is_published)
          : Boolean(entry.youtube_video_id || entry.fb_video_id || entry.tiktok_video_id || entry.tiktok_status === "published");
      entry.is_published = !current;
      entry.updated_at = new Date().toISOString();
      await deps.saveMetadata(list);
      res.json({ success: true, is_published: entry.is_published, video: entry });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get(/^\/api\/shorts-studio\/file\/(.+)$/, (req: any, res: any) => {
    const relPath = decodeURIComponent(req.params[0] || "");
    const abs = path.resolve(KIT, relPath);
    const allowed = ["out", "out-long", "public"].some((d) => abs.startsWith(path.join(KIT, d) + path.sep));
    if (!allowed || !existsSync(abs)) return res.status(404).send("not found");
    res.sendFile(abs);
  });

  // ── Trending topics from Vietnamese news RSS ────────────────────────────
  const FEEDS: Record<string, { name: string; url: string }[]> = {
    hot: [
      { name: "VnExpress", url: "https://vnexpress.net/rss/tin-noi-bat.rss" },
      { name: "Tuổi Trẻ", url: "https://tuoitre.vn/rss/tin-moi-nhat.rss" },
    ],
    money: [
      { name: "VnExpress", url: "https://vnexpress.net/rss/kinh-doanh.rss" },
      { name: "Dân Trí", url: "https://dantri.com.vn/rss/kinh-doanh.rss" },
    ],
    decode: [
      { name: "VnExpress", url: "https://vnexpress.net/rss/khoa-hoc.rss" },
      { name: "Tuổi Trẻ", url: "https://tuoitre.vn/rss/van-hoa.rss" },
    ],
    law: [
      { name: "VnExpress", url: "https://vnexpress.net/rss/phap-luat.rss" },
      { name: "Dân Trí", url: "https://dantri.com.vn/rss/phap-luat.rss" },
    ],
    health: [
      { name: "VnExpress", url: "https://vnexpress.net/rss/suc-khoe.rss" },
      { name: "Dân Trí", url: "https://dantri.com.vn/rss/suc-khoe.rss" },
    ],
    // Truyện ma có thật (member stories): the create step fetches every chapter from the link.
    spirit: [
      { name: "Truyện Ma Có Thật", url: "https://truyenmacothat.net/truyen/feed/" },
      { name: "Truyện Ma Có Thật", url: "https://truyenmacothat.net/feed/" },
    ],
  };
  const slug = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .split("-")
      .slice(0, 7)
      .join("-");
  const decodeXml = (s: string) =>
    s
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
  const fetchFeed = async (cat: string, feed: { name: string; url: string }) => {
    try {
      const r = await axios.get(feed.url, { timeout: 8000, responseType: "text", headers: { "User-Agent": "Mozilla/5.0" } });
      const items = String(r.data).match(/<item>[\s\S]*?<\/item>/g) || [];
      return items.slice(0, 15).map((it) => {
        const title = decodeXml((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
        const link = decodeXml((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "");
        const desc = decodeXml((it.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || "");
        return {
          cat,
          id: slug(title),
          label: title,
          prompt: `${title}. ${desc}`.slice(0, 600) + `\n(Nguồn: ${feed.name} — ${link})`,
          sourceName: feed.name,
          sourceTitle: title,
          sourceUrl: link,
        };
      }).filter((t) => t.label && t.id);
    } catch {
      return [];
    }
  };

  // ── Chặn tin đã làm video: so link bài báo + tiêu đề chuẩn hoá ──────────
  const normUrl = (u: string) => u.trim().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  const normTitle = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const collectUsedTopics = async () => {
    const urls = new Set<string>();
    const titles = new Set<string>();
    const ids = new Set<string>(listStudioIds());
    const texts: string[] = [];
    const readDir = (dir: string, ext: string) => {
      try {
        for (const f of readdirSync(dir)) if (f.endsWith(ext)) texts.push(readFileSync(path.join(dir, f), "utf8"));
      } catch {
        /* missing dir */
      }
    };
    readDir(path.join(KIT, "briefs"), ".md");
    readDir(REQ_DIR, ".json");
    for (const v of await deps.loadMetadata()) {
      if (!isStudioVideo(v)) continue;
      if (v.shorts_id) ids.add(v.shorts_id);
      if (v.title) titles.add(normTitle(v.title));
      texts.push(`${v.prompt || ""}\n${v.description || ""}`);
    }
    for (const t of texts) {
      for (const m of t.match(/https?:\/\/[^\s)"'\\]+/g) || []) urls.add(normUrl(m));
      // Dòng đầu của prompt = tiêu đề bài báo gốc (format: "<tiêu đề>. <mô tả>")
      const prompt = /\*\*Prompt:\*\*\s*([^\n]+)/.exec(t)?.[1] || /"prompt":\s*"([^"]+)/.exec(t)?.[1];
      if (prompt) titles.add(normTitle(prompt.split(/\.\s/)[0]));
    }
    return { urls, titles, ids };
  };

  app.post("/api/shorts-studio/random-trending-topic", async (req: any, res: any) => {
    try {
      const { category = "hot", allCategories, excludeIds = [], excludeLabels = [] } = req.body || {};
      const cats = allCategories ? Object.keys(FEEDS) : [FEEDS[category] ? category : "hot"];
      const results = (await Promise.all(cats.flatMap((c) => FEEDS[c].map((f) => fetchFeed(c, f))))).flat();
      const exIds = new Set(excludeIds);
      const exLabels = new Set(excludeLabels);
      const used = await collectUsedTopics();
      const seen = new Set<string>();
      const fresh = results.filter((t) => {
        if (exIds.has(t.id) || exLabels.has(t.label) || seen.has(t.id)) return false;
        // Đã làm video (cả 9:16 lẫn 16:9, kể cả video đã xoá khỏi list nhưng còn brief/DB) → chặn
        if (t.sourceUrl && used.urls.has(normUrl(t.sourceUrl))) return false;
        if (used.titles.has(normTitle(t.label)) || used.ids.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
      if (!fresh.length) return res.status(502).json({ ok: false, error: "Không lấy được tin mới từ báo (hoặc đã dùng hết)" });
      const shuffled = fresh.sort(() => Math.random() - 0.5);
      const perCat: any[] = [];
      for (const c of cats) perCat.push(...shuffled.filter((t) => t.cat === c).slice(0, allCategories ? 4 : 8));
      res.json({ ok: true, topic: perCat[0] || shuffled[0], suggestions: perCat.length ? perCat : shuffled.slice(0, 8) });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });
}
