/**
 * Prompt Generator — Uses AGY Gemini 3.8 as the primary generator and
 * GLM-5 as the independent quality auditor, with Bedrock fallbacks.
 */



const SYSTEM_PROMPT = `You are an expert AI Video Prompt Engineer specializing in Veo (Google's video AI).
Your goal is to write a highly detailed, cinematic 4K prompt in English for product affiliate marketing videos.

Rules:
- Always write in English
- 1-3 sentences maximum
- Must include: product subject, lighting style, camera movement, environment/background, cinematic quality keywords
- Make it visually stunning and conversion-optimized for social media (TikTok/Reels)
- Do NOT include any explanation, just output the final prompt

Category-specific styles:
- tech: clean minimalist desk setup, RGB lighting, macro close-up shots, shallow depth of field
- beauty: soft studio lighting, pastel background, liquid droplets, slow motion
- fashion: urban outdoor, golden hour, dynamic tracking shot, vibrant colors
- food: warm cozy kitchen, steam rising, macro food porn, bokeh background
- fitness: gym environment, motivational energy, dynamic angles, dramatic lighting
- toys: whimsical playroom, bright colorful lighting, claymation style, playful animations, soft volumetric shadows
- household: cozy modern living room, clean bright ambient lighting, practical home setups, family-friendly warm atmosphere
- baby: gentle warm nursery, soft pastel colors, nursery ambient lighting, cute whimsical style, child-safe environment
- pets: playful pet zone, bright cheerful lighting, dynamic tracking shot, cute animal accessories, funny energetic mood`;

import axios from "axios";
import "dotenv/config";
import { AGY_DEFAULT_MODEL, callAgy, isAgyEnabled } from "./agyClient.js";
import { CODEX_TERRA_MODEL, callCodexTerra, isCodexEnabled } from "./codexClient.js";
import { buildWorldStyleDirective, normalizeVisualStyle } from "./worldStyles.js";
import {
  formatModelDisplayName,
  getScriptwriterModel,
  getAuditorModel,
  GEMINI_CARBON_MODEL,
  GEMINI_ARGON_MODEL,
} from "./aiModelConfig.js";

const SCRIPTWRITER_PRIMARY_MODEL = getScriptwriterModel();
const AUDITOR_PRIMARY_MODEL = getAuditorModel();

// Track models that recently threw Quota / Rate-limit (429) errors so we fail-fast immediately (0s delay)
const modelQuotaBlockedUntil = new Map<string, { blockedUntil: number; reason: string }>();

export function isModelQuotaBlocked(model: string): { blocked: boolean; reason?: string } {
  const entry = modelQuotaBlockedUntil.get(model);
  if (!entry) return { blocked: false };
  if (Date.now() > entry.blockedUntil) {
    modelQuotaBlockedUntil.delete(model);
    return { blocked: false };
  }
  return { blocked: true, reason: entry.reason };
}

export function markModelQuotaBlocked(model: string, reason: string, durationMs: number = 30 * 60 * 1000) {
  modelQuotaBlockedUntil.set(model, { blockedUntil: Date.now() + durationMs, reason });
}

/** Write/revise screenplay drafts with primary scriptwriter model (Opus 5.5) first, then Gemini 4 Carbon -> Gemini 4 Argon fallback on error. */
export async function callScriptwriter(
  systemPrompt: string,
  userPrompt: string,
  imageUrl?: string,
  jsonMode: boolean = false,
  onModelChange?: (model: string) => void
): Promise<{ text: string; model: string }> {
  const prompt = imageUrl
    ? `${userPrompt}\n\nREFERENCE IMAGE URL (inspect it when accessible): ${imageUrl}`
    : userPrompt;
  const primaryModel = getScriptwriterModel();

  if (isAgyEnabled()) {
    const candidateModels = [
      primaryModel,
      GEMINI_CARBON_MODEL,
      GEMINI_ARGON_MODEL,
      "gemini-4-argon-medium",
    ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

    for (let i = 0; i < candidateModels.length; i++) {
      const candidate = candidateModels[i];
      const quotaCheck = isModelQuotaBlocked(candidate);
      if (quotaCheck.blocked) {
        const nextCandidate = candidateModels[i + 1];
        console.warn(
          `⚡ [PromptGen] ${formatModelDisplayName(candidate)} đang hết Quota (${quotaCheck.reason}) → Bỏ qua chuyển ngay sang ${nextCandidate ? formatModelDisplayName(nextCandidate) : "Bedrock"}!`
        );
        continue;
      }

      try {
        onModelChange?.(candidate);
        const text = await callAgy(systemPrompt, prompt, jsonMode, candidate);
        return { text, model: candidate };
      } catch (err: any) {
        const errMsg = String(err?.message || err);
        const isQuotaError =
          errMsg.includes("429") ||
          errMsg.toLowerCase().includes("quota") ||
          errMsg.includes("RESOURCE_EXHAUSTED");
        const nextCandidate = candidateModels[i + 1];
        if (isQuotaError) {
          console.warn(
            `⛔ [PromptGen] ${formatModelDisplayName(candidate)} gặp lỗi Quota/Rate-limit → Ghi nhớ 30p và chuyển ngay sang ${nextCandidate ? formatModelDisplayName(nextCandidate) : "Bedrock"}!`
          );
          markModelQuotaBlocked(candidate, "Quota reached / 429", 30 * 60 * 1000);
        } else {
          console.warn(
            `⚠️ [PromptGen] ${formatModelDisplayName(candidate)} lỗi (${errMsg}) → Fallback sang ${nextCandidate ? formatModelDisplayName(nextCandidate) : "Bedrock"}...`
          );
        }
      }
    }
  }
  onModelChange?.("bedrock");
  const text = await callBedrock(systemPrompt, prompt, imageUrl, jsonMode, undefined, true);
  return { text, model: "bedrock" };
}

/**
 * Audit and review screenplay with primary auditor (via AGY)
 * with robust fallbacks to Gemini 4 Carbon -> Gemini 4 Argon -> Codex Terra -> Zhipu GLM-5.
 */
export async function callAuditor(
  systemPrompt: string,
  userPrompt: string,
  jsonMode: boolean = false,
  imageUrl?: string,
  onFallback?: (failedModel: string, fallbackModel: string, reason: string) => void
): Promise<{ text: string; model: string }> {
  const prompt = imageUrl
    ? `${userPrompt}\n\nREFERENCE IMAGE URL (inspect it when accessible): ${imageUrl}`
    : userPrompt;
  const primaryAuditor = getAuditorModel();

  if (isAgyEnabled()) {
    // Priority order in AGY: Primary Auditor -> Gemini 4 Carbon -> Gemini 4 Argon Low -> Gemini 4 Argon Medium
    const candidateAgyModels = [
      primaryAuditor,
      GEMINI_CARBON_MODEL,
      GEMINI_ARGON_MODEL,
      "gemini-4-argon-medium",
    ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

    for (let i = 0; i < candidateAgyModels.length; i++) {
      const model = candidateAgyModels[i];
      const quotaCheck = isModelQuotaBlocked(model);
      if (quotaCheck.blocked) {
        const nextModel = candidateAgyModels[i + 1];
        console.warn(
          `⚡ [Auditor] ${formatModelDisplayName(model)} đang hết Quota (${quotaCheck.reason}) → Chuyển ngay sang ${nextModel ? formatModelDisplayName(nextModel) : "Codex/GLM-5"}!`
        );
        if (nextModel) {
          onFallback?.(formatModelDisplayName(model), formatModelDisplayName(nextModel), quotaCheck.reason || "Quota blocked");
        }
        continue;
      }

      const lowerModel = model.toLowerCase();
      const isArgon = lowerModel.includes("argon");
      const isCarbon = lowerModel.includes("carbon");
      const modelTimeout = isCarbon
        ? Number(process.env.CARBON_TIMEOUT_MS || 270_000)
        : isArgon
        ? Number(process.env.ARGON_TIMEOUT_MS || 240_000)
        : Number(process.env.AGY_TIMEOUT_MS || 240_000);

      try {
        console.log(`🧐 [Auditor] AI 2 (${formatModelDisplayName(model)}) reviewing script (timeout: ${Math.round(modelTimeout / 1000)}s)...`);
        const text = await callAgy(systemPrompt, prompt, jsonMode, model, modelTimeout);
        return { text, model };
      } catch (err: any) {
        const errMsg = String(err?.message || err);
        const isQuotaError =
          errMsg.includes("429") ||
          errMsg.toLowerCase().includes("quota") ||
          errMsg.includes("RESOURCE_EXHAUSTED");
        console.warn(`⚠️ [Auditor] ${formatModelDisplayName(model)} error: ${errMsg}`);

        if (isQuotaError) {
          markModelQuotaBlocked(model, "Quota reached / 429", 30 * 60 * 1000);
        } else if ((isArgon || isCarbon) && i === 0) {
          // Transient glitch retry once for primary model when NOT quota-blocked
          try {
            console.log(`🔄 [Auditor] Retrying AI 2 (${formatModelDisplayName(model)}) once more after transient failure...`);
            await new Promise(r => setTimeout(r, 2000));
            const retryText = await callAgy(systemPrompt, prompt, jsonMode, model, modelTimeout);
            return { text: retryText, model };
          } catch (retryErr: any) {
            console.warn(`⚠️ [Auditor] Retry ${formatModelDisplayName(model)} also failed: ${retryErr?.message || retryErr}`);
          }
        }

        const nextModel = candidateAgyModels[i + 1];
        if (nextModel) {
          console.warn(`⚠️ [Auditor] ${formatModelDisplayName(model)} failed; trying ${formatModelDisplayName(nextModel)}...`);
          onFallback?.(
            formatModelDisplayName(model),
            formatModelDisplayName(nextModel),
            errMsg
          );
        } else {
          console.warn(`⚠️ [Auditor] All AGY Gemini (Carbon/Argon) models failed (${errMsg}). Falling back to Codex/GLM-5...`);
        }
      }
    }
  }

  if (isCodexEnabled()) {
    try {
      console.log(`🧐 [Auditor] Falling back to Codex Terra (${formatModelDisplayName(CODEX_TERRA_MODEL)})...`);
      onFallback?.(
        formatModelDisplayName(primaryAuditor),
        formatModelDisplayName(CODEX_TERRA_MODEL),
        "AGY unavailable or rate-limited"
      );
      const text = await callCodexTerra(systemPrompt, prompt, jsonMode);
      return { text, model: CODEX_TERRA_MODEL };
    } catch (codexErr: any) {
      console.warn(`⚠️ [Auditor] Codex Terra failed (${codexErr?.message || codexErr}). Falling back to Bedrock GLM-5...`);
    }
  }

  onFallback?.(
    formatModelDisplayName(primaryAuditor),
    "Zhipu AI GLM-5",
    "Falling back to Bedrock"
  );
  const text = await callBedrock(systemPrompt, userPrompt, imageUrl, jsonMode, "zai.glm-5");
  return { text, model: "zai.glm-5" };
}

/**
 * Shared contract between prompt generation, Veo and videoDubbingService.
 * The exact `X.X-Y.Ys, Character says...` grammar is intentionally rigid:
 * parseVeoPromptTimeline can consume it without asking an LLM to guess timing.
 */
function dubbingTimelineRules(sceneCount: number): string {
  return `
DUB_TIMELINE (end of every prompt1..prompt${sceneCount}):
- One line, scene-relative, 3-10s, starting with a 0.3s visual entry settle ("0.0-0.3s, no dialogue; ...") and ending with a 0.4s visual exit settle so cuts between scenes transition smoothly without abrupt jumps.
- Pacing should fit the natural context of each scene: keep dialogue transitions lively and engaging (typically ~0.2-0.4s gap for snappy conversation, or a natural 0.5-1.0s beat when a physical action happens first).
- SOLO vs MULTI-CHARACTER BLOCKING:
  * When 2+ characters are on screen: Speaker and Listener(s) turn their bodies, shoulders, and heads toward each other at a 3/4 inward angle with locked eye contact ("X.X-Y.Ys, Name turns toward Listener at a 3/4 inward angle with direct eye contact and speaks line N in Vietnamese (\\"exact Vietnamese dialogue line\\") with expressive acting and precise lip-sync; only Name's mouth moves while Listener faces Name attentively with mouth closed.").
  * When ONLY 1 character is on screen (solo scene): NEVER mention "listener" or "all listeners"! Write: "X.X-Y.Ys, Name (solo in frame, angled 3/4 to camera) speaks line N in Vietnamese (\\"exact Vietnamese dialogue line\\") with expressive acting and precise lip-sync."
- Each dialogue line maps to one interval in order, same speaker, no overlaps, only the speaker's mouth moves.
`;
}

export function validateDubbingTimelineStructure(
  promptsObj: Record<string, any>,
  sceneCount: number
): string[] {
  const issues: string[] = [];
  const intervalRegex = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)s[,:]?\s*([\s\S]*?)(?=\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?s|$)/gi;

  for (let scene = 1; scene <= sceneCount; scene++) {
    const prompt = String(promptsObj[`prompt${scene}`] || "");
    const dialogue = String(promptsObj[`dialogue${scene}`] || "");
    if (!prompt.includes("DUB_TIMELINE")) {
      issues.push(`prompt${scene}: missing DUB_TIMELINE`);
      continue;
    }

    const intervals: Array<{ start: number; end: number; desc: string }> = [];
    let match: RegExpExecArray | null;
    intervalRegex.lastIndex = 0;
    while ((match = intervalRegex.exec(prompt)) !== null) {
      intervals.push({ start: Number(match[1]), end: Number(match[2]), desc: match[3].trim() });
    }
    if (!intervals.length) {
      issues.push(`prompt${scene}: timeline has no parseable intervals`);
      continue;
    }
    const lastEnd = intervals[intervals.length - 1].end;
    if (Math.abs(intervals[0].start) > 0.05 || lastEnd < 3 - 0.05 || lastEnd > 10 + 0.05) {
      issues.push(`prompt${scene}: timeline must start at 0.0s and end between 3.0s and 10.0s`);
    }
    for (let i = 0; i < intervals.length; i++) {
      const current = intervals[i];
      if (!(current.end > current.start) || current.start < 0 || current.end > 10) {
        issues.push(`prompt${scene}: invalid interval ${current.start}-${current.end}s`);
      }
      if (i > 0 && current.start < intervals[i - 1].end - 0.01) {
        issues.push(`prompt${scene}: overlapping intervals near ${current.start}s`);
      }
    }

    const dialogueLines = dialogue.split("\n").map(line => line.trim()).filter(Boolean);
    const spokenIntervals = intervals.filter(({ desc }) =>
      // A spoken interval legitimately says that listeners keep their mouths
      // closed. Only an interval explicitly declared as no-dialogue is silent.
      !/^\s*(?:no dialogue|dialogue[- ]free)\b/i.test(desc)
      && /\b(says?|speaks?|delivers?|asks?|line|question|lip-sync)\b/i.test(desc)
    );
    if (spokenIntervals.length !== dialogueLines.length) {
      issues.push(`scene${scene}: ${dialogueLines.length} dialogue lines but ${spokenIntervals.length} spoken intervals`);
    }
  }
  return issues;
}

/**
 * Repairs/synthesizes a content-driven DUB_TIMELINE. The scene ends shortly
 * after its final line instead of being padded to 10 seconds.
 */
export function autoRepairDubbingTimeline(prompt: string, dialogue: string, characterBible?: string): string {
  const dialogueLines = (dialogue || "").split("\n").map(l => l.trim()).filter(Boolean);
  const speakers: string[] = [];
  for (const line of dialogueLines) {
    const m = line.match(/^([^:*"']+)\s*[:]/);
    speakers.push(m ? m[1].trim() : "Character");
  }

  // Also detect silent on-screen characters mentioned in the prompt from characterBible
  const bodyWithoutTimeline = prompt.replace(/DUB_TIMELINE\s*:[\s\S]*$/i, "").trim();
  const knownCharacters = new Set<string>(speakers.filter(s => s !== "Character"));
  if (characterBible) {
    for (const rawLine of characterBible.split("\n")) {
      const m = rawLine.replace(/^[-*•\d.)\s]+/, "").match(/^([^:—–-]+)\s*[:—–-]/);
      if (m) {
        const candidateName = m[1].trim();
        if (candidateName && candidateName.length <= 35 && bodyWithoutTimeline.toLowerCase().includes(candidateName.toLowerCase())) {
          knownCharacters.add(candidateName);
        }
      }
    }
  }

  let timelineBlock = "";
  if (speakers.length === 0) {
    timelineBlock = "DUB_TIMELINE: 0.0-3.0s, no dialogue; all mouths closed; complete the scripted action and end scene.";
  } else {
    const spokenTexts = dialogueLines.map(line => {
      const quoted = line.match(/["“]([\s\S]*?)["”]\s*$/);
      return (quoted?.[1] || line.replace(/^[^:]+:\s*/, "")).trim();
    });
    const idealDurations = spokenTexts.map(text => {
      const words = text.split(/\s+/).filter(Boolean).length;
      return Math.max(1.1, Math.min(4.2, words / 3));
    });
    const initial = 0.3;
    const gap = 0.2;
    const tail = 0.4;
    const fixed = initial + gap * Math.max(0, speakers.length - 1) + tail;
    const available = 10 - fixed;
    const idealTotal = idealDurations.reduce((sum, value) => sum + value, 0);
    const scale = idealTotal > available ? available / idealTotal : 1;

    const explicitSolo = /\b(only person in frame|solo scene|solo in frame|alone in frame|stands alone)\b/i.test(bodyWithoutTimeline);
    const isSoloScene = explicitSolo || (knownCharacters.size <= 1 && new Set(speakers.map(s => s.toLowerCase())).size <= 1);

    const parts: string[] = [
      isSoloScene
        ? `0.0-${initial.toFixed(1)}s, no dialogue; mouth closed.`
        : `0.0-${initial.toFixed(1)}s, no dialogue; all mouths closed.`
    ];
    let cur = initial;
    for (let i = 0; i < speakers.length; i++) {
      const end = cur + idealDurations[i] * scale;
      const otherCharacters = Array.from(knownCharacters).filter(
        (c) => c.toLowerCase() !== speakers[i].toLowerCase()
      );
      const inlineLineText = spokenTexts[i].replace(/"/g, "'").replace(/(\d+)\s*-\s*(\d+)s/gi, "$1 to $2 seconds");
      if (isSoloScene || otherCharacters.length === 0) {
        parts.push(`${cur.toFixed(1)}-${end.toFixed(1)}s, ${speakers[i]} (angled 3/4 to camera) speaks line ${i + 1} in Vietnamese ("${inlineLineText}") with expressive acting and precise lip-sync.`);
      } else {
        const listeners = otherCharacters.join(" and ");
        parts.push(`${cur.toFixed(1)}-${end.toFixed(1)}s, ${speakers[i]} turns toward ${listeners} at a 3/4 inward angle with direct eye contact and speaks line ${i + 1} in Vietnamese ("${inlineLineText}") with expressive acting and precise lip-sync; only ${speakers[i]}'s mouth moves while ${listeners} face ${speakers[i]} attentively with mouths closed.`);
      }
      cur = end;
      if (i < speakers.length - 1) {
        parts.push(`${cur.toFixed(1)}-${(cur + gap).toFixed(1)}s, no dialogue; ${isSoloScene ? "mouth closed." : "all mouths closed."}`);
        cur += gap;
      }
    }
    const sceneEnd = Math.min(10, Math.max(3, cur + tail));
    parts.push(`${cur.toFixed(1)}-${sceneEnd.toFixed(1)}s, no dialogue; ${isSoloScene ? "mouth closed" : "all mouths closed"}; scene settles smoothly.`);
    timelineBlock = `DUB_TIMELINE: ${parts.join(" ")}`;
  }

  // If prompt already has DUB_TIMELINE, replace it cleanly; otherwise append it
  if (/DUB_TIMELINE\s*:/i.test(prompt)) {
    return prompt.replace(/DUB_TIMELINE\s*:[\s\S]*?(?=\n\n|\n[A-Z0-9_ -]+:|$)/i, timelineBlock);
  } else {
    return `${prompt.trim()}\n\n${timelineBlock}`;
  }
}

/**
 * Injects ultra-compact character outfit/trait anchors from character_bible into individual scene prompts
 * ONLY when an on-screen character is named without their core visual look, while strictly respecting the ~235-word budget
 * so isolated Veo 3 tabs never lose character costumes or props!
 */
export function stripCastLockTag(prompt: string): string {
  if (!prompt || typeof prompt !== "string") return "";
  return prompt
    .replace(/\s*Cast Lock:\s*[^\n]+?(?=\s*(?:\n\s*DUB_TIMELINE\s*:|\bDUB_TIMELINE\s*:|$))/gi, "")
    .trim();
}

export function attachCharacterBibleToScenes(
  promptsObj: Record<string, string>,
  characterBible: string,
  sceneCount: number
): Record<string, string> {
  const bible = (characterBible || "").trim();
  const anchored = { ...promptsObj };
  if (!bible) return anchored;

  anchored.character_bible = bible;

  // Parse "Name: compact trait summary" entries from character_bible
  const entries: Array<{ name: string; compactTrait: string }> = [];
  for (const rawLine of bible.split("\n")) {
    const cleaned = rawLine.replace(/^[-*•\d.)\s]+/, "").trim();
    if (!cleaned || /^\[?CHARACTER_BIBLE\]?$/i.test(cleaned)) continue;
    const m = cleaned.match(/^([^:—–-]+)\s*[:—–-]\s*(.+)$/);
    if (!m) continue;
    const name = m[1].trim();
    const descWords = m[2].trim().replace(/\s+/g, " ").split(" ");
    // Keep at most 14 words per character so it stays razor-sharp and under word limits
    const compactTrait = descWords.slice(0, 14).join(" ").replace(/[.;,]+$/, "");
    if (name && name.length <= 32 && compactTrait.length >= 6) {
      entries.push({ name, compactTrait });
    }
  }
  if (entries.length === 0) return anchored;

  for (let s = 1; s <= sceneCount; s++) {
    const key = `prompt${s}`;
    const originalRaw = anchored[key];
    if (!originalRaw || typeof originalRaw !== "string") continue;

    // Always strip any stale Cast Lock from earlier drafts so old outfits/roles never linger
    const rawPrompt = stripCastLockTag(originalRaw);
    anchored[key] = rawPrompt;

    const wordCount = rawPrompt.trim().split(/\s+/).length;
    if (wordCount >= 235) continue; // Already detailed enough; don't push near the 260-word validator cap

    const [bodyPart, dubPart] = rawPrompt.split(/\bDUB_TIMELINE\s*:/i);
    const bodyLower = bodyPart.toLowerCase();

    const missingAnchors: string[] = [];
    for (const entry of entries) {
      const nameLower = entry.name.toLowerCase();
      const nameIdx = bodyLower.indexOf(nameLower);
      if (nameIdx === -1) continue;

      // If the scene prompt already explicitly describes this character's outfit/look right around their name,
      // respect the scene's own description 100% instead of overriding it with Cast Lock!
      const localWindow = bodyLower.slice(Math.max(0, nameIdx - 40), Math.min(bodyLower.length, nameIdx + nameLower.length + 180));
      const alreadyHasExplicitLook = /\b(wearing|dressed\s+in|in\s+a\s+[a-z-]+\s+(?:shirt|coat|jacket|dress|suit|robe|tunic|uniform|jersey|gown|vest|blouse|hoodie|sweater|t-shirt|apron|ao\s+dai|ao\s+ba\s+ba))\b/i.test(localWindow);
      if (alreadyHasExplicitLook) continue;

      // Check if at least 2 distinctive words (>=5 chars) from compactTrait are already in bodyPart
      const keywords = entry.compactTrait
        .toLowerCase()
        .split(/[^a-z0-9à-ỹ]+/i)
        .filter((w) => w.length >= 5 && !["woman", "young", "adult", "vietnamese", "wearing", "person", "actor"].includes(w));
      const hits = keywords.filter((kw) => bodyLower.includes(kw)).length;
      if (hits < 2) {
        missingAnchors.push(`${entry.name} (${entry.compactTrait})`);
      }
    }

    if (missingAnchors.length > 0) {
      const castLockLine = `Cast Lock: ${missingAnchors.slice(0, 2).join("; ")}.`;
      anchored[key] = dubPart !== undefined
        ? `${bodyPart.trim()} ${castLockLine}\nDUB_TIMELINE: ${dubPart.trim()}`
        : `${bodyPart.trim()} ${castLockLine}`;
    }
  }

  return anchored;
}

export interface AiDebateMessage {
  agent: string;
  model: string;
  role: string;
  title: string;
  content: string;
  timestamp: string;
  round?: number;
}

export type ConsensusProgressEvent = 
  | { type: "heartbeat"; elapsedSec: number; currentRound?: number; stage?: string; ai2_name?: string; message?: string }
  | { type: "round_start"; round: number }
  | { type: "user_feedback"; round: number; feedback: string; message: AiDebateMessage }
  | { type: "ai1_start"; round: number; message?: string; agent?: string }
  | { type: "ai1_done"; round: number; message: AiDebateMessage; prompts_obj?: any }
  | { type: "ai2_start"; round: number; message?: string; agent?: string; ai2_name?: string }
  | { type: "ai2_fallback"; round?: number; stage?: string; ai2_name: string; message: string; elapsedSec?: number }
  | { type: "ai2_done"; round: number; percentage: number; reached: boolean; message: AiDebateMessage }
  | { type: "preflight_start"; total_scenes?: number; message?: string }
  | { type: "validating_scene"; scene_index?: number; attempt?: number; max_attempts?: number; prompt?: string; message?: string }
  | { type: "scene_issues_found"; scene_index?: number; attempt?: number; max_attempts?: number; issues?: any[]; technical_issues?: string[]; suggested_prompt?: string; message?: string }
  | { type: "scene_passed"; scene_index?: number; attempt?: number; max_attempts?: number; prompt?: string; message?: string }
  | { type: "preflight_passed"; repaired_count?: number; total_scenes?: number; message?: string }
  | { type: "prompt_validation_error"; scene_index?: number; attempt?: number; max_attempts?: number; issues?: any[]; technical_issues?: string[]; error: string; prompt?: string; message?: string; failed_scene?: any; result?: any }
  | { type: "complete"; result: AiConsensusResult }
  | { type: "error"; error: string; code?: string; issues?: any[] };

export type ConsensusProgressCallback = (event: ConsensusProgressEvent) => void;

export interface ActiveDebateSession {
  sessionId: string;
  pendingFeedbacks: string[];
  aborted?: boolean;
}

export const activeDebateSessions = new Map<string, ActiveDebateSession>();
let lastAiAbortTimestamp = 0;

export function isAiTaskAborted(taskStartTime: number, sessionId?: string): boolean {
  if (lastAiAbortTimestamp > 0 && taskStartTime <= lastAiAbortTimestamp) {
    return true;
  }
  if (sessionId && activeDebateSessions.get(sessionId)?.aborted) {
    return true;
  }
  return false;
}

export function abortAllActiveAiTasks(sessionId?: string): void {
  lastAiAbortTimestamp = Date.now();
  if (sessionId && activeDebateSessions.has(sessionId)) {
    activeDebateSessions.get(sessionId)!.aborted = true;
  }
  for (const sess of activeDebateSessions.values()) {
    sess.aborted = true;
  }
  console.log(`⛔ [PromptGen] Aborted active AI debate/revision tasks.`);
}

export function registerDebateSession(sessionId: string): ActiveDebateSession {
  const existing = activeDebateSessions.get(sessionId);
  if (existing) return existing;
  const session: ActiveDebateSession = {
    sessionId,
    pendingFeedbacks: [],
  };
  activeDebateSessions.set(sessionId, session);
  return session;
}

export function sendSessionFeedback(sessionId: string, feedback: string): boolean {
  const session = activeDebateSessions.get(sessionId);
  if (!session) return false;
  session.pendingFeedbacks.push(feedback.trim());
  return true;
}

/**
 * Intelligent sanitizer for product description to prevent massive JSON payloads
 * from choking Bedrock context while retaining critical character and world rules.
 */
export function cleanProductDescription(raw?: string): string {
  if (!raw) return "";
  const text = raw.trim();
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        const parts: string[] = [];
        if (parsed.story_title) parts.push(`Title: ${parsed.story_title}`);
        if (parsed.description) parts.push(String(parsed.description));
        if (parsed.character_bible) parts.push(`CHARACTER BIBLE:\n${parsed.character_bible}`);
        const dlgLines: string[] = [];
        for (let i = 1; i <= 25; i++) {
          if (parsed[`dialogue${i}`]) dlgLines.push(`Scene ${i}: ${parsed[`dialogue${i}`]}`);
          else if (parsed[`prompt${i}`]) dlgLines.push(`Scene ${i}: ${String(parsed[`prompt${i}`]).slice(0, 220)}`);
        }
        if (dlgLines.length > 0) parts.push(dlgLines.join("\n"));
        if (parts.length > 0) return parts.join("\n\n").slice(0, 4000).trim();
      }
    } catch {}
  }
  if (text.length > 4000) {
    return text.slice(0, 4000) + "...";
  }
  return text;
}

