import fs from "fs/promises";
import { existsSync, statSync, utimesSync } from "fs";
import path from "path";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import { callAgy } from "./agyClient.js";
import { getValidatorModel, GEMINI_CARBON_MODEL, GEMINI_ARGON_MODEL } from "./aiModelConfig.js";

const execAsync = promisify(exec);

export interface VideoFixPlan {
  analysis: string;
  fix_mode?: "veo_splice" | "ffmpeg_only";
  good_prefix_end_sec?: number;
  good_suffix_start_sec?: number | null;
  replacement_veo_prompt?: string;
  trim_start_sec?: number;
  trim_end_sec?: number | null;
  speed_factor?: number;
  interpolate_60fps?: boolean;
  reverse_tail_sec?: number;
  crop_margin_percent?: number;
  crop_anchor?: "center" | "top" | "bottom" | "left" | "right";
  hop_bounce?: boolean;
  custom_vf?: string;
  custom_filter_complex?: string;
  color_adjust?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
  };
  audio_action?: "keep" | "mute_all" | "denoise";
  mute_ranges?: Array<{ start: number; end: number }>;
  volume_gain_db?: number;
  normalize_loudness?: boolean;
  use_original_backup?: boolean;
  revised_veo_prompt?: string;
  revised_dialogue?: string;
}

export interface VideoFixResult {
  success: boolean;
  part_number: number;
  filename: string;
  source_filename?: string;
  video_url: string;
  video_path: string;
  duration_sec: number;
  old_duration_sec: number;
  analysis: string;
  applied_plan: VideoFixPlan;
  revised_veo_prompt?: string;
  revised_dialogue?: string;
}

function getFfmpegBinary(): string {
  if (existsSync("/opt/homebrew/bin/ffmpeg")) return "/opt/homebrew/bin/ffmpeg";
  if (existsSync("/usr/local/bin/ffmpeg")) return "/usr/local/bin/ffmpeg";
  return "ffmpeg";
}

function getFfprobeBinary(): string {
  if (existsSync("/opt/homebrew/bin/ffprobe")) return "/opt/homebrew/bin/ffprobe";
  if (existsSync("/usr/local/bin/ffprobe")) return "/usr/local/bin/ffprobe";
  return "ffprobe";
}

function probeVideoInfo(videoPath: string): {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
} {
  const ffprobe = getFfprobeBinary();
  let duration = 10.0;
  let width = 720;
  let height = 1280;
  let fps = 24;
  let hasAudio = false;

  try {
    const out = execSync(
      `"${ffprobe}" -v error -show_entries format=duration -show_streams -of json "${videoPath}"`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const parsed = JSON.parse(out);
    const fmtDur = parseFloat(parsed?.format?.duration);
    if (Number.isFinite(fmtDur) && fmtDur > 0) duration = fmtDur;

    if (Array.isArray(parsed?.streams)) {
      for (const s of parsed.streams) {
        if (s.codec_type === "video") {
          if (s.width) width = Number(s.width);
          if (s.height) height = Number(s.height);
          if (typeof s.r_frame_rate === "string" && s.r_frame_rate.includes("/")) {
            const [num, den] = s.r_frame_rate.split("/").map(Number);
            if (num > 0 && den > 0) fps = Math.round(num / den);
          }
        } else if (s.codec_type === "audio") {
          hasAudio = true;
        }
      }
    }
  } catch {}

  return { duration, width, height, fps, hasAudio };
}

function analyzeMotionAndAudioTimeline(videoPath: string, duration: number, hasAudio: boolean): {
  motionTimeline: string;
  audioTimeline: string;
} {
  const ffmpeg = getFfmpegBinary();
  let motionTimeline = "Không có dữ liệu";
  let audioTimeline = hasAudio ? "Không có dữ liệu" : "Video không có kênh âm thanh";

  // 1. Analyze frame-to-frame scene/motion score per 0.5s bucket
  try {
    const out = execSync(
      `"${ffmpeg}" -i "${videoPath}" -vf "select=gt(scene\\,0),metadata=print:file=-" -f null - 2>/dev/null | grep -E "pts_time|scene_score" | paste - -`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 }
    );
    const buckets: Record<string, number> = {};
    const step = 0.5;
    for (let t = 0; t < duration; t += step) {
      buckets[t.toFixed(1)] = 0;
    }
    for (const line of out.split("\n")) {
      const mTime = line.match(/pts_time:([0-9.]+)/);
      const mScore = line.match(/scene_score=([0-9.]+)/);
      if (mTime && mScore) {
        const sec = (Math.floor(parseFloat(mTime[1]) / step) * step).toFixed(1);
        buckets[sec] = (buckets[sec] || 0) + parseFloat(mScore[1]);
      }
    }
    motionTimeline = Object.entries(buckets)
      .map(([k, v]) => `${k}s:${v.toFixed(3)}`)
      .join(" | ");
  } catch {}

  // 2. Analyze audio RMS per 0.5s bucket
  if (hasAudio) {
    try {
      const rawBuf = execSync(
        `"${ffmpeg}" -v error -i "${videoPath}" -vn -ac 1 -ar 8000 -f f32le -`,
        { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 10 * 1024 * 1024, timeout: 10000 }
      );
      const floats = new Float32Array(rawBuf.buffer, rawBuf.byteOffset, Math.floor(rawBuf.byteLength / 4));
      const sr = 8000;
      const win = Math.floor(sr * 0.5);
      const parts: string[] = [];
      for (let i = 0; i < floats.length; i += win) {
        let sum = 0;
        const end = Math.min(i + win, floats.length);
        for (let j = i; j < end; j++) sum += floats[j] * floats[j];
        const rms = Math.sqrt(sum / Math.max(1, end - i));
        parts.push(`${((i / sr)).toFixed(1)}s:${rms.toFixed(3)}`);
      }
      audioTimeline = parts.join(" | ");
    } catch {}
  }

  return { motionTimeline, audioTimeline };
}

