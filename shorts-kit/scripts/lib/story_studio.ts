/**
 * "Kể chuyện bằng tranh" style: voice-over storytelling, one large Gemini illustration per panel,
 * recurring characters kept identical via reference sheets, and a few silent Veo clips for motion.
 *
 *   1. Bible (1 AI call): art style, characters (fixed look), chapter outline, cover texts.
 *   2. Chapters (1 AI call each): panels = narration lines + English image prompt + characters + optional clip.
 *   3. Assets via the main server (Gemini Web / Veo in the logged-in Chrome):
 *        character sheets → panel images (refs = sheets of the characters in the panel [+ previous panel]) → clips.
 *   4. Files: narration.json (panels grouped into the 7 standard acts), panels.json, World/scenes/Cover.tsx.
 *
 * Images are cached by prompt hash under public/img/story/<id>/, so a rebuild only draws what changed.
 */
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {join, resolve} from "node:path";

const REPO = resolve(import.meta.dir, "../..");
const MAIN = () => `http://127.0.0.1:${process.env.MAIN_SERVER_PORT || process.env.PORT || "3400"}`;

/** Seconds of narration per illustration. 20 s → a 28-minute story ≈ 84 panels (Gemini Pro ≈ 100 images/day). */
export const STORY_PANEL_SECONDS = Number(process.env.STORY_PANEL_SECONDS || 20);
/** Veo clips per video (Gemini subscriptions allow only a few Veo videos a day). */
export const STORY_MAX_CLIPS = Number(process.env.STORY_MAX_CLIPS || 3);
/** Seconds of each Veo clip actually shown (Veo makes 8 s; the rest fades into the still). */
export const STORY_CLIP_SECONDS = Number(process.env.STORY_CLIP_SECONDS || 5);

export type StoryCharacter = {id: string; name: string; look: string; sheet?: string | null};
export type StoryPanelPlan = {lines: string[]; image: string; chars: string[]; continues?: boolean; clip?: string};
export type StoryPlan = {
  title: string;
  artStyle: string;
  characters: StoryCharacter[];
  chapters: {title: string; summary: string; panels: StoryPanelPlan[]}[];
  coverKicker?: string;
  coverLine1?: string;
  coverLine2?: string;
  caption?: string;
  pinned?: string;
};

type Log = {step: (s: string, progress?: number) => void; log: (s: string) => void};
type RunPrompt = (prompt: string, timeoutSec: number) => Promise<string | null>;