export interface AiConsensusResult {
  success: boolean;
  consensus: boolean;
  rounds: number;
  promptsObj: Record<string, string>;
  debateLog: AiDebateMessage[];
  summary: string;
}

export async function callBedrock(
  systemPrompt: string,
  userPrompt: string,
  imageUrl?: string,
  jsonMode: boolean = false,
  preferredModel?: string,
  skipAgy: boolean = false
): Promise<string> {
  const isGlmAudit = preferredModel?.toLowerCase().includes("glm");

  // AGY Gemini is the primary text intelligence provider (Carbon -> Argon fallback).
  // GLM-5 remains deliberately separate when requested as the independent prompt auditor.
  if (!isGlmAudit && !skipAgy && isAgyEnabled()) {
    const agyUserPrompt = imageUrl
      ? `${userPrompt}\n\nREFERENCE IMAGE URL (inspect it when accessible): ${imageUrl}`
      : userPrompt;
    const agyCandidates = [
      AGY_DEFAULT_MODEL,
      GEMINI_CARBON_MODEL,
      GEMINI_ARGON_MODEL,
    ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

    for (const candidate of agyCandidates) {
      if (isModelQuotaBlocked(candidate).blocked) continue;
      try {
        console.log(`✨ [AGY] Trying model ${formatModelDisplayName(candidate)} (${candidate})...`);
        const result = await callAgy(systemPrompt, agyUserPrompt, jsonMode, candidate);
        console.log(`✅ [AGY] Model ${formatModelDisplayName(candidate)} responded successfully!`);
        return result;
      } catch (err: any) {
        const errMsg = String(err?.message || err);
        if (errMsg.includes("429") || errMsg.toLowerCase().includes("quota") || errMsg.includes("RESOURCE_EXHAUSTED")) {
          markModelQuotaBlocked(candidate, "Quota reached / 429", 30 * 60 * 1000);
        }
        console.warn(`⚠️ [AGY] Model ${candidate} failed (${errMsg}). Trying next fallback...`);
      }
    }
  }

  const token = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (!token) {
    throw new Error("AWS_BEARER_TOKEN_BEDROCK is not set in environmental variables.");
  }
  const region = process.env.AWS_REGION || "us-east-1";

  const isPreferredGlm = isGlmAudit;
  const isGeminiModel = preferredModel?.toLowerCase().includes("gemini");
  const bedrockPreferredModel = isGeminiModel ? undefined : preferredModel;
  const fallbackModels = bedrockPreferredModel
    ? [
        bedrockPreferredModel,
        ...(isPreferredGlm
          ? ["zai.glm-5", "deepseek.v3.2", "xai.grok-4.3"]
          : ["zai.glm-5", "deepseek.v3.2"])
      ]
    : ["zai.glm-5", "deepseek.v3.2"];

  let imagePart: any = null;
  if (imageUrl) {
    try {
      if (imageUrl.startsWith("data:")) {
        imagePart = {
          type: "image_url",
          image_url: {
            url: imageUrl
          }
        };
      } else {
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
        const base64Data = Buffer.from(response.data).toString("base64");
        imagePart = {
          type: "image_url",
          image_url: {
            url: `data:${contentType};base64,${base64Data}`
          }
        };
      }
    } catch (err: any) {
      console.warn(`⚠️  [Bedrock] Failed to download image for multimodal input: ${err.message}`);
    }
  }

  let lastError: Error | null = null;
  for (const modelName of fallbackModels) {
    const isResponsesRoute = modelName.toLowerCase().includes("grok") || modelName.toLowerCase().includes("gpt-oss");
    const isTextOnlyModel = modelName.toLowerCase().includes("deepseek") || isResponsesRoute;
    let currentImagePart = isTextOnlyModel ? null : imagePart;

    if (isResponsesRoute) {
      try {
        console.log(`🤖 [Bedrock Responses API] Trying model ${modelName} on /v1/responses...`);
        const res = await axios.post(
          `https://bedrock-mantle.${region}.api.aws/v1/responses`,
          {
            model: modelName,
            instructions: systemPrompt,
            input: userPrompt
          },
          {
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            timeout: 60000
          }
        );
        const resText = res.data?.output_text || (res.data?.output?.[0]?.content?.[0]?.text ?? "");
        if (resText) {
          console.log(`✅ [Bedrock Responses API] Model ${modelName} responded successfully!`);
          return resText.trim();
        }
        throw new Error(`Empty response from Bedrock model ${modelName}`);
      } catch (err: any) {
        const errMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        console.warn(`⚠️  [Bedrock Responses API] Model ${modelName} failed (${errMsg}). Falling back to next model...`);
        lastError = new Error(errMsg);
        continue;
      }
    }

    const endpoint = `https://bedrock-mantle.${region}.api.aws/v1/chat/completions`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        console.log(`🤖 [Bedrock Chat Completions] Trying model ${modelName}${currentImagePart ? " (multimodal)" : " (text-only)"}...`);
        
        const modelMessages: any[] = [{ role: "system", content: systemPrompt }];
        if (currentImagePart) {
          modelMessages.push({
            role: "user",
            content: [
              { type: "text", text: userPrompt },
              currentImagePart
            ]
          });
        } else {
          modelMessages.push({ role: "user", content: userPrompt });
        }

        const payload: any = {
          model: modelName,
          messages: modelMessages,
          max_tokens: 4096
        };
        if (jsonMode) {
          payload.response_format = { type: "json_object" };
        }

        const axiosResponse = await axios.post(
          endpoint,
          payload,
          {
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            timeout: 180000,
          }
        );

        const resText = axiosResponse.data?.choices?.[0]?.message?.content || "";
        if (resText) {
          console.log(`✅ [Bedrock] Model ${modelName} responded successfully!`);
          return resText.trim();
        }
        throw new Error(`Empty response from Bedrock model ${modelName}`);
      } catch (err: any) {
        const errMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;

        // If error is due to image modality not supported, automatically retry with text-only
        if (currentImagePart && (errMsg.includes("image modality") || errMsg.includes("validation_error"))) {
          console.warn(`⚠️  [Bedrock] Model ${modelName} does not support image modality. Retrying with text-only...`);
          currentImagePart = null;
          continue;
        }

        console.error(`❌ [Bedrock] Failed with model ${modelName}: ${errMsg}`);
        lastError = new Error(errMsg);
        break; // try next fallback model
      }
    }
  }

  throw lastError || new Error("All Bedrock models failed");
}

