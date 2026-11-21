export const WORLD_STYLE_OPTIONS = [
  { id: 'auto', label: '🎬 Linh hoạt theo cốt truyện', description: 'Tự động sắp đặt bối cảnh, đạo cụ và không gian tự nhiên theo đúng cốt truyện, không gò bó.' },
  { id: 'modern', label: '🏙️ Hiện đại', description: 'Đời sống ngày nay, nhà cửa, đường phố, xe cộ và công nghệ thực tế.' },
  { id: 'medieval', label: '🏰 Trung cổ', description: 'Lâu đài, làng đá, đuốc, áo choàng và ánh sáng điện ảnh cổ điển.' },
  { id: 'western', label: '🤠 Cao bồi', description: 'Miền viễn Tây, thị trấn gỗ, sa mạc bụi đỏ và ánh hoàng hôn.' },
  { id: 'wild', label: '🐾 Hoang dã', description: 'Thiên nhiên nguyên sơ, rừng sâu, núi đá và cảm giác phiêu lưu.' },
  { id: 'natural', label: '🌿 Tự nhiên', description: 'Đồng quê, rừng cây, sông suối và ánh sáng tự nhiên dịu nhẹ.' },
  { id: 'fantasy', label: '✨ Kỳ ảo', description: 'Thế giới phép thuật, kiến trúc huyền ảo và ánh sáng thần tiên.' },
  { id: 'scifi', label: '🚀 Tương lai', description: 'Khoa học viễn tưởng, công nghệ cao, neon và kiến trúc tương lai.' },
] as const;

export type WorldStyleId = typeof WORLD_STYLE_OPTIONS[number]['id'];

export function getWorldStyleDirective(styleId: string): string {
  if (styleId === 'auto' || !styleId) {
    return 'SETTING & ENVIRONMENT: Adapt environment, outfits, props, and staging flexibly and naturally according to the user storyline and director instructions without rigid constraints.';
  }
  const style = WORLD_STYLE_OPTIONS.find((item) => item.id === styleId) || WORLD_STYLE_OPTIONS[0];
  return `WORLD STYLE GUIDELINE — ${style.label.replace(/^\S+\s*/, '')}: ${style.description} Use this era/environment mood as background context UNLESS the user's storyline or director revision explicitly specifies different characters, outfits, props, or settings (explicit user/director instructions ALWAYS take 100% priority).`;
}
