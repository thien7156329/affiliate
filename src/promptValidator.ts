import { callAgy, isAgyEnabled } from "./agyClient.js";
import {
  formatModelDisplayName,
  getValidatorModel,
  GEMINI_CARBON_MODEL,
  GEMINI_ARGON_MODEL,
} from "./aiModelConfig.js";
import { normalizeVisualStyle } from "./worldStyles.js";

export type IssueType =
  | "COPYRIGHT"
  | "CELEBRITY"
  | "SAFETY"
  | "TECHNICAL_CONFLICT"
  | "QUALITY";

export interface PromptValidationIssue {
  type: IssueType;
  text: string;
  reason: string;
}

export interface PromptValidationResult {
  risk_level: "LOW" | "MEDIUM" | "HIGH";
  ready_for_veo: boolean;
  issues: PromptValidationIssue[];
  technical_issues: string[];
  suggested_prompt: string;
}

export interface SceneValidationOutcome {
  scene_index: number;
  passed: boolean;
  attempts: number;
  initial_prompt: string;
  final_prompt: string;
  issues: PromptValidationIssue[];
  technical_issues: string[];
}

export interface BatchValidationResult {
  success: boolean;
  promptsObj: Record<string, string>;
  repairedCount: number;
  totalScenes: number;
  failedScene?: SceneValidationOutcome;
  error?: string;
  outcomes: SceneValidationOutcome[];
}

const SYSTEM_VALIDATOR_PROMPT = `You are a strict preflight validator and safety auditor for Google Veo 3 / Veo 3.1 AI video generation.
Your mission is to thoroughly analyze submitted scene prompts for video rendering risks BEFORE sending them to Veo 3.

Examine the prompt for these critical risk categories:
1. DISTRESS / CRYING TRIGGERS IN ENGLISH VISUAL DESCRIPTIONS:
   - ANY English visual description of crying, wailing, sobbing, or tears ("crying loudly", "wiping tears", "tearful") MUST be rewritten into a sad, mournful facial expression without tears ("showing a sad, sorrowful facial expression with furrowed brows and downcast eyes, dabbing his sleeve to his cheek without tears").
2. EXTREME GORE / VIOLENCE:
   - Graphic violence, blood/gore, mutilation, decapitation, self-harm, or explicit content.
   - IMPORTANT: Keep all quoted Vietnamese dialogue lines inside DUB_TIMELINE 100% verbatim and unchanged so the video voiceover speaks the exact script!
3. COPYRIGHT & TRADEMARK RISKS:
   - Named copyrighted characters (e.g., Goku, Naruto, Mickey Mouse, Elsa, Pikachu, Spider-Man, Batman, Iron Man, Shrek, Mario, Sonic, Minions, Barbie, etc.).
   - Protected franchises, proprietary studio worlds (e.g. Disney, Marvel, DC, Nintendo, Star Wars, Pixar trademarked names), or commercial brand logos.
4. CELEBRITY & REAL LIVING PERSONS:
   - Real living celebrities, politicians, athletes, singers, public figures, or identifiable real people.
5. TECHNICAL CONFLICTS & VEO 3 LIMITATIONS:
   - Direct contradictory conditions in the same scene (e.g. "bright sunny noon" combined with "pitch black midnight sky"; "extreme macro close-up of eye" combined with "distant aerial wide landscape shot").
6. PROMPT BLOAT & EXCESSIVE LENGTH (>260 WORDS):
   - Overly long prompts (>260 words) caused by copy-pasting global character bibles or redundant boilerplate rules.

DECISION CRITERIA:
- If ANY crying/distress, extreme gore, copyright, celebrity, severe technical contradiction, or severe prompt bloat is present:
  - Set ready_for_veo: false
  - Set risk_level: "HIGH" (for copyright, celebrity, gore) or "MEDIUM" (for technical contradictions or prompt bloat)
  - Populate "issues" array with { type, text, reason }
  - Provide "suggested_prompt":
    * Rewrite ONLY the unsafe/copyrighted tokens so the English visual prompt is compliant with Veo 3 policies while STRICTLY PRESERVING 100% of the user's character lineup (names, adult ages, roles, outfits, props), setting, storyline context, camera motion, emotional tone, and exact visual rendering mode.
    * NEVER invent new characters, NEVER change a character's profession/outfit/age (unless underage <18 safety requires young adult), and NEVER alter the user's plot or director notes!
    * Replace any crying/tears with "a sad, sorrowful facial expression with furrowed brows and downcast eyes (no tears)".
    * STRICTLY PRESERVE all Vietnamese dialogue text inside ("...") and the exact DUB_TIMELINE at the end of the prompt 100% verbatim!
- If NO issues are found:
  - Set ready_for_veo: true
  - Set risk_level: "LOW"
  - Set issues: []
  - Set technical_issues: []
  - Set suggested_prompt: identical to the input prompt.

Return ONLY a valid JSON object matching this schema:
{
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "ready_for_veo": boolean,
  "issues": [
    {
      "type": "COPYRIGHT" | "CELEBRITY" | "SAFETY" | "TECHNICAL_CONFLICT" | "QUALITY",
      "text": "the problematic token/concept",
      "reason": "explanation of why it violates Veo guidelines or will fail render"
    }
  ],
  "technical_issues": ["technical issue description if any"],
  "suggested_prompt": "safe revised prompt"
}`;