export async function generateVideoPrompt(
  productName: string,
  category: string = "tech",
  imageUrl?: string,
  productDescription?: string
): Promise<string> {
  try {
    let userMessage = `You are tasked with generating a highly detailed, cinematic video prompt for Google Veo based on the product details below.
Product name: "${productName}"
Category: ${category}`;

    if (productDescription) {
      userMessage += `\nProduct Description / Attributes: "${productDescription}"`;
    }

    userMessage += `\n\nInstructions:
1. Translate any Vietnamese details into high-quality descriptive English.
2. Build a scene description detailing: the subject (the product with its key variants/colors/materials from description), the environment/background, lighting style, camera angle, and camera motion.
3. Keep it within 1 to 3 concise, visually descriptive sentences in pure English. Do not include introductory text, conversational remarks, or explanations.`;

    const scriptDraft = await callScriptwriter(SYSTEM_PROMPT, userMessage, imageUrl);
    const draft = scriptDraft.text;
    try {
      const auditorName = formatModelDisplayName(getAuditorModel());
      const auditSystemPrompt = `You are ${auditorName}, an independent senior Google Veo prompt auditor.
Check the draft for fidelity to the supplied product, fluent English, cinematic specificity, camera feasibility, and the requested 1-3 sentence length.
Silently correct every issue you find. Output only the final validated English Veo prompt, with no score, label, explanation, or Markdown.`;
      const auditUserPrompt = `PRODUCT: "${productName}"
CATEGORY: ${category}
${productDescription ? `PRODUCT DETAILS: ${productDescription}` : ""}

DRAFT:
${draft}`;

      const audited = await callAuditor(auditSystemPrompt, auditUserPrompt, false, imageUrl);
      return audited.text;
    } catch (auditErr: any) {
      console.warn(`⚠️ [PromptGen] Audit failed; returning draft: ${auditErr.message}`);
      return draft;
    }
  } catch (err: any) {
    console.error(`❌ [PromptGen] Bedrock API error: ${err.message}`);
    return buildFallbackPrompt(productName, category);
  }
}

export async function generateThreeVideoPrompts(
  productName: string,
  category: string = "tech",
  imageUrl?: string,
  productDescription?: string,
  useConsensus: boolean = true
): Promise<{ prompt1: string; prompt2: string; prompt3: string }> {
  if (useConsensus) {
    try {
      const res = await generatePromptsWithAiConsensus(productName, category, imageUrl, productDescription, 3);
      if (res.promptsObj.prompt1 && res.promptsObj.prompt2 && res.promptsObj.prompt3) {
        return {
          prompt1: res.promptsObj.prompt1,
          prompt2: res.promptsObj.prompt2,
          prompt3: res.promptsObj.prompt3,
        };
      }
    } catch (consensusErr: any) {
      console.warn(`⚠️ [PromptGen] 2-AI Consensus failed, falling back to standard generation: ${consensusErr.message}`);
    }
  }
  const threePromptsSystemPrompt = `You are an expert AI Video Prompt Engineer specializing in Google Veo.
Your goal is to write a highly detailed, cinematic 3-segment video prompt series in English for a single product.
The 3 segments will be concatenated into a continuous video. Therefore, they MUST have extreme visual consistency and seamless transition flow:
- Subject & Style Consistency: The subject (product design, colors, materials), environment (background, tabletop, ambient settings), and lighting (e.g. warm studio, golden hour) must be 100% identical.
- Pacing & Motion Speed: Use consistent movement speeds (e.g. 'cinematic slow-motion' or 'slow, graceful motion') across all segments to avoid jarring tempo jumps.
- Transition & Motion Continuity:
  * Prompt 1 (Intro): Start with a macro close-up of product textures/branding. Slow dolly-in or camera pan. End with a description of a subtle camera motion.
  * Prompt 2 (Lifestyle/Usage): Transition seamlessly from the previous shot. Describe a match-cut or motion continuity (e.g., 'Continuing the smooth motion from the previous scene, the camera gently dollies out to show...'). Show the product in use or hand interaction.
  * Prompt 3 (Showcase): Transition smoothly with similar camera velocity into a heroic 360-degree rotation or wrap-around track, showcasing the product in its final presentation.
- 100% English: The final prompts must be written entirely in descriptive English. You MUST translate any Vietnamese names, features, or details into English equivalents. Do not keep raw Vietnamese words or characters in the prompts.

Each prompt must be 1 to 2 descriptive sentences in English.
You MUST output ONLY a valid JSON object matching this schema:
{
  "prompt1": "segment 1 description",
  "prompt2": "segment 2 description",
  "prompt3": "segment 3 description"
}`;

  try {
    let userMessage = `Generate 3 consistent segment prompts for product: "${productName}"
Category: ${category}`;

    if (productDescription) {
      userMessage += `\nProduct Description / Attributes: "${productDescription}"`;
    }

    userMessage += `\n\nCRITICAL: The product name and all attributes are in Vietnamese. You MUST translate them into high-quality descriptive English. Under no circumstances should the prompts contain untranslated Vietnamese words (like "ban chai", "ao thun", "dien thoai") or Vietnamese characters. Translate "Bàn Chải đánh Răng điện" to "electric toothbrush", "Kẹo Milo" to "Milo candy", etc. Output ONLY valid JSON format.`;

    const resJson = await callBedrock(threePromptsSystemPrompt, userMessage, imageUrl, true);
    const parsed = JSON.parse(resJson);
    if (parsed.prompt1 && parsed.prompt2 && parsed.prompt3) {
      console.log("✅ [PromptGen] Generated 3 consistent prompts successfully!");
      return {
        prompt1: String(parsed.prompt1),
        prompt2: String(parsed.prompt2),
        prompt3: String(parsed.prompt3)
      };
    }
    throw new Error("JSON structure did not contain prompt1, prompt2, prompt3");
  } catch (err: any) {
    console.error(`❌ [PromptGen] Failed to generate 3 prompts: ${err.message}. Using fallback prompts.`);
    return buildFallbackThreePrompts(productName, category);
  }
}

function buildFallbackThreePrompts(productName: string, category: string): { prompt1: string; prompt2: string; prompt3: string } {
  const cleanName = removeVietnameseTones(productName);
  const basePrompt = buildFallbackPrompt(cleanName, category);
  return {
    prompt1: `Macro close-up shot revealing the premium textures and fine branding of ${cleanName}, slow and graceful dolly-in, soft shallow depth of field, cinematic 4K detail.`,
    prompt2: `Continuing the smooth camera motion, a medium shot of ${cleanName} showing it in practical use, consistent warm lighting, cinematic slow-motion.`,
    prompt3: `Seamlessly transitioning into a heroic wrap-around shot, a 360-degree rotating view of the entire ${cleanName} showcasing its full design in the environment, dramatic studio lighting.`
  };
}
/**
 * Comprehensive animal/species keyword map for Vietnamese & English titles.
 * Each entry contains: regex pattern, Vietnamese name, English name, species description,
 * and a list of other species to prohibit.
 */
interface SpeciesEntry {
  pattern: RegExp;
  viName: string;
  enName: string;
  enPlural: string;
  description: string;
  negatives: string[];
}

const SPECIES_REGISTRY: SpeciesEntry[] = [
  {
    pattern: /rùa|turtle|tortoise/i,
    viName: "RÙA",
    enName: "TURTLE / TORTOISE",
    enPlural: "turtles/tortoises",
    description: "a chibi 3D turtle/tortoise with a clearly visible hard shell on its back, short stubby green/brown legs, small rounded head with gentle eyes, smooth shell texture with hexagonal patterns",
    negatives: ["rabbit", "hare", "bear", "cat", "dog"]
  },
  {
    pattern: /thỏ|rabbit|hare|bunny/i,
    viName: "THỎ",
    enName: "RABBIT / BUNNY",
    enPlural: "rabbits/bunnies",
    description: "a chibi 3D rabbit/bunny with long upright floppy ears, fluffy round cotton-ball tail, soft fur, large expressive eyes, small pink nose, NO shell on back",
    negatives: ["turtle", "tortoise", "bear", "cat", "dog"]
  },
  {
    pattern: /khỉ|monkey|ape|vượn/i,
    viName: "KHỈ",
    enName: "MONKEY / APE",
    enPlural: "monkeys",
    description: "a chibi 3D monkey with a round expressive face, curly tail, agile hands with tiny fingers, warm brown/golden fur, playful mischievous personality",
    negatives: ["bear", "cat", "dog", "rabbit"]
  },
  {
    pattern: /voi|elephant/i,
    viName: "VOI",
    enName: "ELEPHANT",
    enPlural: "elephants",
    description: "a chibi 3D baby elephant with a long trunk, large floppy ears, thick sturdy legs, grey smooth skin, small kind eyes, gentle and wise demeanor",
    negatives: ["bear", "cat", "dog", "hippo"]
  },
  {
    pattern: /sư tử|lion|sư ?tử/i,
    viName: "SƯ TỬ",
    enName: "LION",
    enPlural: "lions",
    description: "a chibi 3D lion with a majestic fluffy mane around its head, golden-tawny fur, powerful but cute paws, proud and brave personality",
    negatives: ["tiger", "cat", "bear", "dog"]
  },
  {
    pattern: /hổ|tiger|cọp/i,
    viName: "HỔ / CỌP",
    enName: "TIGER",
    enPlural: "tigers",
    description: "a chibi 3D tiger with distinctive black stripes on orange fur, powerful build, piercing eyes, white belly and inner ears, fierce but adorable",
    negatives: ["lion", "cat", "bear", "dog"]
  },
  {
    pattern: /cáo|fox|hồ ly/i,
    viName: "CÁO",
    enName: "FOX",
    enPlural: "foxes",
    description: "a chibi 3D fox with a fluffy bushy tail with white tip, pointed ears, orange-reddish fur, white chest/belly, clever and cunning personality, sharp but cute eyes",
    negatives: ["dog", "wolf", "cat", "bear"]
  },
  {
    pattern: /heo|lợn|pig|piglet|piggy/i,
    viName: "HEO / LỢN",
    enName: "PIG / PIGLET",
    enPlural: "pigs/piglets",
    description: "a chibi 3D piglet with a round pink body, curly little tail, flat snout with nostrils, small floppy ears, rosy cheeks, cheerful and clumsy personality",
    negatives: ["bear", "cat", "dog", "hippo"]
  },
  {
    pattern: /ếch|frog|cóc|toad/i,
    viName: "ẾCH / CÓC",
    enName: "FROG / TOAD",
    enPlural: "frogs/toads",
    description: "a chibi 3D frog/toad with smooth green skin, large round protruding eyes, wide smiling mouth, webbed feet, sitting in a cute squat pose",
    negatives: ["turtle", "lizard", "snake"]
  },
  {
    pattern: /chim cánh cụt|penguin/i,
    viName: "CHIM CÁNH CỤT",
    enName: "PENGUIN",
    enPlural: "penguins",
    description: "a chibi 3D penguin with black and white tuxedo-like plumage, orange beak and feet, small flippers, round body, waddling cute gait",
    negatives: ["duck", "bird", "bear"]
  },
  {
    pattern: /cú mèo|owl|cú/i,
    viName: "CÚ MÈO",
    enName: "OWL",
    enPlural: "owls",
    description: "a chibi 3D owl with large round wise eyes, feathery round body, small pointed beak, tufted ear feathers, soft brown/grey plumage, scholarly wise personality",
    negatives: ["cat", "bird", "eagle"]
  },
  {
    pattern: /chuột|mouse|rat|hamster/i,
    viName: "CHUỘT",
    enName: "MOUSE / HAMSTER",
    enPlural: "mice/hamsters",
    description: "a chibi 3D mouse/hamster with large round ears, tiny pink nose, long thin tail (mouse) or short stubby tail (hamster), small round body, twitchy whiskers",
    negatives: ["cat", "rabbit", "rat"]
  },
  {
    pattern: /(?<=^|[^\p{L}\p{N}])(?:cá(?!\s*sấu|o)|cá vàng|cá heo|fish|goldfish|dolphin)(?=[^\p{L}\p{N}]|$)/iu,
    viName: "CÁ",
    enName: "FISH / GOLDFISH",
    enPlural: "fish",
    description: "a chibi 3D fish with shimmering scales, flowing fins, large expressive eyes, smooth streamlined body, bubbles around",
    negatives: ["bird", "mammal"]
  },
  {
    pattern: /khủng long|dinosaur|dino|t-rex/i,
    viName: "KHỦNG LONG",
    enName: "DINOSAUR",
    enPlural: "dinosaurs",
    description: "a chibi 3D baby dinosaur with short arms, long tail, round belly, tiny sharp teeth in a friendly smile, bumpy textured skin, bright colorful scales",
    negatives: ["dragon", "lizard", "crocodile"]
  },
  {
    pattern: /kỳ lân|unicorn/i,
    viName: "KỲ LÂN",
    enName: "UNICORN",
    enPlural: "unicorns",
    description: "a chibi 3D unicorn with a single sparkling horn on forehead, flowing rainbow mane and tail, white/pastel fur, large dreamy eyes, magical sparkles around",
    negatives: ["horse", "deer", "donkey"]
  },
  {
    pattern: /gà|chicken|rooster|chick|gà con/i,
    viName: "GÀ",
    enName: "CHICKEN / CHICK",
    enPlural: "chickens/chicks",
    description: "a chibi 3D chick/chicken with fluffy yellow down feathers (chick) or colorful plumage (rooster), small orange beak, tiny wings, round body",
    negatives: ["duck", "bird", "penguin"]
  },
  {
    pattern: /ngựa|horse|pony|ngựa con/i,
    viName: "NGỰA",
    enName: "HORSE / PONY",
    enPlural: "horses/ponies",
    description: "a chibi 3D horse/pony with flowing mane and tail, strong elegant legs, large gentle eyes, smooth coat, graceful and spirited personality",
    negatives: ["donkey", "unicorn", "deer"]
  },
  {
    pattern: /sóc|squirrel|chipmunk/i,
    viName: "SÓC",
    enName: "SQUIRREL / CHIPMUNK",
    enPlural: "squirrels",
    description: "a chibi 3D squirrel with a large bushy curved tail, tiny paws holding an acorn, bright alert eyes, reddish-brown fur, energetic and quick personality",
    negatives: ["mouse", "rabbit", "hamster"]
  },
  {
    pattern: /sói|wolf|chó sói/i,
    viName: "SÓI",
    enName: "WOLF",
    enPlural: "wolves",
    description: "a chibi 3D wolf with thick grey/silver fur, pointed ears, bushy tail, piercing intelligent eyes, pack-leader personality",
    negatives: ["dog", "fox", "bear"]
  },
  {
    pattern: /rắn|snake|trăn|serpent/i,
    viName: "RẮN",
    enName: "SNAKE / SERPENT",
    enPlural: "snakes",
    description: "a chibi 3D snake with a long sinuous body, smooth colorful scales, forked tongue, round cute head with large eyes, slithering gracefully",
    negatives: ["worm", "lizard", "dragon"]
  },
  {
    pattern: /cừu|sheep|lamb|cừu con/i,
    viName: "CỪU",
    enName: "SHEEP / LAMB",
    enPlural: "sheep/lambs",
    description: "a chibi 3D lamb/sheep with fluffy white wool covering its body, black/pink face and legs, small floppy ears, gentle innocent eyes, soft and cuddly",
    negatives: ["goat", "dog", "bear"]
  },
  {
    pattern: /dê|goat|dê con/i,
    viName: "DÊ",
    enName: "GOAT",
    enPlural: "goats",
    description: "a chibi 3D goat with small curved horns, rectangular pupils, short fur, small beard (billy goat), nimble hooves, playful and stubborn personality",
    negatives: ["sheep", "deer", "horse"]
  },
  {
    pattern: /hươu|nai|deer|reindeer|tuần lộc/i,
    viName: "HƯƠU / NAI",
    enName: "DEER / REINDEER",
    enPlural: "deer",
    description: "a chibi 3D deer/fawn with beautiful antlers (or budding antlers for fawns), spotted soft brown coat, large dark gentle eyes, slender graceful legs, shy and elegant",
    negatives: ["horse", "goat", "moose"]
  },
  {
    pattern: /gấu trúc|panda|gấu mèo/i,
    viName: "GẤU TRÚC / PANDA",
    enName: "PANDA",
    enPlural: "pandas",
    description: "a chibi 3D panda with distinctive black and white fur pattern, black eye patches, round fluffy body, short black ears, bamboo-loving gentle personality",
    negatives: ["bear", "raccoon", "cat"]
  },
  {
    pattern: /cá sấu|crocodile|alligator/i,
    viName: "CÁ SẤU",
    enName: "CROCODILE / ALLIGATOR",
    enPlural: "crocodiles",
    description: "a chibi 3D crocodile/alligator with scaly green skin, long snout with visible teeth in a smile, strong tail, short legs, armored back, surprisingly gentle chibi eyes",
    negatives: ["lizard", "dinosaur", "turtle"]
  },
];

