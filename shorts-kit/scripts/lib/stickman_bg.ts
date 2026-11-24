/**
 * AI backdrops for the stickman styles: one empty-scene illustration per beat (≈ 2 narration lines, the same rhythm
 * the stage uses for its centre cards), written from the actual narration so the place follows the story.
 *
 * Image source, in order:
 *   1. Cloudflare Workers AI FLUX.1 schnell — when CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN are set (fast, ~1–3 s,
 *      free daily allowance), 4 in parallel;
 *   2. Gemini Web via the main server (/api/story-assets/image, ~15–20 s each, uses the Gemini image quota);
 *   3. nothing → src null → the stage keeps its preset gradient setting for that beat.
 * Files: public/img/stickman-bg/<id>/<n>-<hash>.(jpg|png), cached by prompt; list in src/videos/<id>/backdrops.json.
 */
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";

const REPO = resolve(import.meta.dir, "../..");
const MAIN = () => `http://127.0.0.1:${process.env.MAIN_SERVER_PORT || process.env.PORT || "3400"}`;
/** Upper bound on drawn backdrops per video (long videos reuse images beyond this). */
export const STICKMAN_BG_MAX = Number(process.env.STICKMAN_BG_MAX || 40);

export const BACKDROP_STYLE =
  "2D cartoon background illustration, clean bold outlines, flat colors with soft shading, cinematic lighting, " +
  "eye-level straight-on camera like a theatre stage, a clear empty flat floor or ground filling the bottom third of the frame " +
  "with nothing standing on it, furniture and objects placed against the back wall or in the middle distance, " +
  "nothing in the foreground, empty scene with no people and no characters, no text, no letters, no watermark";

/** Cloudflare keys live in the project .env (one level up); shorts-kit's own env wins. */
const envKey = (k: string): string => {
  if (process.env[k]) return process.env[k] as string;
  for (const f of [join(REPO, ".env"), join(REPO, "..", ".env")]) {
    try {
      const m = readFileSync(f, "utf8").match(new RegExp(`^${k}\\s*=\\s*"?([^"\\n]+)"?`, "m"));
      if (m) return m[1].trim();
    } catch {
      /* no file */
    }
  }
  return "";
};

type Log = (s: string) => void;
type RunPrompt = (prompt: string, timeoutSec: number) => Promise<string | null>;
export type BackdropPlanItem = {line: number; prompt: string | null; tags?: string[]; loc?: string};

const parseJson = (raw: string | null): any => {
  if (!raw) return null;
  const m = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").match(/[[{][\s\S]*[\]}]/);
  try {
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
};

// ───────────── channel background library (reused across videos) ─────────────
const LIB_DIR = join(REPO, "public", "img", "bg-library");
const LIB_INDEX = join(LIB_DIR, "index.json");
/** Tag overlap (Jaccard) needed to reuse a library image instead of drawing a new one. */
const LIB_MATCH = Number(process.env.BG_LIBRARY_MATCH || 0.6);
type LibEntry = {id: string; file: string; prompt: string; tags: string[]; aspect: "9:16" | "16:9"; tone: string; uses: number; createdAt: string; v?: number};
/** Bump when the drawing rules change so older images (e.g. no empty floor for the cast) are no longer reused. */
const LIB_VERSION = 2;

const normTags = (t: unknown[]): string[] =>
  [...new Set(t.map((x) => String(x).toLowerCase().trim().replace(/\s+/g, " ")).filter((x) => x && x.length < 40))].slice(0, 10);
const readLib = (): LibEntry[] => {
  try {
    return JSON.parse(readFileSync(LIB_INDEX, "utf8"));
  } catch {
    return [];
  }
};
const writeLib = (lib: LibEntry[]) => {
  mkdirSync(LIB_DIR, {recursive: true});
  writeFileSync(LIB_INDEX, `${JSON.stringify(lib, null, 1)}\n`);
};
const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a);
  const inter = b.filter((x) => A.has(x)).length;
  return inter / Math.max(1, new Set([...a, ...b]).size);
};
/** Best library image for these tags (same frame shape and tone), not yet used in this video. */
const findInLibrary = (tags: string[], aspect: "9:16" | "16:9", tone: string, usedHere: Set<string>): LibEntry | null => {
  let best: LibEntry | null = null;
  let score = 0;
  for (const e of readLib()) {
    if ((e.v ?? 1) < LIB_VERSION || e.aspect !== aspect || e.tone !== tone || usedHere.has(e.file)) continue;
    const sc = jaccard(tags, e.tags);
    if (sc > score) [best, score] = [e, sc];
  }
  return score >= LIB_MATCH ? best : null;
};
export const libraryStats = () => {
  const lib = readLib();
  return {total: lib.length, landscape: lib.filter((e) => e.aspect === "16:9").length, portrait: lib.filter((e) => e.aspect === "9:16").length};
};

