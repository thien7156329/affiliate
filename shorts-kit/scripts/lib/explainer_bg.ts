/**
 * AI backgrounds for the stickman explainer style (mflux, local, free).
 * Default model: Z-Image-Turbo (Apache-2.0, no Hugging Face login). EXPLAINER_BG_MODEL=schnell uses FLUX.1 schnell (gated).
 *
 * src/videos/<id>/explainer.json   ← plan: {backgrounds: [{id, prompt, tint?}], beats: [...]}
 * src/videos/<id>/backgrounds.json → resolved list read by World.tsx: [{id, src, tint}]
 * public/img/explainer/<id>/<bg>-<hash>.png  (cached: same prompt → no re-render)
 *
 * When mflux is missing or a render fails, the bg keeps src=null and the stage draws its tint gradient,
 * so a video always renders.
 */
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";

const REPO = resolve(import.meta.dir, "../..");
const PY = join(REPO, ".venv-mflux", "bin", "python");
const BRIDGE = join(REPO, "scripts", "lib", "engines", "mflux_bridge.py");

export const BG_MODEL = process.env.EXPLAINER_BG_MODEL || "z-image-turbo";
/**
 * Render size. Z-Image on Apple silicon costs ~4 min per 1.3 MP image (864×1536) but well under half that at
 * 0.6 MP; the stage scales the image up and keeps moving the camera, so the softer pixels do not show in motion.
 */
export const BG_WIDTH = Number(process.env.EXPLAINER_BG_W || 1024);
export const BG_HEIGHT = Number(process.env.EXPLAINER_BG_H || 576);
export const BG_STEPS = Number(process.env.EXPLAINER_BG_STEPS || 6);

/** Appended to every prompt so a whole video (and the channel) shares one look. */
export const EXPLAINER_STYLE =
  "hand-drawn ink illustration, bold clean black outlines, flat cel-shaded colors with soft gradients, " +
  "warm cinematic lighting, rich detailed environment, editorial cartoon background art, wide establishing shot, " +
  "empty scene with no people and no characters, no text, no letters, no watermark";

export type ExplainerBgSpec = {id: string; prompt: string; tint?: [string, string]};
export type ResolvedBg = {id: string; src: string | null; tint?: [string, string]};

const DEFAULT_TINTS: [string, string][] = [
  ["#1E3A5F", "#0B1220"],
  ["#7C4A1E", "#2A1608"],
  ["#14532D", "#052E16"],
  ["#4C1D95", "#1E1B4B"],
  ["#7F1D1D", "#1F0A0A"],
];

const fullPrompt = (p: string, portrait = false) =>
  `${p.trim().replace(/[.\s]+$/, "")}, ${portrait ? "tall vertical composition, " : ""}${EXPLAINER_STYLE}`;

const sizeFor = (portrait: boolean) => (portrait ? {w: BG_HEIGHT, h: BG_WIDTH} : {w: BG_WIDTH, h: BG_HEIGHT});

const fileFor = (videoId: string, spec: ExplainerBgSpec, portrait: boolean) => {
  const {w, h} = sizeFor(portrait);
  const hash = createHash("sha1")
    .update(`${fullPrompt(spec.prompt, portrait)}|${w}x${h}|${BG_MODEL}|${BG_STEPS}`)
    .digest("hex")
    .slice(0, 8);
  const safe = spec.id.replace(/[^a-z0-9_-]/gi, "_").slice(0, 40);
  const rel = `img/explainer/${videoId}/${safe}-${hash}.png`;
  return {rel, abs: join(REPO, "public", rel)};
};

export const mfluxAvailable = () => existsSync(PY);

/**
 * One image model on the GPU at a time: two videos rendering at once made each image ~2.5× slower.
 * A PID lock file in .cache serialises every `bun run bg` / Studio job on this machine.
 */