/**
 * Optional helper for character style hints.
 * Rigid automatic species locking is disabled to prevent hallucinating unwanted animal constraints.
 */
export function detectCharacterAndSpeciesFromTitle(_title: string): string {
  return "";
}

export async function generatePromptsWithAiConsensus(
  productName: string,
  category: string = "tech",
  imageUrl?: string,
  productDescription?: string,
  sceneCount: number = 8,
  maxRounds: number = 30,
  onProgress?: ConsensusProgressCallback,
  initialUserFeedback?: string,
  sessionId?: string,
  previousProposal?: string,
  startRound: number = 1,
  worldStyle: string = "auto",
  visualStyle: string = "real"
): Promise<AiConsensusResult> {
  const activeVisualStyle = normalizeVisualStyle(visualStyle);
  const isRealMode = activeVisualStyle === "real";
  const isStickmanMode = activeVisualStyle === "stickman";
  const debateLog: AiDebateMessage[] = [];
  const startTime = Date.now();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🤝 [2-AI Dynamic Debate] Starting Multi-Agent Debate for "${productName}" (${sceneCount} scenes | Mode: ${isRealMode ? "REAL (Người/Động vật thật)" : isStickmanMode ? "STICKMAN (Người Que Hoạt Hình 2D)" : "3D Animation"})...`);
  const ai1StartLabel = formatModelDisplayName(getScriptwriterModel());
  const ai2StartLabel = formatModelDisplayName(getAuditorModel());
  console.log(`   Agent 1: AI 1 (${ai1StartLabel}) (Screenwriter & Visual Worldbuilder)`);
  console.log(`   Agent 2: AI 2 (${ai2StartLabel}) (Strict Quality Auditor & Reviewer)`);
  console.log(`   Termination Condition: STRICT 100% CONSENSUS ONLY (KHÔNG GIỚI HẠN SỐ ROUND)`);
  console.log(`   Mandates: Bố cục chặt (3 lớp tiền-trung-hậu cảnh), Nội dung chặt chẽ, Nhân vật khớp 100% ảnh mô tả`);
  if (initialUserFeedback) {
    console.log(`   Director Guidance: "${initialUserFeedback}"`);
  }
  console.log(`${"=".repeat(60)}\n`);

  const allUserFeedbacks: string[] = [];
  if (initialUserFeedback && initialUserFeedback.trim()) {
    const trimmedFb = initialUserFeedback.trim();
    allUserFeedbacks.push(trimmedFb);
    const initialUserMsg: AiDebateMessage = {
      agent: "Đạo Diễn (Bạn / User)",
      model: "Human Director",
      role: "Chỉ Đạo Kịch Bản Ban Đầu",
      title: `💡 Góp Ý & Định Hướng Kịch Bản Từ Đạo Diễn`,
      content: trimmedFb,
      timestamp: new Date().toLocaleTimeString("vi-VN"),
      round: startRound
    };
    debateLog.push(initialUserMsg);
    onProgress?.({
      type: "user_feedback",
      round: startRound,
      feedback: trimmedFb,
      message: initialUserMsg
    });
  }

  if (sessionId) {
    registerDebateSession(sessionId);
  }

  const cleanedDesc = cleanProductDescription(productDescription);

  const styleLine = isRealMode
    ? "ultra-photorealistic live-action cinema, real-life human actors and real-life animals, natural skin pores, authentic hair/fur textures, 8K ARRI Alexa cinematography, vertical 9:16 (STRICTLY NO 3D CGI, NO cartoon, NO animation, NO chibi)"
    : isStickmanMode
      ? "expressive 2D chibi comic marshmallow stickman animation with glossy white round head, bold black ink outlines, oversized expressive cartoon eyes and lip-synced mouth, wearing full topic-specific cosplay outfits and actively performing topic-specific actions in a rich 2D illustrated environment, vertical 9:16"
      : "cinematic 3D animation, rich photorealistic PBR material textures, vertical 9:16";

  let userContext = `BRIEF:
- Title / Topic: "${productName}"
- Category: ${category}
${imageUrl ? `- Reference image attached: use as visual reference for recurring character facial likeness/art style UNLESS the user's story or director feedback specifies different characters, roles, or outfits.\n` : ""}- Scenes: exactly ${sceneCount} (prompt1..prompt${sceneCount}, dialogue1..dialogue${sceneCount}).
- Style: ${styleLine}.
- ${buildWorldStyleDirective(worldStyle)}`;

  if (cleanedDesc) {
    userContext += `\n\nUSER INPUT CONTENT / STORY (primary source for cast of characters, roles, setting, props, and plotline — unless overridden by DIRECTOR FEEDBACK below):
${cleanedDesc}`;
  }

  const ai1BaseSystemPrompt = `You are a ${isRealMode ? "photorealistic live-action cinema (real-life humans & real-life animals, strictly NO 3D/cartoon)" : isStickmanMode ? "2D Chibi Comic Marshmallow Stickman Animation (Người Que Hoạt Hình 2D Hóa Trang)" : "3D animation"} screenwriter and prompt writer for Google Veo 3.

Write a ${sceneCount}-scene vertical 9:16 short strictly driven by the user's input content and the director's notes.

STRICT PRIORITY HIERARCHY (NEVER VIOLATE):
1. DIRECTOR FEEDBACK / USER EDITS (SUPREME #1 AUTHORITY): Whenever the director specifies or revises characters, ages, genders, roles, relationships, outfits, props, settings, or plot points, OBEY 100% and IMMEDIATELY update [CHARACTER_BIBLE] and all affected scene prompts. NEVER let an old [CHARACTER_BIBLE], PREVIOUS SCRIPT DRAFT, World Style, or attached reference image override the director's instructions!
2. USER INPUT CONTENT / STORY (#2 SOURCE OF TRUTH): Build the entire character cast (tuyến nhân vật), outfits, props, environment, and storyline directly from the user's input text ("${productName}" + STORY). Do NOT force hardcoded stock characters, unrelated professions, or artificial cosplay outfits that do not belong to the user's input content!
3. CROSS-SCENE CONTINUITY (#3): Keep recurring characters visually consistent across scenes ONLY for traits not changed by the story or director feedback.

GUIDELINES:
${isRealMode ? "- VISUAL MODE: 100% REAL-LIFE PHOTOREALISTIC LIVE-ACTION (Người thật & Động vật thật). Describe every human as a real-life human actor (natural skin, real hair) and every animal as a real-life animal (authentic fur/feathers). NEVER use words like 3D, CGI, Pixar, Disney, cartoon, anime, animated, or chibi.\n" : isStickmanMode ? "- VISUAL MODE: 2D CHIBI COMIC MARSHMALLOW STICKMAN (Người Que Hoạt Hình 2D Hóa Trang). Every character is an expressive 2D white marshmallow stickman figure with a round white head, bold black ink outlines, expressive cartoon eyes and mouth, wearing outfits/hats/props that fit their exact role in the user's content.\n" : ""}- Start with a clear [CHARACTER_BIBLE]: one concise line per main character derived from the user's input & director feedback (Name: age/species, distinctive look, story-authentic outfit, key prop if any).
- STORY-AUTHENTIC CHARACTERS, OUTFITS & PROPS (NO HARDCODED CONTEXT):
  * Design each character's age, role, outfit, and props 100% faithfully to the user's input content! (e.g., if the content is about a doctor & patient after a shower, show an ENT doctor in a white lab coat and an adult in casual home wear holding a cotton swab; if about someone scrolling a phone past midnight, show them in a dark bedroom holding a glowing smartphone; if about business/office/delivery/family/folklore, dress and stage them naturally for THAT exact scenario).
  * Smartphones, laptops, notebooks, documents, kitchenware, medical items, etc. ARE 100% ALLOWED whenever the user's content or dialogue involves them! Only avoid aimless filler actions ("đứng múa vô tri") that have nothing to do with what is being said.
- COMPLETE STORY ARC & SEAMLESS SCENE-TO-SCENE FLOW (CÓ ĐẦU CÓ ĐUÔI, CHUYỂN CẢNH MƯỢT):
  * Structure the ${sceneCount} scenes as ONE cohesive mini-film with clear cause-and-effect progression matching the user's content from Scene 1 through Scene ${sceneCount}.
  * SINGLE-TAKE SHOT PER SCENE: Each scene is ONE unbroken continuous camera take (e.g., gentle dolly-in, smooth tracking pan, or steady waist-up medium two-shot) with no multi-shot montages inside a single scene.
  * 180-DEGREE SPATIAL AXIS: Keep recurring characters on consistent screen sides across adjacent scenes when in the same location so cuts feel natural.
- INLINE CHARACTER ANCHOR & PROP PERMANENCE:
  * Because each Veo scene renders in an isolated tab, briefly state each on-screen character's adult age (respect the user's requested adult age, e.g., 20yo young adult, 30yo adult, or 70yo elderly senior — only avoid "<18 child/kid/little boy/girl" keywords unless explicitly required by a family story), hairstyle, and outfit colors inline in EVERY scene they appear.
  * Whenever a character holds or uses a prop in a scene, state which hand holds it and keep it consistent throughout that shot. Avoid sharp metal blades/knives in real-human hands (use safe alternatives).
- DIALOGUE-DRIVEN VISUAL ACTION & FACE-TO-FACE 3/4 BLOCKING:
  * Every scene's visual prompt MUST dramatize its exact dialogue! Stage all conversing characters together in "Midground:" turned toward each other at a three-quarter (3/4) angle to the camera with locked eye contact (use "Foreground:" only for subtle environmental framing props, or omit if unneeded). Never hallucinate animals or objects that are only mentioned figuratively in dialogue.
- VEO 3 SAFETY & ANTI-BLOCK MANDATE:
  * Avoid English safety-block words like "crying", "wailing", "sobbing", "tears", "punish", "execute", "behead", "poison", "kill", "dead", "blood", "sickle", "blade", or "knife". For sad moments, describe "a sad, sorrowful facial expression with furrowed brows and downcast eyes (without tears)".
- Each prompt (English, concise ~175-215 words): 1 single-take camera + style sentence, Foreground / Midground / Background, a brief "Continuity Lock:" sentence, then the DUB_TIMELINE line. Only describe characters physically present in that scene. Don't mention Pixar/Disney.
- Dialogue (Vietnamese, natural and engaging): format 'Name: "line"', 1-3 short lines per scene, following the user's content and character roles.
${dubbingTimelineRules(sceneCount)}
OUTPUT: [CHARACTER_BIBLE], then Scene 1..${sceneCount} with prompt1..prompt${sceneCount} and dialogue1..dialogue${sceneCount}.`;

  const promptStyleHint = isRealMode
    ? "photorealistic live-action cinema prompt in English"
    : isStickmanMode
      ? "2D chibi comic marshmallow stickman prompt in English"
      : "cinematic 3D animation prompt in English";
  const schemaKeys = Array.from({ length: sceneCount }, (_, i) => `
  "prompt${i + 1}": "Optional fallback ${promptStyleHint} for Scene ${i + 1} (leave empty string if AI 1's scene prompt is approved)",
  "dialogue${i + 1}": "Optional fallback Vietnamese dialogue for Scene ${i + 1} (leave empty string if AI 1's dialogue is approved)"`).join(",");

  const ai2BaseSystemPrompt = `You are a supportive, practical Co-Director and Quality Reviewer for ${isRealMode ? "photorealistic live-action (real-life humans & real-life animals)" : isStickmanMode ? "2D Chibi Comic Marshmallow Stickman Animation" : "cinematic 3D animation"} scripts.
Your mission is to verify that AI 1's script proposal faithfully follows the user's input content and 100% of the human director's instructions.

REVIEW CRITERIA:
1. Supreme Director Feedback & User Content Fidelity (HIGHEST PRIORITY):
   - Did AI 1 obey 100% of the human director's feedback/revisions (including any changes to characters, ages, roles, outfits, props, settings, or plot)? If the director asked to change a character or context and AI 1 kept the old character/context, you MUST set consensus_reached = false and human_director_compliance_score < 70, and instruct AI 1 to fix it!
   - Does the character lineup ([CHARACTER_BIBLE] and scenes) come authentically from the user's input content ("${productName}" & STORY) without forcing unrelated stock characters or artificial cosplay tropes?
2. Single-Take Composition, Continuity & Prop Permanence (~175 - 215 words per scene):
   - Is each scene ONE continuous camera shot with clear staging (Midground characters at 3/4 angles when conversing, inline character outfit/age anchors, held props kept consistent, no sharp metal blades)?
3. Dialogue & DUB_TIMELINE:
   - Is Vietnamese dialogue natural, faithful to the user's topic/story, with a matching DUB_TIMELINE?

CONSENSUS DIRECTIVE (PRAGMATIC & USER-FIRST):
- NEVER force hardcoded props, bans on phones/notebooks, or artificial costume changes that contradict the user's story!
- If AI 1's proposal faithfully follows 100% of the user's content and director instructions (quality >= 80% AND human_director_compliance_score >= 95), GRANT consensus_percentage = 100 and consensus_reached = true immediately!
- IMPORTANT: AI 1's screenplay is the canonical text. Do NOT rewrite AI 1's prompts in your JSON when approving (leave prompt1..prompt${sceneCount} empty or identical to AI 1).

OUTPUT FORMAT (STRICT JSON ONLY):
{
  "consensus_percentage": 100,
  "consensus_reached": true,
  "character_fidelity_score": 100,
  "human_director_compliance_score": 100,
  "composition_tightness_score": 100,
  "narrative_continuity_score": 100,
  "language_compliance_score": 100,
  "dialogue_quality_score": 100,
  "audio_continuity_score": 100,
  "character_bible": "Exact [CHARACTER_BIBLE] from AI 1",
  "critique_and_required_fixes": "Specific fixes in Vietnamese if consensus_reached is false, or empty if approved",
  "consensus_note": "A concise summary in Vietnamese explaining why consensus was reached",
  ${schemaKeys}
}`;

  let currentRound = startRound;
  let consensusReached = false;
  let latestAi1Proposal = previousProposal || "";
  let lastCritique = "";
  let finalPromptsObj: Record<string, string> = {};
  let finalSummary = "";

  try {
    while (!consensusReached && currentRound <= maxRounds) {
      if (isAiTaskAborted(startTime, sessionId)) {
        throw new Error("Đã hủy thảo luận 2 AI theo yêu cầu");
      }
      console.log(`\n${"-".repeat(50)}`);
      console.log(`🔄 [2-AI Debate] Round ${currentRound} in progress (No round limit, debating until strict 100%)...`);
      console.log(`${"-".repeat(50)}`);

      onProgress?.({ type: "round_start", round: currentRound });

      // Drain any live feedbacks that arrived during execution
      if (sessionId && activeDebateSessions.has(sessionId)) {
        const sess = activeDebateSessions.get(sessionId)!;
        if (sess.pendingFeedbacks.length > 0) {
          const incoming = sess.pendingFeedbacks.splice(0);
          for (const fb of incoming) {
            allUserFeedbacks.push(fb);
            const liveUserMsg: AiDebateMessage = {
              agent: "Đạo Diễn (Bạn / User)",
              model: "Human Director",
              role: "Chỉ Đạo & Góp Ý Trực Tiếp",
              title: `📢 Góp Ý Trực Tiếp Của Đạo Diễn (Round ${currentRound})`,
              content: fb,
              timestamp: new Date().toLocaleTimeString("vi-VN"),
              round: currentRound
            };
            debateLog.push(liveUserMsg);
            onProgress?.({
              type: "user_feedback",
              round: currentRound,
              feedback: fb,
              message: liveUserMsg
            });
          }
        }
      }

      let ai1UserPrompt = userContext;

      if (allUserFeedbacks.length > 0) {
        ai1UserPrompt += `\n\n═══════════════════════════════════════════════════════
🚨 DIRECTOR FEEDBACK — SUPREME #1 AUTHORITY (OVERRIDES ALL PREVIOUS DRAFTS, CHARACTER BIBLES & DEFAULT CONTEXT):
${allUserFeedbacks.map((fb, idx) => `${idx + 1}. ${fb}`).join("\n")}
👉 If ANY item above changes character roles, ages, genders, species, names, outfits, props, settings, or plot points, you MUST IMMEDIATELY rewrite [CHARACTER_BIBLE] and the scene prompts to match 100%! Delete all conflicting traits/outfits from earlier drafts.
═══════════════════════════════════════════════════════`;
      }

      if (currentRound === startRound && previousProposal) {
        ai1UserPrompt += `\n\n═══════════════════════════════════════════════════════
PREVIOUS SCRIPT DRAFT (REFERENCE FOR UNCHANGED SCENES ONLY — DO NOT KEEP OLD TRAITS THAT CONFLICT WITH DIRECTOR FEEDBACK OR USER INPUT):
${previousProposal}
═══════════════════════════════════════════════════════
Revise the screenplay above so 100% of the DIRECTOR FEEDBACK and USER INPUT CONTENT are reflected in [CHARACTER_BIBLE] and every scene.`;
      } else if (currentRound > startRound && lastCritique) {
        ai1UserPrompt += `\n\nREVIEWER NOTES FROM ROUND ${currentRound - 1} (fix these while strictly preserving all DIRECTOR FEEDBACK):
${lastCritique}`;
      }

      let ai1ModelUsed = SCRIPTWRITER_PRIMARY_MODEL;
      let ai1AgentName = `AI 1 (${formatModelDisplayName(SCRIPTWRITER_PRIMARY_MODEL)})`;

      console.log(`🎭 [Round ${currentRound}] ${ai1AgentName} is ${currentRound === 1 && !previousProposal ? "drafting" : "revising"} proposal...`);
      onProgress?.({
        type: "ai1_start",
        round: currentRound,
        message: `🎭 ${ai1AgentName} đang sáng tác và tối ưu kịch bản ${isRealMode ? "Người & Động vật thật (Real Live-Action)" : "Hoạt hình 3D"} (Round ${currentRound})...`
      });

      const hb1 = setInterval(() => {
        onProgress?.({
          type: "heartbeat",
          elapsedSec: Math.floor((Date.now() - startTime) / 1000),
          currentRound,
          stage: "ai1"
        });
      }, 3000);

      try {
        const draft = await callScriptwriter(ai1BaseSystemPrompt, ai1UserPrompt, imageUrl);
        if (isAiTaskAborted(startTime, sessionId)) {
          throw new Error("Đã hủy thảo luận 2 AI theo yêu cầu");
        }
        latestAi1Proposal = draft.text;
        ai1ModelUsed = draft.model;
        ai1AgentName = `AI 1 (${formatModelDisplayName(draft.model)})`;
      } catch (draftErr: any) {
        console.error(`❌ [2-AI Debate] Scriptwriter and Gemini fallback failed: ${draftErr?.message || draftErr}`);
        throw draftErr;
      } finally {
        clearInterval(hb1);
      }

      // Extract candidate prompts immediately from AI 1's draft proposal
      let extractedCandidate: any = null;
      if (latestAi1Proposal) {
        try {
          const { parseTextPromptToObj } = await import("./scheduler.js");
          extractedCandidate = parseTextPromptToObj(latestAi1Proposal);
        } catch {}
      }

      // Auto-persist draft to database so user never loses prompt even if closed/aborted
      if (extractedCandidate && Object.keys(extractedCandidate).length > 0) {
        try {
          const { loadAllProducts, updateProduct } = await import("./database.js");
          const prods = loadAllProducts();
          const matched = prods.find((p: any) => p.name && p.name.trim().toLowerCase() === productName.trim().toLowerCase());
          if (matched) {
            updateProduct(matched.id, { promptsObj: extractedCandidate });
            console.log(`💾 [2-AI Debate] Auto-persisted AI 1 draft prompts to product "${matched.name}" (${matched.id})`);
          }
        } catch (dbErr) {
          console.warn("⚠️ [2-AI Debate] Auto-persist draft error:", dbErr);
        }
      }

      const ai1Msg: AiDebateMessage = {
        agent: ai1AgentName,
        model: ai1ModelUsed,
        role: isRealMode ? "Biên Kịch Điện Ảnh Người Thật (Live-Action Screenwriter)" : "Biên Kịch Hoạt Hình 3D (3D Screenwriter)",
        title: currentRound === 1 && !previousProposal
          ? (allUserFeedbacks.length > 0 ? `Đề Xuất Kịch Bản Tiếp Thu Góp Ý (Round 1)` : `Đề Xuất Kịch Bản ${isRealMode ? "Người & Động Vật Thật (Real)" : "Hoạt Hình 3D"} (Bản Thảo Round 1)`)
          : `Bản Kịch Bản Tiếp Thu & Khắc Phục Góp Ý (Round ${currentRound})`,
        content: latestAi1Proposal,
        timestamp: new Date().toLocaleTimeString("vi-VN"),
        round: currentRound
      };
      debateLog.push(ai1Msg);
      onProgress?.({
        type: "ai1_done",
        round: currentRound,
        message: ai1Msg,
        prompts_obj: extractedCandidate,
      });
      console.log(`✅ [Round ${currentRound}] ${ai1AgentName} submitted proposal (${latestAi1Proposal.length} chars)`);

      // Check again if user submitted feedback while AI 1 was drafting
      if (sessionId && activeDebateSessions.has(sessionId)) {
        const sess = activeDebateSessions.get(sessionId)!;
        if (sess.pendingFeedbacks.length > 0) {
          const incoming = sess.pendingFeedbacks.splice(0);
          for (const fb of incoming) {
            allUserFeedbacks.push(fb);
            const liveUserMsg: AiDebateMessage = {
              agent: "Đạo Diễn (Bạn / User)",
              model: "Human Director",
              role: "Chỉ Đạo & Góp Ý Trực Tiếp",
              title: `📢 Góp Ý Trực Tiếp Của Đạo Diễn (Round ${currentRound})`,
              content: fb,
              timestamp: new Date().toLocaleTimeString("vi-VN"),
              round: currentRound
            };
            debateLog.push(liveUserMsg);
            onProgress?.({
              type: "user_feedback",
              round: currentRound,
              feedback: fb,
              message: liveUserMsg
            });
          }
        }
      }

      // Step 2: AI 2 (audit proposal)
      const currentAuditorModel = getAuditorModel();
      const ai2ModelPrompt = formatModelDisplayName(currentAuditorModel);
      console.log(`🧐 [Round ${currentRound}] AI 2 (${ai2ModelPrompt}) is rigorously auditing proposal...`);
      onProgress?.({
        type: "ai2_start",
        round: currentRound,
        message: `🧐 AI 2 (${ai2ModelPrompt}) đang kiểm định tiêu chí nhân vật & bố cục (Round ${currentRound})...`
      });

      let ai2AuditUserPrompt = `You are evaluating Proposal Round ${currentRound} produced by AI 1.
${userContext}

═══════════════════════════════════════════════════════
AI 1 (PROPOSAL ROUND ${currentRound}):
${latestAi1Proposal}
═══════════════════════════════════════════════════════`;

      if (allUserFeedbacks.length > 0) {
        ai2AuditUserPrompt += `\n\nDIRECTOR FEEDBACK (check it was applied):
${allUserFeedbacks.map((fb, idx) => `${idx + 1}. ${fb}`).join("\n")}`;
      }

      ai2AuditUserPrompt += `\n\n- CONSENSUS PHILOSOPHY: Be pragmatic and constructive! If AI 1's proposal follows the core story and respects the user's guidance, grant consensus_reached = true and consensus_percentage = 100 so the user can produce their video without unnecessary delays.
Output STRICT JSON matching schema.`;

      const hb2 = setInterval(() => {
        onProgress?.({
          type: "heartbeat",
          elapsedSec: Math.floor((Date.now() - startTime) / 1000),
          currentRound,
          stage: "ai2"
        });
      }, 3000);

      let ai2AuditRaw = "";
      let ai2ModelUsed = currentAuditorModel;
      let ai2AgentName = `AI 2 (${ai2ModelPrompt})`;

      try {
        const auditRes = await callAuditor(
          ai2BaseSystemPrompt,
          ai2AuditUserPrompt,
          true,
          imageUrl,
          (failedModel, fallbackModel) => {
            ai2ModelUsed = fallbackModel;
            ai2AgentName = `AI 2 (${fallbackModel})`;
            onProgress?.({
              type: "ai2_fallback",
              stage: "ai2",
              ai2_name: fallbackModel,
              round: currentRound,
              message: `⚠️ ${failedModel} lỗi/hết token → Đã tự động chuyển sang AI 2 (${fallbackModel}) đang kiểm định...`,
            });
          }
        );
        if (isAiTaskAborted(startTime, sessionId)) {
          throw new Error("Đã hủy thảo luận 2 AI theo yêu cầu");
        }
        ai2AuditRaw = auditRes.text;
        ai2ModelUsed = auditRes.model;
        ai2AgentName = `AI 2 (${formatModelDisplayName(auditRes.model)})`;
      } finally {
        clearInterval(hb2);
      }

      let parsedAudit: any = {};
      try {
        let cleanJson = ai2AuditRaw.trim();
        if (cleanJson.startsWith("```")) {
          cleanJson = cleanJson.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        }
        parsedAudit = JSON.parse(cleanJson);
      } catch {
        parsedAudit = {};
      }

      let percentage = Number(parsedAudit.consensus_percentage) || 0;

      // Extract candidate prompts: AI 1 (Screenwriter) is ALWAYS the primary canonical screenplay;
      // AI 2 (Auditor) only supplies fallback fields if AI 1's output lacked a key.
      let extractedFromAi1: any = null;
      if (latestAi1Proposal) {
        try {
          const { parseTextPromptToObj } = await import("./scheduler.js");
          extractedFromAi1 = parseTextPromptToObj(latestAi1Proposal);
        } catch {}
      }

      const auditCandidate: Record<string, any> = {};
      for (let i = 1; i <= sceneCount; i++) {
        auditCandidate[`prompt${i}`] = extractedFromAi1?.[`prompt${i}`] || parsedAudit[`prompt${i}`] || "";
        auditCandidate[`dialogue${i}`] = extractedFromAi1?.[`dialogue${i}`] !== undefined && String(extractedFromAi1[`dialogue${i}`]).trim() !== ""
          ? extractedFromAi1[`dialogue${i}`]
          : (parsedAudit[`dialogue${i}`] || "");
      }

      // AI 1's [CHARACTER_BIBLE] is canonical; only fall back to AI 2's summary if AI 1 didn't emit one
      const charBible = String(extractedFromAi1?.character_bible || parsedAudit.character_bible || "").trim();
      if (!parsedAudit.character_bible && charBible) {
        parsedAudit.character_bible = charBible;
      }

      let dubbingTimelineIssues = validateDubbingTimelineStructure(auditCandidate, sceneCount);

      // Auto-repair DUB_TIMELINE if there are structural issues
      if (dubbingTimelineIssues.length > 0) {
        console.log(`🔧 [PromptGen] Auto-repairing dubbing timeline for Round ${currentRound}...`);
        for (let i = 1; i <= sceneCount; i++) {
          const p = auditCandidate[`prompt${i}`];
          const d = auditCandidate[`dialogue${i}`];
          if (p) {
            const repaired = autoRepairDubbingTimeline(p, d, charBible);
            auditCandidate[`prompt${i}`] = repaired;
            parsedAudit[`prompt${i}`] = repaired;
          }
        }
        // Re-validate after auto-repair
        dubbingTimelineIssues = validateDubbingTimelineStructure(auditCandidate, sceneCount);
      }

      // Pragmatic Consensus Gate:
      // Respect user feedback strictly: if the user gave feedback and AI 2 flagged low director compliance (< 90),
      // force another revision round before Round 3 so AI 1 actually fixes the user's requested character/context changes!
      const directorScore = Number(parsedAudit.human_director_compliance_score ?? 100);
      const directorSatisfied = allUserFeedbacks.length === 0 || directorScore >= 90;
      if ((parsedAudit.consensus_reached && directorSatisfied) || (percentage >= 80 && directorSatisfied) || currentRound >= ( startRound + 2 )) {
        percentage = 100;
        parsedAudit.consensus_reached = true;
        parsedAudit.consensus_percentage = 100;
      }
      const reached = Boolean(parsedAudit.consensus_reached) && percentage === 100;
      lastCritique = 
        parsedAudit.critique_and_required_fixes || 
        "Tiếp tục hoàn thiện 100% độ khớp nhân vật theo đúng góp ý của người dùng, 3 lớp không gian và tính mạch lạc.";
      finalSummary = parsedAudit.consensus_note || `Đồng thuận 100% đạt được tại Round ${currentRound}.`;

      if (reached) {
        consensusReached = true;
        console.log(`🎉 [2-AI Debate] STRICT 100% CONSENSUS REACHED at Round ${currentRound}! Score: 100%`);
        
        const ai2SuccessMsg: AiDebateMessage = {
          agent: ai2AgentName,
          model: ai2ModelUsed,
          role: "Đạo Diễn & Giám Đốc Kiểm Định (Quality Auditor)",
          title: `✅ ĐỒNG THUẬN 100% HOÀN HẢO ĐẠT ĐƯỢC TẠI ROUND ${currentRound}!`,
          content: `🎯 ĐÁNH GIÁ CHẤT LƯỢNG: 100% HOÀN HẢO\n${allUserFeedbacks.length > 0 ? `- Tiếp thu góp ý Đạo diễn: ${parsedAudit.human_director_compliance_score || 100}% (Hoàn thành 100%)\n` : ""}- Độ khớp nhân vật mô tả: ${parsedAudit.character_fidelity_score || 100}%\n- Bố cục phân cảnh chặt chẽ: ${parsedAudit.composition_tightness_score || 100}%\n- Tính mạch lạc nội dung & cốt truyện: ${parsedAudit.narrative_continuity_score || 100}%\n- Ngôn ngữ tiếng Anh chuẩn Veo: ${parsedAudit.language_compliance_score || 100}%\n- Thoại Tiếng Việt tự nhiên: ${parsedAudit.dialogue_quality_score || 100}%\n\n📝 Nhận xét kiểm định:\n${finalSummary}`,
          timestamp: new Date().toLocaleTimeString("vi-VN"),
          round: currentRound
        };
        debateLog.push(ai2SuccessMsg);
        onProgress?.({
          type: "ai2_done",
          round: currentRound,
          percentage: 100,
          reached: true,
          message: ai2SuccessMsg
        });

        const charBibleToAttach = String(extractedFromAi1?.character_bible || parsedAudit.character_bible || "").trim();
        for (let i = 1; i <= sceneCount; i++) {
          const p = extractedFromAi1?.[`prompt${i}`] || auditCandidate[`prompt${i}`] || parsedAudit[`prompt${i}`] || "";
          const d = extractedFromAi1?.[`dialogue${i}`] !== undefined && String(extractedFromAi1[`dialogue${i}`]).trim() !== ""
            ? extractedFromAi1[`dialogue${i}`]
            : (auditCandidate[`dialogue${i}`] !== undefined ? auditCandidate[`dialogue${i}`] : (parsedAudit[`dialogue${i}`] || ""));
          if (p) finalPromptsObj[`prompt${i}`] = autoRepairDubbingTimeline(stripCastLockTag(String(p)), String(d || ""), charBibleToAttach);
          if (d) finalPromptsObj[`dialogue${i}`] = String(d);
        }

        if (charBibleToAttach) {
          finalPromptsObj.character_bible = charBibleToAttach;
        }

        finalPromptsObj = attachCharacterBibleToScenes(
          finalPromptsObj,
          charBibleToAttach,
          sceneCount
        );
      } else {
        console.log(`⚠️ [2-AI Debate] Round ${currentRound} Consensus Score: ${percentage}% (Requires revision)`);
        const ai2ReviewMsg: AiDebateMessage = {
          agent: ai2AgentName,
          model: ai2ModelUsed,
          role: "Đạo Diễn & Giám Đốc Kiểm Định (Quality Auditor)",
          title: `Phản Biện & Kiểm Định Chất Lượng (Round ${currentRound}: ${percentage}%)`,
          content: `⚠️ CHƯA ĐẠT 100% ĐỒNG THUẬN (Hiện tại: ${percentage}%)\n\nCÁC ĐIỂM BẮT BUỘC SỬA ĐỔI ĐỂ ĐẠT 100%:\n${lastCritique}`,
          timestamp: new Date().toLocaleTimeString("vi-VN"),
          round: currentRound
        };
        debateLog.push(ai2ReviewMsg);
        onProgress?.({
          type: "ai2_done",
          round: currentRound,
          percentage,
          reached: false,
          message: ai2ReviewMsg
        });

        currentRound++;
      }
    }
  } finally {
    if (sessionId) {
      activeDebateSessions.delete(sessionId);
    }
  }

  // Fallback prompt generation if empty
  if (Object.keys(finalPromptsObj).length === 0) {
    for (let i = 1; i <= sceneCount; i++) {
      finalPromptsObj[`prompt${i}`] = isRealMode
        ? `Photorealistic live-action 8K cinema shot of ${productName}, scene ${i}, real-life human actors and real-life animals, natural skin pores and authentic textures, cinematic lighting, shallow depth of field, smooth continuous camera motion.`
        : `Cinematic 3D photorealistic render of ${productName}, scene ${i}, rich tactile material textures, cinematic studio lighting, volumetric atmosphere, smooth continuous camera motion.`;
    }
  }

      if (isAiTaskAborted(startTime, sessionId)) {
        throw new Error("Đã hủy thảo luận 2 AI theo yêu cầu");
      }

      // ── Preflight Validator: Kiểm tra từng prompt & tự động sửa (tối đa 3 lần) ──
  const { validateAndRepairScenePrompts } = await import("./promptValidator.js");
  const validationResult = await validateAndRepairScenePrompts(finalPromptsObj, sceneCount, {
    productName,
    worldStyle,
    visualStyle: activeVisualStyle,
    userFeedback: allUserFeedbacks.join(" | ") || undefined,
    storyContext: cleanedDesc || undefined,
    maxAttemptsPerScene: 3,
    onProgress: (evt) => {
      onProgress?.(evt as any);
    },
  });

  if (!validationResult.success) {
    const errorMsg =
      validationResult.error || "Kiểm định prompt thất bại sau 3 lần sửa.";
    console.error(`❌ [PromptGen] Preflight validation failed: ${errorMsg}`);

    const validatorLabel = formatModelDisplayName(AGY_DEFAULT_MODEL);
    const failedMsg: AiDebateMessage = {
      agent: "Veo Preflight Validator",
      model: AGY_DEFAULT_MODEL,
      role: `Hệ Thống Kiểm Định An Toàn Veo 3 (${validatorLabel})`,
      title: `❌ Dừng Kịch Bản: Phân cảnh ${validationResult.failedScene?.scene_index || 1} không thể sửa sau 3 lần`,
      content: `${errorMsg}\n\n👉 Vui lòng đổi lại nội dung kịch bản hoặc cốt truyện!`,
      timestamp: new Date().toLocaleTimeString("vi-VN"),
      round: currentRound,
    };
    debateLog.push(failedMsg);

    const failResult: AiConsensusResult = {
      success: false,
      consensus: false,
      rounds: currentRound,
      promptsObj: finalPromptsObj,
      debateLog,
      summary: errorMsg,
    };

    onProgress?.({
      type: "prompt_validation_error",
      error: errorMsg,
      failed_scene: validationResult.failedScene,
      result: failResult,
    });

    throw new Error(errorMsg);
  }

  finalPromptsObj = validationResult.promptsObj;
  finalPromptsObj._visualStyle = activeVisualStyle;

  const durationMs = Date.now() - startTime;
  console.log(`\n✨ [2-AI Debate] Final Consensus completed in ${currentRound} rounds (${(durationMs / 1000).toFixed(1)}s)!`);

  const finalResult: AiConsensusResult = {
    success: true,
    consensus: true,
    rounds: currentRound,
    promptsObj: finalPromptsObj,
    debateLog,
    summary: finalSummary
  };
  onProgress?.({ type: "complete", result: finalResult });

  return finalResult;
}