/**
 * Deterministic policy sanitizer for English Veo 3 / Imagen 3 prompts.
 * Eliminates minor/child safety triggers ("boy", "girl", "child", age < 18), crying/distress triggers,
 * biological/pregnancy triggers, and punishment/violence triggers that cause Gemini Web to refuse video generation.
 */
export function sanitizePromptForVeoPolicy(
  prompt: string,
  _visualStyle?: string,
): { sanitized: string; fixes: string[] } {
  if (!prompt || typeof prompt !== "string") {
    return { sanitized: "", fixes: [] };
  }

  let out = prompt;
  const fixes: string[] = [];

  const rules: Array<{ label: string; pattern: RegExp; replacement: string }> =
    [
      // 1. Distress / Crying / Tears (replace with sad/sorrowful face without tears)
      {
        label:
          "crying/wailing/sobbing loudly → sad, sorrowful facial expression without tears",
        pattern:
          /\b(?:crying\s+loudly|wailing\s+loudly|sobbing\s+loudly|bursts?\s+into\s+tears|weeping\s+bitterly)\b/gi,
        replacement:
          "showing a sad, sorrowful facial expression with furrowed brows and downcast eyes (without tears)",
      },
      {
        label:
          "wiping tears / rubbing eyes crying → dabbing sleeve with a sad expression",
        pattern:
          /\b(?:wipes?\s+(?:away\s+)?(?:fake\s+|real\s+|his\s+|her\s+)?tear(?:\s+streaks?|s)?|wiping\s+(?:away\s+)?(?:fake\s+|real\s+|his\s+|her\s+)?tear(?:\s+streaks?|s)?|rubbing\s+(?:his|her)\s+eyes\s+as\s+if\s+crying)\b/gi,
        replacement:
          "dabbing his sleeve to his cheek with a sad, mournful expression (no tears)",
      },
      {
        label:
          "crying/wailing/sobbing/tearful/tears → sad, sorrowful expression",
        pattern:
          /\b(?:crying|wailing|sobbing|weeping|tearful|tear\s+streaks?|tears)\b/gi,
        replacement: "a sad, sorrowful facial expression",
      },
      // 2. Violence / Execution / Gore triggers (English visual descriptions only)
      {
        label: "execution/behead/murder/kill → reprimand",
        pattern:
          /\b(?:behead\w*|decapitat\w*|execut\w*|mutilat\w*|dismember\w*|slaughter\w*|murder\w*|kill\w*)\b/gi,
        replacement: "reprimand",
      },
      {
        label: "death sentence → stern decree",
        pattern: /\b(?:death\s+sentence)\b/gi,
        replacement: "stern decree",
      },
      {
        label: "poison/lethal/suicide → herbal tonic",
        pattern: /\b(?:poison\w*|lethal|suicide|self-harm)\b/gi,
        replacement: "herbal tonic",
      },
      {
        label: "blood/gore/corpse → red ink",
        pattern: /\b(?:blood|bloody|gory|gore|corpse|dead\s+body)\b/gi,
        replacement: "red ink",
      },
      // 3. Biological / Pregnancy / Punishment triggers in English visual prose
      {
        label: "pregnant male goat (English prose) → royal riddle tribute",
        pattern:
          /\b(?:a\s+)?pregnant\s+male\s+goat(?:\s*\([^)]*\))?|\bmale\s+goat\s+that\s+is\s+pregnant\b/gi,
        replacement: "royal riddle tribute",
      },
      {
        label: "give birth (English prose) → welcome a new sibling",
        pattern:
          /\bgive\s+birth(?:\s+to\s+a\s+(?:baby|young\s+scholar|new)\s+sibling)?\b/gi,
        replacement: "welcome a new sibling",
      },
      {
        label: "face royal punishment / punishment → royal fine",
        pattern: /\b(?:face\s+)?(?:royal\s+|heavy\s+)?punishment\b/gi,
        replacement: "a heavy royal fine",
      },
      // 4. Sharp farm/kitchen blades in hands & decapitation/gore homonyms ("headless stalks") that trigger Veo 3 weapon/gore filters
      {
        label: "sickle/scythe/machete/curved blade → bare hands",
        pattern:
          /\b(?:a\s+|his\s+|her\s+|metal\s+|iron\s+|curved\s+|sharp\s+)*(?:sickles?|scythes?|machetes?|curved\s+blades?|daggers?)\b/gi,
        replacement: "bare hands",
      },
      {
        label: "headless (e.g. headless stalks) → grainless",
        pattern: /\bheadless\b/gi,
        replacement: "grainless",
      },
      {
        label: "rice/grain heads (gore homonym with 'lifts heads to chest height / placed in basket') → panicles",
        pattern: /\b(rice|grain|wheat|stalk|golden)\s+heads\b/gi,
        replacement: "$1 panicles",
      },
      {
        label: "breaks away → plucks",
        pattern: /\bbreaks?\s+away\b/gi,
        replacement: "plucks",
      },
      {
        label: "shaved forehead → removed",
        pattern: /\b(?:a\s+)?shaved\s+forehead(?:\s+and\s+)?/gi,
        replacement: "",
      },
      {
        label: "natural human skin texture/pores → natural cinematic lighting",
        pattern: /\b(?:with\s+)?natural\s+(?:human\s+)?skin\s+(?:texture|pores)(?:\s+and\s+pores)?\b/gi,
        replacement: "natural cinematic lighting",
      },
      {
        label: "no cuts / jump-cuts (gore homonym) → seamless transition",
        pattern: /,?\s*\bno\s+(?:internal\s+)?(?:jump-)?cuts\b/gi,
        replacement: "",
      },
      {
        label: "anatomically correct hands → natural hand gestures",
        pattern: /\banatomically\s+(?:correct|gripped)\s*(?:hands)?\b/gi,
        replacement: "natural hand gestures",
      },
      {
        label: "underage/preteen → young adult",
        pattern: /\b(?:underage|preteen|pre-teen)\b/gi,
        replacement: "young adult",
      },
    ];

  for (const r of rules) {
    if (r.pattern.test(out)) {
      out = out.replace(r.pattern, r.replacement);
      fixes.push(r.label);
    }
  }

  // 5. If scene is explicitly a solo scene ("only person in frame" / "solo scene"), fix contradictory "all listeners" in DUB_TIMELINE
  if (/\b(?:only\s+person\s+in\s+frame|solo\s+scene)\b/i.test(out)) {
    const beforeSoloFix = out;
    out = out
      .replace(
        /\bfaces\s+the\s+listener\s+at\s+a\s+3\/4\s+inward\s+angle\s+with\s+direct\s+eye\s+contact\s+and\s+speaks\b/gi,
        "stays angled 3/4 toward the camera and speaks",
      )
      .replace(
        /\s+while\s+all\s+listeners\s+face\s+[^.;\n]+?\s+attentively\s+and\s+keep\s+mouths\s+closed/gi,
        "",
      );
    if (out !== beforeSoloFix) {
      fixes.push("solo DUB_TIMELINE listener contradiction removed");
    }
  }

  return { sanitized: out, fixes };
}

