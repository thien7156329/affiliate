export type SafetyCategory =
  | "child_safety"
  | "dangerous_activity"
  | "graphic_violence"
  | "harmful_misinformation"
  | "hate_or_harassment"
  | "explicit_sexual_content";

export interface SafetyIssue {
  category: SafetyCategory;
  label: string;
  guidance: string;
  matchedTerms: string[];
}

const RULES: Array<{
  category: SafetyCategory;
  label: string;
  guidance: string;
  patterns: RegExp[];
}> = [
  {
    category: "child_safety",
    label: "An toàn trẻ em",
    guidance: "Xóa mọi nội dung tình dục hóa, bóc lột hoặc mô tả thân thể nhạy cảm liên quan đến trẻ vị thành niên.",
    patterns: [
      /(?:trẻ em|trẻ vị thành niên|bé trai|bé gái|child|minor).{0,45}(?:khỏa thân|tình dục|gợi dục|sex|nude|naked)/i,
      /(?:khỏa thân|tình dục|gợi dục|sex|nude|naked).{0,45}(?:trẻ em|trẻ vị thành niên|bé trai|bé gái|child|minor)/i,
    ],
  },
  {
    category: "dangerous_activity",
    label: "Hoạt động nguy hiểm",
    guidance: "Bỏ hướng dẫn thực hiện tự hại, chế tạo vũ khí, mua chất cấm hoặc hành vi có thể gây thương tích ngoài đời thực.",
    patterns: [
      /(?:cách|hướng dẫn|từng bước|how to|instructions?).{0,55}(?:tự tử|tự sát|tự hại|suicide|self[- ]harm)/i,
      /(?:cách|hướng dẫn|công thức|chế tạo|how to|make|build).{0,55}(?:bom|chất nổ|vũ khí|súng|bomb|explosive|weapon)/i,
      /(?:cách|hướng dẫn|mua|điều chế|how to|buy|synthesize).{0,55}(?:ma túy|thuốc phiện|cocaine|heroin|meth|illegal drugs?)/i,
    ],
  },
  {
    category: "graphic_violence",
    label: "Bạo lực hoặc máu me",
    guidance: "Chuyển xung đột thành hành động hoạt hình nhẹ, không máu me, không thương tích chi tiết và không ngược đãi động vật.",
    patterns: [
      /(?:máu me|đẫm máu|phanh thây|chặt đầu|mổ bụng|lộ nội tạng|gore|gory|dismember|decapitat|exposed organs?)/i,
      /(?:tra tấn|đánh đập|giết|hành hạ).{0,35}(?:động vật|con vật|chó|mèo|animal|dog|cat)/i,
    ],
  },
  {
    category: "harmful_misinformation",
    label: "Thông tin sai lệch có thể gây hại",
    guidance: "Không đưa tuyên bố y tế, thảm họa hoặc an toàn nghiêm trọng chưa được kiểm chứng vào nội dung như một sự thật.",
    patterns: [
      /(?:chữa khỏi|trị khỏi|thay thế bác sĩ|không cần bác sĩ|cure).{0,55}(?:ung thư|tiểu đường|đột quỵ|cancer|diabetes|stroke)/i,
      /(?:tin khẩn|cảnh báo khẩn|breaking).{0,45}(?:thảm họa|động đất|sóng thần|xả súng|disaster|earthquake|tsunami|shooting)/i,
    ],
  },
  {
    category: "hate_or_harassment",
    label: "Kích động, quấy rối hoặc phân biệt đối xử",
    guidance: "Xóa lời kêu gọi tấn công, hạ thấp nhân phẩm hoặc quy chụp một nhóm người dựa trên đặc điểm được bảo vệ.",
    patterns: [
      /(?:giết|tấn công|tiêu diệt|đánh đập|kill|attack|exterminate).{0,45}(?:chủng tộc|tôn giáo|dân tộc|người đồng tính|race|religion|ethnic|gay|trans)/i,
      /(?:chủng tộc|tôn giáo|dân tộc|người đồng tính|race|religion|ethnic|gay|trans).{0,45}(?:hạ đẳng|súc vật|đáng chết|inferior|animals?|deserve to die)/i,
    ],
  },
  {
    category: "explicit_sexual_content",
    label: "Nội dung tình dục phản cảm",
    guidance: "Loại bỏ hành vi tình dục lộ liễu, khỏa thân phản cảm, bộ phận sinh dục hoặc bạo lực tình dục.",
    patterns: [
      /(?:hiếp dâm|cưỡng hiếp|tấn công tình dục|rape|sexual assault)/i,
      /(?:quan hệ tình dục|hành vi tình dục|bộ phận sinh dục|porn|pornographic|explicit sex|genitals?)/i,
    ],
  },
];

export const GEMINI_SAFETY_DIRECTIVE = "";

export function checkContentSafety(...values: unknown[]): { safe: boolean; issues: SafetyIssue[] } {
  // Tạm thời tắt kiểm tra content safety theo yêu cầu
  return { safe: true, issues: [] };
}

export function safetyErrorPayload(issues: SafetyIssue[]) {
  return {
    success: false,
    code: "GEMINI_SAFETY_POLICY_BLOCK",
    error: "Nội dung có nguy cơ vi phạm chính sách Gemini. Hãy chỉnh lại trước khi tiếp tục.",
    issues,
  };
}
