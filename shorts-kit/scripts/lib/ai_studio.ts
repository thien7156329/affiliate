import "./proc"; // side effect: puts a bundled ffmpeg/ffprobe on PATH when the system has none
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type {
  StickmanAction,
  StickmanSceneAct,
  StickmanSetting,
} from "../../src/shared/figures/StickmanStage";
import type { ExplainerBeat } from "../../src/shared/explainer/types";
import {
  buildVideoBackgrounds,
  type ExplainerBgSpec,
} from "./explainer_bg";
import {
  readStoryPlan,
  renderStoryAssets,
  storyActs,
  writeStoryFiles,
  writeStoryPlan,
} from "./story_studio";
import { planBackdrops, renderBackdrops, writeBackdrops } from "./stickman_bg";
import { castVoices, splitRole } from "./voice_cast";
import { isClonedVoice, resolveVoice } from "./engines/voice_clones";
import { fetchStoryFromUrl, findStoryUrl } from "./story_fetch";

const REPO = resolve(import.meta.dir, "../..");

export type StudioStyle =
  | "stickman"
  | "infographic"
  | "vietnam-map"
  | "nature-sky"
  /** Thầy Lá narrator over AI-illustrated backgrounds (Z-Image-Turbo via mflux, local). */
  | "stickman-explainer"
  /** Voice-over story: one large Gemini illustration per panel, recurring characters, a few silent Veo clips. */
  | "story"
  /** Stickman "giải mã tâm linh": tell an eerie story, then decode it with science; AI backdrops per beat. */
  | "spirit";
export type StudioMode = "ai" | "manual";
export type StudioDuration =
  | "short" | "medium" | "long" | "story" | "deep" | "epic"
  | "m15" | "m20" | "m25" | "m30"
  /** ~12 s test clip (API only). */
  | "demo"
  /** Picked from the input length at create time (resolveAutoDuration). */
  | "auto";

/** Measured on rendered videos: VieNeu reads ~4.4 words/s incl. pauses ≈ 265 words/minute. */
export const SPOKEN_WORDS_PER_MIN = Number(process.env.SPOKEN_WORDS_PER_MIN || 265);
/** Target length (minutes) per duration option. Word budget = minutes × SPOKEN_WORDS_PER_MIN. */
export const DURATION_MINUTES: Record<StudioDuration, number> = {
  short: 0.7,
  medium: 1.25,
  long: 2.25,
  story: 3.5,
  deep: 5.5,
  epic: 10,
  m15: 15,
  m20: 20,
  m25: 25,
  m30: 30,
  demo: 0.2,
  auto: 3.5,
};

/**
 * "auto": a short topic keeps the format default; a pasted story/article becomes as long as reading it aloud
 * (+25 % for the spirit style's science part), snapped to the nearest duration option.
 */
export const resolveAutoDuration = (
  prompt: string,
  style: string,
  aspectRatio: "9:16" | "16:9",
): {duration: StudioDuration; minutes: number; words: number} => {
  const words = prompt.trim().split(/\s+/).filter(Boolean).length;
  const fallback: StudioDuration = aspectRatio === "16:9" ? "story" : "medium";
  if (words < 120) return {duration: fallback, minutes: DURATION_MINUTES[fallback], words};
  let minutes = words / SPOKEN_WORDS_PER_MIN;
  if (style === "spirit") minutes *= 1.25;
  // Shorts stay short; long videos are capped at the longest option.
  minutes = aspectRatio === "16:9" ? Math.min(30, Math.max(2.25, minutes)) : Math.min(2.25, Math.max(0.7, minutes));
  const options = (Object.keys(DURATION_MINUTES) as StudioDuration[]).filter((k) => k !== "demo" && k !== "auto");
  const duration = options.reduce((best, k) =>
    Math.abs(DURATION_MINUTES[k] - minutes) < Math.abs(DURATION_MINUTES[best] - minutes) ? k : best,
  );
  return {duration, minutes, words};
};
export const durationLabelOf = (d: StudioDuration): string => {
  const m = DURATION_MINUTES[d] ?? 1.25;
  return m < 1 ? `~${Math.round(m * 60)} giây` : `~${m} phút`;
};
const countWords = (scenes: Record<string, string[]> | undefined): number =>
  Object.values(scenes || {}).flat().reduce((n, t) => n + String(t).trim().split(/\s+/).filter(Boolean).length, 0);
export type StudioAspectRatio = "9:16" | "16:9";

export type VoiceOption = {
  id: string;
  engine: "vieneu" | "say";
  voice: string;
  label: string;
};

export const VIENEU_VOICES: VoiceOption[] = [
  {
    id: "vieneu:Anh Minh",
    engine: "vieneu",
    voice: "Anh Minh",
    label: "🕯️ [Clone, đã được phép] Anh Minh — Nam miền Nam, giọng kể truyện tâm linh",
  },
  {
    id: "vieneu:Anh Minh B",
    engine: "vieneu",
    voice: "Anh Minh B",
    label: "🕯️ [Clone, đã được phép] Anh Minh B — Nam miền Nam (mẫu thu thứ 2)",
  },
  {
    id: "vieneu:Mai Bé Phương",
    engine: "vieneu",
    voice: "Mai Bé Phương",
    label:
      "🔥 [Giọng đã Train] Mai Bé Phương — Nữ Chính miền Nam tươi tắn, vui nhộn",
  },
  {
    id: "vieneu:DuDu_NamChinh",
    engine: "vieneu",
    voice: "DuDu_NamChinh",
    label:
      "🔥 [Giọng đã Train] DuDu Nam Chính — Nam ấm áp, dễ thương (Sample 1s–4s)",
  },
  {
    id: "vieneu:BuBu_Part4",
    engine: "vieneu",
    voice: "BuBu_Part4",
    label: "🔥 [Giọng đã Train] BuBu Part 4 — Giọng hoạt hình chibi lồng tiếng",
  },
  {
    id: "vieneu:Thiện Minh",
    engine: "vieneu",
    voice: "Thiện Minh",
    label: "⭐ Thiện Minh — Nam · Bắc · Kể chuyện (VieNeu AI)",
  },
  {
    id: "vieneu:Adam bựa",
    engine: "vieneu",
    voice: "Adam bựa",
    label: "⭐ Adam bựa — Nam · Bắc · Tự nhiên hài hước (VieNeu AI)",
  },
  {
    id: "vieneu:Trúc Ly",
    engine: "vieneu",
    voice: "Trúc Ly",
    label: "⭐ Trúc Ly — Nữ · Bắc · Tự nhiên (VieNeu AI)",
  },
  {
    id: "vieneu:Mai Anh",
    engine: "vieneu",
    voice: "Mai Anh",
    label: "⭐ Mai Anh — Nữ · Bắc · Tin tức (VieNeu AI)",
  },
  {
    id: "vieneu:Hải Đăng",
    engine: "vieneu",
    voice: "Hải Đăng",
    label: "⭐ Hải Đăng — Nam · Bắc · Tự nhiên (VieNeu AI)",
  },
  {
    id: "vieneu:Anh Khôi",
    engine: "vieneu",
    voice: "Anh Khôi",
    label: "⭐ Anh Khôi — Nam · Bắc · Kể chuyện (VieNeu AI)",
  },
  {
    id: "vieneu:Minh Quân",
    engine: "vieneu",
    voice: "Minh Quân",
    label: "⭐ Minh Quân — Nam · Bắc · Tự nhiên (VieNeu AI)",
  },
  {
    id: "vieneu:Mạnh Dũng",
    engine: "vieneu",
    voice: "Mạnh Dũng",
    label: "⭐ Mạnh Dũng — Nam · Bắc · Tự nhiên (VieNeu AI)",
  },
  {
    id: "vieneu:Thùy Dung",
    engine: "vieneu",
    voice: "Thùy Dung",
    label: "⭐ Thùy Dung — Nữ · Nam · Tin tức (VieNeu AI)",
  },
  {
    id: "vieneu:Thiền Tâm Đức",
    engine: "vieneu",
    voice: "Thiền Tâm Đức",
    label: "⭐ Thiền Tâm Đức — Nam · Bắc · Kể chuyện trầm ấm (VieNeu AI)",
  },
  {
    id: "vieneu:Ngọc Huyền",
    engine: "vieneu",
    voice: "Ngọc Huyền",
    label: "⭐ Ngọc Huyền — Nữ · Bắc · Giọng tự nhiên (VieNeu AI)",
  },
  {
    id: "vieneu:Quang Sơn",
    engine: "vieneu",
    voice: "Quang Sơn",
    label: "⭐ Quang Sơn — Nam · Trung · Tự nhiên (VieNeu AI)",
  },
  {
    id: "vieneu:Ngọc Trân",
    engine: "vieneu",
    voice: "Ngọc Trân",
    label: "⭐ Ngọc Trân — Nữ · Trung · Tự nhiên (VieNeu AI)",
  },
  {
    id: "vieneu:Thái Sơn",
    engine: "vieneu",
    voice: "Thái Sơn",
    label: "Thái Sơn — Nam · Nam · Kể chuyện (VieNeu AI)",
  },
  {
    id: "vieneu:Thục Đoan",
    engine: "vieneu",
    voice: "Thục Đoan",
    label: "Thục Đoan — Nữ · Nam · Kể chuyện (VieNeu AI)",
  },
  {
    id: "vieneu:Minh Triết",
    engine: "vieneu",
    voice: "Minh Triết",
    label: "Minh Triết — Nam · Nam · Tin tức (VieNeu AI)",
  },
  {
    id: "vieneu:Mỹ Duyên",
    engine: "vieneu",
    voice: "Mỹ Duyên",
    label: "Mỹ Duyên — Nữ · Nam · Đọc truyện (VieNeu AI)",
  },
  {
    id: "vieneu:Đức Trí",
    engine: "vieneu",
    voice: "Đức Trí",
    label: "Đức Trí — Nam · Nam · Đọc truyện (VieNeu AI)",
  },
  {
    id: "vieneu:Kim Thanh",
    engine: "vieneu",
    voice: "Kim Thanh",
    label: "Kim Thanh — Nữ · Nam · Đọc truyện (VieNeu AI)",
  },
  {
    id: "vieneu:Adam",
    engine: "vieneu",
    voice: "Adam",
    label: "Adam — Nam · Nam · Tự nhiên (VieNeu AI)",
  },
  {
    id: "vieneu:Minh Đức",
    engine: "vieneu",
    voice: "Minh Đức",
    label: "Minh Đức — Nam · Bắc · Tin tức (VieNeu AI)",
  },
  {
    id: "vieneu:Phạm Tuyên",
    engine: "vieneu",
    voice: "Phạm Tuyên",
    label: "Phạm Tuyên — Nam · Bắc · Tự nhiên (VieNeu AI)",
  },
  {
    id: "vieneu:Xuân Vĩnh",
    engine: "vieneu",
    voice: "Xuân Vĩnh",
    label: "Xuân Vĩnh — Nam · Bắc · Tự nhiên (VieNeu AI)",
  },
  {
    id: "vieneu:Thanh Bình",
    engine: "vieneu",
    voice: "Thanh Bình",
    label: "Thanh Bình — Nam · Bắc · Kể chuyện (VieNeu AI)",
  },
  {
    id: "vieneu:Ngọc Linh",
    engine: "vieneu",
    voice: "Ngọc Linh",
    label: "Ngọc Linh — Nữ · Bắc · Kể chuyện (VieNeu AI)",
  },
  {
    id: "vieneu:Đoan Trang",
    engine: "vieneu",
    voice: "Đoan Trang",
    label: "Đoan Trang — Nữ · Bắc · Tự nhiên (VieNeu AI)",
  },
  {
    id: "vieneu:Quỳnh Anh",
    engine: "vieneu",
    voice: "Quỳnh Anh",
    label: "Quỳnh Anh — Nữ · Bắc · Đọc truyện (VieNeu AI)",
  },
  {
    id: "vieneu:Quốc Tuấn",
    engine: "vieneu",
    voice: "Quốc Tuấn",
    label: "Quốc Tuấn — Nam · Bắc · Tự nhiên (VieNeu AI)",
  },
  {
    id: "say:Linh",
    engine: "say",
    voice: "Linh",
    label: "⚡ Linh (macOS Say — Nháp siêu tốc 1 giây)",
  },
];

export const parseVoiceOption = (
  voiceId?: string,
): { engine: "vieneu" | "say"; voice: string } => {
  if (!voiceId) return { engine: "vieneu", voice: "Mai Bé Phương" };
  const found = VIENEU_VOICES.find(
    (v) => v.id === voiceId || v.voice === voiceId,
  );
  if (found) return { engine: found.engine, voice: found.voice };
  if (voiceId.startsWith("say:"))
    return { engine: "say", voice: voiceId.slice(4) || "Linh" };
  if (voiceId.startsWith("vieneu:"))
    return { engine: "vieneu", voice: voiceId.slice(7) || "Thiện Minh" };
  return { engine: "vieneu", voice: voiceId };
};

/** Generate or return cached preview audio file path (relative to REPO) for a voice & sample text. */
export const synthesizeVoiceSample = async (
  voiceId: string,
  sampleText?: string,
): Promise<string> => {
  const { engine, voice } = parseVoiceOption(voiceId);
  const text =
    (sampleText || "").trim() ||
    `Xin chào các bạn, mình là ${voice}. Hôm nay chúng ta cùng khám phá một sự thật cực kỳ thú vị nhé!`;
  const key = createHash("sha1")
    .update(`${engine}:${voice}:${text}`)
    .digest("hex")
    .slice(0, 14);
  const relDir = "out/voice-samples";
  const absDir = join(REPO, relDir);
  mkdirSync(absDir, { recursive: true });
  const outMp3 = join(absDir, `sample-${key}.mp3`);
  const relMp3 = `${relDir}/sample-${key}.mp3`;
  if (existsSync(outMp3)) return relMp3;

  const cacheWorkBase = join(REPO, ".cache", "voice-samples");
  mkdirSync(cacheWorkBase, { recursive: true });

  if (engine === "say") {
    const tmpAiff = join(cacheWorkBase, `tmp-${key}.aiff`);
    const p1 = Bun.spawn(["say", "-v", voice, "-o", tmpAiff, text], {
      cwd: REPO,
      stdout: "ignore",
      stderr: "pipe",
    });
    if ((await p1.exited) !== 0)
      throw new Error(await new Response(p1.stderr).text());
    const p2 = Bun.spawn(
      [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        tmpAiff,
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        outMp3,
      ],
      { cwd: REPO },
    );
    if ((await p2.exited) !== 0) throw new Error("ffmpeg encode sample failed");
    return relMp3;
  }

  const py = join(REPO, ".venv-vieneu", "bin", "python");
  const workDir = join(cacheWorkBase, `work-${key}`);
  mkdirSync(workDir, { recursive: true });
  const jobFile = join(workDir, "job.json");
  writeFileSync(
    jobFile,
    JSON.stringify({
      lines: [text],
      voice: resolveVoice(voice),
      mode: "",
      out: workDir,
      cache: join(REPO, ".cache", "vieneu"),
    }),
  );
  const proc = Bun.spawn(
    [py, join(REPO, "scripts/lib/engines/vieneu_bridge.py"), jobFile],
    {
      cwd: REPO,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0)
    throw new Error(`VieNeu sample error: ${stderr.slice(-300)}`);
  const wavFile = join(workDir, "line-0.wav");
  const ff = Bun.spawn(
    [
      "ffmpeg",
      "-y",
      "-v",
      "error",
      "-i",
      wavFile,
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      outMp3,
    ],
    { cwd: REPO },
  );
  if ((await ff.exited) !== 0) throw new Error("ffmpeg sample wav->mp3 failed");
  return relMp3;
};

export type StudioJob = {
  id: string;
  style: StudioStyle;
  mode: StudioMode;
  aspectRatio?: StudioAspectRatio;
  voiceId: string;
  prompt: string;
  /** "review" = paused, waiting for the user to watch a finished chapter and press Next. */
  status: "running" | "review" | "done" | "error";
  step: string;
  progress: number;
  logs: string[];
  startedAt: number;
  finishedAt?: number;
  error?: string;
  /** "chapter": stop after every ~2 min chapter draft and wait for Next; "all" (default): run start to end. */
  reviewMode?: "chapter" | "all";
  /** Draft chapters for review (file is relative to shorts-kit/; v busts the browser cache after a re-render). */
  chapters?: { n: number; from: number; to: number; file: string; v: number }[];
  /** 1-based chapter currently waiting for review. */
  reviewIndex?: number;
};

const jobs = new Map<string, StudioJob>();

// ── Chapter review gate: the job waits here until the user presses Next / Re-render / Stop ──
type GateAnswer = "next" | "redo";
const gates = new Map<string, { resolve: (a: GateAnswer) => void; reject: (e: Error) => void }>();

/** Resume a job that is waiting for chapter review. */
export const continueJob = (id: string, action: GateAnswer = "next"): boolean => {
  const g = gates.get(id);
  if (!g) return false;
  gates.delete(id);
  g.resolve(action);
  return true;
};

export const listJobs = (): StudioJob[] =>
  [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);

export const getJob = (id: string): StudioJob | null => jobs.get(id) ?? null;

/** Completely remove a video and all its source, output, audio, cache, job, and facts DB entries. */
export const deleteVideoCompletely = (id: string): void => {
  jobs.delete(id);
  const dirs = [
    join(REPO, "src", "videos", id),
    join(REPO, "out", id),
    join(REPO, "out-long", id),
    join(REPO, "public", "audio", id),
    join(REPO, "public", "img", "explainer", id),
    join(REPO, ".cache", "preview-frames", id),
  ];
  for (const d of dirs) {
    try {
      if (existsSync(d)) rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  const factsPath = join(REPO, "research", "facts.json");
  if (existsSync(factsPath)) {
    try {
      const factId = `f-studio-${id.slice(0, 16)}`;
      const parsed = JSON.parse(readFileSync(factsPath, "utf8"));
      if (Array.isArray(parsed)) {
        const next = parsed.filter((f: any) => f?.id !== factId);
        if (next.length !== parsed.length)
          writeFileSync(factsPath, JSON.stringify(next, null, 2) + "\n");
      } else if (parsed && Array.isArray(parsed.facts)) {
        const next = parsed.facts.filter((f: any) => f?.id !== factId);
        if (next.length !== parsed.facts.length) {
          parsed.facts = next;
          writeFileSync(factsPath, JSON.stringify(parsed, null, 2) + "\n");
        }
      }
    } catch {
      /* ignore */
    }
  }
};

/** Trim a string at a word boundary so no Vietnamese word is ever cut in half */
const trimWords = (s: string, maxChars: number): string => {
  const clean = s.trim();
  if (clean.length <= maxChars) return clean;
  const words = clean.split(/\s+/);
  let out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > maxChars) break;
    out = next;
  }
  return out || clean.slice(0, maxChars);
};

const slugify = (s: string): string => {
  const raw = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Cut at a full hyphen-delimited word boundary (up to 36 chars) so folder names never chop a word in half
  const parts = raw.split("-").filter(Boolean);
  let base = "";
  for (const p of parts) {
    const next = base ? `${base}-${p}` : p;
    if (next.length > 36 && base) break;
    base = next;
  }
  return base || `video-${Date.now().toString(36).slice(-4)}`;
};

/**
 * Clean spoken Vietnamese line so it passes SOUL lint rules (no colons, dashes, or >24-word sentences).
 * Commas are KEPT: VieNeu breathes on them (tested 2026-11-23); without them it reads a long line in one run
 * and guesses a pause mid-phrase, which sounds mushy.
 */
const sanitizeSpoken = (raw: string): string => {
  let s = raw
    .replace(/[:—–]/g, ",")
    .replace(/\s*,\s*(,\s*)+/g, ", ")
    .replace(/\s+-\s+/g, " ")
    .replace(/\betc\./gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/[.!?]$/.test(s)) s += ".";
  const parts = s.split(/(?<=[.!?])\s+/);
  const fixed = parts.flatMap((sent) => {
    const w = sent.trim().split(/\s+/).filter(Boolean);
    if (w.length <= 24) return [sent];
    const mid = Math.floor(w.length / 2);
    const first =
      w
        .slice(0, mid)
        .join(" ")
        .replace(/[,;.!?]+$/, "") + ".";
    const second = w
      .slice(mid)
      .join(" ")
      .replace(
        /^[a-zàáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/u,
        (c) => c.toUpperCase(),
      );
    return [first, second];
  });
  return fixed.join(" ");
};

type GeneratedPlan = {
  coverKicker: string;
  coverLine1: string;
  coverLine2: string;
  chip1: string;
  chip2: string;
  headlineKicker: string;
  headlineText: string;
  bar1Label: string;
  bar1Value: number;
  bar2Label: string;
  bar2Value: number;
  barUnit: string;
  stickBubble1: string;
  stickBubble2: string;
  stickmanActs?: StickmanSceneAct[];
  caption: string;
  pinned: string;
  scenes: {
    hook: string[];
    problem: string[];
    layer1: string[];
    layer2: string[];
    hardest: string[];
    payoff: string[];
    share: string[];
  };
};

/** Models the Studio UI may pick for script + visual direction (anything else falls back to the .env defaults). */
export const STUDIO_AI_MODELS: Record<string, string> = {
  "claude-opus-5-5-medium": "Claude Opus 5.5 (Medium)",
  "claude-opus-5-5-low": "Claude Opus 5.5 (Low)",
  "claude-sonnet-5-5-medium": "Claude Sonnet 5.5",
};
const pickStudioModel = (m?: string): string | undefined => (m && STUDIO_AI_MODELS[m] ? m : undefined);

/** "Trùm cuối": mọi bước AI của Shorts Studio chạy qua AGY bằng model này. */
const OPUS_BOSS_MODEL = process.env.SCRIPTWRITER_MODEL || "claude-opus-5-5-medium";
/** Dựng hoạt cảnh (JSON + SVG rất dài, ~9 phút) — Opus medium cho chất lượng hình tốt nhất. */
const VISUAL_MODEL = process.env.VISUAL_MODEL || "claude-opus-5-5-medium";

// ── 1 AI chạy tại 1 thời điểm + không để tiến trình AI mồ côi ─────────────
// Opus/Gemini được gọi tuần tự (fallback chỉ khi model trước fail). Các job khác xếp hàng.
// PID con được ghi ra file: server preview restart/tắt → lần chạy sau kill nốt claude/agy cũ
// (trước đây chúng chạy tiếp ngầm, tốn credit và chạy song song với job mới).
const AI_PIDS_FILE = join(REPO, ".cache", "ai-child-pids.json");
const liveAiProcs = new Map<number, { kill: () => void }>();
const writeAiPids = () => {
  try {
    mkdirSync(join(REPO, ".cache"), { recursive: true });
    writeFileSync(AI_PIDS_FILE, JSON.stringify([...liveAiProcs.keys()]));
  } catch {
    /* best effort */
  }
};
// ── Dừng job: mọi tiến trình con của job được ghi lại để nút "Dừng" kill được ──
type KillableProc = { pid: number; kill: (sig?: any) => void; exited: Promise<number> };
const jobProcs = new Map<string, Set<KillableProc>>();
const cancelledJobs = new Set<string>();
const isCancelled = (job?: StudioJob) => Boolean(job && cancelledJobs.has(job.id));
const attachJobProc = (job: StudioJob | undefined, proc: KillableProc) => {
  if (!job) return;
  let set = jobProcs.get(job.id);
  if (!set) jobProcs.set(job.id, (set = new Set()));
  set.add(proc);
  proc.exited.finally(() => set!.delete(proc));
};
/** Kill a process and everything it spawned (remotion → chrome, ffmpeg, python TTS…). */
const killTree = (pid: number) => {
  try {
    if (process.platform === "win32") {
      Bun.spawnSync(["taskkill", "/PID", String(pid), "/T", "/F"]);
      return;
    }
    const kids = Bun.spawnSync(["pgrep", "-P", String(pid)]).stdout.toString().split(/\s+/).filter(Boolean);
    for (const k of kids) killTree(Number(k));
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
};
const throwIfCancelled = (job: StudioJob) => {
  if (cancelledJobs.has(job.id)) throw new Error("Đã dừng theo yêu cầu");
};

/** Stop a running job: kill its child processes; the job ends as "error" (so "Chạy lại" can resume it). */
export const cancelJob = (id: string): boolean => {
  const job = jobs.get(id);
  if (!job || (job.status !== "running" && job.status !== "review")) return false;
  cancelledJobs.add(id);
  const gate = gates.get(id);
  if (gate) {
    gates.delete(id);
    gate.reject(new Error("Đã dừng theo yêu cầu"));
  }
  job.logs.push("[Dừng] Người dùng bấm Dừng — đang tắt các tiến trình đang chạy…");
  job.step = "Đang dừng…";
  for (const p of jobProcs.get(id) ?? []) killTree(p.pid);
  return true;
};

const trackAiProc = (proc: { pid: number; kill: () => void; exited: Promise<number> }, job?: StudioJob) => {
  attachJobProc(job, proc);
  liveAiProcs.set(proc.pid, proc);
  writeAiPids();
  proc.exited.finally(() => {
    liveAiProcs.delete(proc.pid);
    writeAiPids();
  });
};
(() => {
  try {
    const stale = JSON.parse(readFileSync(AI_PIDS_FILE, "utf8")) as number[];
    for (const pid of stale) {
      try {
        const cmd = Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)]).stdout.toString();
        if (/claude -p|agy --print/.test(cmd)) {
          process.kill(pid, "SIGTERM");
          console.warn(`[ai_studio] Killed orphan AI process ${pid}`);
        }
      } catch {
        /* already gone */
      }
    }
  } catch {
    /* no file */
  }
  writeAiPids();
  const killAll = () => {
    for (const p of liveAiProcs.values()) p.kill();
  };
  process.on("exit", killAll);
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => {
      killAll();
      process.exit(0);
    });
  }
})();
let aiQueue: Promise<unknown> = Promise.resolve();
const withAiSlot = <T>(job: StudioJob | undefined, fn: () => Promise<T>): Promise<T> => {
  const waiting = liveAiProcs.size > 0;
  if (waiting && job) job.logs.push("[AI] Đang chờ job khác dùng xong AI (chạy 1 model tại 1 thời điểm)…");
  const run = aiQueue.then(fn, fn);
  aiQueue = run.catch(() => undefined);
  return run;
};