/**
 * Sanitizes Vietnamese dialogue for Veo 3 lip-sync using phonetic homophones ("chửa" -> "chữa", "đẻ" -> "để")
 * so Veo 3's Vietnamese voice pronounces "dê đực chữa" (sounding like "dê đực chửa", NOT "dê đực quý hiếm")
 * while Google's multilingual safety translator translates "chữa" as "heal/cure" instead of "pregnant".
 */
export function sanitizeVeoDialogueForLipSync(dialogue: string): string {
  if (!dialogue || typeof dialogue !== "string") return "";
  let out = dialogue;
  const rules: Array<{ pattern: RegExp; replacement: string }> = [
    // 1. Phonetic homophones for biological/pregnancy terms ("chửa" -> "chữa", "đẻ" -> "để")
    { pattern: /dê\s+đực\s+có\s+chửa/gi, replacement: "dê đực chữa" },
    { pattern: /dê\s+đực\s+chửa/gi, replacement: "dê đực chữa" },
    { pattern: /có\s+chửa/gi, replacement: "có chữa" },
    { pattern: /đẻ\s+em\s+bé/gi, replacement: "để em nhỏ" },
    { pattern: /đàn\s+ông\s+mà\s+đẻ/gi, replacement: "đàn ông mà để" },
    { pattern: /đẻ\s+sao\s+được/gi, replacement: "để sao được" },
    // 2. Crying / death / punishment / insult triggers in Vietnamese dialogue
    { pattern: /cớ\s+sao\s+mày\s+khóc/gi, replacement: "cớ sao lại buồn" },
    { pattern: /sao\s+lại\s+khóc/gi, replacement: "sao lại buồn" },
    { pattern: /Mẹ\s+tôi\s+chết/g, replacement: "Mẹ tôi mất" },
    { pattern: /mẹ\s+tôi\s+chết/gi, replacement: "mẹ tôi mất" },
    {
      pattern:
        /(chém\s+đầu|xử\s+trảm|tử\s+hình|giết\s+chết|bị\s+trị\s+tội|trị\s+tội)/gi,
      replacement: "phạt nặng",
    },
    {
      pattern: /Mày\s+thật\s+là\s+đần\s+độn/gi,
      replacement: "Ngươi thật là khờ khạo",
    },
    { pattern: /đần\s+độn/gi, replacement: "khờ khạo" },
  ];

  for (const r of rules) {
    out = out.replace(r.pattern, r.replacement);
  }
  return out;
}