const parseJson = (raw: string | null): any => {
  if (!raw) return null;
  const m = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").match(/\{[\s\S]*\}/);
  try {
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "c";
const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ───────────────────────────── 1–2. Script ─────────────────────────────

export const writeStoryPlan = async (
  topic: string,
  minutes: number,
  wordsPerMin: number,
  aspectRatio: "9:16" | "16:9",
  run: RunPrompt,
  ui: Log,
): Promise<StoryPlan> => {
  const totalWords = Math.round(minutes * wordsPerMin);
  const totalPanels = Math.max(2, Math.round((minutes * 60) / STORY_PANEL_SECONDS));
  const chapterCount = Math.max(1, Math.min(14, Math.round(minutes / 2.5)));
  const frame = aspectRatio === "16:9" ? "khung NGANG 16:9" : "khung DỌC 9:16";

  ui.step(`AI đang dựng cốt truyện & nhân vật (${chapterCount} chương, ~${totalWords} chữ)…`, 18);
  const biblePrompt = `Bạn là biên kịch kênh YouTube "kể chuyện bằng tranh" tiếng Việt (${frame}). Video là MỘT câu chuyện liền mạch được kể bằng GIỌNG ĐỌC (ngôi thứ ba, giọng kể cuốn hút, có cao trào, có twist), mỗi phân cảnh là một bức tranh lớn minh họa.
Dựa trên chủ đề/tư liệu dưới đây, hãy lên "kinh thánh" cho câu chuyện. Nếu tư liệu là chuyện người thật (bài đăng diễn đàn, báo…), hãy VIẾT LẠI thành truyện mới lấy cảm hứng: đổi tên nhân vật, đổi chi tiết nhận dạng, không chép nguyên văn.

Trả về DUY NHẤT 1 JSON (không markdown):
{"title":"tên truyện ≤ 60 ký tự",
 "artStyle":"phong cách vẽ bằng TIẾNG ANH, 15–30 từ, dùng chung cho mọi tranh (vd: 'rich painterly digital illustration, Vietnamese storybook style, warm cinematic lighting, detailed backgrounds')",
 "characters":[{"id":"a-z0-9_","name":"tên tiếng Việt","look":"ngoại hình CỐ ĐỊNH bằng TIẾNG ANH 25–50 từ: giới tính, tuổi, dáng, khuôn mặt, kiểu tóc, trang phục, màu sắc chủ đạo, phụ kiện đặc trưng"}],
 "chapters":[{"title":"tên chương","summary":"tiếng Việt 3–5 câu: chuyện gì xảy ra trong chương này"}],
 "coverKicker":"≤ 18 ký tự","coverLine1":"≤ 14 ký tự","coverLine2":"≤ 12 ký tự, cú đấm","caption":"mô tả video 2–3 câu + hashtag","pinned":"câu hỏi ghim bình luận"}
Quy tắc: 2–6 nhân vật chính (chỉ những ai xuất hiện lặp lại); đúng ${chapterCount} chương; chương 1 mở bằng một hook mạnh, chương cuối có cái kết bất ngờ hoặc bài học.

CHỦ ĐỀ / TƯ LIỆU:
${topic.slice(0, 12000)}`;
  const bible = parseJson(await run(biblePrompt, 600));
  if (!bible?.characters || !Array.isArray(bible.chapters) || !bible.chapters.length) {
    throw new Error("AI không trả về được cốt truyện hợp lệ (bible JSON).");
  }
  const characters: StoryCharacter[] = (bible.characters as any[]).slice(0, 8).map((c, i) => ({
    id: slug(str(c.id) || `c${i}`),
    name: str(c.name, 40) || `Nhân vật ${i + 1}`,
    look: str(c.look, 500),
  }));
  const artStyle = str(bible.artStyle, 300) || "rich painterly digital illustration, warm cinematic lighting, detailed backgrounds";
  const outline = (bible.chapters as any[]).slice(0, chapterCount).map((c, i) => ({
    title: str(c.title, 80) || `Chương ${i + 1}`,
    summary: str(c.summary, 1200),
  }));

  const castList = characters.map((c) => `- ${c.id} (${c.name}): ${c.look}`).join("\n");
  const outlineText = outline.map((c, i) => `${i + 1}. ${c.title}: ${c.summary}`).join("\n");
  const chapters: StoryPlan["chapters"] = [];
  let prevTail = "";
  for (let i = 0; i < outline.length; i++) {
    const words = Math.round(totalWords / outline.length);
    const panels = Math.max(2, Math.round(totalPanels / outline.length));
    ui.step(`AI đang viết chương ${i + 1}/${outline.length}: ${outline[i].title}…`, 18 + Math.round((12 * i) / outline.length));
    const chPrompt = `Bạn đang viết kịch bản GIỌNG ĐỌC cho truyện "${str(bible.title, 80)}" (${frame}).
DÀN Ý TOÀN TRUYỆN:
${outlineText}

NHÂN VẬT (id: ngoại hình cố định):
${castList}

${prevTail ? `ĐOẠN CUỐI CHƯƠNG TRƯỚC (viết tiếp liền mạch, không lặp lại):\n${prevTail}\n\n` : ""}NHIỆM VỤ: viết CHƯƠNG ${i + 1}: "${outline[i].title}" — ${outline[i].summary}
- Khoảng ${words} chữ tiếng Việt, chia thành đúng ${panels} phân cảnh (panel). Mỗi panel 2–6 câu kể, mỗi câu ≤ 30 chữ, câu hoàn chỉnh, dễ đọc thành tiếng, có dấu phẩy ở chỗ cần ngắt hơi (số viết bằng chữ khi tự nhiên). Lời thoại nhân vật (nếu có) do người kể đọc, đặt trong ngoặc kép.
- "image": prompt vẽ bằng TIẾNG ANH 30–70 từ cho MỘT bức tranh lớn minh họa đúng khoảnh khắc chính của panel: bối cảnh, hành động, biểu cảm, góc máy, ánh sáng. Gọi nhân vật bằng id. Không có chữ trong tranh.
- "chars": id các nhân vật xuất hiện trong tranh (để hệ thống gửi ảnh mẫu giữ nguyên ngoại hình).
- "continues": true nếu tranh này cùng địa điểm với tranh liền trước.
- "clip": chỉ ở 1 panel có hành động đẹp nhất của chương: mô tả chuyển động bằng TIẾNG ANH 10–25 từ (vd "camera slowly pushes in as the boy runs through the rain"); các panel khác để "".
Trả về DUY NHẤT 1 JSON: {"panels":[{"lines":["..."],"image":"...","chars":["..."],"continues":false,"clip":""}]}`;
    const ch = parseJson(await run(chPrompt, 900));
    const ps: StoryPanelPlan[] = (Array.isArray(ch?.panels) ? ch.panels : [])
      .map((p: any) => ({
        lines: (Array.isArray(p?.lines) ? p.lines : []).map((l: unknown) => str(l, 400)).filter(Boolean),
        image: str(p?.image, 800),
        chars: (Array.isArray(p?.chars) ? p.chars : []).map((c: unknown) => slug(String(c))).filter((c: string) => characters.some((x) => x.id === c)),
        continues: Boolean(p?.continues),
        clip: str(p?.clip, 300),
      }))
      .filter((p: StoryPanelPlan) => p.lines.length && p.image);
    if (!ps.length) {
      ui.log(`[Story] Chương ${i + 1}: AI không trả về panel hợp lệ — bỏ qua`);
      continue;
    }
    ui.log(`[Story] Chương ${i + 1}: ${ps.length} panel, ${ps.flatMap((p) => p.lines).join(" ").split(/\s+/).length} chữ`);
    chapters.push({...outline[i], panels: ps});
    prevTail = ps.slice(-2).flatMap((p) => p.lines).join(" ");
  }
  if (!chapters.length) throw new Error("AI không viết được chương nào.");

  // Keep only STORY_MAX_CLIPS clips, spread across the video.
  const clipIdx = chapters.flatMap((c, ci) => c.panels.map((p, pi) => (p.clip ? [ci, pi] : null)).filter(Boolean) as number[][]);
  const keep = new Set<string>();
  if (STORY_MAX_CLIPS > 0 && clipIdx.length) {
    const step = clipIdx.length / Math.min(STORY_MAX_CLIPS, clipIdx.length);
    for (let k = 0; k < Math.min(STORY_MAX_CLIPS, clipIdx.length); k++) keep.add(clipIdx[Math.floor(k * step)].join(":"));
  }
  chapters.forEach((c, ci) => c.panels.forEach((p, pi) => (p.clip = keep.has(`${ci}:${pi}`) ? p.clip : "")));

  return {
    title: str(bible.title, 80),
    artStyle,
    characters,
    chapters,
    coverKicker: str(bible.coverKicker, 22),
    coverLine1: str(bible.coverLine1, 18),
    coverLine2: str(bible.coverLine2, 16),
    caption: str(bible.caption, 1500),
    pinned: str(bible.pinned, 300),
  };
};

// ───────────────────────────── 3. Assets ─────────────────────────────

const callMain = async (route: string, body: object): Promise<{ok: boolean; error?: string}> => {
  try {
    const res = await fetch(`${MAIN()}${route}`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify(body),
      // Gemini images take ~0.5–2 min, Veo clips several minutes.
      timeout: false,
    } as RequestInit);
    const j = (await res.json().catch(() => ({}))) as any;
    return res.ok && j?.ok ? {ok: true} : {ok: false, error: j?.error || `HTTP ${res.status}`};
  } catch (e) {
    return {ok: false, error: `Web chính (cổng 3400) không phản hồi: ${(e as Error).message}`};
  }
};

const hash = (...parts: string[]) => createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 8);