const resolveAgyBin = (): string => {
  const candidates = [
    process.env.AGY_CLI_PATH,
    "/Users/letrongthien/Downloads/projects/teams_bot_server/.tools/bin/agy",
    "/usr/local/bin/agy",
    "/opt/homebrew/bin/agy",
  ].filter(Boolean) as string[];
  for (const c of candidates) if (existsSync(c)) return c;
  return "agy";
};

const resolveClaudeBin = (): string => {
  const home = process.env.HOME || "";
  const candidates = [
    process.env.CLAUDE_CLI_PATH,
    join(home, ".local/bin/claude"),
    join(home, ".claude/local/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ].filter(Boolean) as string[];
  for (const c of candidates) if (existsSync(c)) return c;
  // No `claude` on PATH (typical on Windows): use the binary bundled with the VS Code extension.
  try {
    const extDir = join(home || process.env.USERPROFILE || "", ".vscode", "extensions");
    const ext = readdirSync(extDir)
      .filter((n) => n.startsWith("anthropic.claude-code-"))
      .sort()
      .reverse()
      .map((n) => join(extDir, n, "resources", "native-binary", process.platform === "win32" ? "claude.exe" : "claude"))
      .find((f) => existsSync(f));
    if (ext) return ext;
  } catch {
    /* no extension dir */
  }
  return "claude";
};

/** "claude-opus-5-5-medium" → Claude Code CLI (model claude-opus-5-5, effort medium). */
const runClaudePrompt = async (
  fullPrompt: string,
  model: string,
  timeoutSec: number,
  job?: StudioJob,
): Promise<string | null> => {
  if (isCancelled(job)) return null;
  const m = /^(claude-[a-z]+-\d+-\d+)(?:-(low|medium|high|xhigh|max))?$/.exec(model);
  const baseModel = m?.[1] ?? model;
  const effort = m?.[2] ?? "medium";
  try {
    const proc = Bun.spawn(
      [
        resolveClaudeBin(),
        "-p",
        "--model",
        baseModel,
        "--effort",
        effort,
        "--output-format",
        "json",
        "--tools",
        "",
        "--no-session-persistence",
      ],
      { cwd: REPO, stdin: new Blob([fullPrompt]), stdout: "pipe", stderr: "pipe" },
    );
    trackAiProc(proc, job);
    const timer = setTimeout(() => proc.kill(), timeoutSec * 1000);
    const [out] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(), // drain stderr so a full pipe can never block the child
    ]);
    await proc.exited;
    clearTimeout(timer);
    const env = JSON.parse(out.trim());
    if (env?.is_error || typeof env?.result !== "string") return null;
    return env.result.trim() || null;
  } catch {
    return null;
  }
};

/** Fallback Gemini: AGY names from .env (gemini-4-*) → a model this AGY build knows. */
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "Gemini 3.8 Flash (High)";

/** Public entry: 1 AI call at a time across all jobs (Opus → fallback Gemini runs inside the same slot). */
export const runAgyPrompt = (
  fullPrompt: string,
  model: string,
  timeoutSec = 75,
  job?: StudioJob,
): Promise<string | null> => withAiSlot(job, () => runAiPromptInner(fullPrompt, model, timeoutSec, job));

const runAiPromptInner = async (
  fullPrompt: string,
  model: string,
  timeoutSec = 75,
  job?: StudioJob,
): Promise<string | null> => {
  // 1) Opus = Claude Code; if it fails, fall back to Gemini via AGY
  if (model.startsWith("claude-")) {
    // Opus viết JSON hoạt cảnh 7 cảnh + SVG có thể mất 8–12 phút → cho tối đa CLAUDE_TIMEOUT_SEC (mặc định 30 phút)
    const claudeTimeout = Math.max(timeoutSec + 120, Number(process.env.CLAUDE_TIMEOUT_SEC || 1800));
    const t0 = Date.now();
    const viaClaude = await runClaudePrompt(fullPrompt, model, claudeTimeout, job);
    if (isCancelled(job)) return null;
    if (viaClaude) {
      job?.logs.push(`[Claude Code] ${model} xong sau ${Math.round((Date.now() - t0) / 1000)}s`);
      return viaClaude;
    }
    const why = Date.now() - t0 >= claudeTimeout * 1000 - 2000 ? `quá ${claudeTimeout}s` : "lỗi";
    const msg = `[Claude Code] ${model} ${why} → fallback ${GEMINI_FALLBACK_MODEL}`;
    console.warn(msg);
    if (job) {
      job.logs.push(msg);
      job.step = `${model} ${why} → Gemini (${GEMINI_FALLBACK_MODEL}) đang làm thay…`;
    }
    return runAiPromptInner(fullPrompt, GEMINI_FALLBACK_MODEL, timeoutSec, job);
  }
  if (isCancelled(job)) return null;
  const bin = resolveAgyBin();
  try {
    const proc = Bun.spawn(
      [
        bin,
        "--print",
        fullPrompt,
        "--model",
        model,
        "--output-format",
        "json",
        "--print-timeout",
        `${timeoutSec}s`,
        "--disable-slash-commands",
        "--dangerously-skip-permissions",
      ],
      { cwd: REPO, stdout: "pipe", stderr: "pipe", stdin: "ignore" },
    );
    trackAiProc(proc, job);
    const [out, errOut] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const code = await proc.exited;
    if (/not recognized as a known model/.test(out + errOut) && model !== GEMINI_FALLBACK_MODEL) {
      return runAiPromptInner(fullPrompt, GEMINI_FALLBACK_MODEL, timeoutSec, job);
    }
    if (code !== 0 && !out.trim()) return null;
    let text = out.trim();
    try {
      const env = JSON.parse(text);
      if (env?.status === "ERROR") return null;
      if (typeof env?.response === "string") text = env.response.trim();
    } catch {
      /* raw output */
    }
    return text || null;
  } catch {
    return null;
  }
};

type ScriptOnlyResult = {
  caption: string;
  pinned: string;
  coverKicker?: string;
  coverLine1?: string;
  coverLine2?: string;
  scenes: GeneratedPlan["scenes"];
};

/**
 * Step 1: Scriptwriter — Claude Opus 5.5 via AGY (`claude-opus-5-5-medium`).
 * Step 2: Visual Director — same Opus model ("trùm cuối"). Gemini fallback only if SCRIPTWRITER_FALLBACK=1.
 */
const callAgyJson = async (
  prompt: string,
  job?: StudioJob,
  scriptwriterModel = process.env.SCRIPTWRITER_MODEL ||
    "claude-opus-5-5-medium",
  argonModel = process.env.AGY_MODEL || "gemini-4-argon-low",
  duration: StudioDuration = "medium",
  aspectRatio: StudioAspectRatio = "9:16",
  style: StudioStyle = "stickman",
  visualModel: string = VISUAL_MODEL,
): Promise<GeneratedPlan | null> => {
  const carbonModel = process.env.CARBON_MODEL || "gemini-4-carbon-low";
  // ── Word budget from real speaking rate (old fixed sentence counts gave ~7.9 min for "10 min") ──
  const targetMin = DURATION_MINUTES[duration] ?? 1.25;
  const targetWords = Math.round(targetMin * SPOKEN_WORDS_PER_MIN * (style === "spirit" ? 0.68 : 1));
  const targetSentences = Math.max(7, Math.round(targetWords / (style === "spirit" ? 12 : 18)));
  const shareSentences = targetMin >= 5 ? 4 : targetMin >= 2 ? 2 : 1;
  const perScene = Math.max(1, Math.round((targetSentences - shareSentences) / 6));
  const sentencesPerScene =
    perScene <= 1
      ? `1 câu văn súc tích cho MỖI phân cảnh (tổng cộng ${targetSentences} câu, khoảng ${targetWords} chữ, để video dài ${durationLabelOf(duration)})`
      : `khoảng ${perScene} câu văn hoàn chỉnh cho MỖI phân cảnh hook, problem, layer1, layer2, hardest, payoff (cảnh share ${shareSentences} câu); TỔNG CỘNG khoảng ${targetSentences} câu ≈ ${targetWords} chữ tiếng Việt để video dài ĐÚNG ${durationLabelOf(duration)} (giọng đọc ~${SPOKEN_WORDS_PER_MIN} chữ/phút)`;
  // Pick a story big enough for the length, so long videos stay one continuous narrative
  const storyFit =
    targetMin >= 12
      ? `\nCHỌN CÂU CHUYỆN VỪA VỚI ${targetMin} PHÚT (BẮT BUỘC): Video dài ${targetMin} phút cần một câu chuyện ĐỦ CHẤT LIỆU để kể liền mạch từ đầu đến cuối — chọn góc khai thác có dòng thời gian rõ ràng (trước → trong → sau), 2 đến 4 nhân vật xuyên suốt có mục tiêu và xung đột riêng, 3 đến 5 tình tiết/ca thực tế nối tiếp nhau, số liệu và mốc thời gian cụ thể. Mỗi hồi phải đẩy câu chuyện tiến thêm một bước (tình tiết mới, hệ quả mới, phát hiện mới) và có câu chuyển mạch nối sang hồi sau. TUYỆT ĐỐI KHÔNG độn chữ, không lặp lại ý đã nói, không liệt kê khô khan. Nếu chủ đề quá hẹp, hãy mở rộng sang bối cảnh lịch sử, so sánh quốc tế, các trường hợp tương tự và tác động tới đời sống người xem để đủ ${targetMin} phút.`
      : targetMin >= 5
        ? `\nCHỌN CÂU CHUYỆN VỪA VỚI ${targetMin} PHÚT: chọn góc kể có 2-3 nhân vật xuyên suốt và 2-3 tình tiết nối tiếp, mỗi hồi thêm một phát hiện mới, có câu chuyển mạch giữa các hồi, không độn chữ hay lặp ý.`
        : "";
  const scriptTimeoutSec = Math.round(240 + targetMin * 30);
  const hashtagGuide =
    aspectRatio === "16:9"
      ? "#kienthuc #giaima #xuhuong #trending #videodai #baihoccuocsong"
      : "#viral #xuhuong #trending #shorts #short #fyp #kienthuc";

  const scriptSys = `Bạn là Biên kịch Kể Chuyện (Storytelling Scriptwriter) chuyên nghiệp cho kênh video ${aspectRatio === "16:9" ? "dài màn ngang 16:9 chuyên sâu (YouTube / Facebook Watch)" : "Shorts/TikTok"} tiếng Việt.
Hãy xử lý thông minh dựa trên nội dung người dùng nhập vào:
- TRƯỜNG HỢP 1 (Người dùng chỉ nhập Ý TƯỞNG NGẮN / CHỦ ĐỀ 1-2 câu): Hãy xây dựng thành MỘT CÂU CHUYỆN XOAY QUANH NỘI DUNG CÓ BỐ CỤC RÕ RÀNG 7 HỒI (có nhân vật cụ thể trải nghiệm tình huống thực tế từ Mở đầu → Vướng vào vấn đề → Bóc tách cơ chế ngầm → Cao trào trả giá/bất ngờ → Lật mở sự thật cốt lõi → Bộ giải pháp hành động cụ thể → Đúc kết đắt giá). Độ dài yêu cầu: viết ${sentencesPerScene}.${storyFit}
- TRƯỜNG HỢP 2 (Người dùng dán NGUYÊN BÀI CONTENT / CỐT TRUYỆN CHI TIẾT): Hãy bám sát và truyền tải ĐẦY ĐỦ 100% nội dung, cốt truyện và số liệu người dùng đã cung cấp từ đầu tới cuối (chia mạch lạc theo bố cục 7 hồi: hook, problem, layer1, layer2, hardest, payoff, share).
QUY TẮC BẮT BUỘC:
1. Mỗi phần tử (mỗi câu) trong mảng của từng phân cảnh ${style === "spirit" ? "dài từ 5 đến 22 chữ tiếng Việt (xen câu rất ngắn ở đoạn căng)" : "phải dài từ 14 đến 22 chữ tiếng Việt"}. TUYỆT ĐỐI KHÔNG dùng dấu hai chấm (:) hay dấu gạch ngang (-, —, –). DÙNG dấu phẩy (,) ở chỗ người kể tự nhiên sẽ ngắt hơi (liệt kê, sau cụm mở đầu, trước "nhưng/mà/nên"): 1–3 dấu phẩy mỗi câu dài, giọng đọc AI sẽ ngắt đúng ở đó thay vì đọc một mạch.
2. Với độ dài hiện tại (${durationLabelOf(duration)} ≈ ${targetWords} chữ${style === "spirit" ? `; GIỚI HẠN CỨNG: TỔNG TOÀN BỘ kịch bản KHÔNG VƯỢT QUÁ ${Math.round(targetWords * 1.1)} chữ — tư liệu gốc dài thì CHỌN LỌC vài tình tiết rợn nhất, bỏ bớt, không kể hết` : ""}), mỗi phân cảnh (hook, problem, layer1, layer2, hardest, payoff) hãy viết mảng gồm nhiều câu nối tiếp nhau thành mạch chuyện rõ ràng, có con số, tình huống đời thực và ví dụ cụ thể đúng theo yêu cầu: ${sentencesPerScene}.
3. TIÊU ĐỀ & ẢNH BÌA PHẢI NÓI ĐÚNG NỘI DUNG CHÍNH: "caption" (dòng 1), "coverKicker", "coverLine1", "coverLine2" phải tóm đúng nhân vật/sự việc/hiện tượng trung tâm của TOÀN BỘ câu chuyện hoặc bài viết (ví dụ chuyện lục địa minh bị nghỉ xả hơi → tiêu đề nói về chuyện đó). TUYỆT ĐỐI KHÔNG lấy câu mở đầu, câu dẫn chuyện hay chi tiết phụ không liên quan làm tiêu đề, và không dùng tiêu đề chung chung kiểu "Sự thật về điều này".
4. Trả về DUY NHẤT 1 JSON object hợp lệ (không bọc markdown) gồm lời kịch bản theo đúng cấu trúc:
{
  "caption": "Tiêu đề hấp dẫn dòng 1\\n\\nMô tả chi tiết và ${hashtagGuide}",
  "pinned": "Câu hỏi tương tác ghim dưới bình luận 👇",
  "coverKicker": "Nhãn ngắn về chủ đề chính của chuyện (tối đa 18 ký tự, viết hoa)",
  "coverLine1": "Tiêu đề ảnh bìa dòng 1 (tối đa 14 ký tự, viết hoa)",
  "coverLine2": "Tiêu đề ảnh bìa dòng 2 (tối đa 12 ký tự, viết hoa)",
  "scenes": {
    "hook": ["Câu mở đầu gây tò mò từ 15 đến 21 chữ, có dấu phẩy ở chỗ ngắt hơi, không có hai chấm."],
    "problem": ["Câu nêu vấn đề hoặc nghịch lý thú vị dài khoảng 16 đến 21 chữ."],
    "layer1": ["Câu giải thích lớp thứ nhất hoặc tình huống đầu tiên dài khoảng 16 đến 21 chữ."],
    "layer2": ["Câu giải thích cao trào hoặc con số bất ngờ dài khoảng 16 đến 21 chữ."],
    "hardest": ["Câu lật ngược vấn đề hoặc giải thích cơ chế sâu nhất dài khoảng 16 đến 21 chữ."],
    "payoff": ["Câu kết luận đắt giá giải đáp toàn bộ câu hỏi ban đầu dài khoảng 16 đến 21 chữ."],
    "share": ["Hãy gửi ngay video này cho người bạn đang cần biết điều thú vị này nhé."]
  }
}${style === "stickman-explainer" ? EXPLAINER_PERSONA : ""}${style === "spirit" ? SPIRIT_PERSONA : ""}`;

  if (job) {
    job.step = `AI 1 (${scriptwriterModel}) đang sáng tác kịch bản…`;
    job.logs.push(`[Scriptwriter] Calling ${scriptwriterModel}...`);
  }

  let scriptObj: ScriptOnlyResult | null = null;
  const parseScript = (raw: string | null): ScriptOnlyResult | null => {
    if (!raw) return null;
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return null;
      const p = JSON.parse(m[0]) as ScriptOnlyResult;
      if (!p?.scenes?.hook?.length) return null;
      return p;
    } catch {
      return null;
    }
  };

  // 1) Try Claude Opus 5.5 first for scriptwriting
  scriptObj = parseScript(
    await runAgyPrompt(
      `${scriptSys}\n\nNỘI DUNG YÊU CẦU:\n${prompt}`,
      scriptwriterModel,
      scriptTimeoutSec,
      job,
    ),
  );

  // Fallback đã tắt theo yêu cầu: chỉ dùng Opus 5.5 medium (bật lại bằng SCRIPTWRITER_FALLBACK=1)
  const allowFallback = process.env.SCRIPTWRITER_FALLBACK === "1";
  if (!scriptObj && job) {
    job.logs.push(`[Scriptwriter] ${scriptwriterModel} failed (fallback disabled)`);
  }

  // 2) Fallback #1: Gemini 4.0 Carbon if Opus 5.5 fails
  if (allowFallback && !scriptObj && scriptwriterModel !== carbonModel) {
    if (job) {
      job.step = `Opus 5.5 bận/lỗi → Fallback sang Gemini 4.0 Carbon (${carbonModel}) viết kịch bản…`;
      job.logs.push(`[Scriptwriter] Fallback to ${carbonModel}...`);
    }
    scriptObj = parseScript(
      await runAgyPrompt(
        `${scriptSys}\n\nNỘI DUNG YÊU CẦU:\n${prompt}`,
        carbonModel,
        scriptTimeoutSec + 15,
      ),
    );
  }

  // 3) Fallback #2: Gemini 4.0 Argon ONLY if Carbon also fails
  if (allowFallback && !scriptObj && scriptwriterModel !== argonModel && carbonModel !== argonModel) {
    if (job) {
      job.step = `Gemini 4.0 Carbon lỗi → Fallback xuống Gemini 4.0 Argon (${argonModel}) viết kịch bản…`;
      job.logs.push(`[Scriptwriter] Carbon failed -> Fallback to ${argonModel}...`);
    }
    scriptObj = parseScript(
      await runAgyPrompt(
        `${scriptSys}\n\nNỘI DUNG YÊU CẦU:\n${prompt}`,
        argonModel,
        scriptTimeoutSec,
      ),
    );
  }

  if (!scriptObj) return null;

  // Explainer style: visuals come from directExplainer (AI backgrounds), not the SVG stage director.
  if (style === "stickman-explainer") {
    const fbPlan = buildFallbackPlan(prompt);
    return {
      ...fbPlan,
      caption: scriptObj.caption || fbPlan.caption,
      pinned: scriptObj.pinned || fbPlan.pinned,
      scenes: scriptObj.scenes,
    };
  }

  // 3) Gemini 4.0 Argon handles all visual direction, stats, cover titles, and chart parameters
  const vis = await designVisualsFromScenes(
    scriptObj.scenes,
    prompt,
    job,
    visualModel,
    style,
  );
  const fb = buildFallbackPlan(prompt);
  // The scriptwriter read the whole story: its cover title wins over the visual director's guess.
  const cleanCover = (s?: string) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().toUpperCase() : "");
  const scriptCover =
    cleanCover(scriptObj.coverLine1) && cleanCover(scriptObj.coverLine2)
      ? {
          coverKicker: cleanCover(scriptObj.coverKicker) || vis.coverKicker || fb.coverKicker,
          coverLine1: cleanCover(scriptObj.coverLine1),
          coverLine2: cleanCover(scriptObj.coverLine2),
        }
      : {};

  return {
    ...fb,
    ...vis,
    ...scriptCover,
    caption: scriptObj.caption || fb.caption,
    pinned: scriptObj.pinned || fb.pinned,
    scenes: scriptObj.scenes,
  };
};

const POSE_SET = new Set(["stand","walk","run","wave","point","explain","think","jump","cheer","dance","shrug","sit","tired","present_check","drive","sit_eat","sit_type","climb","analyze","carry","read_book","write_note","check_phone","reach","slump","crouch_inspect","step_back","kick_ball","dribble_ball","cook_toss","lift_weight","boxing_punch","sword_slash","sword_parry","bow_respect","kneel_pray","phone_call","laugh_belly"]);
const MOOD_SET = new Set(["happy","shock","serious","sad","cool","idea","celebrate","confused","scheming"]);
const PROP_SET = new Set(["none","phone","money","coffee","laptop","chart","question","bulb","peach","scroll","fan","sword","checklist","magnifier","pointer","gold","bowl","wheel","book","notebook","megaphone","soccer_ball","frying_pan","dumbbell","microphone","trophy","soda_can","water_bottle"]);
const MOVE_SET = new Set(["stay","forward","back","left","right","near","far"]);
const STORY_SFX_IDS = new Set(["stinger","footsteps","knock","creak","scream","howl","owl","bell","whisper","heartbeat","thud"]);
const STORY_AMB_IDS = new Set(["crickets","rain","wind","clock","none"]);