const LOCK = join(REPO, ".cache", "mflux.lock");
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const acquireGpuLock = async (log?: (s: string) => void) => {
  mkdirSync(join(REPO, ".cache"), {recursive: true});
  let announced = false;
  for (;;) {
    let holder = 0;
    try {
      holder = Number(readFileSync(LOCK, "utf8").trim()) || 0;
    } catch {
      /* no lock */
    }
    if (!holder || holder === process.pid || !alive(holder)) {
      writeFileSync(LOCK, String(process.pid));
      return () => {
        try {
          if (Number(readFileSync(LOCK, "utf8").trim()) === process.pid) rmSync(LOCK);
        } catch {
          /* already gone */
        }
      };
    }
    if (!announced) {
      log?.(`[bg] another video is drawing backgrounds (pid ${holder}) — waiting in queue`);
      announced = true;
    }
    await Bun.sleep(3000);
  }
};

export const generateExplainerBackgrounds = async (
  videoId: string,
  specs: ExplainerBgSpec[],
  opts: {
    seed?: number;
    /** 9:16 video: render tall images instead of cropping wide ones. */
    portrait?: boolean;
    onProgress?: (done: number, total: number, id: string) => void;
    log?: (s: string) => void;
  } = {},
): Promise<ResolvedBg[]> => {
  mkdirSync(join(REPO, "public", "img", "explainer", videoId), {recursive: true});
  const portrait = Boolean(opts.portrait);
  const {w, h} = sizeFor(portrait);
  const files = specs.map((s) => ({spec: s, ...fileFor(videoId, s, portrait)}));
  const todo = files.filter((f) => !existsSync(f.abs));
  const total = todo.length;

  if (total && mfluxAvailable()) {
    const release = await acquireGpuLock(opts.log);
    try {
    const jobsPath = join(REPO, ".cache", `mflux-jobs-${videoId}.json`);
    mkdirSync(join(REPO, ".cache"), {recursive: true});
    writeFileSync(
      jobsPath,
      JSON.stringify({
        width: w,
        height: h,
        quantize: 4,
        steps: BG_STEPS,
        model: BG_MODEL,
        jobs: todo.map((f, i) => ({prompt: fullPrompt(f.spec.prompt, portrait), seed: (opts.seed ?? 7) + i, out: f.abs})),
      }),
    );
    const proc = Bun.spawn([PY, "-I", BRIDGE, jobsPath], {cwd: REPO, stdout: "pipe", stderr: "pipe"});
    let done = 0;
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout as unknown as AsyncIterable<Uint8Array>) {
      buf += decoder.decode(chunk, {stream: true});
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith("DONE ") || line.startsWith("FAIL ")) {
          done++;
          const f = todo.find((t) => line.includes(t.abs));
          opts.onProgress?.(done, total, f?.spec.id ?? "?");
          if (line.startsWith("FAIL ")) opts.log?.(`[bg] ${line.slice(0, 300)}`);
        }
      }
    }
    const code = await proc.exited;
    if (code !== 0) {
      const err = await new Response(proc.stderr).text();
      opts.log?.(`[bg] mflux exited ${code}: ${err.split("\n").filter(Boolean).slice(-3).join(" | ")}`);
    }
    } finally {
      release();
    }
  } else if (total) {
    opts.log?.("[bg] mflux not installed (.venv-mflux) — using tint gradients");
  }

  return files.map((f, i) => ({
    id: f.spec.id,
    src: existsSync(f.abs) ? f.rel : null,
    tint: f.spec.tint ?? DEFAULT_TINTS[i % DEFAULT_TINTS.length],
  }));
};

/** Read explainer.json of a video, render its backgrounds, write backgrounds.json. */
export const buildVideoBackgrounds = async (
  videoId: string,
  opts: Parameters<typeof generateExplainerBackgrounds>[2] = {},
): Promise<ResolvedBg[]> => {
  const dir = join(REPO, "src", "videos", videoId);
  const plan = JSON.parse(readFileSync(join(dir, "explainer.json"), "utf8")) as {backgrounds: ExplainerBgSpec[]};
  let portrait = false;
  try {
    portrait = JSON.parse(readFileSync(join(dir, "narration.json"), "utf8")).aspectRatio !== "16:9";
  } catch {
    /* default wide */
  }
  const resolved = await generateExplainerBackgrounds(videoId, plan.backgrounds ?? [], {portrait, ...opts});
  writeFileSync(join(dir, "backgrounds.json"), `${JSON.stringify(resolved, null, 2)}\n`);
  return resolved;
};