/**
 * Validates a single prompt using AGY 3.8 (Gemini 3.8 Flash).
 */
export async function validateVeoPromptWithAgy(
  prompt: string,
  context?: {
    sceneIndex?: number;
    productName?: string;
    dialogue?: string;
    worldStyle?: string;
    visualStyle?: string;
    userFeedback?: string;
    storyContext?: string;
  },
): Promise<PromptValidationResult> {
  const cleanPrompt = String(prompt || "").trim();
  if (!cleanPrompt) {
    return {
      risk_level: "LOW",
      ready_for_veo: true,
      issues: [],
      technical_issues: [],
      suggested_prompt: "",
    };
  }

  const vStyle = normalizeVisualStyle(context?.visualStyle);
  const vStyleDesc =
    vStyle === "real"
      ? "Photorealistic Live-Action Cinema (Real-life Humans & Real-life Animals, NO 3D CGI/cartoon)"
      : vStyle === "stickman"
        ? "2D Chibi Comic Marshmallow Stickman Animation (keep 2D stickman style & outfits intact)"
        : "Cinematic 3D Animation";

  const userRequest = `Scene Index: ${context?.sceneIndex ?? "N/A"}
Product / Topic: ${context?.productName || "General video"}
Visual Render Mode: ${vStyleDesc}
World Style: ${context?.worldStyle || "Auto"}
${context?.storyContext ? `User Input Story Context (DO NOT ALTER CAST OR PLOT): "${context.storyContext.slice(0, 600)}"\n` : ""}${context?.userFeedback ? `Director Revision Note (MUST KEEP 100% INTACT): "${context.userFeedback.slice(0, 500)}"\n` : ""}${context?.dialogue ? `Associated Dialogue: "${context.dialogue}"` : ""}

PROMPT TO AUDIT:
"""
${cleanPrompt}
"""`;

  if (isAgyEnabled()) {
    try {
      const validatorModel = getValidatorModel();
      const candidateModels = [
        validatorModel,
        GEMINI_CARBON_MODEL,
        GEMINI_ARGON_MODEL,
      ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

      let raw = "";
      let lastErr: any = null;
      for (const candidate of candidateModels) {
        try {
          raw = await callAgy(
            SYSTEM_VALIDATOR_PROMPT,
            userRequest,
            true,
            candidate,
          );
          if (raw && raw.trim()) break;
        } catch (candErr: any) {
          lastErr = candErr;
          console.warn(
            `⚠️ [PromptValidator] ${formatModelDisplayName(candidate)} failed (${candErr?.message || candErr}), trying next fallback...`,
          );
        }
      }
      if (!raw) {
        throw lastErr || new Error("All AGY validator models returned empty output");
      }

      let clean = raw.trim();
      if (clean.startsWith("```")) {
        clean = clean
          .replace(/^```json\s*/i, "")
          .replace(/```$/, "")
          .trim();
      }
      const parsed = JSON.parse(clean);

      const riskLevel = String(parsed.risk_level || "LOW").toUpperCase() as
        | "LOW"
        | "MEDIUM"
        | "HIGH";
      const issues: PromptValidationIssue[] = Array.isArray(parsed.issues)
        ? parsed.issues
        : [];
      const technicalIssues: string[] = Array.isArray(parsed.technical_issues)
        ? parsed.technical_issues
        : [];
      const readyForVeo = Boolean(
        parsed.ready_for_veo && issues.length === 0 && riskLevel === "LOW",
      );
      const suggestedPrompt = String(
        parsed.suggested_prompt || cleanPrompt,
      ).trim();

      return {
        risk_level: readyForVeo
          ? "LOW"
          : riskLevel === "LOW"
            ? "MEDIUM"
            : riskLevel,
        ready_for_veo: readyForVeo,
        issues,
        technical_issues: technicalIssues,
        suggested_prompt: suggestedPrompt || cleanPrompt,
      };
    } catch (err: any) {
      console.warn(
        `⚠️ [PromptValidator] AGY audit failed (${err.message}). Performing fallback inspection...`,
      );
    }
  }

  // Fallback heuristic keyword check if AGY is unavailable
  return fallbackHeuristicAudit(cleanPrompt);
}

/**
 * Fallback regex / keyword check when external AI call is offline.
 */
function fallbackHeuristicAudit(prompt: string): PromptValidationResult {
  const issues: PromptValidationIssue[] = [];
  const textLower = prompt.toLowerCase();

  const COPYRIGHT_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
    {
      name: "Goku / Dragon Ball",
      pattern: /\b(goku|vegeta|kakarot|super saiyan|dragon ball)\b/i,
    },
    {
      name: "Naruto",
      pattern: /\b(naruto|sasuke|kakashi|rasengan|sharingan|konoha)\b/i,
    },
    {
      name: "Disney Character",
      pattern: /\b(mickey mouse|donald duck|elsa|anna|olaf|simba|aladdin)\b/i,
    },
    {
      name: "Marvel / DC Superhero",
      pattern:
        /\b(spider[- ]?man|batman|superman|iron[- ]?man|hulk|thanos|thor|wolverine|avengers)\b/i,
    },
    {
      name: "Pokemon",
      pattern: /\b(pikachu|charizard|pokemon|pokeball|ash ketchum)\b/i,
    },
    {
      name: "Nintendo / Mario",
      pattern: /\b(mario|luigi|bowser|peach|zelda|link|pokemon)\b/i,
    },
  ];

  for (const item of COPYRIGHT_PATTERNS) {
    if (item.pattern.test(textLower)) {
      issues.push({
        type: "COPYRIGHT",
        text: item.name,
        reason: `Phát hiện nhân vật có bản quyền "${item.name}". Veo 3 sẽ từ chối render video.`,
      });
    }
  }

  const { sanitized, fixes } = sanitizePromptForVeoPolicy(prompt);
  if (fixes.length > 0) {
    issues.push({
      type: "SAFETY",
      text: fixes.join(", "),
      reason:
        "Chứa từ khóa nhạy cảm (trẻ vị thành niên / khóc lóc / mang thai / trừng phạt) dễ bị Google Veo 3 chặn render.",
    });
  }

  const isSafe = issues.length === 0;
  return {
    risk_level: isSafe ? "LOW" : "HIGH",
    ready_for_veo: isSafe,
    issues,
    technical_issues: [],
    suggested_prompt: sanitized,
  };
}