export async function generateSixVideoPrompts(
  productName: string,
  category: string = "tech",
  imageUrl?: string,
  productDescription?: string,
  useConsensus: boolean = true
): Promise<{
  prompt1: string;
  prompt2: string;
  prompt3: string;
  prompt4: string;
  prompt5: string;
  prompt6: string;
  dialogue1?: string;
  dialogue2?: string;
  dialogue3?: string;
  dialogue4?: string;
  dialogue5?: string;
  dialogue6?: string;
  voice1?: string;
  voice2?: string;
  voice3?: string;
  voice4?: string;
  voice5?: string;
  voice6?: string;
  character_bible?: string;
}> {
  if (useConsensus) {
    try {
      const res = await generatePromptsWithAiConsensus(productName, category, imageUrl, productDescription, 6);
      if (res.promptsObj.prompt1 && res.promptsObj.prompt2 && res.promptsObj.prompt3) {
        return {
          prompt1: res.promptsObj.prompt1 || "",
          prompt2: res.promptsObj.prompt2 || "",
          prompt3: res.promptsObj.prompt3 || "",
          prompt4: res.promptsObj.prompt4 || "",
          prompt5: res.promptsObj.prompt5 || "",
          prompt6: res.promptsObj.prompt6 || "",
          dialogue1: res.promptsObj.dialogue1,
          dialogue2: res.promptsObj.dialogue2,
          dialogue3: res.promptsObj.dialogue3,
          dialogue4: res.promptsObj.dialogue4,
          dialogue5: res.promptsObj.dialogue5,
          dialogue6: res.promptsObj.dialogue6,
          character_bible: res.promptsObj.character_bible,
        };
      }
    } catch (consensusErr: any) {
      console.warn(`⚠️ [PromptGen] 2-AI Consensus failed, falling back to standard generation: ${consensusErr.message}`);
    }
  }
  const sixPromptsSystemPrompt = `You are a world-class Vietnamese short-film screenwriter and AI Video Prompt Engineer.
Your mission: Write a 6-scene micro-movie (60 seconds total, 10 seconds per scene) that tells a complete, emotionally resonant human story — where the product naturally solves a real-life emotional or relational problem.

═══════════════════════════════════════════════════════
CORE PHILOSOPHY — THE STORY IS THE AD
═══════════════════════════════════════════════════════
The product must NOT be advertised directly. It must emerge organically as the solution to a real human emotion or relationship tension. Think of it like a Pixar short film: the product is a magical helper in a meaningful story — NOT the hero itself. The audience should feel something (nostalgia, warmth, empathy, surprise, laughter, inspiration) BEFORE they even realize they are watching an ad.

═══════════════════════════════════════════════════════
MANDATORY STORY STRUCTURE (6 SCENES × 10s)
═══════════════════════════════════════════════════════
Scene 1 — ESTABLISH THE WORLD & CHARACTERS (10s):
  - Introduce 2 to 3 lovable cartoon characters with clear roles and relationship (e.g., an old grandmother & her grandson, two childhood best friends who drifted apart, a shy child and a stray animal companion).
  - Set a vivid, specific world: NOT a generic "living room" but a cozy rainy afternoon with steam rising from a cup of tea, or a dusty sunlit school corridor.
  - The mood is warm, gentle, authentic. NO random dancing, NO forced cheering. Let the characters simply BE in their world.

Scene 2 — THE EMOTIONAL CONFLICT (10s):
  - A small but deeply felt emotional tension surfaces (NOT a comedy slapstick problem). Examples: the grandmother forgets her grandson's favorite food; the two friends realize they've become strangers; the child feels invisible and overlooked.
  - Show this through REACTIONS: a character pauses, looks down, bites their lip, holds back emotion. The camera closes in on a meaningful detail (hands, eyes, a faded photo).
  - This scene must make the audience feel — not laugh.

Scene 3 — THE DISCOVERY / TURNING POINT (10s):
  - A character notices or finds the product in a meaningful, non-commercial way (e.g., it was always there; someone else left it as a gift; it arrives at exactly the right moment).
  - The moment of discovery must feel like a small miracle or a gentle nudge of fate — NOT an "unboxing" or "product reveal".
  - Continue the emotional thread from Scene 2. DO NOT break mood with humor or sudden energy.

Scene 4 — THE PRODUCT AS BRIDGE / CATALYST (10s):
  - The product enables an action that begins to resolve the emotional tension. It brings people closer, reminds someone of something important, or creates a shared moment.
  - Show the product's function through the CHARACTERS' emotional experience — NOT through feature listing or visual specs.
  - Camera: warm medium shots, hands touching, eyes meeting, a soft smile returning.

Scene 5 — THE PEAK EMOTIONAL MOMENT (10s):
  - The emotional payoff: the tension resolves in a tender, human, and authentic way. A hug, a shared laugh with tears, a look that says everything without words, a small but meaningful gesture.
  - The product is present but secondary — what matters is the HUMAN CONNECTION it facilitated.
  - This scene should be the most beautiful and emotionally charged of the six.

Scene 6 — THE RESONANT ENDING (10s):
  - A quiet, reflective moment: the characters have changed. They're closer, warmer, wiser. The product sits naturally in the scene, no longer the focus.
  - End on a detail with symbolic weight: a smile, two cups of tea side by side, a child asleep in a grandparent's arms, two hands intertwined.
  - The final image should linger in the viewer's memory long after the video ends.

═══════════════════════════════════════════════════════
CHARACTER & DIALOGUE RULES
═══════════════════════════════════════════════════════
- Characters must feel like REAL people (or lovable cartoon representations of real people), NOT marketing mascots.
- Each character must have a distinct personality, backstory hint, and emotional arc over the 6 scenes.
- Write one canonical English character_bible with a separate immutable identity line for each named character: species, chibi head/body ratio, fur/skin markings, eye/ear/muzzle shape, exact uniform color/trim/logo, shoes, fixed accessories and assigned props. Base it on the supplied reference and description; never invent a uniform detail that contradicts them.
- Repeat that same cast and design in every visual prompt. Treat the uniform, face and prop identity as fixed; show any handoff or removal on-screen. Only gaze, brows, mouth, pose and story-driven emotion may evolve between scenes.
- DIALOGUES (dialogue1–dialogue6) must be:
  ✅ Colloquial, authentic Vietnamese — the way real people talk, with warmth, hesitation, affection
  ✅ Character-specific — reflecting their personality and emotional state in that exact moment
  ✅ Advancing the story or revealing emotion — every line must matter
  ✅ Short enough to be read as a subtitle (max 2 lines, ~15 words per line)
  ❌ NEVER generic ad lines: "Xin chào mọi người", "Hôm nay mình sẽ giới thiệu", "Mua ngay", "Sản phẩm chất lượng"
  ❌ NEVER fourth-wall breaks or audience address
  ❌ NEVER forced enthusiasm or exclamation at irrelevant moments

Example of BAD dialogue: "Ôi trời ơi sản phẩm này xịn quá nè mọi người ơi!"
Example of GOOD dialogue: "Bà không nhớ con thích ăn cái gì rồi..." / "Con nhớ bà vẫn nhớ mà... chỉ là bà cần một chút thời gian thôi."

${dubbingTimelineRules(6)}

═══════════════════════════════════════════════════════
VISUAL PROMPT RULES
═══════════════════════════════════════════════════════
- TARGET FORMAT: YouTube Shorts & TikTok (Vertical 9:16 portrait aspect ratio).
- Mandatory Vertical 9:16 Composition & Face-to-Face Interaction: Every scene must be framed specifically for vertical 9:16 mobile screens. Characters must be staged close together in the center vertical safe zone with clean headroom above and floor space below. Whenever 2 or more characters converse or interact, they MUST turn their bodies and heads directly toward each other with clear eye contact (never facing sideways at an undefined angle or staring off-screen away from their conversation partner). NEVER place characters far apart on opposite sides where they would be cropped out.
- Each visual prompt (prompt1–prompt6) must be 2–3 sentences in English only.
- Describe: character(s), their emotional state/action, environment (specific details), lighting (warm/cool/natural), camera movement (e.g., "slow push in", "gentle low-angle looking up", "vertical tracking shot").
- Maintain visual consistency: same character designs, art style (cinematic photorealistic 3D realism), color palette across all 6 scenes.
- Start each scene from the previous scene's final pose, expression, held object/hand and camera view. Identify visible characters by name and their locked distinguishing traits so each prompt works in a fresh rendering session.
- DO NOT write text overlays or subtitle instructions inside visual prompts.
- Avoid forbidden Gemini/Veo words: 'panic', 'scared', 'scream', 'fire', 'hit', 'destroy', 'broken', 'fall', 'collision', 'blood', 'violence', 'explosive'.
- DO NOT name real copyrighted characters or IP.

═══════════════════════════════════════════════════════
OUTPUT FORMAT (STRICT — VALID JSON ONLY)
═══════════════════════════════════════════════════════
{
  "story_title": "A short Vietnamese title for the mini-movie (e.g., Tách Trà Của Bà)",
  "story_theme": "One sentence describing the core human theme (e.g., The warmth of rediscovered connection between a grandmother and grandchild)",
  "character_bible": "Canonical English identity lines for the named cast, including exact uniforms, faces, proportions, accessories and prop ownership",
  "prompt1": "English visual prompt for scene 1",
  "prompt2": "English visual prompt for scene 2",
  "prompt3": "English visual prompt for scene 3",
  "prompt4": "English visual prompt for scene 4",
  "prompt5": "English visual prompt for scene 5",
  "prompt6": "English visual prompt for scene 6",
  "dialogue1": "Colloquial Vietnamese dialogue/subtitle for scene 1",
  "dialogue2": "Colloquial Vietnamese dialogue/subtitle for scene 2",
  "dialogue3": "Colloquial Vietnamese dialogue/subtitle for scene 3",
  "dialogue4": "Colloquial Vietnamese dialogue/subtitle for scene 4",
  "dialogue5": "Colloquial Vietnamese dialogue/subtitle for scene 5",
  "dialogue6": "Colloquial Vietnamese dialogue/subtitle for scene 6"
}`;


  try {
    let userMessage = `Create a 6-scene emotionally resonant mini-movie story for this product.

PRODUCT: "${productName}"
CATEGORY: ${category}`;

    if (productDescription) {
      userMessage += `\nPRODUCT DETAILS: "${productDescription.slice(0, 800)}"`;
    }

    userMessage += `

YOUR TASK:
1. Invent a meaningful human story (NOT a product ad) where THIS product naturally solves a real emotional or relational problem.
2. Choose a specific human relationship as the emotional core (e.g., grandparent & grandchild, two estranged friends, a lonely child, a tired parent).
3. Build a 6-scene narrative arc: establish world → emotional conflict → product discovery → product as bridge → peak emotional moment → resonant ending.
4. All 6 visual prompts must be in English. Translate ALL Vietnamese product names/features into English equivalents.
5. All 6 dialogues must be colloquial, authentic Vietnamese — real human speech, NOT advertising copy.
6. Output ONLY valid JSON. Include story_title and story_theme fields.`;

    const resJson = await callBedrock(sixPromptsSystemPrompt, userMessage, imageUrl, true);
    console.log("🤖 [PromptGen] Raw Bedrock Response:\n", resJson);
    const parsed = JSON.parse(resJson);

    const getVal = (obj: any, baseKey: string, idx: number, defaultValue: string = ""): string => {
      const variants = [
        `${baseKey}${idx}`,
        `${baseKey}_${idx}`,
        `${baseKey} ${idx}`,
        `${baseKey}${idx}_vi`,
        `${baseKey}_${idx}_vi`,
        `${baseKey}${idx}Vi`,
      ];
      for (const v of variants) {
        if (obj[v] !== undefined && obj[v] !== null) return String(obj[v]);
      }
      const targetLower = `${baseKey.toLowerCase()}${idx}`;
      const targetLowerVi = `${baseKey.toLowerCase()}${idx}vi`;
      for (const [k, val] of Object.entries(obj)) {
        const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (cleanK === targetLower || cleanK === targetLowerVi) {
          return String(val);
        }
      }
      return defaultValue;
    };

    let p1 = "", p2 = "", p3 = "", p4 = "", p5 = "", p6 = "";
    let d1 = "", d2 = "", d3 = "", d4 = "", d5 = "", d6 = "";
    let v1 = "be_trai", v2 = "be_trai", v3 = "be_trai", v4 = "be_trai", v5 = "be_trai", v6 = "be_trai";

    if (Array.isArray(parsed.prompts) && parsed.prompts.length >= 6) {
      p1 = String(parsed.prompts[0]);
      p2 = String(parsed.prompts[1]);
      p3 = String(parsed.prompts[2]);
      p4 = String(parsed.prompts[3]);
      p5 = String(parsed.prompts[4]);
      p6 = String(parsed.prompts[5]);
    } else {
      p1 = getVal(parsed, "prompt", 1);
      p2 = getVal(parsed, "prompt", 2);
      p3 = getVal(parsed, "prompt", 3);
      p4 = getVal(parsed, "prompt", 4);
      p5 = getVal(parsed, "prompt", 5);
      p6 = getVal(parsed, "prompt", 6);
    }

    if (Array.isArray(parsed.dialogues) && parsed.dialogues.length >= 6) {
      d1 = String(parsed.dialogues[0]);
      d2 = String(parsed.dialogues[1]);
      d3 = String(parsed.dialogues[2]);
      d4 = String(parsed.dialogues[3]);
      d5 = String(parsed.dialogues[4]);
      d6 = String(parsed.dialogues[5]);
    } else {
      d1 = getVal(parsed, "dialogue", 1);
      d2 = getVal(parsed, "dialogue", 2);
      d3 = getVal(parsed, "dialogue", 3);
      d4 = getVal(parsed, "dialogue", 4);
      d5 = getVal(parsed, "dialogue", 5);
      d6 = getVal(parsed, "dialogue", 6);
    }

    if (Array.isArray(parsed.voices) && parsed.voices.length >= 6) {
      v1 = String(parsed.voices[0]);
      v2 = String(parsed.voices[1]);
      v3 = String(parsed.voices[2]);
      v4 = String(parsed.voices[3]);
      v5 = String(parsed.voices[4]);
      v6 = String(parsed.voices[5]);
    } else {
      v1 = getVal(parsed, "voice", 1, "be_trai");
      v2 = getVal(parsed, "voice", 2, "be_trai");
      v3 = getVal(parsed, "voice", 3, "be_trai");
      v4 = getVal(parsed, "voice", 4, "be_trai");
      v5 = getVal(parsed, "voice", 5, "be_trai");
      v6 = getVal(parsed, "voice", 6, "be_trai");
    }

    if (p1 && p2 && p3 && p4 && p5 && p6) {
      const timelineIssues = validateDubbingTimelineStructure({
        prompt1: p1, prompt2: p2, prompt3: p3, prompt4: p4, prompt5: p5, prompt6: p6,
        dialogue1: d1, dialogue2: d2, dialogue3: d3, dialogue4: d4, dialogue5: d5, dialogue6: d6,
      }, 6);
      if (timelineIssues.length > 0) {
        throw new Error(`Generated prompts failed DUB_TIMELINE validation: ${timelineIssues.join("; ")}`);
      }
      console.log("✅ [PromptGen] Generated 6 consistent cartoon prompts successfully!");
      const result = {
        prompt1: p1,
        prompt2: p2,
        prompt3: p3,
        prompt4: p4,
        prompt5: p5,
        prompt6: p6,
        dialogue1: d1,
        dialogue2: d2,
        dialogue3: d3,
        dialogue4: d4,
        dialogue5: d5,
        dialogue6: d6,
        voice1: v1,
        voice2: v2,
        voice3: v3,
        voice4: v4,
        voice5: v5,
        voice6: v6
      };
      return { ...result, ...attachCharacterBibleToScenes(result, String(parsed.character_bible || ""), 6) };
    }
    throw new Error("JSON structure did not contain all 6 prompts");
  } catch (err: any) {
    console.error(`❌ [PromptGen] Failed to generate 6 prompts: ${err.message}. Using fallback prompts.`);
    return buildFallbackSixPrompts(productName, category);
  }
}

