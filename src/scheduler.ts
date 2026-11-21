/**
 * Scheduler — Automatically runs the affiliate pipeline on a cron schedule.
 * Default: 8 AM, 12 PM, 6 PM every day.
 *
 * Pipeline: Product → Gemini Prompt → Veo Video → S3 Upload → TikTok Publish
 *
 * NOTE: node-cron is dynamically imported so the server won't crash
 * if the package is not yet installed. Install with: npm install node-cron
 */

import fs from "fs/promises";
import { existsSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
import {
  loadProducts as dbLoadProducts,
  updateProduct as dbUpdateProduct,
  type Product,
} from "./database.js";
import { buildWorldStyleDirective, normalizeWorldStyle, withWorldStyle } from "./worldStyles.js";
import { checkContentSafety } from "./contentSafety.js";
import { formatModelDisplayName, getScriptwriterModel, getAuditorModel } from "./aiModelConfig.js";

export type { Product };

export interface EpisodeDefinition {
  id?: string;
  title: string;
  startScene: number;
  endScene: number;
}

export interface GeneratedEpisode {
  id: string;
  title: string;
  startScene: number;
  endScene: number;
  filename: string;
  local_path: string;
  video_url: string;
  voiced_path?: string | null;
  voiced_url?: string | null;
}

export interface PipelineResult {
  product_id: string;
  product_name: string;
  success: boolean;
  prompt?: string;
  local_path?: string;
  video_url?: string;
  voiced_path?: string | null;
  voiced_url?: string | null;
  episodes?: GeneratedEpisode[];
  scene_images?: string[];
  s3_url?: string;
  s3_key?: string;
  metadata_id?: string;
  tiktok_video_id?: string;
  tiktok_status?: string;
  error?: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
}

// Pipeline state tracking
let isRunning = false;
let isCancelled = false;
let lastRunResults: PipelineResult[] = [];
let scheduledJobs: any[] = [];

export function getPipelineStatus() {
  return {
    is_running: isRunning,
    is_cancelled: isCancelled,
    last_run_results: lastRunResults,
    scheduled_count: scheduledJobs.length,
  };
}

export function stopPipeline() {
  isCancelled = true;
  isRunning = false;
  console.log("⛔ [Pipeline] stopPipeline() triggered — cancellation flag set.");
  return { success: true, message: "Pipeline cancellation signal received" };
}

export function isPipelineCancelled() {
  return isCancelled;
}

function wrapText(text: string, maxCharsPerLine: number = 42): string {
  const words = text.split(" ");
  let currentLine = "";
  const lines: string[] = [];

  for (const word of words) {
    if ((currentLine + " " + word).trim().length <= maxCharsPerLine) {
      currentLine = (currentLine + " " + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines.join("\n");
}

export function getFfmpegCmd(): string {
  try {
    const ffmpegStatic = require("ffmpeg-static");
    if (ffmpegStatic && existsSync(ffmpegStatic)) {
      return ffmpegStatic;
    }
  } catch {}

  if (existsSync("/opt/homebrew/bin/ffmpeg")) {
    return "/opt/homebrew/bin/ffmpeg";
  }
  if (existsSync("/usr/local/bin/ffmpeg")) {
    return "/usr/local/bin/ffmpeg";
  }
  return "ffmpeg";
}

export function getFfprobeCmd(): string {
  if (existsSync("/opt/homebrew/bin/ffprobe")) {
    return "/opt/homebrew/bin/ffprobe";
  }
  if (existsSync("/usr/local/bin/ffprobe")) {
    return "/usr/local/bin/ffprobe";
  }
  return "ffprobe";
}

export async function mergeVideoSegments(segmentPaths: string[], outputPath: string): Promise<void> {
  const { writeFileSync, unlinkSync } = await import("fs");
  const { execSync } = await import("child_process");
  
  if (segmentPaths.length === 1) {
    const { copyFileSync } = await import("fs");
    copyFileSync(segmentPaths[0], outputPath);
    console.log(`ℹ️ [Merge] Only one segment succeeded. Used as output directly: ${outputPath}`);
    return;
  }

  const ffmpeg = getFfmpegCmd();
  const ffprobe = getFfprobeCmd();

  console.log(`🎬 [Merge] Concatenating ${segmentPaths.length} video segments using FFmpeg filter_complex (auto resample 48kHz + 30fps)...`);
  
  const execPromise = (cmd: string) => new Promise<void>((resolve, reject) => {
    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        console.error(`FFmpeg output stderr:\n${stderr}`);
        reject(new Error(stderr || err.message));
      } else {
        resolve();
      }
    });
  });

  // Check audio and duration for each input segment
  const checkHasAudio = (videoPath: string): boolean => {
    try {
      const probeOut = execSync(`"${ffprobe}" -v error -show_streams -select_streams a -of json "${videoPath}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      const parsed = JSON.parse(probeOut);
      return Array.isArray(parsed.streams) && parsed.streams.length > 0;
    } catch {
      return false;
    }
  };

  const getVideoDuration = (videoPath: string): number => {
    try {
      const out = execSync(`"${ffprobe}" -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`, {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      const d = parseFloat(out.trim());
      if (!isNaN(d) && d > 0) return d;
    } catch {}
    return 10;
  };

  try {
    const inputArgs = segmentPaths.map(p => `-i "${path.resolve(p)}"`).join(" ");
    const filterParts: string[] = [];
    const concatInputs: string[] = [];

    for (let i = 0; i < segmentPaths.length; i++) {
      const p = path.resolve(segmentPaths[i]);
      const hasAudio = checkHasAudio(p);

      // Normalize video to 30fps and aligned PTS
      filterParts.push(`[${i}:v]fps=30,setpts=PTS-STARTPTS[v${i}]`);

      // Normalize audio to 48000Hz stereo fltp with aligned PTS
      if (hasAudio) {
        filterParts.push(`[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`);
      } else {
        const dur = getVideoDuration(p);
        filterParts.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${dur.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
      }

      concatInputs.push(`[v${i}][a${i}]`);
    }

    filterParts.push(`${concatInputs.join("")}concat=n=${segmentPaths.length}:v=1:a=1[outv][outa]`);
    const filterComplex = filterParts.join("; ");

    const cmd = `"${ffmpeg}" -y ${inputArgs} -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 "${outputPath}"`;
    await execPromise(cmd);
    console.log(`✅ [Merge] Seamless concatenation completed successfully with perfect sync: ${outputPath}`);
  } catch (err: any) {
    console.warn(`⚠️ [Merge] Filter_complex concat failed: ${err.message}. Trying demuxer fallback...`);
    const listFilePath = outputPath + ".txt";
    const listContent = segmentPaths.map(p => `file '${path.resolve(p)}'`).join("\n");
    writeFileSync(listFilePath, listContent, "utf-8");
    try {
      await execPromise(`"${ffmpeg}" -y -f concat -safe 0 -i "${listFilePath}" -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p -r 30 -c:a aac -b:a 192k -ar 48000 "${outputPath}"`);
      console.log(`✅ [Merge] Fallback concatenation completed: ${outputPath}`);
    } finally {
      try { unlinkSync(listFilePath); } catch {}
    }
  }
}

export async function extractThumbnailWithFfmpeg(videoPath: string, outputPath: string): Promise<boolean> {
  console.log(`📸 [Thumbnail] Extracting thumbnail frame from ${videoPath} using FFmpeg...`);
  const ffmpeg = getFfmpegCmd();
  return new Promise<boolean>((resolve) => {
    exec(`"${ffmpeg}" -y -i "${videoPath}" -ss 00:00:03 -vframes 1 -q:v 2 "${outputPath}"`, (err) => {
      if (err) {
        console.warn(`⚠️ [Thumbnail] FFmpeg thumbnail extraction failed: ${err.message}`);
        resolve(false);
      } else {
        console.log(`✅ [Thumbnail] Thumbnail saved to: ${outputPath}`);
        resolve(true);
      }
    });
  });
}

function slugify(text: string): string {
  return text
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-_]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function loadProducts(): Promise<Product[]> {
  return dbLoadProducts();
}

export function parseTextPromptToObj(input: any): any {
  if (!input) return null;

  let rawObj: any = input;

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        rawObj = JSON.parse(trimmed);
      } catch {}
    }
  }

  let scenesArray: any[] | null = null;
  let globalRulesStr = "";

  if (Array.isArray(rawObj)) {
    scenesArray = rawObj;
  } else if (typeof rawObj === "object" && rawObj !== null) {
    if (Array.isArray(rawObj.scenes)) {
      scenesArray = rawObj.scenes;

      // Extract CHARACTER_BIBLE if present
      let characterBibleStr = "";
      const bibleObj = rawObj.CHARACTER_BIBLE || rawObj.character_bible;
      if (typeof bibleObj === "object" && bibleObj !== null) {
        const bibleParts: string[] = [];
        for (const [charKey, charVal] of Object.entries(bibleObj)) {
          if (typeof charVal === "object" && charVal !== null) {
            const inner = Object.entries(charVal)
              .map(([k, v]) => `${k}: ${v}`)
              .join("; ");
            bibleParts.push(`[${charKey}] ${inner}`);
          } else if (typeof charVal === "string") {
            bibleParts.push(`[${charKey}] ${charVal}`);
          }
        }
        if (bibleParts.length > 0) {
          characterBibleStr = `CHARACTER BIBLE (STRICT SPECIES & DESIGN LOCK):\n` + bibleParts.join("\n") + "\n\n";
        }
      }

      const rulesObj = rawObj.GLOBAL_RULES || rawObj.GLOBAL_CONTINUITY_RULES || rawObj.GLOBAL_RULE;
      if (typeof rulesObj === "object" && rulesObj !== null) {
        const rulesParts: string[] = [];
        for (const [k, v] of Object.entries(rulesObj)) {
          if (typeof v === "string") {
            rulesParts.push(`${k.replace(/_/g, " ")}: ${v}`);
          } else if (typeof v === "object" && v !== null) {
            const inner = Object.entries(v)
              .map(([ik, iv]) => `${ik}: ${iv}`)
              .join("; ");
            rulesParts.push(`${k}: ${inner}`);
          }
        }
        if (rulesParts.length > 0) {
          globalRulesStr = `GLOBAL RULES:\n` + rulesParts.join("\n") + "\n\n";
        }
      }
      globalRulesStr = characterBibleStr + globalRulesStr;
    } else if (rawObj.prompt1 || rawObj.prompt || rawObj.scene1) {
      return rawObj;
    }
  }

  if (scenesArray && Array.isArray(scenesArray)) {
    const obj: any = {};
    scenesArray.forEach((item: any, idx: number) => {
      const sceneNum = item.scene_index || item.scene || (idx + 1);
      const rawPromptText = item.prompt || item.prompt_veo || item.visual_prompt || "";
      const negPrompt = item.negative_prompt || rawObj.negative_prompt || "";
      const negStr = negPrompt ? `\n\nNEGATIVE PROMPT: ${negPrompt}` : "";
      const promptText = rawPromptText ? (
        `${globalRulesStr}\nSCENE ${sceneNum} ACTION:\n${rawPromptText}${negStr}`
      ).trim() : "";
      
      let dialogueText = "";
      let voiceName = "";

      const dialogueMeta = item.dialogue_metadata || item.dialogue;
      if (Array.isArray(dialogueMeta)) {
        const lines: string[] = [];
        dialogueMeta.forEach((d: any) => {
          if (typeof d === "object" && d !== null) {
            if (!voiceName && (d.voice_id || d.voice)) {
              voiceName = d.voice_id || d.voice;
            }
            if (d.text) {
              const speakerStr = d.speaker ? `${d.speaker}: ` : "";
              lines.push(`${speakerStr}"${d.text}"`);
            }
          } else if (typeof d === "string") {
            lines.push(d);
          }
        });
        dialogueText = lines.join("\n");
      } else if (typeof dialogueMeta === "object" && dialogueMeta !== null) {
        dialogueText = dialogueMeta.text || "";
        voiceName = dialogueMeta.voice_id || dialogueMeta.voice || "";
        if (dialogueMeta.speaker && dialogueText) {
          dialogueText = `${dialogueMeta.speaker}: "${dialogueText}"`;
        }
      } else if (typeof dialogueMeta === "string") {
        dialogueText = dialogueMeta;
      }

      if (promptText) obj[`prompt${sceneNum}`] = promptText;
      if (dialogueText) obj[`dialogue${sceneNum}`] = dialogueText;
      if (voiceName) obj[`voice${sceneNum}`] = voiceName;
    });
    if (Object.keys(obj).length > 0) return obj;
  }

  if (typeof input === "string") {
    const textToParse = input.trim();
    if (textToParse) {
      const obj: any = {};
      const bibleMatch = textToParse.match(/(?:\[CHARACTER_BIBLE\]|CHARACTER_BIBLE:?|CHARACTER BIBLE:?)([\s\S]*?)(?=(?:(?:\r?\n)+(?:##|\*\*|---|Scene\s*1|prompt1|Part\s*1|Phân cảnh\s*1))|$)/i);
      if (bibleMatch && bibleMatch[1].trim()) {
        obj.character_bible = bibleMatch[1].replace(/^[#*\s=:-]+/, "").trim();
      }

      const audioBibleMatch = textToParse.match(/(?:\[AUDIO_AND_VOICE_BIBLE\]|AUDIO_AND_VOICE_BIBLE:?|AUDIO BIBLE:?)([\s\S]*?)(?=(?:(?:\r?\n)+(?:##|\*\*|---|Scene\s*1|prompt1|Part\s*1|Phân cảnh\s*1))|$)/i);
      if (audioBibleMatch && audioBibleMatch[1].trim()) {
        obj.audio_bible = audioBibleMatch[1].replace(/^[#*\s=:-]+/, "").trim();
      }

      // 1. Intelligent multi-part parser (scans Part/Scene 1..20)
      for (let i = 1; i <= 20; i++) {
        const sceneRegex = new RegExp(
          `(?:###?\\s*|\\*\\*|\\b)(?:Scene|Part|Cảnh|Phân cảnh)\\s*${i}[:\\*\\s\\-]+([\\s\\S]*?)(?=(?:###?\\s*|\\*\\*|\\b)(?:Scene|Part|Cảnh|Phân cảnh)\\s*\\d+[:\\*\\s\\-]|$)`,
          "i"
        );
        const sMatch = textToParse.match(sceneRegex);
        const sceneBlock = sMatch ? sMatch[1].trim() : "";

        let promptText = "";
        let dialogueText = "";

        if (sceneBlock) {
          const pInnerMatch = sceneBlock.match(/(?:\*{0,2}(?:prompt|visual prompt)\s*\d*\*{0,2}[:\s\-]+)([\s\S]*?)(?=(?:(?:\r?\n)+\s*[#*\-]*\s*(?:lời thoại|thoại|dialogue|vietnamese dialogue)\s*\d*\*{0,2}[:\s\-]|$))/i);
          if (pInnerMatch) {
            promptText = pInnerMatch[1].trim();
          }

          const diaMatch = sceneBlock.match(/(?:^|\r?\n)\s*[#*\-]*\s*(?:\*{0,2}(?:lời thoại(?:\s*&\s*lồng tiếng)?(?:\s*\(vietnamese dialogue\))?|thoại tiếng việt|thoại|dialogue|vietnamese dialogue)\s*\d*\*{0,2}[:\s\-]+)([\s\S]*)$/i);
          if (diaMatch) {
            dialogueText = diaMatch[1].trim();
            if (!promptText) {
              promptText = sceneBlock.substring(0, diaMatch.index).trim();
            }
          } else if (!promptText) {
            promptText = sceneBlock;
          }
        } else {
          const pMatch = textToParse.match(new RegExp(`(?:^|\\r?\\n)[#*\`\\s-]*(?:prompt|visual prompt)\\s*${i}[:\\*\\s\\-]+([\\s\\S]*?)(?=(?:(?:\\r?\\n)+[#*\`\\s-]*(?:dialogue|thoại|lời thoại|prompt|scene|part|cảnh|---))|$)`, "i"));
          const dMatch = textToParse.match(new RegExp(`(?:^|\\r?\\n)[#*\`\\s-]*(?:dialogue|thoại|lời thoại)\\s*${i}[:\\*\\s\\-]+([\\s\\S]*?)(?=(?:(?:\\r?\\n)+[#*\`\\s-]*(?:prompt|dialogue|scene|part|cảnh|---))|$)`, "i"));
          if (pMatch) promptText = pMatch[1].trim();
          if (dMatch) dialogueText = dMatch[1].trim();
        }

        promptText = promptText
          .replace(/^[\s\S]*?\b(?:prompt\d*|visual prompt)[:\s\-]*/i, "")
          .replace(/^[\-_#\s*]+/, "")
          .replace(/[\-_#\s*]+$/, "")
          .trim();

        dialogueText = dialogueText
          .replace(/^[\-_#\s*]+/, "")
          .replace(/[\-_#\s*]+$/, "")
          .trim();

        if (promptText) obj[`prompt${i}`] = promptText;
        if (dialogueText) obj[`dialogue${i}`] = dialogueText;
      }

      if (Object.keys(obj).some((k) => /^prompt\d+$/i.test(k))) {
        return obj;
      }

      // 2. Legacy CẢNH / SCENE block parser
      const sceneBlocks = textToParse.split(/(?:CẢNH|SCENE)\s*(\d+)/i);
      if (sceneBlocks.length > 1) {
        for (let i = 1; i < sceneBlocks.length; i += 2) {
          const sceneNum = sceneBlocks[i];
          const blockContent = sceneBlocks[i + 1] || "";
          
          let promptText = "";
          let dialogueText = "";

          if (/THOẠI TIẾNG VIỆT:/i.test(blockContent)) {
            const parts = blockContent.split(/THOẠI TIẾNG VIỆT:/i);
            promptText = parts[0].replace(/PROMPT VEO:/i, "").replace(/^[\s=:-]+/, "").trim();
            dialogueText = (parts[1] || "").trim();
          } else if (/PROMPT VEO:/i.test(blockContent)) {
            const pM = blockContent.match(/PROMPT VEO:\s*([\s\S]*?)$/i);
            if (pM) promptText = pM[1].trim();
          } else {
            promptText = blockContent.replace(/^[\s=:-]+/, "").trim();
          }

          promptText = promptText.replace(/[=─-]{5,}$/g, "").trim();
          dialogueText = dialogueText.replace(/[=─-]{5,}$/g, "").trim();

          if (promptText) obj[`prompt${sceneNum}`] = promptText;
          if (dialogueText) obj[`dialogue${sceneNum}`] = dialogueText;
        }
      }

      if (Object.keys(obj).length > 0) {
        return obj;
      }

      return { prompt1: textToParse };
    }
  }

  return null;
}

export async function runPipelineForProduct(
  product: Product,
  options: {
    dryRun?: boolean;
    uploadToS3?: boolean;
    publishTikTok?: boolean;
    customPromptsObj?: any;
    useAiConsensus?: boolean;
    userFeedback?: string;
    sceneImagePaths?: string[];
    autoGenerateSceneImages?: boolean;
    sceneCount?: number;
    worldStyle?: string;
  } = {}
): Promise<PipelineResult> {
  const requestedSceneCount = Number.isInteger(options.sceneCount) && Number(options.sceneCount) > 0
    ? Number(options.sceneCount)
    : undefined;
  const {
    dryRun = false,
    uploadToS3 = true,
    publishTikTok = true,
    customPromptsObj,
    useAiConsensus = true,
    userFeedback,
    sceneImagePaths = [],
    autoGenerateSceneImages = true,
    sceneCount = requestedSceneCount || 8,
    worldStyle = product.world_style || "auto",
  } = options;
  const activeWorldStyle = normalizeWorldStyle(worldStyle);
  isRunning = true;
  isCancelled = false;
  const startedAt = new Date().toISOString();
  const startTime = Date.now();
  let veoResult: any = null;
  let segmentFiles: string[] = [];
  let activeSceneImages: string[] = [...sceneImagePaths];

  console.log(`\n${"─".repeat(60)}`);
  console.log(`🚀 [Pipeline] Starting (Multi-Segment): ${product.name} (${product.id})`);
  console.log(`   DryRun: ${dryRun} | S3: ${uploadToS3} | TikTok: ${publishTikTok} | 2-AI Consensus: ${useAiConsensus} | Auto Scene Images: ${autoGenerateSceneImages} | Target Scenes: ${sceneCount} | World Style: ${activeWorldStyle}`);
  if (userFeedback) {
    console.log(`   User Director Feedback: "${userFeedback}"`);
  }
  console.log(`${"─".repeat(60)}`);

  try {
    const inputSafety = checkContentSafety(product.description, userFeedback, JSON.stringify(customPromptsObj || product.promptsObj || {}));
    if (!inputSafety.safe) {
      const labels = inputSafety.issues.map((issue) => `${issue.label}: ${issue.guidance}`).join(" | ");
      throw new Error(`GEMINI_SAFETY_POLICY_BLOCK — ${labels}`);
    }

    // Step 1: Resolve prompts (Use passed customPromptsObj OR saved product.promptsObj OR generate new via Gemini)
    let promptsObj = parseTextPromptToObj(customPromptsObj) || parseTextPromptToObj(product.promptsObj);
    const { generateSixVideoPrompts, generatePromptsWithAiConsensus, generateVideoDescriptionVi } = await import("./promptGenerator.js");

    const hasValidPrompts = promptsObj && (
      promptsObj.prompt1 || promptsObj.prompt || promptsObj.scene1 || Object.keys(promptsObj).length > 0
    );

    if (hasValidPrompts) {
      console.log(`📌 [Pipeline 1/4] Using PRESET/CUSTOM prompts for "${product.name}" (${Object.keys(promptsObj).length} keys parsed, skipping AI re-generation)...`);
    } else if (useAiConsensus) {
      const ai1Name = formatModelDisplayName(getScriptwriterModel());
      const ai2Name = formatModelDisplayName(getAuditorModel());
      console.log(`\n🤝 [Pipeline 1/4] Generating ${sceneCount} Veo prompts via 2-AI validation (${ai1Name} + ${ai2Name})...`);
      const consensusRes = await generatePromptsWithAiConsensus(
        product.name,
        product.category,
        product.image_url,
        product.description,
        sceneCount,
        30,
        undefined,
        userFeedback,
        undefined,
        undefined,
        1,
        activeWorldStyle
      );
      promptsObj = consensusRes.promptsObj;
    } else {
      console.log(`\n📝 [Pipeline 1/4] Generating ${sceneCount} consistent Veo prompts & Vietnamese caption via AI...`);
      promptsObj = await generateSixVideoPrompts(product.name, product.category, product.image_url, `${product.description || ""}\n\n${buildWorldStyleDirective(activeWorldStyle)}`);
    }

    for (const key of Object.keys(promptsObj || {})) {
      if (/^prompt\d+$/i.test(key) || key === "prompt") {
        promptsObj[key] = withWorldStyle(String(promptsObj[key] || ""), activeWorldStyle);
      }
    }
    const generatedSafety = checkContentSafety(JSON.stringify(promptsObj || {}));
    if (!generatedSafety.safe) {
      const labels = generatedSafety.issues.map((issue) => `${issue.label}: ${issue.guidance}`).join(" | ");
      throw new Error(`GEMINI_SAFETY_POLICY_BLOCK — ${labels}`);
    }

    // Persist promptsObj back to product in SQLite
    try {
      dbUpdateProduct(product.id, { promptsObj });
      product.promptsObj = promptsObj;
      console.log(`💾 [Pipeline] Saved/Updated promptsObj into SQLite for product: ${product.id}`);
    } catch (saveErr: any) {
      console.warn(`⚠️ [Pipeline] Could not persist promptsObj to SQLite: ${saveErr.message}`);
    }

    const descriptionVi = await generateVideoDescriptionVi(product.name, product.category, product.image_url);

    const mergedPromptStr = Object.entries(promptsObj)
      .map(([key, val]) => `${key.replace("prompt", "")}: ${val}`)
      .join("\n");

    if (dryRun) {
      console.log(`🧪 [Pipeline] DRY RUN — stopping after prompt generation`);
      return {
        product_id: product.id,
        product_name: product.name,
        success: true,
        prompt: mergedPromptStr,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
      };
    }

    // Extract dynamic prompt list from promptsObj
    const sceneNumbers: number[] = [];
    if (promptsObj && typeof promptsObj === "object") {
      for (const k of Object.keys(promptsObj)) {
        const m = k.match(/^prompt(\d+)$/i);
        if (m) sceneNumbers.push(parseInt(m[1], 10));
      }
    }
    const maxScene = sceneNumbers.length > 0 ? Math.max(...sceneNumbers) : 0;
    // An explicit UI/API selection is authoritative: five requested scenes means
    // prompt1..prompt5 only, even if a saved object still contains stale prompt6+.
    const dynamicCount = requestedSceneCount || (maxScene > 0 ? maxScene : (promptsObj?.prompt ? 1 : sceneCount));
    const promptSlots = Array.from({ length: dynamicCount }, (_, idx) => {
      const i = idx + 1;
      const p = promptsObj[`prompt${i}`] || (i === 1 ? promptsObj.prompt : "");
      return p ? p.trim() : "";
    });
    const missingScenes = promptSlots
      .map((value, idx) => value ? null : idx + 1)
      .filter((value): value is number => value !== null);
    if (missingScenes.length > 0) {
      throw new Error(`Thiếu prompt cho phân cảnh ${missingScenes.join(", ")}; cần đúng ${dynamicCount} phân cảnh liên tục.`);
    }
    const prompts = promptSlots;
    activeSceneImages = activeSceneImages.slice(0, dynamicCount);

    const productSlug = slugify(product.name) || "video";
    // 1 Parent Folder for the product: data/downloads/${productSlug}
    // Contains both scenes/ (images) and videos together in this single parent directory
    const jobFolder = productSlug;
    const downloadsDir = path.resolve(__dirname, `../data/downloads/${jobFolder}`);
    if (!existsSync(downloadsDir)) await fs.mkdir(downloadsDir, { recursive: true });

    console.log(`📁 [Pipeline] Thư mục cha duy nhất cho sản phẩm: ${downloadsDir}`);

    const scenesDir = path.join(downloadsDir, "scenes");
    if (!existsSync(scenesDir)) await fs.mkdir(scenesDir, { recursive: true });

    // Step 2: Check for existing Scene Keyframe Images or generate new ones
    if (activeSceneImages.length === 0 && existsSync(scenesDir)) {
      const existingScenes = Array.from({ length: prompts.length }, (_, idx) =>
        path.join(scenesDir, `scene_${idx + 1}.png`)
      ).filter((p) => existsSync(p));
      if (existingScenes.length === prompts.length && prompts.length > 0) {
        console.log(`✨ [Pipeline] Tìm thấy đầy đủ ${prompts.length} ảnh phân cảnh có sẵn trong ${scenesDir}! Tái sử dụng.`);
        activeSceneImages = existingScenes;
      }
    }

    const dialogues = Array.from({ length: prompts.length }, (_, idx) => {
      const i = idx + 1;
      return (promptsObj && promptsObj[`dialogue${i}`]) ? promptsObj[`dialogue${i}`] : "";
    });

    // ── Auto-generate dialogues if custom prompts lack them ──────────────
    const hasDialogues = dialogues.some(d => d && d.trim().length > 0);
    if (!hasDialogues && promptsObj && prompts.length > 0) {
      console.log(`⚠️  [Pipeline] Custom prompts detected WITHOUT dialogues (dialogue1-${prompts.length} missing). Auto-generating Vietnamese dialogues...`);
      try {
        const { callAgy, isAgyEnabled } = await import("./agyClient.js");
        if (!isAgyEnabled()) throw new Error("AGY is disabled");

        const promptSummary = Array.from({ length: prompts.length }, (_, idx) => {
          const i = idx + 1;
          return `Scene ${i}: ${promptsObj[`prompt${i}`] || ""}`;
        }).filter(s => !s.endsWith(": ")).join("\n");

        const systemPrompt = `You are a Vietnamese dialogue writer for animated children's videos featuring cute chibi characters.
Write natural, heartwarming Vietnamese dialogue for each scene.
RULES:
- Each scene gets 2-4 lines of dialogue between characters
- Format each line as: CharacterName: "Spoken text"
- Vietnamese must be colloquial, cute, natural — how real Vietnamese friends talk
- NOT advertising copy, NOT formal
- Include cute reactions like "Waaaa!", "Hihi", "Ê ê!"`;

        const dialogueKeys = Array.from({ length: prompts.length }, (_, idx) => `"dialogue${idx + 1}": "..."`).join(", ");
        const userPrompt = `SCENES:\n${promptSummary}\n\nPRODUCT/TOPIC: ${product.name}\n\nReply in STRICT JSON:\n{${dialogueKeys}}`;

        const raw = await callAgy(systemPrompt, userPrompt, true);
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          for (let i = 1; i <= prompts.length; i++) {
            const d = parsed[`dialogue${i}`];
            if (d && typeof d === "string" && d.trim()) {
              dialogues[i - 1] = d.trim();
              promptsObj[`dialogue${i}`] = d.trim();
            }
          }
          console.log(`✅ [Pipeline] Auto-generated Vietnamese dialogues for ${dialogues.filter(d => d).length} scenes`);

          // Persist the newly generated dialogues back to SQLite
          if (product.id) {
            try {
              dbUpdateProduct(product.id, { promptsObj });
              product.promptsObj = promptsObj;
              console.log(`💾 [Pipeline] Saved auto-generated dialogues into SQLite for product: ${product.id}`);
            } catch (saveErr: any) {
              console.warn(`⚠️ [Pipeline] Could not persist auto-generated dialogues to SQLite: ${saveErr.message}`);
            }
          }
        }
      } catch (dialogueErr: any) {
        console.warn(`⚠️  [Pipeline] Dialogue auto-generation failed: ${dialogueErr.message}. Videos will have no dialogue.`);
      }
    }

    const originalProductImages: string[] = [];
    if (Array.isArray(product.images)) {
      for (const img of product.images) {
        if (typeof img === "string" && img.trim() && !originalProductImages.includes(img.trim())) {
          originalProductImages.push(img.trim());
        }
      }
    }
    if (product.image_url && typeof product.image_url === "string" && product.image_url.trim() && !originalProductImages.includes(product.image_url.trim())) {
      originalProductImages.unshift(product.image_url.trim());
    }

    if (activeSceneImages.length === 0 && originalProductImages.length > 0 && autoGenerateSceneImages) {
      console.log(`\n🎨 [Pipeline 2/4] Generating ${prompts.length} detailed 3D Pixar scene images via Gemini before video creation (using ${originalProductImages.length} original images)...`);
      try {
        const { generateAllSceneImages } = await import("./sceneImageGenerator.js");
        console.log(`📁 [Pipeline] Scene images will be saved in: ${scenesDir}`);
        const sceneGenRes = await generateAllSceneImages(
          prompts,
          originalProductImages,
          productSlug,
          scenesDir,
          dialogues
        );
        if (sceneGenRes.success && sceneGenRes.sceneImagePaths.length > 0) {
          activeSceneImages = sceneGenRes.sceneImagePaths;
          console.log(`✅ [Pipeline] Successfully generated ${activeSceneImages.length} scene keyframe images!`);
        }
      } catch (sceneErr: any) {
        console.warn(`⚠️ [Pipeline] Scene image generation failed (${sceneErr.message}). Continuing with video generation.`);
      }
    }

    // Step 3: Generate video segments sequentially using Puppeteer + Veo (using generated scene images)
    console.log(`\n🎬 [Pipeline 3/4] Generating ${prompts.length} Veo video segments sequentially using scene images & prompts...`);
    const { generateVeoVideoParallel } = await import("./veoAutomation.js");
    const { unlinkSync } = await import("fs");

    const parallelRes = await generateVeoVideoParallel(
      prompts,
      product.image_url,
      productSlug,
      downloadsDir,
      activeSceneImages,
      dialogues,
      originalProductImages
    );
    segmentFiles = parallelRes.localPaths;

    if (segmentFiles.length === 0) {
      throw new Error(`All video segments failed to generate. Errors: ${parallelRes.errors.join("; ")}`);
    }

    // Sort segment files to ensure proper concatenation order (part1, part2, part3)
    segmentFiles.sort((a, b) => {
      const getIndex = (filePath: string) => {
        const match = filePath.match(/_part(\d+)_/);
        return match ? parseInt(match[1], 10) : 99;
      };
      return getIndex(a) - getIndex(b);
    });

    console.log(`✅ [Pipeline] Successfully generated segments in order:`, segmentFiles);

    // ── Merged Video (Without Voiceover) ─────────────────────────────────────
    const mergedFilename = `${productSlug}_merged.mp4`;
    const mergedVideoPath = path.join(downloadsDir, mergedFilename);
    console.log(`\n🎬 [Pipeline] Merging ${segmentFiles.length} video segments using FFmpeg...`);
    await mergeVideoSegments(segmentFiles, mergedVideoPath);
    console.log(`✅ [Pipeline] Created Merged Video: ${mergedVideoPath}`);

    // Extract thumbnail from the merged video
    const mergedThumbFilename = `${productSlug}_thumb.jpg`;
    const mergedThumbPath = path.join(downloadsDir, mergedThumbFilename);
    const thumbSuccess = await extractThumbnailWithFfmpeg(mergedVideoPath, mergedThumbPath);

    // Set veoResult to contain the final merged video paths
    veoResult = {
      success: true,
      localPath: mergedVideoPath,
      thumbnailPath: thumbSuccess ? mergedThumbPath : undefined,
      videoUrl: "(concatenated video)",
      prompt: mergedPromptStr,
      durationMs: Date.now() - startTime
    };

    let s3Url = "";
    let s3Key = "";
    let s3ThumbUrl = "";
    let metadataId = `vid_${Date.now()}`;
    let tiktokVideoId = "";
    let tiktokStatus = "skipped";
    const fileSize = existsSync(veoResult.localPath) ? statSync(veoResult.localPath).size : 0;

    if (uploadToS3 && process.env.AWS_ACCESS_KEY_ID && process.env.S3_BUCKET_NAME) {
      try {
        console.log(`\n☁️  [Pipeline 3/4] Uploading to S3...`);
        const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
        const { createReadStream } = await import("fs");

        const s3 = new S3Client({
          region: process.env.AWS_REGION || "ap-southeast-1",
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
          },
        });

        const bucket = process.env.S3_BUCKET_NAME;
        const prefix = (process.env.S3_KEY_PREFIX || "videos/").replace(/\/$/, "");
        const filename = path.basename(veoResult.localPath);
        s3Key = `${prefix}/${filename}`;

        const fileStream = createReadStream(veoResult.localPath);

        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: s3Key,
          Body: fileStream,
          ContentType: "video/mp4",
          ContentLength: fileSize,
          Metadata: {
            product_id: product.id,
            product_name: encodeURIComponent(product.name),
            prompt: encodeURIComponent(mergedPromptStr.slice(0, 512)),
          },
        }));

        s3Url = `https://${bucket}.s3.${process.env.AWS_REGION || "ap-southeast-1"}.amazonaws.com/${s3Key}`;
        console.log(`✅ [Pipeline] Uploaded to S3: ${s3Url}`);

        if (veoResult.thumbnailPath && existsSync(veoResult.thumbnailPath)) {
          console.log(`☁️  [Pipeline] Uploading video thumbnail to S3...`);
          const thumbFilename = path.basename(veoResult.thumbnailPath);
          const s3ThumbKey = `${prefix}/${thumbFilename}`;
          const thumbStream = createReadStream(veoResult.thumbnailPath);
          const thumbSize = statSync(veoResult.thumbnailPath).size;

          await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: s3ThumbKey,
            Body: thumbStream,
            ContentType: "image/jpeg",
            ContentLength: thumbSize,
            Metadata: {
              product_id: product.id,
              type: "thumbnail",
            },
          }));

          s3ThumbUrl = `https://${bucket}.s3.${process.env.AWS_REGION || "ap-southeast-1"}.amazonaws.com/${s3ThumbKey}`;
          console.log(`✅ [Pipeline] Thumbnail uploaded to S3: ${s3ThumbUrl}`);
        }
      } catch (s3Err: any) {
        console.warn(`⚠️ [Pipeline] S3 upload skipped/failed (${s3Err.message}). Using local video path.`);
      }
    }

    // Local stream fallback URL if S3 is not available
    const filename = path.basename(veoResult.localPath);
    const localStreamUrl = `/downloads/${jobFolder}/${filename}`;
    const finalVideoUrl = s3Url || localStreamUrl;

    // Automatically update the product in SQLite with the generated image/thumbnail
    if (s3ThumbUrl && product.id) {
      try {
        dbUpdateProduct(product.id, { image_url: s3ThumbUrl });
        console.log(`⚙️  [Pipeline] Updated product ${product.id} image_url in SQLite`);
      } catch (prodErr: any) {
        console.warn(`⚠️  [Pipeline] Failed to update product in SQLite: ${prodErr.message}`);
      }
    }

    // Save metadata to data/metadata.json ALWAYS (local or S3)
    const metaFile = path.resolve(__dirname, "../data/metadata.json");
    const entry = {
      id: metadataId,
      title: product.name,
      description: descriptionVi,
      prompt: mergedPromptStr,
      tags: product.hashtags || [],
      source_url: veoResult.videoUrl || "",
      s3_url: finalVideoUrl,
      s3_key: s3Key,
      s3_bucket: process.env.S3_BUCKET_NAME || "",
      local_path: veoResult.localPath,
      thumbnail_url: s3ThumbUrl || product.image_url || (product.images && product.images.length > 0 ? product.images[0] : undefined),
      size_bytes: fileSize,
      tiktok_video_id: tiktokVideoId || undefined,
      tiktok_status: (tiktokStatus === "mock" ? "mock" : (tiktokStatus === "published" ? "published" : undefined)) as any,
      images: product.images || [],
      scene_images: activeSceneImages,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let existing: any[] = [];
    try {
      if (existsSync(metaFile)) {
        const raw = await fs.readFile(metaFile, "utf-8");
        existing = JSON.parse(raw);
      }
    } catch { existing = []; }

    // Deduplicate: remove any temporary vid_sync entry created while the pipeline was uploading/processing
    const baseTargetName = veoResult.localPath ? path.basename(veoResult.localPath) : "";
    existing = existing.filter(item => {
      if (item.id && item.id.startsWith("vid_sync_")) {
        const itemLocal = item.local_path ? path.resolve(item.local_path) : "";
        const targetLocal = veoResult.localPath ? path.resolve(veoResult.localPath) : "";
        if (itemLocal && targetLocal && itemLocal === targetLocal) return false;
        if (baseTargetName && item.s3_url && item.s3_url.includes(baseTargetName)) return false;
        if (baseTargetName && item.local_path && item.local_path.includes(baseTargetName)) return false;
      }
      return true;
    });

    existing.unshift(entry);
    await fs.writeFile(metaFile, JSON.stringify(existing, null, 2), "utf-8");
    console.log(`📄 [Pipeline] Metadata saved to data/metadata.json (id: ${metadataId}, s3_url: ${finalVideoUrl})`);

    if (publishTikTok && s3Url) {
      console.log(`\n📱 [Pipeline 4/4] Publishing to TikTok...`);
      tiktokVideoId = `mock_${Date.now()}`;
      tiktokStatus = "mock";
    }

    const result: PipelineResult = {
      product_id: product.id,
      product_name: product.name,
      success: true,
      prompt: mergedPromptStr,
      local_path: uploadToS3 ? "(deleted after S3 upload)" : veoResult.localPath,
      scene_images: activeSceneImages,
      s3_url: s3Url,
      s3_key: s3Key,
      metadata_id: metadataId,
      tiktok_video_id: tiktokVideoId,
      tiktok_status: tiktokStatus,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    };

    console.log(`\n✅ [Pipeline] COMPLETED: ${product.name}`);
    console.log(`   S3: ${s3Url || "(skipped)"}`);
    console.log(`   TikTok: ${tiktokVideoId || "(skipped)"}`);
    return result;

  } catch (err: any) {
    console.error(`\n❌ [Pipeline] FAILED for ${product.name}: ${err.message}`);
    
    // Keep all generated segments and temp files on failure to allow manual recovery or troubleshooting
    console.log("ℹ️  [Pipeline] Kept temporary files on failure for debugging/manual merge.");
    return {
      product_id: product.id,
      product_name: product.name,
      success: false,
      error: err.message,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
    };
  }
}

export async function runAllProducts(options = {}): Promise<PipelineResult[]> {
  if (isRunning) {
    console.warn("⚠️  [Scheduler] Pipeline already running, skipping this trigger");
    return [];
  }

  isRunning = true;
  lastRunResults = [];

  try {
    const products = await loadProducts();
    console.log(`\n🗓️  [Scheduler] Starting run for ${products.length} product(s)...`);

    for (const product of products) {
      const result = await runPipelineForProduct(product, options);
      lastRunResults.push(result);

      // Wait 10 seconds between products to avoid rate limiting
      if (products.indexOf(product) < products.length - 1) {
        console.log("⏸️  Waiting 10 seconds before next product...");
        await new Promise((resolve) => setTimeout(resolve, 10_000));
      }
    }

    console.log(`\n🏁 [Scheduler] Run complete — ${products.length} product(s) processed`);
    return lastRunResults;
  } finally {
    isRunning = false;
  }
}

export async function initDailyCleanupCron() {
  let cron: any;
  try {
    // @ts-ignore
    cron = (await import("node-cron")).default;
  } catch {
    console.warn("⚠️  [CleanupCron] node-cron not installed — daily cleanup cron disabled.");
    return null;
  }

  console.log("⏰ [CleanupCron] Initializing daily video cleanup cron job for 10:00 AM UTC+7 (Asia/Ho_Chi_Minh)...");
  
  // Schedule at 10:00 AM every day in Asia/Ho_Chi_Minh timezone (UTC+7)
  const job = cron.schedule("0 10 * * *", async () => {
    console.log(`\n🧹 [CleanupCron 10:00 AM UTC+7] Starting scheduled cleanup of old video segments & temp files...`);
    const downloadsDir = path.resolve(__dirname, "../data/downloads");
    if (!existsSync(downloadsDir)) return;

    try {
      const files = await fs.readdir(downloadsDir);
      let deletedCount = 0;
      const now = Date.now();
      const sixHoursAgo = now - 6 * 60 * 60 * 1000;

      for (const item of files) {
        const itemPath = path.join(downloadsDir, item);
        try {
          const stats = await fs.stat(itemPath);
          const isOlderThan12h = stats.mtimeMs < (now - 12 * 60 * 60 * 1000);

          if (stats.isDirectory()) {
            if (isOlderThan12h) {
              await fs.rm(itemPath, { recursive: true, force: true });
              deletedCount++;
              console.log(`🗑️  [CleanupCron] Deleted old render folder: ${item}`);
            }
          } else {
            const isTempSegmentOrAsset = 
              item.includes("_part") || 
              item.includes("_frame") || 
              item.startsWith("tts_") || 
              item.startsWith("gemini_upload_") || 
              item.endsWith("_voiced.mp4") ||
              item.endsWith("_sub.png") ||
              item.endsWith(".txt");

            if (isTempSegmentOrAsset && isOlderThan12h) {
              await fs.unlink(itemPath);
              deletedCount++;
              console.log(`🗑️  [CleanupCron] Deleted old file: ${item}`);
            }
          }
        } catch {}
      }
      console.log(`✅ [CleanupCron 10:00 AM UTC+7] Scheduled cleanup completed. Total files deleted: ${deletedCount}\n`);
    } catch (err: any) {
      console.error(`❌ [CleanupCron] Cleanup error: ${err.message}`);
    }
  }, {
    scheduled: true,
    timezone: "Asia/Ho_Chi_Minh"
  });

  return job;
}

export async function startScheduler() {
  // Initialize 10:00 AM daily cleanup job
  await initDailyCleanupCron();

  // Dynamic import node-cron
  let cron: any;
  try {
    // @ts-ignore
    cron = (await import("node-cron")).default;
  } catch {
    console.warn("⚠️  [Scheduler] node-cron not installed — scheduler disabled. Run: npm install node-cron");
    return [];
  }

  const cronExpressions = (process.env.CRON_SCHEDULE || "0 8,12,18 * * *").split(";");

  console.log("\n⏰ [Scheduler] Starting cron jobs:");

  for (const expr of cronExpressions) {
    const trimmed = expr.trim();
    if (!cron.validate(trimmed)) {
      console.warn(`⚠️  [Scheduler] Invalid cron expression: "${trimmed}"`);
      continue;
    }

    const job = cron.schedule(trimmed, async () => {
      console.log(`\n⏰ [Scheduler] Cron triggered at ${new Date().toISOString()}`);
      await runAllProducts();
    });

    scheduledJobs.push(job);
    console.log(`   ✅ Registered cron: "${trimmed}"`);
  }

  console.log("   Scheduler running in background...\n");
  return scheduledJobs;
}

export function stopScheduler() {
  scheduledJobs.forEach((job) => job.stop());
  scheduledJobs = [];
  console.log("⛔ [Scheduler] All cron jobs stopped");
}

/**
 * Scans a product's job folder, picks the newest video file for each available part (part1..part6),
 * concatenates them in order 1..6 into a merged video, extracts thumbnail, uploads to S3, and saves metadata.
 */
export async function mergeJobVideoSegments(
  productSlug: string,
  jobFolder?: string,
  product?: any,
  uploadToS3: boolean = true,
  publishTikTok: boolean = false,
  episodesConfig?: EpisodeDefinition[]
): Promise<PipelineResult> {
  const startTime = Date.now();
  const startedAt = new Date().toISOString();
  const activeJobFolder = jobFolder || productSlug;
  const downloadsDir = path.resolve(__dirname, `../data/downloads/${activeJobFolder}`);

  if (!existsSync(downloadsDir)) {
    throw new Error(`Directory not found: ${downloadsDir}`);
  }

  // 1. Find all video segment files in downloadsDir
  const allFiles = await fs.readdir(downloadsDir);
  const partMap: Map<number, { filename: string; fullPath: string; mtimeMs: number }> = new Map();
  const voicedPartMap: Map<number, { filename: string; fullPath: string; mtimeMs: number }> = new Map();

  let activeVersions: Record<string, string> = {};
  const activeVersionsFile = path.join(downloadsDir, "active_versions.json");
  if (existsSync(activeVersionsFile)) {
    try {
      activeVersions = JSON.parse(await fs.readFile(activeVersionsFile, "utf-8"));
    } catch {}
  }

  for (const file of allFiles) {
    if (!file.endsWith(".mp4") || file.includes("_merged") || file.includes(".orig") || file.includes(".bak")) continue;
    const match = file.match(/_part(\d+)_/i);
    if (!match) continue;
    const partNum = parseInt(match[1], 10);
    const fullPath = path.join(downloadsDir, file);
    const stat = statSync(fullPath);

    if (file.includes("_voiced")) {
      const existing = voicedPartMap.get(partNum);
      if (!existing || stat.mtimeMs > existing.mtimeMs) {
        voicedPartMap.set(partNum, { filename: file, fullPath, mtimeMs: stat.mtimeMs });
      }
    } else {
      const explicitFile = activeVersions[`part${partNum}`];
      if (explicitFile && explicitFile === file) {
        // Chosen explicitly by user: highest priority
        partMap.set(partNum, { filename: file, fullPath, mtimeMs: Infinity });
      } else {
        const existing = partMap.get(partNum);
        if (!existing || (existing.mtimeMs !== Infinity && stat.mtimeMs > existing.mtimeMs)) {
          partMap.set(partNum, { filename: file, fullPath, mtimeMs: stat.mtimeMs });
        }
      }
    }
  }

  const sortedParts = Array.from(partMap.keys()).sort((a, b) => a - b);
  if (sortedParts.length === 0) {
    throw new Error(`Không tìm thấy file video phân cảnh nào (dạng *_part1_*.mp4) trong thư mục: ${downloadsDir}`);
  }

  const segmentFiles = sortedParts.map(p => partMap.get(p)!.fullPath);
  console.log(`\n🎬 [MergeJob] Found ${segmentFiles.length} original Gemini part video(s) for ${productSlug}:`, sortedParts.map(p => `Part ${p}`));

  // 2. Merged Video Path: BẢN GỐC (Giữ trọn vẹn 100% giọng & âm thanh do Gemini tạo)
  const mergedFilename = `${productSlug}_merged.mp4`;
  const mergedVideoPath = path.join(downloadsDir, mergedFilename);
  console.log(`🎬 [MergeJob] Concatenating ${segmentFiles.length} original Gemini segments with FFmpeg into: ${mergedVideoPath}`);
  await mergeVideoSegments(segmentFiles, mergedVideoPath);
  console.log(`✅ [MergeJob] Created Merged Video (Bản gốc Gemini): ${mergedVideoPath}`);

  // 2.5. Merged Voiced Path: BẢN LỒNG TIẾNG ĐI KÈM
  const voicedFilename = `${productSlug}_voiced.mp4`;
  const potentialVoicedPath = path.join(downloadsDir, voicedFilename);
  let voicedVideoPath: string | null = null;

  if (voicedPartMap.size > 0) {
    const voicedSegmentFiles = sortedParts.map(p => voicedPartMap.get(p)?.fullPath || partMap.get(p)!.fullPath);
    console.log(`🎙️ [MergeJob] Ghép ${voicedSegmentFiles.length} phân cảnh lồng tiếng đi kèm vào: ${potentialVoicedPath}`);
    await mergeVideoSegments(voicedSegmentFiles, potentialVoicedPath);
    voicedVideoPath = potentialVoicedPath;
    console.log(`✅ [MergeJob] Đã tạo Bản Lồng Tiếng Đi Kèm: ${potentialVoicedPath}`);
  } else if (existsSync(potentialVoicedPath)) {
    voicedVideoPath = potentialVoicedPath;
    console.log(`ℹ️ [MergeJob] Đã tìm thấy Bản Lồng Tiếng Đi Kèm có sẵn: ${potentialVoicedPath}`);
  }

  // 2.7. Process Episode Cuts if specified or found in product metadata
  const effectiveEpisodes: EpisodeDefinition[] = (episodesConfig && episodesConfig.length > 0)
    ? episodesConfig
    : (Array.isArray(product?.episodes) && product.episodes.length > 0)
      ? product.episodes
      : (Array.isArray(product?.promptsObj?.episodes) && product.promptsObj.episodes.length > 0)
        ? product.promptsObj.episodes
        : [];

  const generatedEpisodes: GeneratedEpisode[] = [];
  if (effectiveEpisodes.length > 0) {
    console.log(`\n✂️ [MergeJob] Generating ${effectiveEpisodes.length} episode cut(s) for ${productSlug}...`);
    for (let idx = 0; idx < effectiveEpisodes.length; idx++) {
      const ep = effectiveEpisodes[idx];
      const startScene = Number(ep.startScene) || 1;
      const endScene = Number(ep.endScene) || sortedParts[sortedParts.length - 1];
      const epParts = sortedParts.filter(p => p >= startScene && p <= endScene);
      if (epParts.length === 0) {
        console.warn(`⚠️ [MergeJob] Episode "${ep.title}" has no matching parts in range [${startScene}..${endScene}]`);
        continue;
      }

      const epSegmentFiles = epParts.map(p => partMap.get(p)!.fullPath);
      const epId = ep.id || `ep${idx + 1}`;
      const epFilename = `${productSlug}_${epId}.mp4`;
      const epVideoPath = path.join(downloadsDir, epFilename);

      console.log(`🎬 [MergeJob] Exporting Episode "${ep.title}" (Parts ${epParts.join(', ')}) -> ${epVideoPath}`);
      try {
        await mergeVideoSegments(epSegmentFiles, epVideoPath);

        let epVoicedPath: string | null = null;
        let epVoicedUrl: string | null = null;
        if (voicedPartMap.size > 0) {
          const epVoicedSegmentFiles = epParts.map(p => voicedPartMap.get(p)?.fullPath || partMap.get(p)!.fullPath);
          const epVoicedFilename = `${productSlug}_${epId}_voiced.mp4`;
          const potentialVoicedPath = path.join(downloadsDir, epVoicedFilename);
          await mergeVideoSegments(epVoicedSegmentFiles, potentialVoicedPath);
          epVoicedPath = potentialVoicedPath;
          epVoicedUrl = `/downloads/${activeJobFolder}/${epVoicedFilename}`;
        }

        generatedEpisodes.push({
          id: epId,
          title: ep.title || `Tập ${idx + 1}`,
          startScene,
          endScene,
          filename: epFilename,
          local_path: epVideoPath,
          video_url: `/downloads/${activeJobFolder}/${epFilename}`,
          voiced_path: epVoicedPath,
          voiced_url: epVoicedUrl,
        });
      } catch (epErr: any) {
        console.error(`❌ [MergeJob] Error creating Episode "${ep.title}": ${epErr.message}`);
      }
    }
    console.log(`✅ [MergeJob] Successfully created ${generatedEpisodes.length} Episode cuts!`);
  }

  // 3. Extract thumbnail
  const mergedThumbFilename = `${productSlug}_thumb.jpg`;
  const mergedThumbPath = path.join(downloadsDir, mergedThumbFilename);
  const thumbSuccess = await extractThumbnailWithFfmpeg(mergedVideoPath, mergedThumbPath);

  // 4. Resolve product metadata
  const prodName = product?.name || productSlug;
  const prodId = product?.id || `prod_${Date.now()}`;
  let s3Url = "";
  let s3Key = "";
  let s3ThumbUrl = "";
  let voicedS3Url = "";
  let metadataId = `vid_${Date.now()}`;
  let tiktokVideoId = "";
  let tiktokStatus = "skipped";
  const fileSize = existsSync(mergedVideoPath) ? statSync(mergedVideoPath).size : 0;

  // 5. Upload to S3 if configured
  if (uploadToS3 && process.env.AWS_ACCESS_KEY_ID && process.env.S3_BUCKET_NAME) {
    try {
      console.log(`\n☁️  [MergeJob] Uploading merged video to S3...`);
      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { createReadStream } = await import("fs");

      const s3 = new S3Client({
        region: process.env.AWS_REGION || "ap-southeast-1",
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
        },
      });

      const bucket = process.env.S3_BUCKET_NAME;
      const prefix = (process.env.S3_KEY_PREFIX || "videos/").replace(/\/$/, "");
      s3Key = `${prefix}/${mergedFilename}`;

      const fileStream = createReadStream(mergedVideoPath);
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: s3Key,
        Body: fileStream,
        ContentType: "video/mp4",
        ContentLength: fileSize,
        Metadata: {
          product_id: prodId,
          product_name: encodeURIComponent(prodName),
        },
      }));

      s3Url = `https://${bucket}.s3.${process.env.AWS_REGION || "ap-southeast-1"}.amazonaws.com/${s3Key}`;
      console.log(`✅ [MergeJob] Uploaded to S3: ${s3Url}`);

      // Upload voiced video to S3 if present
      if (voicedVideoPath && existsSync(voicedVideoPath)) {
        try {
          const voicedKey = `${prefix}/${path.basename(voicedVideoPath)}`;
          const voicedStream = createReadStream(voicedVideoPath);
          const voicedSize = statSync(voicedVideoPath).size;
          await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: voicedKey,
            Body: voicedStream,
            ContentType: "video/mp4",
            ContentLength: voicedSize,
            Metadata: {
              product_id: prodId,
              product_name: encodeURIComponent(prodName),
              type: "voiced",
            },
          }));
          voicedS3Url = `https://${bucket}.s3.${process.env.AWS_REGION || "ap-southeast-1"}.amazonaws.com/${voicedKey}`;
          console.log(`✅ [MergeJob] Uploaded Voiced Video to S3: ${voicedS3Url}`);
        } catch (voicedErr: any) {
          console.warn(`⚠️ [MergeJob] Voiced video S3 upload warning: ${voicedErr.message}`);
        }
      }

      if (thumbSuccess && existsSync(mergedThumbPath)) {
        const s3ThumbKey = `${prefix}/${mergedThumbFilename}`;
        const thumbStream = createReadStream(mergedThumbPath);
        const thumbSize = statSync(mergedThumbPath).size;

        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: s3ThumbKey,
          Body: thumbStream,
          ContentType: "image/jpeg",
          ContentLength: thumbSize,
          Metadata: {
            product_id: prodId,
            type: "thumbnail",
          },
        }));
        s3ThumbUrl = `https://${bucket}.s3.${process.env.AWS_REGION || "ap-southeast-1"}.amazonaws.com/${s3ThumbKey}`;
      }
    } catch (s3Err: any) {
      console.warn(`⚠️ [MergeJob] S3 upload skipped/failed (${s3Err.message}). Using local video path.`);
    }
  }

  const localStreamUrl = `/downloads/${activeJobFolder}/${mergedFilename}`;
  const finalVideoUrl = s3Url || localStreamUrl;

  const localVoicedStreamUrl = voicedVideoPath ? `/downloads/${activeJobFolder}/${path.basename(voicedVideoPath)}` : null;
  const finalVoicedUrl = voicedS3Url || localVoicedStreamUrl;

  // 6. Save metadata
  const metaFile = path.resolve(__dirname, "../data/metadata.json");
  const entry = {
    id: metadataId,
    title: prodName,
    description: product?.description || "",
    prompt: product?.promptsObj ? JSON.stringify(product.promptsObj) : "",
    tags: product?.hashtags || [],
    source_url: finalVideoUrl,
    s3_url: finalVideoUrl,
    s3_key: s3Key,
    s3_bucket: process.env.S3_BUCKET_NAME || "",
    local_path: mergedVideoPath,
    voiced_path: voicedVideoPath || undefined,
    voiced_url: finalVoicedUrl || undefined,
    thumbnail_url: s3ThumbUrl || product?.image_url || `/downloads/${activeJobFolder}/${mergedThumbFilename}`,
    size_bytes: fileSize,
    tiktok_video_id: tiktokVideoId || undefined,
    tiktok_status: (tiktokStatus === "mock" ? "mock" : undefined) as any,
    images: product?.images || [],
    episodes: generatedEpisodes.length > 0 ? generatedEpisodes : undefined,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let existingMeta: any[] = [];
  try {
    if (existsSync(metaFile)) {
      const raw = await fs.readFile(metaFile, "utf-8");
      existingMeta = JSON.parse(raw);
    }
  } catch { existingMeta = []; }

  existingMeta = existingMeta.filter(item => {
    if (item.local_path && path.resolve(item.local_path) === path.resolve(mergedVideoPath)) return false;
    return true;
  });
  existingMeta.unshift(entry);
  await fs.writeFile(metaFile, JSON.stringify(existingMeta, null, 2), "utf-8");

  return {
    product_id: prodId,
    product_name: prodName,
    success: true,
    local_path: mergedVideoPath,      // Bản gốc giữ 100% âm thanh & giọng do Gemini tạo
    video_url: finalVideoUrl,
    voiced_path: voicedVideoPath,     // Bản lồng tiếng đi kèm
    voiced_url: finalVoicedUrl,
    episodes: generatedEpisodes,
    s3_url: s3Url,
    s3_key: s3Key,
    metadata_id: metadataId,
    tiktok_video_id: tiktokVideoId,
    tiktok_status: tiktokStatus,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    duration_ms: Date.now() - startTime,
  };
}
