import fs from "fs";
import path from "path";
import { exec, execSync } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { generateSpeechWithVieneu } from "./vieneuClient.js";
import { mergeJobVideoSegments } from "./scheduler.js";
import { loadCharacters } from "./characterRegistry.js";
import { loadProducts as dbLoadProducts } from "./database.js";

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DubVideoOptions {
  productSlug: string;
  jobFolder?: string;
  product?: any;
  duduVoice?: string;
  bubuVoice?: string;
  scriptText?: string;
  uploadToS3?: boolean;
  bgmVolume?: number;
  voiceTemperature?: number;
  /** Map a normalized character id/name to its TTS voice id. */
  speakerVoices?: Record<string, string>;
}

export interface ParsedDialogueTurn {
  startSec: number;
  speaker: string;
  speakerId: string;
  voiceId: string;
  text: string;
  part: number;
}

function normalizeSpeakerId(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, match => match === "Đ" ? "D" : "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function resolveSpeakerVoice(
  speakerName: string,
  speakerVoices: Record<string, string>,
  duduVoice: string,
  bubuVoice: string
): { speakerId: string; voiceId: string } {
  const speakerId = normalizeSpeakerId(speakerName);
  const direct = speakerVoices[speakerId]
    || speakerVoices[normalizeSpeakerId(speakerName.replace(/^(gau|be|sep)\s+/i, ""))];
  if (direct) return { speakerId, voiceId: direct };
  if (/dudu|gau_nau|nau|nam/.test(speakerId)) return { speakerId: "dudu", voiceId: duduVoice };
  if (/bubu|gau_trang|bach|phuong|nu|meow/.test(speakerId)) return { speakerId: "bubu", voiceId: bubuVoice };
  // Never silently assign another character's voice. The caller can resolve
  // this through Character Registry or the speaker_voices request field.
  return { speakerId, voiceId: "" };
}

export interface DubVideoResult {
  success: boolean;
  voicedVideoPath: string;
  voicedFilename: string;
  streamUrl: string;
  totalLines: number;
  error?: string;
}

// Preset default dialogue lines for the 60-second animated story (generic — no hardcoded character names)
const DEFAULT_PRESET_LINES = [
  { part: 1, startSec: 0.5, speaker: "NamChinh", text: "Hôm nay chúng mình cùng nhau khám phá nhé!" },
  { part: 1, startSec: 4.8, speaker: "NuChinh", text: "Dạ! Em sẽ đi theo thật ngoan!" },
  { part: 2, startSec: 10.5, speaker: "NuChinh", text: "Ôi, đường trơn quá… em hơi sợ." },
  { part: 2, startSec: 14.5, speaker: "NamChinh", text: "Có anh đây rồi. Em bước chậm thôi, chúng mình sẽ qua an toàn." },
  { part: 3, startSec: 20.5, speaker: "NamChinh", text: "Nhìn kìa, phía trước có gì đẹp lắm! Mình đến gần xem nhé!" },
  { part: 3, startSec: 24.8, speaker: "NuChinh", text: "Em thấy rồi! Đẹp quá đi!" },
  { part: 4, startSec: 30.5, speaker: "NuChinh", text: "Chúng mình làm được rồi!" },
  { part: 4, startSec: 34.5, speaker: "NamChinh", text: "Giỏi lắm! Vì chúng mình biết bình tĩnh và phối hợp cùng nhau đấy." },
  { part: 5, startSec: 40.5, speaker: "NuChinh", text: "Mình giúp bạn ấy trở về nhà nhé? Bạn ấy chắc đang nhớ gia đình." },
  { part: 5, startSec: 44.8, speaker: "NamChinh", text: "Ừ, em thật tốt bụng. Niềm vui đẹp nhất là biết yêu thương." },
  { part: 6, startSec: 50.5, speaker: "NuChinh", text: "Hôm nay em học được nhiều điều bổ ích quá!" },
  { part: 6, startSec: 54.5, speaker: "NamChinh", text: "Anh cũng vậy. Chuyến đi vui nhất là chuyến đi có nhau bên cạnh." }
];

/**
 * Google Veo sinh video 10s/scene: mỗi scene có nhịp hình riêng (mở cảnh, hành trình,
 * biến cố, sửa chữa, cao trào, ăn mừng). Giọng lồng phải KHỚP nhịp hình, không sớm hơn
 * sự kiện trên hình cũng không trễ quá tạo dead-air.
 */