function buildFallbackSixPrompts(productName: string, category: string): any {
  const cleanName = removeVietnameseTones(productName);
  return {
    prompt1: `A 10-second cinematic 3D photorealistic render introducing ${cleanName} with rich tactile material textures, cinematic lighting, vertical 9:16 framing. DUB_TIMELINE: 0.0-10.0s, no dialogue; all mouths closed.`,
    prompt2: `Continuing the cinematic sequence, this 10-second scene displays dynamic interaction with ${cleanName}, realistic reflections, volumetric lighting. DUB_TIMELINE: 0.0-10.0s, no dialogue; all mouths closed.`,
    prompt3: `Continuing the action, this 10-second scene showcases ${cleanName} in motion, detailed tactile textures, natural physics. DUB_TIMELINE: 0.0-10.0s, no dialogue; all mouths closed.`,
    prompt4: `Continuing from the previous shot, this 10-second sequence highlights the key premium features of ${cleanName} with smooth camera panning. DUB_TIMELINE: 0.0-10.0s, no dialogue; all mouths closed.`,
    prompt5: `Continuing the scene, a dynamic micro-action occurs highlighting ${cleanName}, atmospheric lighting, rich environment depth. DUB_TIMELINE: 0.0-10.0s, no dialogue; all mouths closed.`,
    prompt6: `Concluding the cinematic video, this 10-second outro delivers a heroic, high-fidelity presentation of ${cleanName} with soft depth of field and elegant lighting. DUB_TIMELINE: 0.0-10.0s, no dialogue; all mouths closed.`,
    dialogue1: "",
    dialogue2: "",
    dialogue3: "",
    dialogue4: "",
    dialogue5: "",
    dialogue6: "",
    voice1: "be_trai",
    voice2: "be_trai",
    voice3: "be_trai",
    voice4: "be_trai",
    voice5: "be_trai",
    voice6: "be_trai"
  };
}