/** Keep only known values so a creative AI answer can never break the render. */
const sanitizeLineBeats = (raw: unknown): StickmanSceneAct["lineBeats"] => {
  if (!Array.isArray(raw)) return undefined;
  const one = (c: any) => {
    if (!c || typeof c !== "object") return undefined;
    const o: Record<string, unknown> = {};
    if (POSE_SET.has(c.pose)) o.pose = c.pose;
    if (MOOD_SET.has(c.mood)) o.mood = c.mood;
    if (PROP_SET.has(c.prop)) o.prop = c.prop;
    if (MOVE_SET.has(c.move)) o.move = c.move;
    if (c.shake === true) o.shake = true;
    if (c.hidden === true) o.hidden = true;
    if (c.speak === true) o.speak = true;
    return Object.keys(o).length ? o : undefined;
  };
  return raw.slice(0, 40).map((b: any) => ({
    left: one(b?.left),
    right: one(b?.right),
    third: one(b?.third),
    ...(typeof b?.sfx === "string" && STORY_SFX_IDS.has(b.sfx) ? { sfx: b.sfx, sfxPause: Math.min(3, Math.max(0, Number(b.sfxPause) || 0)) } : {}),
    ...(["push", "medium_left", "medium_right", "medium_center", "closeup_left", "closeup_right", "closeup_center"].includes(b?.camera) ? { camera: b.camera } : {}),
    ...(Number.isFinite(Number(b?.tension)) && Number(b.tension) > 0 ? { tension: Math.min(3, Math.round(Number(b.tension))) } : {}),
    ...(typeof b?.card === "string" && b.card.trim() ? { card: b.card.trim().slice(0, 40) } : {}),
    ...(typeof b?.ambience === "string" && STORY_AMB_IDS.has(b.ambience) ? { ambience: b.ambience } : {}),
    ...(Array.isArray(b?.note?.lines) && b.note.lines.length
      ? {
          note: {
            ...(typeof b.note.title === "string" ? { title: b.note.title.slice(0, 40) } : {}),
            ...(typeof b.note.date === "string" ? { date: b.note.date.slice(0, 30) } : {}),
            lines: b.note.lines.map((l: unknown) => String(l).slice(0, 60)).slice(0, 6),
          },
        }
      : {}),
  })) as any;
};

const noAoDai = (o: any): any => (o === "ao_dai" ? "ao_ba_ba" : o);

const AGES = new Set(["child", "teen", "adult", "elder"]);
const pickAgeGender = (p: any) => {
  const o: Record<string, string> = {};
  for (const side of ["left", "right", "third"]) {
    if (AGES.has(p?.[`${side}Age`])) o[`${side}Age`] = p[`${side}Age`];
    if (p?.[`${side}Gender`] === "m" || p?.[`${side}Gender`] === "f") o[`${side}Gender`] = p[`${side}Gender`];
  }
  return o;
};

const AGE_GENDER_RULE = `TUỔI & GIỚI TÍNH NHÂN VẬT: trong mỗi phần tử "stickmanActs" thêm "leftAge" | "rightAge" | "thirdAge": child | teen | adult | elder và "leftGender" | "rightGender" | "thirdGender": m | f — đúng với vai (bác sĩ nữ, chị, cô → f; ông bà → elder; con nhỏ → child). Cùng một vai giữ nguyên tuổi/giới tính ở mọi phân cảnh.`;
const LINE_BEATS_RULES = `TUỔI & GIỚI TÍNH NHÂN VẬT: trong mỗi phần tử "stickmanActs" thêm "leftAge" | "rightAge" | "thirdAge": child | teen | adult | elder và "leftGender" | "rightGender" | "thirdGender": m | f — đúng với vai (ông bà → elder, má/ba → adult, con nhỏ → child; nữ có búi tóc/bím tóc). Cùng một vai giữ nguyên tuổi/giới tính ở mọi phân cảnh.

BỔ SUNG BẮT BUỘC — DIỄN XUẤT THEO TỪNG CÂU ("lineBeats"):
Trong MỖI phần tử của "stickmanActs", thêm mảng "lineBeats" có ĐÚNG số phần tử bằng số câu của phân cảnh đó (câu thứ i → lineBeats[i]).
Mỗi phần tử: {"left": {...}, "right": {...}, "third": {...}} (bỏ nhân vật không có mặt). Mỗi nhân vật:
- "pose": ${[...POSE_SET].join(" | ")}
- "mood": ${[...MOOD_SET].join(" | ")}
- "prop": ${[...PROP_SET].join(" | ")} (chỉ khi câu đó nhắc tới/cần đồ vật; còn lại bỏ trống)
- "move": stay | forward | back | left | right (bước tới/lùi/sang ngang — nhân vật tự đi bộ tới vị trí mới)
- "shake": true khi run sợ / lạnh gáy / giật mình
Nguyên tắc: hành động phải KHỚP NGHĨA câu đang đọc (kể chuyện đi đường → walk/move; nghe tiếng động → shock + step_back; suy nghĩ → think; giải thích → explain/point; buồn → slump/sad…), KHÔNG lặp một tư thế quá 2 câu liền, nhân vật không nói thì vẫn phản ứng (gật, nhìn, giật mình). Câu chuyện phải "diễn" liên tục, người xem tắt tiếng vẫn hiểu.
`;

const SPIRIT_VISUAL_RULES = `
PHONG CÁCH "GIẢI MÃ TÂM LINH":
- KHÔNG CẦN VẼ SVG: phong cách này ẩn khung minh họa — để "customSvg": "" và "customSvgBeats": [] ở mọi phân cảnh (bối cảnh do ảnh nền AI đảm nhận). Dồn công sức vào nhân vật và "lineBeats".
- bgTheme: hook/problem/layer1 "night_street" hoặc "dramatic_dark"; layer2/hardest/payoff "indoor_warm" (vẫn trong nhà/làng của truyện).
- KHÔNG BAO GIỜ đặt 2 nhân vật đứng hai bên sân khấu làm "hình nền" chính, nhất là ở phân cảnh mở đầu (hook). Mặc định mỗi phân cảnh "mode": "solo" (1 nhân vật đang được kể, đặt ở giữa); hook có thể chỉ có cảnh nền không người. Chỉ dùng "duo" ở những câu truyện thật sự có 2 người ở cạnh nhau (và khi đó họ đứng sát nhau).
- DIỄN THEO TRUYỆN, KHÔNG ĐỐI ĐÁP: đây KHÔNG phải 2 người đứng nói chuyện qua lại. Lời là của NGƯỜI KỂ (giọng đọc); nhân vật DIỄN đúng hành động câu đang kể (đi ra vườn → walk + move; cúi nhìn mộ → crouch_inspect; nghe tiếng động → step_back + shock + shake; ngồi hiên → sit; sợ hãi → slump/shake…).
  · "hidden": true cho nhân vật KHÔNG có mặt ở câu đó (họ mờ ra khỏi sân khấu, quay lại khi truyện nhắc tới). Chỉ nhân vật đang được kể mới đứng trên sân khấu — nhiều câu chỉ có 1 người.
  · "speak": true CHỈ ở câu thoại trực tiếp của chính nhân vật đó (câu bắt đầu bằng {Tên vai} trong kịch bản); các câu khác nhân vật không nhép miệng.
  · "dialogues" để chuỗi rỗng — không có bong bóng thoại.
  · KHÔNG dùng "shake" (không rung lắc) và KHÔNG dùng pose "step_back": sợ hãi thể hiện bằng nét mặt (mood shock/sad), thân người đứng yên. TUYỆT ĐỐI KHÔNG dùng pose think / slump / crouch_inspect / analyze (tay đặt lên mặt, cằm, trán) trừ khi truyện nói rõ nhân vật đang suy nghĩ, ôm đầu hay cúi xuống xem xét thứ gì. Mọi di chuyển là ĐI BỘ từ điểm A tới điểm B (mặt hướng về đích): "move" left/right (ngang), "near" (đi lại gần, về phía người xem), "far" (đi ra xa, vào sâu trong cảnh); "back"/"forward" chỉ là đổi chỗ ngang.
  · NHỊP CHẬM, TỪ TỐN: mọi hành động chậm rãi, điềm đạm. CHỈ đổi chỗ ("move") khi truyện NÓI RÕ nhân vật đi/đến/lùi/ra cửa/vào nhà; không đi qua đi lại vô nghĩa, không đổi pose liên tục. Nhân vật chỉ đang nghe thì đứng yên, không đổi pose lung tung.
  · CẢNH KHÔNG CÓ NGƯỜI: câu tả khung cảnh, không khí, thời gian, thư từ / tin nhắn / bài viết, tiếng động, hoặc việc xảy ra ở nơi nhân vật không có mặt thì đặt "hidden": true cho TẤT CẢ nhân vật ở câu đó, để bối cảnh (hoặc tờ "note") đứng một mình. KHÔNG bắt nhân vật xuất hiện ở mọi câu.
  · KHÔNG DI CHUYỂN VÔ NGHĨA: nhân vật KHÔNG đi lại, bước tới bước lui, quay qua quay lại khi truyện không nói. Đứng yên là mặc định; chỉ khi truyện nói "đi vào / bước ra / chạy tới / lại gần" mới dùng "move".
  · ĐỒ VẬT & ĐIỆN THOẠI: tay không là mặc định. Chỉ cầm vật khi CÂU ĐÓ nói tới vật ấy. Nói chuyện điện thoại / gọi / nghe máy → pose "phone_call" (điện thoại áp lên TAI), không cầm điện thoại giơ ra trước. Xem điện thoại / đọc tin nhắn → pose "check_phone". Không có vật vô cớ trên tay.
  · HAI NGƯỜI NÓI CHUYỆN PHẢI Ở GẦN NHAU: khi có đối thoại giữa 2 nhân vật (câu {Tên vai}, hoặc người kể đang kể việc họ trò chuyện), cả hai phải cùng có mặt (không hidden), đứng SÁT cạnh nhau, quay mặt vào nhau — dùng "move": "near" cho người đứng xa để lại gần TRƯỚC khi nói. TUYỆT ĐỐI không để một người đi ngang qua mặt người kia hoặc đứng cách xa nói vọng.
  · HÀNH ĐỘNG SÁT NỘI DUNG TRUYỆN: mỗi câu diễn đúng việc câu đó kể, không thêm hành động truyện không nhắc. Thắp hương/chắp tay vái đứng → "bow_respect"; QUỲ LẠY / quỳ xin / dập đầu / ngồi bái → pose "kneel_pray" (quỳ gối, chắp tay, cúi lạy chậm); ngồi (hiên, ghế, giường, đất) → "sit". KHÔNG dùng "kneel_pray" nếu truyện không nhắc quỳ/lạy.
- GIẤY TỜ VIẾT TAY: nếu truyện có di chúc, lá thư, bài thơ/văn thơ để lại, tờ giấy ghi chú, bùa chú viết trên giấy… thì ở (các) câu người kể đọc nội dung đó, thêm vào lineBeats "note": {"date": "Rằm tháng Bảy, 1980" (nếu có), "title": "Út ơi." (lời mở đầu, nếu có), "lines": ["dòng 1", "dòng 2", …]} — tối đa 6 dòng ngắn, đúng lời trong truyện (không bịa thêm); màn hình hiện tờ giấy viết tay, các dòng hiện dần theo giọng đọc. Lặp lại cùng "note" cho các câu liền nhau đang đọc tờ giấy.
- THỜI ĐẠI: MẶC ĐỊNH là làng quê thời xưa ("xưa") — chỉ chọn "cũ"/"nay" khi truyện nói rõ có điện, xe máy, điện thoại… Xác định truyện xảy ra thời nào (ngày xưa / thời ông bà, chưa có điện → "xưa"; thập niên 70–90 ở quê → "cũ"; hiện nay → "nay") và giữ nhất quán.
- TRANG PHỤC theo thời đại (leftOutfit/rightOutfit): truyện "xưa"/"cũ" → "ao_ba_ba" (áo bà ba, cả nam lẫn nữ, kể cả đám giỗ/lễ — TUYỆT ĐỐI KHÔNG dùng "ao_dai": hình váy dài bị lỗi), "ao_the" + leftHat/rightHat "khan_dong" (ông cụ, chức sắc làng); nón lá "non_la" khi ra đồng/đi đường. Truyện "nay" → "office_shirt", "hoodie". leftAccessory "none". KHÔNG dùng "suit"/"necktie"/"doctor_coat" trong truyện tâm linh.
- TUỔI: luôn ghi leftAge/rightAge/thirdAge đúng vai (ông bà, cụ → elder: tóc bạc, râu, lưng còng; con nít → child: nhỏ hẳn; thanh niên → teen) và Gender (nữ có tóc dài).
- ĐỒ CẦM TAY: mặc định TAY KHÔNG. Chỉ đặt "prop" trong lineBeats ở đúng câu mà cốt truyện nhắc nhân vật cầm/dùng vật gì (cầm sách, cầm điện thoại gọi…); không đặt leftProp/rightProp/leftCustomPropSvg cho cả phân cảnh. Hành động thể hiện bằng "pose"/"move"/"shake" theo diễn biến truyện.
- BIỂU CẢM: TUYỆT ĐỐI không dùng mood "happy", "cool", "celebrate" trong phần kể chuyện; dùng serious, sad, shock, confused, scheming. Không pose cheer/dance/laugh_belly.
- TIẾNG MÔI TRƯỜNG theo cảnh (lineBeats "ambience", đặt ở câu MỞ ĐẦU mỗi cảnh, giữ tới khi đổi): crickets (vườn/ruộng/sân ban đêm) | rain (trời mưa) | wind (CHỈ khi truyện nói có gió/bão) | clock (trong nhà đêm khuya, tĩnh lặng) | none (yên lặng). Không phải cảnh nào cũng có gió.
- TIẾNG ĐỘNG THẬT (chỉ thêm vào lineBeats ở câu thật sự cần, tối đa ~1 tiếng / 5 câu): "sfx": stinger | footsteps | knock | creak | scream | howl | owl | bell | whisper | heartbeat | thud, và "sfxPause": số giây GIỌNG ĐỌC IM LẶNG sau câu đó để tiếng động vang một mình (1.5–2.5 cho footsteps/clatter/knock/creak/whisper ở đoạn rợn; 0 nếu chỉ lót nhẹ dưới giọng). Câu ngay trước khoảng lặng nên kết thúc lửng ("…rồi từ ngoài vườn vọng lại").
- MÁY QUAY & KHÔNG KHÍ (thêm vào lineBeats): "camera": medium_left | medium_right | medium_center (trung cảnh, khi tập trung vào 1 người), closeup_left | closeup_right | closeup_center (cận cảnh, câu cảm xúc/giật mình), push (đẩy máy chậm ở đoạn căng dần); bỏ trống = toàn cảnh. NHỊP CẮT KIỂU PHIM HOẠT HÌNH KỂ CHUYỆN: câu ĐẦU của mỗi địa điểm/phân cảnh để TOÀN CẢNH (cho người xem thấy cả căn phòng, bàn thờ, sân, các nhân vật), rồi CẮT THẲNG (không trượt, không zoom dần) vào TRUNG CẢNH / CẬN CẢNH người đang nói hoặc đang được kể tới; giữ mỗi cỡ cảnh 3–6 giây (2–3 câu) rồi mới đổi; chỉ đổi cỡ cảnh khi sang người khác hoặc sang ý khác, không đổi mỗi câu; cận cảnh dành cho câu cảm xúc, lời thoại quan trọng, lúc giật mình; "push" rất hiếm (tối đa 1 lần/phân cảnh); phía camera PHẢI trùng phía nhân vật đang được kể; "tension": 0–3 tăng dần khi truyện rợn hơn (cảnh đời thường 0, điềm báo 1, có chuyện lạ 2, cao trào 3; phần giải mã về 0); "card": thẻ thời gian/địa điểm ngắn khi truyện chuyển mốc ("Rằm tháng Bảy – 2022", "Ba năm sau"), tối đa 1 thẻ mỗi phân cảnh.
- BỐI CẢNH CỐ ĐỊNH: giữ cùng một nơi trong nhiều câu liền (như sân khấu kịch), nhân vật đi ra đi vào; chỉ đổi nơi khi truyện thật sự chuyển cảnh.
- Nhân vật: CHỈ người trong truyện (dân làng, cô dì, ông bà…), KHÔNG có nhân vật "Chuyên gia" hay người mặc vest. Phần giải mã do người kể nói bằng giọng đọc; trên sân khấu các nhân vật trong truyện minh họa đúng điều đang được giải thích (dì Út nằm/ngồi cứng đơ khi nói về bóng đè; mọi người ngồi lại bình tĩnh khi nói về cách phòng tránh). Diễn xuất điềm tĩnh, ít động tác, chậm rãi; nửa sau calm: think, sit, slump nhẹ.
`;

