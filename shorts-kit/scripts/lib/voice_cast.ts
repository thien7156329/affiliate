/**
 * Multi-voice stories: give every character a fixed VieNeu preset voice, all from the narrator's region
 * (Bắc / Nam / Trung) so a video never mixes accents.
 *
 * Script convention (scriptwriter): a character's spoken line is its own sentence starting with "{Role}",
 * e.g. "{Má} Con ơi, đừng ra vườn." — ghosts/spirits: "{Ma}" / "{Vong nữ}" / "{Giọng lạ}" (read with the ghost effect).
 */
type Region = "bac" | "nam" | "trung";
type Gender = "m" | "f";

/** Story-suited presets per region and gender, best storytellers first. */
const POOL: Record<Region, Record<Gender, string[]>> = {
  bac: {
    m: ["Thiện Minh", "Thiền Tâm Đức", "Thanh Bình", "Anh Khôi", "Hải Đăng", "Quốc Tuấn", "Mạnh Dũng", "Xuân Vĩnh", "Phạm Tuyên"],
    f: ["Ngọc Linh", "Quỳnh Anh", "Trúc Ly", "Ngọc Huyền", "Đoan Trang", "Mai Anh"],
  },
  nam: {
    m: ["Thái Sơn", "Đức Trí", "Minh Triết", "Adam"],
    f: ["Thục Đoan", "Mỹ Duyên", "Kim Thanh", "Thùy Dung", "Mai Bé Phương"],
  },
  trung: {
    m: ["Quang Sơn", "Thái Sơn", "Đức Trí"],
    f: ["Ngọc Trân", "Thục Đoan", "Mỹ Duyên"],
  },
};

export const regionOf = (voice: string): Region => {
  for (const r of Object.keys(POOL) as Region[]) if ([...POOL[r].m, ...POOL[r].f].includes(voice)) return r;
  return "nam";
};

/** Whole-word match that works with Vietnamese letters (JS \\b only knows ASCII). */
const words = (alts: string) => new RegExp(`(?:^|[\\s,.:;!?-])(?:${alts})(?=$|[\\s,.:;!?-])`, "iu");

const FEMALE = words("má|mẹ|bà|cô|dì|chị|thím|mợ|vợ|con gái|bé gái|cô gái|nàng|nữ|em gái|o");
const MALE = words("ba|bố|cha|tía|ông|chú|bác|cậu|anh|thầy|chồng|con trai|lão|thằng|nam|dượng");
const GHOST = words("ma|vong|hồn|quỷ|bóng|giọng lạ|tiếng lạ|người lạ mặt|oan hồn|âm binh");

const TAG = /^\s*\{([^}]{1,40})\}\s*/;

/** "{Má} Con ơi…" → {role: "Má", text: "Con ơi…"}; plain narration → role null. */
export const splitRole = (line: string): {role: string | null; text: string} => {
  const m = line.match(TAG);
  return m ? {role: m[1].trim(), text: line.slice(m[0].length).trim()} : {role: null, text: line};
};

/** Role → {voice, fx}. Distinct voices per role, never the narrator's; ghosts get the ghost effect. */
const ELDER = words("ông|bà|cụ|lão|già|ngoại|nội");
const CHILD = words("bé|con nít|thằng nhỏ|cháu|em bé|đứa nhỏ|nhóc|cu|tí|tèo");

export const castVoices = (roles: string[], narrator: string): Record<string, {voice: string; fx?: "ghost" | "elder" | "child"}> => {
  const region = regionOf(narrator);
  const used = new Set<string>([narrator]);
  const out: Record<string, {voice: string; fx?: "ghost" | "elder" | "child"}> = {};
  for (const role of [...new Set(roles)]) {
    const ghost = GHOST.test(role);
    const gender: Gender = FEMALE.test(role) ? "f" : MALE.test(role) ? "m" : ghost ? "f" : "m";
    const pool = POOL[region][gender];
    const voice = pool.find((v) => !used.has(v)) ?? pool[used.size % pool.length];
    used.add(voice);
    out[role] = ghost ? {voice, fx: "ghost"} : ELDER.test(role) ? {voice, fx: "elder"} : CHILD.test(role) ? {voice, fx: "child"} : {voice};
  }
  return out;
};