function determineSceneStartOffset(
  partIdx: number,
  promptText: string,
  dialogueText: string
): number {
  const p = promptText.toLowerCase();
  const d = dialogueText.toLowerCase();

  // ── Scene 1: Mở đầu, camera thiết lập bối cảnh ──
  // Camera thường lia từ thấp lên hoặc từ xa tới gần → cần 1-1.5s để nhân vật hiện rõ mặt
  if (partIdx === 1) {
    if (p.includes("opening") || p.includes("establish") || p.includes("begin with") || p.includes("foreground")) {
      return 1.2;
    }
    return 1.0;
  }

  // ── Scene 6: Kết thúc / cán đích / ăn mừng ──
  // Hành động cao trào (cán đích, ôm nhau, vẫy tay) thường xảy ra ở giây 2-3 mới hoàn tất
  if (partIdx === 6) {
    if (p.includes("cross") || p.includes("finish line") || p.includes("cán đích") || p.includes("breaking the ribbon")) {
      return 3.0; // Chờ cán đích xong mới nói
    }
    if (p.includes("sit") || p.includes("hug") || p.includes("ôm") || p.includes("ngồi")) {
      return 2.5; // Chờ ngồi xuống / ôm nhau xong
    }
    return 2.0; // Scene kết mặc định
  }

  // ── Cảnh biến cố / chướng ngại vật / phanh gấp ──
  // Sự kiện bất ngờ xảy ra ở ~1.5-2.5s trong cảnh, nhân vật phản ứng SAU khi thấy
  if (
    p.includes("fallen") || p.includes("drops") || p.includes("falls") ||
    p.includes("obstacle") || p.includes("accident") || p.includes("brake") ||
    p.includes("stop") || p.includes("rơi") || p.includes("ngã") ||
    p.includes("phanh") || p.includes("dừng lại") || p.includes("chướng ngại") ||
    d.includes("khoan") || d.includes("cẩn thận") || d.includes("ối") || d.includes("nguy hiểm")
  ) {
    return 2.0; // Chờ biến cố xảy ra trên hình rồi nhân vật mới phản ứng bằng lời
  }

  // ── Cảnh sửa chữa / hỗ trợ / phối hợp (thường là Part 4 sau biến cố Part 3) ──
  // Nhân vật đã dừng sẵn từ cảnh trước, hành động sửa chữa bắt đầu ngay
  if (
    p.includes("repair") || p.includes("fix") || p.includes("help") ||
    p.includes("sửa") || p.includes("giúp") || p.includes("lắp") ||
    d.includes("giữ chắc") || d.includes("lắp bánh") || d.includes("sửa") ||
    d.includes("cùng giúp")
  ) {
    return 0.5; // Đã ở tư thế sẵn sàng → nói ngay
  }

  // ── Cảnh đặc biệt: tăng tốc / cao trào / bridge crossing ──
  if (
    p.includes("accelerat") || p.includes("tăng tốc") || p.includes("bridge") ||
    p.includes("final stretch") || p.includes("đoạn cuối") ||
    d.includes("cố gắng") || d.includes("nhanh lên")
  ) {
    return 0.8; // Hành động liên tục, nói nhanh
  }

  // ── Cảnh tiếp nối (seamless match cut) ──
  // Nhân vật đang di chuyển liên tục từ cảnh trước
  if (p.includes("seamless") || p.includes("continuing") || p.includes("match cut") || p.includes("match-cut")) {
    return 0.5;
  }

  // ── Cảnh có nhìn/khám phá/phát hiện ──
  if (
    p.includes("discover") || p.includes("notice") || p.includes("spot") ||
    p.includes("phát hiện") || p.includes("nhìn kìa") ||
    d.includes("nhìn kìa") || d.includes("coi kìa")
  ) {
    return 1.5; // Chờ nhân vật phát hiện điều gì đó
  }

  // ── Mặc định cho các cảnh thông thường ──
  return 0.8;
}

/**
 * Parse timeline timestamps embedded in Veo prompts.
 * Veo prompts sometimes contain explicit timeline like:
 *   "1.0–2.4s, BuBu says her first line"
 *   "4.8–6.8s, DuDu delivers his short line"
 * Returns speaking segments with start/end times and speaker.
 */