/** Beat starts: within each scene, every 2nd line (matches the stage's sentencesPerBeat = 2). */
export const beatStarts = (scenes: {id: string; lines: string[]}[], step = 2): {line: number; scene: string; text: string}[] => {
  const out: {line: number; scene: string; text: string}[] = [];
  let g = 0;
  for (const s of scenes) {
    s.lines.forEach((_, i) => {
      if (i % step === 0) out.push({line: g + i, scene: s.id, text: s.lines.slice(i, i + step).join(" ")});
    });
    g += s.lines.length;
  }
  return out;
};

export const planBackdrops = async (
  scenes: {id: string; lines: string[]}[],
  topic: string,
  run: RunPrompt,
  opts: {aspectRatio: "9:16" | "16:9"; toneHint?: string; log?: Log; recurringSets?: boolean; perLine?: boolean},
): Promise<BackdropPlanItem[]> => {
  // story mode: one picture per narration line, so the image shows what is being said right now
  const beats = beatStarts(scenes, opts.perLine ? 1 : 2);
  if (!beats.length) return [];
  const sys = `You are the background art director of a Vietnamese stickman explainer video (${opts.aspectRatio === "16:9" ? "16:9 landscape" : "9:16 portrait"}).
Stickman characters are drawn ON TOP of your backgrounds, so backgrounds are EMPTY places (no people).
For each beat below write ONE English prompt (20–45 words) that ILLUSTRATES WHAT THE BEAT SAYS — the exact moment, not just the location:
the place PLUS the thing being described in that line (e.g. "a dark human silhouette standing in the doorway", "two small earth graves with incense smoke", "a firefly glowing on an old man's fingertip" — shown as objects/marks/shadows since the stickmen are drawn separately), time of day, weather, lighting, mood.
STAGING (important): characters are drawn standing on the floor in the BOTTOM THIRD of the image, about 78% down from the top. So every place must be shown eye-level and straight-on, with an EMPTY walkable floor/ground across the bottom third (floor tiles, packed earth, a yard, a road) and all furniture/objects behind that, against the back wall or in the middle distance. Never put a table, bed, desk or bush in the foreground, never a top-down or close-up view.${opts.aspectRatio === "16:9" ? "" : " Tall vertical composition: main subject in the upper half, open floor in the lower half."}
${opts.toneHint ? `TONE: ${opts.toneHint}\n` : ""}${opts.recurringSets ? `RECURRING SETS: the story uses only a few fixed LOCATIONS (the family house, the back garden, the pond…). Give every beat a short "loc" key (e.g. "back_garden") and describe the SAME house/garden with the same words each time so it looks like one place. "same" is FORBIDDEN for any line that shows or mentions something visible happening or appearing (a figure, a shadow, a door/window opening, bones, graves, a firefly, a fall, a scream, fire, water…): such a line ALWAYS gets a NEW prompt that puts that thing in the picture. "same" is allowed only for explanation / transition lines with nothing new to see, and never for more than 2 lines in a row.\n` : ""}If a beat clearly stays in the same place as the previous beat, return "same" instead of a prompt (saves images), but change the place at least every 3 beats.
Use at most ${STICKMAN_BG_MAX} distinct prompts in total.
For every new prompt also give "tags": 4–8 lowercase English keywords (place type, key objects, time of day, weather, mood),
e.g. ["village road","banyan tree","night","fog","eerie"] — they are used to reuse backgrounds from the channel library.
Return ONLY JSON: [{"line": <beat line number>, "prompt": "..." | "same", "tags": ["..."]${opts.recurringSets ? ', "loc": "altar_room"' : ""}}] — one item per beat, same order.`;
  const body = `${sys}\n\nTOPIC: ${topic.slice(0, 400)}\n\nBEATS:\n${beats.map((b) => `${b.line}. [${b.scene}] ${b.text}`).join("\n")}`;
  const parsed = parseJson(await run(body, Math.round(120 + beats.length * 3)));
  const arr: any[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.beats) ? parsed.beats : [];
  const byLine = new Map<number, string>();
  const tagsBy = new Map<number, string[]>();
  const locBy = new Map<number, string>();
  for (const it of arr) {
    if (!Number.isFinite(Number(it?.line)) || typeof it?.prompt !== "string") continue;
    byLine.set(Number(it.line), it.prompt.trim());
    if (Array.isArray(it.tags)) tagsBy.set(Number(it.line), normTags(it.tags));
    if (typeof it.loc === "string" && it.loc.trim()) locBy.set(Number(it.line), it.loc.trim().toLowerCase().slice(0, 40));
  }
  if (!byLine.size) {
    opts.log?.("[Backdrop] AI không trả về prompt nền → giữ nền mẫu");
    return [];
  }
  let distinct = 0;
  const seenLoc = new Set<string>();
  return beats.map((b) => {
    const p = byLine.get(b.line);
    const loc = locBy.get(b.line);
    // a location already drawn in this video → same picture (prompt null + loc)
    if (loc && seenLoc.has(loc)) return {line: b.line, prompt: null, loc};
    if (!p || /^same$/i.test(p) || distinct >= STICKMAN_BG_MAX) return {line: b.line, prompt: null, ...(loc ? {loc} : {})};
    if (loc) seenLoc.add(loc);
    distinct++;
    return {line: b.line, prompt: p.replace(/[.\s]+$/, ""), tags: tagsBy.get(b.line) ?? normTags(p.split(/[,.]/).slice(0, 6)), ...(loc ? {loc} : {})};
  });
};