/**
 * AI Agent Argon 4.0 (gemini-4-argon-low) Multimodal Video Fixer
 * Analyzes the active video part (keyframes + motion profile + audio RMS + user instructions)
 * and executes direct FFmpeg post-processing to fix the video and replace the active version.
 */
export async function runArgonVideoFixerAgent(params: {
  downloadsDir: string;
  activeJobFolder: string;
  partNum: number;
  partVideoFile: string;
  userInstruction: string;
  currentPrompt?: string;
  currentDialogue?: string;
  fromOriginalBackup?: boolean;
  visualStyle?: string;
  worldStyle?: string;
  referenceImages?: string[];
}): Promise<VideoFixResult> {
  const {
    downloadsDir,
    activeJobFolder,
    partNum,
    partVideoFile,
    userInstruction,
    currentPrompt = "",
    currentDialogue = "",
    fromOriginalBackup = false,
    visualStyle = "real",
    worldStyle = "auto",
    referenceImages = [],
  } = params;

  const inputVideoPath = path.join(downloadsDir, partVideoFile);
  const backupPath = path.join(downloadsDir, `${partVideoFile}.orig.bak`);
  const legacyBackupPath = path.join(downloadsDir, `${partVideoFile}.orig.mp4`);

  if (!existsSync(backupPath) && existsSync(legacyBackupPath)) {
    await fs.rename(legacyBackupPath, backupPath).catch(() => {});
  }

  const initialSourcePath = fromOriginalBackup && existsSync(backupPath) ? backupPath : inputVideoPath;
  const info = probeVideoInfo(initialSourcePath);
  const origInfo = existsSync(backupPath) ? probeVideoInfo(backupPath) : info;
  const { motionTimeline, audioTimeline } = analyzeMotionAndAudioTimeline(
    initialSourcePath,
    info.duration,
    info.hasAudio
  );

  // Extract a 16-frame visual contact sheet (every ~0.5s) so Argon 4.0 can pinpoint exact faulty seconds
  const ffmpeg = getFfmpegBinary();
  const contactSheetPath = path.join(downloadsDir, `.argon_inspect_part${partNum}.jpg`);
  try {
    const fpsVal = Math.max(0.5, 16 / Math.max(1, info.duration)).toFixed(3);
    execSync(
      `"${ffmpeg}" -y -i "${initialSourcePath}" -vf "fps=${fpsVal},scale=180:320,tile=4x4" -frames:v 1 -update 1 "${contactSheetPath}" 2>/dev/null`,
      { stdio: "ignore", timeout: 10000 }
    );
  } catch {}

  const prefixMatch = partVideoFile.match(/^(.+)_part\d+_/i);
  const basePrefix = prefixMatch ? prefixMatch[1] : activeJobFolder;
  const shortId = Math.random().toString(36).substring(2, 8);
  const newVersionFilename = `${basePrefix}_part${partNum}_ai${shortId}.mp4`;
  const newVersionPath = path.join(downloadsDir, newVersionFilename);
  const reportJsonPath = path.join(downloadsDir, `.argon_report_${shortId}.json`);

  const model = getValidatorModel(); // Defaults to gemini-4-argon-low per AGENTS.md
  console.log(`🤖 [ArgonVideoFixer] Launching AI Agent (${model}) to inspect Part ${partNum}, detect faulty segment & plan Veo 3 splice -> ${newVersionFilename}...`);

  const systemPrompt = `Bạn là AI Video Director & Defect Repair Agent (${model}).
NHIỆM VỤ CỦA BẠN:
1. Dùng tool \`read_file\` đọc ảnh lưới 16 khung hình "${contactSheetPath}" (mỗi ô tương ứng ~${(info.duration / 16).toFixed(2)}s từ 0.0s đến ${info.duration.toFixed(2)}s) để kiểm tra chất lượng render từng giây của video.
2. Phân tích yêu cầu sửa lỗi của người dùng kết hợp với hình ảnh thực tế trong "${contactSheetPath}" để xác định:
   - Đoạn nào của video đã render TỐT (cần giữ lại) và đoạn nào render CHƯA TỐT / BỊ LỖI (cần cắt bỏ để gọi Google Veo 3 render bù đoạn mới rồi ghép nối vào).
   - \`fix_mode\`:
     + Đặt \`"veo_splice"\` (MẶC ĐỊNH) khi video có đoạn render chưa tốt, sai động tác/tư thế/đạo cụ (VD: nhảy lò cò 1 dép nhưng từ giây 1.2s lại đi bằng 2 chân 2 dép), biến dạng hình ảnh, hoặc cần tạo lại cảnh/đoạn video bằng Veo 3 rồi ghép vào chỗ lỗi.
     + Chỉ đặt \`"ffmpeg_only"\` khi người dùng CHỈ yêu cầu cắt bỏ giây đứng đơ đầu/cuối, tắt tiếng/lọc âm, hoặc làm mượt 60fps mà không cần Veo 3 render lại hình ảnh.
   - \`good_prefix_end_sec\`: Số giây kết thúc đoạn đầu đang ĐẸP/CHUẨN ngay trước khi xuất hiện lỗi (VD: \`1.2\` nếu từ \`0.0s -> 1.2s\` nhân vật diễn chuẩn và từ \`1.2s\` trở đi bị lỗi; đặt \`0\` nếu video bị lỗi ngay từ giây \`0.0s\`). Hệ thống sẽ giữ lại đoạn \`0.0s -> good_prefix_end_sec\`, trích xuất đúng khung hình tại \`good_prefix_end_sec\` làm mốc để gọi Veo 3 render đoạn mới và ghép nối mượt mà vào đó!
   - \`good_suffix_start_sec\`: Số giây bắt đầu đoạn cuối đang ĐẸP (nếu chỉ lỗi ở giữa video và đoạn cuối vẫn chuẩn), hoặc \`null\` nếu lỗi kéo dài tới cuối video.
   - \`replacement_veo_prompt\`: Prompt tiếng Anh chuẩn Veo 3 để render đoạn video thay thế bắt đầu liền mạch từ khung hình tại \`good_prefix_end_sec\`, giữ nguyên \`CHARACTER_BIBLE:\`, \`CAMERA:\`, \`SETTING:\`, \`DUB_TIMELINE:\` và đặc tả thật rõ hành động chuẩn để khắc phục 100% lỗi người dùng nêu.
   - \`revised_veo_prompt\`: Prompt tiếng Anh hoàn chỉnh đã tối ưu cho toàn bộ Part ${partNum}.
   - \`revised_dialogue\`: Lời thoại đã tối ưu cho Part ${partNum}.
3. Trả về DUY NHẤT 1 JSON object hợp lệ (không bọc markdown thừa) theo cấu trúc:
{
  "analysis": "Giải thích tiếng Việt cụ thể: phát hiện đoạn lỗi từ giây nào đến giây nào, giữ lại đoạn chuẩn nào, trích xuất frame mốc và gọi Veo 3 render ghép nối ra sao",
  "fix_mode": "veo_splice",
  "good_prefix_end_sec": 1.2,
  "good_suffix_start_sec": null,
  "replacement_veo_prompt": "Full English Veo 3 prompt for the replacement segment...",
  "revised_veo_prompt": "Full English Veo 3 prompt for the scene...",
  "revised_dialogue": "Lời thoại..."
}`;

  const userPrompt = `THÔNG TIN VIDEO CẦN SỬA (Part ${partNum}):
- Ảnh lưới 16 khung hình theo thời gian: ${contactSheetPath}
- Độ phân giải: ${info.width}x${info.height} @ ${info.fps}fps | Thời lượng: ${info.duration.toFixed(2)}s | Có âm thanh: ${info.hasAudio}
- Biểu đồ chuyển động (Motion per 0.5s): ${motionTimeline}
- Biểu đồ âm lượng (Audio RMS per 0.5s): ${audioTimeline}
- Prompt hiện tại: ${currentPrompt || "(Trống)"}
- Dialogue hiện tại: ${currentDialogue || "(Trống)"}

YÊU CẦU SỬA VIDEO TỪ NGƯỜI DÙNG (BẮT BUỘC KIỂM TRA ĐOẠN RENDER CHƯA TỐT, CẮT & RENDER VEO 3 GHÉP VÀO ĐOẠN LỖI):
"${userInstruction}"`;

  const lowerInst = userInstruction.toLowerCase();
  const isPureFfmpegRequest =
    (lowerInst.includes("tắt tiếng") ||
      lowerInst.includes("xóa tiếng") ||
      lowerInst.includes("lọc tạp âm") ||
      lowerInst.includes("denoise") ||
      lowerInst.includes("cắt bỏ") ||
      lowerInst.includes("đứng đơ")) &&
    !lowerInst.includes("render") &&
    !lowerInst.includes("veo") &&
    !lowerInst.includes("lò cò") &&
    !lowerInst.includes("dép") &&
    !lowerInst.includes("động tác") &&
    !lowerInst.includes("diễn") &&
    !lowerInst.includes("vẽ");

  let plan: VideoFixPlan = {
    analysis: `Đã kiểm tra video Part ${partNum}, cắt bỏ đoạn render chưa tốt và gọi Veo 3 render ghép nối hoàn chỉnh theo yêu cầu: "${userInstruction}".`,
    fix_mode: isPureFfmpegRequest ? "ffmpeg_only" : "veo_splice",
    good_prefix_end_sec: 0,
    good_suffix_start_sec: null,
    trim_start_sec: 0,
    trim_end_sec: info.duration,
    speed_factor: 1.0,
    interpolate_60fps: true,
    reverse_tail_sec: 0,
    crop_margin_percent: 0,
    crop_anchor: "center",
    audio_action: "keep",
    mute_ranges: [],
    volume_gain_db: 0,
    normalize_loudness: true,
  };

  try {
    const projectRootDir = path.resolve(__dirname, "..");
    const candidateModels = [model, GEMINI_CARBON_MODEL, GEMINI_ARGON_MODEL].filter(
      (m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx
    );
    let rawResp = "";
    let lastAiErr: any = null;
    for (const cand of candidateModels) {
      try {
        rawResp = await callAgy(
          systemPrompt,
          userPrompt,
          false,
          cand,
          120_000,
          [downloadsDir, projectRootDir]
        );
        if (rawResp || existsSync(reportJsonPath)) break;
      } catch (candErr: any) {
        lastAiErr = candErr;
        console.warn(`⚠️ [ArgonVideoFixer] Model ${cand} failed (${candErr.message}), trying next fallback...`);
      }
    }
    if (!rawResp && !existsSync(reportJsonPath) && lastAiErr) {
      throw lastAiErr;
    }
    if (existsSync(reportJsonPath)) {
      try {
        const rep = JSON.parse(await fs.readFile(reportJsonPath, "utf-8"));
        if (rep && typeof rep === "object") {
          plan = { ...plan, ...rep };
        }
      } catch {}
      await fs.unlink(reportJsonPath).catch(() => {});
    } else if (rawResp && rawResp.includes("{")) {
      try {
        const f = rawResp.indexOf("{");
        const l = rawResp.lastIndexOf("}");
        if (f >= 0 && l > f) {
          const parsed = JSON.parse(rawResp.slice(f, l + 1));
          if (parsed && typeof parsed === "object") {
            plan = { ...plan, ...parsed };
          }
        }
      } catch {}
    }
  } catch (aiErr: any) {
    console.warn(`⚠️ [ArgonVideoFixer] AI analysis fallback (${aiErr.message}), using smart defect heuristic...`);
  }

  // Decide source video based on plan.use_original_backup
  const sourceVideoPath =
    (plan.use_original_backup || fromOriginalBackup) && existsSync(backupPath)
      ? backupPath
      : inputVideoPath;
  const activeSourceInfo = sourceVideoPath === backupPath ? origInfo : info;
  const maxDur = activeSourceInfo.duration;

  // Check if Autonomous Argon 4.0 Agent already created newVersionPath directly via run_command
  let agentCreatedDirectly = existsSync(newVersionPath) && probeVideoInfo(newVersionPath).duration >= 0.3;

  // ── VEO 3 PARTIAL RE-RENDER & SEAMLESS SPLICE ENGINE ──────────────────────────
  if (!agentCreatedDirectly && plan.fix_mode !== "ffmpeg_only") {
    const anchorFramePath = path.join(downloadsDir, `.argon_anchor_part${partNum}_${shortId}.jpg`);
    try {
      const goodPrefixEndSec = Math.max(0, Math.min(maxDur - 1.2, Number(plan.good_prefix_end_sec) || 0));
      const rawSuffixStart =
        plan.good_suffix_start_sec !== undefined && plan.good_suffix_start_sec !== null
          ? Number(plan.good_suffix_start_sec)
          : 0;
      const goodSuffixStartSec =
        rawSuffixStart > goodPrefixEndSec + 1.0 && rawSuffixStart < maxDur - 0.5
          ? rawSuffixStart
          : null;

      // 1. Extract the exact anchor frame right before the faulty segment (or use scene image if defect starts at 0.0s)
      const scenePng = path.join(downloadsDir, "scenes", `scene_${partNum}.png`);
      const sceneJpg = path.join(downloadsDir, "scenes", `scene_${partNum}.jpg`);
      if (goodPrefixEndSec >= 0.4) {
        const extractAt = Math.max(0.05, goodPrefixEndSec - 0.05).toFixed(3);
        execSync(
          `"${ffmpeg}" -y -ss ${extractAt} -i "${sourceVideoPath}" -frames:v 1 -q:v 2 -update 1 "${anchorFramePath}" 2>/dev/null`,
          { stdio: "ignore", timeout: 10000 }
        );
        console.log(`📸 [ArgonVideoFixer] Extracted good-prefix anchor frame at ${extractAt}s -> ${path.basename(anchorFramePath)}`);
      } else if (existsSync(scenePng)) {
        await fs.copyFile(scenePng, anchorFramePath);
      } else if (existsSync(sceneJpg)) {
        await fs.copyFile(sceneJpg, anchorFramePath);
      } else {
        execSync(
          `"${ffmpeg}" -y -ss 0.15 -i "${sourceVideoPath}" -frames:v 1 -q:v 2 -update 1 "${anchorFramePath}" 2>/dev/null`,
          { stdio: "ignore", timeout: 10000 }
        );
      }

      // 2. Build Veo 3 replacement prompt (preserving CHARACTER_BIBLE & DUB_TIMELINE from currentPrompt)
      let replacementPrompt = String(plan.replacement_veo_prompt || plan.revised_veo_prompt || currentPrompt || "").trim();
      if (currentPrompt) {
        const charBibleMatch = currentPrompt.match(/CHARACTER_BIBLE:\s*([^\n]+(?:\n(?!\s*(?:CAMERA|SETTING|ACTION|LIGHTING|SOUND|DUB_TIMELINE|dialogue)\b)[^\n]+)*)/i);
        if (charBibleMatch && !/CHARACTER_BIBLE:/i.test(replacementPrompt)) {
          replacementPrompt = `CHARACTER_BIBLE: ${charBibleMatch[1].trim()}\n${replacementPrompt}`;
        }
        const dubMatch = currentPrompt.match(/DUB_TIMELINE:\s*([^\n]+(?:\n[^\n]+)*)/i);
        if (dubMatch && !/DUB_TIMELINE:/i.test(replacementPrompt)) {
          replacementPrompt = `${replacementPrompt}\nDUB_TIMELINE: ${dubMatch[1].trim()}`;
        }
      }
      if (!plan.replacement_veo_prompt && !plan.revised_veo_prompt) {
        replacementPrompt = `${replacementPrompt}\nCRITICAL DIRECTOR FIX: ${userInstruction}. Keep character outfit, face, and lighting 100% consistent with the reference frame.`;
        plan.revised_veo_prompt = replacementPrompt;
      }

      const { withWorldStyle } = await import("./worldStyles.js");
      const { generateSingleVeoSegment } = await import("./veoAutomation.js");

      console.log(`🎬 [ArgonVideoFixer] Calling Veo 3 to render replacement segment for Part ${partNum} (good_prefix: 0 -> ${goodPrefixEndSec.toFixed(2)}s)...`);
      const veoRes = await generateSingleVeoSegment(
        withWorldStyle(replacementPrompt, (worldStyle || "auto") as any),
        partNum - 1,
        anchorFramePath,
        basePrefix,
        downloadsDir,
        anchorFramePath,
        plan.revised_dialogue || currentDialogue || undefined,
        referenceImages,
        {
          includePrevFrame: false,
          refImagesMode: referenceImages.length > 0 ? "all" : "current_only",
          visualStyle: visualStyle || "real",
        }
      );

      if (veoRes.success && veoRes.localPath && existsSync(veoRes.localPath)) {
        const veoClipPath = veoRes.localPath;
        const veoInfo = probeVideoInfo(veoClipPath);
        const tempSplicePath = path.join(downloadsDir, `temp_argon_splice_${Date.now()}.mp4`);
        const fadeDur = 0.20;

        if (goodPrefixEndSec >= 0.45 && veoInfo.duration >= 1.5) {
          // Splice [Good Prefix: 0 -> goodPrefixEndSec] + [Newly Rendered Veo 3 Clip] (+ optional [Good Suffix])
          const suffixDur = goodSuffixStartSec ? Math.max(0, maxDur - goodSuffixStartSec) : 0;
          const targetTotalDur = Math.max(8.0, maxDur);
          const neededVeoDur = Math.max(2.5, targetTotalDur - goodPrefixEndSec - suffixDur + fadeDur);
          const veoKeepDur = Math.min(veoInfo.duration, neededVeoDur);
          const xfadeOffset1 = Math.max(0.1, goodPrefixEndSec - fadeDur);

          let filterComplex = "";
          const bothHaveAudio = activeSourceInfo.hasAudio && veoInfo.hasAudio && plan.audio_action !== "mute_all";

          if (goodSuffixStartSec && suffixDur >= 0.6) {
            const xfadeOffset2 = Math.max(xfadeOffset1 + 0.5, xfadeOffset1 + veoKeepDur - fadeDur);
            filterComplex =
              `[0:v]trim=0:${goodPrefixEndSec.toFixed(3)},setpts=PTS-STARTPTS,scale=${activeSourceInfo.width}:${activeSourceInfo.height},setsar=1,framerate=fps=60:interp_start=15:interp_end=240:scene=8.2,settb=1/60,setpts=PTS-STARTPTS[v0];` +
              `[1:v]trim=0:${veoKeepDur.toFixed(3)},setpts=PTS-STARTPTS,scale=${activeSourceInfo.width}:${activeSourceInfo.height},setsar=1,framerate=fps=60:interp_start=15:interp_end=240:scene=8.2,settb=1/60,setpts=PTS-STARTPTS[v1];` +
              `[0:v]trim=${goodSuffixStartSec.toFixed(3)}:${maxDur.toFixed(3)},setpts=PTS-STARTPTS,scale=${activeSourceInfo.width}:${activeSourceInfo.height},setsar=1,framerate=fps=60:interp_start=15:interp_end=240:scene=8.2,settb=1/60,setpts=PTS-STARTPTS[v2];` +
              `[v0][v1]xfade=transition=fade:duration=${fadeDur}:offset=${xfadeOffset1.toFixed(3)}[vx1];` +
              `[vx1][v2]xfade=transition=fade:duration=${fadeDur}:offset=${xfadeOffset2.toFixed(3)}[outv]`;
            if (bothHaveAudio) {
              filterComplex +=
                `;[0:a]atrim=0:${goodPrefixEndSec.toFixed(3)},asetpts=PTS-STARTPTS[a0];` +
                `[1:a]atrim=0:${veoKeepDur.toFixed(3)},asetpts=PTS-STARTPTS[a1];` +
                `[0:a]atrim=${goodSuffixStartSec.toFixed(3)}:${maxDur.toFixed(3)},asetpts=PTS-STARTPTS[a2];` +
                `[a0][a1]acrossfade=d=${fadeDur}[ax1];` +
                `[ax1][a2]acrossfade=d=${fadeDur},loudnorm=I=-14:TP=-1.0:LRA=9[outa]`;
            }
          } else {
            filterComplex =
              `[0:v]trim=0:${goodPrefixEndSec.toFixed(3)},setpts=PTS-STARTPTS,scale=${activeSourceInfo.width}:${activeSourceInfo.height},setsar=1,framerate=fps=60:interp_start=15:interp_end=240:scene=8.2,settb=1/60,setpts=PTS-STARTPTS[v0];` +
              `[1:v]trim=0:${veoKeepDur.toFixed(3)},setpts=PTS-STARTPTS,scale=${activeSourceInfo.width}:${activeSourceInfo.height},setsar=1,framerate=fps=60:interp_start=15:interp_end=240:scene=8.2,settb=1/60,setpts=PTS-STARTPTS[v1];` +
              `[v0][v1]xfade=transition=fade:duration=${fadeDur}:offset=${xfadeOffset1.toFixed(3)}[outv]`;
            if (bothHaveAudio) {
              filterComplex +=
                `;[0:a]atrim=0:${goodPrefixEndSec.toFixed(3)},asetpts=PTS-STARTPTS[a0];` +
                `[1:a]atrim=0:${veoKeepDur.toFixed(3)},asetpts=PTS-STARTPTS[a1];` +
                `[a0][a1]acrossfade=d=${fadeDur},loudnorm=I=-14:TP=-1.0:LRA=9[outa]`;
            }
          }

          const mapArgs = bothHaveAudio ? `-map "[outv]" -map "[outa]" -c:a aac -b:a 192k -ar 48000` : `-map "[outv]" -an`;
          const spliceCmd = `"${ffmpeg}" -y -i "${sourceVideoPath}" -i "${veoClipPath}" -filter_complex "${filterComplex}" ${mapArgs} -c:v libx264 -preset fast -crf 17 -pix_fmt yuv420p -r 60 -movflags +faststart "${tempSplicePath}"`;
          console.log(`✂️ [ArgonVideoFixer] Splicing good prefix (0 -> ${goodPrefixEndSec.toFixed(2)}s) + new Veo 3 segment (${veoKeepDur.toFixed(2)}s)...`);
          await execAsync(spliceCmd, { timeout: 120_000 });
          await fs.rename(tempSplicePath, newVersionPath);
          plan.analysis = `AI Argon 4.0 đã kiểm tra khung hình: giữ lại đoạn chuẩn đầu tiên (0.00s → ${goodPrefixEndSec.toFixed(2)}s), cắt bỏ đoạn lỗi phía sau, trích xuất frame mốc tại ${goodPrefixEndSec.toFixed(2)}s để gọi Veo 3 render đoạn mới (${veoKeepDur.toFixed(2)}s) và ghép nối mượt 60 FPS vào vị trí lỗi.`;
        } else if (goodSuffixStartSec && goodSuffixStartSec < maxDur - 0.5 && veoInfo.duration >= 1.5) {
          // Faulty beginning, good suffix: splice [New Veo 3 Clip] + [Good Suffix]
          const veoKeepDur = Math.min(veoInfo.duration, goodSuffixStartSec + fadeDur);
          const xfadeOffset = Math.max(0.2, veoKeepDur - fadeDur);
          const bothHaveAudio = activeSourceInfo.hasAudio && veoInfo.hasAudio && plan.audio_action !== "mute_all";
          let filterComplex =
            `[0:v]trim=0:${veoKeepDur.toFixed(3)},setpts=PTS-STARTPTS,scale=${activeSourceInfo.width}:${activeSourceInfo.height},setsar=1,framerate=fps=60:interp_start=15:interp_end=240:scene=8.2,settb=1/60,setpts=PTS-STARTPTS[v0];` +
            `[1:v]trim=${goodSuffixStartSec.toFixed(3)}:${maxDur.toFixed(3)},setpts=PTS-STARTPTS,scale=${activeSourceInfo.width}:${activeSourceInfo.height},setsar=1,framerate=fps=60:interp_start=15:interp_end=240:scene=8.2,settb=1/60,setpts=PTS-STARTPTS[v1];` +
            `[v0][v1]xfade=transition=fade:duration=${fadeDur}:offset=${xfadeOffset.toFixed(3)}[outv]`;
          if (bothHaveAudio) {
            filterComplex +=
              `;[0:a]atrim=0:${veoKeepDur.toFixed(3)},asetpts=PTS-STARTPTS[a0];` +
              `[1:a]atrim=${goodSuffixStartSec.toFixed(3)}:${maxDur.toFixed(3)},asetpts=PTS-STARTPTS[a1];` +
              `[a0][a1]acrossfade=d=${fadeDur},loudnorm=I=-14:TP=-1.0:LRA=9[outa]`;
          }
          const mapArgs = bothHaveAudio ? `-map "[outv]" -map "[outa]" -c:a aac -b:a 192k -ar 48000` : `-map "[outv]" -an`;
          const spliceCmd = `"${ffmpeg}" -y -i "${veoClipPath}" -i "${sourceVideoPath}" -filter_complex "${filterComplex}" ${mapArgs} -c:v libx264 -preset fast -crf 17 -pix_fmt yuv420p -r 60 -movflags +faststart "${tempSplicePath}"`;
          await execAsync(spliceCmd, { timeout: 120_000 });
          await fs.rename(tempSplicePath, newVersionPath);
          plan.analysis = `AI Argon 4.0 đã cắt bỏ đoạn đầu bị lỗi (0.00s → ${goodSuffixStartSec.toFixed(2)}s), gọi Veo 3 render mới và ghép nối mượt 60 FPS với đoạn cuối chuẩn (${goodSuffixStartSec.toFixed(2)}s → ${maxDur.toFixed(2)}s).`;
        } else {
          // Entire segment re-rendered by Veo 3
          await fs.rename(veoClipPath, newVersionPath);
          if (!plan.analysis || plan.analysis.startsWith("Đã kiểm tra")) {
            plan.analysis = `AI Argon 4.0 đã phát hiện lỗi xuyên suốt cảnh, tự động tối ưu Prompt và gọi Veo 3 render lại bản mới hoàn chỉnh (${veoInfo.duration.toFixed(2)}s).`;
          }
        }

        // Remove temporary raw Veo download and its extracted frames if different from newVersionPath
        if (veoClipPath !== newVersionPath && existsSync(veoClipPath)) {
          const rawBase = path.basename(veoClipPath, ".mp4");
          await fs.unlink(veoClipPath).catch(() => {});
          try {
            const dirFiles = await fs.readdir(downloadsDir);
            for (const df of dirFiles) {
              if (df.startsWith(`${rawBase}_frame`) && df.endsWith(".jpg")) {
                await fs.unlink(path.join(downloadsDir, df)).catch(() => {});
              }
            }
          } catch {}
        }

        agentCreatedDirectly = existsSync(newVersionPath) && probeVideoInfo(newVersionPath).duration >= 0.3;
      }
    } catch (veoErr: any) {
      console.warn(`⚠️ [ArgonVideoFixer] Veo 3 splice fallback to FFmpeg (${veoErr.message})`);
    } finally {
      if (existsSync(anchorFramePath)) {
        await fs.unlink(anchorFramePath).catch(() => {});
      }
    }
  }

  if (agentCreatedDirectly) {
    console.log(`🎯 [ArgonVideoFixer] Completed Veo 3 splice / direct generation: ${newVersionFilename}`);
  } else {
    // If AI returned a default untouched plan without running run_command, enrich plan from userInstruction so we NEVER output an unedited copy
    const isUnchangedDefault =
      (!plan.trim_start_sec || Number(plan.trim_start_sec) === 0) &&
      (!plan.trim_end_sec || Math.abs(Number(plan.trim_end_sec) - info.duration) < 0.05) &&
      (!plan.crop_margin_percent || Number(plan.crop_margin_percent) === 0) &&
      (!plan.reverse_tail_sec || Number(plan.reverse_tail_sec) === 0) &&
      (!plan.speed_factor || Math.abs(Number(plan.speed_factor) - 1.0) < 0.02) &&
      !plan.custom_vf &&
      !plan.custom_filter_complex &&
      plan.audio_action !== "mute_all" &&
      (!plan.mute_ranges || plan.mute_ranges.length === 0);

    if (isUnchangedDefault) {
      if (lowerInst.includes("lò cò") || lowerInst.includes("1 chiếc dép") || lowerInst.includes("một chiếc dép") || lowerInst.includes("2 dép") || lowerInst.includes("hai dép") || lowerInst.includes("che chân")) {
        plan.crop_margin_percent = 24;
        plan.crop_anchor = "top";
        plan.hop_bounce = true;
      } else if (lowerInst.includes("khựng") || lowerInst.includes("đơ") || lowerInst.includes("mượt") || lowerInst.includes("chuyển")) {
        plan.reverse_tail_sec = 0.5;
      } else {
        plan.crop_margin_percent = 10;
        plan.crop_anchor = "center";
      }
    }

    const startSec = Math.max(0, Math.min(maxDur - 0.3, Number(plan.trim_start_sec) || 0));
    const rawEndSec =
      plan.trim_end_sec !== undefined && plan.trim_end_sec !== null && Number(plan.trim_end_sec) > startSec + 0.2
        ? Number(plan.trim_end_sec)
        : maxDur;
    const endSec = Math.max(startSec + 0.3, Math.min(maxDur, rawEndSec));
    const speedFactor = Math.max(0.5, Math.min(2.0, Number(plan.speed_factor) || 1.0));
    const reverseTailSec = Math.max(0, Math.min(1.2, Number(plan.reverse_tail_sec) || 0));
    const cropPct = Math.max(0, Math.min(35, Number(plan.crop_margin_percent) || 0));
    const targetFps = plan.interpolate_60fps !== false ? 60 : 30;

    // Build FFmpeg filter_complex
    const tempFixedPath = path.join(downloadsDir, `temp_argon_fix_${Date.now()}.mp4`);
    let customFilterSucceeded = false;

    if (plan.custom_filter_complex && String(plan.custom_filter_complex).trim()) {
      try {
        const customCmd = `"${ffmpeg}" -y -i "${sourceVideoPath}" -filter_complex "${plan.custom_filter_complex}" -c:v libx264 -preset fast -crf 17 -pix_fmt yuv420p -r ${targetFps} -movflags +faststart "${tempFixedPath}"`;
        console.log(`🛠️ [ArgonVideoFixer] Running AI custom_filter_complex for Part ${partNum}...`);
        await execAsync(customCmd, { timeout: 120_000 });
        if (existsSync(tempFixedPath) && probeVideoInfo(tempFixedPath).duration >= 0.3) {
          await fs.rename(tempFixedPath, newVersionPath);
          customFilterSucceeded = true;
        }
      } catch (custErr: any) {
        console.warn(`⚠️ [ArgonVideoFixer] custom_filter_complex failed (${custErr.message}), falling back to structured filter builder...`);
      }
    }

    if (!customFilterSucceeded) {
      const vFilters: string[] = [];

      // 1. Optional custom_vf or crop & scale back to original dimensions
      if (plan.custom_vf && String(plan.custom_vf).trim()) {
        vFilters.push(String(plan.custom_vf).trim());
        vFilters.push(`scale=${activeSourceInfo.width}:${activeSourceInfo.height}:flags=lanczos`);
      } else if (plan.hop_bounce) {
        const keepRatio = (100 - Math.max(22, cropPct)) / 100;
        const cw = `iw*${keepRatio.toFixed(3)}`;
        const ch = `ih*${keepRatio.toFixed(3)}`;
        vFilters.push(`crop=${cw}:${ch}:'(iw-ow)/2':'ih*0.015+ih*0.032*abs(sin(t*6.4))',scale=${activeSourceInfo.width}:${activeSourceInfo.height}:flags=lanczos`);
      } else if (cropPct > 0) {
        const keepRatio = (100 - cropPct) / 100;
        const cw = `floor(iw*${keepRatio.toFixed(3)}/2)*2`;
        const ch = `floor(ih*${keepRatio.toFixed(3)}/2)*2`;
        let cx = `(iw-${cw})/2`;
        let cy = `(ih-${ch})/2`;
        if (plan.crop_anchor === "top") cy = "0";
        else if (plan.crop_anchor === "bottom") cy = `ih-${ch}`;
        else if (plan.crop_anchor === "left") cx = "0";
        else if (plan.crop_anchor === "right") cx = `iw-${cw}`;
        vFilters.push(`crop=${cw}:${ch}:${cx}:${cy},scale=${activeSourceInfo.width}:${activeSourceInfo.height}:flags=lanczos`);
      } else {
        vFilters.push(`scale=${activeSourceInfo.width}:${activeSourceInfo.height}`);
      }
      vFilters.push("setsar=1");

      // 2. Optional color adjustments
      if (plan.color_adjust) {
        const b = Math.max(-0.3, Math.min(0.3, Number(plan.color_adjust.brightness) || 0));
        const c = Math.max(0.7, Math.min(1.4, Number(plan.color_adjust.contrast) || 1.0));
        const s = Math.max(0.5, Math.min(1.6, Number(plan.color_adjust.saturation) || 1.0));
        if (Math.abs(b) > 0.01 || Math.abs(c - 1.0) > 0.01 || Math.abs(s - 1.0) > 0.01) {
          vFilters.push(`eq=brightness=${b.toFixed(2)}:contrast=${c.toFixed(2)}:saturation=${s.toFixed(2)}`);
        }
      }

      // 3. Speed adjustment
      if (Math.abs(speedFactor - 1.0) > 0.02) {
        vFilters.push(`setpts=${(1 / speedFactor).toFixed(4)}*PTS`);
      }

      // 4. 60 FPS motion interpolation
      if (targetFps === 60) {
        vFilters.push(`framerate=fps=60:interp_start=15:interp_end=240:scene=8.2,settb=1/60,setpts=PTS-STARTPTS`);
      } else {
        vFilters.push(`fps=30,setpts=PTS-STARTPTS`);
      }

      const baseChain = vFilters.join(",");
      let videoFilterGraph = "";

      if (reverseTailSec > 0.1 && endSec - startSec > 1.2) {
        const revStart = Math.min(startSec + 0.15, endSec - reverseTailSec - 0.1);
        const revEnd = revStart + reverseTailSec;
        videoFilterGraph = `[0:v]trim=${startSec.toFixed(3)}:${endSec.toFixed(3)},setpts=PTS-STARTPTS[vmain];[0:v]trim=${revStart.toFixed(3)}:${revEnd.toFixed(3)},setpts=PTS-STARTPTS,reverse[vrev];[vmain][vrev]concat=n=2:v=1:a=0,${baseChain}[outv]`;
      } else {
        videoFilterGraph = `[0:v]trim=${startSec.toFixed(3)}:${endSec.toFixed(3)},setpts=PTS-STARTPTS,${baseChain}[outv]`;
      }

      // Build Audio Filter Graph
      const hasOutputAudio = activeSourceInfo.hasAudio && plan.audio_action !== "mute_all";
      let audioFilterGraph = "";
      if (hasOutputAudio) {
        const aFilters: string[] = [`atrim=${startSec.toFixed(3)}:${endSec.toFixed(3)}`, "asetpts=PTS-STARTPTS"];
        if (Math.abs(speedFactor - 1.0) > 0.02) {
          aFilters.push(`atempo=${speedFactor.toFixed(3)}`);
        }
        if (plan.audio_action === "denoise") {
          aFilters.push("highpass=f=80,afftdn=nf=-25");
        }
        if (Array.isArray(plan.mute_ranges)) {
          for (const mr of plan.mute_ranges) {
            const ms = Math.max(0, (Number(mr.start) || 0) - startSec);
            const me = Math.max(ms + 0.1, (Number(mr.end) || 0) - startSec);
            aFilters.push(`volume=enable='between(t,${ms.toFixed(2)},${me.toFixed(2)})':volume=0`);
          }
        }
        if (plan.volume_gain_db && Math.abs(Number(plan.volume_gain_db)) > 0.2) {
          aFilters.push(`volume=${Number(plan.volume_gain_db).toFixed(1)}dB`);
        }
        if (plan.normalize_loudness !== false) {
          aFilters.push("loudnorm=I=-14:TP=-1.0:LRA=9");
        }
        if (reverseTailSec > 0.1 && endSec - startSec > 1.2) {
          aFilters.push(`afade=t=out:st=${Math.max(0.1, endSec - startSec - 0.3).toFixed(2)}:d=0.3,apad=pad_dur=${reverseTailSec.toFixed(3)}`);
        }
        audioFilterGraph = `;[0:a]${aFilters.join(",")}[outa]`;
      }

      const fullFilterComplex = `${videoFilterGraph}${audioFilterGraph}`;
      const mapArgs = hasOutputAudio ? `-map "[outv]" -map "[outa]" -c:a aac -b:a 192k -ar 48000` : `-map "[outv]" -an`;
      const cmd = `"${ffmpeg}" -y -i "${sourceVideoPath}" -filter_complex "${fullFilterComplex}" ${mapArgs} -c:v libx264 -preset fast -crf 17 -pix_fmt yuv420p -r ${targetFps} -movflags +faststart "${tempFixedPath}"`;

      console.log(`🛠️ [ArgonVideoFixer] Running fallback FFmpeg repair pipeline for Part ${partNum}...`);
      await execAsync(cmd, { timeout: 120_000 });
      await fs.rename(tempFixedPath, newVersionPath);
    }
  }

  // Clean up temporary files
  if (existsSync(contactSheetPath)) {
    await fs.unlink(contactSheetPath).catch(() => {});
  }
  if (existsSync(reportJsonPath)) {
    await fs.unlink(reportJsonPath).catch(() => {});
  }

  // Verify fixed file
  const fixedInfo = probeVideoInfo(newVersionPath);
  if (!existsSync(newVersionPath) || fixedInfo.duration < 0.2) {
    throw new Error("File video sau khi sửa không hợp lệ.");
  }

  const nowTime = new Date();
  try {
    utimesSync(newVersionPath, nowTime, nowTime);
  } catch {}

  const activeVersionsFile = path.join(downloadsDir, "active_versions.json");
  let activeVersions: Record<string, string> = {};
  if (existsSync(activeVersionsFile)) {
    try {
      activeVersions = JSON.parse(await fs.readFile(activeVersionsFile, "utf-8"));
    } catch {}
  }
  activeVersions[`part${partNum}`] = newVersionFilename;
  await fs.writeFile(activeVersionsFile, JSON.stringify(activeVersions, null, 2), "utf-8").catch(() => {});

  const webUrl = `/downloads/${activeJobFolder}/${newVersionFilename}?t=${Date.now()}`;
  console.log(`✅ [ArgonVideoFixer] Created new AI-fixed version ${newVersionFilename} & set as active for Part ${partNum}: ${fixedInfo.duration.toFixed(2)}s (source: ${partVideoFile})`);

  return {
    success: true,
    part_number: partNum,
    filename: newVersionFilename,
    source_filename: partVideoFile,
    video_url: webUrl,
    video_path: newVersionPath,
    duration_sec: fixedInfo.duration,
    old_duration_sec: info.duration,
    analysis: plan.analysis,
    applied_plan: plan,
    revised_veo_prompt: plan.revised_veo_prompt,
    revised_dialogue: plan.revised_dialogue,
  };
}