const frameWords = (ar: "9:16" | "16:9") =>
  ar === "16:9" ? "wide 16:9 landscape (horizontal) image" : "tall 9:16 portrait (vertical) image";

export type StoryPanelFile = {id: string; line: number; src: string | null; clip?: string | null; clipSeconds?: number};

export const renderStoryAssets = async (
  id: string,
  plan: StoryPlan,
  aspectRatio: "9:16" | "16:9",
  ui: Log,
  from: number,
  to: number,
): Promise<{characters: StoryCharacter[]; images: (string | null)[]; clips: (string | null)[]}> => {
  const pubDir = join(REPO, "public", "img", "story", id);
  mkdirSync(pubDir, {recursive: true});
  const panels = plan.chapters.flatMap((c) => c.panels);
  const clipsWanted = panels.filter((p) => p.clip).length;
  const total = plan.characters.length + panels.length + clipsWanted;
  let done = 0;
  const tick = (what: string) => {
    done++;
    ui.step(`Gemini đang vẽ ${what} (${done}/${total})…`, Math.round(from + ((to - from) * done) / Math.max(1, total)));
  };
  const outOfQuota = new Set<string>();
  const tryTwice = async (route: string, body: object, label: string) => {
    if (outOfQuota.has(route)) return false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await callMain(route, body);
      if (r.ok) return true;
      ui.log(`[Story] ${label} lỗi lần ${attempt}: ${r.error}`);
      if (/QUOTA/.test(r.error || "")) {
        outOfQuota.add(route);
        ui.log(`[Story] Gemini hết lượt ${route.endsWith("clip") ? "tạo video" : "vẽ ảnh"} hôm nay → bỏ qua phần còn lại, Render lại khi có lượt.`);
        return false;
      }
      if (/không phản hồi/.test(r.error || "")) return false;
    }
    return false;
  };

  // Character sheets
  const characters: StoryCharacter[] = [];
  for (const c of plan.characters) {
    const prompt =
      `Draw ONE character design reference sheet (a single image, not a story scene): ${c.name}, ${c.look}. ` +
      `Show the same character full body front view, three-quarter view and a close-up of the face, side by side on a plain light background. ` +
      `Art style: ${plan.artStyle}. No text, no labels, no watermark.`;
    const rel = `img/story/${id}/char-${c.id}-${hash(prompt)}.png`;
    const abs = join(REPO, "public", rel);
    const ok = existsSync(abs) || (await tryTwice("/api/story-assets/image", {prompt, refs: [], out: abs, label: "none"}, `nhân vật ${c.name}`));
    characters.push({...c, sheet: ok ? abs : null});
    tick(`nhân vật ${c.name}`);
  }

  // Panels
  const images: (string | null)[] = [];
  let prevAbs: string | null = null;
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const cast = p.chars.map((cid) => characters.find((c) => c.id === cid)).filter(Boolean) as StoryCharacter[];
    const withSheet = cast.filter((c) => c.sheet);
    let text = p.image;
    for (const c of cast) text = text.replace(new RegExp(`\\b${c.id}\\b`, "g"), c.name);
    const refs = [...withSheet.map((c) => c.sheet as string), ...(p.continues && prevAbs ? [prevAbs] : [])];
    const prompt =
      `Draw ONE single full-frame illustration as a ${frameWords(aspectRatio)} — no grid, no comic panels, no borders, ` +
      `no text, no captions, no speech bubbles, no watermark.\nArt style: ${plan.artStyle}.\nScene: ${text}\n` +
      (withSheet.length
        ? `Characters: ${withSheet
            .map((c, k) => `${c.name} = attached reference sheet ${k + 1} (${c.look})`)
            .join("; ")}. Keep each character EXACTLY as in their reference sheet: same face, hair, body, outfit and colors.\n`
        : cast.length
          ? `Characters: ${cast.map((c) => `${c.name} (${c.look})`).join("; ")}.\n`
          : "") +
      (p.continues && prevAbs ? `The LAST attached image is the previous scene: keep the same location and lighting, but draw a new composition.\n` : "");
    const rel = `img/story/${id}/panel-${String(i + 1).padStart(3, "0")}-${hash(prompt, ...refs.map((r) => r.split("/").pop() || ""))}.png`;
    const abs = join(REPO, "public", rel);
    const ok =
      existsSync(abs) ||
      (await tryTwice("/api/story-assets/image", {prompt, refs, out: abs, label: "Character reference sheet(s)"}, `tranh ${i + 1}`));
    images.push(ok ? rel : null);
    if (ok) prevAbs = abs;
    tick(`tranh ${i + 1}/${panels.length}`);
  }

  // Clips (silent): animate the panel's own illustration.
  const clips: (string | null)[] = panels.map(() => null);
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    if (!p.clip || !images[i]) continue;
    const prompt =
      `Animate this exact illustration into a short cinematic shot: ${p.clip}. Keep the art style, characters and composition identical to the image. ` +
      `Completely silent scene: no dialogue, nobody talks, no voice-over, no text on screen.`;
    const rel = `img/story/${id}/clip-${String(i + 1).padStart(3, "0")}-${hash(prompt, images[i] as string)}.mp4`;
    const abs = join(REPO, "public", rel);
    const ok =
      existsSync(abs) ||
      (await tryTwice("/api/story-assets/clip", {prompt, image: join(REPO, "public", images[i] as string), out: abs}, `clip ${i + 1}`));
    clips[i] = ok ? rel : null;
    tick(`clip chuyển động ${i + 1}`);
  }
  ui.log(
    `[Story] ${characters.filter((c) => c.sheet).length}/${characters.length} nhân vật, ${images.filter(Boolean).length}/${panels.length} tranh, ${clips.filter(Boolean).length}/${clipsWanted} clip`,
  );
  return {characters, images, clips};
};