const cloudflare = async (prompt: string, out: string): Promise<boolean> => {
  const acc = envKey("CLOUDFLARE_ACCOUNT_ID");
  const tok = envKey("CLOUDFLARE_API_TOKEN");
  if (!acc || !tok) return false;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: "POST",
    headers: {authorization: `Bearer ${tok}`, "content-type": "application/json"},
    body: JSON.stringify({prompt: prompt.slice(0, 2000), steps: Number(process.env.CF_FLUX_STEPS || 4)}),
  });
  const j = (await res.json().catch(() => null)) as any;
  const b64 = j?.result?.image;
  if (!res.ok || typeof b64 !== "string") throw new Error(`Cloudflare ${res.status}: ${JSON.stringify(j?.errors ?? j).slice(0, 200)}`);
  writeFileSync(out, Buffer.from(b64, "base64"));
  return true;
};

const gemini = async (prompt: string, out: string, aspectRatio: "9:16" | "16:9"): Promise<void> => {
  const full =
    `Draw ONE single full-frame ${aspectRatio === "16:9" ? "wide 16:9 landscape" : "tall 9:16 portrait"} background illustration — ` +
    `no grid, no panels, no borders.\n${prompt}.\nStyle: ${BACKDROP_STYLE}.`;
  const res = await fetch(`${MAIN()}/api/story-assets/image`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({prompt: full, refs: [], out, label: "none"}),
    timeout: false,
  } as RequestInit);
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`);
};

export const renderBackdrops = async (
  id: string,
  plan: BackdropPlanItem[],
  aspectRatio: "9:16" | "16:9",
  ui: {step: (s: string, progress?: number) => void; log: Log},
  from: number,
  to: number,
  /** Library bucket: images are only reused between videos of the same tone ("spirit" vs "default"). */
  tone = "default",
): Promise<{line: number; src: string | null}[]> => {
  mkdirSync(LIB_DIR, {recursive: true});
  const todo = plan.map((p, i) => ({...p, i})).filter((p) => p.prompt);
  const useCf = Boolean(envKey("CLOUDFLARE_ACCOUNT_ID") && envKey("CLOUDFLARE_API_TOKEN"));
  let cfDown = !useCf;
  let geminiDown = false;
  let done = 0;
  let reused = 0;
  let drawn = 0;
  const files = new Map<number, string | null>();
  const usedHere = new Set<string>();

  const drawOne = async (p: (typeof todo)[number]) => {
    const tags = p.tags?.length ? p.tags : normTags((p.prompt as string).split(/[,.]/).slice(0, 6));
    // 1) channel library: same kind of place already drawn for an earlier video → reuse it
    const hit = findInLibrary(tags, aspectRatio, tone, usedHere);
    if (hit && existsSync(join(REPO, "public", hit.file))) {
      usedHere.add(hit.file);
      reused++;
      const lib = readLib();
      const e = lib.find((x) => x.id === hit.id);
      if (e) {
        e.uses++;
        writeLib(lib);
      }
      return files.set(p.line, hit.file);
    }
    // 2) draw a new one straight into the library
    const prompt = `${p.prompt}, ${aspectRatio === "16:9" ? "" : "tall vertical composition, "}${BACKDROP_STYLE}`;
    const h = createHash("sha1").update(`${prompt}|${aspectRatio}`).digest("hex").slice(0, 12);
    const base = `img/bg-library/${aspectRatio === "16:9" ? "w" : "t"}-${h}`;
    for (const ext of [".jpg", ".png"]) {
      if (existsSync(join(REPO, "public", base + ext))) {
        usedHere.add(base + ext);
        return files.set(p.line, base + ext);
      }
    }
    let saved: string | null = null;
    if (!cfDown) {
      try {
        if (await cloudflare(prompt, join(REPO, "public", `${base}.jpg`))) saved = `${base}.jpg`;
      } catch (e) {
        ui.log(`[Backdrop] ${(e as Error).message}`);
        if (/40[13]|429|limit|quota|neurons/i.test((e as Error).message)) {
          cfDown = true;
          ui.log("[Backdrop] Cloudflare hết lượt / sai key → chuyển sang Gemini");
        }
      }
    }
    if (!saved && !geminiDown) {
      try {
        await gemini(p.prompt as string, join(REPO, "public", `${base}.png`), aspectRatio);
        saved = `${base}.png`;
      } catch (e) {
        const msg = (e as Error).message;
        ui.log(`[Backdrop] Gemini: ${msg.slice(0, 200)}`);
        if (/QUOTA|không phản hồi|ECONNREFUSED|Unable to connect/i.test(msg)) geminiDown = true;
      }
    }
    if (saved) {
      drawn++;
      usedHere.add(saved);
      const lib = readLib();
      lib.push({id: h, file: saved, prompt: p.prompt as string, tags, aspect: aspectRatio, tone, uses: 1, createdAt: new Date().toISOString(), v: LIB_VERSION});
      writeLib(lib);
    }
    files.set(p.line, saved);
  };

  const queue = [...todo];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      await drawOne(p);
      done++;
      ui.step(
        `Nền AI theo lời thoại ${done}/${todo.length} (${reused} lấy từ thư viện, ${drawn} vẽ mới bằng ${cfDown ? "Gemini" : "Cloudflare FLUX"})…`,
        Math.round(from + ((to - from) * done) / Math.max(1, todo.length)),
      );
    }
  };
  // Cloudflare takes parallel requests; Gemini (one Chrome session) is serialised by the main server anyway.
  await Promise.all(Array.from({length: cfDown ? 1 : 4}, worker));

  // "same" beats inherit the previous image; a returning location ("loc") gets that location's image.
  let last: string | null = null;
  const locSrc = new Map<string, string>();
  const out = plan.map((p) => {
    const src = p.prompt ? (files.get(p.line) ?? null) : p.loc && locSrc.has(p.loc) ? (locSrc.get(p.loc) as string) : last;
    if (src) {
      last = src;
      if (p.loc && !locSrc.has(p.loc)) locSrc.set(p.loc, src);
    }
    return {line: p.line, src};
  });
  const st = libraryStats();
  ui.log(`[Backdrop] ${todo.length} nền: ${reused} lấy lại từ thư viện, ${drawn} vẽ mới. Thư viện kênh: ${st.total} nền (${st.landscape} ngang, ${st.portrait} dọc)`);
  return out;
};

export const writeBackdrops = (videoDir: string, items: {line: number; src: string | null}[]) =>
  writeFileSync(join(videoDir, "backdrops.json"), `${JSON.stringify(items, null, 2)}\n`);