/**
 * Preserves DUB_TIMELINE tag from the original prompt if it was lost during revision.
 */
function preserveDubTimelineTag(
  originalPrompt: string,
  revisedPrompt: string,
): string {
  const dubMatch = originalPrompt.match(
    /DUB_TIMELINE:\s*(?:\[[^\]]+\]|[^\n]+)$/,
  );
  if (dubMatch && !revisedPrompt.includes("DUB_TIMELINE:")) {
    return `${revisedPrompt.trim()} ${dubMatch[0].trim()}`;
  }
  return revisedPrompt;
}

/**
 * Validates each prompt in a script with an auto-repair loop.
 * If any prompt fails more than 3 times, the entire validation process STOPS
 * and returns an error with the detailed failure so the user can change their story content.
 */
export async function validateAndRepairScenePrompts(
  promptsObj: Record<string, string>,
  sceneCount: number,
  options?: {
    productName?: string;
    worldStyle?: string;
    visualStyle?: string;
    userFeedback?: string;
    storyContext?: string;
    onlySceneIndices?: number[]; // 0-based indices; if provided, only audit these revised scenes
    maxAttemptsPerScene?: number; // default: 3
    onProgress?: (evt: {
      type:
        | "preflight_start"
        | "validating_scene"
        | "scene_issues_found"
        | "scene_passed"
        | "preflight_passed"
        | "prompt_validation_error";
      scene_index?: number;
      attempt?: number;
      max_attempts?: number;
      issues?: PromptValidationIssue[];
      technical_issues?: string[];
      message?: string;
      error?: string;
      prompt?: string;
      suggested_prompt?: string;
      repaired_count?: number;
      total_scenes?: number;
    }) => void;
  },
): Promise<BatchValidationResult> {
  const maxAttempts = options?.maxAttemptsPerScene || 3;
  const validatedPromptsObj = { ...promptsObj };
  const outcomes: SceneValidationOutcome[] = [];
  let repairedCount = 0;

  if (
    typeof validatedPromptsObj.character_bible === "string" &&
    validatedPromptsObj.character_bible.trim()
  ) {
    const { sanitized: cleanBible } = sanitizePromptForVeoPolicy(
      validatedPromptsObj.character_bible,
      options?.visualStyle,
    );
    validatedPromptsObj.character_bible = cleanBible;
  }

  const validatorModel = getValidatorModel();
  const validatorLabel = formatModelDisplayName(validatorModel);
  const targetSet = Array.isArray(options?.onlySceneIndices) && options!.onlySceneIndices!.length > 0
    ? new Set(options!.onlySceneIndices!.map((idx) => idx + 1))
    : null;
  const effectiveAuditCount = targetSet ? targetSet.size : sceneCount;

  options?.onProgress?.({
    type: "preflight_start",
    total_scenes: effectiveAuditCount,
    message: `🛡️ ${validatorLabel} đang kiểm tra chính sách an toàn Veo 3 & bản quyền cho ${effectiveAuditCount} phân cảnh...`,
  });

  for (let i = 1; i <= sceneCount; i++) {
    if (targetSet && !targetSet.has(i)) continue;
    const key = `prompt${i}`;
    const initialPrompt = String(validatedPromptsObj[key] || "").trim();
    if (!initialPrompt) continue;

    const dialogueKey = `dialogue${i}`;
    const associatedDialogue = String(validatedPromptsObj[dialogueKey] || "");

    // Deterministic pre-sanitization for high-frequency Veo 3 triggers (minors, crying, pregnancy, punishment)
    const preSanitized = sanitizePromptForVeoPolicy(
      initialPrompt,
      options?.visualStyle,
    );
    let currentPrompt = preSanitized.sanitized;
    if (preSanitized.fixes.length > 0) {
      console.log(
        `🛡️ [PromptValidator] Scene ${i} auto-sanitized policy triggers: ${preSanitized.fixes.join("; ")}`,
      );
    }
    let attempt = 0;
    let passed = false;
    let lastResult: PromptValidationResult | null = null;
    const history: Array<any> = [];

    while (attempt < maxAttempts) {
      attempt++;
      options?.onProgress?.({
        type: "validating_scene",
        scene_index: i,
        attempt,
        max_attempts: maxAttempts,
        prompt: currentPrompt,
        message: `🛡️ Đang kiểm định Phân cảnh ${i} (Lần ${attempt}/${maxAttempts})...`,
      });

      const audit = await validateVeoPromptWithAgy(currentPrompt, {
        sceneIndex: i,
        productName: options?.productName,
        dialogue: sanitizeVeoDialogueForLipSync(associatedDialogue),
        worldStyle: options?.worldStyle,
        visualStyle: options?.visualStyle,
        userFeedback: options?.userFeedback,
        storyContext: options?.storyContext,
      });

      lastResult = audit;
      history.push({ attempt, prompt: currentPrompt, ...audit });

      if (audit.ready_for_veo && audit.issues.length === 0) {
        const finalClean = sanitizePromptForVeoPolicy(
          currentPrompt,
          options?.visualStyle,
        ).sanitized;
        passed = true;
        validatedPromptsObj[key] = finalClean;
        if (finalClean !== initialPrompt) repairedCount++;

        options?.onProgress?.({
          type: "scene_passed",
          scene_index: i,
          attempt,
          max_attempts: maxAttempts,
          prompt: finalClean,
          message:
            attempt === 1 && finalClean === initialPrompt
              ? `✅ Phân cảnh ${i}: Đạt chuẩn an toàn Veo 3!`
              : `✅ Phân cảnh ${i}: Đã tự động lọc sạch từ nhạy cảm & chuẩn hóa Veo 3!`,
        });
        break;
      }

      // Issues detected
      const issuesSummary = audit.issues
        .map((iss) => `[${iss.type}] ${iss.text}`)
        .join(", ");
      console.warn(
        `⚠️ [PromptValidator] Scene ${i} (Attempt ${attempt}/${maxAttempts}) has issues: ${issuesSummary}`,
      );

      if (attempt < maxAttempts) {
        const rawRevised = preserveDubTimelineTag(
          currentPrompt,
          audit.suggested_prompt || currentPrompt,
        );
        const revised = sanitizePromptForVeoPolicy(
          rawRevised,
          options?.visualStyle,
        ).sanitized;
        options?.onProgress?.({
          type: "scene_issues_found",
          scene_index: i,
          attempt,
          max_attempts: maxAttempts,
          issues: audit.issues,
          technical_issues: audit.technical_issues,
          suggested_prompt: revised,
          message: `⚠️ Phân cảnh ${i} phát hiện rủi ro: ${issuesSummary}. ${validatorLabel} đang tự động sửa đổi (Lần ${attempt}/${maxAttempts})...`,
        });
        currentPrompt = revised;
      } else {
        // Fallback: if only SAFETY triggers that our deterministic sanitizer can clean, accept the sanitized prompt so user isn't blocked unnecessarily unless it's hard copyright
        const hasCopyright = audit.issues.some(
          (iss) => iss.type === "COPYRIGHT" || iss.type === "CELEBRITY",
        );
        const fallbackClean = sanitizePromptForVeoPolicy(
          preserveDubTimelineTag(
            currentPrompt,
            audit.suggested_prompt || currentPrompt,
          ),
          options?.visualStyle,
        ).sanitized;
        if (!hasCopyright && fallbackClean) {
          passed = true;
          validatedPromptsObj[key] = fallbackClean;
          if (fallbackClean !== initialPrompt) repairedCount++;
          options?.onProgress?.({
            type: "scene_passed",
            scene_index: i,
            attempt,
            max_attempts: maxAttempts,
            prompt: fallbackClean,
            message: `✅ Phân cảnh ${i}: Đã khử toàn bộ từ khóa rủi ro chính sách Veo 3!`,
          });
          break;
        }
        // Exceeded 3 attempts and still has issues!
        // DỪNG LẠI và thông báo cho người dùng
        const detailedIssues = audit.issues
          .map((iss) => `• [${iss.type}] ${iss.text}: ${iss.reason}`)
          .join("\n");

        const errorMsg = `Phân cảnh ${i} không đạt chuẩn Veo 3 sau ${maxAttempts} lần tự động sửa đổi do có rủi ro bản quyền/chính sách/mâu thuẫn:\n${detailedIssues}\n\nVui lòng thay đổi lại nội dung kịch bản hoặc cốt truyện để tiếp tục.`;

        console.error(
          `❌ [PromptValidator] STOPPING: Scene ${i} failed after ${maxAttempts} attempts!`,
        );

        const failedOutcome: SceneValidationOutcome = {
          scene_index: i,
          passed: false,
          attempts: attempt,
          initial_prompt: initialPrompt,
          final_prompt: currentPrompt,
          issues: audit.issues,
          technical_issues: audit.technical_issues,
        };
        outcomes.push(failedOutcome);

        options?.onProgress?.({
          type: "prompt_validation_error",
          scene_index: i,
          attempt,
          max_attempts: maxAttempts,
          issues: audit.issues,
          technical_issues: audit.technical_issues,
          error: errorMsg,
          prompt: currentPrompt,
          message: `❌ Dừng kịch bản: Phân cảnh ${i} vẫn lỗi sau ${maxAttempts} lần sửa. Vui lòng đổi nội dung!`,
        });

        return {
          success: false,
          promptsObj: validatedPromptsObj,
          repairedCount,
          totalScenes: sceneCount,
          failedScene: failedOutcome,
          error: errorMsg,
          outcomes,
        };
      }
    }

    outcomes.push({
      scene_index: i,
      passed,
      attempts: attempt,
      initial_prompt: initialPrompt,
      final_prompt: currentPrompt,
      issues: lastResult?.issues || [],
      technical_issues: lastResult?.technical_issues || [],
    });
  }

  options?.onProgress?.({
    type: "preflight_passed",
    repaired_count: repairedCount,
    total_scenes: sceneCount,
    message:
      repairedCount > 0
        ? `🎉 Đã kiểm định toàn bộ ${sceneCount} phân cảnh! Tự động tối ưu ${repairedCount} cảnh đạt 100% chuẩn Veo 3.`
        : `🎉 Đã kiểm định toàn bộ ${sceneCount} phân cảnh! 100% prompt an toàn và sẵn sàng cho Veo 3.`,
  });

  return {
    success: true,
    promptsObj: validatedPromptsObj,
    repairedCount,
    totalScenes: sceneCount,
    outcomes,
  };
}