// ───────────────────────────── 4. Files ─────────────────────────────

export const STORY_ACTS = ["hook", "problem", "layer1", "layer2", "hardest", "payoff", "share"] as const;

/** Panels in order → the 7 standard acts (contiguous groups), so tts/lint/templates keep working. */
export const storyActs = (plan: StoryPlan): {acts: Record<string, string[]>; panelLine: number[]} => {
  const panels = plan.chapters.flatMap((c) => c.panels);
  const all = panels.flatMap((p) => p.lines);
  const panelLine: number[] = [];
  let n = 0;
  for (const p of panels) {
    panelLine.push(n);
    n += p.lines.length;
  }
  // Split by LINE (not by panel): acts never come out empty, so no filler line is spoken.
  const acts: Record<string, string[]> = Object.fromEntries(STORY_ACTS.map((a) => [a, [] as string[]]));
  all.forEach((t, i) => acts[STORY_ACTS[Math.min(STORY_ACTS.length - 1, Math.floor((i * STORY_ACTS.length) / all.length))]].push(t));
  // Only a story shorter than 7 lines can leave an act empty (never in practice: a panel has 2–6 lines).
  for (const a of STORY_ACTS) if (!acts[a].length) acts[a].push("...");
  return {acts, panelLine};
};

export const writeStoryFiles = (
  dir: string,
  plan: StoryPlan,
  assets: {images: (string | null)[]; clips: (string | null)[]} | null,
) => {
  writeFileSync(join(dir, "story.json"), `${JSON.stringify(plan, null, 2)}\n`);
  const panels = plan.chapters.flatMap((c) => c.panels);
  const {panelLine} = storyActs(plan);
  const files: StoryPanelFile[] = panels.map((_, i) => ({
    id: `p${String(i + 1).padStart(3, "0")}`,
    line: panelLine[i],
    src: assets?.images[i] ?? null,
    ...(assets?.clips[i] ? {clip: assets.clips[i], clipSeconds: STORY_CLIP_SECONDS} : {}),
  }));
  writeFileSync(join(dir, "panels.json"), `${JSON.stringify(files, null, 2)}\n`);

  writeFileSync(
    join(dir, "World.tsx"),
    `import React from "react";
import {StoryStage, type StoryPanel} from "../../shared/story/StoryStage";
import panels from "./panels.json";
import {DURATION, VOICE} from "./timing";

export const World: React.FC = () => <StoryStage panels={panels as StoryPanel[]} voice={VOICE} duration={DURATION} />;
`,
  );
  writeFileSync(
    join(dir, "scenes.tsx"),
    `import React from "react";
import {AbsoluteFill} from "remotion";
import type {SceneComponent} from "../../shared/frame/ShortsTemplate";

const WorldOnly: SceneComponent = () => <AbsoluteFill />;

export const scenes: Record<string, SceneComponent> = {
${STORY_ACTS.map((a) => `  ${a}: WorldOnly,`).join("\n")}
};
`,
  );
  const esc = (s: string) => JSON.stringify(s);
  writeFileSync(
    join(dir, "Cover.tsx"),
    `import React from "react";
import {AbsoluteFill, Img, staticFile, useVideoConfig} from "remotion";
import {SafeCheck} from "../../shared/frame/SafeCheck";
import {FONT} from "../../shared/theme";
import panels from "./panels.json";

const BG = (panels as {src: string | null}[]).find((p) => p.src);
const STROKE = "0 0 0 #000, 6px 6px 0 #111827, -3px -3px 0 #111827, 3px -3px 0 #111827, -3px 3px 0 #111827";

export const Cover: React.FC<{safe: boolean}> = ({safe}) => {
  const {width, height} = useVideoConfig();
  const wide = width > height;
  const s = Math.min(width, height) / 1080;
  return (
    <SafeCheck safe={safe} cover>
      <AbsoluteFill style={{background: "#0B1220", fontFamily: FONT.sans}}>
        {BG?.src ? <Img src={staticFile(BG.src)} style={{width: "100%", height: "100%", objectFit: "cover"}} /> : null}
        <AbsoluteFill style={{background: "linear-gradient(180deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.05) 55%, rgba(0,0,0,0.4) 100%)"}} />
        <div style={{position: "absolute", left: 70 * s, top: (wide ? 110 : 220) * s, width: wide ? width * 0.6 : width - 140 * s}}>
          <div style={{display: "inline-block", background: "#FACC15", color: "#111827", fontWeight: 900, fontSize: 40 * s, padding: \`\${8 * s}px \${26 * s}px\`, borderRadius: 999, border: \`\${4 * s}px solid #111827\`}}>{${esc(plan.coverKicker || "CÂU CHUYỆN")}}</div>
          <div style={{color: "#FFFFFF", fontWeight: 900, fontSize: 140 * s, lineHeight: 1.02, marginTop: 24 * s, textShadow: STROKE}}>{${esc(plan.coverLine1 || plan.title.slice(0, 14))}}</div>
          <div style={{color: "#FDE047", fontWeight: 900, fontSize: 160 * s, lineHeight: 1.02, textShadow: STROKE}}>{${esc(plan.coverLine2 || "")}}</div>
        </div>
      </AbsoluteFill>
    </SafeCheck>
  );
};
`,
  );
};

/** For rebuilds: read story.json back. */
export const readStoryPlan = (dir: string): StoryPlan | null => {
  try {
    return JSON.parse(readFileSync(join(dir, "story.json"), "utf8")) as StoryPlan;
  } catch {
    return null;
  }
};
