export interface SceneOption {
  count: number;
  label: string;
  sublabel: string;
  fullLabel: string;
}

export const ALLOWED_SCENE_COUNTS = [3, 4, 5, 6, 8, 10, 12, 15, 18] as const;
export type AllowedSceneCount = (typeof ALLOWED_SCENE_COUNTS)[number];

export const SCENE_OPTIONS: SceneOption[] = [
  { count: 8, label: '⭐ 8 Cảnh (~80s)', sublabel: 'Short 80s Chuẩn (Mặc định)', fullLabel: '⭐ 8 Cảnh (~80s) - Short 80s Chuẩn (Mặc định)' },
  { count: 3, label: '⚡ 3 Cảnh (~30s)', sublabel: 'Short 30s Nhanh', fullLabel: '⚡ 3 Cảnh (~30s) - Short 30s Nhanh' },
  { count: 4, label: '⚡ 4 Cảnh (~40s)', sublabel: 'Short 40s Vừa vặn', fullLabel: '⚡ 4 Cảnh (~40s) - Short 40s Vừa vặn' },
  { count: 5, label: '⚡ 5 Cảnh (~50s)', sublabel: 'Short 50s Súc tích', fullLabel: '⚡ 5 Cảnh (~50s) - Short 50s Súc tích' },
  { count: 6, label: '🎬 6 Cảnh (~60s)', sublabel: 'Short 60s Tình huống', fullLabel: '🎬 6 Cảnh (~60s) - Short 60s Tình huống' },
  { count: 10, label: '🌟 10 Cảnh (~100s)', sublabel: 'Ngụ Ngôn & Veo', fullLabel: '🌟 10 Cảnh (~100s) - Ngụ Ngôn & Veo' },
  { count: 12, label: '📖 12 Cảnh (~2 Phút)', sublabel: 'Cổ Tích Đầy Đủ', fullLabel: '📖 12 Cảnh (~2 Phút) - Cổ Tích Đầy Đủ' },
  { count: 15, label: '🔥 15 Cảnh (~2.5 Phút)', sublabel: 'Đua Tài / Cao Trào', fullLabel: '🔥 15 Cảnh (~2.5 Phút) - Đua Tài / Cao Trào' },
  { count: 18, label: '🎬 18 Cảnh (~3 Phút)', sublabel: 'Kịch Bản Dài', fullLabel: '🎬 18 Cảnh (~3 Phút) - Kịch Bản Dài' },
];

export interface SceneSuggestion {
  count: AllowedSceneCount;
  label: string;
  reason: string;
  breakdown?: string[];
  isExplicit?: boolean;
}

/**
 * Snap any integer to the nearest allowed scene count: [3, 4, 5, 6, 8, 10, 12, 15, 18]
 */
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

/**
 * Heuristically analyzes story / description text to recommend the optimal scene count.
 */
export function analyzeStorySceneCount(text: string): SceneSuggestion | null {
  if (!text || !text.trim()) return null;

  const raw = text.trim();
  const words = raw.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (wordCount < 5) return null;

  // 1. Detect explicit scene markers like "Cảnh 1", "Cảnh 2", "Scene 1", "Phần 1", "Tập 1"
  const scenePattern = /(?:cảnh|phần|tập|bước|scene|step|part)\s*(\d+)[\s:.-]/gi;
  const explicitMatches = [...raw.matchAll(scenePattern)];
  if (explicitMatches.length >= 2) {
    const numbers = explicitMatches.map(m => parseInt(m[1], 10)).filter(n => !isNaN(n) && n > 0 && n <= 24);
    if (numbers.length >= 2) {
      const maxScene = Math.max(...numbers);
      const snapped = snapToAllowedSceneCount(maxScene);
      const opt = SCENE_OPTIONS.find(o => o.count === snapped);
      return {
        count: snapped,
        label: opt ? opt.label : `${snapped} Cảnh`,
        reason: `Phát hiện cốt truyện được đánh số sẵn (${maxScene} cảnh/phần).`,
        isExplicit: true,
      };
    }
  }

  // 2. Detect numbered list items like "1.", "2.", "3."
  const numberedPattern = /(?:^|\n)\s*(\d+)[.)]\s+/g;
  const numMatches = [...raw.matchAll(numberedPattern)];
  if (numMatches.length >= 3) {
    const numbers = numMatches.map(m => parseInt(m[1], 10)).filter(n => !isNaN(n) && n > 0 && n <= 24);
    if (numbers.length >= 3) {
      const maxNum = Math.max(...numbers);
      const snapped = snapToAllowedSceneCount(maxNum);
      const opt = SCENE_OPTIONS.find(o => o.count === snapped);
      return {
        count: snapped,
        label: opt ? opt.label : `${snapped} Cảnh`,
        reason: `Cốt truyện có sẵn ${maxNum} bước/phân đoạn dạng danh sách.`,
        isExplicit: true,
      };
    }
  }

  // 3. Detect dialogue turns & narrative beats
  // Lines or clauses with dialogue cues
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

  // Calculate estimated beats
  let estimatedBeats = (hasIntro ? 1 : 0) + dialogueCount;
  // If dialogue lines aren't split by newline, check inline dashes/quotes
  if (dialogueCount < 2) {
    const inlineQuotes = (raw.match(/["“][^"”]+["”]/g) || []).length;
    const inlineDashes = (raw.match(/(?:^|\s)[-–—]\s+[A-ZÀ-Ỹ]/g) || []).length;
    const detectedTurns = Math.max(inlineQuotes, inlineDashes);
    if (detectedTurns >= 2) {
      estimatedBeats = (hasIntro ? 1 : 0) + detectedTurns;
      dialogueCount = detectedTurns;
    }
  }

  // 4. Word count pacing:
  // Short video Veo standard: ~20-30 words per 10s scene
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

  // 5. Harmonize dialogue beats & word pacing
  let finalCount: AllowedSceneCount = wordBasedCount;
  let reason = '';

  if (dialogueCount >= 2 && estimatedBeats >= 3 && estimatedBeats <= 8) {
    const beatSnapped = snapToAllowedSceneCount(estimatedBeats);
    finalCount = beatSnapped;
    reason = `Cốt truyện ngắn gồm ${hasIntro ? '1 đoạn dẫn + ' : ''}${dialogueCount} lượt thoại (${wordCount} từ) → Vừa vặn ${finalCount} Cảnh.`;
  } else if (wordCount < 110) {
    finalCount = wordBasedCount;
    reason = `Cốt truyện ngắn gọn (~${wordCount} từ) → Thích hợp kịch bản ngắn ${finalCount} Cảnh để giữ tiết tấu nhanh.`;
  } else if (wordCount >= 520) {
    finalCount = wordBasedCount;
    reason = `Cốt truyện phong phú, nhiều chi tiết (~${wordCount} từ) → Khuyên dùng ${finalCount} Cảnh để truyền tải trọn vẹn.`;
  } else {
    finalCount = wordBasedCount;
    reason = `Dung lượng ~${wordCount} từ → Tiêu chuẩn ${finalCount} Cảnh (~${finalCount * 10}s) chuẩn định dạng Shorts/TikTok.`;
  }

  const opt = SCENE_OPTIONS.find(o => o.count === finalCount);
  return {
    count: finalCount,
    label: opt ? opt.label : `${finalCount} Cảnh`,
    reason,
  };
}