function parseVeoPromptTimeline(
  promptText: string,
  knownSpeakerIds: string[]
): { startSec: number; endSec: number; speakerId: string }[] {
  if (!promptText) return [];

  const speakingSegments: { startSec: number; endSec: number; speakerId: string }[] = [];

  // Split prompt into timeline segments: "X.X–Y.Ys, description..."
  const segRegex = /(\d+\.?\d*)\s*[–\-]\s*(\d+\.?\d*)s[,:]?\s*([\s\S]*?)(?=\d+\.?\d*\s*[–\-]\s*\d+\.?\d*s|$)/g;
  let m;
  while ((m = segRegex.exec(promptText)) !== null) {
    const start = parseFloat(m[1]);
    const end = parseFloat(m[2]);
    const desc = m[3];

    // Skip non-dialogue segments
    if (/no dialogue|dialogue[- ]free/i.test(desc)) continue;

    // Check if this segment involves speaking
    const isSpeaking = /\b(says?|delivers?|speaks?|line|question|nói|phát biểu|thoại)\b/i.test(desc);
    if (!isSpeaking) continue;

    // Identify speaker
    const normalizedDesc = normalizeSpeakerId(desc);
    const uniqueSpeakerIds = [...new Set(knownSpeakerIds)];
    const candidates = uniqueSpeakerIds.map(id => {
      const tokens = id.split("_").filter(Boolean);
      const positions = [normalizedDesc.indexOf(id), ...tokens.filter(token => token.length >= 3).map(token => normalizedDesc.indexOf(token))]
        .filter(position => position >= 0);
      return { id, position: positions.length ? Math.min(...positions) : -1 };
    }).filter(candidate => candidate.position >= 0).sort((a, b) => a.position - b.position);
    // Timeline prose commonly mentions both characters (speaker first, listener
    // second), so select the earliest known character instead of registry order.
    const speakerId = candidates[0]?.id;
    if (!speakerId) continue;
    speakingSegments.push({ startSec: start, endSec: end, speakerId });
  }

  return speakingSegments;
}