const designVisualsFromScenes = async (
  scenes: GeneratedPlan["scenes"],
  prompt: string,
  job?: StudioJob,
  argonModel = VISUAL_MODEL,
  style?: StudioStyle,
): Promise<Partial<GeneratedPlan>> => {
  if (job) {
    job.step = `AGY ${argonModel} (trùm cuối) đang thiết kế nhân vật, đồ vật & bối cảnh theo từng câu kịch bản…`;
    job.progress = 30;
    job.logs.push(
      `[Visual Director] Calling ${argonModel} for script-driven visual parameters...`,
    );
  }

  const visualSys = `Bạn là Đạo diễn Hình ảnh & Hoạt hình Người Que (Visual Director) cho hệ thống Remotion shorts-kit.
Dựa trên kịch bản 7 phân cảnh dưới đây, hãy SÁNG TẠO MỚI HOÀN TOÀN hình ảnh minh họa vector ("customSvg"), nhân vật (1, 2, 3 hoặc 4 người que) và bối cảnh ("bgTheme") bám sát 100% nội dung từng câu thoại!
TUYỆT ĐỐI KHÔNG lấy lại các phòng mẫu cũ nhàm chán (như phòng họp chung chung, bảng flipchart cũ, bàn thư viện cũ). Mỗi phân cảnh trong 7 cảnh PHẢI có một hình vẽ "customSvg" hoàn toàn mới và khác biệt nhau!

QUY TẮC SÁNG TẠO HÌNH ẢNH MỚI THEO KỊCH BẢN:
1. "setting": Mặc định chọn "custom_scene" cho tất cả các phân cảnh để hệ thống dựng sân khấu mới hoàn toàn theo "customSvg" và "bgTheme"! (Chỉ dùng "street_vendor", "sidewalk_tea" khi cảnh thực sự là xe đẩy bán hàng rong, hoặc "race_track" khi cảnh thực sự là đường đua xe tốc độ cao).
2. "bgTheme" (Bầu không khí ánh sáng nền cho từng cảnh — hãy đổi linh hoạt qua 7 cảnh):
   - "night_street" (Phố đêm kịch tính / Đèn đường)
   - "city_day" (Đô thị ban ngày / Nhà cao tầng / Đường phố)
   - "indoor_warm" (Không gian ấm cúng / Gia đình / Quán / Đọc sách)
   - "indoor_modern" (Không gian hiện đại / Phân tích / Công nghệ)
   - "dramatic_dark" (Không gian tối cao trào / Tâm lý / Nghịch lý / Cảnh báo)
   - "hospital_clean" (Không gian sáng y tế / Bệnh viện / Cấp cứu)
   - "nature_outdoor" (Không gian ngoài trời thoáng đãng)
   - "luxury_gold" (Không gian tài sản / Kho bạc / Sang trọng)
3. "customSvg" VÀ "customSvgBeats" (BẮT BUỘC PHẢI CÓ Ở CẢ 7 PHÂN CẢNH — HÌNH VẼ 2D BIẾN ĐỔI LINH HOẠT THEO TỪNG CẶP CÂU THOẠI):
   - Với MỖI phân cảnh (hook, problem, layer1, layer2, hardest, payoff, share), ngoài "customSvg" đại diện cho mở đầu cảnh, bạn PHẢI tạo thêm mảng "customSvgBeats": [svgBeat1, svgBeat2, svgBeat3] (từ 2 đến 3 bức tranh SVG súc tích cho mỗi phân cảnh, mỗi bức ứng với 2–3 câu thoại tiếp theo trong phân cảnh đó) để hình minh họa ở giữa sân khấu thay đổi liên tục theo mạch kể chuyện, KHÔNG BAO GIỜ đứng yên hay lặp lại!
   - QUY TẮC NHÁY ĐƠN TRONG SVG (BẮT BUỘC ĐỂ KHÔNG VỠ JSON): Bên trong mọi chuỗi SVG ("customSvg", "customSvgBeats", "leftCustomPropSvg", "rightCustomPropSvg"), CHỈ ĐƯỢC DÙNG DẤU NHÁY ĐƠN '...' cho các thuộc tính XML (ví dụ: <rect x='-150' y='-180' fill='#1E293B'/>), TUYỆT ĐỐI KHÔNG dùng dấu nháy kép "..." bên trong chuỗi SVG!
   - CẤM TUYỆT ĐỐI VẼ "HÌNH VUÔNG VÔ TRI": Tuyệt đối KHÔNG vẽ các thẻ <rect> trống trơn chỉ có màu nền mà không có chi tiết bên trong! Mọi vật thể (cửa hàng, tòa nhà, hợp đồng, máy móc, thỏi vàng, điện thoại, bàn phím, ly nước, xe cộ) BẮT BUỘC phải được vẽ chi tiết bằng <polygon> (mái hiên, mũi tên, thỏi vàng), <circle> (đèn, bánh xe, đồng xu, kính lúp), <path>/<line> (dòng chữ, biểu đồ, dây xích) và <text> nhãn tiếng Việt rõ nghĩa.
   - Khung tranh hiển thị nằm ở trung tâm (tọa độ gốc (0, 0), vùng vẽ x từ -230 đến 230, y từ -275 đến -10).
   - QUY TẮC CHỐNG TRÀN CHỮ & CẤM CẮT CỤT TỪ (BẮT BUỘC):
     + Mỗi thẻ <text> chỉ viết cụm từ ngắn gọn 2–3 chữ TRỌN NGHĨA TIẾNG VIỆT (font-size 15 đến 18), tuyệt đối KHÔNG cắt cụt nửa câu kiểu "Chị Lan là hành" hay "Thế nhưng khi so"!
     + CẤM NHÉT CHỮ DÀI VÀO HÌNH TRÒN (<circle>): Mọi nhãn chữ từ 2 từ trở lên BẮT BUỘC đặt trong viên thuốc <rect rx='16' width='165' height='42' .../>.
   - Ví dụ:
     + Cảnh so sánh 2 thái cực (lương cao chật vật vs lương thấp ung dung, hoặc giá nhà cao vs túi tiền nhỏ) -> Vẽ 2 cụm đối lập rõ nét ở bên trái (x=-120) và bên phải (x=120), ở giữa có mũi tên / bàn cân / dấu VS và con số cụ thể từ kịch bản.
     + Cảnh nói về quy tắc / công thức / phép tính (4%, 25 lần, tiết kiệm 2.000đ vs chờ 60 phút) -> Vẽ bảng công thức trực quan, biểu đồ cột/tròn hoặc đồng hồ đếm giờ kèm nhãn số liệu thực tế trong câu thoại.
     + Cảnh nói về tâm lý / vòng xoay khoái lạc / nghiện Adrenaline -> Vẽ bánh xe hamster xoay tròn hoặc bộ não phát sáng kèm mũi tên vòng lặp và nhãn trạng thái tâm lý.
     + Cảnh nói về cây xăng / đường phố / bệnh viện / cửa hàng -> Vẽ trực diện trụ bơm xăng, hàng xe nối đuôi, biển báo hết hàng, xe cứu thương nháy đèn đúng như lời kể.
4. Bố cục nhân vật ("mode" — LINH HOẠT 1, 2, 3 HOẶC 4 NGƯỜI QUE THEO THOẠI):
   - "solo" (1 nhân vật), "duo" (2 nhân vật), "trio" (3 nhân vật: có thêm charThird), hoặc "crowd" (4 nhân vật).
5. Đạo cụ cầm tay ĐỘNG theo từng cảnh ("leftCustomPropSvg", "rightCustomPropSvg") + Thư viện chuẩn (leftProp, rightProp):
   - ƯU TIÊN SỐ 1 — AI TỰ VẼ ĐẠO CỤ CẦM TAY ĐỘNG ("leftCustomPropSvg", "rightCustomPropSvg"): Với mọi vật thể đặc trưng xuất hiện trong lời kể từng phân cảnh (ví dụ: lon nước ngọt Zero, bát đường, miếng bánh kem, viên thuốc/vi sinh, quả cam tươi, ly nước lọc, chìa khóa xe, biển số xe, thẻ căn cước/ngân hàng, sổ BHXH, hộp sữa, hóa đơn điện, chùm chìa khóa căn hộ...), HÃY TỰ VẼ thẻ SVG 2D sắc nét (tâm tại 0,0, tọa độ từ -22 đến 22, kết hợp từ 2-4 hình <path>/<polygon>/<circle>/<rect> có chi tiết rõ ràng, viền stroke='#111827' stroke-width='3') vào "leftCustomPropSvg" hoặc "rightCustomPropSvg" để đạo cụ trên tay nhân vật biến đổi linh hoạt 100% theo đúng mạch chuyện từng chặng!
   - Thư viện chuẩn có sẵn (dùng cho leftProp / rightProp khi nhân vật cầm công cụ phân tích phổ thông): "magnifier" (kính lúp), "chart" (bảng biểu đồ), "scroll" (bảng kẹp hồ sơ/hợp đồng), "money" (xấp tiền), "gold" (thỏi vàng), "phone" (điện thoại), "megaphone" (loa cảnh báo), "soda_can" (lon nước ngọt), "water_bottle" (chai nước lọc), "trophy" (cúp), "microphone" (mic), "fan" (quạt), "bowl" (CHỈ dùng cho tô phở/mì thực sự), "coffee" (CHỈ dùng cho ly trà sữa/cà phê thực sự).
6. Danh sách mũ đội đầu (leftHat, rightHat, thirdHat): Mặc định là "none" hoặc "cap". Dùng "non_la" cho Cô Bán Hàng Rong; "headband" cho Kiếm khách / Võ sĩ / Gymer; "chef_hat" cho Đầu bếp; "three_tuft" cho Cậu bé đầu 3 chõm; CHỈ dùng "tophat" khi là Đại Gia / Tỷ Phú; "crown", "scholar", "official".
7. Danh sách phụ kiện đeo cổ (leftAccessory, rightAccessory): Mặc định là "none" hoặc "necktie". CHỈ đeo "gold_chain" khi câu thoại nhắc trực tiếp tới Đại Gia / Nhà Giàu / Tỷ Phú!
8. Danh sách trang phục (leftOutfit, rightOutfit) & Hành động ("action"): Chọn trang phục chuẩn vai diễn ("suit" cho Chuyên gia/Giám đốc/Đại gia, "office_shirt" cho Dân công sở/Văn phòng, "hoodie" cho Người trẻ/Điềm đạm, "vendor_apron" cho Cô bán hàng, "doctor_coat" cho Bác sĩ, "uniform" cho Công an/CSGT/Trật tự, "royal_robe" cho Vua/Quan cổ trang, "martial_gi" cho Võ sư/Võ sĩ, "soccer_jersey" cho Cầu thủ, "chef_coat" cho Đầu bếp, "gym_tank" cho Gymer). "action" ưu tiên dùng "analyzing_board", "present_board", "compare_two", "relax_celebrate" để 2 nhân vật đối thoại tự nhiên (KHÔNG dùng "sword_duel" khi 2 nhân vật chỉ đang trò chuyện/giải thích kiến thức!).
9. "dialogues" & "speakers" — QUY TẮC GIAO TIẾP HƯỚNG VỀ NHAU (BẮT BUỘC):
   - Mảng câu thoại đối đáp nhập vai trực tiếp (5-8 chữ/câu) và mảng người nói ("left" | "right"), số lượng phần tử tương ứng với số câu thoại của phân cảnh đó (tối thiểu 2–6 câu đối đáp luân phiên để nhân vật tương tác sinh động xuyên suốt phân cảnh).
   - Khi có từ 2 nhân vật trở lên ("duo", "trio", "crowd"), nhân vật bên trái (charLeft) và bên phải (charRight) PHẢI luôn hướng mặt, ánh mắt và cử chỉ trực diện vào nhau để đối thoại tự nhiên (người nói hỏi/giải thích hướng về người nghe, người nghe nhìn thẳng vào người nói để phản hồi). Tuyệt đối KHÔNG để nhân vật quay ngang sang hướng vô định hoặc độc thoại lệch hướng!

Trả về DUY NHẤT 1 JSON object hợp lệ (không bọc markdown):
{
  "coverKicker": "CHỦ ĐỀ NGẮN (<=20 ký tự)",
  "coverLine1": "TIÊU ĐỀ DÒNG 1",
  "coverLine2": "TIÊU ĐỀ DÒNG 2",
  "chip1": "Nhãn ngắn cảnh 3 (<=20 ký tự)",
  "chip2": "Nhãn ngắn cảnh 5 (<=20 ký tự)",
  "headlineKicker": "ĐIỂM MẤU CHỐT",
  "headlineText": "Tối đa 4 chữ",
  "bar1Label": "Nhóm A",
  "bar1Value": 85,
  "bar2Label": "Nhóm B",
  "bar2Value": 25,
  "barUnit": "%",
  "stickBubble1": "Ủa thiệt hả?",
  "stickBubble2": "Chuẩn luôn!",
  "stickmanActs": [
    {"id": "hook", "setting": "custom_scene", "bgTheme": "city_day", "action": "analyzing_board", "mode": "duo", "charLeft": "Tên NV 1", "charRight": "Tên NV 2", "leftHat": "cap", "rightHat": "none", "leftProp": "phone", "rightProp": "magnifier", "customSvg": "<rect x='-195' y='-225' width='165' height='155' rx='16' fill='#1E293B' stroke='#38BDF8' stroke-width='4'/><polygon points='-175,-205 -50,-205 -42,-170 -183,-170' fill='#38BDF8' stroke='#111827' stroke-width='3'/><text x='-112' y='-182' text-anchor='middle' font-size='15' font-weight='900' fill='#0F172A'>GÓC NHÌN A</text><circle cx='0' cy='-148' r='24' fill='#FACC15' stroke='#111827' stroke-width='3.5'/><text x='0' y='-142' text-anchor='middle' font-size='16' font-weight='900' fill='#0F172A'>VS</text><rect x='30' y='-225' width='165' height='155' rx='16' fill='#1E293B' stroke='#EF4444' stroke-width='4'/><polygon points='50,-205 175,-205 183,-170 42,-170' fill='#EF4444' stroke='#111827' stroke-width='3'/><text x='112' y='-182' text-anchor='middle' font-size='15' font-weight='900' fill='#FFFFFF'>SỰ THẬT B</text>", "customSvgBeats": ["<rect x='-195' y='-225' width='165' height='155' rx='16' fill='#1E293B' stroke='#38BDF8' stroke-width='4'/><polygon points='-175,-205 -50,-205 -42,-170 -183,-170' fill='#38BDF8' stroke='#111827' stroke-width='3'/><text x='-112' y='-182' text-anchor='middle' font-size='15' font-weight='900' fill='#0F172A'>GÓC NHÌN A</text><circle cx='0' cy='-148' r='24' fill='#FACC15' stroke='#111827' stroke-width='3.5'/><text x='0' y='-142' text-anchor='middle' font-size='16' font-weight='900' fill='#0F172A'>VS</text><rect x='30' y='-225' width='165' height='155' rx='16' fill='#1E293B' stroke='#EF4444' stroke-width='4'/><polygon points='50,-205 175,-205 183,-170 42,-170' fill='#EF4444' stroke='#111827' stroke-width='3'/><text x='112' y='-182' text-anchor='middle' font-size='15' font-weight='900' fill='#FFFFFF'>SỰ THẬT B</text>", "<circle cx='-95' cy='-135' r='52' fill='#1E293B' stroke='#22C55E' stroke-width='4'/><text x='-95' y='-128' text-anchor='middle' font-size='18' font-weight='900' fill='#22C55E'>DỮ LIỆU 1</text><line x1='-35' y1='-135' x2='30' y2='-135' stroke='#FACC15' stroke-width='6'/><polygon points='28,-145 45,-135 28,-125' fill='#FACC15'/><circle cx='105' cy='-135' r='52' fill='#7F1D1D' stroke='#EF4444' stroke-width='4'/><text x='105' y='-128' text-anchor='middle' font-size='18' font-weight='900' fill='#FEF08A'>HỆ QUẢ 2</text>"], "badge": "CHẶNG 1 • MỞ ĐẦU", "title": "TIÊU ĐỀ CẢNH 1", "statLeft": "Thông số A", "statRight": "Thông số B", "progressValue": 30, "dialogues": ["Câu thoại tự nhiên 1", "Câu thoại đáp lại 2"], "speakers": ["left", "right"]}
  ]
}`;

  const visualFullPrompt = `${visualSys}\n\n${style === "spirit" ? LINE_BEATS_RULES + SPIRIT_VISUAL_RULES : AGE_GENDER_RULE}\n\nCHỦ ĐỀ / KỊCH BẢN GỐC: ${prompt.slice(0, 300)}\n\nKỊCH BẢN 7 PHÂN CẢNH:\n${JSON.stringify(scenes, null, 2)}`;
  let rawVisual = await runAgyPrompt(visualFullPrompt, argonModel, 600, job);
  const carbonFallback = process.env.CARBON_MODEL || "gemini-4-carbon-low";
  if (process.env.SCRIPTWRITER_FALLBACK === "1" && !rawVisual && argonModel !== carbonFallback) {
    if (job) {
      job.step = `${argonModel} bận/lỗi → Fallback sang Gemini 4.0 Carbon (${carbonFallback}) thiết kế đồ họa…`;
      job.logs.push(`[Visual Director] ${argonModel} failed -> Fallback to ${carbonFallback}...`);
    }
    rawVisual = await runAgyPrompt(visualFullPrompt, carbonFallback, 600);
  }
  let vis: Partial<GeneratedPlan> = {};
  if (rawVisual) {
    const cleaned = rawVisual
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        vis = JSON.parse(m[0]);
      } catch {
        // Auto-repair unescaped double quotes inside XML/SVG tags (e.g. <rect x="-10">)
        try {
          const repaired = m[0].replace(/<[^>]+>/g, (tag) =>
            tag.replace(/\\?"/g, "'"),
          );
          vis = JSON.parse(repaired);
        } catch (err) {
          if (job) {
            job.logs.push(
              `[Visual Director] JSON parse fallback triggered: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }
  }
  return vis;
};

const buildFallbackPlan = (prompt: string): GeneratedPlan => {
  const rawLines = prompt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const topic = rawLines[0]?.slice(0, 60) || "Bí mật thú vị ít người biết";
  const shortWords = topic.split(/\s+/).slice(0, 4).join(" ").toUpperCase();
  // No AI available: cover title = the topic/title line itself, split over the two cover lines (not a generic tail).
  const titleWords = topic.replace(/[.!?…]+$/, "").split(/\s+/).filter(Boolean).slice(0, 6);
  const half = Math.ceil(titleWords.length / 2);
  const coverTitle1 = titleWords.length >= 2 ? titleWords.slice(0, half).join(" ").toUpperCase().slice(0, 18) : "";
  const coverTitle2 = titleWords.length >= 2 ? titleWords.slice(half).join(" ").toUpperCase().slice(0, 16) : "";

  // Split either by lines or by sentences (. ! ?) so pasting a long paragraph or multi-line script keeps 100% of the content
  const sentences = rawLines
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

  if (sentences.length >= 4) {
    const keys = [
      "hook",
      "problem",
      "layer1",
      "layer2",
      "hardest",
      "payoff",
      "share",
    ] as const;
    const buckets: Record<(typeof keys)[number], string[]> = {
      hook: [],
      problem: [],
      layer1: [],
      layer2: [],
      hardest: [],
      payoff: [],
      share: [],
    };
    sentences.forEach((sent, idx) => {
      const bIdx = Math.min(
        keys.length - 1,
        Math.floor((idx * keys.length) / sentences.length),
      );
      buckets[keys[bIdx]].push(sanitizeSpoken(sent));
    });
    // Ensure every scene bucket has at least 1 line so Remotion timing never has an empty scene
    const defaults: Record<(typeof keys)[number], string> = {
      hook: `Câu chuyện về ${topic} ẩn chứa nhiều điều bất ngờ.`,
      problem: "Nhìn thoáng qua tưởng đơn giản nhưng thực tế lại rất thú vị.",
      layer1: "Hãy cùng xem xét yếu tố quan trọng đầu tiên ngay sau đây.",
      layer2: "Những con số thực tế cho thấy sự khác biệt vô cùng rõ rệt.",
      hardest:
        "Đây chính là mắt xích quan trọng nhất quyết định toàn bộ vấn đề.",
      payoff:
        "Hiểu rõ điều này giúp chúng ta có góc nhìn toàn diện và chính xác hơn.",
      share: "Hãy chia sẻ ngay video này cho bạn bè cùng biết nhé.",
    };
    for (const k of keys) {
      if (buckets[k].length === 0) buckets[k].push(sanitizeSpoken(defaults[k]));
    }
    return {
      coverKicker: "KHÁM PHÁ THÚ VỊ",
      coverLine1: coverTitle1 || shortWords.slice(0, 18) || "SỰ THẬT VỀ",
      coverLine2: coverTitle2 || "ĐIỀU NÀY?",
      chip1: "Phân tích thực tế",
      chip2: "Kết quả bất ngờ",
      headlineKicker: "ĐIỂM ĐÁNG CHÚ Ý",
      headlineText: "Sự thật bất ngờ",
      bar1Label: "Mức độ tác động",
      bar1Value: 85,
      bar2Label: "Mức thông thường",
      bar2Value: 30,
      barUnit: "%",
      stickBubble1: "Thiệt hả trời?",
      stickBubble2: "Giờ mới biết!",
      caption: `${topic}\n\n#viral #xuhuong #trending #shorts #short #fyp #kienthuc #khampha`,
      pinned: "Bạn nghĩ sao về điều này? Bình luận ngay bên dưới nhé! 👇",
      scenes: buckets,
    };
  }

  return {
    coverKicker: "GÓC GIẢI MÃ",
    coverLine1: coverTitle1 || shortWords.slice(0, 18) || "VÌ SAO LẠI",
    coverLine2: coverTitle2 || "THẾ NÀY?",
    chip1: "Nguyên nhân cốt lõi",
    chip2: "Tác động thực tế",
    headlineKicker: "ĐIỂM MẤU CHỐT",
    headlineText: "Gấp 3 lần",
    bar1Label: "Thực tế ghi nhận",
    bar1Value: 90,
    bar2Label: "Mức trung bình",
    bar2Value: 30,
    barUnit: "%",
    stickBubble1: "Sao lạ vậy?",
    stickBubble2: "Quá chuẩn luôn!",
    caption: `${topic} — Sự thật thú vị có thể bạn chưa từng nghe!\n\n#viral #xuhuong #trending #shorts #short #fyp #kienthuc`,
    pinned:
      "Theo bạn điều này có đúng với thực tế không? Để lại bình luận bên dưới nhé! 👇",
    scenes: {
      hook: [
        sanitizeSpoken(
          `Nhiều người vẫn luôn thắc mắc xoay quanh chủ đề ${topic} nhưng rất ít ai biết câu trả lời thật sự.`,
        ),
      ],
      problem: [
        sanitizeSpoken(
          "Nhìn bề ngoài mọi thứ có vẻ rất bình thường nhưng bên trong lại ẩn chứa một quy luật vô cùng thú vị.",
        ),
      ],
      layer1: [
        sanitizeSpoken(
          "Yếu tố đầu tiên bắt nguồn từ chính thói quen và môi trường vận hành liên tục xung quanh chúng ta mỗi ngày.",
        ),
      ],
      layer2: [
        sanitizeSpoken(
          "Khi đặt lên bàn cân so sánh mức độ chênh lệch có thể tăng vọt lên gấp ba lần chỉ trong thời gian ngắn.",
        ),
      ],
      hardest: [
        sanitizeSpoken(
          "Điều bất ngờ nhất là cơ chế tự cân bằng sẽ lập tức kích hoạt ngay khi vượt qua ngưỡng giới hạn ban đầu.",
        ),
      ],
      payoff: [
        sanitizeSpoken(
          `Nhờ sự kết hợp nhịp nhàng đó mà hiện tượng trong chủ đề ${topic} mới diễn ra đúng như những gì ta thấy.`,
        ),
      ],
      share: [
        sanitizeSpoken(
          "Hãy chia sẻ ngay video này cho người bạn nào cũng đang tò mò về câu chuyện này nhé.",
        ),
      ],
    },
  };
};

const buildDefaultStickmanActs = (plan: GeneratedPlan, soloDefault = false): StickmanSceneAct[] => {
  const fullText = Object.values(plan.scenes).flat().join(" ").toLowerCase();
  const isStreetVendorOrMarket =
    /hàng rong|vỉa hè|xe đẩy|bán xôi|hàng nước|trà đá|bánh mì|gánh hàng|chợ cóc|buôn gánh/.test(
      fullText,
    );
  const isAncientOrFolklore =
    /vua|trạng|chúa|triều đình|quan|cổ|xưa|đào trường thọ|hoàng thượng|bệ hạ/.test(
      fullText,
    );
  const isGoldOrMacro =
    /vàng|ounce|fed|lãi suất|ngân hàng trung ương|dự trữ|đô la|tài sản/.test(
      fullText,
    );
  const isCompanyOrJob =
    /công ty|tuyển dụng|thử việc|remote|lương|nhân sự|văn phòng|sếp|review|pivot/.test(
      fullText,
    );
  const isTechOrIt =
    /it|code|lập trình|kỹ sư|ai|phần mềm|máy tính|công nghệ|developer|junior|senior/.test(
      fullText,
    );
  const isTravelOrEv =
    /xe|vũng tàu|du lịch|cao tốc|sạc|km|vf|hành trình|biển/.test(fullText);
  const isFinance =
    /ngân hàng|tiền|lãi|kinh tế|giá|đầu tư|thu nhập|tăng trưởng/.test(fullText);

  const settings: StickmanSetting[] = isStreetVendorOrMarket
    ? [
        "street_vendor",
        "street_vendor",
        "sidewalk_tea",
        "street_vendor",
        "sidewalk_tea",
        "street_vendor",
        "street_vendor",
      ]
    : isAncientOrFolklore
      ? [
          "royal_palace",
          "peach_banquet",
          "imperial_garden",
          "imperial_court",
          "royal_palace",
          "peach_banquet",
          "ancient_village",
        ]
      : isGoldOrMacro
        ? [
            "mountain_chart",
            "gold_vault",
            "bank_finance",
            "fed_rate_room",
            "office_board",
            "gold_vault",
            "debugging_board",
          ]
        : isCompanyOrJob
          ? [
              "city_street",
              "interview_room",
              "remote_workspace",
              "coding_desk",
              "debugging_board",
              "office_board",
              "interview_room",
            ]
          : isTechOrIt
            ? [
                "city_street",
                "coding_desk",
                "office_board",
                "ai_server_lab",
                "debugging_board",
                "remote_workspace",
                "classroom_school",
              ]
            : isTravelOrEv
              ? [
                  "highway_ev",
                  "cafe_table",
                  "charging_station",
                  "toll_booth",
                  "hotel_room",
                  "seafood_diner",
                  "beach_sunset",
                ]
              : isFinance
                ? [
                    "mountain_chart",
                    "bank_finance",
                    "gold_vault",
                    "fed_rate_room",
                    "office_board",
                    "debugging_board",
                    "interview_room",
                  ]
                : [
                    "city_street",
                    "coding_desk",
                    "office_board",
                    "debugging_board",
                    "interview_room",
                    "remote_workspace",
                    "classroom_school",
                  ];

  const actions: StickmanAction[] = isAncientOrFolklore
    ? [
        "analyzing_board",
        "eating_drinking",
        "eating_drinking",
        "panic_run",
        "analyzing_board",
        "relax_celebrate",
        "relax_celebrate",
      ]
    : isGoldOrMacro
      ? [
          "analyzing_board",
          "carrying_load",
          "analyzing_board",
          "analyzing_board",
          "present_board",
          "carrying_load",
          "relax_celebrate",
        ]
      : isCompanyOrJob
        ? [
            "analyzing_board",
            "analyzing_board",
            "typing_desk",
            "typing_desk",
            "analyzing_board",
            "present_board",
            "relax_celebrate",
          ]
        : isTechOrIt
          ? [
              "analyzing_board",
              "typing_desk",
              "analyzing_board",
              "present_board",
              "analyzing_board",
              "typing_desk",
              "relax_celebrate",
            ]
          : isTravelOrEv
            ? [
                "driving_car",
                "eating_drinking",
                "charge_ev",
                "pass_toll",
                "check_bill",
                "eating_drinking",
                "relax_celebrate",
              ]
            : [
                "analyzing_board",
                "typing_desk",
                "present_board",
                "carrying_load",
                "analyzing_board",
                "present_board",
                "relax_celebrate",
              ];

  const sceneIds = [
    "hook",
    "problem",
    "layer1",
    "layer2",
    "hardest",
    "payoff",
    "share",
  ] as const;
  const badges = [
    "CẢNH 1 • MỞ ĐẦU",
    "CẢNH 2 • BÀI TOÁN",
    "CẢNH 3 • GÓC NHÌN 1",
    "CẢNH 4 • GÓC NHÌN 2",
    "CẢNH 5 • ĐIỂM MẤU CHỐT",
    "CẢNH 6 • KẾT QUẢ",
    "CẢNH 7 • LỜI KẾT",
  ];

  const DANGLING_VN_TAIL =
    /\b(là|và|hoặc|nhưng|mà|thì|khi|nếu|vì|do|bởi|để|của|cho|với|tại|trong|trên|dưới|từ|đến|tới|sang|vào|ra|lên|xuống|như|bằng|theo|về|giữa|cùng|rất|quá|lắm|hơi|đang|sẽ|đã|vẫn|còn|cũng|chỉ|mới|vừa|từng|không|chưa|chẳng|bị|được|phải|cần|nên|muốn|hãy|đừng|chớ|mỗi|mọi|các|những|một|hai|ba|sự|việc|cách|điều|người|nhà|hành|so|lại|ở)$/i;

  const stripDanglingTail = (words: string[], minWords: number): string[] => {
    const out = [...words];
    while (out.length > minWords && DANGLING_VN_TAIL.test(out[out.length - 1])) {
      out.pop();
    }
    return out;
  };

  const shortClause = (s: string) => {
    const cleaned = s.replace(/[""“”()]/g, "").trim();
    const firstClause = cleaned
      .split(/[.;!?–—]+|,\s+/)
      .map((c) => c.trim())
      .filter(Boolean)[0] || cleaned;
    const clauseWords = firstClause.split(/\s+/).filter(Boolean);
    if (clauseWords.length >= 4 && clauseWords.length <= 11) {
      return stripDanglingTail(clauseWords, 4).join(" ");
    }
    const allWords = cleaned
      .replace(/[.,!?;:—–-]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    if (allWords.length <= 10) return allWords.join(" ");
    const picked = stripDanglingTail(allWords.slice(0, 9), 5);
    return `${picked.join(" ")}…`;
  };

  return sceneIds.map((id, idx) => {
    const provided =
      plan.stickmanActs?.find((a) => a.id === id) ?? plan.stickmanActs?.[idx];
    const lines = plan.scenes[id] || [];
    const sceneText = lines.join(" ").toLowerCase();
    const defaultDialogues = lines.map((l) => shortClause(l));

    // Dynamically infer scene setting from this specific scene's spoken script lines if not explicitly provided
    let inferredSetting: StickmanSetting = settings[idx];
    if (
      /(đua xe|đường đua|tay đua|f1|motogp|siêu xe|vạch đích|pit stop|khúc cua|tốc độ cao)/.test(
        sceneText,
      )
    ) {
      inferredSetting = "race_track";
    } else if (
      /(hàng xôi.*hàng nước|sát bên cạnh|không bán trùng|hai hàng|xôi cạnh nước)/.test(
        sceneText,
      )
    ) {
      inferredSetting = "sidewalk_tea";
    } else if (
      /(hàng rong|xe đẩy|vỉa hè|gánh hàng|bán xôi|bán nước|quán cóc|sang nhượng|giữ chỗ)/.test(
        sceneText,
      )
    ) {
      inferredSetting = "street_vendor";
    } else if (
      /(tài liệu|đọc sách|nghiên cứu|nhà tâm lý|william bengen|năm 19\d\d|giáo trình)/.test(
        sceneText,
      )
    ) {
      inferredSetting = "library_study";
    } else if (
      /(siêu thị|mua sắm|sắm đồ|trung tâm thương mại)/.test(sceneText)
    ) {
      inferredSetting = "supermarket";
    } else if (/(cà phê|quán nước|ngồi uống)/.test(sceneText)) {
      inferredSetting = "cafe_table";
    } else if (/(nhà hàng|bàn ăn|quán ăn|hải sản)/.test(sceneText)) {
      inferredSetting = "seafood_diner";
    } else if (/(vàng|9999|kho dự trữ|thỏi vàng)/.test(sceneText)) {
      inferredSetting = "gold_vault";
    } else if (/(lãi suất|fed|ngân hàng trung ương)/.test(sceneText)) {
      inferredSetting = "fed_rate_room";
    } else if (/(biểu đồ|chứng khoán|cổ phiếu|sàn giao dịch)/.test(sceneText)) {
      inferredSetting = "mountain_chart";
    } else if (/(làm việc từ xa|wfh|remote|ở nhà)/.test(sceneText)) {
      inferredSetting = "remote_workspace";
    } else if (/(phỏng vấn|tuyển dụng|hợp đồng|hr)/.test(sceneText)) {
      inferredSetting = "interview_room";
    }

    let chosenSetting = provided?.setting || inferredSetting;
    if (
      !isTravelOrEv &&
      (chosenSetting === "park_dawn" || chosenSetting === "beach_sunset")
    ) {
      chosenSetting = inferredSetting;
    }

    const isCrowdScene =
      /(đoàn kiểm tra|cả dãy|đám đông|những người xung quanh|tẩy chay|mọi người|cùng dọn hàng)/.test(
        sceneText,
      );
    const isTrioScene =
      isStreetVendorOrMarket ||
      chosenSetting === "street_vendor" ||
      chosenSetting === "sidewalk_tea" ||
      chosenSetting === "race_track" ||
      /(khách|người mua|người thân|hàng nước|người thứ ba|xung quanh)/.test(
        sceneText,
      );
    const isTwoPersonStory =
      isAncientOrFolklore ||
      isTravelOrEv ||
      /2 người|hai người|đối thoại/.test(fullText);

    // Ghost stories: one figure on stage by default; the AI director adds a second only when the story has two people together.
    const defaultMode: "solo" | "duo" | "trio" | "crowd" = soloDefault
      ? "solo"
      : isCrowdScene
      ? "crowd"
      : isTrioScene
        ? "trio"
        : !isTwoPersonStory &&
            (chosenSetting === "coding_desk" ||
              chosenSetting === "debugging_board")
          ? "solo"
          : "duo";

    // Extract clean, meaningful stat pills (prefer real metrics/numbers or complete non-dangling clauses)
    const clauseParts = (lines[0] || "")
      .split(/[,.;!?–—-]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const extractCleanStat = (src: string, fallback: string): string => {
      const numMatch = src.match(
        /\d+[.,]?\d*\s*(?:%|đ|k|triệu|tỷ|nghìn|ngàn|năm|tháng|ngày|giờ|phút|lần|calo|km|m)\b/i,
      );
      if (numMatch) return numMatch[0].trim();
      const words = src
        .replace(/[.,!?;:"“”()—–-]/g, " ")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (words.length === 0) return fallback;
      const trimmed = stripDanglingTail(words.slice(0, 5), 2);
      return trimmed.length >= 2 ? trimmed.join(" ") : fallback;
    };
    const dynamicStatLeft = extractCleanStat(
      lines[0] || "",
      `${plan.bar1Label}: ${plan.bar1Value}${plan.barUnit}`,
    );
    const dynamicStatRight = extractCleanStat(
      lines[1] || clauseParts[1] || "",
      `${plan.bar2Label}: ${plan.bar2Value}${plan.barUnit}`,
    );

    const rawClauseTitle = stripDanglingTail(
      (clauseParts[0] || "").split(/\s+/).filter(Boolean).slice(0, 6),
      3,
    ).join(" ");
    const finalTitle = (
      provided?.title ||
      rawClauseTitle ||
      (idx === 0
        ? `${plan.coverLine1} ${plan.coverLine2}`
        : idx === 2
          ? plan.chip1
          : idx === 3
            ? plan.headlineText
            : idx === 4
              ? plan.chip2
              : plan.coverKicker)
    ).toUpperCase();
    const finalStatLeft = provided?.statLeft || dynamicStatLeft;
    const finalStatRight = provided?.statRight || dynamicStatRight;

    // Synthesize a distinct, creative 2D vector illustration from the scene's own script lines if Gemini omitted customSvg
    const escXml = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    const shortTagA = escXml(trimWords(finalStatLeft, 18));
    const shortHead = escXml(trimWords(finalTitle, 20));
    let fallbackCustomSvg = "";
    if (
      !provided?.customSvg &&
      chosenSetting !== "street_vendor" &&
      chosenSetting !== "sidewalk_tea" &&
      chosenSetting !== "race_track"
    ) {
      if (
        /(nhà|bất động sản|căn hộ|chung cư|đất nền|mua nhà|giá nhà)/.test(
          sceneText,
        )
      ) {
        fallbackCustomSvg = `<g><rect x="-115" y="-235" width="105" height="225" rx="8" fill="#0284C7" stroke="#111827" stroke-width="4"/><rect x="-95" y="-210" width="26" height="26" rx="3" fill="#FEF08A"/><rect x="-55" y="-210" width="26" height="26" rx="3" fill="#FEF08A"/><rect x="-95" y="-168" width="26" height="26" rx="3" fill="#FEF08A"/><rect x="-55" y="-168" width="26" height="26" rx="3" fill="#FEF08A"/><polygon points="5,-125 65,-180 125,-125" fill="#EF4444" stroke="#111827" stroke-width="4"/><rect x="18" y="-125" width="94" height="115" rx="6" fill="#F8FAFC" stroke="#111827" stroke-width="4"/><rect x="-95" y="-275" width="190" height="36" rx="10" fill="#FACC15" stroke="#111827" stroke-width="3.5"/><text x="0" y="-251" text-anchor="middle" font-size="16" font-weight="900" fill="#111827">${shortHead}</text></g>`;
      } else if (
        /(tâm lý|adrenaline|não|cảm xúc|nghiện|hormone|thói quen)/.test(
          sceneText,
        )
      ) {
        fallbackCustomSvg = `<g><circle cx="0" cy="-145" r="92" fill="#1E1B4B" stroke="#A855F7" stroke-width="5"/><path d="M -55 -145 Q -30 -205 0 -175 Q 35 -205 58 -145 Q 35 -95 0 -115 Q -35 -95 -55 -145 Z" fill="#F472B6" stroke="#111827" stroke-width="4"/><polyline points="-75,-75 -35,-75 -15,-120 10,-45 30,-95 75,-95" fill="none" stroke="#22C55E" stroke-width="5"/><rect x="-105" y="-265" width="210" height="36" rx="10" fill="#A855F7" stroke="#111827" stroke-width="3.5"/><text x="0" y="-241" text-anchor="middle" font-size="16" font-weight="900" fill="#FFFFFF">${shortHead}</text></g>`;
      } else if (
        /(tai nạn|ổ gà|cấp cứu|bệnh viện|vô tội|nguy hiểm|tông|mất mạng)/.test(
          sceneText,
        )
      ) {
        fallbackCustomSvg = `<g><polygon points="0,-245 -115,-35 115,-35" fill="#FACC15" stroke="#111827" stroke-width="5"/><polygon points="0,-215 -88,-52 88,-52" fill="#EF4444" stroke="#111827" stroke-width="3.5"/><rect x="-10" y="-165" width="20" height="58" rx="6" fill="#FFFFFF"/><circle cx="0" cy="-82" r="12" fill="#FFFFFF"/><rect x="-110" y="-32" width="220" height="30" rx="8" fill="#111827"/><text x="0" y="-11" text-anchor="middle" font-size="15" font-weight="900" fill="#FACC15">${shortTagA}</text></g>`;
      } else if (
        /(mạng xã hội|tiktok|follow|view|lượt xem|đám đông|tung hô|xu hướng|chia sẻ)/.test(
          sceneText,
        )
      ) {
        fallbackCustomSvg = `<g><rect x="-78" y="-255" width="156" height="245" rx="22" fill="#0F172A" stroke="#38BDF8" stroke-width="5"/><rect x="-64" y="-228" width="128" height="185" rx="10" fill="#1E293B"/><circle cx="0" cy="-155" r="36" fill="#EF4444" stroke="#FFFFFF" stroke-width="3.5"/><polygon points="-10,-172 -10,-138 18,-155" fill="#FFFFFF"/><rect x="-52" y="-95" width="104" height="28" rx="8" fill="#22C55E"/><text x="0" y="-76" text-anchor="middle" font-size="14" font-weight="900" fill="#FFFFFF">${shortTagA}</text></g>`;
      }
      // Leave fallbackCustomSvg = "" in the generic case so StickmanStage's rich multi-beat 2D scenes render cleanly!
      if (fallbackCustomSvg) {
        chosenSetting = "custom_scene";
      }
    }

    return {
      id,
      setting: chosenSetting,
      bgTheme: (provided as any)?.bgTheme,
      action: provided?.action || actions[idx],
      mode: provided?.mode || defaultMode,
      charLeft: provided?.charLeft,
      charRight: provided?.charRight,
      charThird: provided?.charThird,
      ...pickAgeGender(provided),
      leftHat: provided?.leftHat,
      rightHat: provided?.rightHat,
      thirdHat: provided?.thirdHat,
      leftAccessory: provided?.leftAccessory,
      rightAccessory: provided?.rightAccessory,
      // "ao_dai" renders as a stiff tube → use the soft áo bà ba instead
      leftOutfit: noAoDai(provided?.leftOutfit),
      rightOutfit: noAoDai(provided?.rightOutfit),
      thirdOutfit: noAoDai((provided as any)?.thirdOutfit),
      leftProp: provided?.leftProp,
      rightProp: provided?.rightProp,
      thirdProp: provided?.thirdProp,
      leftCustomPropSvg: provided?.leftCustomPropSvg,
      rightCustomPropSvg: provided?.rightCustomPropSvg,
      customSvg: provided?.customSvg || fallbackCustomSvg || undefined,
      customSvgBeats: Array.isArray((provided as any)?.customSvgBeats)
        ? (provided as any).customSvgBeats
        : undefined,
      badge: provided?.badge || badges[idx],
      title: finalTitle,
      statLeft: finalStatLeft,
      statRight: finalStatRight,
      progressValue:
        provided?.progressValue ??
        (idx === 4 ? 85 : idx === 5 ? 92 : 30 + idx * 11),
      dialogues: provided?.dialogues?.length
        ? provided.dialogues
        : defaultDialogues,
      speakers: provided?.speakers,
      lineBeats: sanitizeLineBeats((provided as any)?.lineBeats),
    };
  });
};

const writeEntryTsx = (dir: string, aspectRatio: StudioAspectRatio = "9:16") => {
  const isWide = aspectRatio === "16:9";
  const compW = isWide ? 1920 : 1080;
  const compH = isWide ? 1080 : 1920;
  const entry = `import React from "react";
import {Composition, registerRoot, Still} from "remotion";
import {loadFont} from "../../shared/font";
import {Cover} from "./Cover";
import {DURATION, FPS} from "./timing";
import {Video} from "./Video";

loadFont();

const Root: React.FC = () => (
  <>
    <Composition id="Video" component={Video} durationInFrames={DURATION} fps={FPS} width={${compW}} height={${compH}} defaultProps={{safe: false}} />
    <Still id="Cover" component={Cover} width={${compW}} height={${compH}} defaultProps={{safe: false}} />
  </>
);

registerRoot(Root);
`;
  writeFileSync(join(dir, "entry.tsx"), entry);
};

const writeStickmanFiles = (
  dir: string,
  plan: GeneratedPlan,
  aspectRatio: StudioAspectRatio = "9:16",
  /** spirit: storytelling look — no chapter card / SVG panel, eerie faces */
  minimalUi = false,
) => {
  const acts = buildDefaultStickmanActs(plan, minimalUi);
  // AI backdrops are filled in after TTS (renderStickmanBackdrops); start empty so the video always builds.
  if (!existsSync(join(dir, "backdrops.json"))) writeFileSync(join(dir, "backdrops.json"), "[]\n");
  const world = `import React from "react";
import type {AiBackdropItem} from "../../shared/figures/AiBackdrop";
import {StickmanStage, type StickmanSceneAct} from "../../shared/figures/StickmanStage";
import {StoryCamera} from "../../shared/figures/StoryCamera";
import backdrops from "./backdrops.json";
import {DURATION, TIMINGS, VOICE} from "./timing";

const ACTS: StickmanSceneAct[] = ${JSON.stringify(acts, null, 2)};

export const World: React.FC = () => (
  <StoryCamera acts={ACTS} voice={VOICE}>
    <StickmanStage acts={ACTS} timings={TIMINGS} voice={VOICE} duration={DURATION} backdrops={backdrops as AiBackdropItem[]}${minimalUi ? " minimalUi" : ""} />
  </StoryCamera>
);
`;

  const scenes = `import React from "react";
import {AbsoluteFill} from "remotion";
import type {SceneComponent} from "../../shared/frame/ShortsTemplate";

const WorldOnly: SceneComponent = () => <AbsoluteFill />;

export const scenes: Record<string, SceneComponent> = {
  hook: WorldOnly,
  problem: WorldOnly,
  layer1: WorldOnly,
  layer2: WorldOnly,
  hardest: WorldOnly,
  payoff: WorldOnly,
  share: WorldOnly,
};
`;

  const act0 = acts[0];
  const coverLeftLabel = act0?.charLeft || (plan as any).charA || "Nhân Vật A";
  const coverRightLabel = act0?.charRight || (plan as any).charB || "Nhân Vật B";
  const coverLeftHat = act0?.leftHat || "none";
  const coverRightHat = act0?.rightHat || "none";
  const coverKickerText = trimWords(plan.coverKicker || "GÓC GIẢI MÃ", 26);
  const coverLine1Text = trimWords(plan.coverLine1 || "SỰ THẬT VỀ", 24);
  const coverLine2Text = trimWords(plan.coverLine2 || "ĐIỀU NÀY?", 22);
  const coverLine1Size = coverLine1Text.length > 16 ? 84 : 104;
  const coverLine2Size = coverLine2Text.length > 14 ? 112 : 148;
  const wideLine1Size = coverLine1Text.length > 18 ? 92 : 112;
  const wideLine2Size = coverLine2Text.length > 16 ? 116 : 142;

  const cover =
    aspectRatio === "16:9"
      ? `import React from "react";
import {AbsoluteFill} from "remotion";
import {Stickman} from "../../shared/figures/Stickman";
import {SafeCheck} from "../../shared/frame/SafeCheck";
import {DEFAULT_PALETTE, FONT} from "../../shared/theme";

const p = DEFAULT_PALETTE;
const CW = 1920;
const CH = 1080;
const HORIZON_Y = 860;
const SHADOW = "0 8px 28px rgba(0,0,0,0.85), 0 2px 6px rgba(0,0,0,0.75)";

export const Cover: React.FC<{safe: boolean}> = ({safe}) => (
  <SafeCheck safe={safe} cover>
    <AbsoluteFill style={{background: "linear-gradient(180deg, #091526 0%, #1E293B 68%, #0F172A 100%)"}}>
      <svg width={CW} height={CH} style={{position: "absolute", left: 0, top: 0}}>
        <ellipse cx={CW / 2} cy={460} rx={580} ry={310} fill="#38BDF8" opacity={0.16} />
        <rect x={0} y={HORIZON_Y} width={CW} height={CH - HORIZON_Y} fill="#0F172A" />
        <line x1={0} y1={HORIZON_Y} x2={CW} y2={HORIZON_Y} stroke="#38BDF8" strokeWidth={6} />
        <Stickman x={285} y={HORIZON_Y - 6} scale={1.65} pose="explain" mood="happy" hat=${JSON.stringify(coverLeftHat)} accent="#FFD60A" label=${JSON.stringify(coverLeftLabel)} frame={10} />
        <Stickman x={1635} y={HORIZON_Y - 6} scale={1.65} pose="point" mood="shock" hat=${JSON.stringify(coverRightHat)} accent="#30D5C8" flip label=${JSON.stringify(coverRightLabel)} frame={10} />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 360,
          width: 1200,
          top: 165,
          textAlign: "center",
          fontFamily: FONT.sans,
          color: p.text,
          textShadow: SHADOW,
        }}
      >
        <div style={{display: "inline-block", background: "#FFD60A", color: "#0F172A", padding: "10px 34px", borderRadius: 999, fontSize: 34, fontWeight: 900, letterSpacing: 3, textShadow: "none"}}>${coverKickerText}</div>
        <div style={{fontSize: ${wideLine1Size}, fontWeight: 900, lineHeight: 1.06, marginTop: 34, letterSpacing: -2}}>${coverLine1Text}</div>
        <div style={{fontSize: ${wideLine2Size}, fontWeight: 900, lineHeight: 1.0, letterSpacing: -3, marginTop: 14, color: "#30D5C8"}}>${coverLine2Text}</div>
      </div>
    </AbsoluteFill>
  </SafeCheck>
);
`
      : `import React from "react";
import {AbsoluteFill} from "remotion";
import {Stickman} from "../../shared/figures/Stickman";
import {SafeCheck} from "../../shared/frame/SafeCheck";
import {COVER_BAND, PANEL_LEFT, PANEL_MAX_W} from "../../shared/frame/SafeZones";
import {DEFAULT_PALETTE, FONT, H, W} from "../../shared/theme";

const p = DEFAULT_PALETTE;
const HORIZON_Y = 1320;
const SHADOW = "0 8px 28px rgba(0,0,0,0.85), 0 2px 6px rgba(0,0,0,0.75)";

export const Cover: React.FC<{safe: boolean}> = ({safe}) => (
  <SafeCheck safe={safe} cover>
    <AbsoluteFill style={{background: "linear-gradient(180deg, #091526 0%, #1E293B 64%, #0F172A 100%)"}}>
      <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
        <ellipse cx={W / 2} cy={HORIZON_Y - 120} rx={320} ry={220} fill="#38BDF8" opacity={0.14} />
        <rect x={0} y={HORIZON_Y} width={W} height={H - HORIZON_Y} fill="#0F172A" />
        <line x1={0} y1={HORIZON_Y} x2={W} y2={HORIZON_Y} stroke="#38BDF8" strokeWidth={5} />
        <Stickman x={310} y={1520} scale={1.55} pose="explain" mood="happy" hat=${JSON.stringify(coverLeftHat)} accent="#FFD60A" label=${JSON.stringify(coverLeftLabel)} frame={10} />
        <Stickman x={770} y={1520} scale={1.55} pose="point" mood="shock" hat=${JSON.stringify(coverRightHat)} accent="#30D5C8" flip label=${JSON.stringify(coverRightLabel)} frame={10} />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 0,
          width: W,
          top: COVER_BAND.top + 220,
          height: 820,
          background: "radial-gradient(60% 55% at 50% 50%, rgba(6,24,48,0.75), rgba(6,24,48,0) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: PANEL_LEFT,
          width: PANEL_MAX_W,
          top: COVER_BAND.top + 300,
          textAlign: "center",
          fontFamily: FONT.sans,
          color: p.text,
          textShadow: SHADOW,
        }}
      >
        <div style={{fontSize: 44, fontWeight: 800, letterSpacing: 4, color: "#FFD60A"}}>${coverKickerText}</div>
        <div style={{fontSize: ${coverLine1Size}, fontWeight: 900, lineHeight: 1.05, marginTop: 28, letterSpacing: -2}}>${coverLine1Text}</div>
        <div style={{fontSize: ${coverLine2Size}, fontWeight: 900, lineHeight: 0.98, letterSpacing: -4, marginTop: 12, color: "#30D5C8"}}>${coverLine2Text}</div>
      </div>
    </AbsoluteFill>
  </SafeCheck>
);
`;

  writeFileSync(join(dir, "World.tsx"), world);
  writeFileSync(join(dir, "scenes.tsx"), scenes);
  // Ghost stories: no stick figures on the thumbnail; the title sits over the best (most tense) backdrop of the video itself.
  let coverOut = cover;
  if (minimalUi) {
    let g = 0;
    let bestLine = -1;
    let bestT = 0;
    let totalLines = 0;
    for (const a of acts) {
      const n = (plan.scenes as any)[a.id]?.length ?? 0;
      ((a as any).lineBeats ?? []).forEach((b: any, i: number) => {
        const t = Number(b?.tension) || 0;
        if (t > bestT) {
          bestT = t;
          bestLine = g + i;
        }
      });
      g += n;
    }
    totalLines = g;
    if (bestLine < 0) bestLine = Math.floor(totalLines * 0.35); // nothing flagged tense: a scene a third of the way in
    coverOut = cover
      .replace(/^[ \t]*<Stickman [^\n]*\n/gm, "")
      .replace(/^[ \t]*<ellipse [^\n]*\n/gm, "")
      .replace(/^[ \t]*<rect x=\{0\} y=\{HORIZON_Y\}[^\n]*\n/gm, "")
      .replace(/^[ \t]*<line x1=\{0\} y1=\{HORIZON_Y\}[^\n]*\n/gm, "")
      .replace(
        'import {AbsoluteFill} from "remotion";',
        `import {AbsoluteFill, Img, staticFile} from "remotion";
import backdropItems from "./backdrops.json";

/** Backdrop of the most tense moment (else the first drawn one): the thumbnail shows a real scene of this video. */
const COVER_IMG: string | null = (() => {
  const items = (backdropItems as {line: number; src: string | null}[]).filter((b) => b.src);
  if (!items.length) return null;
  const at = items.filter((b) => b.line <= ${bestLine});
  return (at.length ? at[at.length - 1] : items[0]).src;
})();`,
      )
      .replace(
        /(<SafeCheck safe=\{safe\} cover>\n[ \t]*<AbsoluteFill style=\{\{background:[^\n]*\n)/,
        `$1      {COVER_IMG ? <Img src={staticFile(COVER_IMG)} style={{position: "absolute", left: 0, top: 0, width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.08)", transformOrigin: "30% 30%"}} /> : null}
      {COVER_IMG ? <AbsoluteFill style={{background: "linear-gradient(180deg, rgba(4,6,12,0.55) 0%, rgba(4,6,12,0.18) 38%, rgba(4,6,12,0.78) 100%)"}} /> : null}
`,
      );
  }
  else coverOut = classicCoverOnBackdrop(cover);
  writeFileSync(join(dir, "Cover.tsx"), coverOut);
  writeEntryTsx(dir, aspectRatio);
};

/** Classic stickman cover: the video's opening backdrop behind the title, cast in the story body standing on its ground. */
export const classicCoverOnBackdrop = (cover: string): string => {
  if (cover.includes("COVER_BG") || !cover.includes("<Stickman ")) return cover;
  const wide = cover.includes("const CW = 1920");
  const floor = wide ? "(860 - 6) / 1080" : "1520 / 1920";
  return cover
    .replace(
      'import {AbsoluteFill} from "remotion";',
      `import {AbsoluteFill, Img, staticFile} from "remotion";
import {fitToFloor} from "../../shared/figures/AiBackdrop";
import backdropItems from "./backdrops.json";

/** The picture the video opens on (backdrops.json, filled after the plan): same place as the first scene. */
const COVER_BG = (() => {
  const items = (backdropItems as {line: number; src: string | null; floor?: number}[]).filter((b) => b.src).sort((a, b) => a.line - b.line);
  if (!items.length) return null;
  const fit = items[0].floor ? fitToFloor(items[0].floor, ${floor}) : {s: 1.12, top: 0};
  return {src: items[0].src as string, ...fit};
})();`,
    )
    .replace(/(^[ \t]*<ellipse [^\n]*\n[ \t]*<rect [^\n]*\n[ \t]*<line [^\n]*\n)/m, "        {COVER_BG ? null : (\n          <>\n$1          </>\n        )}\n")
    .replace(
      /(<SafeCheck safe=\{safe\} cover>\n[ \t]*<AbsoluteFill style=\{\{background:[^\n]*\n)/,
      `$1      {COVER_BG ? <Img src={staticFile(COVER_BG.src)} style={{position: "absolute", left: \`\${-(COVER_BG.s - 1) * 30}%\`, top: \`\${COVER_BG.top * 100}%\`, width: \`\${COVER_BG.s * 100}%\`, height: \`\${COVER_BG.s * 100}%\`, objectFit: "cover"}} /> : null}
      {COVER_BG ? <AbsoluteFill style={{background: "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.12) 40%, rgba(0,0,0,0.12) 70%, rgba(0,0,0,0.4) 100%)"}} /> : null}
`,
    )
    .replace(/<Stickman ([^\n]*?)label=("(?:[^"\\]|\\.)*")/g, "<Stickman $1storyLook colorKey=$2 label=$2");
};

const writeVietnamMapFiles = (dir: string, plan: GeneratedPlan) => {
  const world = `import React from "react";
import {useCurrentFrame} from "remotion";
import {at, boxAround, path, Pin, Ping, Route, VIETNAM_VIEWS, VietnamMap, type LonLat} from "../../shared/map";
import {fade, ramp} from "../../shared/motion/anim";
import {DEFAULT_PALETTE} from "../../shared/theme";
import {DURATION, TIMINGS} from "./timing";

const start = (scene: string) => TIMINGS.find((t) => t.id === scene)?.from ?? 0;

const SPINE: LonLat[] = [
  at("Hà Giang"),
  at("Hà Nội"),
  at("Vinh"),
  at("Đồng Hới"),
  at("Huế"),
  at("Đà Nẵng"),
  at("Nha Trang"),
  at("Thành phố Hồ Chí Minh"),
  at("Cần Thơ"),
  at("Cà Mau"),
];

const FOCUS_BOX = boxAround(107.5, 15.8, 6.2);

export const World: React.FC = () => {
  const f = useCurrentFrame();
  const fProblem = start("problem");
  const fLayer1 = start("layer1");
  const fHardest = start("hardest");

  const box = path(f, [
    [0, VIETNAM_VIEWS.wide],
    [fProblem, VIETNAM_VIEWS.country],
    [fLayer1 + 30, FOCUS_BOX],
    [fHardest, VIETNAM_VIEWS.country],
    [DURATION, VIETNAM_VIEWS.country],
  ]);

  const routeProg = ramp(f, 6, Math.max(40, fLayer1));
  const riversOn = fade(f, fHardest, 24);

  return (
    <VietnamMap
      box={box}
      palette={DEFAULT_PALETTE}
      lang="vi"
      archipelagos={1}
      neighbours={0.8}
      rivers={riversOn}
      countryLabels={["VNM", "LAO", "KHM"]}
      land="#1E3346"
      outline={3.5}
    >
      <Route points={SPINE} progress={routeProg} color="#FFD60A" width={8} glow={14} head ends />
      <Ping at={at("Đà Nẵng")} phase={(f % 45) / 45} color="#30D5C8" size={14} opacity={fade(f, fLayer1, 15)} />
      <Pin at={at("Hà Nội")} label="Hà Nội" side="right" size={34} />
      <Pin at={at("Đà Nẵng")} label="Miền Trung" side="right" size={34} dotColor="#30D5C8" opacity={fade(f, fLayer1, 15)} />
      <Pin at={at("Thành phố Hồ Chí Minh")} label="TP. Hồ Chí Minh" side="right" size={34} />
    </VietnamMap>
  );
};
`;
  writeStickmanFiles(dir, plan);
  writeFileSync(join(dir, "World.tsx"), world);
};

const writeInfographicFiles = (dir: string, plan: GeneratedPlan) => {
  const world = `import React from "react";
import {useCurrentFrame} from "remotion";
import {CompareBars} from "../../shared/chart/CompareBars";
import {ProgressRing} from "../../shared/chart/ProgressRing";
import {Stickman} from "../../shared/figures";
import {fade} from "../../shared/motion/anim";
import {DEFAULT_PALETTE, H, W} from "../../shared/theme";
import {TIMINGS} from "./timing";

const start = (id: string) => TIMINGS.find((t) => t.id === id)?.from ?? 0;

export const World: React.FC = () => {
  const f = useCurrentFrame();
  const fProblem = start("problem");
  const fLayer1 = start("layer1");
  const fLayer2 = start("layer2");
  const fHardest = start("hardest");
  const fPayoff = start("payoff");

  const showBars = f >= fLayer1 && f < fHardest;
  const showRing = f >= fHardest && f < fPayoff;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: W,
        height: H,
        background: "radial-gradient(circle at 50% 25%, #132A46 0%, #091322 65%, #050A12 100%)",
      }}
    >
      <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
        {Array.from({length: 18}, (_, i) => (
          <line key={\`h\${i}\`} x1={0} y1={i * 110} x2={W} y2={i * 110} stroke="rgba(48,213,200,0.06)" strokeWidth={1.5} />
        ))}
        {Array.from({length: 10}, (_, i) => (
          <line key={\`v\${i}\`} x1={i * 110} y1={0} x2={i * 110} y2={H} stroke="rgba(48,213,200,0.06)" strokeWidth={1.5} />
        ))}
        <Stickman
          x={showBars || showRing ? 820 : 540}
          y={1520}
          scale={showBars || showRing ? 0.95 : 1.15}
          color="#30D5C8"
          label=${JSON.stringify(plan.charA || "Chuyên gia")}
          mood={f >= fPayoff ? "celebrate" : f >= fHardest ? "idea" : "happy"}
          pose={f >= fPayoff ? "cheer" : showBars ? "point-right" : "explain"}
          talking
          prop="laptop"
        />
      </svg>

      {showBars && (
        <div style={{opacity: fade(f, fLayer1, 14)}}>
          <CompareBars
            palette={DEFAULT_PALETTE}
            at={fLayer1}
            top={760}
            unit="%"
            focus={0}
            bars={[
              {label: ${JSON.stringify(plan.stat1Sub || "Tác động trực tiếp")}, value: 84, color: "#FFD60A"},
              {label: ${JSON.stringify(plan.stat2Sub || "Yếu tố thứ cấp")}, value: 52, color: "#30D5C8"},
              {label: "Mức trung bình", value: 28, color: "#64748B"},
            ]}
          />
        </div>
      )}

      {showRing && (
        <div style={{opacity: fade(f, fHardest, 14)}}>
          <ProgressRing
            value={78}
            palette={DEFAULT_PALETTE}
            at={fHardest}
            top={740}
            size={420}
            color="#FF375F"
            label=${JSON.stringify(plan.stat2Sub || "Tỷ lệ ảnh hưởng trọng yếu")}
          />
        </div>
      )}
    </div>
  );
};
`;
  writeStickmanFiles(dir, plan);
  writeFileSync(join(dir, "World.tsx"), world);
};

const writeNatureSkyFiles = (dir: string, plan: GeneratedPlan) => {
  const world = `import React from "react";
import {useCurrentFrame} from "remotion";
import {Camera} from "../../shared/motion/Camera";
import {lerp} from "../../shared/motion/anim";
import {Birds, Clouds, Sea, Sky, Sun, type SkyPreset} from "../../shared/nature";
import {W} from "../../shared/theme";
import {DURATION} from "./timing";

const HORIZON_Y = 1580;
const SEA_PRESET: SkyPreset = {top: "#1E5E9E", low: "#BCE0F0", sea: "#237099", deep: "#092F48", wave: 0.55, light: 1};

export const World: React.FC = () => {
  const f = useCurrentFrame();
  const z = lerp(1.0, 1.07, f / Math.max(1, DURATION));
  return (
    <Camera move={{z: [z, z], at: [W / 2, 980]}} t={0}>
      <Sky sky={SEA_PRESET} horizon={HORIZON_Y} />
      <Sun x={800} y={460} size={120} on={0.95} horizon={HORIZON_Y} />
      <Clouds sky="day" count={4} speed={1.2} seed={4} horizon={HORIZON_Y} />
      <Birds count={5} y={620} seed={2} />
      <Sea sky={SEA_PRESET} horizon={HORIZON_Y} glitter />
    </Camera>
  );
};
`;
  writeStickmanFiles(dir, plan);
  writeFileSync(join(dir, "World.tsx"), world);
};

// ─────────────────────────────────────────────────────────────────────────────
// Stickman Explainer (Thầy Lá + AI backgrounds)
// ─────────────────────────────────────────────────────────────────────────────

const SPIRIT_PERSONA = `
PHONG CÁCH KÊNH "GIẢI MÃ TÂM LINH" (bắt buộc):
- GIỌNG KỂ: ưu tiên NGÔI THỨ NHẤT ("tôi", "má tôi", "ba tôi") như người trong nhà kể lại; câu NGẮN, dứt khoát, nhiều câu 5–10 chữ ở đoạn căng ("Nó đi, rồi nó về."), xen câu dài hơn ở đoạn kể bình thường.
- BÁM SÁT NỘI DUNG ĐƯỢC ĐƯA VÀO (quan trọng nhất): chỉ KỂ LẠI đúng câu chuyện người dùng cung cấp — giữ nguyên nhân vật, tên, địa danh, thời gian, thứ tự sự kiện, lời thoại. KHÔNG tự chế thêm nhân vật, tình tiết, chi tiết, kết cục hay lời thoại không có trong nội dung gốc; chỉ được rút gọn, bỏ bớt cho vừa độ dài. Chỉ khi người dùng thật sự không đưa câu chuyện (chỉ có chủ đề) mới được dựng truyện mới.
- GIỌNG VĂN CHẬM, TỪ TỐN: câu rõ ràng, nhịp đều, không dồn dập, không giật gân.
- Nửa đầu (hook, problem, layer1) KỂ lại câu chuyện tâm linh/hiện tượng lạ cụ thể, có nhân vật, thời gian, địa điểm, chi tiết giác quan (tiếng động, ánh sáng, cảm giác lạnh gáy). Kể như chuyện truyền miệng ("người ta kể", "theo lời bà con"), KHÔNG khẳng định là có thật.
- layer2 LẬT lại: "nhưng có một điều lạ…" và đưa con số/hiện tượng phổ biến khiến người xem tò mò.
- hardest GIẢI MÃ bằng khoa học (tâm lý học, thần kinh học, vật lý, sinh học): cơ chế rõ ràng, dễ hiểu, có số liệu hoặc nghiên cứu được biết đến rộng rãi.
- payoff: điều người xem nên làm/biết trong đời thực. share: một câu hỏi gợi bình luận ("Bạn từng gặp chưa?").
- NHIỀU GIỌNG ĐỌC: lời nói trực tiếp của nhân vật viết thành CÂU RIÊNG, mở đầu bằng {Tên vai}, ví dụ: "{Má} Con ơi, tối nay đừng ra vườn nghe chưa." — vai ma/vong/tiếng lạ: "{Vong nữ} Trả… trả lại cho tao…". Lời người kể thì KHÔNG có ngoặc nhọn. Khoảng 1 câu thoại trên 4–6 câu kể, dùng ở chỗ kịch tính.
- TUYỆT ĐỐI KHÔNG: khuyên cúng bái/bùa chú để chữa bệnh, kêu gọi chuyển tiền giải hạn, dọa "không chia sẻ sẽ gặp xui", chi tiết máu me ghê rợn.
`;

const EXPLAINER_PERSONA = `

PHONG CÁCH KÊNH (BẮT BUỘC — STICKMAN EXPLAINER):
- Người dẫn chuyện là "Thầy Lá": thầy giáo trẻ đội nón lá, chuyên gia kể chuyện khoa học đời sống. Lời kể ngôi thứ nhất thân mật ("mình", "các bạn"), như đang dắt người xem đi xem tận nơi.
- Giải thích hiện tượng khoa học và đời sống quen thuộc bằng ví dụ đời thường và phép so sánh dễ hình dung. Hook mở bằng câu hỏi kiểu "Vì sao…", "Điều gì xảy ra nếu…".
- MỖI CÂU phải gợi ra MỘT hình ảnh cụ thể vẽ được (một nơi chốn, một vật, một hiện tượng đang diễn ra) để họa sĩ minh họa nối tiếp thành một chuyến đi liền mạch.
- Chỉ dùng kiến thức khoa học phổ thông đã được kiểm chứng, không bịa số liệu.`;

export type ExplainerDirection = {
  backgrounds: ExplainerBgSpec[];
  beats: ExplainerBeat[];
  coverKicker?: string;
  coverLine1?: string;
  coverLine2?: string;
  coverBg?: string;
};

const EXPLAINER_SCENES = ["hook", "problem", "layer1", "layer2", "hardest", "payoff", "share"] as const;
const EXPLAINER_POSES = [
  "explain", "point", "point-right", "think", "shrug", "cheer", "wave", "read_book", "write_note",
  "check_phone", "analyze", "crouch_inspect", "step_back", "laugh_belly", "reach", "tired", "slump", "jump",
] as const;
const EXPLAINER_MOODS = ["happy", "shock", "serious", "sad", "cool", "idea", "celebrate", "confused", "scheming"] as const;
const EXPLAINER_PROPS = [
  "none", "bulb", "magnifier", "book", "notebook", "pointer", "phone", "chart", "question",
  "water_bottle", "coffee", "checklist", "laptop", "money",
] as const;
const EXPLAINER_CAMS = ["push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "hold"] as const;
const EXPLAINER_TRANSITIONS = ["cut", "fade", "wipe", "zoom_through", "ink"] as const;
const EXPLAINER_PLACES = ["left", "right", "center", "off"] as const;

const pick = <T extends string>(v: unknown, list: readonly T[], dflt: T | undefined): T | undefined =>
  typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : dflt;
const num01 = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : undefined;

const flattenLines = (scenes: GeneratedPlan["scenes"]) =>
  EXPLAINER_SCENES.flatMap((sid) =>
    (scenes[sid]?.length ? scenes[sid] : ["…"]).map((t) => ({ scene: sid, text: sanitizeSpoken(t) })),
  );

/** Generic English prompts per act when the AI director is unavailable. */
const FALLBACK_BG: Record<(typeof EXPLAINER_SCENES)[number], string> = {
  hook: "a busy Vietnamese street corner at golden hour with motorbikes, food stalls and hanging lanterns",
  problem: "a cozy Vietnamese family kitchen at night, a single warm lamp, pots and jars on wooden shelves",
  layer1: "a bright science classroom with a big chalkboard full of diagrams, beakers and a globe on the desk",
  layer2: "a vast cross-section diagram of the inside of a city, pipes, wires and machinery, isometric view",
  hardest: "a dramatic stormy sky over rice fields, lightning in the distance, moody blue light",
  payoff: "a sunrise over a calm Vietnamese river town, boats and misty mountains, hopeful light",
  share: "a rooftop at dusk overlooking a glowing city skyline, string lights and potted plants",
};

const buildFallbackDirection = (scenes: GeneratedPlan["scenes"]): ExplainerDirection => {
  const lines = flattenLines(scenes);
  const backgrounds = EXPLAINER_SCENES.map((sid) => ({ id: sid, prompt: FALLBACK_BG[sid] }));
  const cams = ["push_in", "pan_right", "hold", "pan_left", "pull_out"] as const;
  const poses = ["explain", "point-right", "think", "explain", "shrug"] as const;
  const beats: ExplainerBeat[] = lines.map((l, i) => ({
    line: i,
    bg: l.scene,
    camera: cams[i % cams.length],
    place: i % 6 < 3 ? "left" : "right",
    pose: l.scene === "payoff" ? "cheer" : poses[i % poses.length],
    mood: l.scene === "hook" ? "idea" : l.scene === "hardest" ? "shock" : "happy",
  }));
  return { backgrounds, beats };
};

const sanitizeDirection = (raw: any, lineCount: number): ExplainerDirection | null => {
  if (!raw || !Array.isArray(raw.backgrounds) || !Array.isArray(raw.beats)) return null;
  const backgrounds: ExplainerBgSpec[] = [];
  const seen = new Set<string>();
  for (const b of raw.backgrounds) {
    const id = String(b?.id ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 40);
    const prompt = String(b?.prompt ?? "").trim();
    if (!id || !prompt || seen.has(id)) continue;
    seen.add(id);
    backgrounds.push({ id, prompt: prompt.slice(0, 600) });
  }
  if (!backgrounds.length) return null;
  const byLine = new Map<number, any>();
  for (const b of raw.beats) {
    const line = Number(b?.line);
    if (Number.isInteger(line) && line >= 0 && line < lineCount && !byLine.has(line)) byLine.set(line, b);
  }
  const beats: ExplainerBeat[] = [];
  let prev: ExplainerBeat | null = null;
  for (let line = 0; line < lineCount; line++) {
    const b = byLine.get(line);
    const bgId = String(b?.bg ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const bg = seen.has(bgId) ? bgId : (prev?.bg ?? backgrounds[0].id);
    const focusRaw = Array.isArray(b?.focus) ? b.focus : null;
    const focus =
      focusRaw && num01(focusRaw[0]) !== undefined && num01(focusRaw[1]) !== undefined
        ? ([num01(focusRaw[0])!, num01(focusRaw[1])!] as [number, number])
        : undefined;
    const c = b?.callout;
    const callout =
      c && typeof c.text === "string" && c.text.trim()
        ? {
            text: c.text.trim().split(/\s+/).slice(0, 4).join(" "),
            x: num01(c.x),
            y: num01(c.y),
            kind: pick(c.kind, ["circle", "arrow", "label"] as const, "label"),
          }
        : undefined;
    const beat: ExplainerBeat = {
      line,
      bg,
      camera: pick(b?.camera, EXPLAINER_CAMS, prev && prev.bg === bg ? "hold" : "push_in"),
      focus,
      place: pick(b?.place, EXPLAINER_PLACES, prev?.place ?? "left"),
      pose: pick(b?.pose, EXPLAINER_POSES, "explain"),
      mood: pick(b?.mood, EXPLAINER_MOODS, "happy"),
      prop: pick(b?.prop, EXPLAINER_PROPS, "none"),
      callout,
      transition: pick(b?.transition, EXPLAINER_TRANSITIONS, undefined),
    };
    beats.push(beat);
    prev = beat;
  }
  const used = new Set(beats.map((b) => b.bg));
  return {
    backgrounds: backgrounds.filter((b) => used.has(b.id) || b.id === raw.coverBg),
    beats,
    coverKicker: typeof raw.coverKicker === "string" ? raw.coverKicker : undefined,
    coverLine1: typeof raw.coverLine1 === "string" ? raw.coverLine1 : undefined,
    coverLine2: typeof raw.coverLine2 === "string" ? raw.coverLine2 : undefined,
    coverBg: typeof raw.coverBg === "string" && seen.has(raw.coverBg) ? raw.coverBg : undefined,
  };
};

/** AI art director: splits the script into beats and writes one English FLUX prompt per background. */
const directExplainer = async (
  scenes: GeneratedPlan["scenes"],
  topic: string,
  job?: StudioJob,
  model = VISUAL_MODEL,
  aspectRatio: StudioAspectRatio = "16:9",
): Promise<ExplainerDirection> => {
  const lines = flattenLines(scenes);
  const tall = aspectRatio !== "16:9";
  // ~1 background per 3–4 lines: each image costs ~1–2 min to draw locally, and the camera keeps moving on it.
  const targetBgs = Math.max(3, Math.min(40, Math.round(lines.length / 3.5)));
  if (job) {
    job.step = `${model} đang đạo diễn ${lines.length} beat & viết ${targetBgs} prompt ảnh nền…`;
    job.progress = 30;
    job.logs.push(`[Explainer Director] ${lines.length} lines → ~${targetBgs} backgrounds`);
  }
  const sys = `Bạn là Đạo diễn Hình ảnh cho kênh hoạt hình "Thầy Lá kể chuyện khoa học đời sống" (${tall ? "khung DỌC 9:16" : "khung ngang 16:9"}).
Người dẫn chuyện Thầy Lá là nhân vật người que vector được dựng sẵn, đứng TRƯỚC ảnh nền. Ảnh nền do AI vẽ (Z-Image-Turbo) theo phong cách minh họa nét mực, KHÔNG có người.
Nhiệm vụ: chia kịch bản (mỗi dòng có số thứ tự) thành các beat, và thiết kế danh sách ảnh nền sao cho cả video là MỘT CHUYẾN ĐI LIỀN MẠCH: cảnh sau nối tiếp cảnh trước (đi từ ngoài vào trong, từ to đến nhỏ, từ quá khứ đến hiện tại…).

QUY TẮC:
1. "backgrounds": khoảng ${targetBgs} ảnh nền. Mỗi ảnh dùng cho 2–5 dòng liên tiếp (camera sẽ chạy liên tục trên cùng một ảnh). id ngắn (a-z, 0-9, _).
   "prompt" bằng TIẾNG ANH, 25–60 từ, mô tả một cảnh RỘNG có chiều sâu: địa điểm, vật thể chính, ánh sáng, thời điểm, góc máy. ${tall ? "Ảnh DỌC: chủ thể chính ở nửa TRÊN khung hình, nửa dưới là mặt đất/sàn trống để nhân vật đứng." : "Bố cục chừa khoảng trống ở 1/3 bên trái hoặc bên phải để nhân vật đứng."} Tuyệt đối không có người, chữ, logo. Không cần ghi phong cách vẽ (hệ thống tự thêm).
   Với khái niệm trừu tượng hoặc vi mô (phân tử, tế bào, dòng điện, não bộ…), vẽ thành cảnh phóng to dạng mặt cắt, giống như đang đứng bên trong.
2. "beats": MỖI dòng kịch bản đúng 1 beat, "line" là số thứ tự dòng (bắt đầu từ 0), "bg" là id ảnh nền.
   - "camera": ${EXPLAINER_CAMS.join(" | ")} — đổi nhịp nhàng, beat cuối của một ảnh nên là pull_out hoặc pan để nối sang ảnh sau.
   - "focus": [x, y] từ 0 đến 1 — điểm đáng chú ý trên ảnh nền mà camera hướng tới.
   - "place": ${EXPLAINER_PLACES.join(" | ")} — vị trí Thầy Lá; đứng phía ĐỐI DIỆN với focus; dùng "off" cho cảnh toàn thật đẹp (tối đa 10% số beat).
   - "pose": ${EXPLAINER_POSES.join(" | ")}
   - "mood": ${EXPLAINER_MOODS.join(" | ")}
   - "prop": ${EXPLAINER_PROPS.join(" | ")} (đa số là "none")
   - "callout" (tùy chọn, khoảng 1/3 số beat): {"text": "1–3 chữ tiếng Việt (con số hoặc từ khóa)", "x": 0..1, "y": 0.15..0.65, "kind": "circle" | "arrow" | "label"} — chữ chú thích tự vẽ ra trên màn hình.
   - "transition" (chỉ ở beat ĐẦU của một ảnh nền mới): ${EXPLAINER_TRANSITIONS.join(" | ")}.
3. "coverKicker" (≤ 18 ký tự), "coverLine1" (≤ 14 ký tự), "coverLine2" (≤ 12 ký tự, cú đấm thị giác), "coverBg" (id ảnh nền đẹp nhất làm thumbnail).

Trả về DUY NHẤT 1 JSON object hợp lệ (không markdown):
{"backgrounds":[{"id":"street_dawn","prompt":"..."}],"beats":[{"line":0,"bg":"street_dawn","camera":"push_in","focus":[0.65,0.45],"place":"left","pose":"explain","mood":"idea","prop":"none","transition":"fade","callout":{"text":"100°C","x":0.66,"y":0.4,"kind":"circle"}}],"coverKicker":"...","coverLine1":"...","coverLine2":"...","coverBg":"street_dawn"}`;
  const body = `${sys}\n\nCHỦ ĐỀ: ${topic.slice(0, 300)}\n\nKỊCH BẢN (${lines.length} dòng):\n${lines
    .map((l, i) => `${i}. [${l.scene}] ${l.text}`)
    .join("\n")}`;
  const raw = await runAgyPrompt(body, model, Math.round(300 + lines.length * 4), job);
  let parsed: any = null;
  if (raw) {
    const m = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").match(/\{[\s\S]*\}/);
    try {
      parsed = m ? JSON.parse(m[0]) : null;
    } catch (e) {
      job?.logs.push(`[Explainer Director] JSON parse failed: ${(e as Error).message}`);
    }
  }
  const dir = sanitizeDirection(parsed, lines.length);
  if (!dir) {
    job?.logs.push("[Explainer Director] AI direction unavailable → fallback backgrounds per act");
    return buildFallbackDirection(scenes);
  }
  job?.logs.push(`[Explainer Director] ${dir.beats.length} beats, ${dir.backgrounds.length} backgrounds`);
  return dir;
};

export const writeExplainerFiles = (
  dir: string,
  plan: GeneratedPlan,
  direction: ExplainerDirection,
  aspectRatio: StudioAspectRatio,
) => {
  writeFileSync(join(dir, "explainer.json"), `${JSON.stringify(direction, null, 2)}\n`);
  const bgPath = join(dir, "backgrounds.json");
  // Keep already-rendered images; new ids start as tint placeholders until `bun run bg`.
  const old: { id: string; src: string | null }[] = existsSync(bgPath)
    ? (() => {
        try {
          return JSON.parse(readFileSync(bgPath, "utf8"));
        } catch {
          return [];
        }
      })()
    : [];
  writeFileSync(
    bgPath,
    `${JSON.stringify(
      direction.backgrounds.map((b) => ({ id: b.id, src: old.find((o) => o.id === b.id)?.src ?? null })),
      null,
      2,
    )}\n`,
  );

  writeFileSync(
    join(dir, "World.tsx"),
    `import React from "react";
import {ExplainerStage} from "../../shared/explainer/ExplainerStage";
import type {ExplainerBackground, ExplainerBeat} from "../../shared/explainer/types";
import backgrounds from "./backgrounds.json";
import plan from "./explainer.json";
import {DURATION, VOICE} from "./timing";

export const World: React.FC = () => (
  <ExplainerStage
    beats={plan.beats as ExplainerBeat[]}
    backgrounds={backgrounds as ExplainerBackground[]}
    voice={VOICE}
    duration={DURATION}
  />
);
`,
  );

  writeFileSync(
    join(dir, "scenes.tsx"),
    `import React from "react";
import {AbsoluteFill} from "remotion";
import type {SceneComponent} from "../../shared/frame/ShortsTemplate";

const WorldOnly: SceneComponent = () => <AbsoluteFill />;

export const scenes: Record<string, SceneComponent> = {
  hook: WorldOnly,
  problem: WorldOnly,
  layer1: WorldOnly,
  layer2: WorldOnly,
  hardest: WorldOnly,
  payoff: WorldOnly,
  share: WorldOnly,
};
`,
  );

  const kicker = trimWords(direction.coverKicker || plan.coverKicker || "THẦY LÁ GIẢI THÍCH", 22);
  const line1 = trimWords(direction.coverLine1 || plan.coverLine1 || "VÌ SAO", 18);
  const line2 = trimWords(direction.coverLine2 || plan.coverLine2 || "LẠI THẾ?", 16);
  const coverBg = direction.coverBg || direction.backgrounds[0]?.id || "";
  writeFileSync(
    join(dir, "Cover.tsx"),
    `import React from "react";
import {AbsoluteFill, Img, staticFile, useVideoConfig} from "remotion";
import {ThayLa} from "../../shared/explainer/ThayLa";
import {SafeCheck} from "../../shared/frame/SafeCheck";
import {FONT} from "../../shared/theme";
import backgrounds from "./backgrounds.json";

const BG = (backgrounds as {id: string; src: string | null}[]).find((b) => b.id === ${JSON.stringify(coverBg)})
  ?? (backgrounds as {id: string; src: string | null}[]).find((b) => b.src);
const STROKE = "0 0 0 #000, 6px 6px 0 #111827, -3px -3px 0 #111827, 3px -3px 0 #111827, -3px 3px 0 #111827";

export const Cover: React.FC<{safe: boolean}> = ({safe}) => {
  const {width, height} = useVideoConfig();
  const wide = width > height;
  const s = Math.min(width, height) / 1080;
  return (
    <SafeCheck safe={safe} cover>
    <AbsoluteFill style={{background: "#0B1220", fontFamily: FONT.sans}}>
      {BG?.src ? (
        <Img src={staticFile(BG.src)} style={{width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.06)"}} />
      ) : null}
      <AbsoluteFill style={{background: wide
        ? "linear-gradient(90deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 55%, rgba(0,0,0,0) 100%)"
        : "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.1) 50%, rgba(0,0,0,0.35) 100%)"}} />
      <div style={{position: "absolute", left: 70 * s, top: (wide ? 120 : 220) * s, width: wide ? width * 0.58 : width - 140 * s}}>
        <div style={{display: "inline-block", background: "#FACC15", color: "#111827", fontWeight: 900, fontSize: 40 * s, padding: \`\${8 * s}px \${26 * s}px\`, borderRadius: 999, border: \`\${4 * s}px solid #111827\`}}>${kicker}</div>
        <div style={{color: "#FFFFFF", fontWeight: 900, fontSize: 150 * s, lineHeight: 1.02, marginTop: 24 * s, textShadow: STROKE, letterSpacing: -2}}>${line1}</div>
        <div style={{color: "#FDE047", fontWeight: 900, fontSize: 170 * s, lineHeight: 1.02, textShadow: STROKE, letterSpacing: -2}}>${line2}</div>
      </div>
      <svg width={width} height={height} style={{position: "absolute", left: 0, top: 0}}>
        <ThayLa x={wide ? width * 0.8 : width * 0.62} y={height * 0.98} scale={(wide ? 3.3 : 3.6) * s} pose="point" mood="shock" flip />
      </svg>
    </AbsoluteFill>
    </SafeCheck>
  );
};
`,
  );

  if (aspectRatio === "16:9") writeEntryTsx(dir, aspectRatio);
};

/** Render (or reuse) every AI background of a video, updating job progress between `from` and `to`. */
const renderExplainerBackgrounds = async (id: string, job: StudioJob, from: number, to: number) => {
  job.step = "Đang vẽ ảnh nền AI (Z-Image-Turbo, chạy trên máy)…";
  job.progress = from;
  const t0 = Date.now();
  const res = await buildVideoBackgrounds(id, {
    onProgress: (d, n, bg) => {
      job.progress = Math.round(from + ((to - from) * d) / Math.max(1, n));
      job.step = `Đang vẽ ảnh nền AI ${d}/${n} (${bg})…`;
    },
    log: (s) => job.logs.push(s),
  });
  const ok = res.filter((r) => r.src).length;
  job.logs.push(`[bg] ${ok}/${res.length} ảnh nền sẵn sàng sau ${Math.round((Date.now() - t0) / 1000)}s`);
};

const writeVideoTsx = (dir: string, opts: { horrorBed?: boolean } = {}) => {
  if (!existsSync(join(dir, "sfx.json"))) writeFileSync(join(dir, "sfx.json"), "[]\n");
  if (!existsSync(join(dir, "ambience.json"))) writeFileSync(join(dir, "ambience.json"), "[]\n");
  const video = `import React from "react";
import {Html5Audio, interpolate, staticFile} from "remotion";
import {StoryAudio, musicFor} from "../../shared/audio/StoryAudio";
import {storySfxCues, type SfxCue} from "../../shared/audio/Sfx";
import {ShortsTemplate} from "../../shared/frame/ShortsTemplate";
import {DEFAULT_PALETTE} from "../../shared/theme";
import {scenes} from "./scenes";
import storySfx from "./sfx.json";
import ambienceItems from "./ambience.json";
import {FPS, OUTRO_HOLD, TIMINGS, VOICE} from "./timing";
import {World} from "./World";

const sceneStart = (id: string) => TIMINGS.find((t) => t.id === id)?.from ?? 0;

const STORY_CUES = storySfxCues(storySfx as {line: number; id: string; pause?: number}[], VOICE.lines, FPS);
const SFX_CUES: SfxCue[] = STORY_CUES.length
  ? STORY_CUES
  : [
      {at: sceneStart("layer2") + 8, id: "pop"},
      {at: sceneStart("payoff") + 8, id: "ding"},
    ];
${opts.horrorBed ? `
/** Real music bed + per-scene ambience (crickets, rain, wind, clock…) under the story. */
const Bed: React.FC = () => (
  <StoryAudio voice={VOICE} softFrom={sceneStart("layer2")} music={musicFor(${JSON.stringify("__ID__")})} ambience={ambienceItems as {line: number; id: string}[]} />
);
` : ""}
export const Video: React.FC<{safe: boolean}> = ({safe}) => (
  <ShortsTemplate
    voice={VOICE}
    fps={FPS}
    outroHold={OUTRO_HOLD}
    scenes={scenes}
    palette={DEFAULT_PALETTE}
    safe={safe}
    background={${opts.horrorBed ? "<><World /><Bed /></>" : "<World />"}}
    sfx={SFX_CUES}
  />
);
`;
  writeFileSync(join(dir, "Video.tsx"), video.replace("__ID__", dir.split("/").pop() ?? "story"));
};

const ensureFactForVideo = (id: string, prompt: string): string => {
  const factsPath = join(REPO, "docs", "facts", "facts.json");
  const sourcesPath = join(REPO, "docs", "facts", "sources.json");
  const facts = JSON.parse(readFileSync(factsPath, "utf8")) as any[];
  const sources = JSON.parse(readFileSync(sourcesPath, "utf8")) as any[];
  const srcId = sources[0]?.id ?? "s-0001";
  const factId = `f-studio-${id}`.slice(0, 24);
  const existing = facts.find((f) => f.id === factId);
  const allScenes = [
    "hook",
    "problem",
    "layer1",
    "layer2",
    "hardest",
    "payoff",
  ];
  if (!existing) {
    facts.push({
      id: factId,
      claim: prompt.slice(0, 140) || `Dữ kiện nội dung cho video ${id}`,
      value: id,
      status: "verified",
      sources: [srcId],
      checkedAt: new Date().toISOString().slice(0, 10),
      usedIn: [{ video: id, scenes: allScenes }],
    });
  } else {
    existing.usedIn = [{ video: id, scenes: allScenes }];
  }
  writeFileSync(factsPath, `${JSON.stringify(facts, null, 2)}\n`);
  return factId;
};

const runStepCmd = async (
  job: StudioJob,
  label: string,
  progress: number,
  args: string[],
) => {
  throwIfCancelled(job);
  job.step = label;
  job.progress = progress;
  job.logs.push(`$ bun ${args.join(" ")}`);
  const proc = Bun.spawn([process.execPath, ...args], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
    env: {
      ...process.env,
      // mac dev-box paths only on mac/linux (":" would corrupt a Windows PATH, which uses ";")
      PATH:
        process.platform === "win32"
          ? (process.env.PATH ?? "")
          : `/Users/letrongthien/.bun/bin:/opt/homebrew/bin:${process.env.PATH ?? ""}`,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });
  attachJobProc(job, proc);
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  throwIfCancelled(job);
  const out = `${stdout}\n${stderr}`.trim();
  if (out) job.logs.push(out.slice(-600));
  if (code !== 0)
    throw new Error(
      `Bước "${label}" thất bại (code ${code}): ${out.slice(-300)}`,
    );
};

const syncStoryboard = (id: string) => {
  const dir = join(REPO, "src", "videos", id);
  const nar = JSON.parse(readFileSync(join(dir, "narration.json"), "utf8"));
  const lines: string[] = nar.scenes.flatMap((s: any) =>
    s.lines.map((l: any) => l.text),
  );
  const shots = lines.map((lineText, i) => ({
    id: `s${String(i + 1).padStart(2, "0")}`,
    line: i,
    lineText,
    anchor: null,
    camera: i === 0 ? "Push-in mở màn" : "Chuyển động camera theo nhịp thoại",
    onScreen: `Hoạt cảnh minh họa cho câu ${i + 1}`,
    text: null,
    visual: nar.visual?.[0] ?? "illustrated-scene",
    transition: i === 0 ? "cut" : "continuous",
    sfx: null,
    status: "built",
  }));
  writeFileSync(
    join(dir, "storyboard.json"),
    `${JSON.stringify({ shots }, null, 2)}\n`,
  );
};

const SPIRIT_TONE =
  "DEFAULT SETTING: an old-times Vietnamese village (rice fields, bamboo hedges, thatched or old wooden houses, " +
  "banyan trees, village temple, well, dirt paths, oil lamps) unless the story clearly happens in a city or the present day. " +
  "Match the story's ERA everywhere: old times (before electricity, 'ngày xưa', grandparents' youth) → thatched or wooden houses, " +
  "oil lamps, dirt paths, bamboo fences, wells, no power poles, no motorbikes, no modern objects; 1970s–90s countryside → simple brick houses, " +
  "bicycles, light bulbs; present day only if the story says so. " +
  "Story beats (hook, problem, layer1): eerie Vietnamese night scenes — misty village roads, old banyan trees, abandoned temples, " +
  "old wooden houses, moonlight, lanterns; mysterious, never gory. Decoding beats (layer2 onward): STAY IN THE STORY'S WORLD (the same village house, bedroom, garden) in calmer dawn or " +
  "morning light, and illustrate the explanation with the story's own moments (a woman lying frozen in bed with a dark shape by the door, " +
  "an old man sitting quietly on the porch at dawn). NEVER labs, hospitals, screens, brain diagrams or modern offices.";

/** Stickman styles: plan one backdrop per beat from the voiced narration, draw them, write backdrops.json. */
const buildStickmanBackdrops = async (
  id: string,
  topic: string,
  job: StudioJob,
  model: string,
  aspectRatio: StudioAspectRatio,
  style: StudioStyle,
  from: number,
  to: number,
) => {
  if (process.env.STICKMAN_AI_BG === "0") return;
  const dir = join(REPO, "src", "videos", id);
  try {
    const nar = JSON.parse(readFileSync(join(dir, "narration.json"), "utf8"));
    const scenes = (nar.scenes as any[]).map((sc) => ({ id: sc.id, lines: (sc.lines as any[]).map((l) => l.text) }));
    job.step = "AI đang lên bối cảnh nền theo từng câu thoại…";
    job.progress = from;
    const ui = storyUi(job);
    const plan = await planBackdrops(scenes, topic, (p, t) => runAgyPrompt(p, model, t, job), {
      aspectRatio,
      toneHint: style === "spirit" ? SPIRIT_TONE : undefined,
      log: ui.log,
      recurringSets: style === "spirit",
      perLine: style === "spirit",
    });
    if (!plan.length) return;
    const items = await renderBackdrops(id, plan, aspectRatio, ui, from + 2, to, style === "spirit" ? "spirit" : "default", analyzeFloor);
    writeBackdrops(dir, items);
  } catch (e) {
    job.logs.push(`[Backdrop] bỏ qua nền AI: ${(e as Error).message}`);
  }
};

/**
 * Look at a background and return where its ground line is (0..1 from the top): the open floor nearest the viewer,
 * where a standing figure's feet go. Uses Claude with read access to that one image file; null when unsure.
 */
const FLOOR_MODEL = process.env.FLOOR_MODEL || "claude-sonnet-5-5";
const analyzeFloor = async (absImage: string): Promise<number | null> => {
  const prompt =
    `Read the image file ${absImage}. It is a background for a 2D cartoon; small stick figures will be drawn standing on it.\n` +
    `Find the open, walkable ground/floor area nearest the viewer (yard, road, floorboards, earth) that is NOT covered by furniture, beds, walls, water or bushes.\n` +
    `Answer with ONE number only, between 0 and 1: the vertical position (fraction of the image height, 0 = top, 1 = bottom) ` +
    `where a person standing in the middle of that open floor area would put their feet. No other text.`;
  try {
    const proc = Bun.spawn(
      [resolveClaudeBin(), "-p", "--model", FLOOR_MODEL, "--tools", "Read", "--allowedTools", "Read", "--output-format", "text", "--no-session-persistence"],
      { cwd: REPO, stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" },
    );
    const timer = setTimeout(() => proc.kill(), 120_000);
    const out = await new Response(proc.stdout).text();
    clearTimeout(timer);
    // the answer may come with a sentence of reasoning: take the LAST 0.xx number
    const all = out.match(/\b0?\.\d{1,4}\b/g) ?? [];
    const v = all.length ? Number(all[all.length - 1]) : NaN;
    return Number.isFinite(v) && v >= 0.35 && v <= 0.99 ? Math.round(v * 1000) / 1000 : null;
  } catch {
    return null;
  }
};

const storyUi = (job: StudioJob) => ({
  step: (s: string, progress?: number) => {
    job.step = s;
    if (progress !== undefined) job.progress = progress;
  },
  log: (s: string) => job.logs.push(s),
});

/** "Kể chuyện bằng tranh": bible + chapters → tts → Gemini sheets/panels + Veo clips → render → hand-off. */
const runStoryCreate = async (
  job: StudioJob,
  id: string,
  prompt: string,
  duration: StudioDuration,
  aspectRatio: StudioAspectRatio,
  voice: { engine: string; voice: string },
  model: string,
) => {
  const dir = join(REPO, "src", "videos", id);
  const outDir = join(REPO, aspectRatio === "16:9" ? "out-long" : "out", id);
  mkdirSync(outDir, { recursive: true });
  const ui = storyUi(job);
  const minutes = DURATION_MINUTES[duration] ?? 3.5;

  const plan = await writeStoryPlan(
    prompt,
    minutes,
    SPOKEN_WORDS_PER_MIN,
    aspectRatio,
    (p, t) => runAgyPrompt(p, model, t, job),
    ui,
  );
  const panelCount = plan.chapters.reduce((n, c) => n + c.panels.length, 0);
  job.logs.push(`[Story] "${plan.title}": ${plan.characters.length} nhân vật, ${plan.chapters.length} chương, ${panelCount} tranh`);

  const factId = ensureFactForVideo(id, prompt);
  writeFileSync(
    join(REPO, "briefs", `${id}.md`),
    `# Brief: ${id}\n\n- **Prompt:** ${prompt.slice(0, 2000)}\n- **Aspect Ratio:** ${aspectRatio}\n- **Style:** story\n- **Voice:** ${voice.engine}:${voice.voice}\n`,
  );
  const { acts } = storyActs(plan);
  const narration = {
    id,
    flow: "H",
    aspectRatio,
    visual: ["illustrated-scene", "text-as-image"],
    language: "vi",
    voice: { engine: voice.engine, voice: voice.voice, tempo: 1.0 },
    pause: { line: 0.35, scene: 0.65 },
    outroHold: 0,
    pronounce: {},
    spelling: {},
    scenes: Object.entries(acts).map(([sid, lines]) => ({
      id: sid,
      lines: lines.map((t) => ({ text: sanitizeSpoken(t), ...(sid === "share" ? {} : { fact: factId }) })),
    })),
  };
  writeFileSync(join(dir, "narration.json"), `${JSON.stringify(narration, null, 2)}\n`);
  writeStoryFiles(dir, plan, null);
  if (aspectRatio === "16:9") writeEntryTsx(dir, aspectRatio);
  writeVideoTsx(dir);
  writeFileSync(join(outDir, "caption.txt"), `${plan.caption || plan.title}\n`);
  writeFileSync(join(outDir, "pinned-comment.txt"), `${plan.pinned || "Bạn nghĩ sao về câu chuyện này?"}\n`);

  await runStepCmd(job, `Đang lồng tiếng bằng giọng ${voice.voice} (${voice.engine})…`, 32, ["run", "tts", id, "--force"]);
  syncStoryboard(id);

  const assets = await renderStoryAssets(id, plan, aspectRatio, ui, 35, 80);
  writeStoryFiles(dir, plan, assets);

  await runStepCmd(job, "Đang dựng & kết xuất video (bun run render)", 82, ["run", "render", id]);
  await runStepCmd(job, "Đang tạo ảnh bìa (bun run cover)", 90, ["run", "cover", id]);
  await runStepCmd(job, "Chụp frame kiểm tra (bun run still)", 92, ["run", "still", id, "--frame=180", "--safe"]);
  await runStepCmd(job, "Chuẩn hóa âm lượng -13 LUFS (bun run normalize)", 95, ["run", "normalize", id]);
  await runStepCmd(job, "Đóng gói MP4 (bun run encode)", 97, ["run", "encode", id]);

  job.step = "Đang đẩy video lên S3 + Database…";
  job.progress = 99;
  try {
    const mainPort = process.env.MAIN_SERVER_PORT || process.env.PORT || "3400";
    const r = await fetch(`http://127.0.0.1:${mainPort}/api/shorts-studio/sync/${encodeURIComponent(id)}`, { method: "POST" });
    if (r.ok) job.logs.push(`[S3 & DB Sync] Đã đồng bộ ${id}`);
  } catch (e) {
    job.logs.push(`[S3 & DB Sync] Sẽ tự đồng bộ khi Web chính kết nối: ${(e as Error).message}`);
  }
  const missing = assets.images.filter((x) => !x).length;
  job.status = "done";
  job.step = `Hoàn tất! ${panelCount - missing}/${panelCount} tranh, ${assets.clips.filter(Boolean).length} clip.${missing ? " (Tranh thiếu dùng nền màu — bấm Render lại để vẽ bù.)" : ""}`;
  job.progress = 100;
  job.finishedAt = Date.now();
};

/** Cut the narration into chapters of about `targetSec` seconds, always at a line boundary. */
export const planChapters = (lines: { start: number; end: number }[], total: number, targetSec = 120): { from: number; to: number }[] => {
  if (!lines.length) return [{ from: 0, to: total }];
  const out: { from: number; to: number }[] = [];
  let from = 0;
  for (let i = 0; i < lines.length; i++) {
    const last = i === lines.length - 1;
    if (last || lines[i].end - from >= targetSec) {
      const to = last ? total : (lines[i].end + lines[i + 1].start) / 2;
      out.push({ from, to });
      from = to;
    }
  }
  // a short tail is folded into the previous chapter
  if (out.length > 1 && out[out.length - 1].to - out[out.length - 1].from < targetSec * 0.35) {
    const tail = out.pop()!;
    out[out.length - 1].to = tail.to;
  }
  return out;
};

/** Render a half-size draft per chapter and wait for the user's Next after each one. */
const reviewChapters = async (job: StudioJob, id: string, aspectRatio: StudioAspectRatio) => {
  const vpath = join(REPO, "src", "videos", id, "voice.json");
  const voice = JSON.parse(readFileSync(vpath, "utf8")) as { duration: number; lines: { start: number; end: number }[] };
  const plan = planChapters(voice.lines, voice.duration);
  const folder = aspectRatio === "16:9" ? "out-long" : "out";
  job.chapters = plan.map((c, i) => ({
    n: i + 1,
    from: Math.round(c.from * 10) / 10,
    to: Math.round(c.to * 10) / 10,
    file: `${folder}/${id}/chapters/ch${String(i + 1).padStart(2, "0")}.mp4`,
    v: 0,
  }));
  job.logs.push(`[Duyệt chương] ${plan.length} chương (~2 phút/chương): ${job.chapters.map((c) => `${c.from}–${c.to}s`).join(", ")}`);
  for (let i = 0; i < plan.length; i++) {
    const ch = job.chapters[i];
    for (;;) {
      throwIfCancelled(job);
      job.status = "running";
      job.reviewIndex = undefined;
      await runStepCmd(job, `Đang dựng bản xem thử chương ${ch.n}/${plan.length} (${ch.from}–${ch.to}s)…`, 64, [
        "run", "chapter", id, `--from=${ch.from}`, `--to=${ch.to}`, `--n=${ch.n}`,
      ]);
      ch.v = Date.now();
      job.status = "review";
      job.reviewIndex = ch.n;
      job.step = `⏸ Chương ${ch.n}/${plan.length} đã xong, xem rồi bấm "Tiếp tục" (hoặc "Dựng lại chương")`;
      const answer = await new Promise<GateAnswer>((resolve, reject) => gates.set(id, { resolve, reject }));
      if (answer === "next") break;
    }
  }
  job.status = "running";
  job.reviewIndex = undefined;
  job.logs.push("[Duyệt chương] Đã duyệt hết các chương, đang dựng bản hoàn chỉnh…");
};

export const startCreateAndRender = (opts: {
  id?: string;
  prompt: string;
  style?: StudioStyle;
  mode?: StudioMode;
  duration?: StudioDuration;
  aspectRatio?: StudioAspectRatio;
  voiceId?: string;
  model?: string;
  /** "chapter": pause after every ~2 min draft chapter until the user presses Next. */
  reviewMode?: "chapter" | "all";
}): StudioJob => {
  const style: StudioStyle = opts.style ?? "stickman";
  const mode: StudioMode = opts.mode ?? "ai";
  // One pick from the UI drives both the scriptwriter and the visual director.
  const chosenModel = pickStudioModel(opts.model);
  const scriptModel = chosenModel ?? OPUS_BOSS_MODEL;
  const visualModel = chosenModel ?? VISUAL_MODEL;
  const modelLabel = STUDIO_AI_MODELS[scriptModel] ?? scriptModel;
  const aspectRatio: StudioAspectRatio = opts.aspectRatio === "16:9" ? "16:9" : "9:16";
  const auto = opts.duration === "auto" ? resolveAutoDuration(opts.prompt, opts.style ?? "stickman", aspectRatio) : null;
  let duration: StudioDuration = auto?.duration ?? opts.duration ?? (aspectRatio === "16:9" ? "story" : "medium");
  const voiceId = opts.voiceId ?? "vieneu:Mai Bé Phương";
  // Ghost-story flow: Anh Minh B is ALWAYS the narrator, whatever the dropdown says.
  const chosenVoice = parseVoiceOption(style === "spirit" ? "vieneu:Anh Minh B" : voiceId);

  let id = opts.id
    ? slugify(opts.id)
    : slugify(opts.prompt.split(/\r?\n/)[0] ?? "video");
  if (id.startsWith("_")) id = `v-${id}`;
  if (existsSync(join(REPO, "src", "videos", id))) {
    id = `${id.slice(0, 22)}-${Date.now().toString(36).slice(-3)}`;
  }

  const job: StudioJob = {
    id,
    style,
    mode,
    aspectRatio,
    voiceId,
    prompt: opts.prompt,
    status: "running",
    step: `Đang khởi tạo khung video (${aspectRatio === "16:9" ? "Màn ngang 16:9" : "Shorts 9:16"})…`,
    progress: 5,
    logs: [],
    startedAt: Date.now(),
    reviewMode: opts.reviewMode === "chapter" ? "chapter" : "all",
  };
  if (auto) {
    job.logs.push(
      `[Thời lượng tự động] ${auto.words} chữ đầu vào → ~${auto.minutes.toFixed(1)} phút → chọn "${durationLabelOf(auto.duration)}"`,
    );
  }
  cancelledJobs.delete(id);
  jobs.set(id, job);

  (async () => {
    try {
      const visualArg =
        style === "vietnam-map"
          ? "satellite-map,text-as-image"
          : "illustrated-scene,text-as-image";
      await runStepCmd(job, "Khởi tạo khung dự án (bun run new)", 10, [
        "run",
        "new",
        id,
        "--flow",
        "H",
        "--visual",
        visualArg,
      ]);

      // A ghost-story topic carrying a story link → read every chapter, retell from the full text.
      const storyUrl = style === "spirit" || style === "story" ? findStoryUrl(opts.prompt) : null;
      if (storyUrl) {
        job.step = "Đang đọc toàn bộ truyện từ link (tự sang các chương)…";
        job.progress = 14;
        try {
          const st = await fetchStoryFromUrl(storyUrl, (l) => job.logs.push(l));
          job.logs.push(`[Truyện] "${st.title}": ${st.chapters.length} chương, ${st.words} chữ`);
          opts.prompt = `${opts.prompt}\n\nTƯ LIỆU GỐC (${st.chapters.length} chương — KỂ LẠI bằng lời mới, đổi tên người & chi tiết nhận dạng, KHÔNG chép nguyên văn; giữ diễn biến và các chi tiết rợn chính):\n${st.text}`;
          if (opts.duration === "auto") {
            const a = resolveAutoDuration(st.text, style, aspectRatio);
            duration = a.duration;
            job.logs.push(`[Thời lượng tự động] Truyện ${a.words} chữ → ~${a.minutes.toFixed(1)} phút → chọn "${durationLabelOf(a.duration)}"`);
          }
        } catch (e) {
          job.logs.push(`[Truyện] Không đọc được truyện từ link (${(e as Error).message}) → viết từ tiêu đề/tóm tắt`);
        }
      }

      if (style === "story") {
        await runStoryCreate(job, id, opts.prompt, duration, aspectRatio, chosenVoice, scriptModel);
        return;
      }

      const durationLabel =
        duration === "epic"
          ? "8–10 phút"
          : duration === "deep"
            ? "5–6 phút"
            : duration === "story"
              ? "3–4 phút"
              : duration === "long"
                ? "2–3 phút"
                : duration === "medium"
                  ? "1–1.5 phút"
                  : "~40 giây";
      job.step =
        mode === "ai"
          ? `${modelLabel} đang sáng tác kịch bản (${durationLabel} • ${aspectRatio})…`
          : "Đang phân tích kịch bản có sẵn & thiết kế nhân vật/đồ vật…";
      job.progress = 20;
      let plan =
        (mode === "ai"
          ? await callAgyJson(
              opts.prompt,
              job,
              scriptModel,
              OPUS_BOSS_MODEL,
              duration,
              aspectRatio,
              style,
              visualModel,
            )
          : null) ?? buildFallbackPlan(opts.prompt);
      if (style !== "stickman-explainer" && !plan.stickmanActs?.length) {
        const vis = await designVisualsFromScenes(
          plan.scenes,
          opts.prompt,
          job,
          visualModel,
          style,
        );
        plan = { ...plan, ...vis, scenes: plan.scenes };
      }

      const factId = ensureFactForVideo(id, opts.prompt);
      const dir = join(REPO, "src", "videos", id);
      const outDir = join(REPO, aspectRatio === "16:9" ? "out-long" : "out", id);
      mkdirSync(outDir, { recursive: true });

      writeFileSync(
        join(REPO, "briefs", `${id}.md`),
        `# Brief: ${id}\n\n- **Prompt:** ${opts.prompt}\n- **Aspect Ratio:** ${aspectRatio}\n- **Flow:** H\n- **Style:** ${style}\n- **Voice:** ${chosenVoice.engine}:${chosenVoice.voice}\n`,
      );

      const sceneOrder = [
        "hook",
        "problem",
        "layer1",
        "layer2",
        "hardest",
        "payoff",
        "share",
      ] as const;
      // Multi-voice (spirit): every "{Role}" line gets a fixed voice from the narrator's region.
      const storyCast =
        style === "spirit"
          ? castVoices(
              Object.values(plan.scenes).flat().map((t) => splitRole(String(t)).role).filter((r): r is string => Boolean(r)),
              chosenVoice.voice,
            )
          : {};
      if (Object.keys(storyCast).length) {
        job.logs.push(`[Giọng nhân vật] ${Object.entries(storyCast).map(([r, c]) => `${r} → ${c.voice}${c.fx ? ` (${({ ghost: "giọng ma", elder: "giọng già", child: "giọng trẻ con" } as const)[c.fx]})` : ""}`).join(", ")}`);
      }
      const narration = {
        id,
        flow: "H",
        aspectRatio,
        visual: visualArg.split(","),
        language: "vi",
        voice: {
          engine: chosenVoice.engine,
          voice: chosenVoice.voice,
          tempo: style === "spirit" ? 0.86 : 1.0,
          // deeper narrator for ghost stories — except cloned voices, which already sound as recorded
          ...(style === "spirit" && !isClonedVoice(chosenVoice.voice) ? { pitch: Number(process.env.SPIRIT_NARRATOR_PITCH || 0.9) } : {}),
        },
        pause: style === "spirit" ? { line: 0.6, scene: 1.0, adaptive: true } : { line: 0.35, scene: 0.65 },
        outroHold: 0,
        pronounce: {},
        spelling: {},
        scenes: sceneOrder.map((sid) => {
          const rawArr = plan.scenes[sid]?.length
            ? plan.scenes[sid]
            : [
                "Hãy cùng khám phá chi tiết thú vị ngay trong phân cảnh tiếp theo này nhé.",
              ];
          const beats = plan.stickmanActs?.find((a) => a.id === sid)?.lineBeats ?? [];
          return {
            id: sid,
            lines: rawArr.map((t, li) => {
              const { role, text } = style === "spirit" ? splitRole(t) : { role: null, text: t };
              const cast = role ? storyCast[role] : undefined;
              const pause = Number(beats[li]?.sfxPause) || 0;
              return {
                text: sanitizeSpoken(text),
                ...(sid === "share" ? {} : { fact: factId }),
                ...(cast ? { role, voice: cast.voice, ...(cast.fx ? { fx: cast.fx } : {}) } : {}),
                ...(beats[li]?.sfx && pause > 0 ? { holdAfter: Math.min(3, pause) } : {}),
              };
            }),
          };
        }),
      };
      writeFileSync(
        join(dir, "narration.json"),
        `${JSON.stringify(narration, null, 2)}\n`,
      );
      // Story sound effects chosen per line by the visual director (lineBeats[].sfx) → sfx.json (global line index).
      {
        const items: { line: number; id: string; pause?: number }[] = [];
        let g = 0;
        for (const sid of sceneOrder) {
          const n = narration.scenes.find((x) => x.id === sid)?.lines.length ?? 0;
          const beats = plan.stickmanActs?.find((a) => a.id === sid)?.lineBeats ?? [];
          for (let li = 0; li < n; li++) {
            const b = beats[li];
            if (b?.sfx) items.push({ line: g + li, id: String(b.sfx), ...(Number(b.sfxPause) > 0 ? { pause: Number(b.sfxPause) } : {}) });
          }
          g += n;
        }
        writeFileSync(join(dir, "sfx.json"), `${JSON.stringify(items, null, 2)}\n`);
        // scene ambience changes (lineBeats[].ambience) → ambience.json
        const amb: { line: number; id: string }[] = [];
        let ga = 0;
        for (const sid of sceneOrder) {
          const n = narration.scenes.find((x) => x.id === sid)?.lines.length ?? 0;
          const beats = plan.stickmanActs?.find((a) => a.id === sid)?.lineBeats ?? [];
          for (let li = 0; li < n; li++) {
            const a = (beats[li] as any)?.ambience;
            if (typeof a === "string") amb.push({ line: ga + li, id: a });
          }
          ga += n;
        }
        writeFileSync(join(dir, "ambience.json"), `${JSON.stringify(amb, null, 2)}\n`);
        if (items.length) job.logs.push(`[SFX] ${items.length} tiếng động: ${items.map((i) => i.id).join(", ")}`);
      }

      if (style === "stickman-explainer") {
        const direction = await directExplainer(plan.scenes, opts.prompt, job, visualModel, aspectRatio);
        writeExplainerFiles(dir, plan, direction, aspectRatio);
      } else if (style === "vietnam-map") writeVietnamMapFiles(dir, plan);
      else if (style === "nature-sky") writeNatureSkyFiles(dir, plan);
      else if (style === "infographic") writeInfographicFiles(dir, plan);
      else writeStickmanFiles(dir, plan, aspectRatio, style === "spirit");
      if (style !== "stickman" && aspectRatio === "16:9") {
        writeEntryTsx(dir, aspectRatio);
      }
      writeVideoTsx(dir, { horrorBed: style === "spirit" });

      writeFileSync(
        join(outDir, "caption.txt"),
        `${plan.caption || opts.prompt}\n`,
      );
      writeFileSync(
        join(outDir, "pinned-comment.txt"),
        `${plan.pinned || "Bạn nghĩ sao về chủ đề này? Bình luận bên dưới nhé!"}\n`,
      );

      await runStepCmd(
        job,
        `Đang lồng tiếng bằng giọng ${chosenVoice.voice} (${chosenVoice.engine})…`,
        40,
        ["run", "tts", id, "--force"],
      );
      syncStoryboard(id);
      if (style === "stickman-explainer") await renderExplainerBackgrounds(id, job, 50, 64);
      if (style === "stickman" || style === "spirit") await buildStickmanBackdrops(id, opts.prompt, job, visualModel, aspectRatio, style, 50, 64);
      if (job.reviewMode === "chapter") await reviewChapters(job, id, aspectRatio);

      await runStepCmd(
        job,
        "Đang dựng & kết xuất đồ họa video (bun run render)",
        65,
        ["run", "render", id],
      );
      await runStepCmd(
        job,
        "Đang tạo ảnh bìa & ảnh kiểm tra (bun run cover)",
        82,
        ["run", "cover", id],
      );
      await runStepCmd(
        job,
        "Chụp frame kiểm tra vùng an toàn (bun run still)",
        88,
        ["run", "still", id, "--frame=180", "--safe"],
      );
      await runStepCmd(
        job,
        "Chuẩn hóa âm lượng -13 LUFS (bun run normalize)",
        94,
        ["run", "normalize", id],
      );
      await runStepCmd(
        job,
        "Đóng gói MP4 chuẩn TikTok/Shorts (bun run encode)",
        97,
        ["run", "encode", id],
      );

      job.step =
        "Đang đẩy video, ảnh bìa & tiêu đề/nội dung lên S3 + Database…";
      job.progress = 99;
      try {
        // Test runs set STUDIO_SKIP_SYNC=1 so a throw-away video never lands in the real S3 bucket / database.
        if (process.env.STUDIO_SKIP_SYNC === "1") throw new Error("bỏ qua theo STUDIO_SKIP_SYNC=1");
        const mainPort =
          process.env.MAIN_SERVER_PORT || process.env.PORT || "3400";
        const syncRes = await fetch(
          `http://127.0.0.1:${mainPort}/api/shorts-studio/sync/${encodeURIComponent(id)}`,
          {
            method: "POST",
          },
        );
        if (syncRes.ok) {
          const syncData = (await syncRes.json()) as any;
          job.logs.push(
            `[S3 & DB Sync] Đã đồng bộ lên S3 & Kho Video: ${syncData?.video?.s3_url || id}`,
          );
        }
      } catch (syncErr) {
        job.logs.push(
          `[S3 & DB Sync] Sẽ tự đồng bộ khi Web chính kết nối: ${(syncErr as Error).message}`,
        );
      }

      job.status = "done";
      job.step = `Hoàn tất 100%! Đã lồng tiếng giọng ${chosenVoice.voice} & đẩy lên S3 + DB.`;
      job.progress = 100;
      job.finishedAt = Date.now();
    } catch (e) {
      job.status = "error";
      job.error = (e as Error).message;
      job.step = `Lỗi: ${(e as Error).message}`;
      job.finishedAt = Date.now();
    }
  })();

  return job;
};

export const startRebuildVideo = (
  id: string,
  opts?: { lines?: { scene: string; text: string }[]; voiceId?: string },
): StudioJob => {
  const dir = join(REPO, "src", "videos", id);
  const narPath = join(dir, "narration.json");
  const nar = JSON.parse(readFileSync(narPath, "utf8"));
  nar.outroHold = 0;
  if (opts?.voiceId) {
    const chosen = parseVoiceOption(opts.voiceId);
    nar.voice = {
      engine: chosen.engine,
      voice: chosen.voice,
      tempo: 1.0,
    };
  }
  if (opts?.lines?.length) {
    const factId = ensureFactForVideo(id, `Cập nhật kịch bản ${id}`);
    for (const s of nar.scenes) {
      const matching = opts.lines.filter(
        (u) => u.scene === s.id && u.text.trim(),
      );
      if (matching.length) {
        s.lines = matching.map((m) => ({
          text: sanitizeSpoken(m.text),
          ...(s.id === "share" ? {} : { fact: factId }),
        }));
      }
    }
  }
  writeFileSync(narPath, `${JSON.stringify(nar, null, 2)}\n`);

  const voiceLabel = `${nar.voice?.engine ?? "vieneu"}:${nar.voice?.voice ?? "Thiện Minh"}`;
  const job: StudioJob = {
    id,
    style: "stickman",
    mode: "manual",
    aspectRatio: nar.aspectRatio === "16:9" ? "16:9" : "9:16",
    voiceId: voiceLabel,
    prompt: `Render lại video ${id} (${voiceLabel})`,
    status: "running",
    step: `Đang lồng tiếng lại bằng giọng ${nar.voice?.voice ?? "Thiện Minh"}…`,
    progress: 15,
    logs: [],
    startedAt: Date.now(),
  };
  cancelledJobs.delete(id);
  jobs.set(id, job);

  (async () => {
    try {
      // Story videos: narration always comes from story.json (keeps panel ↔ line indices in sync).
      const storyForNar = readStoryPlan(dir);
      if (storyForNar) {
        const factId = nar.scenes?.[0]?.lines?.[0]?.fact;
        nar.scenes = Object.entries(storyActs(storyForNar).acts).map(([sid, lines]) => ({
          id: sid,
          lines: lines.map((t) => ({ text: sanitizeSpoken(t), ...(sid === "share" || !factId ? {} : { fact: factId }) })),
        }));
        writeFileSync(narPath, `${JSON.stringify(nar, null, 2)}\n`);
      }
      // Story videos keep their panels (story.json); only voice + assets + render are redone.
      if (opts?.lines?.length && !existsSync(join(dir, "story.json"))) {
        const sceneOrder = [
          "hook",
          "problem",
          "layer1",
          "layer2",
          "hardest",
          "payoff",
          "share",
        ] as const;
        const scenesObj: GeneratedPlan["scenes"] = {
          hook: [],
          problem: [],
          layer1: [],
          layer2: [],
          hardest: [],
          payoff: [],
          share: [],
        };
        for (const s of nar.scenes) {
          if (sceneOrder.includes(s.id)) {
            scenesObj[s.id as (typeof sceneOrder)[number]] = (
              s.lines || []
            ).map((l: any) => l.text);
          }
        }
        const fullScriptPrompt = Object.values(scenesObj).flat().join("\n");
        const basePlan = buildFallbackPlan(fullScriptPrompt);
        if (existsSync(join(dir, "explainer.json"))) {
          const direction = await directExplainer(
            scenesObj,
            fullScriptPrompt,
            job,
            VISUAL_MODEL,
            nar.aspectRatio === "16:9" ? "16:9" : "9:16",
          );
          writeExplainerFiles(
            dir,
            { ...basePlan, scenes: scenesObj },
            direction,
            nar.aspectRatio === "16:9" ? "16:9" : "9:16",
          );
        } else {
        const vis = await designVisualsFromScenes(
          scenesObj,
          fullScriptPrompt,
          job,
          VISUAL_MODEL,
        );
        const mergedPlan: GeneratedPlan = {
          ...basePlan,
          ...vis,
          scenes: scenesObj,
        };
        writeStickmanFiles(
          dir,
          mergedPlan,
          nar.aspectRatio === "16:9" ? "16:9" : "9:16",
        );
        }
      }
      await runStepCmd(
        job,
        `Tổng hợp giọng đọc ${nar.voice?.voice ?? ""} (bun run tts)`,
        30,
        ["run", "tts", id, "--force"],
      );
      syncStoryboard(id);
      if (existsSync(join(dir, "explainer.json"))) await renderExplainerBackgrounds(id, job, 40, 58);
      if (existsSync(join(dir, "backdrops.json"))) {
        let cur: { src: string | null }[] = [];
        try { cur = JSON.parse(readFileSync(join(dir, "backdrops.json"), "utf8")); } catch {}
        if (opts?.lines?.length || !cur.some((b) => b.src)) {
          const brief = existsSync(join(REPO, "briefs", `${id}.md`)) ? readFileSync(join(REPO, "briefs", `${id}.md`), "utf8") : "";
          const st: StudioStyle = /\*\*Style:\*\*\s*spirit/.test(brief) ? "spirit" : "stickman";
          await buildStickmanBackdrops(id, nar.scenes.flatMap((x: any) => x.lines.map((l: any) => l.text)).join(" ").slice(0, 400), job, VISUAL_MODEL, nar.aspectRatio === "16:9" ? "16:9" : "9:16", st, 40, 58);
        }
      }
      const storyPlan = readStoryPlan(dir);
      if (storyPlan) {
        const ar = nar.aspectRatio === "16:9" ? "16:9" : "9:16";
        const assets = await renderStoryAssets(id, storyPlan, ar, storyUi(job), 40, 58);
        writeStoryFiles(dir, storyPlan, assets);
      }
      await runStepCmd(job, "Đang render video (bun run render)", 60, [
        "run",
        "render",
        id,
      ]);
      await runStepCmd(job, "Đang xuất ảnh bìa (bun run cover)", 80, [
        "run",
        "cover",
        id,
      ]);
      await runStepCmd(
        job,
        "Chuẩn hóa âm lượng -13 LUFS (bun run normalize)",
        90,
        ["run", "normalize", id],
      );
      await runStepCmd(job, "Đóng gói bản Upload (bun run encode)", 96, [
        "run",
        "encode",
        id,
      ]);
      job.step = "Đang đồng bộ lại bản mới lên S3 + Database…";
      job.progress = 99;
      try {
        const mainPort =
          process.env.MAIN_SERVER_PORT || process.env.PORT || "3400";
        await fetch(
          `http://127.0.0.1:${mainPort}/api/shorts-studio/sync/${encodeURIComponent(id)}`,
          {
            method: "POST",
          },
        );
      } catch {}
      job.status = "done";
      job.step = `Đã render lại thành công với giọng ${nar.voice?.voice ?? ""} & cập nhật S3 + DB!`;
      job.progress = 100;
      job.finishedAt = Date.now();
    } catch (e) {
      job.status = "error";
      job.error = (e as Error).message;
      job.step = `Lỗi: ${(e as Error).message}`;
      job.finishedAt = Date.now();
    }
  })();

  return job;
};
