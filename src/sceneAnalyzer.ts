import { callAgy, isAgyEnabled } from "./agyClient.js";
import { callCodexSol, isCodexEnabled } from "./codexClient.js";

export const ALLOWED_SCENE_COUNTS = [3, 4, 5, 6, 8, 10, 12, 15, 18] as const;
export type AllowedSceneCount = (typeof ALLOWED_SCENE_COUNTS)[number];

export const SCENE_OPTIONS = [
  { count: 8, label: '⭐ 8 Cảnh (~80s)', sublabel: 'Short 80s Chuẩn (Mặc định)' },
  { count: 3, label: '⚡ 3 Cảnh (~30s)', sublabel: 'Short 30s Nhanh' },
  { count: 4, label: '⚡ 4 Cảnh (~40s)', sublabel: 'Short 40s Vừa vặn' },
  { count: 5, label: '⚡ 5 Cảnh (~50s)', sublabel: 'Short 50s Súc tích' },
  { count: 6, label: '🎬 6 Cảnh (~60s)', sublabel: 'Short 60s Tình huống' },
  { count: 10, label: '🌟 10 Cảnh (~100s)', sublabel: 'Ngụ Ngôn & Veo' },
  { count: 12, label: '📖 12 Cảnh (~2 Phút)', sublabel: 'Cổ Tích Đầy Đủ' },
  { count: 15, label: '🔥 15 Cảnh (~2.5 Phút)', sublabel: 'Đua Tài / Cao Trào' },
  { count: 18, label: '🎬 18 Cảnh (~3 Phút)', sublabel: 'Kịch Bản Dài' },
] as const;

export interface SceneSuggestionResult {
  suggested_scenes: AllowedSceneCount;
  label: string;
  reason: string;
  breakdown?: string[];
  source: 'heuristic' | 'ai';
}

export function snapToAllowedSceneCount(n: number): AllowedSceneCount {
  let closest: AllowedSceneCount = 8;
  let minDiff = Infinity;
  for (const c of ALLOWED_SCENE_COUNTS) {
    const diff = Math.abs(c - n);
    if (diff < minDiff) {
      minDiff = diff;
      closest = c;
    }
  }
  return closest;
}