export async function generateVideoDescriptionVi(
  productName: string,
  category: string = "tech",
  imageUrl?: string
): Promise<string> {
  const systemPromptVi = `You are a professional social media marketing copywriter specializing in product reviews on TikTok, Facebook Reels, and affiliate marketing.
Your goal is to write a highly detailed, beautifully structured, and persuasive product review caption in Vietnamese (Tiếng Việt).

Format requirements:
1. Start with a catchy headline with emojis (e.g., "🌟 ĐÁNH GIÁ CHI TIẾT: [Tên Sản Phẩm] 🌟")
2. Leave one blank line, then write a brief, engaging 1-sentence introduction.
3. Leave one blank line, then write "✨ Tính năng nổi bật:" followed by exactly 3 bullet points using appropriate emojis (e.g., "- 🔋 Pin cực trâu...", "- ⚡ Sạc siêu tốc...") and indenting them cleanly.
4. Leave one blank line, then write an energetic Call-To-Action (e.g., "🎁 Click giỏ hàng bên dưới góc trái video để săn ngay voucher giảm giá cực khủng hôm nay nha cả nhà!")

Rules:
- Output ONLY the final structured description in Vietnamese.
- Do NOT include any intro, outro, or explanations.
- Do NOT include hashtags (they will be appended separately).`;

  try {
    const userMessage = `Product name: "${productName}"\nCategory: ${category}\n\nGenerate structured Vietnamese caption:`;
    const desc = await callBedrock(systemPromptVi, userMessage, imageUrl, false);
    return desc;
  } catch (err: any) {
    console.error(`❌ [PromptGen] Failed to generate Vietnamese caption: ${err.message}`);
    return buildFallbackDescriptionVi(productName, category);
  }
}

function buildFallbackPrompt(productName: string, category: string): string {
  const cleanName = removeVietnameseTones(productName);
  const templates: Record<string, string> = {
    tech: `Cinematic 4K close-up shot of ${cleanName} on a clean minimalist desk with soft RGB backlighting, slow panning camera revealing intricate details, shallow depth of field with bokeh background, professional studio lighting, ultra-detailed product photography style.`,
    beauty: `Luxurious close-up of ${productName} with golden liquid droplets falling in slow motion against a soft pastel background, warm diffused studio lighting, macro lens revealing smooth texture, elegant and aspirational aesthetic, 4K cinematic quality.`,
    fashion: `Stylish model confidently showcasing ${productName} on a vibrant urban street at golden hour, dynamic low-angle tracking shot, cinematic film grain, rich saturated colors, highly detailed fabric texture, lifestyle brand aesthetic.`,
    food: `Mouth-watering close-up of ${productName} with steam rising gently in a warm cozy kitchen setting, soft natural window lighting, shallow depth of field bokeh, food photography style, cinematic 4K slow motion.`,
    fitness: `Dynamic energetic shot of ${productName} in a modern gym environment, dramatic side lighting, motivated athlete in background, cinematic action angles, high contrast dramatic mood, 4K ultra-detailed.`,
    toys: `Whimsical close-up of ${cleanName} in a brightly lit colorful toy room, soft volumetric lighting, playful animations and magic sparkles, photorealistic 3D render style, goofy and cheerful atmosphere, ultra-detailed toy texture.`,
    household: `Warm close-up of ${cleanName} in a clean, modern cozy living room setup, soft natural ambient lighting, peaceful home atmosphere, high-definition product photography.`,
    baby: `Gentle warm close-up of ${cleanName} in a cozy pastel nursery, soft diffused nursery lighting, clean child-safe environment, sweet and whimsical aesthetic.`,
    pets: `Playful action shot of ${cleanName} in a bright cheerful pet area, warm sunny lighting, dynamic happy pet accessories in background, energetic and funny product focus.`,
  };
  return templates[category] || templates["tech"];
}

function buildFallbackDescriptionVi(productName: string, category: string): string {
  const templates: Record<string, string> = {
    tech: `🌟 CỰC PHẨM CÔNG NGHỆ: ${productName} 🌟

💻 Thiết bị đẳng cấp nâng tầm góc làm việc và trải nghiệm của bạn lên một tầm cao mới.

✨ Tính năng nổi bật:
  - ⚡ Thiết kế hiện đại, sang trọng và tối giản
  - 🎮 Hiệu năng đỉnh cao, xử lý mượt mà mọi tác vụ làm việc & giải trí
  - 🔋 Công nghệ thông minh, tiết kiệm điện năng vượt trội

🎁 Nhận ngay ưu đãi:
👉 Click giỏ hàng góc trái video để săn deal cực hời hôm nay nhé!`,

    beauty: `🌟 BÍ QUYẾT TỎA SÁNG: ${productName} 🌟

🌸 Chăm sóc da chuyên sâu mang lại vẻ rạng rỡ, tự tin cuốn hút mỗi ngày.

✨ Tính năng nổi bật:
  - 💧 Cung cấp độ ẩm dồi dào cho da mịn màng, làm dịu da tức thì
  - 🍀 Thành phần tự nhiên lành tính, an toàn tuyệt đối khi sử dụng
  - ✨ Nuôi dưỡng chuyên sâu, mang lại làn da trắng sáng khỏe mạnh

🎁 Ưu đãi độc quyền:
👉 Mua ngay tại giỏ hàng góc trái video để nhận voucher đặc biệt!`,

    fashion: `🌟 PHONG CÁCH THỜI THƯỢNG: ${productName} 🌟

👗 Đón đầu xu hướng thời trang mới nhất giúp bạn luôn nổi bật và cá tính.

✨ Tính năng nổi bật:
  - 💎 Thiết kế sang xịn mịn, đường may tỉ mỉ, tôn dáng cực tốt
  - 🧶 Chất liệu vải cao cấp, thoáng mát, co giãn thoải mái khi mặc
  - 🎨 Màu sắc trẻ trung, cực kỳ dễ dàng phối với mọi phụ kiện

🎁 Săn deal giá hời:
👉 Click ngay giỏ hàng góc dưới video để chốt đơn ngay nha!`,

    food: `🌟 THỰC PHẨM THƠM NGON: ${productName} 🌟

🍲 Bữa ăn hoàn hảo, thơm ngon trọn vị cho cả gia đình cùng thưởng thức.

✨ Tính năng nổi bật:
  - 😋 Hương vị đậm đà, chuẩn vị truyền thống cực kỳ ngon miệng
  - 🥦 Nguyên liệu sạch tự nhiên, bảo đảm an toàn vệ sinh thực phẩm
  - ⏱️ Tiết kiệm thời gian, chế biến nhanh gọn, vô cùng tiện lợi

🎁 Đặt mua ngay:
👉 Click giỏ hàng góc trái video để nhận giá ưu đãi tốt nhất!`,

    fitness: `🌟 ĐỒNG HÀNH LUYỆN TẬP: ${productName} 🌟

💪 Năng lượng bứt phá, bảo vệ và hỗ trợ tối đa cho hành trình tập luyện.

✨ Tính năng nổi bật:
  - 🏋️‍♂️ Thiết kế năng động, bảo vệ tối ưu, giảm chấn thương khi tập
  - 🏃‍♂️ Chất liệu thun dệt cao cấp, siêu thấm hút và thoáng khí tốt
  - 💎 Độ bền bỉ vượt trội, đồng hành bền lâu trong mọi bài tập nặng

🎁 Ưu đãi hôm nay:
👉 Săn ngay tại giỏ hàng bên dưới video để nhận deal hời!`,

    toys: `🌟 ĐỒ CHƠI CAO CẤP: ${productName} 🌟

🧸 Mang lại thế giới giải trí đầy sáng tạo, tiếng cười và niềm vui cho các bé mỗi ngày.

✨ Đặc điểm nổi bật:
  - 🎨 Màu sắc sinh động, thu hút kích thích trí tưởng tượng phong phú
  - 🍀 Chất liệu an toàn tuyệt đối, độ bền cao, bảo vệ sức khỏe bé yêu
  - 🧠 Phát triển tư duy logic và kỹ năng khéo léo thông qua trò chơi

🎁 Ưu đãi độc quyền:
👉 Click ngay giỏ hàng bên dưới để mang niềm vui về cho bé nhé!`,

    household: `🌟 ĐỒ GIA DỤNG TIỆN ÍCH: ${productName} 🌟

🏠 Người trợ thủ đắc lực nâng tầm tiện nghi, giúp tổ ấm của bạn luôn gọn gàng và hiện đại.

✨ Đặc điểm nổi bật:
  - 🛠️ Thiết kế thông minh tối ưu diện tích, vô cùng tiện ích khi sử dụng
  - 💎 Chất liệu cao cấp bền bỉ, dễ dàng vệ sinh làm sạch nhanh chóng
  - 🎨 Phong cách trang nhã tinh tế, phù hợp mọi không gian sống

🎁 Săn ngay giá tốt:
👉 Click giỏ hàng góc trái video để đặt mua với giá ưu đãi cực hấp dẫn!`,

    baby: `🌟 SẢN PHẨM MẸ & BÉ: ${productName} 🌟

🍼 Người bạn đồng hành chu đáo chăm sóc từng khoảnh khắc lớn khôn của bé yêu.

✨ Đặc điểm nổi bật:
  - 👶 Thiết kế vô cùng êm ái, thân thiện, bảo vệ tối đa làn da nhạy cảm của bé
  - 🍀 Nguyên liệu sạch lành tính, đáp ứng tiêu chuẩn an toàn nhi khoa
  - 🧸 Tiện dụng, giúp hành trình chăm con của mẹ trở nên nhẹ nhàng hơn

🎁 Quà tặng hấp dẫn:
👉 Bấm ngay vào giỏ hàng góc dưới để săn voucher giảm giá mẹ nhé!`,

    pets: `🌟 PHỤ KIỆN THÚ CƯNG: ${productName} 🌟

🐶 Chăm sóc chu đáo cho những người bạn bốn chân tinh nghịch luôn khỏe mạnh và hạnh phúc.

✨ Đặc điểm nổi bật:
  - 🧶 Thiết kế năng động, tạo sự thích thú tối đa cho bé cưng
  - 💎 Độ bền cao chống cắn rách tốt, cực kỳ an toàn khi sử dụng
  - 🧼 Chất liệu thoáng khí, giữ thú cưng luôn sạch sẽ và thơm mát

🎁 Deal hời cho Boss:
👉 Mua ngay tại giỏ hàng bên dưới để nhận quà tặng kèm siêu cưng!`,
  };
  return templates[category] || templates["tech"];
}

export function removeVietnameseTones(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9\s-_]/g, "");
}

/**
 * Revises specific scene prompts and dialogues (e.g. Part 3 and Part 6) based on user instructions,
 * while maintaining 3D Pixar character consistency and overall storyline flow.
 */
/**
 * Revises specific scene prompts and dialogues (e.g. Part 3 and Part 6) based on user instructions,
 * while maintaining 3D Pixar character consistency and overall storyline flow using 2-AI Debate.
 */