export function parseDialogueTurns(
  promptsObj: Record<string, any>,
  duduVoice: string = "DuDu_NamChinh",
  bubuVoice: string = "Mai Bé Phương",
  speakerVoices: Record<string, string> = {}
): ParsedDialogueTurn[] {
  const allLines: ParsedDialogueTurn[] = [];
  const dialoguePartNumbers = Object.keys(promptsObj)
    .map(key => key.match(/^dialogue(\d+)$/i))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map(match => Number(match[1]))
    .sort((a, b) => a - b);

  for (const partIdx of dialoguePartNumbers) {
    const raw = promptsObj[`dialogue${partIdx}`];
    if (!raw || typeof raw !== "string" || !raw.trim()) continue;

    const partBase = (partIdx - 1) * 10.0;
    const rawLines = raw.split("\n").map((l: string) => l.trim()).filter(Boolean);
    const parsed: Array<{ speaker: string; speakerId: string; voiceId: string; text: string }> = [];

    for (const line of rawLines) {
      let speaker = "";
      let content = line;

      const colonMatch = line.match(/^[\p{Extended_Pictographic}\*\s\-]*([^:\n]{1,80}?)[\*]*\s*:\s*([\s\S]*)$/iu);
      if (colonMatch) {
        const name = colonMatch[1].trim();
        content = colonMatch[2];
        speaker = name;
      }

      // Loại bỏ action notes *...* hoặc (...)
      let clean = content.replace(/\*[^*]*\*/g, "").replace(/\([^)]*\)/g, "").trim();
      // Loại bỏ dấu ngoặc kép thừa
      clean = clean.replace(/^["“”'‘’\s]+|["“”'‘’\s]+$/g, "").trim();

      if (!speaker) {
        speaker = parsed.length % 2 === 0 ? "dudu" : "bubu";
      }

      if (clean.length >= 2) {
        const identity = resolveSpeakerVoice(speaker, speakerVoices, duduVoice, bubuVoice);
        parsed.push({ speaker, ...identity, text: clean });
      }
    }

    if (parsed.length === 0) continue;

    // ── STRATEGY 1: Parse explicit timestamps from Veo prompt ──
    // Veo prompts đôi khi chứa timeline chính xác: "1.0–2.4s, BuBu says her first line"
    // Nếu tìm thấy, dùng trực tiếp để khớp chính xác với khẩu hình Veo đã render
    const promptText = (promptsObj[`prompt${partIdx}`] || "") as string;
    const veoTimeline = parseVeoPromptTimeline(promptText, parsed.map(item => item.speakerId));

    if (veoTimeline.length > 0 && veoTimeline.length >= parsed.length) {
      // Map từng câu thoại vào đúng speaking segment của Veo
      console.log(`⏱️ [ParseDialogue] Part ${partIdx}: Tìm thấy ${veoTimeline.length} timestamps Veo → khớp chính xác khẩu hình!`);
      let veoIdx = 0;
      for (let pIdx = 0; pIdx < parsed.length; pIdx++) {
        // Tìm segment Veo phù hợp với speaker này
        let matched = false;
        for (let vi = veoIdx; vi < veoTimeline.length; vi++) {
          if (veoTimeline[vi].speakerId === parsed[pIdx].speakerId) {
            const start = partBase + veoTimeline[vi].startSec;
            allLines.push({
              part: partIdx,
              startSec: Number(start.toFixed(1)),
              speaker: parsed[pIdx].speaker,
              speakerId: parsed[pIdx].speakerId,
              voiceId: parsed[pIdx].voiceId,
              text: parsed[pIdx].text,
            });
            veoIdx = vi + 1;
            matched = true;
            console.log(`   ⏱️ [${start.toFixed(1)}s] ${parsed[pIdx].speaker}: "${parsed[pIdx].text.slice(0, 40)}..." (Veo: ${veoTimeline[vi].startSec}s-${veoTimeline[vi].endSec}s)`);
            break;
          }
        }
        if (!matched) {
          // Fallback: dùng segment Veo tiếp theo bất kể speaker
          if (veoIdx < veoTimeline.length) {
            const start = partBase + veoTimeline[veoIdx].startSec;
            allLines.push({
              part: partIdx,
              startSec: Number(start.toFixed(1)),
              speaker: parsed[pIdx].speaker,
              speakerId: parsed[pIdx].speakerId,
              voiceId: parsed[pIdx].voiceId,
              text: parsed[pIdx].text,
            });
            console.log(`   ⏱️ [${start.toFixed(1)}s] ${parsed[pIdx].speaker}: "${parsed[pIdx].text.slice(0, 40)}..." (Veo fallback: ${veoTimeline[veoIdx].startSec}s-${veoTimeline[veoIdx].endSec}s)`);
            veoIdx++;
          } else {
            // Hết segment Veo, ước tính từ câu trước
            const prevStart = allLines[allLines.length - 1]?.startSec || partBase;
            const estDur = Math.max(1.5, Math.min(4.0, parsed[pIdx - 1]?.text.length * 0.065 || 2));
            const start = Math.min(prevStart + estDur + 0.3, partBase + 9.0);
            allLines.push({
              part: partIdx,
              startSec: Number(start.toFixed(1)),
              speaker: parsed[pIdx].speaker,
              speakerId: parsed[pIdx].speakerId,
              voiceId: parsed[pIdx].voiceId,
              text: parsed[pIdx].text,
            });
          }
        }
      }
      continue;
    }

    // ── STRATEGY 2: Heuristic — phân tích nội dung cảnh để ước tính offset ──
    const sceneOffset = determineSceneStartOffset(partIdx, promptText, raw);
    const count = parsed.length;

    // Tính khoảng cách giữa các câu dựa trên số lượng câu và thời lượng khả dụng (10s/scene)
    // Chừa headroom cho scene offset + 0.4s cuối
    const availableTime = 10.0 - sceneOffset - 0.4;
    // Ước tính tổng thời lượng nói (mỗi ký tự ~ 0.06s tiếng Việt)
    const totalEstSpeechDur = parsed.reduce((sum, p) => sum + Math.max(1.0, Math.min(4.0, p.text.length * 0.06)), 0);
    // Khoảng nghỉ giữa các câu: chia đều phần thời gian trống còn lại
    const totalGapTime = Math.max(0, availableTime - totalEstSpeechDur);
    const gapPerPause = count > 1 ? Math.max(0.15, Math.min(1.5, totalGapTime / (count - 1))) : 0;

    // Track running position to prevent overlap — dùng làm floor chống chồng lấn
    let runningPos = partBase + sceneOffset;

    parsed.forEach((item, idx) => {
      let start: number;
      if (idx === 0) {
        start = partBase + sceneOffset;
      } else {
        const prevText = parsed[idx - 1].text;
        const estPrevDur = Math.max(1.0, Math.min(4.0, prevText.length * 0.06));
        const prevStart = allLines[allLines.length - 1].startSec;
        const idealStart = prevStart + estPrevDur + gapPerPause;
        // Không vượt quá scene end, nhưng cũng không dồn cụm — đảm bảo >= runningPos
        start = Math.max(idealStart, runningPos);
        start = Math.min(start, partBase + 9.5);
      }

      // Cập nhật running position: ước tính kết thúc câu này + gap tối thiểu
      const estDur = Math.max(1.0, Math.min(4.0, item.text.length * 0.06));
      runningPos = start + estDur + 0.15;

      allLines.push({
        part: partIdx,
        startSec: Number(start.toFixed(1)),
        speaker: item.speaker,
        speakerId: item.speakerId,
        voiceId: item.voiceId,
        text: item.text,
      });
    });
  }

  return allLines;
}

export async function dubVideoWithVieneu(options: DubVideoOptions & { promptsObj?: Record<string, any> }): Promise<DubVideoResult> {
  const {
    productSlug,
    jobFolder,
    product,
    promptsObj: directPromptsObj,
    duduVoice = "DuDu_NamChinh",
    bubuVoice = "Mai Bé Phương",
    scriptText: initialScriptText,
    uploadToS3 = true,
    bgmVolume = 0.7,
    voiceTemperature = 0.35,
    speakerVoices: requestedSpeakerVoices = {},
  } = options;

  let scriptText = initialScriptText;
  let tempDir = "";

  try {
    const activeJobFolder = jobFolder || productSlug;
    const downloadsDir = path.resolve(__dirname, `../data/downloads/${activeJobFolder}`);

    if (!fs.existsSync(downloadsDir)) {
      throw new Error(`Thư mục dự án không tồn tại: ${downloadsDir}`);
    }

    console.log(`\n🎙️ [VideoDubbing] Bắt đầu quy trình lồng tiếng cho "${productSlug}"...`);
    console.log(`🎙️ [VideoDubbing] Giọng DuDu: ${duduVoice} | Giọng BuBu: ${bubuVoice}`);

    // Tự động kiểm tra file dub_timeline.txt trong thư mục dự án (nếu có để căn timeline tùy biến)
    const timelineTxtPath = path.join(downloadsDir, "dub_timeline.txt");
    if (!scriptText && fs.existsSync(timelineTxtPath)) {
      try {
        scriptText = fs.readFileSync(timelineTxtPath, "utf-8");
        console.log(`⏱️ [VideoDubbing] Áp dụng timeline từ: ${timelineTxtPath}`);
      } catch {}
    }

    // 1. Tìm hoặc ghép video 1 phút (merged video)
    let mergedVideoPath = path.join(downloadsDir, `${productSlug}_merged.mp4`);
    if (!fs.existsSync(mergedVideoPath)) {
      console.log(`🎬 [VideoDubbing] Chưa có file ${productSlug}_merged.mp4. Đang tự động ghép 6 Part trước...`);
      try {
        await mergeJobVideoSegments(productSlug, activeJobFolder, product, false, false);
      } catch (e: any) {
        console.warn(`⚠️ [VideoDubbing] Ghép 6 part cảnh báo: ${e.message}`);
      }
    }

    // Nếu vẫn chưa có, tìm file .mp4 bất kỳ trong thư mục (trừ _voiced và _longtieng)
    if (!fs.existsSync(mergedVideoPath)) {
      const files = fs.readdirSync(downloadsDir).filter(f => f.endsWith(".mp4") && !f.includes("_voiced") && !f.includes("_longtieng"));
      const mergedCandidate = files.find(f => f.includes("_merged"));
      if (mergedCandidate) {
        mergedVideoPath = path.join(downloadsDir, mergedCandidate);
      } else if (files.length > 0) {
        mergedVideoPath = path.join(downloadsDir, files[0]);
      } else {
        throw new Error(`Không tìm thấy file video nào trong thư mục ${downloadsDir} để lồng tiếng!`);
      }
    }

    console.log(`🎬 [VideoDubbing] Target video để lồng tiếng: ${mergedVideoPath}`);

    // 2. Chuẩn bị kịch bản thoại
    let lines: Array<Partial<ParsedDialogueTurn> & { startSec: number; speaker: string; text: string; part?: number }> = [];

    // Character identity and TTS voice are separate concerns. Build one stable
    // lookup for the whole job so custom voice ids never change the speaker.
    const registry = await loadCharacters();
    const speakerVoices: Record<string, string> = { ...requestedSpeakerVoices };
    for (const character of Object.values(registry)) {
      speakerVoices[normalizeSpeakerId(character.id)] = character.voice_id;
      speakerVoices[normalizeSpeakerId(character.name)] = character.voice_id;
    }
    speakerVoices.dudu = duduVoice;
    speakerVoices.bubu = bubuVoice;

    if (scriptText && scriptText.trim()) {
      for (const rawLine of scriptText.split("\n")) {
        const parts = rawLine.split("|").map(p => p.trim());
        if (parts.length >= 3) {
          const sec = parseFloat(parts[0]);
          if (!isNaN(sec)) {
            const part = Math.max(1, Math.floor(sec / 10.0) + 1);
            const identity = resolveSpeakerVoice(parts[1], speakerVoices, duduVoice, bubuVoice);
            lines.push({ startSec: sec, speaker: parts[1], ...identity, text: parts.slice(2).join(" "), part });
          }
        }
      }
    }

    // Lấy prompts_obj từ direct param, product hoặc file prompts.json hoặc products.json
    if (lines.length === 0) {
      let pObj: any = directPromptsObj || product?.prompts_obj || product?.promptsObj;
      if (!pObj) {
        const promptsJsonPath = path.join(downloadsDir, "prompts.json");
        if (fs.existsSync(promptsJsonPath)) {
          try {
            pObj = JSON.parse(fs.readFileSync(promptsJsonPath, "utf-8"));
          } catch {}
        }
      }

      if (!pObj) {
        try {
          const prods = dbLoadProducts();
          const normSlug = (s: string) =>
            s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9\s-_]/g, "").replace(/[\s_]+/g, "-");
          const targetNorm = normSlug(productSlug);
          const matched = prods.find((p: any) => {
            if (!p.name) return false;
            const pn = normSlug(p.name);
            return pn === targetNorm || pn.includes(targetNorm) || targetNorm.includes(pn);
          });
          if (matched) {
            pObj = matched.promptsObj || (matched as any).prompts_obj;
            if (!pObj && matched.description && matched.description.startsWith("{")) {
              try { pObj = JSON.parse(matched.description); } catch {}
            }
            if (pObj) {
              console.log(`📦 [VideoDubbing] Tự động tìm thấy kịch bản thoại từ sản phẩm: "${matched.name}"`);
            }
          }
        } catch {}
      }

      if (pObj) {
        const parsedTurns = parseDialogueTurns(pObj, duduVoice, bubuVoice, speakerVoices);
        if (parsedTurns.length > 0) {
          console.log(`📋 [VideoDubbing] Đã trích xuất ${parsedTurns.length} lượt thoại phân vai chuẩn xác từ kịch bản:`);
          parsedTurns.forEach((t) => {
            console.log(`   [${t.startSec}s | Part ${t.part}] ${t.speaker}: "${t.text}"`);
          });
          lines = parsedTurns.map((t) => ({
            startSec: t.startSec,
            speaker: t.speaker,
            speakerId: t.speakerId,
            voiceId: t.voiceId,
            text: t.text,
            part: t.part,
          }));
        }
      }
    }

    // Nếu vẫn trống, dùng bộ preset chuẩn
    if (lines.length === 0) {
      console.log(`ℹ️ [VideoDubbing] Dùng bộ kịch bản mẫu chuẩn 12 câu thoại theo timeline 60s.`);
      lines = DEFAULT_PRESET_LINES.map(l => ({
        ...l,
        speakerId: l.speaker === "DuDu_NamChinh" ? "dudu" : "bubu",
        voiceId: l.speaker === "DuDu_NamChinh" ? duduVoice : bubuVoice,
      }));
    }

    console.log(`🎙️ [VideoDubbing] Đã nạp ${lines.length} câu thoại cho video.`);

    const unresolvedSpeakers = [...new Set(lines.filter(line => !line.voiceId).map(line => line.speaker))];
    if (unresolvedSpeakers.length > 0) {
      throw new Error(
        `Chưa cấu hình giọng cho nhân vật: ${unresolvedSpeakers.join(", ")}. `
        + `Hãy thêm nhân vật vào Character Registry hoặc truyền speaker_voices.`
      );
    }

    // 3. Chuẩn bị thư mục tạm để sinh âm thanh
    tempDir = path.resolve(__dirname, `../scratch/dub_temp_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const generatedSegments: { path: string; startSec: number; speaker: string; text: string }[] = [];

    // Nhóm câu thoại theo Part để căn thời gian động chuẩn xác cho từng cảnh
    const partGroups: Record<number, typeof lines> = {};
    for (const item of lines) {
      const p = item.part || Math.max(1, Math.floor(item.startSec / 10.0) + 1);
      if (!partGroups[p]) partGroups[p] = [];
      partGroups[p].push({ ...item, part: p });
    }

    let clipCounter = 0;
    const maxPart = Math.max(1, ...Object.keys(partGroups).map(Number).filter(Number.isFinite));
    for (let p = 1; p <= maxPart; p++) {
      const pLines = partGroups[p] || [];
      if (pLines.length === 0) continue;

      const partBase = (p - 1) * 10.0;
      // Dùng startSec của câu đầu tiên (từ parseDialogueTurns đã phân tích nội dung cảnh)
      const firstLineOffset = pLines[0].startSec - partBase;
      // currentPartTime chỉ dùng làm sàn (floor) chống chồng lấn audio, KHÔNG phải nguồn timing chính
      let currentPartTime = pLines[0].startSec;
      console.log(`🎬 [VideoDubbing] Part ${p}: bắt đầu thoại tại ${currentPartTime.toFixed(1)}s (scene offset: ${firstLineOffset.toFixed(1)}s, ${pLines.length} câu)`);

      for (let j = 0; j < pLines.length; j++) {
        const item = pLines[j];
        const rawWav = path.join(tempDir, `raw_${clipCounter}.wav`);
        const trimmedWav = path.join(tempDir, `line_${String(clipCounter).padStart(3, "0")}.wav`);
        const voiceToUse = item.voiceId
          || speakerVoices[item.speakerId || normalizeSpeakerId(item.speaker)]
          || resolveSpeakerVoice(item.speaker, speakerVoices, duduVoice, bubuVoice).voiceId;

        console.log(`⏳ [VideoDubbing] (Part ${p}/${j + 1}) [${voiceToUse}] "${item.text.slice(0, 35)}..."`);
        await generateSpeechWithVieneu({
          text: item.text,
          outputPath: rawWav,
          voice: voiceToUse,
          temperature: voiceTemperature,
          topP: 0.9,
          applyWatermark: false,
        });

        if (fs.existsSync(rawWav) && fs.statSync(rawWav).size > 0) {
          // Khử khoảng lặng ở đầu và cuối để âm thanh bắt vào ngay tức thì, không bị delay
          try {
            await execAsync(
              `ffmpeg -y -i "${rawWav}" -af "silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB:detection=peak,areverse,silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB:detection=peak,areverse" -ar 44100 "${trimmedWav}"`
            );
          } catch {
            fs.copyFileSync(rawWav, trimmedWav);
          }

          let dur = 2.5;
          try {
            const probeOut = execSync(
              `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${trimmedWav}"`,
              { encoding: "utf-8" }
            );
            const parsedD = parseFloat(probeOut.trim());
            if (!isNaN(parsedD) && parsedD > 0) dur = parsedD;
          } catch (probeErr: any) {
            console.warn(`ffprobe check: ${probeErr.message}`);
          }

          // ═══ TIMING CHÍNH: Ưu tiên startSec gốc từ parseDialogueTurns ═══
          // parseDialogueTurns đã tính startSec từ Veo prompt timestamps (nếu có)
          // hoặc từ heuristic phân tích cảnh. Chỉ dùng currentPartTime khi cần chống chồng lấn.
          let targetStart = item.startSec;
          if (j > 0 && targetStart < currentPartTime) {
            // Audio trước chưa kết thúc → đẩy lên để không chồng lấn
            console.log(`   ⚠️ Chống chồng lấn: ${targetStart.toFixed(1)}s → ${currentPartTime.toFixed(1)}s (audio trước kết thúc tại ${currentPartTime.toFixed(1)}s)`);
            targetStart = currentPartTime;
          }

          // Nếu thời lượng câu thoại vượt quá khung 10s của Part, tự động tăng tốc nhẹ với atempo
          const remainingTime = (partBase + 9.6) - targetStart;
          if (dur > remainingTime && remainingTime > 1.0) {
            const speedRatio = Math.min(1.25, Math.max(1.05, dur / remainingTime));
            const speedWav = path.join(tempDir, `speed_${clipCounter}.wav`);
            try {
              await execAsync(`ffmpeg -y -i "${trimmedWav}" -af "atempo=${speedRatio.toFixed(2)}" -ar 44100 "${speedWav}"`);
              if (fs.existsSync(speedWav)) {
                fs.renameSync(speedWav, trimmedWav);
                dur = dur / speedRatio;
              }
            } catch {}
          }

          const lineStartSec = Number(targetStart.toFixed(2));
          console.log(`   ✨ Khớp mốc: [${lineStartSec}s -> ${(lineStartSec + dur).toFixed(2)}s] (Thời lượng: ${dur.toFixed(2)}s)`);

          generatedSegments.push({
            path: trimmedWav,
            startSec: lineStartSec,
            speaker: voiceToUse,
            text: item.text,
          });

          // Floor cho câu tiếp theo: kết thúc audio hiện tại + khoảng thở tự nhiên 0.3s
          currentPartTime = lineStartSec + dur + 0.3;
          clipCounter++;
        }
      }
    }

    // 4. Khử giọng nói gốc bằng Demucs AI (chỉ giữ âm thanh nền & SFX)
    const origAudio = path.join(tempDir, "orig_audio.wav");
    await execAsync(`ffmpeg -y -i "${mergedVideoPath}" -vn -acodec pcm_s16le -ar 44100 -ac 2 "${origAudio}"`);

    let cleanBgAudio = origAudio;
    const localNoVocals = path.join(downloadsDir, "no_vocals.wav");
    const scratchNoVocals = path.resolve(__dirname, "../scratch/bat_ca_dub/demucs_out/htdemucs/bat_ca_orig_audio/no_vocals.wav");

    if (fs.existsSync(localNoVocals) && fs.statSync(localNoVocals).size > 1000) {
      cleanBgAudio = localNoVocals;
      console.log(`🎵 [VideoDubbing] Tìm thấy âm thanh nền đã khử sạch giọng nói: ${localNoVocals}`);
    } else if (productSlug.includes("bat-ca") && fs.existsSync(scratchNoVocals)) {
      cleanBgAudio = scratchNoVocals;
      console.log(`🎵 [VideoDubbing] Dùng âm thanh nền chất lượng cao từ Demucs: ${scratchNoVocals}`);
    } else {
      try {
        console.log(`🧹 [VideoDubbing] Đang chạy Demucs AI để khử 100% tiếng nói gốc từ Veo...`);
        const demucsOutDir = path.join(tempDir, "demucs_out");
        await execAsync(`uvx --with numpy demucs --two-stems vocals -o "${demucsOutDir}" "${origAudio}"`, { timeout: 180000 });
        const trackBaseName = path.basename(origAudio, path.extname(origAudio));
        const demucsNoVocals = path.join(demucsOutDir, "htdemucs", trackBaseName, "no_vocals.wav");
        if (fs.existsSync(demucsNoVocals) && fs.statSync(demucsNoVocals).size > 1000) {
          fs.copyFileSync(demucsNoVocals, localNoVocals);
          cleanBgAudio = localNoVocals;
          console.log(`✅ [VideoDubbing] Đã khử sạch giọng nói gốc! Âm thanh nền lưu tại: ${localNoVocals}`);
        }
      } catch (demucsErr: any) {
        console.warn(`⚠️ [VideoDubbing] Demucs không thành công (${demucsErr.message}), dùng âm thanh gốc hạ volume.`);
      }
    }

    // 5. Hòa âm FFmpeg: gộp các voice clips + âm nền sạch (chuẩn hóa normalize=0 để không bị suy hao âm lượng)
    const mixedAudio = path.join(tempDir, "mixed_audio.wav");
    const inputArgs = [`-i "${cleanBgAudio}"`];
    const delayFilters: string[] = [];
    const voiceInputs: string[] = [];

    for (let idx = 0; idx < generatedSegments.length; idx++) {
      const seg = generatedSegments[idx];
      inputArgs.push(`-i "${seg.path}"`);
      const inIdx = idx + 1; // 0 là cleanBgAudio
      const delayMs = Math.max(0, Math.round(seg.startSec * 1000));
      const label = `v${inIdx}`;
      delayFilters.push(`[${inIdx}:a]adelay=${delayMs}|${delayMs}[${label}]`);
      voiceInputs.push(`[${label}]`);
    }

    const numVoices = voiceInputs.length;
    let fullMixFilter = "";

    if (numVoices > 0) {
      fullMixFilter = `${delayFilters.join("; ")}; `
        + `${voiceInputs.join("")}amix=inputs=${numVoices}:duration=longest:dropout_transition=0:normalize=0,volume=1.25[voices]; `
        + `[0:a]volume=${bgmVolume}[bg]; `
        + `[bg][voices]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
    } else {
      fullMixFilter = `[0:a]volume=${bgmVolume},loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
    }

    const ffmpegMixCmd = `ffmpeg -y ${inputArgs.join(" ")} -filter_complex "${fullMixFilter}" -map "[aout]" -ar 48000 "${mixedAudio}"`;
    console.log(`🎚️ [VideoDubbing] Đang hòa âm và cân bằng loudness chuẩn -16 LUFS...`);
    await execAsync(ffmpegMixCmd, { maxBuffer: 50 * 1024 * 1024 });

    // 6. Ghép audio đã lồng vào video (Copy video stream, không re-encode hình)
    // Đặt tên theo chuẩn _longtieng_time (VD: [slug]_longtieng_20260918_113520.mp4)
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const timeStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const voicedFilename = `${productSlug}_longtieng_${timeStr}.mp4`;
    const voicedVideoPath = path.join(downloadsDir, voicedFilename);

    console.log(`🎬 [VideoDubbing] Đang ghép video hoàn chỉnh vào: ${voicedVideoPath}`);
    const remuxCmd = `ffmpeg -y -i "${mergedVideoPath}" -i "${mixedAudio}" -c:v copy -c:a aac -b:a 192k -map 0:v:0 -map 1:a:0 -shortest "${voicedVideoPath}"`;
    await execAsync(remuxCmd);

    // Đồng thời đồng bộ sang ${productSlug}_voiced.mp4 để giữ tương thích ngược
    try {
      const canonicalPath = path.join(downloadsDir, `${productSlug}_voiced.mp4`);
      fs.copyFileSync(voicedVideoPath, canonicalPath);
    } catch {}

    // Copy thêm 1 bản ra thư mục ~/Downloads để tiện phát ngay
    try {
      const homeDownloads = path.join(process.env.HOME || "/Users/letrongthien", "Downloads", voicedFilename);
      fs.copyFileSync(voicedVideoPath, homeDownloads);
      console.log(`📁 [VideoDubbing] Đã sao lưu 1 bản ra: ${homeDownloads}`);
    } catch {}

    const streamUrl = `/downloads/${activeJobFolder}/${voicedFilename}`;
    console.log(`🎉 [VideoDubbing] Lồng tiếng thành công! File xuất: ${voicedVideoPath}`);

    // Dọn dẹp thư mục tạm
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}

    return {
      success: true,
      voicedVideoPath,
      voicedFilename,
      streamUrl,
      totalLines: generatedSegments.length,
    };
  } catch (err: any) {
    console.error(`❌ [VideoDubbing] Lỗi: ${err.message}`);
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
    throw err;
  }
}