export function analyzeStorySceneCountHeuristic(text: string): SceneSuggestionResult {
  const raw = (text || '').trim();
  const words = raw.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (wordCount < 5) {
    return {
      suggested_scenes: 8,
      label: '⭐ 8 Cảnh (~80s)',
      reason: 'Mặc định chuẩn 8 Cảnh cho video ngắn.',
      source: 'heuristic',
    };
  }

  // 1. Explicit scene / chapter markers
  const scenePattern = /(?:cảnh|phần|tập|bước|scene|step|part)\s*(\d+)[\s:.-]/gi;
  const explicitMatches = [...raw.matchAll(scenePattern)];
  if (explicitMatches.length >= 2) {
    const numbers = explicitMatches.map(m => parseInt(m[1], 10)).filter(n => !isNaN(n) && n > 0 && n <= 24);
    if (numbers.length >= 2) {
      const maxScene = Math.max(...numbers);
      const snapped = snapToAllowedSceneCount(maxScene);
      const opt = SCENE_OPTIONS.find(o => o.count === snapped);
      return {
        suggested_scenes: snapped,
        label: opt ? opt.label : `${snapped} Cảnh`,
        reason: `Phát hiện cốt truyện đã phân chia sẵn ${maxScene} phân đoạn/cảnh.`,
        source: 'heuristic',
      };
    }
  }

  // 2. Numbered list
  const numberedPattern = /(?:^|\n)\s*(\d+)[.)]\s+/g;
  const numMatches = [...raw.matchAll(numberedPattern)];
  if (numMatches.length >= 3) {
    const numbers = numMatches.map(m => parseInt(m[1], 10)).filter(n => !isNaN(n) && n > 0 && n <= 24);
    if (numbers.length >= 3) {
      const maxNum = Math.max(...numbers);
      const snapped = snapToAllowedSceneCount(maxNum);
      const opt = SCENE_OPTIONS.find(o => o.count === snapped);
      return {
        suggested_scenes: snapped,
        label: opt ? opt.label : `${snapped} Cảnh`,
        reason: `Cốt truyện có sẵn ${maxNum} bước/diễn biến dạng danh sách.`,
        source: 'heuristic',
      };
    }
  }

  // 3. Dialogue turns
  const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let dialogueCount = 0;
  let hasIntro = false;
  const dialogueStartRegex = /^[-–—*•"“'‘]/;
  const speechVerbRegex = /(nói|bảo|hỏi|đáp|kêu lên|thì thào|hét lên|trả lời|nhủ|quát|bàn nhậu|cười|said|replied|câu được)/i;

  lines.forEach((line, idx) => {
    const isDialogue = dialogueStartRegex.test(line) || /:\s*["“']/.test(line) || (idx > 0 && speechVerbRegex.test(line));
    if (isDialogue) {
      dialogueCount++;
    } else if (idx === 0) {
      hasIntro = true;
    }
  });

  let estimatedBeats = (hasIntro ? 1 : 0) + dialogueCount;
  if (dialogueCount < 2) {
    const inlineQuotes = (raw.match(/["“][^"”]+["”]/g) || []).length;
    const inlineDashes = (raw.match(/(?:^|\s)[-–—]\s+[A-ZÀ-Ỹ]/g) || []).length;
    const detectedTurns = Math.max(inlineQuotes, inlineDashes);
    if (detectedTurns >= 2) {
      estimatedBeats = (hasIntro ? 1 : 0) + detectedTurns;
      dialogueCount = detectedTurns;
    }
  }

  let wordBasedCount: AllowedSceneCount = 8;
  if (wordCount < 50) {
    wordBasedCount = 3;
  } else if (wordCount < 110) {
    wordBasedCount = 4;
  } else if (wordCount < 170) {
    wordBasedCount = 5;
  } else if (wordCount < 240) {
    wordBasedCount = 6;
  } else if (wordCount < 380) {
    wordBasedCount = 8;
  } else if (wordCount < 520) {
    wordBasedCount = 10;
  } else if (wordCount < 750) {
    wordBasedCount = 12;
  } else if (wordCount < 1050) {
    wordBasedCount = 15;
  } else {
    wordBasedCount = 18;
  }

  let finalCount: AllowedSceneCount = wordBasedCount;
  let reason = '';

  if (dialogueCount >= 2 && estimatedBeats >= 3 && estimatedBeats <= 8) {
    finalCount = snapToAllowedSceneCount(estimatedBeats);
    reason = `Cốt truyện gồm ${hasIntro ? '1 đoạn mở đầu + ' : ''}${dialogueCount} lượt đối thoại (~${wordCount} từ) → Rất vừa vặn với ${finalCount} Cảnh.`;
  } else if (wordCount < 110) {
    finalCount = wordBasedCount;
    reason = `Cốt truyện ngắn gọn (~${wordCount} từ) → Phù hợp ${finalCount} Cảnh để giữ nhịp điệu nhanh, dứt khoát.`;
  } else if (wordCount >= 520) {
    finalCount = wordBasedCount;
    reason = `Cốt truyện tự sự dài, nhiều tình tiết (~${wordCount} từ) → Khuyên dùng ${finalCount} Cảnh để đủ thời lượng dẫn dắt.`;
  } else {
    finalCount = wordBasedCount;
    reason = `Dung lượng ~${wordCount} từ → Tiêu chuẩn ${finalCount} Cảnh (~${finalCount * 10}s) chuẩn định dạng video ngắn.`;
  }

  const opt = SCENE_OPTIONS.find(o => o.count === finalCount);
  return {
    suggested_scenes: finalCount,
    label: opt ? opt.label : `${finalCount} Cảnh`,
    reason,
    source: 'heuristic',
  };
}

export async function suggestScenesWithAi(
  description: string,
  productName: string = ''
): Promise<SceneSuggestionResult> {
  const fallback = analyzeStorySceneCountHeuristic(description);
  if (!description || !description.trim()) return fallback;

  const systemPrompt = `Bạn là đạo diễn kịch bản video ngắn (Shorts / Reels / TikTok) chuyên nghiệp cho Veo AI video generation.
Mỗi cảnh (scene) tương ứng với đúng 10 giây video độc lập.
Nhiệm vụ: Phân tích cốt truyện được cung cấp và đề xuất số lượng phân cảnh video tối ưu nhất.

QUY TẮC BẮT BUỘC:
1. Số lượng cảnh đề xuất (suggested_scenes) BẮT BUỘC phải là 1 trong các số sau: [3, 4, 5, 6, 8, 10, 12, 15, 18].
   - 3 Cảnh (~30s): Truyện ngắn/joke siêu nhanh, 1 intro + 2 thoại/nhịp.
   - 4 Cảnh (~40s): Truyện cười 3-4 nhân vật/nhịp thoại, punchline bất ngờ ở cuối (VD: 3 con chuột lè nhè).
   - 5 Cảnh (~50s): Kịch bản ngắn gọn có cao trào rõ ràng.
   - 6 Cảnh (~60s): Tình huống kịch tính tròn 1 phút.
   - 8 Cảnh (~80s): Chuẩn video ngắn cốt truyện đầy đủ (Mặc định).
   - 10-12 Cảnh: Truyện ngụ ngôn, cổ tích trung bình.
   - 15-18 Cảnh: Kịch bản dài, nhiều chương hồi, cao trào phức tạp.
2. Trả về ĐÚNG ĐỊNH DẠNG JSON sau:
{
  "suggested_scenes": <chỉ chọn từ 3, 4, 5, 6, 8, 10, 12, 15, 18>,
  "reason": "<1 câu tiếng Việt súc tích giải thích tại sao số cảnh này là tốt nhất>",
  "breakdown": [
    "Cảnh 1: <tóm tắt ngắn nội dung cảnh 1>",
    "Cảnh 2: <tóm tắt ngắn nội dung cảnh 2>",
    ...
  ]
}`;

  const userPrompt = `Tên tác phẩm / sản phẩm: ${productName || 'Không có'}
Cốt truyện gốc:
"""
${description.trim()}
"""`;

  try {
    let aiResponseStr = '';
    if (isAgyEnabled()) {
      aiResponseStr = await callAgy(systemPrompt, userPrompt, true, 'gemini-3.8-flash-low');
    } else if (isCodexEnabled()) {
      aiResponseStr = await callCodexSol(systemPrompt, userPrompt, true);
    } else {
      return fallback;
    }

    // Parse JSON
    const cleanJson = aiResponseStr.replace(/```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleanJson);
    const suggestedNum = snapToAllowedSceneCount(Number(parsed.suggested_scenes) || fallback.suggested_scenes);
    const opt = SCENE_OPTIONS.find(o => o.count === suggestedNum);

    return {
      suggested_scenes: suggestedNum,
      label: opt ? opt.label : `${suggestedNum} Cảnh`,
      reason: String(parsed.reason || fallback.reason).trim(),
      breakdown: Array.isArray(parsed.breakdown) ? parsed.breakdown.map((s: any) => String(s).trim()) : undefined,
      source: 'ai',
    };
  } catch (err: any) {
    console.warn(`⚠️ [suggestScenesWithAi] AI call failed, falling back to heuristic: ${err.message}`);
    return fallback;
  }
}