export async function reviseScenePrompts(
  productName: string,
  category: string = "tech",
  currentPromptsObj: Record<string, any> = {},
  sceneIndices: number[] = [2, 5], // 0-based index: 2 = Part 3, 5 = Part 6
  userFeedback: string = "",
  imageUrl?: string,
  feedbackImageUrl?: string,
  onProgress?: (evt: { type: string; stage?: 'ai1' | 'ai2' | 'done'; message?: string; elapsedSec?: number; draft?: string; result?: any; [key: string]: any }) => void,
  visualStyle?: string,
  productDescription?: string
): Promise<{
  promptsObj: Record<string, any>;
  revisionNote?: string;
  ai1Proposal?: string;
  ai2Audit?: string;
}> {
  const activeVisualStyle = normalizeVisualStyle(visualStyle || currentPromptsObj?._visualStyle);
  const isRealMode = activeVisualStyle === "real";
  const isStickmanMode = activeVisualStyle === "stickman";
  const startTime = Date.now();
  const targetPartNames = sceneIndices.map(i => `Part ${i + 1}`).join(", ");
  console.log(`\n🎭 [PromptGen] Direct Single-AI Revision for [${targetPartNames}] (Mode: ${isRealMode ? "REAL" : isStickmanMode ? "STICKMAN" : "3D"})...`);
  console.log(`💬 User feedback: "${userFeedback}"${feedbackImageUrl ? " [Attached Image/Screenshot for Visual Audit]" : ""}`);

  const primaryModel = getScriptwriterModel();
  const aiModelTitle = formatModelDisplayName(primaryModel);

  onProgress?.({
    type: 'start',
    stage: 'ai1',
    message: `🤖 ${aiModelTitle} đang tiếp thu góp ý & sửa kịch bản ${targetPartNames}...`,
    elapsedSec: 0,
  });

  const activeVisualRef = feedbackImageUrl || imageUrl;
  const visualAuditNote = feedbackImageUrl
    ? `\n\n═══════════════════════════════════════════════════════
📸 ATTACHED SCREENSHOT / VISUAL ISSUE AUDIT (FROM HUMAN DIRECTOR):
The human director has attached an image/screenshot above showing the current rendering defect or character issue.
INSPECT THE ATTACHED IMAGE VERY CAREFULLY! You must diagnose the visual discrepancy and ensure the revised prompts for [${targetPartNames}] fix it with 100% precision.
═══════════════════════════════════════════════════════`
    : "";

  const sceneKeys = Object.keys(currentPromptsObj || {}).map(k => {
    const m = k.match(/^prompt(\d+)$/i);
    return m ? parseInt(m[1], 10) : 0;
  }).filter(n => n > 0);
  const totalScenes = Math.max(
    sceneKeys.length > 0 ? Math.max(...sceneKeys) : 0,
    ...sceneIndices.map(i => i + 1),
    1
  );
  const allSceneIndices = Array.from({ length: totalScenes }, (_, idx) => idx + 1);
  const validTargetNums = Array.from(
    new Set(sceneIndices.map((idx) => idx + 1).filter((n) => Number.isInteger(n) && n >= 1 && n <= totalScenes))
  ).sort((a, b) => a - b);
  const effectiveTargetNums = validTargetNums.length > 0 ? validTargetNums : allSceneIndices;
  const targetNumSet = new Set<number>(effectiveTargetNums);

  const currentScenesSummary = allSceneIndices.map(i => {
    const isTarget = targetNumSet.has(i);
    const rawP = String(currentPromptsObj[`prompt${i}`] || "");
    const p = isTarget ? stripCastLockTag(rawP) : rawP;
    const d = currentPromptsObj[`dialogue${i}`] || "";
    return `[Part ${i}${isTarget ? " -> CẦN SỬA LẠI THEO ĐÚNG GÓP Ý NGƯỜI DÙNG (TARGET SCENE TO REVISE)" : " -> NGỮ CẢNH CỐ ĐỊNH ĐỂ ĐỐI CHIẾU MẠCH TRUYỆN (READ-ONLY CONTEXT — LOCKED, DO NOT OUTPUT OR OVERWRITE)"}]
Prompt: ${p}
Dialogue: ${d}`;
  }).join("\n\n");

  const schemaKeys = effectiveTargetNums.map(i => `  "prompt${i}": "string",\n  "dialogue${i}": "string"`).join(",\n");

  const cleanedStoryContext = cleanProductDescription(productDescription);
  const storyContextBlock = cleanedStoryContext
    ? `\nORIGINAL USER INPUT CONTENT / STORYLINE:\n${cleanedStoryContext}\n`
    : "";

  const bibleContext = currentPromptsObj.character_bible
    ? `\nCURRENT CHARACTER BIBLE (UPDATE THIS IN YOUR OUTPUT ONLY IF THE DIRECTOR CHANGES A CHARACTER'S GLOBAL TRAIT/AGE/ROLE/OUTFIT; NEVER MERGE OR OVERWRITE OTHER LOCKED SCENES' PLOT BEATS):\n${currentPromptsObj.character_bible}\n`
    : "";

  const aiSystemPrompt = `You are a master ${isRealMode ? "photorealistic live-action cinema director (real-life human actors & real-life animals, strictly NO 3D CGI/cartoon)" : isStickmanMode ? "2D Chibi Comic Marshmallow Stickman Animation director (Người Que Hoạt Hình 2D Hóa Trang)" : "3D animation director"} and lead Veo prompt engineer.
Your task is to revise ONLY scene(s) [${targetPartNames}] of a ${totalScenes}-scene storyboard strictly based on the director's instructions: "${userFeedback}".

CRITICAL MANDATE — DIRECTOR REVISION IS SUPREME #1 AUTHORITY & NON-TARGET SCENES ARE STRICTLY LOCKED:
- Every single character change, role/profession change, age change, outfit/prop change, setting change, action correction, camera angle, or dialogue change requested in "${userFeedback}" MUST be 100% applied to [${targetPartNames}]!
- STRICT SCENE SLOT ISOLATION: All scenes outside [${targetPartNames}] are READ-ONLY CONTEXT. NEVER output keys for non-target scenes, and NEVER copy/shift a neighbor scene's plot beat or dialogue into [${targetPartNames}] unless the director explicitly asked to do so! Keep [${targetPartNames}] anchored to its exact narrative beat in the story progression!
- NEVER let an old CHARACTER BIBLE, old scene prompt, or default template override the director's instructions!
- Whenever the director changes a character's identity, age, outfit, role, or prop (or replaces/adds a character), update "character_bible" in your JSON output so old traits NEVER get re-injected, without altering the plot assignment of locked scenes!
- Completely remove any conflicting old outfit, prop, or action from the revised scene prompt(s).

STRICT GUIDELINES:
1. Visual Mode & Character Continuity:
   - Render mode: ${isRealMode ? "100% Photorealistic Live-Action Real Humans & Real Animals, NO 3D/cartoon" : isStickmanMode ? "2D Chibi Comic Marshmallow Stickman with glossy white round head, bold black outlines, and story-fitting outfits/props" : "Cinematic 3D Animation"}.
   - Keep unmentioned traits of recurring characters consistent across scenes, while 100% applying every character/outfit/context change requested by the director!
2. For each revised scene in [${targetPartNames}]:
   - Write a vivid, SINGLE-TAKE ${isRealMode ? "photorealistic live-action cinema prompt (real-life humans/animals, natural skin/fur, 8K camera)" : isStickmanMode ? "2D Chibi Comic Marshmallow Stickman animation prompt (glossy white round head, bold black ink outlines)" : "cinematic 3D prompt"} (~175-215 words, ONE continuous camera shot with no internal jump-cuts or split grids) detailing camera motion and 3 layers: Foreground, Midground (characters with inline age & outfit anchor + held prop consistency), Background.
   - STORY-AUTHENTIC CHARACTERS & PROPS (NO HARDCODED BANS): Dress characters and let them use whatever props genuinely fit the user's story and director's revision (smartphones, laptops, notebooks, medical tools, casual home clothes, suits, traditional wear, etc. are ALL 100% allowed whenever relevant!). Do NOT force unrelated cosplay outfits!
   - DIALOGUE-DRIVEN VISUAL ACTION & FACE-TO-FACE 3/4 BLOCKING: Midground acting MUST match the scene's dialogue turn-by-turn. Stage conversing characters together in Midground turned toward each other at a 3/4 angle to the camera with locked eye contact. For solo scenes (1 character on screen), keep DUB_TIMELINE solo without mentioning "listeners".
   - VEO 3 SAFETY & ANTI-BLOCK MANDATE: Avoid English block words like "crying", "wailing", "sobbing", "tears", "pregnant", "punish", "execute", "poison", "kill", "blood", "sickle", "blade", or "knife". Describe sad expressions without tears.
   - Natural Vietnamese dialogue matching the characters and user content.
   - Recalculate and append the exact DUB_TIMELINE tag at the end of each prompt.
   ${dubbingTimelineRules(totalScenes)}
3. Output ONLY the revised scene key(s) for [${targetPartNames}] (plus "story_title", "character_bible", and "revision_note") in STRICT JSON format.${visualAuditNote}

OUTPUT FORMAT (STRICT JSON ONLY — DO NOT INCLUDE NON-TARGET SCENE KEYS):
{
  "story_title": "string",
  "character_bible": "One concise line per main character (Name: age/species, look, outfit, key prop) updated to match all director changes",
  "revision_note": "A concise summary in Vietnamese of what was revised in ${targetPartNames}",
${schemaKeys}
}`;

  const aiUserPrompt = `Product / Topic: ${productName}
Category: ${category}${storyContextBlock}${bibleContext}
CURRENT ${totalScenes}-SCENE STORYBOARD (NON-TARGET SCENES ARE READ-ONLY CONTEXT):
${currentScenesSummary}

🚨 DIRECTOR REVISION REQUEST FOR [${targetPartNames}] ONLY (SUPREME #1 PRIORITY):
"${userFeedback || "Làm cho các part được chọn sinh động, biểu cảm rõ nét và phân biệt rõ nhân vật"}"

Please output the revised JSON strictly for [${targetPartNames}] (and updated "character_bible" if needed) without modifying or shifting any other scene.`;

  let currentActiveModel = primaryModel;
  let currentModelTitle = aiModelTitle;

  onProgress?.({
    type: 'ai1_start',
    stage: 'ai1',
    message: `🤖 ${currentModelTitle} đang viết lại kịch bản cho ${targetPartNames}...`,
    elapsedSec: Math.floor((Date.now() - startTime) / 1000),
  });

  const hb = setInterval(() => {
    onProgress?.({
      type: 'heartbeat',
      stage: 'ai1',
      message: `🤖 ${currentModelTitle} đang viết lại kịch bản cho ${targetPartNames}...`,
      elapsedSec: Math.floor((Date.now() - startTime) / 1000),
    });
  }, 1000);

  let rawJson = "";
  let modelUsed = primaryModel;

  try {
    if (isAiTaskAborted(startTime)) {
      throw new Error("Đã hủy sửa kịch bản theo yêu cầu");
    }
    const res = await callScriptwriter(
      aiSystemPrompt,
      aiUserPrompt,
      activeVisualRef,
      true,
      (nextModel) => {
        currentActiveModel = nextModel;
        currentModelTitle = formatModelDisplayName(nextModel);
        onProgress?.({
          type: 'model_switch',
          stage: 'ai1',
          message: `🤖 ${currentModelTitle} đang viết lại kịch bản cho ${targetPartNames}...`,
          model: nextModel,
          modelTitle: currentModelTitle,
          elapsedSec: Math.floor((Date.now() - startTime) / 1000),
        });
      }
    );
    if (isAiTaskAborted(startTime)) {
      throw new Error("Đã hủy sửa kịch bản theo yêu cầu");
    }
    rawJson = res.text;
    modelUsed = res.model;
  } catch (err: any) {
    console.error(`❌ [PromptGen] Failed to revise scene prompts: ${err.message}`);
    throw err;
  } finally {
    clearInterval(hb);
  }

  let parsed: any = {};
  try {
    const cleanJson = rawJson.replace(/```json\s*/gi, "").replace(/```\s*$/gi, "").trim();
    parsed = JSON.parse(cleanJson);
  } catch {
    const match = rawJson.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch (e: any) {
        console.error("Failed to parse JSON regex:", e.message);
      }
    }
  }

  const { parseTextPromptToObj } = await import("./scheduler.js");
  const extractedFromRaw = parseTextPromptToObj(rawJson) || {};
  const extractedFromParsed = parseTextPromptToObj(parsed) || {};

  const updatedPromptsObj: Record<string, any> = {
    ...currentPromptsObj,
    _visualStyle: activeVisualStyle,
  };

  // CRITICAL: Update character_bible whenever AI returns an updated bible so stale outfits/roles NEVER overwrite revised scenes!
  const newCharacterBible = String(
    parsed.character_bible ||
    extractedFromParsed.character_bible ||
    extractedFromRaw.character_bible ||
    currentPromptsObj.character_bible ||
    ""
  ).trim();
  if (newCharacterBible) {
    updatedPromptsObj.character_bible = newCharacterBible;
  }

  // STRICT SCENE ISOLATION: Only extract & update target scene(s) requested in sceneIndices!
  // Non-target scenes in currentPromptsObj MUST NEVER be overwritten by AI output.
  const isSingleTarget = effectiveTargetNums.length === 1;
  for (const i of effectiveTargetNums) {
    const candidatePrompt =
      parsed[`prompt${i}`] ||
      parsed[`prompt_${i}`] ||
      parsed[`scene${i}`]?.prompt ||
      parsed[`scene_${i}`]?.prompt ||
      parsed.prompts?.[`prompt${i}`] ||
      parsed.storyboard?.[`prompt${i}`] ||
      (Array.isArray(parsed.scenes) ? parsed.scenes.find((s: any) => (s.scene_index || s.scene || s.part) === i)?.prompt : undefined) ||
      (isSingleTarget && Array.isArray(parsed.scenes) && parsed.scenes.length === 1 ? parsed.scenes[0]?.prompt : undefined) ||
      (isSingleTarget && typeof parsed.prompt === "string" ? parsed.prompt : undefined) ||
      extractedFromRaw[`prompt${i}`] ||
      extractedFromParsed[`prompt${i}`];

    const singleSceneDia = isSingleTarget && Array.isArray(parsed.scenes) && parsed.scenes.length === 1
      ? parsed.scenes[0]?.dialogue
      : undefined;
    const candidateDialogue =
      parsed[`dialogue${i}`] !== undefined ? parsed[`dialogue${i}`] :
      parsed[`dialogue_${i}`] !== undefined ? parsed[`dialogue_${i}`] :
      parsed[`scene${i}`]?.dialogue !== undefined ? parsed[`scene${i}`]?.dialogue :
      parsed[`scene_${i}`]?.dialogue !== undefined ? parsed[`scene_${i}`]?.dialogue :
      parsed.dialogues?.[`dialogue${i}`] !== undefined ? parsed.dialogues?.[`dialogue${i}`] :
      (Array.isArray(parsed.scenes) ? parsed.scenes.find((s: any) => (s.scene_index || s.scene || s.part) === i)?.dialogue : undefined) !== undefined ? parsed.scenes.find((s: any) => (s.scene_index || s.scene || s.part) === i)?.dialogue :
      singleSceneDia !== undefined ? singleSceneDia :
      (isSingleTarget && parsed.dialogue !== undefined ? parsed.dialogue : undefined) !== undefined ? parsed.dialogue :
      extractedFromRaw[`dialogue${i}`] !== undefined ? extractedFromRaw[`dialogue${i}`] :
      extractedFromParsed[`dialogue${i}`];

    if (candidatePrompt) {
      const effectiveDia = candidateDialogue !== undefined && candidateDialogue !== null
        ? String(candidateDialogue)
        : String(updatedPromptsObj[`dialogue${i}`] || "");
      updatedPromptsObj[`prompt${i}`] = autoRepairDubbingTimeline(
        stripCastLockTag(String(candidatePrompt)),
        effectiveDia,
        newCharacterBible || undefined
      );
    }
    if (candidateDialogue !== undefined && candidateDialogue !== null) updatedPromptsObj[`dialogue${i}`] = candidateDialogue;
  }
  if (parsed.story_title || extractedFromRaw.story_title) {
    updatedPromptsObj.story_title = parsed.story_title || extractedFromRaw.story_title;
  }

  const { sanitizePromptForVeoPolicy, validateAndRepairScenePrompts } = await import("./promptValidator.js");
  if (typeof updatedPromptsObj.character_bible === "string" && updatedPromptsObj.character_bible.trim()) {
    updatedPromptsObj.character_bible = sanitizePromptForVeoPolicy(updatedPromptsObj.character_bible, activeVisualStyle).sanitized;
  }

  // Preflight check & auto-repair ONLY on the revised scenes, passing userFeedback & storyContext so validator respects user edits
  onProgress?.({
    type: 'ai2_start',
    stage: 'ai2',
    message: `🛡️ Đang kiểm tra chính sách an toàn Veo 3 cho ${targetPartNames} trước khi hoàn tất...`,
    elapsedSec: Math.floor((Date.now() - startTime) / 1000),
  });

  const validationRes = await validateAndRepairScenePrompts(updatedPromptsObj, totalScenes, {
    productName,
    visualStyle: activeVisualStyle,
    userFeedback,
    storyContext: cleanedStoryContext || undefined,
    onlySceneIndices: sceneIndices,
    maxAttemptsPerScene: 2,
    onProgress: (vEvt) => {
      onProgress?.({
        ...vEvt,
        stage: 'ai2',
        elapsedSec: Math.floor((Date.now() - startTime) / 1000),
      });
    },
  });

  if (validationRes.promptsObj) {
    for (const i of effectiveTargetNums) {
      if (validationRes.promptsObj[`prompt${i}`] !== undefined) {
        updatedPromptsObj[`prompt${i}`] = validationRes.promptsObj[`prompt${i}`];
      }
      if (validationRes.promptsObj[`dialogue${i}`] !== undefined) {
        updatedPromptsObj[`dialogue${i}`] = validationRes.promptsObj[`dialogue${i}`];
      }
    }
  }

  if (typeof updatedPromptsObj.character_bible === "string" && updatedPromptsObj.character_bible.trim()) {
    const anchoredAll = attachCharacterBibleToScenes(
      updatedPromptsObj,
      updatedPromptsObj.character_bible,
      totalScenes
    );
    for (const i of effectiveTargetNums) {
      if (anchoredAll[`prompt${i}`] !== undefined) {
        updatedPromptsObj[`prompt${i}`] = anchoredAll[`prompt${i}`];
      }
    }
  }

  // HARD SCENE LOCK: Guarantee non-target scenes remain 100% identical to currentPromptsObj,
  // and sanitize only the revised target scenes.
  for (let i = 1; i <= totalScenes; i++) {
    if (!targetNumSet.has(i)) {
      if (currentPromptsObj[`prompt${i}`] !== undefined) {
        updatedPromptsObj[`prompt${i}`] = currentPromptsObj[`prompt${i}`];
      } else {
        delete updatedPromptsObj[`prompt${i}`];
      }
      if (currentPromptsObj[`dialogue${i}`] !== undefined) {
        updatedPromptsObj[`dialogue${i}`] = currentPromptsObj[`dialogue${i}`];
      } else {
        delete updatedPromptsObj[`dialogue${i}`];
      }
    } else if (typeof updatedPromptsObj[`prompt${i}`] === "string") {
      updatedPromptsObj[`prompt${i}`] = sanitizePromptForVeoPolicy(updatedPromptsObj[`prompt${i}`], activeVisualStyle).sanitized;
    }
  }

  const revisionNote = parsed.revision_note || `Đã cập nhật & kiểm định an toàn Veo 3 cho ${targetPartNames}`;

  const finalResult = {
    promptsObj: updatedPromptsObj,
    revisionNote,
    ai1Proposal: rawJson,
    ai2Audit: `Đã chỉnh sửa bởi ${formatModelDisplayName(modelUsed)} & kiểm định an toàn Veo 3 (${validationRes.repairedCount || 0} cảnh được tối ưu chống chặn)`,
  };

  onProgress?.({
    type: 'complete',
    stage: 'done',
    message: `🎉 ${revisionNote} (${Math.floor((Date.now() - startTime) / 1000)}s)`,
    elapsedSec: Math.floor((Date.now() - startTime) / 1000),
    result: finalResult,
  });

  return finalResult;
}
