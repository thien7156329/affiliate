import React from "react";
import {AiBackdrop, type AiBackdropItem} from "./AiBackdrop";
import {useCurrentFrame, useVideoConfig} from "remotion";
import {fade, lerp, ramp} from "../motion/anim";
import {Birds, Clouds, Land, Moon, Rain, Sea, Sky, SKIES, Stars, Sun} from "../nature";
import {Campfire, Oak, Shade, Tent} from "../props";
import {FPS, H, W} from "../theme";
import type {SceneTiming, Voice} from "../timings";
import {
  Stickman,
  type StickAccessory,
  type StickHat,
  type StickMood,
  type StickOutfit,
  type StickPose,
  type StickProp,
  type StickAge,
  type StickGender,
} from "./Stickman";

export type StickmanSetting =
  | "royal_palace"
  | "peach_banquet"
  | "imperial_court"
  | "imperial_garden"
  | "ancient_village"
  | "coding_desk"
  | "ai_server_lab"
  | "debugging_board"
  | "classroom_school"
  | "hospital_clinic"
  | "highway_ev"
  | "cafe_table"
  | "charging_station"
  | "toll_booth"
  | "hotel_room"
  | "seafood_diner"
  | "beach_sunset"
  | "office_board"
  | "bank_finance"
  | "supermarket"
  | "city_street"
  | "park_dawn"
  | "gold_vault"
  | "mountain_chart"
  | "fed_rate_room"
  | "interview_room"
  | "remote_workspace"
  | "library_study"
  | "street_vendor"
  | "sidewalk_tea"
  | "race_track"
  | "custom_scene";

export type StickmanBgTheme =
  | "night_street"
  | "city_day"
  | "indoor_warm"
  | "indoor_modern"
  | "dramatic_dark"
  | "hospital_clean"
  | "nature_outdoor"
  | "luxury_gold";

export type StickmanAction =
  | "inspect_car"
  | "chat_table"
  | "charge_ev"
  | "pass_toll"
  | "check_bill"
  | "present_board"
  | "compare_two"
  | "relax_celebrate"
  | "driving_car"
  | "eating_drinking"
  | "climbing_peak"
  | "analyzing_board"
  | "typing_desk"
  | "carrying_load"
  | "panic_run"
  | "sword_duel";

export type StickmanSceneAct = {
  /** Scene id: hook | problem | layer1 | layer2 | hardest | payoff | share */
  id: string;
  setting: StickmanSetting;
  action: StickmanAction;
  /** Left character name (defaults to "Tèo") */
  charLeft?: string;
  /** Right character name (defaults to "Tí") */
  charRight?: string;
  /** Left character headwear */
  leftHat?: StickHat;
  /** Right character headwear */
  rightHat?: StickHat;
  /** Left character neck/chest accessory ("gold_chain" for Đại Gia, "scammer_bling" for Ông Lùa Gà, "necktie" for Chuyên Gia) */
  leftAccessory?: StickAccessory;
  /** Right character neck/chest accessory */
  rightAccessory?: StickAccessory;
  /** Left character torso outfit */
  leftOutfit?: StickOutfit;
  /** Right character torso outfit */
  rightOutfit?: StickOutfit;
  /** Override left character handheld prop */
  leftProp?: StickProp;
  /** Override right character handheld prop */
  rightProp?: StickProp;
  /** Optional AI-generated SVG markup for any custom handheld prop/weapon in left character's hand */
  leftCustomPropSvg?: string;
  /** Optional AI-generated SVG markup for any custom handheld prop/weapon in right character's hand */
  rightCustomPropSvg?: string;
  /** Top storyboard card badge (e.g., "CHẶNG 1 • KHỞI HÀNH") */
  badge: string;
  /** Top storyboard card main headline (e.g., "VF6 ĐI VŨNG TÀU 2N1Đ") */
  title: string;
  /** Left stat pill on the storyboard card (e.g., "Quãng đường: ~200 km") */
  statLeft: string;
  /** Right stat pill on the storyboard card (e.g., "Tổng chi: ~1,2 Triệu") */
  statRight: string;
  /** Highlight bar ratio 0..100 for visual comparison */
  progressValue?: number;
  /** Natural conversational lines for the characters in this scene (1 per sentence in the scene) */
  dialogues: string[];
  /** Explicit speaker per line in this scene ("left" = charLeft, "right" = charRight) */
  speakers?: ("left" | "right")[];
  /** Scene character composition: "solo" (1), "duo" (2), "trio" (3), or "crowd" (4 characters interacting) */
  mode?: "solo" | "duo" | "trio" | "crowd";
  /** Optional 3rd character name (e.g., "Khách Mua", "Chú Hàng Nước", "Đoàn Kiểm Tra") */
  charThird?: string;
  thirdHat?: StickHat;
  /** Third character outfit (era clothes: ao_ba_ba, ao_dai, ao_the…) */
  thirdOutfit?: StickOutfit;
  thirdProp?: StickProp;
  /** AI-generated custom SVG markup (<rect>, <circle>, <path>, <polygon>, <text>, <g>) centered at (0,0) on the floor for any novel object/vehicle/item */
  customSvg?: string;
  /** Optional array of AI-generated custom SVG illustrations per beat (every 2 sentences) within this scene so visuals evolve continuously with the script */
  customSvgBeats?: string[];
  /** Atmospheric backdrop palette when rendering a custom scene so no old furniture/boards are recycled */
  bgTheme?: StickmanBgTheme;
  /** Life stage / gender of each slot (child, teen, adult, elder · m, f). */
  leftAge?: StickAge;
  rightAge?: StickAge;
  thirdAge?: StickAge;
  leftGender?: StickGender;
  rightGender?: StickGender;
  thirdGender?: StickGender;
  /** Per-sentence acting (one entry per narration line of this scene): overrides pose/mood/prop/position. */
  lineBeats?: StickmanLineBeat[];
};

/** How one character acts on one narration line. Every field optional: missing → the stage's automatic choice. */
export type StickmanCharBeat = {
  pose?: StickPose;
  mood?: StickMood;
  prop?: StickProp;
  /** Where to stand on this line (relative to the home spot): walks there over ~0.6 s. */
  move?: "stay" | "forward" | "back" | "left" | "right" | "near" | "far";
  /** Trembling (fear, cold, shock). */
  shake?: boolean;
  /** Story mode: off stage on this line (fades out / back in). */
  hidden?: boolean;
  /** Story mode: this character is the one speaking this line (lip-sync + bubble-free). */
  speak?: boolean;
};
export type StickmanLineBeat = {
  left?: StickmanCharBeat;
  right?: StickmanCharBeat;
  third?: StickmanCharBeat;
  /** Sound effect for this line (see STORY_SFX in shared/audio/Sfx). */
  sfx?: string;
  /** Seconds the voice stays silent after this line so the effect plays alone (0 = under the voice). */
  sfxPause?: number;
  /** StoryCamera: zoom onto a face for an emotional line. */
  camera?: "wide" | "push" | "medium_left" | "medium_right" | "medium_center" | "closeup_left" | "closeup_right" | "closeup_center";
  /** Scene sound from this line on (story mode): crickets | rain | wind | clock | none */
  ambience?: string;
  /** StoryCamera: 0 calm … 3 terrifying → darker, sepia, vignette. */
  tension?: number;
  /** StoryCamera: time/place title written into the scene ("Rằm tháng Bảy – 2022"). */
  card?: string;
};

/**
 * Pose change without a jump: the new pose is drawn at full strength while the previous pose fades out under it
 * (~10 frames), so limbs glide instead of snapping.
 */
const BlendStickman: React.FC<React.ComponentProps<typeof Stickman> & {prevPose?: StickPose; blend?: number}> = ({
  prevPose,
  blend = 1,
  ...p
}) => {
  // The ghost cross-fade (old pose drawn faded under the new one) read as a trailing shadow while walking — removed.
  // Pose changes now land on line starts only; true joint interpolation would be the proper fix.
  void prevPose;
  void blend;
  return <Stickman {...p} />;
};

const BEAT_MOVE_PX: Record<NonNullable<StickmanCharBeat["move"]>, number> = {stay: 0, forward: 70, back: -70, left: -110, right: 110, near: 0, far: 0};
/** Depth of a beat: near = walks toward the camera (bigger, lower), far = walks away (smaller, higher). */
const beatDepth = (b: StickmanCharBeat | undefined) => (b?.move === "near" ? 1 : b?.move === "far" ? -1 : 0);
/** x offset for a beat; "forward/back" are relative to the way the character faces (right-side cast is mirrored). */
const beatDx = (b: StickmanCharBeat | undefined, mirrored: boolean) => {
  const m = b?.move ?? "stay";
  const px = BEAT_MOVE_PX[m] ?? 0;
  return (m === "forward" || m === "back") && mirrored ? -px : px;
};

const HORIZON_Y = 1350;
const FLOOR_Y = 1480; // Above caption zone (y=1640..1710) and well below top storyboard card (y=240..530)

const DANGLING_BUBBLE_TAIL = new Set([
  "của", "với", "cho", "trong", "trên", "dưới", "từ", "đến", "tới", "và", "hay", "hoặc",
  "là", "bị", "được", "đang", "sẽ", "đã", "chưa", "không", "đừng", "nhưng", "vì", "do",
  "khi", "nếu", "một", "những", "các", "mỗi", "mọi", "cơ", "hành", "thuế", "phần", "mức",
]);

/** Cleanly extract a natural, readable 7–11 word conversational phrase without mid-compound truncation */
const readableBubbleFromLine = (text: string): string => {
  const clean = text.replace(/["""]/g, "").trim();
  const clauses = clean.split(/[.,!?;–—-]+/).map((s) => s.trim()).filter(Boolean);
  const first = clauses[0] || clean;
  const words = first.split(/\s+/).filter(Boolean);
  if (words.length <= 11) return first;
  const slice = words.slice(0, 10);
  while (slice.length > 5 && DANGLING_BUBBLE_TAIL.has(slice[slice.length - 1].toLowerCase())) {
    slice.pop();
  }
  return slice.join(" ") + "...";
};

/**
 * Determine whether the Left character (true) or Right character (false) speaks the current line.
 * Respects explicit `act.speakers[sceneLineIdx]`, inline speaker prefixes ("left:", "right:", or character name),
 * and Vietnamese role/pronoun semantics so dialogue is NEVER assigned to the wrong stickman!
 */
const resolveSpeakerIsLeft = (
  act: StickmanSceneAct | undefined,
  sceneLineIdx: number,
  rawDialogue: string,
  spokenNarration: string
): {isLeft: boolean; cleanDialogue: string} => {
  let clean = rawDialogue.trim();
  const leftName = (act?.charLeft || "Tèo").toLowerCase();
  const rightName = (act?.charRight || "Tí").toLowerCase();

  // 1. Check inline prefix (e.g. "L: ...", "R: ...", "Trạng Quỳnh: ...", "Nhà Vua: ...")
  const prefixMatch = clean.match(/^([^:]{1,20}):\s*(.+)$/);
  if (prefixMatch) {
    const pfx = prefixMatch[1].trim().toLowerCase();
    const body = prefixMatch[2].trim();
    if (pfx === "l" || pfx === "left" || pfx === leftName || leftName.includes(pfx)) {
      return {isLeft: true, cleanDialogue: body};
    }
    if (pfx === "r" || pfx === "right" || pfx === rightName || rightName.includes(pfx)) {
      return {isLeft: false, cleanDialogue: body};
    }
  }

  // 2. Check explicit `act.speakers[sceneLineIdx]`
  const explicit = act?.speakers?.[sceneLineIdx];
  if (explicit === "left") return {isLeft: true, cleanDialogue: clean};
  if (explicit === "right") return {isLeft: false, cleanDialogue: clean};

  // 3. Semantic Vietnamese pronoun & role matching between dialogue + narration and charLeft / charRight
  const dLower = clean.toLowerCase();
  const nLower = spokenNarration.toLowerCase();
  const leftIsKing = /(vua|hoàng thượng|chúa)/i.test(leftName);
  const rightIsKing = /(vua|hoàng thượng|chúa)/i.test(rightName);
  const leftIsOfficial = /(quan|đình thần|thị vệ)/i.test(leftName);
  const rightIsOfficial = /(quan|đình thần|thị vệ)/i.test(rightName);
  const leftIsQuynh = /(quỳnh|trạng|thần)/i.test(leftName);
  const rightIsQuynh = /(quỳnh|trạng)/i.test(rightName);

  // Royal first-person or King's speech
  if (
    /(trẫm|quả nhân|dám ăn đào|coi như không có ai|giữa triều đình mà ngươi|tha tội cho ngươi|khá lắm)/i.test(dLower) ||
    /^(nhà vua|vua nghe)/i.test(nLower)
  ) {
    if (rightIsKing) return {isLeft: false, cleanDialogue: clean};
    if (leftIsKing) return {isLeft: true, cleanDialogue: clean};
  }

  // Official / Court prosecution / Peach presenter speech
  if (
    /(dâng hoàng thượng|chiếu theo luật|xin đem chém|xin xử trảm|mâm đào tiên trường thọ)/i.test(dLower) ||
    /^(các quan|người dâng đào|một hôm lúc)/i.test(nLower)
  ) {
    if (rightIsOfficial) return {isLeft: false, cleanDialogue: clean};
    if (leftIsOfficial) return {isLeft: true, cleanDialogue: clean};
  }

  // Subject / Scholar / Trạng Quỳnh speech
  if (
    /(bẩm bệ hạ|hạ thần|thần sợ chết non|xin hoàng thượng cho thần|quả đoản thọ|đào thơm quá|đào nuốt chưa khỏi|ta vốn thích trêu|thờ vua tận trung)/i.test(
      dLower
    ) ||
    /^(trạng quỳnh|quỳnh |ông chỉ xin|hạ thần|không ngờ quả đào|vậy nên xin)/i.test(nLower)
  ) {
    if (leftIsQuynh) return {isLeft: true, cleanDialogue: clean};
    if (rightIsQuynh) return {isLeft: false, cleanDialogue: clean};
  }

  // 4. Question vs. Answer in 2-person dialogues (Left asks / initiates, Right answers / explains)
  if (sceneLineIdx === 0) return {isLeft: true, cleanDialogue: clean};
  if (clean.endsWith("?") && sceneLineIdx % 2 === 1) return {isLeft: true, cleanDialogue: clean};

  // 5. Default per-scene alternation (starts consistently at Left on line 0 of each scene)
  return {isLeft: sceneLineIdx % 2 === 0, cleanDialogue: clean};
};

/**
 * Render a fresh, atmospheric 2D comic stage canvas for scenes with custom AI-designed SVG centerpieces
 * so old recycled furniture/boards (flipchart, globe desk, FED lever, VF car) NEVER clutter the stage!
 */
const renderCustomStageSetting = (
  act: StickmanSceneAct | undefined,
  f: number,
  contextText: string,
  fallbackSetting: StickmanSetting,
  sceneIdx = 0
) => {
  const lower = `${contextText} ${act?.title ?? ""} ${act?.badge ?? ""}`.toLowerCase();
  const rawTheme: StickmanBgTheme =
    act?.bgTheme ||
    (fallbackSetting === "hospital_clinic" || /(bệnh viện|cấp cứu|y tế|bác sĩ|nạn nhân)/i.test(lower)
      ? "hospital_clean"
      : fallbackSetting === "gold_vault" || /(vàng|tài sản|két sắt|đại gia|sang trọng)/i.test(lower)
        ? "luxury_gold"
        : fallbackSetting === "city_street" || /(phố|đường|xe|đô thị|bất động sản|nhà đất|chung cư)/i.test(lower)
          ? /(đêm|tối|khuya|đèn đường)/i.test(lower)
            ? "night_street"
            : "city_day"
          : /(biển|công viên|ngoài trời|thiên nhiên|cây cối)/i.test(lower)
            ? "nature_outdoor"
            : /(nguy hiểm|cảnh báo|bi kịch|sốc|ngầm|bí mật|tâm lý|adrenaline)/i.test(lower)
              ? "dramatic_dark"
              : /(nhà|gia đình|cà phê|thư viện|ấm cúng|đọc sách)/i.test(lower)
                ? "indoor_warm"
                : "indoor_modern");

  // Anti-Repetition World Selector:
  // Even if two scenes specify the same `indoor_modern` theme, use `sceneIdx` to guarantee a unique environmental world per scene!
  const worldVariant = sceneIdx % 7;
  const theme: StickmanBgTheme =
    rawTheme === "indoor_modern" && worldVariant === 2
      ? "indoor_warm"
      : rawTheme === "indoor_modern" && worldVariant === 4
        ? "luxury_gold"
        : rawTheme;

  const palettes: Record<
    StickmanBgTheme,
    {bg: string; floor: string; line: string; accent: string; outdoor?: boolean; night?: boolean}
  > = {
    night_street: {
      bg: "linear-gradient(180deg, #090D16 0%, #111827 64%, #1E293B 100%)",
      floor: "#1E293B",
      line: "#38BDF8",
      accent: "#FACC15",
      outdoor: true,
      night: true,
    },
    city_day: {
      bg: "linear-gradient(180deg, #0EA5E9 0%, #7DD3FC 62%, #E0F2FE 100%)",
      floor: "#334155",
      line: "#FACC15",
      accent: "#38BDF8",
      outdoor: true,
    },
    indoor_warm: {
      bg: "linear-gradient(180deg, #1E1B4B 0%, #312E81 64%, #1E293B 100%)",
      floor: "#291811",
      line: "#F59E0B",
      accent: "#FDE047",
    },
    indoor_modern: {
      bg: "linear-gradient(180deg, #0F172A 0%, #1E293B 66%, #091526 100%)",
      floor: "#1E293B",
      line: "#38BDF8",
      accent: "#22C55E",
    },
    dramatic_dark: {
      bg: "linear-gradient(180deg, #18091C 0%, #2E1035 64%, #111827 100%)",
      floor: "#0F172A",
      line: "#F43F5E",
      accent: "#FACC15",
    },
    hospital_clean: {
      bg: "linear-gradient(180deg, #E0F2FE 0%, #F0F9FF 66%, #CBD5E1 100%)",
      floor: "#CBD5E1",
      line: "#0284C7",
      accent: "#EF4444",
    },
    nature_outdoor: {
      bg: "linear-gradient(180deg, #0284C7 0%, #38BDF8 64%, #BAE6FD 100%)",
      floor: "#15803D",
      line: "#86EFAC",
      accent: "#FDE047",
      outdoor: true,
    },
    luxury_gold: {
      bg: "linear-gradient(180deg, #1C1917 0%, #292524 64%, #0C0A09 100%)",
      floor: "#1C1917",
      line: "#FACC15",
      accent: "#F59E0B",
    },
  };

  const pal = palettes[theme] ?? palettes.indoor_modern;
  const pulse = 0.8 + Math.sin(f * 0.08) * 0.2;

  return (
    <div style={{position: "absolute", inset: 0, background: pal.bg}}>
      {pal.outdoor && !pal.night && <Clouds sky="day" count={4} speed={0.45} seed={3} horizon={HORIZON_Y} />}
      {pal.outdoor && pal.night && <Stars count={32} seed={11} horizon={HORIZON_Y} />}
      <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
        {/* Harmonious Environmental Horizon Backdrop (Park Trees vs City Skyline vs Warm Interior) */}
        {theme === "nature_outdoor" ? (
          <g>
            {/* Soft rolling green park hills */}
            <path
              d={`M 0 ${HORIZON_Y + 25} L 0 ${HORIZON_Y - 45} Q 220 ${HORIZON_Y - 105} 540 ${HORIZON_Y - 52} T 1080 ${HORIZON_Y - 60} L 1080 ${HORIZON_Y + 25} Z`}
              fill="#16A34A"
              opacity={0.45}
            />
            {/* Lush Cartoon Park Trees + Wooden Park Bench (from stix props.md) on the edges */}
            {[95, 205, 875, 985].map((tx, idx) => {
              const treeScale = idx % 2 === 0 ? 1.05 : 0.88;
              return (
                <g key={tx} transform={`translate(${tx}, ${HORIZON_Y + 25}) scale(${treeScale})`}>
                  <rect x={-12} y={-95} width={24} height={95} rx={6} fill="#78350F" stroke="#111827" strokeWidth={3.5} />
                  <circle cx={-28} cy={-115} r={42} fill="#15803D" stroke="#111827" strokeWidth={3.5} />
                  <circle cx={28} cy={-115} r={42} fill="#15803D" stroke="#111827" strokeWidth={3.5} />
                  <circle cx={0} cy={-148} r={48} fill="#22C55E" stroke="#111827" strokeWidth={3.5} />
                </g>
              );
            })}
            {/* Wooden Park Bench on the left promenade */}
            <g transform={`translate(135, ${HORIZON_Y + 18})`} stroke="#111827" strokeWidth={3} strokeLinecap="round">
              <rect x={-58} y={-34} width={116} height={12} rx={3} fill="#D97706" />
              <rect x={-58} y={-18} width={116} height={10} rx={3} fill="#F59E0B" />
              <rect x={-64} y={-6} width={128} height={9} rx={3} fill="#B45309" />
              <line x1={-48} y1={3} x2={-52} y2={24} strokeWidth={4.5} />
              <line x1={48} y1={3} x2={52} y2={24} strokeWidth={4.5} />
            </g>
          </g>
        ) : pal.outdoor ? (
          <g>
            {/* Soft distant horizon silhouette across the background */}
            <path
              d={`M 0 ${HORIZON_Y + 25} L 0 ${HORIZON_Y - 55} Q 180 ${HORIZON_Y - 95} 360 ${HORIZON_Y - 48} T 720 ${HORIZON_Y - 62} T 1080 ${HORIZON_Y - 50} L 1080 ${HORIZON_Y + 25} Z`}
              fill={pal.night ? "rgba(15, 23, 42, 0.72)" : "rgba(15, 23, 42, 0.18)"}
            />
            {[78, 195, 885, 1002].map((bx, i) => {
              const bh = 165 + (i % 2) * 70;
              return (
                <g key={bx} opacity={0.62}>
                  <rect x={bx - 46} y={HORIZON_Y - bh + 25} width={92} height={bh} rx={6} fill="#0F172A" stroke="#1E293B" strokeWidth={2} />
                  {[0, 1, 2, 3].map((r) => (
                    <rect
                      key={r}
                      x={bx - 28}
                      y={HORIZON_Y - bh + 42 + r * 34}
                      width={56}
                      height={12}
                      rx={2}
                      fill={pal.night ? "#FACC15" : "#BAE6FD"}
                      opacity={0.78}
                    />
                  ))}
                </g>
              );
            })}
            {/* Urban Streetlamp with Warm Light Cone (from stix props.md) */}
            <g transform={`translate(965, ${HORIZON_Y + 25})`}>
              <polygon points="-28,-220 12,-220 68,0 -84,0" fill="#FDE047" opacity={pal.night ? 0.16 : 0.07} />
              <line x1={0} y1={0} x2={0} y2={-225} stroke="#1E293B" strokeWidth={8} strokeLinecap="round" />
              <path d="M 0 -225 Q -18 -235 -28 -220" fill="none" stroke="#1E293B" strokeWidth={6} strokeLinecap="round" />
              <ellipse cx={-28} cy={-216} rx={14} ry={7} fill="#FACC15" stroke="#111827" strokeWidth={3} />
            </g>
          </g>
        ) : (
          <g>
            {/* Baseboard & Wall Wainscoting */}
            <rect x={0} y={HORIZON_Y - 70} width={W} height={95} fill="rgba(15, 23, 42, 0.28)" />
            <line x1={0} y1={HORIZON_Y - 70} x2={W} y2={HORIZON_Y - 70} stroke={pal.line} strokeWidth={2} opacity={0.32} />

            {/* Distinct Per-Scene Indoor Environmental Props (Bookshelf / Floor Lamp / Marble Pillars / Spotlight / Bistro Table) */}
            {theme === "indoor_warm" || worldVariant === 2 ? (
              <g>
                {/* Cozy Wooden Bookshelf on the left edge (x = 34..154) */}
                <g transform={`translate(94, ${HORIZON_Y + 25})`}>
                  <rect x={-56} y={-250} width={112} height={250} rx={8} fill="#451A03" stroke="#111827" strokeWidth={3.5} />
                  {[-195, -130, -65].map((sy, idx) => (
                    <g key={sy}>
                      <line x1={-52} y1={sy} x2={52} y2={sy} stroke="#78350F" strokeWidth={6} />
                      <rect x={-44} y={sy - 46} width={16} height={43} rx={2} fill={idx === 0 ? "#EF4444" : "#38BDF8"} stroke="#111827" strokeWidth={2} />
                      <rect x={-24} y={sy - 42} width={18} height={39} rx={2} fill="#FACC15" stroke="#111827" strokeWidth={2} />
                      <rect x={-2} y={sy - 48} width={16} height={45} rx={2} fill="#22C55E" stroke="#111827" strokeWidth={2} />
                      <rect x={18} y={sy - 40} width={22} height={37} rx={2} fill="#A855F7" stroke="#111827" strokeWidth={2} />
                    </g>
                  ))}
                </g>
                {/* Side Bistro Table with Steaming Coffee Mug (from stix props.md) on the right edge */}
                <g transform={`translate(982, ${HORIZON_Y + 25})`}>
                  <rect x={-42} y={-92} width={84} height={10} rx={4} fill="#D97706" stroke="#111827" strokeWidth={3} />
                  <line x1={-28} y1={-82} x2={-32} y2={0} stroke="#78350F" strokeWidth={6} strokeLinecap="round" />
                  <line x1={28} y1={-82} x2={32} y2={0} stroke="#78350F" strokeWidth={6} strokeLinecap="round" />
                  {/* Coffee Mug + Animated Steam */}
                  <rect x={-12} y={-118} width={22} height={26} rx={4} fill="#FFFFFF" stroke="#111827" strokeWidth={3} />
                  <path d="M 10 -112 Q 20 -105 10 -98" fill="none" stroke="#111827" strokeWidth={3} />
                  <path d={`M -4 ${-124 - (f % 18) * 0.4} Q -8 -136 -2 -144`} fill="none" stroke="#FDE047" strokeWidth={2.2} strokeLinecap="round" opacity={0.7} />
                  <path d={`M 4 ${-126 - ((f + 9) % 18) * 0.4} Q 8 -138 2 -146`} fill="none" stroke="#FDE047" strokeWidth={2.2} strokeLinecap="round" opacity={0.7} />
                </g>
              </g>
            ) : theme === "luxury_gold" || worldVariant === 4 ? (
              <g>
                {/* Grand Classical Marble Pillars on Left & Right */}
                {[74, 1006].map((px) => (
                  <g key={px} transform={`translate(${px}, ${HORIZON_Y + 25})`}>
                    <rect x={-26} y={-290} width={52} height={290} fill="#292524" stroke="#FACC15" strokeWidth={2.5} opacity={0.8} />
                    <rect x={-34} y={-304} width={68} height={16} rx={4} fill="#FACC15" stroke="#111827" strokeWidth={3} />
                    <rect x={-34} y={-16} width={68} height={16} rx={4} fill="#FACC15" stroke="#111827" strokeWidth={3} />
                    <line x1={-10} y1={-285} x2={-10} y2={-18} stroke="#FDE047" strokeWidth={1.8} opacity={0.35} />
                    <line x1={10} y1={-285} x2={10} y2={-18} stroke="#FDE047" strokeWidth={1.8} opacity={0.35} />
                  </g>
                ))}
              </g>
            ) : theme === "dramatic_dark" || worldVariant === 1 ? (
              <g>
                {/* Dramatic Diagonal Stage Spotlight Cones & Crisp 2D Wall Clock */}
                <polygon points="0,520 140,520 340,1375 0,1375" fill="#F43F5E" opacity={0.06 * pulse} />
                <polygon points="1080,520 940,520 740,1375 1080,1375" fill="#FACC15" opacity={0.06 * pulse} />
                <g transform="translate(92, 980)">
                  <circle cx={0} cy={0} r={42} fill="#1E293B" stroke="#111827" strokeWidth={4} />
                  <circle cx={0} cy={0} r={34} fill="#0F172A" stroke="#F43F5E" strokeWidth={3} />
                  <line x1={0} y1={0} x2={0} y2={-20} stroke="#FACC15" strokeWidth={4} strokeLinecap="round" />
                  <line x1={0} y1={0} x2={15} y2={8} stroke="#FFFFFF" strokeWidth={3.5} strokeLinecap="round" />
                  <circle cx={0} cy={0} r={4} fill="#FACC15" />
                </g>
              </g>
            ) : worldVariant === 3 ? (
              <g>
                {/* Scholarly Archive Window on Left & Solid 2D Globe Pedestal on Right */}
                <g transform="translate(88, 1020)">
                  <path d="M -44 92 L -44 -40 A 44 44 0 0 1 44 -40 L 44 92 Z" fill="#1E293B" stroke="#111827" strokeWidth={4} />
                  <path d="M -36 84 L -36 -38 A 36 36 0 0 1 36 -38 L 36 84 Z" fill="#0F172A" stroke="#38BDF8" strokeWidth={2.5} />
                  <circle cx={-14} cy={-42} r={10} fill="#FACC15" opacity={0.85} />
                  <line x1={0} y1={-74} x2={0} y2={84} stroke="#111827" strokeWidth={3.5} />
                  <line x1={-36} y1={12} x2={36} y2={12} stroke="#111827" strokeWidth={3.5} />
                </g>
                <g transform={`translate(986, ${HORIZON_Y + 25})`}>
                  <rect x={-32} y={-112} width={64} height={112} rx={6} fill="#334155" stroke="#111827" strokeWidth={3.5} />
                  <rect x={-38} y={-120} width={76} height={12} rx={4} fill="#475569" stroke="#111827" strokeWidth={3} />
                  <path d="M -30 -152 A 30 30 0 0 0 30 -152" fill="none" stroke="#FACC15" strokeWidth={4} />
                  <line x1={0} y1={-120} x2={0} y2={-124} stroke="#FACC15" strokeWidth={4} />
                  <circle cx={0} cy={-152} r={24} fill="#0284C7" stroke="#111827" strokeWidth={3.5} />
                  <path d="M -14 -156 Q -2 -166 12 -152 Q 4 -140 -10 -144 Z" fill="#22C55E" />
                </g>
              </g>
            ) : (
              <g>
                {/* Modern Studio Floor Lamp on Left (x = 92) & Potted Monstera Plant on Right (x = 985) */}
                <g transform={`translate(92, ${HORIZON_Y + 25})`}>
                  <polygon points="-26,-195 26,-195 64,0 -64,0" fill="#38BDF8" opacity={0.08 * pulse} />
                  <line x1={0} y1={0} x2={0} y2={-195} stroke="#64748B" strokeWidth={6} />
                  <ellipse cx={0} cy={0} rx={28} ry={7} fill="#334155" stroke="#111827" strokeWidth={2.5} />
                  <polygon points="-28,-195 28,-195 18,-238 -18,-238" fill="#FACC15" stroke="#111827" strokeWidth={3} />
                </g>
                <g transform={`translate(985, ${HORIZON_Y + 25})`}>
                  <polygon points="-26,0 26,0 34,-54 -34,-54" fill="#D97706" stroke="#111827" strokeWidth={3.2} />
                  <path d="M 0 -54 Q -36 -95 -18 -125 Q 0 -105 0 -54" fill="#16A34A" stroke="#111827" strokeWidth={3} />
                  <path d="M 0 -54 Q 36 -95 18 -125 Q 0 -105 0 -54" fill="#22C55E" stroke="#111827" strokeWidth={3} />
                  <path d="M 0 -54 Q 0 -118 0 -142" stroke="#15803D" strokeWidth={5} strokeLinecap="round" />
                  <circle cx={0} cy={-136} r={20} fill="#22C55E" stroke="#111827" strokeWidth={3} />
                </g>
              </g>
            )}
          </g>
        )}

        {/* Soft Ambient Spotlight Glow behind the Upper-Center Illustration (NO nested outer box!)
            Feathered radial glow with no hard edge: the old solid ellipse (rx 310 / ry 165) was
            narrower than the rectangular drawing area, so card corners poked out of its rim. */}
        <defs>
          <radialGradient id="stage-illustration-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={pal.line} stopOpacity={0.16 * pulse} />
            <stop offset="55%" stopColor={pal.line} stopOpacity={0.09 * pulse} />
            <stop offset="100%" stopColor={pal.line} stopOpacity={0} />
          </radialGradient>
        </defs>
        <ellipse cx={540} cy={740} rx={470} ry={265} fill="url(#stage-illustration-glow)" />

        {/* Stage Floor, Curb & Perspective Lines */}
        <rect x={0} y={HORIZON_Y + 25} width={W} height={H - HORIZON_Y} fill={pal.floor} />
        <rect x={0} y={HORIZON_Y + 25} width={W} height={20} fill="rgba(0, 0, 0, 0.18)" />
        <line x1={0} y1={HORIZON_Y + 25} x2={W} y2={HORIZON_Y + 25} stroke={pal.line} strokeWidth={4.5} />
        {theme === "nature_outdoor" ? (
          /* Subtle green grass tufts instead of yellow highway road dashes! */
          <g stroke="#86EFAC" strokeWidth={3.5} strokeLinecap="round" opacity={0.55}>
            {[140, 320, 540, 760, 940].map((gx) => (
              <path key={gx} d={`M ${gx - 8} ${FLOOR_Y + 26} L ${gx - 14} ${FLOOR_Y + 14} M ${gx} ${FLOOR_Y + 26} L ${gx} ${FLOOR_Y + 12} M ${gx + 8} ${FLOOR_Y + 26} L ${gx + 14} ${FLOOR_Y + 14}`} />
            ))}
          </g>
        ) : pal.outdoor ? (
          <line
            x1={60}
            y1={FLOOR_Y + 22}
            x2={W - 60}
            y2={FLOOR_Y + 22}
            stroke={pal.accent}
            strokeWidth={6}
            strokeDasharray="48 36"
            opacity={0.65}
          />
        ) : (
          <line
            x1={80}
            y1={FLOOR_Y + 24}
            x2={W - 80}
            y2={FLOOR_Y + 24}
            stroke={pal.line}
            strokeWidth={3}
            opacity={0.22}
          />
        )}
      </svg>
    </div>
  );
};

/** Render the distinct, realistic 2D illustrated settings behind the characters */
const renderSetting = (
  setting: StickmanSetting,
  p: number,
  f: number,
  contextText = "",
  act?: StickmanSceneAct,
  sceneIdx = 0
) => {
  // Whenever a scene has a custom AI-generated SVG illustration (or setting === "custom_scene"),
  // render a fresh, clean stage backdrop so old pre-made boards/furniture are NEVER reused!
  const hasCustomIllustration = Boolean(act?.customSvg && act.customSvg.trim().length > 12);
  if (
    setting === "custom_scene" ||
    (hasCustomIllustration &&
      setting !== "street_vendor" &&
      setting !== "sidewalk_tea" &&
      setting !== "race_track")
  ) {
    return renderCustomStageSetting(act, f, contextText, setting, sceneIdx);
  }

  switch (setting) {
    case "royal_palace": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #2A0808 0%, #5C1111 65%, #3B1406 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Imperial Roof Eaves & Golden Crossbeams at Top */}
            <rect x={0} y={550} width={W} height={28} fill="#78350F" stroke="#F59E0B" strokeWidth={3} />
            <rect x={0} y={578} width={W} height={18} fill="#991B1B" stroke="#FDE047" strokeWidth={2} />
            {/* Palace Wall Panels */}
            {[180, 540, 900].map((wx) => (
              <rect
                key={wx}
                x={wx - 130}
                y={620}
                width={260}
                height={HORIZON_Y - 610}
                rx={8}
                fill="rgba(69, 10, 10, 0.55)"
                stroke="#B45309"
                strokeWidth={2.5}
              />
            ))}
            {/* Tiled Palace Floor with Perspective Lines + Royal Red Carpet */}
            <rect x={0} y={HORIZON_Y + 20} width={W} height={H - HORIZON_Y} fill="#3B1406" />
            {[-420, -240, 240, 420].map((dx) => (
              <line
                key={dx}
                x1={W / 2 + dx * 0.5}
                y1={HORIZON_Y + 20}
                x2={W / 2 + dx * 1.35}
                y2={H}
                stroke="#78350F"
                strokeWidth={2.5}
              />
            ))}
            <polygon
              points={`360,${HORIZON_Y + 20} 720,${HORIZON_Y + 20} 880,${H} 200,${H}`}
              fill="#991B1B"
              stroke="#FDE047"
              strokeWidth={5}
            />
            <line x1={0} y1={HORIZON_Y + 20} x2={W} y2={HORIZON_Y + 20} stroke="#F59E0B" strokeWidth={6} />
            {/* Grand Crimson & Gold Palace Pillars */}
            {[95, 985].map((px) => (
              <g key={px}>
                <rect x={px - 32} y={596} width={64} height={HORIZON_Y - 576} fill="#991B1B" stroke="#F59E0B" strokeWidth={4} />
                <rect x={px - 42} y={596} width={84} height={24} rx={4} fill="#F59E0B" stroke="#78350F" strokeWidth={2.5} />
                <rect x={px - 44} y={HORIZON_Y - 12} width={88} height={34} rx={8} fill="#F59E0B" stroke="#78350F" strokeWidth={3} />
              </g>
            ))}
            {/* Imperial Dragon Screen + Elevated Golden Throne in Center */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 15})`}>
              {/* Folding Imperial Screen behind Throne */}
              <rect x={-165} y={-275} width={330} height={225} rx={10} fill="#450A0A" stroke="#F59E0B" strokeWidth={5} />
              <line x1={-55} y1={-275} x2={-55} y2={-50} stroke="#F59E0B" strokeWidth={3} />
              <line x1={55} y1={-275} x2={55} y2={-50} stroke="#F59E0B" strokeWidth={3} />
              <circle cx={0} cy={-185} r={42} fill="rgba(250, 204, 21, 0.2)" stroke="#FDE047" strokeWidth={3} />
              {/* Stepped Golden Dais */}
              <rect x={-155} y={-22} width={310} height={24} rx={6} fill="#B45309" stroke="#FDE047" strokeWidth={3.5} />
              <rect x={-125} y={-46} width={250} height={24} rx={6} fill="#D97706" stroke="#FDE047" strokeWidth={3.5} />
              {/* Dragon Throne Backrest & Armrests */}
              <rect x={-90} y={-195} width={180} height={150} rx={18} fill="#7F1D1D" stroke="#FDE047" strokeWidth={6} />
              <path d="M -112 -195 Q 0 -250 112 -195 Z" fill="#F59E0B" stroke="#FEF08A" strokeWidth={4} />
              <rect x={-105} y={-105} width={210} height={30} rx={8} fill="#F59E0B" stroke="#78350F" strokeWidth={3.5} />
            </g>
          </svg>
        </div>
      );
    }

    case "peach_banquet": {
      const glow = 0.75 + Math.sin(f * 0.12) * 0.25;
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #2E073F 0%, #6B1414 66%, #3B1406 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Palace Ceiling Beam & Pillars */}
            <rect x={0} y={560} width={W} height={26} fill="#78350F" stroke="#FDE047" strokeWidth={3} />
            {[90, 990].map((px) => (
              <g key={px}>
                <rect x={px - 28} y={586} width={56} height={HORIZON_Y - 560} fill="#991B1B" stroke="#F59E0B" strokeWidth={3.5} />
                <rect x={px - 38} y={HORIZON_Y - 8} width={76} height={32} rx={6} fill="#F59E0B" />
              </g>
            ))}
            {/* Palace Floor & Royal Carpet */}
            <rect x={0} y={HORIZON_Y + 25} width={W} height={H - HORIZON_Y} fill="#3B1406" />
            <polygon
              points={`340,${HORIZON_Y + 25} 740,${HORIZON_Y + 25} 900,${H} 180,${H}`}
              fill="#7F1D1D"
              stroke="#FDE047"
              strokeWidth={4}
            />
            <line x1={0} y1={HORIZON_Y + 25} x2={W} y2={HORIZON_Y + 25} stroke="#FDE047" strokeWidth={5} />
            {/* Hanging Imperial Red Lanterns from the Palace Beam */}
            {[240, 840].map((lx, i) => (
              <g key={lx} transform={`translate(${lx}, ${695 + Math.sin(f * 0.05 + i) * 5})`}>
                <line x1={0} y1={-110} x2={0} y2={-32} stroke="#FDE047" strokeWidth={4} />
                <ellipse cx={0} cy={0} rx={42} ry={32} fill="#EF4444" stroke="#FDE047" strokeWidth={4} />
                <rect x={-18} y={-34} width={36} height={8} rx={3} fill="#F59E0B" />
                <rect x={-18} y={26} width={36} height={8} rx={3} fill="#F59E0B" />
                <line x1={0} y1={34} x2={0} y2={62} stroke="#FDE047" strokeWidth={5} />
              </g>
            ))}
            {/* Decorative Palace Screen & Pedestal Table with Glowing Longevity Peaches */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 10})`}>
              <rect x={-155} y={-265} width={310} height={170} rx={12} fill="rgba(69, 10, 10, 0.72)" stroke="#F59E0B" strokeWidth={4} />
              {/* Golden Aura behind the Peach Tray */}
              <circle cx={0} cy={-160} r={92} fill="rgba(253, 224, 71, 0.25)" opacity={glow} />
              {/* Carved Royal Table */}
              <rect x={-140} y={-105} width={280} height={24} rx={8} fill="#991B1B" stroke="#FDE047" strokeWidth={4} />
              <rect x={-105} y={-81} width={24} height={81} fill="#78350F" stroke="#F59E0B" strokeWidth={3} />
              <rect x={81} y={-81} width={24} height={81} fill="#78350F" stroke="#F59E0B" strokeWidth={3} />
              <rect x={-105} y={-55} width={210} height={14} fill="#991B1B" stroke="#F59E0B" strokeWidth={2.5} />
              {/* Golden Tray */}
              <ellipse cx={0} cy={-114} rx={96} ry={16} fill="#F59E0B" stroke="#FEF08A" strokeWidth={3.5} />
              {/* Pyramid of Longevity Peaches (Đào Tiên Trường Thọ) */}
              {[
                [-46, -134],
                [0, -137],
                [46, -134],
                [-23, -165],
                [23, -165],
                [0, -192],
              ].map(([px, py], idx) => (
                <g key={idx} transform={`translate(${px}, ${py})`}>
                  <path d="M 0 -23 C 19 -23 25 -2 0 19 C -25 -2 -19 -23 0 -23 Z" fill="#FB7185" stroke="#881337" strokeWidth={3} />
                  <ellipse cx={8} cy={-17} rx={8.5} ry={4.2} transform="rotate(-25 8 -17)" fill="#22C55E" stroke="#14532D" strokeWidth={2} />
                </g>
              ))}
            </g>
          </svg>
        </div>
      );
    }

    case "imperial_court": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #1E1B4B 0%, #450A0A 68%, #1E293B 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Stone Court Floor & Pillars */}
            <rect x={0} y={HORIZON_Y + 25} width={W} height={H - HORIZON_Y} fill="#1E293B" />
            <line x1={0} y1={HORIZON_Y + 25} x2={W} y2={HORIZON_Y + 25} stroke="#EF4444" strokeWidth={5} />
            {[95, 985].map((px) => (
              <g key={px}>
                <rect x={px - 28} y={590} width={56} height={HORIZON_Y - 565} fill="#7F1D1D" stroke="#F59E0B" strokeWidth={3.5} />
                <rect x={px - 38} y={HORIZON_Y - 5} width={76} height={30} rx={6} fill="#64748B" stroke="#111827" strokeWidth={3} />
              </g>
            ))}
            {/* Imperial Court Plaque (Minh Kính Cao Huyền style geometric banner) & Judge Tribunal Desk */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 10})`}>
              <rect x={-165} y={-285} width={330} height={70} rx={10} fill="#7F1D1D" stroke="#FDE047" strokeWidth={5} />
              <circle cx={0} cy={-250} r={20} fill="#FDE047" />
              <line x1={-110} y1={-250} x2={-35} y2={-250} stroke="#FDE047" strokeWidth={6} strokeLinecap="round" />
              <line x1={35} y1={-250} x2={110} y2={-250} stroke="#FDE047" strokeWidth={6} strokeLinecap="round" />
              {/* Judge Desk */}
              <rect x={-150} y={-140} width={300} height={130} rx={12} fill="#7F1D1D" stroke="#F59E0B" strokeWidth={5} />
              <rect x={-162} y={-156} width={324} height={24} rx={8} fill="#B45309" stroke="#FDE047" strokeWidth={4} />
              {/* Golden Dragon Medallion on Front of Court Desk */}
              <circle cx={0} cy={-74} r={36} fill="#F59E0B" stroke="#FEF08A" strokeWidth={4} />
              <circle cx={0} cy={-74} r={17} fill="#991B1B" />
              {/* Imperial Scroll & Bamboo Execution Tallies Holder on Desk */}
              <rect x={-80} y={-182} width={58} height={26} rx={4} fill="#FEF08A" stroke="#78350F" strokeWidth={3} />
              <rect x={32} y={-196} width={34} height={40} rx={4} fill="#991B1B" stroke="#FDE047" strokeWidth={3} />
              <rect x={38} y={-216} width={8} height={22} rx={2} fill="#EF4444" stroke="#FDE047" strokeWidth={2} />
              <rect x={50} y={-212} width={8} height={18} rx={2} fill="#FDE047" stroke="#78350F" strokeWidth={2} />
            </g>
          </svg>
        </div>
      );
    }

    case "coding_desk": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #E2E8F0 0%, #F8FAFC 68%, #CBD5E1 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Clean 2D Comic Studio Floor & Baseboard (matches Reference Image 1!) */}
            <rect x={0} y={HORIZON_Y + 25} width={W} height={H - HORIZON_Y} fill="#CBD5E1" />
            <line x1={0} y1={HORIZON_Y + 25} x2={W} y2={HORIZON_Y + 25} stroke="#475569" strokeWidth={4} />
            {/* Ticking Wall Clock on Upper Right Wall */}
            <g transform={`translate(820, 770) rotate(${Math.sin(f * 0.4) * 2.5})`}>
              <circle cx={0} cy={0} r={58} fill="#FFFFFF" stroke="#111827" strokeWidth={4.5} />
              <circle cx={0} cy={0} r={49} fill="none" stroke="#94A3B8" strokeWidth={2} />
              {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => (
                <line
                  key={deg}
                  x1={0}
                  y1={-40}
                  x2={0}
                  y2={-47}
                  stroke="#111827"
                  strokeWidth={deg % 90 === 0 ? 3.5 : 2}
                  transform={`rotate(${deg})`}
                />
              ))}
              <line x1={0} y1={0} x2={-18} y2={14} stroke="#111827" strokeWidth={5} strokeLinecap="round" />
              <line x1={0} y1={0} x2={22} y2={-24} stroke="#111827" strokeWidth={3.5} strokeLinecap="round" />
              <circle cx={0} cy={0} r={4.5} fill="#111827" />
              <path d="M -68 -20 Q -75 0 -68 20" stroke="#64748B" strokeWidth={2.5} fill="none" />
              <path d="M 68 -20 Q 75 0 68 20" stroke="#64748B" strokeWidth={2.5} fill="none" />
            </g>
            {/* 2D Cel-Shaded Study / Coding Desk in Center with Laptop, Book & Pencil */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 8})`}>
              <ellipse cx={0} cy={6} rx={190} ry={14} fill="rgba(15, 23, 42, 0.14)" />
              {/* Desk legs */}
              <rect x={-145} y={-125} width={20} height={130} fill="#94A3B8" stroke="#111827" strokeWidth={3.5} />
              <rect x={-115} y={-125} width={16} height={115} fill="#64748B" stroke="#111827" strokeWidth={3} />
              <rect x={125} y={-125} width={20} height={130} fill="#94A3B8" stroke="#111827" strokeWidth={3.5} />
              {/* Desk tabletop */}
              <rect x={-165} y={-145} width={330} height={18} rx={4} fill="#E2E8F0" stroke="#111827" strokeWidth={4} />
              <rect x={-155} y={-127} width={310} height={12} fill="#94A3B8" stroke="#111827" strokeWidth={3.5} />
              {/* Open Laptop & Notebook + Pencil on Desk */}
              <rect x={-95} y={-161} width={68} height={16} rx={3} fill="#CBD5E1" stroke="#111827" strokeWidth={3} />
              <polygon points="-20,-145 -8,-145 14,-154 2,-154" fill="#F59E0B" stroke="#111827" strokeWidth={2.5} />
              <rect x={35} y={-205} width={86} height={58} rx={6} fill="#1E293B" stroke="#111827" strokeWidth={3.5} />
              <line x1={48} y1={-186} x2={96} y2={-186} stroke="#22C55E" strokeWidth={4} strokeLinecap="round" />
              <line x1={48} y1={-172} x2={106} y2={-172} stroke="#38BDF8" strokeWidth={4} strokeLinecap="round" />
              <line x1={48} y1={-158} x2={82} y2={-158} stroke="#FACC15" strokeWidth={4} strokeLinecap="round" />
            </g>
          </svg>
        </div>
      );
    }

    case "debugging_board": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #E2E8F0 0%, #F8FAFC 68%, #CBD5E1 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <rect x={0} y={HORIZON_Y + 25} width={W} height={H - HORIZON_Y} fill="#CBD5E1" />
            <line x1={0} y1={HORIZON_Y + 25} x2={W} y2={HORIZON_Y + 25} stroke="#475569" strokeWidth={4} />
            {/* Ticking Wall Clock */}
            <g transform={`translate(250, 760) rotate(${Math.sin(f * 0.42) * 3})`}>
              <circle cx={0} cy={0} r={54} fill="#FFFFFF" stroke="#111827" strokeWidth={4} />
              <line x1={0} y1={0} x2={16} y2={-18} stroke="#111827" strokeWidth={4.5} strokeLinecap="round" />
              <line x1={0} y1={0} x2={12} y2={24} stroke="#111827" strokeWidth={3.5} strokeLinecap="round" />
              <circle cx={0} cy={0} r={4} fill="#111827" />
            </g>
            {/* Tall Wooden Flipchart Easel with Long Unrolling Checklist (matches Reference Image 2!) */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 5})`}>
              <line x1={-85} y1={-310} x2={-125} y2={10} stroke="#B45309" strokeWidth={12} strokeLinecap="round" />
              <line x1={85} y1={-310} x2={125} y2={10} stroke="#B45309" strokeWidth={12} strokeLinecap="round" />
              <rect x={-8} y={-345} width={16} height={35} rx={3} fill="#B45309" stroke="#111827" strokeWidth={3.5} />
              {/* Long white paper scroll unrolling onto the floor */}
              <path
                d="M -105 -310 L 105 -310 L 95 -20 Q 90 12 115 22 L -95 22 Q -115 12 -105 -20 Z"
                fill="#FFFFFF"
                stroke="#111827"
                strokeWidth={4}
              />
              <ellipse cx={0} cy={-310} rx={110} ry={14} fill="#E2E8F0" stroke="#111827" strokeWidth={3.8} />
              {/* Dense 2-column checklist rows */}
              {Array.from({length: 9}, (_, r) => {
                const ry = -270 + r * 30;
                return (
                  <g key={r}>
                    <rect x={-82} y={ry} width={12} height={12} rx={2} fill="#FFFFFF" stroke="#111827" strokeWidth={2.2} />
                    <line x1={-62} y1={ry + 6} x2={-12} y2={ry + 6} stroke="#334155" strokeWidth={4} strokeLinecap="round" />
                    <rect x={8} y={ry} width={12} height={12} rx={2} fill="#FFFFFF" stroke="#111827" strokeWidth={2.2} />
                    <line x1={28} y1={ry + 6} x2={78} y2={ry + 6} stroke="#334155" strokeWidth={4} strokeLinecap="round" />
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      );
    }

    case "ai_server_lab": {
      const pulse = 0.65 + Math.sin(f * 0.15) * 0.35;
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #091526 0%, #0F172A 68%, #1E293B 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <rect x={0} y={HORIZON_Y + 25} width={W} height={H - HORIZON_Y} fill="#0F172A" />
            <line x1={0} y1={HORIZON_Y + 25} x2={W} y2={HORIZON_Y + 25} stroke="#38BDF8" strokeWidth={4} />
            {/* Center AI Server Rack & Neural Hub */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 12})`}>
              <circle cx={0} cy={-165} r={115} fill="rgba(56, 189, 248, 0.15)" opacity={pulse} />
              <rect x={-130} y={-275} width={260} height={265} rx={16} fill="#1E293B" stroke="#38BDF8" strokeWidth={5} />
              {[-235, -180, -125, -70].map((sy, idx) => (
                <g key={sy}>
                  <rect x={-105} y={sy} width={210} height={38} rx={6} fill="#0F172A" stroke="#334155" strokeWidth={2.5} />
                  <circle cx={-82} cy={sy + 19} r={6} fill={idx % 2 === 0 ? "#22C55E" : "#38BDF8"} />
                  <circle cx={-62} cy={sy + 19} r={6} fill="#FACC15" />
                  <line x1={-35} y1={sy + 19} x2={85} y2={sy + 19} stroke="#38BDF8" strokeWidth={5} strokeLinecap="round" opacity={0.75} />
                </g>
              ))}
            </g>
          </svg>
        </div>
      );
    }

    case "imperial_garden": {
      return (
        <>
          <Land sky="dawn" horizon={HORIZON_Y} treeLine grass={95} />
          <Sun x={820} y={380} size={120} on={0.95} horizon={HORIZON_Y} />
          <Clouds sky="dawn" count={3} speed={0.35} seed={7} horizon={HORIZON_Y} />
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Peach Blossom Tree & Traditional Pavilion in Center */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 10})`}>
              {/* Tree trunk */}
              <path d="M -18 0 Q -12 -95 -45 -165 M 14 0 Q 10 -95 55 -160 M 0 -85 L 0 -185" stroke="#5C2D16" strokeWidth={18} strokeLinecap="round" fill="none" />
              {/* Pink peach blossom canopy */}
              <circle cx={-55} cy={-165} r={46} fill="#F472B6" opacity={0.92} />
              <circle cx={55} cy={-165} r={46} fill="#FB7185" opacity={0.92} />
              <circle cx={0} cy={-195} r={56} fill="#F9A8D4" opacity={0.95} />
              {/* Ripened peaches hanging on tree */}
              <circle cx={-42} cy={-155} r={11} fill="#EF4444" stroke="#FEF08A" strokeWidth={2} />
              <circle cx={38} cy={-150} r={11} fill="#EF4444" stroke="#FEF08A" strokeWidth={2} />
              <circle cx={4} cy={-185} r={12} fill="#EF4444" stroke="#FEF08A" strokeWidth={2} />
            </g>
          </svg>
        </>
      );
    }

    case "ancient_village": {
      return (
        <>
          <Land sky="dusk" horizon={HORIZON_Y} treeLine grass={100} />
          <Sun x={540} y={lerp(HORIZON_Y - 120, HORIZON_Y - 50, p)} size={130} on={0.95} horizon={HORIZON_Y} />
          <Clouds sky="dusk" count={4} speed={0.35} seed={12} horizon={HORIZON_Y} />
          <Birds count={5} y={650} seed={6} />
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <Shade x={160} y={HORIZON_Y + 25} s={0.78} seed={4} />
            {/* Traditional Vietnamese Curved-Roof Communal Pavilion (Đình Làng) */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 10})`}>
              <rect x={-140} y={-15} width={280} height={18} rx={4} fill="#78350F" />
              {[-105, -35, 35, 105].map((cx) => (
                <rect key={cx} x={cx - 8} y={-135} width={16} height={120} fill="#991B1B" />
              ))}
              <path d="M -185 -130 Q -150 -155 -120 -185 L 120 -185 Q 150 -155 185 -130 Z" fill="#B91C1C" stroke="#F59E0B" strokeWidth={4} />
            </g>
          </svg>
        </>
      );
    }

    case "classroom_school": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #0F172A 0%, #1E293B 70%, #334155 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <rect x={0} y={HORIZON_Y + 30} width={W} height={H - HORIZON_Y} fill="#451A03" opacity={0.7} />
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 35})`}>
              <rect x={-165} y={-225} width={330} height={175} rx={12} fill="#064E3B" stroke="#D97706" strokeWidth={8} />
              <line x1={-115} y1={-165} x2={95} y2={-165} stroke="#A7F3D0" strokeWidth={5} strokeLinecap="round" />
              <line x1={-115} y1={-125} x2={55} y2={-125} stroke="#FDE047" strokeWidth={5} strokeLinecap="round" />
              <line x1={-115} y1={-85} x2={115} y2={-85} stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" />
            </g>
          </svg>
        </div>
      );
    }

    case "hospital_clinic": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #0F172A 0%, #0E7490 68%, #1E293B 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <rect x={0} y={HORIZON_Y + 30} width={W} height={H - HORIZON_Y} fill="#E2E8F0" opacity={0.2} />
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 25})`}>
              <circle cx={0} cy={-135} r={68} fill="#F8FAFC" stroke="#EF4444" strokeWidth={6} />
              <rect x={-14} y={-175} width={28} height={80} rx={4} fill="#EF4444" />
              <rect x={-40} y={-149} width={80} height={28} rx={4} fill="#EF4444" />
            </g>
          </svg>
        </div>
      );
    }

    case "highway_ev": {
      const carX = lerp(340, 520, p);
      return (
        <>
          <Land sky="day" horizon={HORIZON_Y} treeLine grass={95} />
          <Sun x={840} y={360} size={115} on={0.95} horizon={HORIZON_Y} />
          <Clouds sky="day" count={4} speed={0.45} seed={3} horizon={HORIZON_Y} />
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Highway asphalt road */}
            <rect x={0} y={HORIZON_Y + 45} width={W} height={130} fill="#1E293B" />
            <line x1={0} y1={HORIZON_Y + 48} x2={W} y2={HORIZON_Y + 48} stroke="#94A3B8" strokeWidth={4} />
            <line x1={0} y1={HORIZON_Y + 172} x2={W} y2={HORIZON_Y + 172} stroke="#94A3B8" strokeWidth={4} />
            {Array.from({length: 8}, (_, i) => (
              <rect
                key={i}
                x={((i * 160 - f * 2.2) % 1280 + 1280) % 1280 - 100}
                y={HORIZON_Y + 105}
                width={80}
                height={10}
                rx={4}
                fill="#FDE047"
                opacity={0.85}
              />
            ))}
            {/* Modern Electric SUV (VF6 style — pure graphic, no cramped text) */}
            <g transform={`translate(${carX}, ${HORIZON_Y + 85})`}>
              <ellipse cx={0} cy={52} rx={155} ry={14} fill="rgba(0,0,0,0.35)" />
              <path
                d="M -145 35 L -135 -15 L -75 -62 L 65 -62 L 125 -15 L 145 35 Z"
                fill="#0284C7"
                stroke="#0F172A"
                strokeWidth={5}
              />
              <path d="M -70 -54 L 55 -54 L 102 -15 L -115 -15 Z" fill="#BAE6FD" opacity={0.85} />
              {/* V-shaped front LED signature */}
              <path d="M 95 -2 L 138 8 L 95 18" fill="none" stroke="#38BDF8" strokeWidth={4} />
              {/* Wheels */}
              <circle cx={-88} cy={38} r={28} fill="#0F172A" stroke="#CBD5E1" strokeWidth={6} />
              <circle cx={88} cy={38} r={28} fill="#0F172A" stroke="#CBD5E1" strokeWidth={6} />
              {/* Green EV Lightning Badge on door */}
              <circle cx={0} cy={12} r={18} fill="#22C55E" stroke="#052E16" strokeWidth={3} />
              <polygon points="3,-1 -8,13 1,13 -3,25 9,10 0,10" fill="#FDE047" />
            </g>
          </svg>
        </>
      );
    }

    case "cafe_table": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #27150E 0%, #3E2217 65%, #1E110B 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Cafe Tiled Floor & Baseboard */}
            <rect x={0} y={HORIZON_Y + 25} width={W} height={H - HORIZON_Y} fill="#1E110B" />
            <line x1={0} y1={HORIZON_Y + 25} x2={W} y2={HORIZON_Y + 25} stroke="#D97706" strokeWidth={5} />
            {/* Hanging Warm Edison Pendant Lamps */}
            {[260, 820].map((lx) => (
              <g key={lx} transform={`translate(${lx}, 700)`}>
                <line x1={0} y1={-120} x2={0} y2={0} stroke="#111827" strokeWidth={4} />
                <circle cx={0} cy={22} r={54} fill="rgba(253, 224, 71, 0.18)" />
                <path d="M -38 8 Q 0 -22 38 8 Z" fill="#D97706" stroke="#111827" strokeWidth={3.5} />
                <circle cx={0} cy={12} r={9} fill="#FEF08A" />
              </g>
            ))}
            {/* Coffee Shop Menu Board on Back Wall */}
            <g transform="translate(540, 815)">
              <rect x={-165} y={-85} width={330} height={135} rx={12} fill="#111827" stroke="#F59E0B" strokeWidth={4.5} />
              {/* Coffee Cup Icon + Menu Lines */}
              <rect x={-125} y={-35} width={44} height={42} rx={6} fill="#F59E0B" stroke="#FFFFFF" strokeWidth={3} />
              <path d="M -81 -25 Q -66 -25 -66 -14 Q -66 -3 -81 -3" fill="none" stroke="#FFFFFF" strokeWidth={3} />
              <path d={`M -112 -45 Q -105 ${-55 - Math.sin(f * 0.15) * 4} -98 -45`} fill="none" stroke="#FEF08A" strokeWidth={2.5} />
              <line x1={-40} y1={-42} x2={125} y2={-42} stroke="#FEF08A" strokeWidth={6} strokeLinecap="round" />
              <line x1={-40} y1={-12} x2={95} y2={-12} stroke="#CBD5E1" strokeWidth={5} strokeLinecap="round" />
              <line x1={-40} y1={18} x2={115} y2={18} stroke="#38BDF8" strokeWidth={5} strokeLinecap="round" />
            </g>
            {/* Cozy Bistro Table in the Center */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 5})`}>
              <rect x={-125} y={-105} width={250} height={18} rx={8} fill="#D97706" stroke="#111827" strokeWidth={4} />
              <rect x={-14} y={-87} width={28} height={81} fill="#78350F" stroke="#111827" strokeWidth={3.5} />
              <rect x={-75} y={-8} width={150} height={12} rx={6} fill="#451A03" stroke="#111827" strokeWidth={3} />
              {/* 2 Steaming Coffee Mugs & Pastry Plate on Table */}
              <rect x={-78} y={-135} width={26} height={30} rx={5} fill="#F8FAFC" stroke="#111827" strokeWidth={3} />
              <rect x={52} y={-135} width={26} height={30} rx={5} fill="#F59E0B" stroke="#111827" strokeWidth={3} />
              <ellipse cx={0} cy={-112} rx={36} ry={8} fill="#FEF08A" stroke="#111827" strokeWidth={2.8} />
            </g>
          </svg>
        </div>
      );
    }

    case "charging_station": {
      const chargePct = Math.round(lerp(45, 95, p));
      return (
        <>
          <Land sky="day" horizon={HORIZON_Y} treeLine grass={95} />
          <Clouds sky="day" count={3} speed={0.4} seed={8} horizon={HORIZON_Y} />
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <rect x={0} y={HORIZON_Y + 40} width={W} height={150} fill="#1E293B" />
            {/* Clean Graphic EV Supercharger Pillar in Center (no overflowing text) */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 10})`}>
              <rect x={-68} y={-215} width={136} height={215} rx={20} fill="#065F46" stroke="#22C55E" strokeWidth={5} />
              <rect x={-48} y={-192} width={96} height={100} rx={12} fill="#022C22" stroke="#34D399" strokeWidth={3} />
              {/* Lightning Bolt Icon */}
              <polygon points="6,-180 -14,-146 2,-146 -6,-116 18,-152 1,-152" fill="#FDE047" />
              {/* Battery progress bar */}
              <rect x={-42} y={-72} width={84} height={22} rx={6} fill="#022C22" stroke="#34D399" strokeWidth={2} />
              <rect x={-38} y={-68} width={(76 * chargePct) / 100} height={14} rx={4} fill="#22C55E" />
              {/* Charging cable loop */}
              <path d="M 68 -110 Q 108 -95 92 -45 Q 78 -10 68 -25" fill="none" stroke="#1E293B" strokeWidth={8} strokeLinecap="round" />
            </g>
          </svg>
        </>
      );
    }

    case "toll_booth": {
      const gateAngle = lerp(-15, -75, Math.min(1, p * 1.4));
      return (
        <>
          <Land sky="harsh" horizon={HORIZON_Y} treeLine grass={95} />
          <Sun x={780} y={390} size={110} on={0.9} horizon={HORIZON_Y} />
          <Clouds sky="harsh" count={4} speed={0.45} seed={11} horizon={HORIZON_Y} />
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <rect x={0} y={HORIZON_Y + 40} width={W} height={150} fill="#334155" />
            {/* Highway Toll Booth (pure graphic canopy + barrier arm, no overflowing text) */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 10})`}>
              <rect x={-165} y={-225} width={330} height={36} rx={10} fill="#0284C7" stroke="#F8FAFC" strokeWidth={4} />
              <rect x={-130} y={-189} width={42} height={189} fill="#475569" stroke="#1E293B" strokeWidth={4} />
              <rect x={88} y={-189} width={42} height={189} fill="#475569" stroke="#1E293B" strokeWidth={4} />
              {/* Traffic signal lights */}
              <circle cx={-109} cy={-145} r={9} fill="#EF4444" />
              <circle cx={-109} cy={-120} r={9} fill="#22C55E" />
              {/* Barrier arm opening smoothly */}
              <g transform={`translate(-88, -95) rotate(${gateAngle})`}>
                <rect x={0} y={-8} width={175} height={16} rx={6} fill="#EF4444" stroke="#FFFFFF" strokeWidth={3} />
              </g>
            </g>
          </svg>
        </>
      );
    }

    case "hotel_room": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #0F172A 0%, #1E293B 68%, #334155 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Floor & baseboard */}
            <rect x={0} y={HORIZON_Y + 30} width={W} height={H - HORIZON_Y} fill="#451A03" opacity={0.65} />
            <line x1={0} y1={HORIZON_Y + 30} x2={W} y2={HORIZON_Y + 30} stroke="#D97706" strokeWidth={6} />
            {/* Night window with moon & stars */}
            <g transform="translate(220, 880)">
              <rect x={-110} y={-140} width={220} height={220} rx={16} fill="#091526" stroke="#94A3B8" strokeWidth={8} />
              <circle cx={40} cy={-65} r={34} fill="#FEF08A" />
              <circle cx={-45} cy={-85} r={4} fill="#FFF" />
              <circle cx={-15} cy={-35} r={3} fill="#FFF" />
              <line x1={0} y1={-140} x2={0} y2={80} stroke="#94A3B8" strokeWidth={6} />
              <line x1={-110} y1={-30} x2={110} y2={-30} stroke="#94A3B8" strokeWidth={6} />
            </g>
            {/* Cozy Hotel Bed in Center (no hardcoded price sign) */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 10})`}>
              <rect x={-155} y={-130} width={310} height={110} rx={18} fill="#F8FAFC" stroke="#1E293B" strokeWidth={5} />
              <rect x={-155} y={-85} width={310} height={65} rx={12} fill="#38BDF8" stroke="#1E293B" strokeWidth={4} />
              <rect x={-135} y={-152} width={85} height={32} rx={12} fill="#FEF08A" stroke="#1E293B" strokeWidth={4} />
              <rect x={50} y={-152} width={85} height={32} rx={12} fill="#FEF08A" stroke="#1E293B" strokeWidth={4} />
            </g>
          </svg>
        </div>
      );
    }

    case "seafood_diner": {
      return (
        <>
          <Sky sky="dusk" horizon={HORIZON_Y - 30} />
          <Sun x={540} y={HORIZON_Y - 95} size={115} on={0.9} horizon={HORIZON_Y - 30} />
          <Sea sky="dusk" horizon={HORIZON_Y - 30} glitter />
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Coastal Wooden Restaurant Deck & Railing (no countryside grass!) */}
            <rect x={0} y={HORIZON_Y + 15} width={W} height={H - HORIZON_Y} fill="#3B1406" />
            <line x1={0} y1={HORIZON_Y - 45} x2={W} y2={HORIZON_Y - 45} stroke="#78350F" strokeWidth={8} />
            <line x1={0} y1={HORIZON_Y + 15} x2={W} y2={HORIZON_Y + 15} stroke="#D97706" strokeWidth={6} />
            {[120, 260, 400, 680, 820, 960].map((rx) => (
              <rect key={rx} x={rx - 6} y={HORIZON_Y - 45} width={12} height={60} fill="#78350F" stroke="#111827" strokeWidth={2.5} />
            ))}
            {/* Festive String Lights Overhead */}
            <path d="M 0 650 Q 540 720 1080 650" fill="none" stroke="#1E293B" strokeWidth={3.5} />
            {[160, 340, 540, 740, 920].map((bx, i) => (
              <circle key={bx} cx={bx} cy={672 + (i === 2 ? 14 : i === 1 || i === 3 ? 9 : 0)} r={10} fill="#FEF08A" stroke="#F59E0B" strokeWidth={3} />
            ))}
            {/* Seafood Dining Table with Dishes */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 5})`}>
              <rect x={-140} y={-105} width={280} height={18} rx={8} fill="#F59E0B" stroke="#1E293B" strokeWidth={4} />
              <rect x={-95} y={-87} width={18} height={87} fill="#78350F" />
              <rect x={77} y={-87} width={18} height={87} fill="#78350F" />
              <ellipse cx={-60} cy={-118} rx={38} ry={14} fill="#F8FAFC" stroke="#1E293B" strokeWidth={3} />
              <ellipse cx={0} cy={-122} rx={44} ry={16} fill="#FCA5A5" stroke="#1E293B" strokeWidth={3} />
              <ellipse cx={65} cy={-118} rx={38} ry={14} fill="#FDE047" stroke="#1E293B" strokeWidth={3} />
            </g>
          </svg>
        </>
      );
    }

    case "beach_sunset": {
      return (
        <>
          <Sky sky="dusk" horizon={HORIZON_Y - 40} />
          <Sun x={540} y={lerp(HORIZON_Y - 140, HORIZON_Y - 60, p)} size={140} on={0.95} horizon={HORIZON_Y - 40} />
          <Clouds sky="dusk" count={4} speed={0.45} seed={9} horizon={HORIZON_Y - 40} />
          <Birds count={5} y={640} seed={4} />
          <Sea sky="dusk" horizon={HORIZON_Y - 40} glitter />
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Sandy beach foreground */}
            <path d={`M 0 ${HORIZON_Y + 20} Q 540 ${HORIZON_Y - 15} ${W} ${HORIZON_Y + 25} L ${W} ${H} L 0 ${H} Z`} fill="#FDE68A" opacity={0.9} />
            <Oak x={140} y={HORIZON_Y + 35} s={0.58} seed={4} />
          </svg>
        </>
      );
    }

    case "office_board": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(circle at 50% 35%, #1E3A8A 0%, #0F172A 70%, #020617 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <rect x={0} y={HORIZON_Y + 35} width={W} height={H - HORIZON_Y} fill="#1E293B" />
            <line x1={0} y1={HORIZON_Y + 35} x2={W} y2={HORIZON_Y + 35} stroke="#38BDF8" strokeWidth={4} />
            {/* Ticking Comic Wall Clock (matches reference images 1 & 2) */}
            <g transform={`translate(230, 820) rotate(${Math.sin(f * 0.45) * 3})`}>
              <circle cx={0} cy={0} r={54} fill="#FFFFFF" stroke="#111827" strokeWidth={4.5} />
              <circle cx={0} cy={0} r={46} fill="none" stroke="#94A3B8" strokeWidth={2} />
              {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => (
                <line
                  key={deg}
                  x1={0}
                  y1={-38}
                  x2={0}
                  y2={-44}
                  stroke="#111827"
                  strokeWidth={deg % 90 === 0 ? 3.5 : 2}
                  transform={`rotate(${deg})`}
                />
              ))}
              <line x1={0} y1={0} x2={16} y2={-18} stroke="#111827" strokeWidth={4.5} strokeLinecap="round" />
              <line
                x1={0}
                y1={0}
                x2={Math.sin(f * 0.08) * 28}
                y2={-Math.cos(f * 0.08) * 28}
                stroke="#EF4444"
                strokeWidth={3}
                strokeLinecap="round"
              />
              <circle cx={0} cy={0} r={4.5} fill="#111827" />
              {/* Vibration lines around clock */}
              <path d="M -64 -18 Q -70 0 -64 18" stroke="#94A3B8" strokeWidth={2.5} fill="none" />
              <path d="M 64 -18 Q 70 0 64 18" stroke="#94A3B8" strokeWidth={2.5} fill="none" />
            </g>
            {/* Wooden Easel Flipchart with Long Checklist + Bar Chart in Center */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 25})`}>
              {/* Wooden easel legs */}
              <line x1={-95} y1={-275} x2={-135} y2={25} stroke="#B45309" strokeWidth={12} strokeLinecap="round" />
              <line x1={95} y1={-275} x2={135} y2={25} stroke="#B45309" strokeWidth={12} strokeLinecap="round" />
              <line x1={0} y1={-305} x2={25} y2={15} stroke="#92400E" strokeWidth={10} strokeLinecap="round" />
              {/* White paper flipchart pad */}
              <rect x={-125} y={-275} width={250} height={265} rx={10} fill="#FFFFFF" stroke="#111827" strokeWidth={4.5} />
              {/* Top paper roll */}
              <ellipse cx={0} cy={-275} rx={130} ry={14} fill="#E2E8F0" stroke="#111827" strokeWidth={4} />
              {/* Checklist rows on left + animated bars on right */}
              {[-225, -185, -145, -105, -65].map((ry, idx) => (
                <g key={ry}>
                  <rect x={-98} y={ry - 12} width={18} height={18} rx={3} fill="#FFFFFF" stroke="#111827" strokeWidth={2.8} />
                  {idx < 3 && (
                    <polyline
                      points={`${-95},${ry - 3} ${-89},${ry + 3} ${-79},${ry - 9}`}
                      fill="none"
                      stroke="#16A34A"
                      strokeWidth={3.2}
                    />
                  )}
                  <line x1={-68} y1={ry - 3} x2={15} y2={ry - 3} stroke="#334155" strokeWidth={5} strokeLinecap="round" />
                </g>
              ))}
              {/* Mini bar chart at bottom right of easel */}
              {[38, 68, 52, 92].map((bh, i) => {
                const h = bh * Math.min(1, 0.35 + p * 0.65);
                return (
                  <rect
                    key={i}
                    x={32 + i * 20}
                    y={-30 - h}
                    width={14}
                    height={h}
                    rx={3}
                    fill={i === 3 ? "#EF4444" : i === 1 ? "#0284C7" : "#64748B"}
                  />
                );
              })}
            </g>
          </svg>
        </div>
      );
    }

    case "bank_finance": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #091526 0%, #16325B 65%, #0F172A 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <rect x={0} y={HORIZON_Y + 35} width={W} height={H - HORIZON_Y} fill="#1E293B" />
            {/* Bank Vault / Pillars in center */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 15})`}>
              <polygon points="-180,-250 0,-330 180,-250" fill="#FDE047" stroke="#1E293B" strokeWidth={5} />
              <rect x={-165} y={-250} width={330} height={28} fill="#EAB308" />
              {[-120, -40, 40, 120].map((px) => (
                <rect key={px} x={px - 16} y={-222} width={32} height={210} fill="#E2E8F0" stroke="#475569" strokeWidth={3} />
              ))}
              <rect x={-175} y={-12} width={350} height={18} rx={6} fill="#94A3B8" />
            </g>
          </svg>
        </div>
      );
    }

    case "supermarket": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #0F172A 0%, #1E293B 65%, #334155 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Indoor Shopping Mall / Supermarket Tiled Floor (No countryside grass!) */}
            <rect x={0} y={HORIZON_Y + 25} width={W} height={H - HORIZON_Y} fill="#CBD5E1" />
            <line x1={0} y1={HORIZON_Y + 25} x2={W} y2={HORIZON_Y + 25} stroke="#38BDF8" strokeWidth={5} />
            {[-380, -190, 190, 380].map((tx) => (
              <line key={tx} x1={W / 2 + tx * 0.6} y1={HORIZON_Y + 25} x2={W / 2 + tx * 1.4} y2={H} stroke="#94A3B8" strokeWidth={2.5} />
            ))}
            {/* Hanging Mall Promotional Signs ("SALE / NEW") */}
            {[240, 840].map((sx, idx) => (
              <g key={sx} transform={`translate(${sx}, 755)`}>
                <line x1={-45} y1={-150} x2={-45} y2={-35} stroke="#64748B" strokeWidth={3.5} />
                <line x1={45} y1={-150} x2={45} y2={-35} stroke="#64748B" strokeWidth={3.5} />
                <rect x={-85} y={-35} width={170} height={68} rx={10} fill={idx === 0 ? "#EF4444" : "#F59E0B"} stroke="#FFFFFF" strokeWidth={4} />
                <line x1={-55} y1={-8} x2={55} y2={-8} stroke="#FFFFFF" strokeWidth={7} strokeLinecap="round" />
                <line x1={-35} y1={14} x2={35} y2={14} stroke="#FEF08A" strokeWidth={5} strokeLinecap="round" />
              </g>
            ))}
            {/* Multi-tier Retail Display Gondola in Center */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 10})`}>
              <rect x={-175} y={-235} width={350} height={225} rx={16} fill="#1E293B" stroke="#38BDF8" strokeWidth={5} />
              <rect x={-175} y={-235} width={350} height={38} rx={12} fill="#0284C7" />
              {[-145, -88, -30].map((sy, r) => (
                <g key={sy}>
                  <line x1={-150} y1={sy} x2={150} y2={sy} stroke="#64748B" strokeWidth={6} />
                  {[-112, -38, 36, 110].map((ix, c) => (
                    <g key={ix}>
                      <rect
                        x={ix - 20}
                        y={sy - 36}
                        width={40}
                        height={32}
                        rx={6}
                        fill={(r + c) % 3 === 0 ? "#FDE047" : (r + c) % 3 === 1 ? "#FB7185" : "#38BDF8"}
                        stroke="#0F172A"
                        strokeWidth={2.5}
                      />
                      <rect x={ix - 10} y={sy - 6} width={20} height={8} rx={2} fill="#22C55E" />
                    </g>
                  ))}
                </g>
              ))}
            </g>
          </svg>
        </div>
      );
    }

    case "library_study": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #1E1B4B 0%, #312E81 64%, #1E293B 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Warm Library Floor & Wooden Baseboard */}
            <rect x={0} y={HORIZON_Y + 25} width={W} height={H - HORIZON_Y} fill="#27150E" />
            <line x1={0} y1={HORIZON_Y + 25} x2={W} y2={HORIZON_Y + 25} stroke="#D97706" strokeWidth={5} />
            {/* Left & Right Tall Wooden Bookshelves Packed with Books */}
            {[170, 910].map((bx) => (
              <g key={bx} transform={`translate(${bx}, ${HORIZON_Y + 20})`}>
                <rect x={-110} y={-440} width={220} height={440} rx={8} fill="#451A03" stroke="#92400E" strokeWidth={5} />
                {[-350, -250, -150, -50].map((sy, r) => (
                  <g key={sy}>
                    <rect x={-102} y={sy} width={204} height={10} fill="#92400E" />
                    {[-86, -62, -38, -14, 12, 36, 62, 84].map((kx, c) => (
                      <rect
                        key={kx}
                        x={kx - 9}
                        y={sy - 68 - ((r + c) % 3) * 8}
                        width={18}
                        height={68 + ((r + c) % 3) * 8}
                        rx={3}
                        fill={(r + c) % 4 === 0 ? "#EF4444" : (r + c) % 4 === 1 ? "#FACC15" : (r + c) % 4 === 2 ? "#38BDF8" : "#22C55E"}
                        stroke="#111827"
                        strokeWidth={2}
                      />
                    ))}
                  </g>
                ))}
              </g>
            ))}
            {/* Hanging Green Bankers / Library Lamp in Center */}
            <g transform="translate(540, 740)">
              <line x1={0} y1={-140} x2={0} y2={0} stroke="#D97706" strokeWidth={4} />
              <circle cx={0} cy={28} r={75} fill="rgba(253, 224, 71, 0.2)" />
              <path d="M -52 12 L -32 -14 L 32 -14 L 52 12 Z" fill="#16A34A" stroke="#111827" strokeWidth={3.5} />
            </g>
            {/* Central Library Reading Desk with Stacked Hardcover Books & Globe */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 8})`}>
              <rect x={-160} y={-125} width={320} height={18} rx={6} fill="#B45309" stroke="#111827" strokeWidth={4} />
              <rect x={-130} y={-107} width={20} height={107} fill="#78350F" stroke="#111827" strokeWidth={3.5} />
              <rect x={110} y={-107} width={20} height={107} fill="#78350F" stroke="#111827" strokeWidth={3.5} />
              {/* Stack of Reference Books on Desk */}
              <rect x={-85} y={-143} width={76} height={18} rx={4} fill="#EF4444" stroke="#111827" strokeWidth={3} />
              <rect x={-78} y={-161} width={68} height={18} rx={4} fill="#38BDF8" stroke="#111827" strokeWidth={3} />
              <rect x={-72} y={-177} width={60} height={16} rx={4} fill="#FACC15" stroke="#111827" strokeWidth={3} />
              {/* Study Globe on Right Side of Desk */}
              <circle cx={58} cy={-162} r={24} fill="#38BDF8" stroke="#111827" strokeWidth={3.5} />
              <path d="M 58 -192 A 30 30 0 0 1 58 -132" fill="none" stroke="#F59E0B" strokeWidth={4} />
              <rect x={42} y={-132} width={32} height={8} rx={3} fill="#78350F" stroke="#111827" strokeWidth={2.5} />
            </g>
          </svg>
        </div>
      );
    }

    case "city_street": {
      return (
        <>
          <Land sky="harsh" horizon={HORIZON_Y} treeLine grass={90} />
          <Sun x={840} y={360} size={115} on={1} horizon={HORIZON_Y} />
          <Clouds sky="harsh" count={4} speed={0.45} seed={2} horizon={HORIZON_Y} />
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Sidewalk curb & urban asphalt street (so buildings stand on a real street, not grass!) */}
            <rect x={0} y={HORIZON_Y} width={W} height={42} fill="#CBD5E1" stroke="#64748B" strokeWidth={3} />
            <rect x={0} y={HORIZON_Y + 42} width={W} height={150} fill="#1E293B" />
            <line x1={0} y1={HORIZON_Y + 192} x2={W} y2={HORIZON_Y + 192} stroke="#94A3B8" strokeWidth={4} />
            {/* Pedestrian Crosswalk Stripes in Center */}
            {[-45, -15, 15, 45].map((cy) => (
              <rect
                key={cy}
                x={W / 2 - 75}
                y={HORIZON_Y + 110 + cy}
                width={150}
                height={14}
                rx={3}
                fill="#F8FAFC"
                opacity={0.85}
              />
            ))}
            {/* Modern Glass Tech Office Towers */}
            {[125, 275, 435, 645, 805, 955].map((bx, i) => {
              const bh = 165 + (i % 3) * 75;
              return (
                <g key={bx}>
                  <rect x={bx - 52} y={HORIZON_Y - bh} width={104} height={bh} fill="#1E293B" stroke="#0F172A" strokeWidth={3.5} />
                  <rect x={bx - 40} y={HORIZON_Y - 36} width={80} height={36} fill="#0284C7" opacity={0.65} />
                  {[0, 1, 2, 3].map((r) => (
                    <rect
                      key={r}
                      x={bx - 34}
                      y={HORIZON_Y - bh + 22 + r * 32}
                      width={68}
                      height={14}
                      rx={2}
                      fill={i % 2 === 0 ? "#38BDF8" : "#FDE047"}
                      opacity={0.8}
                    />
                  ))}
                </g>
              );
            })}
          </svg>
        </>
      );
    }

    case "gold_vault": {
      const tilt = Math.sin(f * 0.08) * 6;
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #1E1B4B 0%, #312E81 62%, #1E293B 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <rect x={0} y={HORIZON_Y + 25} width={W} height={H - HORIZON_Y} fill="#0F172A" />
            <line x1={0} y1={HORIZON_Y + 25} x2={W} y2={HORIZON_Y + 25} stroke="#F59E0B" strokeWidth={5} />
            {/* Giant Bank Vault Door & Gold Bullion Balance Scale in Center */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 12})`}>
              {/* Circular Steel Vault Door in Background */}
              <circle cx={0} cy={-165} r={130} fill="#1E293B" stroke="#94A3B8" strokeWidth={8} />
              <circle cx={0} cy={-165} r={105} fill="#0F172A" stroke="#F59E0B" strokeWidth={4} />
              {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
                <line
                  key={deg}
                  x1={0}
                  y1={-165}
                  x2={Math.cos((deg * Math.PI) / 180) * 65}
                  y2={-165 + Math.sin((deg * Math.PI) / 180) * 65}
                  stroke="#CBD5E1"
                  strokeWidth={6}
                  strokeLinecap="round"
                />
              ))}
              <circle cx={0} cy={-165} r={22} fill="#F59E0B" stroke="#111827" strokeWidth={4} />
              {/* Gold Pyramid & Balance Scale Pedestal in Foreground */}
              <rect x={-145} y={-22} width={290} height={24} rx={6} fill="#B45309" stroke="#FDE047" strokeWidth={3.5} />
              {/* Stacked 999.9 Gold Ingots */}
              {[
                [-85, -42],
                [-28, -42],
                [28, -42],
                [85, -42],
                [-56, -64],
                [0, -64],
                [56, -64],
                [-28, -86],
                [28, -86],
                [0, -108],
              ].map(([gx, gy], idx) => (
                <polygon
                  key={idx}
                  points={`${gx - 24},${gy + 20} ${gx + 24},${gy + 20} ${gx + 18},${gy} ${gx - 18},${gy}`}
                  fill="#FACC15"
                  stroke="#78350F"
                  strokeWidth={3}
                />
              ))}
              {/* Animated Balance Beam above Gold Pyramid */}
              <g transform={`translate(0, -155) rotate(${tilt})`}>
                <line x1={-110} y1={0} x2={110} y2={0} stroke="#FDE047" strokeWidth={6} strokeLinecap="round" />
                <polygon points="-130,28 -90,28 -110,0" fill="rgba(253, 224, 71, 0.35)" stroke="#FDE047" strokeWidth={2.5} />
                <polygon points="90,28 130,28 110,0" fill="rgba(56, 189, 248, 0.35)" stroke="#38BDF8" strokeWidth={2.5} />
              </g>
            </g>
          </svg>
        </div>
      );
    }

    case "mountain_chart": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #091526 0%, #1E293B 68%, #0F172A 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <rect x={0} y={HORIZON_Y + 25} width={W} height={H - HORIZON_Y} fill="#0F172A" />
            <line x1={0} y1={HORIZON_Y + 25} x2={W} y2={HORIZON_Y + 25} stroke="#38BDF8" strokeWidth={4} />
            {/* Wall-Mounted Financial Trading Screen & Candlestick Chart in Center */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 12})`}>
              {/* Pedestal Stand */}
              <rect x={-18} y={-65} width={36} height={65} fill="#475569" stroke="#111827" strokeWidth={3.5} />
              <rect x={-85} y={-8} width={170} height={14} rx={5} fill="#64748B" stroke="#111827" strokeWidth={3.5} />
              {/* Widescreen Trading Monitor */}
              <rect x={-210} y={-285} width={420} height={225} rx={16} fill="#091526" stroke="#38BDF8" strokeWidth={5} />
              {[-235, -185, -135].map((gy) => (
                <line key={gy} x1={-185} y1={gy} x2={185} y2={gy} stroke="rgba(148, 163, 184, 0.22)" strokeWidth={2} strokeDasharray="6 6" />
              ))}
              {/* Green Bull Candlesticks & Red Crash Candlesticks */}
              {[
                {x: -155, top: -155, h: 42, up: true},
                {x: -105, top: -195, h: 52, up: true},
                {x: -55, top: -245, h: 58, up: true},
                {x: -5, top: -255, h: 78, up: false},
                {x: 45, top: -185, h: 68, up: false},
                {x: 95, top: -165, h: 46, up: true},
                {x: 145, top: -205, h: 54, up: true},
              ].map((c, idx) => (
                <g key={idx}>
                  <line x1={c.x} y1={c.top - 14} x2={c.x} y2={c.top + c.h + 14} stroke={c.up ? "#22C55E" : "#EF4444"} strokeWidth={3.5} />
                  <rect
                    x={c.x - 12}
                    y={c.top}
                    width={24}
                    height={c.h}
                    rx={3}
                    fill={c.up ? "#22C55E" : "#EF4444"}
                    stroke="#0F172A"
                    strokeWidth={2}
                  />
                </g>
              ))}
              {/* Trendline Overlay */}
              <polyline
                points="-155,-135 -105,-175 -55,-235 -5,-180 45,-125 95,-150 145,-190"
                fill="none"
                stroke="#FACC15"
                strokeWidth={5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          </svg>
        </div>
      );
    }

    case "fed_rate_room": {
      const leverAngle = lerp(-28, 28, (Math.sin(f * 0.06) + 1) * 0.5);
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #0F172A 0%, #1E3A8A 66%, #091526 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <rect x={0} y={HORIZON_Y + 25} width={W} height={H - HORIZON_Y} fill="#0F172A" />
            <line x1={0} y1={HORIZON_Y + 25} x2={W} y2={HORIZON_Y + 25} stroke="#FACC15" strokeWidth={4} />
            {/* Central Bank / FED Interest Rate Control Console & Gauge */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 10})`}>
              <rect x={-165} y={-250} width={330} height={240} rx={18} fill="#1E293B" stroke="#38BDF8" strokeWidth={5} />
              {/* Semi-circular Rate Meter */}
              <path d="M -95 -135 A 95 95 0 0 1 95 -135" fill="#0F172A" stroke="#FACC15" strokeWidth={6} />
              <g transform={`translate(0, -135) rotate(${leverAngle})`}>
                <line x1={0} y1={0} x2={0} y2={-78} stroke="#EF4444" strokeWidth={7} strokeLinecap="round" />
                <circle cx={0} cy={-78} r={11} fill="#EF4444" stroke="#FFFFFF" strokeWidth={3} />
              </g>
              <circle cx={0} cy={-135} r={14} fill="#FACC15" stroke="#111827" strokeWidth={3} />
              {/* Indicator Bars below Gauge */}
              <rect x={-115} y={-95} width={95} height={26} rx={6} fill="#22C55E" />
              <rect x={20} y={-95} width={95} height={26} rx={6} fill="#EF4444" />
              <rect x={-115} y={-52} width={230} height={18} rx={6} fill="#334155" />
            </g>
          </svg>
        </div>
      );
    }

    case "interview_room": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #E2E8F0 0%, #F8FAFC 68%, #CBD5E1 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <rect x={0} y={HORIZON_Y + 25} width={W} height={H - HORIZON_Y} fill="#CBD5E1" />
            <line x1={0} y1={HORIZON_Y + 25} x2={W} y2={HORIZON_Y + 25} stroke="#334155" strokeWidth={4} />
            {/* Office Glass Partition & Contract Evaluation Board */}
            <rect x={350} y={710} width={380} height={190} rx={12} fill="#FFFFFF" stroke="#111827" strokeWidth={4.5} />
            <circle cx={420} cy={780} r={28} fill="#DCFCE7" stroke="#16A34A" strokeWidth={4} />
            <polyline points="406,780 416,790 435,768" fill="none" stroke="#16A34A" strokeWidth={5} strokeLinecap="round" />
            <line x1={470} y1={765} x2={680} y2={765} stroke="#1E293B" strokeWidth={7} strokeLinecap="round" />
            <line x1={470} y1={795} x2={630} y2={795} stroke="#38BDF8" strokeWidth={6} strokeLinecap="round" />
            <line x1={400} y1={845} x2={680} y2={845} stroke="#94A3B8" strokeWidth={5} strokeLinecap="round" />
            {/* Interview / Contract Signing Table in Center */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 6})`}>
              <rect x={-155} y={-115} width={310} height={18} rx={6} fill="#F8FAFC" stroke="#111827" strokeWidth={4} />
              <rect x={-125} y={-97} width={20} height={97} fill="#64748B" stroke="#111827" strokeWidth={3.5} />
              <rect x={105} y={-97} width={20} height={97} fill="#64748B" stroke="#111827" strokeWidth={3.5} />
              {/* Offer Contract + Stamp + Laptop on Table */}
              <rect x={-75} y={-135} width={56} height={20} rx={3} fill="#FEF08A" stroke="#111827" strokeWidth={3} />
              <rect x={18} y={-165} width={76} height={50} rx={5} fill="#1E293B" stroke="#111827" strokeWidth={3.5} />
            </g>
          </svg>
        </div>
      );
    }

    case "remote_workspace": {
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #DBEAFE 0%, #F0F9FF 68%, #CBD5E1 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <rect x={0} y={HORIZON_Y + 25} width={W} height={H - HORIZON_Y} fill="#CBD5E1" />
            <line x1={0} y1={HORIZON_Y + 25} x2={W} y2={HORIZON_Y + 25} stroke="#475569" strokeWidth={4} />
            {/* Sunny Home Window + Mon–Fri Calendar on Wall */}
            <g transform="translate(260, 810)">
              <rect x={-95} y={-110} width={190} height={175} rx={12} fill="#BAE6FD" stroke="#111827" strokeWidth={4.5} />
              <circle cx={42} cy={-55} r={24} fill="#FACC15" />
              <line x1={0} y1={-110} x2={0} y2={65} stroke="#111827" strokeWidth={4} />
              <line x1={-95} y1={-22} x2={95} y2={-22} stroke="#111827" strokeWidth={4} />
            </g>
            {/* 5-Day Mon–Fri Remote Schedule Board on Right Wall */}
            <g transform="translate(800, 800)">
              <rect x={-110} y={-85} width={220} height={140} rx={12} fill="#FFFFFF" stroke="#111827" strokeWidth={4.5} />
              <rect x={-110} y={-85} width={220} height={32} rx={10} fill="#22C55E" stroke="#111827" strokeWidth={3.5} />
              {[-72, -36, 0, 36, 72].map((cx) => (
                <rect key={cx} x={cx - 13} y={-28} width={26} height={52} rx={5} fill="#DCFCE7" stroke="#16A34A" strokeWidth={2.8} />
              ))}
            </g>
            {/* Ergonomic Home-Office Desk in Center */}
            <g transform={`translate(${W / 2}, ${FLOOR_Y - 6})`}>
              <rect x={-160} y={-125} width={320} height={18} rx={6} fill="#F59E0B" stroke="#111827" strokeWidth={4} />
              <rect x={-130} y={-107} width={18} height={107} fill="#78350F" stroke="#111827" strokeWidth={3.5} />
              <rect x={112} y={-107} width={18} height={107} fill="#78350F" stroke="#111827" strokeWidth={3.5} />
              {/* Dual Monitor + Coffee Mug on WFH Desk */}
              <rect x={-85} y={-195} width={96} height={62} rx={6} fill="#0F172A" stroke="#111827" strokeWidth={3.5} />
              <rect x={-45} y={-133} width={16} height={10} fill="#475569" />
              <rect x={45} y={-152} width={24} height={27} rx={4} fill="#EF4444" stroke="#111827" strokeWidth={3} />
            </g>
          </svg>
        </div>
      );
    }

    case "street_vendor": {
      const steamOffset = (f * 1.4) % 34;
      const ctxLower = `${contextText} ${act?.title ?? ""} ${act?.statLeft ?? ""} ${act?.statRight ?? ""}`.toLowerCase();
      const cartTopBanner =
        /(phở|bún|hủ tiếu|cháo)/i.test(ctxLower)
          ? "XE PHỞ • HỦ TIẾU GÕ"
          : /(bánh mì|bánh bao|bánh tráng)/i.test(ctxLower)
            ? "XE BÁNH MÌ NÓNG GIÒN"
            : /(cà phê|trà sữa|nước ép)/i.test(ctxLower)
              ? "XE CÀ PHÊ MANG ĐI"
              : /(trái cây|hoa quả|xoài|ổi)/i.test(ctxLower)
                ? "XE TRÁI CÂY TƯƠI"
                : /(nước mía|trà đá)/i.test(ctxLower)
                  ? "XE TRÀ ĐÁ • NƯỚC MÍA"
                  : /(xôi)/i.test(ctxLower)
                    ? "XE HÀNG RONG • XÔI NÓNG"
                    : act?.statLeft
                      ? trimWordsToFit(act.statLeft.toUpperCase(), 22)
                      : "XE ĐẨY HÀNG RONG";
      const cartBottomBanner = act?.statRight
        ? trimWordsToFit(act.statRight.toUpperCase(), 18)
        : "ĐÚNG GIỜ • QUEN KHÁCH";
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #1E3A5F 0%, #38BDF8 62%, #475569 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Vietnamese Street Shopfronts & Shophouses in Background */}
            <rect x={60} y={660} width={320} height={HORIZON_Y - 650} rx={8} fill="#FEF3C7" stroke="#111827" strokeWidth={3.5} />
            <rect x={60} y={840} width={320} height={46} rx={6} fill="#DC2626" stroke="#111827" strokeWidth={3} />
            <text x={220} y={870} textAnchor="middle" fontSize={20} fontWeight={900} fill="#FEF08A" fontFamily="Be Vietnam Pro, sans-serif">
              {act?.statLeft ? trimWordsToFit(act.statLeft.toUpperCase(), 20) : "PHỐ ẨM THỰC VỈA HÈ"}
            </text>
            <rect x={700} y={690} width={320} height={HORIZON_Y - 680} rx={8} fill="#E0F2FE" stroke="#111827" strokeWidth={3.5} />
            <rect x={700} y={850} width={320} height={44} rx={6} fill="#0284C7" stroke="#111827" strokeWidth={3} />
            <text x={860} y={878} textAnchor="middle" fontSize={19} fontWeight={900} fill="#FFFFFF" fontFamily="Be Vietnam Pro, sans-serif">
              {act?.statRight ? trimWordsToFit(act.statRight.toUpperCase(), 20) : "GÓC PHỐ QUEN"}
            </text>

            {/* Sidewalk Brick Pavement & Curb */}
            <rect x={0} y={HORIZON_Y} width={W} height={140} fill="#94A3B8" stroke="#111827" strokeWidth={3.5} />
            <rect x={0} y={HORIZON_Y + 140} width={W} height={H - HORIZON_Y - 140} fill="#334155" />
            <line x1={0} y1={HORIZON_Y + 140} x2={W} y2={HORIZON_Y + 140} stroke="#FACC15" strokeWidth={6} strokeDasharray="36 20" />

            {/* Red & Blue Plastic Sidewalk Stools (Ghế nhựa vỉa hè) */}
            {/* Red Plastic Sidewalk Stool (Ghế nhựa đỏ vỉa hè) placed cleanly beside customer */}
            <g transform={`translate(790, ${FLOOR_Y - 8})`}>
              <rect x={-22} y={-36} width={44} height={10} rx={3} fill="#EF4444" stroke="#111827" strokeWidth={2.8} />
              <polygon points="-18,-26 -24,6 -12,6 -10,-26" fill="#DC2626" stroke="#111827" strokeWidth={2.5} />
              <polygon points="18,-26 24,6 12,6 10,-26" fill="#DC2626" stroke="#111827" strokeWidth={2.5} />
            </g>

            {/* Centerpiece: Vietnamese Street Vendor Pushcart (Xe Đẩy Hàng Rong) */}
            <g transform={`translate(465, ${FLOOR_Y - 4})`}>
              {/* Umbrella Pole & Striped Hawker Umbrella Canopy */}
              <line x1={0} y1={-130} x2={0} y2={-340} stroke="#334155" strokeWidth={7} />
              <path d="M -145 -290 Q 0 -375 145 -290 Z" fill="#EF4444" stroke="#111827" strokeWidth={4} />
              <path d="M -85 -290 Q 0 -365 85 -290 Z" fill="#FACC15" stroke="#111827" strokeWidth={3.5} />
              <path d="M -28 -290 Q 0 -358 28 -290 Z" fill="#22C55E" stroke="#111827" strokeWidth={3} />

              {/* Push Handle on the left (for the Seller) */}
              <path d="M -115 -140 L -150 -162 L -150 -132" fill="none" stroke="#111827" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />

              {/* Glass Display Case (Tủ kính trưng bày đồ ăn) */}
              <rect x={-105} y={-235} width={210} height={95} rx={6} fill="rgba(224, 242, 254, 0.78)" stroke="#111827" strokeWidth={4} />
              {/* Top Signboard on Glass Case */}
              <rect x={-110} y={-268} width={220} height={36} rx={6} fill="#FACC15" stroke="#111827" strokeWidth={3.5} />
              <text x={0} y={-244} textAnchor="middle" fontSize={17.5} fontWeight={900} fill="#111827" fontFamily="Be Vietnam Pro, sans-serif">
                {cartTopBanner}
              </text>

              {/* Steaming Sticky-Rice / Broth Pot inside/on Cart + Animated Rising Steam */}
              <ellipse cx={-38} cy={-158} rx={36} ry={12} fill="#94A3B8" stroke="#111827" strokeWidth={3} />
              <rect x={-74} y={-192} width={72} height={36} rx={5} fill="#CBD5E1" stroke="#111827" strokeWidth={3.2} />
              <ellipse cx={-38} cy={-192} rx={34} ry={10} fill="#FDE047" stroke="#111827" strokeWidth={2.8} />
              {/* Animated Steam Puffs rising from the hot pot */}
              <path
                d={`M -52 ${-202 - steamOffset * 0.7} Q -60 ${-216 - steamOffset * 0.7} -46 ${-228 - steamOffset * 0.7}`}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={3.5}
                strokeLinecap="round"
                opacity={Math.max(0.2, 1 - steamOffset / 34)}
              />
              <path
                d={`M -26 ${-206 - ((steamOffset + 15) % 34) * 0.7} Q -18 ${-220 - ((steamOffset + 15) % 34) * 0.7} -30 ${-232 - ((steamOffset + 15) % 34) * 0.7}`}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={3.5}
                strokeLinecap="round"
                opacity={Math.max(0.2, 1 - ((steamOffset + 15) % 34) / 34)}
              />

              {/* Stacked Banh Mi / Food Trays & Sauce Bottles on Right Half of Glass Case */}
              <ellipse cx={46} cy={-162} rx={38} ry={14} fill="#F59E0B" stroke="#111827" strokeWidth={3} />
              <rect x={22} y={-205} width={16} height={32} rx={4} fill="#EF4444" stroke="#111827" strokeWidth={2.5} />
              <rect x={44} y={-202} width={16} height={29} rx={4} fill="#22C55E" stroke="#111827" strokeWidth={2.5} />

              {/* Lower Metal Pushcart Body */}
              <rect x={-115} y={-140} width={230} height={96} rx={8} fill="#0284C7" stroke="#111827" strokeWidth={4.2} />
              <rect x={-100} y={-124} width={200} height={64} rx={6} fill="#FEF08A" stroke="#111827" strokeWidth={3} />
              <text x={0} y={-84} textAnchor="middle" fontSize={19.5} fontWeight={900} fill="#DC2626" fontFamily="Be Vietnam Pro, sans-serif">
                {cartBottomBanner}
              </text>

              {/* Two Spoked Cart Wheels */}
              {[-72, 72].map((wx) => (
                <g key={wx} transform={`translate(${wx}, -26)`}>
                  <circle cx={0} cy={0} r={32} fill="#1E293B" stroke="#111827" strokeWidth={4.5} />
                  <circle cx={0} cy={0} r={21} fill="#E2E8F0" stroke="#111827" strokeWidth={3} />
                  <line x1={-20} y1={0} x2={20} y2={0} stroke="#111827" strokeWidth={2.5} />
                  <line x1={0} y1={-20} x2={0} y2={20} stroke="#111827" strokeWidth={2.5} />
                  <circle cx={0} cy={0} r={6} fill="#FACC15" stroke="#111827" strokeWidth={2.5} />
                </g>
              ))}
            </g>
          </svg>
        </div>
      );
    }

    case "sidewalk_tea": {
      const ctxLower = `${contextText} ${act?.title ?? ""} ${act?.statLeft ?? ""} ${act?.statRight ?? ""}`.toLowerCase();
      const leftStallBanner = /(bánh mì)/i.test(ctxLower)
        ? "HÀNG BÁNH MÌ"
        : /(phở|bún)/i.test(ctxLower)
          ? "HÀNG PHỞ • BÚN"
          : /(xôi)/i.test(ctxLower)
            ? "HÀNG XÔI NÓNG"
            : act?.statLeft
              ? trimWordsToFit(act.statLeft.toUpperCase(), 16)
              : "QUẦY ĐỒ ĂN";
      const rightStallBanner = /(cà phê)/i.test(ctxLower)
        ? "CÀ PHÊ VỈA HÈ"
        : /(nước|trà đá|nước mía)/i.test(ctxLower)
          ? "TRÀ ĐÁ • NƯỚC MÍA"
          : act?.statRight
            ? trimWordsToFit(act.statRight.toUpperCase(), 16)
            : "QUẦY ĐỒ UỐNG";
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #1E293B 0%, #0EA5E9 60%, #475569 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Sidewalk Pavement */}
            <rect x={0} y={HORIZON_Y} width={W} height={145} fill="#94A3B8" stroke="#111827" strokeWidth={3.5} />
            <rect x={0} y={HORIZON_Y + 145} width={W} height={H - HORIZON_Y - 145} fill="#334155" />

            {/* Background Shophouses */}
            <rect x={60} y={HORIZON_Y - 580} width={310} height={580} rx={6} fill="#FEF3C7" stroke="#111827" strokeWidth={3.5} />
            <rect x={60} y={HORIZON_Y - 410} width={310} height={46} fill="#DC2626" stroke="#111827" strokeWidth={3} />
            <text x={215} y={HORIZON_Y - 380} textAnchor="middle" fontSize={20} fontWeight={900} fill="#FFFFFF" fontFamily="Be Vietnam Pro, sans-serif">
              {act?.statLeft ? trimWordsToFit(act.statLeft.toUpperCase(), 20) : "HÀNG QUÁN SÁT VÁCH"}
            </text>
            <rect x={710} y={HORIZON_Y - 540} width={310} height={540} rx={6} fill="#E0F2FE" stroke="#111827" strokeWidth={3.5} />
            <rect x={710} y={HORIZON_Y - 380} width={310} height={46} fill="#0284C7" stroke="#111827" strokeWidth={3} />
            <text x={865} y={HORIZON_Y - 350} textAnchor="middle" fontSize={20} fontWeight={900} fill="#FFFFFF" fontFamily="Be Vietnam Pro, sans-serif">
              {act?.statRight ? trimWordsToFit(act.statRight.toUpperCase(), 20) : "TƯƠNG TRỢ VỈA HÈ"}
            </text>

            {/* Left Stall: Hàng Xôi Nóng */}
            <g transform={`translate(355, ${FLOOR_Y - 6})`}>
              <line x1={0} y1={-120} x2={0} y2={-295} stroke="#334155" strokeWidth={6} />
              <path d="M -115 -250 Q 0 -325 115 -250 Z" fill="#EF4444" stroke="#111827" strokeWidth={3.8} />
              <rect x={-85} y={-195} width={170} height={68} rx={6} fill="rgba(254, 249, 195, 0.85)" stroke="#111827" strokeWidth={3.5} />
              <rect x={-90} y={-127} width={180} height={82} rx={8} fill="#EA580C" stroke="#111827" strokeWidth={3.8} />
              <text x={0} y={-78} textAnchor="middle" fontSize={18} fontWeight={900} fill="#FFFFFF" fontFamily="Be Vietnam Pro, sans-serif">
                {leftStallBanner}
              </text>
              <circle cx={-52} cy={-24} r={24} fill="#1E293B" stroke="#111827" strokeWidth={3.8} />
              <circle cx={52} cy={-24} r={24} fill="#1E293B" stroke="#111827" strokeWidth={3.8} />
            </g>

            {/* Right Stall: Hàng Nước / Trà Đá Sát Vách */}
            <g transform={`translate(725, ${FLOOR_Y - 6})`}>
              <line x1={0} y1={-120} x2={0} y2={-295} stroke="#334155" strokeWidth={6} />
              <path d="M -115 -250 Q 0 -325 115 -250 Z" fill="#16A34A" stroke="#111827" strokeWidth={3.8} />
              <rect x={-85} y={-195} width={170} height={68} rx={6} fill="rgba(224, 242, 254, 0.85)" stroke="#111827" strokeWidth={3.5} />
              {/* Iced Tea Pitcher & Cups on the Drink Cart */}
              <rect x={-48} y={-182} width={28} height={46} rx={5} fill="#22C55E" stroke="#111827" strokeWidth={2.8} />
              <rect x={-6} y={-168} width={18} height={32} rx={3} fill="#FACC15" stroke="#111827" strokeWidth={2.5} />
              <rect x={22} y={-168} width={18} height={32} rx={3} fill="#FACC15" stroke="#111827" strokeWidth={2.5} />
              <rect x={-90} y={-127} width={180} height={82} rx={8} fill="#0284C7" stroke="#111827" strokeWidth={3.8} />
              <text x={0} y={-78} textAnchor="middle" fontSize={18} fontWeight={900} fill="#FEF08A" fontFamily="Be Vietnam Pro, sans-serif">
                {rightStallBanner}
              </text>
              <circle cx={-52} cy={-24} r={24} fill="#1E293B" stroke="#111827" strokeWidth={3.8} />
              <circle cx={52} cy={-24} r={24} fill="#1E293B" stroke="#111827" strokeWidth={3.8} />
            </g>
          </svg>
        </div>
      );
    }

    case "race_track": {
      const car1X = lerp(290, 560, p) + Math.sin(f * 0.25) * 8;
      const car2X = lerp(210, 440, p) + Math.cos(f * 0.22) * 8;
      const stripeShift = (f * 14) % 80;
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #091526 0%, #1E293B 58%, #334155 100%)",
          }}
        >
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            {/* Grandstand Stadium Lights & Racing Arch */}
            <g transform="translate(540, 880)">
              <rect x={-380} y={-110} width={22} height={480} fill="#475569" stroke="#111827" strokeWidth={3.5} />
              <rect x={358} y={-110} width={22} height={480} fill="#475569" stroke="#111827" strokeWidth={3.5} />
              <rect x={-410} y={-145} width={820} height={68} rx={12} fill="#DC2626" stroke="#111827" strokeWidth={4} />
              <text x={0} y={-102} textAnchor="middle" fontSize={28} fontWeight={900} fill="#FEF08A" fontFamily="Be Vietnam Pro, sans-serif">
                🏁 ĐƯỜNG ĐUA TỐC ĐỘ • GRAND PRIX 🏁
              </text>
            </g>

            {/* Asphalt Racing Track & Red-White Racing Curbs */}
            <rect x={0} y={HORIZON_Y - 10} width={W} height={210} fill="#1E293B" stroke="#111827" strokeWidth={4} />
            {Array.from({length: 16}, (_, i) => (
              <rect
                key={`curb-top-${i}`}
                x={i * 80 - stripeShift}
                y={HORIZON_Y - 10}
                width={40}
                height={18}
                fill={i % 2 === 0 ? "#EF4444" : "#FFFFFF"}
              />
            ))}
            {Array.from({length: 16}, (_, i) => (
              <rect
                key={`curb-bot-${i}`}
                x={i * 80 - stripeShift}
                y={HORIZON_Y + 182}
                width={40}
                height={18}
                fill={i % 2 === 0 ? "#FFFFFF" : "#EF4444"}
              />
            ))}

            {/* High-Speed Dashed Center Lane */}
            {Array.from({length: 9}, (_, i) => (
              <rect
                key={`lane-${i}`}
                x={((i * 150 - f * 18) % 1250 + 1250) % 1250 - 100}
                y={HORIZON_Y + 84}
                width={75}
                height={10}
                rx={4}
                fill="#FACC15"
              />
            ))}

            {/* Rival Race Car #2 (Blue/Cyan F1 in upper lane) */}
            <g transform={`translate(${car2X}, ${HORIZON_Y + 42}) scale(0.86)`}>
              <path d="M -145 -8 L -185 -18 L -165 0 L -190 12 L -145 8 Z" fill="#38BDF8" />
              <polygon points="-135,12 -125,-28 -45,-32 45,-22 135,4 145,18 -135,18" fill="#0284C7" stroke="#111827" strokeWidth={4} />
              <rect x={-145} y={-48} width={26} height={36} rx={4} fill="#FACC15" stroke="#111827" strokeWidth={3.5} />
              <circle cx={-82} cy={18} r={26} fill="#0F172A" stroke="#E2E8F0" strokeWidth={5} />
              <circle cx={86} cy={18} r={26} fill="#0F172A" stroke="#E2E8F0" strokeWidth={5} />
            </g>

            {/* Lead Formula-1 / Supercar #1 (Red/Gold with Nitro Flame) */}
            <g transform={`translate(${car1X}, ${HORIZON_Y + 132})`}>
              {/* Nitro Exhaust Flame */}
              <path d="M -145 -6 L -205 -22 L -175 -2 L -215 12 L -145 10 Z" fill="#F97316" />
              <path d="M -145 -2 L -180 -10 L -162 2 L -185 8 L -145 6 Z" fill="#FEF08A" />
              {/* Rear Wing Spoiler */}
              <rect x={-148} y={-54} width={30} height={42} rx={5} fill="#111827" stroke="#FACC15" strokeWidth={3.5} />
              {/* Aerodynamic F1 Body */}
              <path
                d="M -135 16 L -122 -26 L -35 -36 L 45 -24 L 145 4 L 155 18 Z"
                fill="#EF4444"
                stroke="#111827"
                strokeWidth={4.5}
              />
              {/* Cockpit & Racing Number #1 */}
              <path d="M -52 -34 L 18 -34 L 42 -16 L -65 -16 Z" fill="#38BDF8" stroke="#111827" strokeWidth={3} />
              <circle cx={-8} cy={-4} r={16} fill="#FFFFFF" stroke="#111827" strokeWidth={3} />
              <text x={-8} y={3} textAnchor="middle" fontSize={18} fontWeight={900} fill="#111827" fontFamily="Be Vietnam Pro, sans-serif">
                1
              </text>
              {/* Racing Slicks */}
              <circle cx={-86} cy={18} r={29} fill="#0F172A" stroke="#FACC15" strokeWidth={5.5} />
              <circle cx={92} cy={18} r={29} fill="#0F172A" stroke="#FACC15" strokeWidth={5.5} />
            </g>
          </svg>
        </div>
      );
    }

    case "park_dawn":
    default: {
      return (
        <>
          <Land sky="dawn" horizon={HORIZON_Y} treeLine grass={100} />
          <Stars count={35} seed={15} horizon={HORIZON_Y} fade={0.45} />
          <Sun x={540} y={lerp(HORIZON_Y - 30, HORIZON_Y - 130, p)} size={135} on={1} horizon={HORIZON_Y} />
          <Clouds sky="dawn" count={4} speed={0.4} seed={6} horizon={HORIZON_Y} />
          <svg width={W} height={H} style={{position: "absolute", left: 0, top: 0}}>
            <Oak x={140} y={HORIZON_Y + 25} s={0.55} seed={3} />
            <Tent x={890} y={HORIZON_Y + 45} s={0.82} />
            <Campfire x={540} y={FLOOR_Y + 8} s={1.1} />
          </svg>
        </>
      );
    }
  }
};

/** Trim a string on a clean word boundary so a Vietnamese word is NEVER cut in half */
const trimWordsToFit = (s: string, maxChars: number): string => {
  const clean = s.trim();
  if (clean.length <= maxChars) return clean;
  const words = clean.split(/\s+/);
  let out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > maxChars) break;
    out = next;
  }
  return out || clean.slice(0, maxChars);
};

/**
 * Guarantees that any SVG <text> rendered inside a container of width `boxW`
 * NEVER overflows or touches its left/right border:
 * 1) Automatically scales down `fontSize` when `text` is long relative to `boxW`.
 * 2) Adds `textLength` + `lengthAdjust="spacingAndGlyphs"` if estimated width approaches `boxW - pad`.
 */
const fitSvgText = (
  text: string | undefined | null,
  boxW: number,
  baseFs = 14,
  pad = 30,
): {fontSize: number; textLength?: number; lengthAdjust?: "spacingAndGlyphs"} => {
  const s = (text || "").trim();
  const len = Math.max(1, s.length);
  const availW = Math.max(36, boxW - pad);
  const maxFsByWidth = Math.floor((availW / (len * 0.74)) * 2) / 2;
  const fontSize = Math.max(8.5, Math.min(baseFs, maxFsByWidth));
  const estW = len * fontSize * 0.67;
  if (estW > availW) {
    return {
      fontSize,
      textLength: Math.round(availW),
      lengthAdjust: "spacingAndGlyphs",
    };
  }
  return {fontSize};
};

/**
 * Safely sanitize AI-generated custom SVG markup:
 * 1) Auto-convert small/medium <circle> badges into rounded capsule pills (<rect rx=...>) whenever centered <text> inside them is wider than the circle diameter (e.g., "TỪ CHUẨN" or "LÝ TIỂU LONG" inside r="35"), while keeping short 1–3 char badges ("VS", "?", "4%") circular.
 * 2) Auto-expand narrow <rect> / <ellipse> containers and clamp <text> font-size + textLength to container bounds so text NEVER overflows or clips its container!
 */
const sanitizeCustomSvg = (rawSvg?: string): string => {
  if (!rawSvg || typeof rawSvg !== "string") return "";
  let svg = rawSvg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, "")
    .replace(/<\/?svg[^>]*>/gi, "")
    .replace(/>LO HỔNG KIẾN</g, ">LO HỔNG KIẾN THỨC<");

  const getAttrNum = (attrs: string, name: string): number | null => {
    const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["'](-?\\d+(?:\\.\\d+)?)["']`, "i"));
    return m ? parseFloat(m[1]) : null;
  };
  const getAttrStr = (attrs: string, name: string): string | null => {
    const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
    return m ? m[1] : null;
  };

  // Pre-scan parent card <rect>s and <circle>s so we know spatial boundaries before sizing <text>
  const parentCards: Array<{x: number; y: number; w: number; h: number}> = [];
  const innerRects: Array<{x: number; y: number; w: number; h: number}> = [];
  for (const m of svg.matchAll(/<rect\b([^>]*?)\/?>/gi)) {
    const attrs = m[1];
    const rx = getAttrNum(attrs, "x");
    const ry = getAttrNum(attrs, "y");
    const rw = getAttrNum(attrs, "width");
    const rh = getAttrNum(attrs, "height");
    if (rx === null || ry === null || rw === null || rh === null) continue;
    if (rw >= 130 && rw <= 260 && rh >= 95) {
      parentCards.push({x: rx, y: ry, w: rw, h: rh});
    } else if (rw < 395 && rh < 95) {
      innerRects.push({x: rx, y: ry, w: rw, h: rh});
    }
  }

  const circles: Array<{cx: number; cy: number; r: number; fill: string}> = [];
  for (const m of svg.matchAll(/<circle\b([^>]*?)\/?>/gi)) {
    const attrs = m[1];
    const cx = getAttrNum(attrs, "cx");
    const cy = getAttrNum(attrs, "cy");
    const r = getAttrNum(attrs, "r");
    const fill = (getAttrStr(attrs, "fill") || "").toLowerCase();
    if (cx !== null && cy !== null && r !== null) {
      circles.push({cx, cy, r, fill});
    }
  }

  // Collect all <text> positions and their required pixel width
  const textItems: Array<{x: number; y: number; reqWidth: number; maxCardW: number}> = [];
  svg = svg.replace(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi, (full, attrs, innerText) => {
    const cleanText = String(innerText)
      .replace(/&gt;/g, ">")
      .replace(/&lt;/g, "<")
      .replace(/&amp;/g, "&")
      .replace(/<[^>]*>/g, "")
      .trim();
    const charLen = cleanText.length;
    const tx = getAttrNum(attrs, "x") ?? 0;
    const ty = getAttrNum(attrs, "y") ?? 0;
    const origFs = getAttrNum(attrs, "font-size") ?? 15;
    let maxSafeFs =
      charLen >= 28
        ? 10
        : charLen >= 22
          ? 11
          : charLen >= 18
            ? 11.5
            : charLen >= 14
              ? 12
              : charLen >= 10
                ? 13
                : origFs;

    let maxCardW = Math.abs(tx) <= 35 ? 380 : 196;
    let enclosingRectW: number | null = null;
    if (charLen > 0) {
      // Check if text sits inside a parent card (e.g. left green card or right orange card)
      for (const card of parentCards) {
        if (tx >= card.x + 8 && tx <= card.x + card.w - 8 && ty >= card.y && ty <= card.y + card.h + 8) {
          maxCardW = Math.min(maxCardW, card.w - 22);
        }
      }

      // Check if text sits inside a concentric/donut/prohibition circle that cannot become a wider pill
      for (const c of circles) {
        const inCircle = Math.abs(tx - c.cx) <= 18 && Math.abs(ty - c.cy) <= Math.max(20, c.r * 0.75);
        if (!inCircle) continue;
        const hasConcentricPartner = circles.some(
          (other) => other !== c && Math.hypot(other.cx - c.cx, other.cy - c.cy) <= 10 && Math.abs(other.r - c.r) >= 12
        );
        if (hasConcentricPartner || c.r > 62 || c.fill === "none") {
          const maxCircleTextW = Math.max(36, c.r * 2 - 22);
          maxCardW = Math.min(maxCardW, maxCircleTextW);
          const fitCircleFs = Math.max(8, Math.floor(((maxCircleTextW - 14) / (charLen * 0.75)) * 2) / 2);
          maxSafeFs = Math.min(maxSafeFs, fitCircleFs);
        }
      }

      // Check if text sits inside an innerRect
      for (const ir of innerRects) {
        const irCx = ir.x + ir.w / 2;
        if (Math.abs(tx - irCx) <= 24 && ty >= ir.y - 4 && ty <= ir.y + ir.h + 6) {
          enclosingRectW = enclosingRectW !== null ? Math.min(enclosingRectW, ir.w) : ir.w;
          const blockedByRing = circles.some(
            (c) => c.fill === "none" && Math.abs(c.cx - irCx) <= 18 && Math.abs(c.cy - (ir.y + ir.h / 2)) <= 24
          );
          if (blockedByRing) {
            maxCardW = Math.min(maxCardW, ir.w - 16);
          }
        }
      }

      // Ensure font-size never forces text wider than its container bound
      const effectiveBoundW = enclosingRectW !== null ? Math.min(maxCardW, Math.max(enclosingRectW, maxCardW)) : maxCardW;
      const fitCardFs = Math.max(8, Math.floor(((effectiveBoundW - 26) / (charLen * 0.75)) * 2) / 2);
      maxSafeFs = Math.min(maxSafeFs, fitCardFs);
    }

    const clampedFs = Math.min(origFs, maxSafeFs);
    const estRenderedW = charLen * clampedFs * 0.75 + 34;

    if (charLen > 0) {
      textItems.push({
        x: tx,
        y: ty,
        reqWidth: Math.ceil(estRenderedW),
        maxCardW,
      });
    }

    let nextAttrs = attrs;
    if (/font-size\s*=/i.test(nextAttrs)) {
      nextAttrs = nextAttrs.replace(/font-size=(["'])(\d+(?:\.\d+)?)\1/i, `font-size=$1${clampedFs}$1`);
    } else {
      nextAttrs += ` font-size="${clampedFs}"`;
    }
    if (!/font-family\s*=/i.test(nextAttrs)) {
      nextAttrs += ` font-family="Be Vietnam Pro, Inter, system-ui, sans-serif"`;
    }
    // Hard browser-level safety net: if text could still approach maxCardW, add textLength
    const maxAllowedTextW = Math.max(34, maxCardW - 24);
    if (charLen >= 6 && charLen * clampedFs * 0.68 > maxAllowedTextW && !/\btextLength\s*=/i.test(nextAttrs)) {
      nextAttrs += ` textLength="${Math.round(maxAllowedTextW)}" lengthAdjust="spacingAndGlyphs"`;
    }
    return `<text${nextAttrs}>${innerText}</text>`;
  });

  // Auto-convert small/medium <circle> badges into rounded capsule pills (<rect>) when centered <text> overflows the circle!
  svg = svg.replace(/<circle\b([^>]*?)\/?>/gi, (full, attrs) => {
    const cx = getAttrNum(attrs, "cx");
    const cy = getAttrNum(attrs, "cy");
    const r = getAttrNum(attrs, "r");
    const fill = (getAttrStr(attrs, "fill") || "").toLowerCase();
    if (cx === null || cy === null || r === null) return full;
    if (r > 62 || r < 14 || fill === "none" || fill === "transparent") return full;

    // Skip concentric rings / target / clock circles
    const hasConcentricPartner = circles.some(
      (other) => Math.hypot(other.cx - cx, other.cy - cy) <= 10 && Math.abs(other.r - r) >= 12
    );
    if (hasConcentricPartner) return full;

    let neededW = 0;
    let boundW = 192;
    for (const t of textItems) {
      const horizAligned = Math.abs(t.x - cx) <= 16;
      const vertInside = Math.abs(t.y - cy) <= Math.max(18, r * 0.72);
      if (horizAligned && vertInside && t.reqWidth > r * 2 - 10) {
        neededW = Math.max(neededW, t.reqWidth);
        boundW = Math.min(boundW, t.maxCardW);
      }
    }
    if (neededW <= 0) return full;

    const pillW = Math.round(Math.min(boundW, Math.max(neededW, r * 2 + 8)));
    const pillH = Math.round(Math.min(r * 2, Math.max(44, r * 1.55)));
    const pillX = Math.round((cx - pillW / 2) * 10) / 10;
    const pillY = Math.round((cy - pillH / 2) * 10) / 10;
    const pillRx = Math.round(pillH / 2);

    const passthroughAttrs = attrs
      .replace(/\bcx\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\bcy\s*=\s*["'][^"']*["']/gi, "")
      .replace(/\br\s*=\s*["'][^"']*["']/gi, "")
      .trim();

    return `<rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillRx}" ${passthroughAttrs}/>`;
  });

  // Auto-widen any <ellipse> badge whose centered <text> exceeds 2 * rx
  svg = svg.replace(/<ellipse\b([^>]*?)\/?>/gi, (full, attrs) => {
    const cx = getAttrNum(attrs, "cx");
    const cy = getAttrNum(attrs, "cy");
    const rx = getAttrNum(attrs, "rx");
    const ry = getAttrNum(attrs, "ry");
    if (cx === null || cy === null || rx === null || ry === null || rx >= 105) return full;

    let neededRx = rx;
    for (const t of textItems) {
      if (Math.abs(t.x - cx) <= 16 && Math.abs(t.y - cy) <= Math.max(18, ry * 0.8)) {
        const targetW = Math.min(t.maxCardW, t.reqWidth);
        neededRx = Math.max(neededRx, Math.ceil(targetW / 2));
      }
    }
    if (neededRx <= rx) return full;
    const updatedAttrs = attrs.replace(/\brx\s*=\s*(["'])\d+(?:\.\d+)?\1/i, `rx=$1${neededRx}$1`);
    return full.endsWith("/>") ? `<ellipse${updatedAttrs}/>` : `<ellipse${updatedAttrs}>`;
  });

  // Auto-widen any <rect> badge/pill/banner that encloses a <text> wider than the <rect>
  svg = svg.replace(/<rect\b([^>]*?)\/?>/gi, (full, attrs) => {
    const rx = getAttrNum(attrs, "x");
    const ry = getAttrNum(attrs, "y");
    const rw = getAttrNum(attrs, "width");
    const rh = getAttrNum(attrs, "height");
    if (rx === null || ry === null || rw === null || rh === null) return full;
    // Adjust inner badge/box/banner rects (not the outer stage card or tall column cards)
    if (rw >= 385 || rh >= 100) return full;

    const centerX = rx + rw / 2;
    let neededW = rw;
    for (const t of textItems) {
      const horizAligned = Math.abs(t.x - centerX) <= 24;
      const vertInside = t.y >= ry - 4 && t.y <= ry + rh + 6;
      if (horizAligned && vertInside && t.reqWidth > neededW) {
        neededW = Math.min(t.maxCardW, t.reqWidth);
      }
    }
    if (neededW <= rw) return full;

    const newX = Math.round((centerX - neededW / 2) * 10) / 10;
    const newW = Math.round(neededW);
    const updatedAttrs = attrs
      .replace(/\bx\s*=\s*(["'])-?\d+(?:\.\d+)?\1/i, `x=$1${newX}$1`)
      .replace(/\bwidth\s*=\s*(["'])\d+(?:\.\d+)?\1/i, `width=$1${newW}$1`);
    return full.endsWith("/>") ? `<rect${updatedAttrs}/>` : `<rect${updatedAttrs}>`;
  });

  // Eliminate "hình vuông vô tri" (empty colored <rect> boxes that have no <text> or <circle> inside them):
  // Automatically decorate any bare medium <rect> with 2D architectural windows/roof or document lines!
  svg = svg.replace(/<rect\b([^>]*?)\/>/gi, (full, attrs) => {
    const rx = getAttrNum(attrs, "x");
    const ry = getAttrNum(attrs, "y");
    const rw = getAttrNum(attrs, "width");
    const rh = getAttrNum(attrs, "height");
    const fill = (getAttrStr(attrs, "fill") || "").toLowerCase();
    if (rx === null || ry === null || rw === null || rh === null) return full;
    if (rw < 38 || rw > 155 || rh < 52 || rh > 165) return full;
    if (fill === "none" || fill === "transparent" || fill.startsWith("rgba(")) return full;

    const hasTextInside = textItems.some(
      (t) => t.x >= rx - 6 && t.x <= rx + rw + 6 && t.y >= ry - 4 && t.y <= ry + rh + 6,
    );
    const hasCircleInside = circles.some(
      (c) => c.cx >= rx - 4 && c.cx <= rx + rw + 4 && c.cy >= ry - 4 && c.cy <= ry + rh + 4,
    );
    if (hasTextInside || hasCircleInside) return full;

    // Decorate bare box with crisp 2D details (awning + window panes + door/lines) so it never looks like a blank block
    const cx = Math.round(rx + rw / 2);
    const roofH = Math.min(18, Math.round(rh * 0.22));
    const winW = Math.max(12, Math.round((rw - 22) / 2));
    const winH = Math.max(12, Math.round(rh * 0.24));
    const detailSvg =
      `<rect x="${rx - 3}" y="${ry}" width="${rw + 6}" height="${roofH}" rx="4" fill="#FACC15" stroke="#111827" stroke-width="2"/>` +
      `<rect x="${rx + 7}" y="${ry + roofH + 8}" width="${winW}" height="${winH}" rx="3" fill="#FEF08A" opacity="0.85"/>` +
      `<rect x="${cx + 3}" y="${ry + roofH + 8}" width="${winW}" height="${winH}" rx="3" fill="#FEF08A" opacity="0.85"/>` +
      `<line x1="${rx + 8}" y1="${ry + rh - 14}" x2="${rx + rw - 8}" y2="${ry + rh - 14}" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" opacity="0.7"/>`;
    return `${full}${detailSvg}`;
  });

  return svg.trim();
};

interface SvgFocusTarget {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  label?: string;
}

/**
 * Extracts interactive visual cards/steps inside `customSvg` (in [-260..260, -320..0] local space)
 * so the stage can spotlight and point to a different card/step on EVERY sentence (`sceneLineIdx`)!
 */
const extractSvgFocusTargets = (cleanSvg: string): SvgFocusTarget[] => {
  if (!cleanSvg) return [];
  const getAttrNum = (attrs: string, name: string): number | null => {
    const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["'](-?\\d+(?:\\.\\d+)?)["']`, "i"));
    return m ? parseFloat(m[1]) : null;
  };

  const candidates: SvgFocusTarget[] = [];
  const rectRegex = /<rect\b([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = rectRegex.exec(cleanSvg)) !== null) {
    const attrs = m[1];
    const rx = getAttrNum(attrs, "x");
    const ry = getAttrNum(attrs, "y");
    const rw = getAttrNum(attrs, "width");
    const rh = getAttrNum(attrs, "height");
    if (rx === null || ry === null || rw === null || rh === null) continue;
    // Skip outer container cards / column wrappers (height >= 140 or width >= 360) and tiny VS/dot badges (width < 76 or height < 28)
    if (rw >= 360 || rh >= 140) continue;
    if (rw < 76 || rh < 28) continue;
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    // Avoid near-duplicate overlapping rects
    if (candidates.some((c) => Math.abs(c.cx - cx) < 28 && Math.abs(c.cy - cy) < 22)) continue;
    candidates.push({x: rx, y: ry, w: rw, h: rh, cx, cy});
  }

  // Sort in natural reading order (top-to-bottom in rows of ~42px, then left-to-right)
  candidates.sort((a, b) => {
    if (Math.abs(a.cy - b.cy) > 36) return a.cy - b.cy;
    return a.cx - b.cx;
  });

  // Only spotlight real cards drawn in the SVG. No fake quadrant boxes: they
  // highlighted empty space ("ĐIỂM #1/4" jumping around unrelated to the drawing).
  return candidates.length >= 2 ? candidates : [];
};

/**
 * Renders an animated per-sentence spotlight ring, gliding pointer cursor, and live sentence takeaway banner
 * so the center illustration dynamically changes on every single sentence!
 */
const renderAnimatedBoardSpotlight = (
  cleanSvg: string,
  sceneLineIdx: number,
  totalSceneLines: number,
  f: number,
  sentenceLocalFrame: number
) => {
  const targets = extractSvgFocusTargets(cleanSvg);
  const hasTargets = targets.length > 0;
  const NONE = {x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0};

  const activeIdx = hasTargets ? sceneLineIdx % targets.length : 0;
  const prevIdx = hasTargets ? (sceneLineIdx - 1 + targets.length) % targets.length : 0;
  const cur = targets[activeIdx] ?? NONE;
  const prev = targets[prevIdx] ?? cur;

  // Smooth 12-frame glide from previous card/step to current card/step at sentence onset
  const moveT = Math.max(0, Math.min(1, sentenceLocalFrame / 12));
  const smoothT = moveT * moveT * (3 - 2 * moveT);
  const spotX = lerp(prev.x, cur.x, smoothT);
  const spotY = lerp(prev.y, cur.y, smoothT);
  const spotW = lerp(prev.w, cur.w, smoothT);
  const spotH = lerp(prev.h, cur.h, smoothT);
  const pointerX = lerp(prev.cx, cur.cx, smoothT);
  const pointerY = lerp(prev.cy, cur.cy, smoothT);

  const pulse = 1 + Math.sin(f * 0.24) * 0.04;
  const glowOpacity = 0.55 + Math.sin(f * 0.24) * 0.25;
  const pointerBob = Math.sin(f * 0.28) * 5;

  return (
    <g>
      {hasTargets && (<>
      {/* Active Card/Step Pulsing Neon Highlight Frame */}
      <rect
        x={spotX - 6}
        y={spotY - 6}
        width={spotW + 12}
        height={spotH + 12}
        rx={16}
        fill="rgba(250, 204, 21, 0.09)"
        stroke="#FACC15"
        strokeWidth={3.8}
        strokeDasharray="12 6"
        strokeDashoffset={-(f * 1.6)}
        opacity={glowOpacity}
      />
      {/* Corner Focus Brackets */}
      <g transform={`translate(${ pointerX }, ${ pointerY }) scale(${ pulse })`}>
        <circle cx={0} cy={0} r={Math.min(spotW, spotH) * 0.28} fill="rgba(56, 189, 248, 0.12)" />
      </g>
      {/* Gliding Animated Pointer Badge pointing directly at the active step/card */}
      <g transform={`translate(${pointerX + spotW * 0.34}, ${spotY - 4 + pointerBob})`}>
        <polygon points="-16,16 0,0 -5,21" fill="#EF4444" stroke="#FFFFFF" strokeWidth={2.2} />
      </g>
      </>)}

      {/* Per-Sentence Dynamic Visual Floating Badge (changes graphic & position on EVERY sentence!) */}
      {(() => {
        const widgetMode = sceneLineIdx % 4;
        const sideX = sceneLineIdx % 2 === 0 ? -296 : 296;
        const sideY = -282 + (sceneLineIdx % 3) * 14 + Math.sin(f * 0.16) * 4;
        const popScale =
          sentenceLocalFrame < 12
            ? 0.65 + Math.sin((sentenceLocalFrame / 12) * Math.PI * 0.65) * 0.42
            : 1;
        return (
          <g transform={`translate(${sideX}, ${sideY}) scale(${popScale.toFixed(3)})`}>
            <rect
              x={-52}
              y={-34}
              width={104}
              height={68}
              rx={14}
              fill="rgba(15, 23, 42, 0.94)"
              stroke={widgetMode === 0 ? "#38BDF8" : widgetMode === 1 ? "#FACC15" : widgetMode === 2 ? "#F43F5E" : "#22C55E"}
              strokeWidth={3}
            />
            {widgetMode === 0 ? (
              /* Animated Bar Chart Widget */
              <g>
                <rect x={-32} y={8 - Math.abs(Math.sin(f * 0.2)) * 18} width={14} height={14 + Math.abs(Math.sin(f * 0.2)) * 18} rx={3} fill="#38BDF8" />
                <rect x={-7} y={-4 - Math.abs(Math.cos(f * 0.22)) * 16} width={14} height={26 + Math.abs(Math.cos(f * 0.22)) * 16} rx={3} fill="#FACC15" />
                <rect x={18} y={-12 - Math.abs(Math.sin(f * 0.25)) * 14} width={14} height={34 + Math.abs(Math.sin(f * 0.25)) * 14} rx={3} fill="#22C55E" />
              </g>
            ) : widgetMode === 1 ? (
              /* Animated Magnifying Lens Scanning Clause Lines */
              <g>
                <line x1={-32} y1={-14} x2={28} y2={-14} stroke="#94A3B8" strokeWidth={4} strokeLinecap="round" />
                <line x1={-32} y1={0} x2={22} y2={0} stroke="#FACC15" strokeWidth={4} strokeLinecap="round" />
                <line x1={-32} y1={14} x2={30} y2={14} stroke="#94A3B8" strokeWidth={4} strokeLinecap="round" />
                <g transform={`translate(${Math.sin(f * 0.22) * 16}, ${Math.cos(f * 0.22) * 6})`}>
                  <circle cx={0} cy={-2} r={14} fill="rgba(56,189,248,0.28)" stroke="#38BDF8" strokeWidth={3} />
                  <line x1={10} y1={8} x2={20} y2={18} stroke="#FACC15" strokeWidth={4} strokeLinecap="round" />
                </g>
              </g>
            ) : widgetMode === 2 ? (
              /* Animated Risk Gauge Meter */
              <g>
                <path d="M -30 14 A 30 30 0 0 1 30 14" fill="none" stroke="#334155" strokeWidth={7} strokeLinecap="round" />
                <path d="M -30 14 A 30 30 0 0 1 18 -10" fill="none" stroke="#F43F5E" strokeWidth={7} strokeLinecap="round" />
                <g transform={`translate(0, 14) rotate(${25 + Math.sin(f * 0.28) * 28})`}>
                  <line x1={0} y1={0} x2={0} y2={-24} stroke="#FACC15" strokeWidth={3.5} strokeLinecap="round" />
                  <circle cx={0} cy={0} r={5} fill="#FFFFFF" />
                </g>
              </g>
            ) : (
              /* Animated Checkmark Shield / Verification Pulse */
              <g transform={`scale(${1 + Math.sin(f * 0.24) * 0.08})`}>
                <circle cx={0} cy={0} r={20} fill="rgba(34,197,94,0.2)" stroke="#22C55E" strokeWidth={3} />
                <polyline points="-10,1 -3,8 12,-7" fill="none" stroke="#22C55E" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
              </g>
            )}
          </g>
        );
      })()}
    </g>
  );
};

/**
 * Renders a Live Per-Sentence Takeaway Banner + Animated Vector Mini-Graphic that pops in on EVERY sentence (`sceneLineIdx`),
 * extracting numbers/metrics and key phrases from the exact sentence being spoken right now!
 */
const renderLiveSentenceTakeawayCard = (
  rawSpokenSentence: string,
  activeDialogue: string,
  sceneLineIdx: number,
  totalSceneLines: number,
  f: number,
  sentenceLocalFrame: number,
  cx: number,
  cy: number,
  scale = 1
) => {
  const spoken = (rawSpokenSentence || activeDialogue || "").trim();
  if (!spoken) return null;
  const lower = spoken.toLowerCase();

  // Steady center card (NO scale/position bounce on center text to prevent eye strain — smooth fade only!)
  const fadeOpacity = sentenceLocalFrame < 8 ? 0.86 + (sentenceLocalFrame / 8) * 0.14 : 1;

  // Extract any number/percentage/money metric from the current sentence
  const numMatch = spoken.match(
    /\b(\d+(?:[.,]\d+)?\s*(?:%|triệu|tỷ|nghìn|ngàn|đồng|bước|tháng|năm|ngày|lần|mét|km|m2|giờ|phút))\b/i
  );
  const metricBadge = numMatch
    ? numMatch[1].toUpperCase()
    : `Ý ${sceneLineIdx + 1}/${Math.max(1, totalSceneLines)}`;

  // Build crisp 5-7 word key phrase from the spoken sentence or activeDialogue
  const cleanSource = activeDialogue && activeDialogue.length >= 8 ? activeDialogue : spoken;
  const words = cleanSource
    .replace(/[.,!?;:"“”()—–-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const phrase = words.slice(0, 7).join(" ").toUpperCase();

  // Choose animated vector mini-graphic theme based on sentence semantics
  const isMoney = /(tiền|giá|phí|vốn|lãi|lỗ|triệu|tỷ|đồng|chi phí|doanh thu|thu nhập)/i.test(lower);
  const isWarning = /(bẫy|ép|cấm|phạt|mất|đóng cửa|sập|nguy hiểm|rủi ro|cẩn thận|vỡ nợ|lừa)/i.test(lower);
  const isCheck = /(kiểm tra|bước|hợp đồng|soi|điều khoản|cam kết|bảng giá|hỏi|so sánh)/i.test(lower);
  const accentColor = isWarning ? "#F43F5E" : isMoney ? "#FACC15" : isCheck ? "#22C55E" : "#38BDF8";

  const pillW = Math.max(460, Math.min(680, phrase.length * 13.5 + 210));
  const leftEdge = -pillW / 2;

  return (
    <g transform={`translate(${Math.round(cx)}, ${Math.round(cy)}) scale(${scale})`} opacity={fadeOpacity} textRendering="geometricPrecision">
      <rect
        x={leftEdge}
        y={-30}
        width={pillW}
        height={60}
        rx={18}
        fill="rgba(15, 23, 42, 0.94)"
        stroke={accentColor}
        strokeWidth={3.2}
      />
      {/* Animated Vector Mini-Graphic on Left */}
      <g transform={`translate(${leftEdge + 36}, 0)`}>
        <circle cx={0} cy={0} r={20} fill="rgba(255,255,255,0.08)" stroke={accentColor} strokeWidth={2.2} />
        {isWarning ? (
          <g transform={`scale(${1 + Math.sin(f * 0.35) * 0.12})`}>
            <polygon points="0,-12 12,10 -12,10" fill="#F43F5E" stroke="#FFFFFF" strokeWidth={1.8} />
            <line x1={0} y1={-4} x2={0} y2={3} stroke="#FFFFFF" strokeWidth={2.4} strokeLinecap="round" />
            <circle cx={0} cy={7} r={1.5} fill="#FFFFFF" />
          </g>
        ) : isMoney ? (
          <g transform={`translate(0, ${Math.sin(f * 0.25) * 2.5})`}>
            <rect x={-11} y={-7} width={22} height={14} rx={3} fill="#22C55E" stroke="#FFFFFF" strokeWidth={1.8} />
            <circle cx={0} cy={0} r={4} fill="#FACC15" />
          </g>
        ) : isCheck ? (
          <g transform={`rotate(${Math.sin(f * 0.22) * 14})`}>
            <circle cx={-2} cy={-2} r={8} fill="none" stroke="#38BDF8" strokeWidth={2.5} />
            <line x1={4} y1={4} x2={11} y2={11} stroke="#FACC15" strokeWidth={3} strokeLinecap="round" />
          </g>
        ) : (
          <g>
            <rect x={-10} y={2 - Math.abs(Math.sin(f * 0.2)) * 8} width={5} height={8 + Math.abs(Math.sin(f * 0.2)) * 8} rx={1} fill="#38BDF8" />
            <rect x={-2} y={-4 - Math.abs(Math.cos(f * 0.2)) * 8} width={5} height={14 + Math.abs(Math.cos(f * 0.2)) * 8} rx={1} fill="#FACC15" />
            <rect x={6} y={-8 - Math.abs(Math.sin(f * 0.25)) * 6} width={5} height={18 + Math.abs(Math.sin(f * 0.25)) * 6} rx={1} fill="#22C55E" />
          </g>
        )}
      </g>

      {/* Highlighted Metric / Step Pill */}
      <g transform={`translate(${leftEdge + 126}, 0)`}>
        <rect x={-56} y={-18} width={112} height={36} rx={10} fill={accentColor} />
        <text
          x={0}
          y={6}
          textAnchor="middle"
          fontFamily="Be Vietnam Pro, Inter, sans-serif"
          fontSize={metricBadge.length > 9 ? 13 : 15}
          fontWeight={900}
          fill="#0F172A"
        >
          {metricBadge}
        </text>
      </g>

      {/* Crisp Sentence Takeaway Text */}
      <text
        x={leftEdge + 200 + (pillW - 216) / 2}
        y={6}
        textAnchor="middle"
        fontFamily="Be Vietnam Pro, Inter, sans-serif"
        fontSize={phrase.length > 30 ? 15.5 : 17.5}
        fontWeight={800}
        fill="#FFFFFF"
      >
        {phrase}
      </text>
    </g>
  );
};

/**
 * Dynamically render script-driven objects & live sentence visual callouts right on stage based on the exact spoken sentence!
 * Never fixed to pre-made templates: adapts to whatever items/events/numbers the narrator is talking about right now.
 */
const renderDynamicSentenceObjects = (
  sentenceText: string,
  activeSetting: StickmanSetting,
  f: number,
  customSvg?: string,
  rawSpokenSentence = "",
  sceneLineIdx = 0,
  totalSceneLines = 1,
  sentenceLocalFrame = 0
) => {
  const lower = sentenceText.toLowerCase();
  const spokenLower = (rawSpokenSentence || sentenceText).toLowerCase();
  const bob = Math.sin(f * 0.1) * 4;
  const flash = Math.sin(f * 0.35) > 0;

  const hasMotorbike = /(xe máy|xe ôm|shipper|giao hàng|tài xế|chở hàng|đặt xe)/i.test(lower);
  const hasCreatorSetup = /(tiktok|follow|lượt xem|view|livestream|quay video|máy quay|kênh|thuật toán|đề xuất)/i.test(lower);
  const hasInspectionAlert = /(đoàn kiểm tra|trật tự|phường|bị dẹp|dọn hàng|nháy mắt|báo hiệu|báo động)/i.test(lower);
  const hasMoneyExchange = /(sang nhượng|đặt cọc|tiền lẻ|giữ giá|giá chung|nhường tiền|chi phí|doanh thu|lợi nhuận)/i.test(lower);
  const hasScheduleClock = /(sáng sớm|mỗi sáng|đúng giờ|khung giờ|đứng cố định|mỗi ngày|thời gian)/i.test(lower);
  const cleanCustomSvg = sanitizeCustomSvg(customSvg);

  // Extract live sentence-level visual cue & key phrase from the exact sentence being spoken right now
  let liveIcon = "💡";
  let liveAccent = "#38BDF8";
  if (/(lương|thu nhập|tiền|tỷ|triệu|đồng|giàu|tài sản|vàng|lãi|vốn)/i.test(spokenLower)) {
    liveIcon = "💰";
    liveAccent = "#FACC15";
  } else if (/(chi tiêu|mua sắm|tiêu sạch|cắt bớt|tiết kiệm|giá|đắt|rẻ|lỗ)/i.test(spokenLower)) {
    liveIcon = "📉";
    liveAccent = "#F43F5E";
  } else if (/(vòng xoay|mãi chạy|tâm lý|nỗi sợ|hoảng|cảm xúc|nghiện|adrenaline)/i.test(spokenLower)) {
    liveIcon = "🧠";
    liveAccent = "#A855F7";
  } else if (/(quy tắc|nghiên cứu|chuyên gia|năm 19|năm 20|phép tính|công thức|tích lũy)/i.test(spokenLower)) {
    liveIcon = "📊";
    liveAccent = "#22C55E";
  } else if (/(xăng|xe|đường|kẹt|xếp hàng|nổ máy|tốc độ|đua)/i.test(spokenLower)) {
    liveIcon = "⛽";
    liveAccent = "#F97316";
  } else if (/(thời gian|một tiếng|ngày mai|đi làm|nghỉ ngơi|tự do)/i.test(spokenLower)) {
    liveIcon = "⏱️";
    liveAccent = "#38BDF8";
  } else if (/(gửi ngay|chia sẻ|bạn bè|video này|bình luận)/i.test(spokenLower)) {
    liveIcon = "📲";
    liveAccent = "#22C55E";
  }

  const cleanWords = (rawSpokenSentence || "")
    .replace(/[.,!?;:"“”()—–-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const midStart = Math.max(0, Math.floor((cleanWords.length - 6) / 2));
  const sentenceFocusPhrase =
    cleanWords.length > 0
      ? cleanWords
          .slice(midStart, midStart + 6)
          .join(" ")
          .toUpperCase()
      : "";

  return (
    <g>
      {/* 0. AI-Generated Custom Vector Illustration showcased cleanly in the Upper-Center Stage (y = 560..890) — Steady position, zero text bobbing! */}
      {cleanCustomSvg && (
        <g
          transform={
            activeSetting === "custom_scene"
              ? `translate(540, 885) scale(1.06)`
              : `translate(540, ${FLOOR_Y - 10})`
          }
        >
          <g dangerouslySetInnerHTML={{__html: cleanCustomSvg}} />
          {renderAnimatedBoardSpotlight(cleanCustomSvg, sceneLineIdx, totalSceneLines, f, sentenceLocalFrame)}
        </g>
      )}
      {cleanCustomSvg &&
        renderLiveSentenceTakeawayCard(
          rawSpokenSentence,
          sentenceFocusPhrase,
          sceneLineIdx,
          totalSceneLines,
          f,
          sentenceLocalFrame,
          540,
          938,
          0.92
        )}

      {/* 1. Dynamic Motorbike / Delivery Scooter when sentence mentions xe máy / shipper / xe ôm */}
      {hasMotorbike && activeSetting !== "highway_ev" && activeSetting !== "race_track" && activeSetting !== "custom_scene" && (
        <g transform={`translate(540, ${FLOOR_Y - 8})`}>
          <ellipse cx={0} cy={8} rx={95} ry={10} fill="rgba(0,0,0,0.32)" />
          <circle cx={-56} cy={-22} r={26} fill="#1E293B" stroke="#111827" strokeWidth={4} />
          <circle cx={-56} cy={-22} r={14} fill="#CBD5E1" stroke="#111827" strokeWidth={2.5} />
          <circle cx={56} cy={-22} r={26} fill="#1E293B" stroke="#111827" strokeWidth={4} />
          <circle cx={56} cy={-22} r={14} fill="#CBD5E1" stroke="#111827" strokeWidth={2.5} />
          <path d="M -56 -22 L -15 -22 L 22 -68 L 56 -22" fill="none" stroke="#EF4444" strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
          <rect x={-52} y={-64} width={48} height={18} rx={6} fill="#111827" />
          <rect x={-78} y={-105} width={52} height={42} rx={6} fill="#FACC15" stroke="#111827" strokeWidth={3.5} />
          <text x={-52} y={-79} textAnchor="middle" fontSize={13} fontWeight={900} fill="#111827" fontFamily="Be Vietnam Pro, sans-serif">
            SHIP
          </text>
        </g>
      )}

      {/* 2. Dynamic Creator Ring-Light & Phone Tripod when sentence mentions TikTok / Follow / View / Video */}
      {hasCreatorSetup && activeSetting !== "custom_scene" && (
        <g transform={`translate(540, ${FLOOR_Y - 6})`}>
          <line x1={0} y1={-155} x2={-38} y2={4} stroke="#111827" strokeWidth={6} strokeLinecap="round" />
          <line x1={0} y1={-155} x2={38} y2={4} stroke="#111827" strokeWidth={6} strokeLinecap="round" />
          <line x1={0} y1={-215} x2={0} y2={4} stroke="#111827" strokeWidth={6} strokeLinecap="round" />
          <circle cx={0} cy={-245} r={42} fill="none" stroke="#FEF08A" strokeWidth={8} />
          <circle cx={0} cy={-245} r={42} fill="none" stroke="#111827" strokeWidth={2.5} />
          <rect x={-16} y={-268} width={32} height={48} rx={5} fill="#0F172A" stroke="#38BDF8" strokeWidth={3} />
          <rect x={-85} y={-328} width={170} height={34} rx={10} fill="#EF4444" stroke="#111827" strokeWidth={3} />
          <text x={0} y={-305} textAnchor="middle" fontSize={16} fontWeight={900} fill="#FFFFFF" fontFamily="Be Vietnam Pro, sans-serif">
            ● REC • TIKTOK
          </text>
        </g>
      )}

      {/* 3. Dynamic Ward Inspection Alert / Barrier Sign when sentence mentions đoàn kiểm tra / dọn hàng / báo hiệu */}
      {hasInspectionAlert && (
        <g transform={`translate(835, ${FLOOR_Y - 310})`}>
          <rect x={-110} y={-36} width={220} height={54} rx={12} fill={flash ? "#EF4444" : "#F97316"} stroke="#111827" strokeWidth={3.8} />
          <text x={0} y={-2} textAnchor="middle" fontSize={18} fontWeight={900} fill="#FFFFFF" fontFamily="Be Vietnam Pro, sans-serif">
            🚨 BÁO ĐỘNG DỌN HÀNG!
          </text>
        </g>
      )}

      {/* 4. Dynamic Price / Money Transfer Floating Badge when sentence mentions sang nhượng / tiền lẻ / giữ giá */}
      {hasMoneyExchange && !hasInspectionAlert && activeSetting !== "custom_scene" && (
        <g transform={`translate(540, ${FLOOR_Y - 335})`}>
          <rect x={-125} y={-32} width={250} height={50} rx={14} fill="#16A34A" stroke="#111827" strokeWidth={3.5} />
          <text x={0} y={0} textAnchor="middle" fontSize={18} fontWeight={900} fill="#FEF08A" fontFamily="Be Vietnam Pro, sans-serif">
            {/(tiền lẻ)/i.test(lower)
              ? "💵 ĐỔI TIỀN LẺ GIÚP NHAU"
              : /(sang nhượng|mua lại)/i.test(lower)
                ? "💰 PHÍ SANG NHƯỢNG CHỖ"
                : /(giữ giá|giá chung)/i.test(lower)
                  ? "🤝 GIỮ GIÁ CHUNG VỈA HÈ"
                  : "💵 GIAO DỊCH & CHI PHÍ"}
          </text>
        </g>
      )}

      {/* 5. Dynamic Fixed-Time Street Clock when sentence mentions mỗi sáng / đúng giờ / cố định */}
      {hasScheduleClock && !hasInspectionAlert && !hasMoneyExchange && activeSetting !== "custom_scene" && (
        <g transform={`translate(115, ${HORIZON_Y - 195})`}>
          <line x1={0} y1={0} x2={0} y2={195} stroke="#1E293B" strokeWidth={8} />
          <circle cx={0} cy={-28} r={38} fill="#FFFFFF" stroke="#111827" strokeWidth={4.5} />
          <line x1={0} y1={-28} x2={0} y2={-50} stroke="#111827" strokeWidth={4} strokeLinecap="round" />
          <line x1={0} y1={-28} x2={18} y2={-28} stroke="#EF4444" strokeWidth={4} strokeLinecap="round" />
          <rect x={-62} y={18} width={124} height={28} rx={6} fill="#FACC15" stroke="#111827" strokeWidth={2.5} />
          <text x={0} y={37} textAnchor="middle" fontSize={14} fontWeight={900} fill="#111827" fontFamily="Be Vietnam Pro, sans-serif">
            ĐÚNG GIỜ
          </text>
        </g>
      )}
    </g>
  );
};

const resolveSceneSetting = (act: StickmanSceneAct | undefined, sceneText: string): StickmanSetting => {
  const raw = act?.setting ?? "office_board";
  if (raw === "custom_scene" || (act?.customSvg && act.customSvg.trim().length > 12 && raw !== "street_vendor" && raw !== "sidewalk_tea" && raw !== "race_track")) {
    return "custom_scene";
  }
  if (
    raw === "street_vendor" ||
    raw === "sidewalk_tea" ||
    raw === "race_track" ||
    raw === "hospital_clinic" ||
    raw === "library_study" ||
    raw === "cafe_table" ||
    raw === "city_street" ||
    raw === "highway_ev" ||
    raw === "interview_room" ||
    raw === "fed_rate_room" ||
    raw === "gold_vault" ||
    raw === "mountain_chart" ||
    raw === "supermarket"
  ) {
    return raw;
  }
  const text = `${sceneText} ${act?.title ?? ""} ${act?.badge ?? ""} ${act?.charLeft ?? ""} ${act?.charRight ?? ""}`.toLowerCase();

  // 0. Racing / F1 / MotoGP / High-Speed Cars (only when not a hospital/accident/psychology scene)
  if (
    /(đua xe|đường đua|tay đua|f1|motogp|siêu xe|vạch đích|pit stop|khúc cua)/i.test(text) &&
    !/(bệnh viện|cấp cứu|nạn nhân|tông vào|vô tội|nhà tù|tâm lý|hormone)/i.test(text)
  ) {
    return "race_track";
  }

  // 1. Street Vendor / Sidewalk Hawker Cart / Food Stall ("hàng rong", "bán xôi", "hàng nước", "vỉa hè", "xe đẩy")
  const isStreetVendorTopic =
    /(hàng rong|gánh hàng|xe đẩy|bán xôi|cô bán xôi|hàng xôi|hàng nước|chú hàng nước|vỉa hè|quán cóc|trà đá|nước mía|bánh mì|giữ chỗ|sang nhượng|đoàn kiểm tra)/i.test(
      text
    );
  if (isStreetVendorTopic) {
    if (/(hàng xôi đứng cạnh hàng nước|không bán trùng|sát bên cạnh|xôi cạnh nước|hai hàng|cả hai cùng có khách)/i.test(text)) {
      return "sidewalk_tea";
    }
    return "street_vendor";
  }

  // Never allow nature/beach settings unless the scene is literally about travel/camping/beach
  const isTravelScene = /(du lịch|vũng tàu|biển|cắm trại|dã ngoại|bãi biển|khách sạn|hải sản|cao tốc|trạm sạc|thu phí)/i.test(text);
  if (!isTravelScene && (raw === "park_dawn" || raw === "beach_sunset")) {
    return "office_board";
  }

  // If the scene cites historical studies, experts, rules (1994 William Bengen, psychologists, textbooks, theory)
  // and isn't a supermarket shopping scene, render the Library / Research Study Room ("library_study")!
  const isShoppingScene = /(sắm đồ|mua sắm|siêu thị|tăng lương là lại tăng chi tiêu|giỏ hàng)/i.test(text);
  const isScholarlyOrBookScene =
    /(william bengen|năm 19\d\d|nhà tâm lý|nghiên cứu|tài liệu|đọc sách|sách vở|giáo trình|lý thuyết|quy tắc chỉ rút|công thức 25 lần)/i.test(
      text
    );

  if (isShoppingScene && raw !== "cafe_table") {
    return "supermarket";
  }
  if (isScholarlyOrBookScene && (raw === "office_board" || raw === "coding_desk" || raw === "park_dawn")) {
    return "library_study";
  }

  return raw;
};

export const StickmanStage: React.FC<{
  acts: StickmanSceneAct[];
  timings: SceneTiming[];
  voice: Voice;
  duration: number;
  /** AI-drawn backdrops per beat (backdrops.json); empty → preset settings only. */
  backdrops?: AiBackdropItem[];
  /** Storytelling look (spirit): no chapter card, stat pills or centre SVG panel — only the scene, the cast and captions. */
  minimalUi?: boolean;
}> = ({acts, timings, voice, duration, backdrops, minimalUi = false}) => {
  const hasAiBg = Boolean(backdrops?.some((b) => b.src));
  const f = useCurrentFrame();
  const sec = f / FPS;

  // Determine active scene and smooth crossfade weights between scenes (30 frames = 1.0s fade)
  let activeSceneIdx = 0;
  for (let i = 0; i < timings.length; i++) {
    if (f >= timings[i].from) activeSceneIdx = i;
  }
  const activeTiming = timings[activeSceneIdx] ?? timings[0];
  const sceneLocalP = Math.max(0, Math.min(1, (f - (activeTiming?.from ?? 0)) / Math.max(1, activeTiming?.duration ?? 90)));
  const activeAct = acts[activeSceneIdx] ?? acts[0];

  // Find which sentence inside the current scene is being spoken right now.
  // Reaction Lead (from claude-animated-shorts motion.md): expressions & actions land 2 frames (2 / FPS) BEFORE the word onset!
  const leadSec = sec + 2 / FPS;
  const sceneLines = voice.lines.filter((l) => l.scene === activeTiming?.id);
  let sceneLineIdx = sceneLines.findIndex((l) => leadSec >= l.start - 0.04 && leadSec <= l.end + 0.3);
  if (sceneLineIdx < 0) {
    for (let i = sceneLines.length - 1; i >= 0; i--) {
      if (leadSec >= sceneLines[i].start) {
        sceneLineIdx = i;
        break;
      }
    }
    if (sceneLineIdx < 0) sceneLineIdx = 0;
  }

  let globalLineIdx = voice.lines.findIndex((l) => leadSec >= l.start - 0.04 && leadSec <= l.end + 0.3);
  if (globalLineIdx < 0) {
    for (let i = voice.lines.length - 1; i >= 0; i--) {
      if (leadSec >= voice.lines[i].start) {
        globalLineIdx = i;
        break;
      }
    }
    if (globalLineIdx < 0) globalLineIdx = 0;
  }

  // Frame timestamps where sentence/expression swaps happen (triggers a 4-frame blink across swaps in Stickman.tsx)
  const swapFrames = voice.lines.map((l) => Math.max(0, Math.round(l.start * FPS) - 2));

  const customLine = activeAct?.dialogues?.[sceneLineIdx];
  const currentSpokenLine = sceneLines[sceneLineIdx] ?? voice.lines[globalLineIdx];
  const isBlindTruncatedCustom =
    Boolean(customLine && customLine.trim().endsWith("...") && currentSpokenLine?.text) &&
    (currentSpokenLine?.text || "")
      .replace(/[.,!?;:"“”()—–-]/g, " ")
      .toLowerCase()
      .startsWith(
        (customLine || "")
          .replace(/\.\.\.$/, "")
          .trim()
          .toLowerCase()
          .slice(0, 12),
      );
  const rawActiveDialogue =
    customLine && customLine.trim().length > 0 && !isBlindTruncatedCustom
      ? customLine.trim()
      : currentSpokenLine
        ? readableBubbleFromLine(currentSpokenLine.text)
        : "Cùng xem chi tiết nhé!";

  const {isLeft: teoTurn, cleanDialogue: activeDialogue} = resolveSpeakerIsLeft(
    activeAct,
    sceneLineIdx,
    rawActiveDialogue,
    currentSpokenLine?.text ?? ""
  );

  // Only animate mouth lip-sync when a voice line is actively being spoken right now!
  // Never keep flapping mouth during inter-sentence pauses or after the narration has finished (outroHold).
  const lastLineEnd = voice.lines.length > 0 ? voice.lines[voice.lines.length - 1].end : 0;
  const isVoiceSpeakingNow = voice.lines.some((l) => sec >= l.start && sec <= l.end - 0.04);
  const isAfterAllSpeech = lastLineEnd > 0 && sec > lastLineEnd + 0.08;

  // Smooth 6-frame fade-in / fade-out on speech bubbles so bubbles never hard-flash on/off!
  const lineStartFrameForBubble = currentSpokenLine ? Math.max(0, Math.round(currentSpokenLine.start * FPS) - 2) : 0;
  const lineEndFrameForBubble = currentSpokenLine ? Math.round((currentSpokenLine.end + 0.24) * FPS) : duration;
  const bubbleFadeOpacity = isAfterAllSpeech
    ? 0
    : Math.min(
        Math.max(0, Math.min(1, (f - lineStartFrameForBubble) / 6)),
        Math.max(0, Math.min(1, (lineEndFrameForBubble - f) / 6)),
      );

  const bubble1 = !isAfterAllSpeech && teoTurn ? activeDialogue : undefined;
  const bubble2 = !isAfterAllSpeech && !teoTurn ? activeDialogue : undefined;

  // Sub-beat acting progression per sentence (so characters act out a mini comic strip within each scene!)
  const subBeat = sceneLineIdx % 4;
  const spokenLower = (currentSpokenLine?.text ?? "").toLowerCase();
  const isConflictLine =
    /[?!]/.test(currentSpokenLine?.text ?? "") ||
    /(sao|nhưng|chết|trảm|tội|sốc|hoảng|lo|sợ|thất nghiệp|khó|bất ngờ|giật mình)/.test(spokenLower);
  const isCleverLine = /(mưu|kế|nghĩ|ý tưởng|thông minh|hóa ra|bí quyết|cách|mẹo|trạng)/.test(spokenLower);

  // Ground contact stays anchored so planted feet NEVER slide/moonwalk across the floor!
  // (Upper-body breathing & natural torso lean are already animated inside Stickman.tsx)
  const gentleSway = 0;
  const stepIn = 0;
  let leftX = 250;
  let rightX = 830;
  let leftY = FLOOR_Y;
  let rightY = FLOOR_Y;
  let leftPose: StickPose = teoTurn ? "explain" : "think";
  let rightPose: StickPose = !teoTurn ? "explain" : "think";
  let leftMood: StickMood = "happy";
  let rightMood: StickMood = "happy";
  let leftProp: StickProp = "none";
  let rightProp: StickProp = "none";

  const activeSceneText = sceneLines.map((l) => l.text).join(" ");
  const activeSetting = resolveSceneSetting(activeAct, activeSceneText);
  const activeAction = activeAct?.action ?? "present_board";
  const isSolo = activeAct?.mode === "solo" || activeAct?.charRight === "";

  // Sentence-level semantic cues so character poses & props dynamically improvise ("chế cháo") to match what is being spoken right now!
  const sentenceContext = `${currentSpokenLine?.text ?? ""} ${activeDialogue} ${activeAct?.title ?? ""}`.toLowerCase();
  const isLiteralMountaineering = /(leo núi|trèo đèo|leo dốc|vượt đèo|trekking|chinh phục đỉnh núi)/i.test(sentenceContext);
  const isThinkingSentence = /(nghĩ|tưởng|tự hỏi|thắc mắc|liệu|vì sao|tại sao|bí quyết|mưu|kế|câu hỏi)/i.test(sentenceContext);
  const isPositiveConclusion = /(đủ|100%|chính thức|bản lĩnh|tốt|chuẩn|thành công|chia sẻ|gửi ngay|rẻ vậy|tha tội|trụ vững|hành trang|tự do)/i.test(sentenceContext);
  const isReadingDocSentence = /(đọc sách|cuốn sách|trang sách|sách giáo khoa|giáo trình|mở sách)/i.test(sentenceContext);
  const isSearchingComputerSentence = /(máy tính|gõ code|viết code|lập trình|bàn phím|laptop)/i.test(sentenceContext);
  const isWritingNoteSentence = /(ghi chép|viết sổ|ký hợp đồng|ký tên|làm bài kiểm tra|làm bài thi)/i.test(sentenceContext);
  const isInspectingDetailSentence = /(kính lúp|soi kỹ|thanh tra|kiểm định|rà từng dòng)/i.test(sentenceContext);
  const isCheckingPhoneSentence = /(điện thoại|lướt mạng|tin nhắn|nhắn tin|màn hình điện thoại)/i.test(sentenceContext);

  // 1. Context-Driven Character Layout & Sentence-Level Acting
  if (isSolo) {
    // SOLO FOCUS COMPOSITION (1 main character like Reference Images 1, 2, 3)
    if (activeSetting === "coding_desk" || activeSetting === "remote_workspace") {
      leftX = 345;
      leftY = FLOOR_Y;
      leftPose = subBeat % 2 === 0 || isThinkingSentence ? "think" : "sit_type";
      leftMood = isConflictLine ? "shock" : "scheming";
      leftProp = leftPose === "think" ? "bulb" : "none";
    } else if (activeSetting === "debugging_board" || activeSetting === "office_board") {
      leftX = 335;
      leftY = FLOOR_Y;
      leftPose = isPositiveConclusion ? "present_check" : isConflictLine ? "tired" : "analyze";
      leftMood = isConflictLine ? "shock" : "serious";
      leftProp = "pointer";
    } else {
      // Centered Solo Takeaway
      leftX = 510;
      leftY = FLOOR_Y;
      leftPose = "explain";
      leftMood = "happy";
      leftProp = "none";
    }
  } else if (activeSetting === "race_track") {
    // High-speed F1 / Supercar Racing Circuit:
    // Characters stand on the pit-lane / roadside (never floating in mid-air holding a detached steering wheel!) while F1 cars race in center!
    leftX = 215;
    leftY = FLOOR_Y;
    leftPose = teoTurn ? (isConflictLine ? "tired" : "explain") : "point";
    leftMood = isConflictLine ? "shock" : "cool";
    leftProp = "none";
    rightX = 835;
    rightY = FLOOR_Y;
    rightPose = !teoTurn ? (isConflictLine ? "shrug" : "point") : "wave";
    rightMood = isConflictLine ? "shock" : "happy";
    rightProp = "none";
  } else if (activeAction === "driving_car" || (activeSetting === "highway_ev" && activeAction === "inspect_car")) {
    // Roadside / Vehicle scene: Characters stand naturally on the ground beside the vehicle (never floating in air with a detached wheel!)
    leftX = 225;
    leftY = FLOOR_Y;
    leftPose = teoTurn ? (isConflictLine ? "tired" : "explain") : "think";
    leftMood = isConflictLine ? "shock" : "happy";
    leftProp = "none";
    rightX = 835;
    rightY = FLOOR_Y;
    rightPose = !teoTurn ? "explain" : "point";
    rightMood = "happy";
    rightProp = "none";
  } else if (activeSetting === "street_vendor") {
    // Vietnamese Street Vendor Pushcart ("Xe Đẩy Hàng Rong"):
    // Left = Seller standing right beside the pushcart handle serving hot food;
    // Right = Buyer / Interlocutor in front of the glass food cabinet;
    // Third = Waiting Customer or Ward Inspection Officer on the right sidewalk!
    leftX = 215;
    rightX = 685;
    leftY = FLOOR_Y;
    rightY = FLOOR_Y;
    leftPose = teoTurn ? (isConflictLine ? "tired" : "explain") : "point";
    rightPose = !teoTurn ? (isConflictLine ? "shrug" : "explain") : "think";
    leftMood = isConflictLine ? "shock" : isCleverLine ? "scheming" : "happy";
    rightMood = isConflictLine ? "shock" : "happy";
    leftProp = teoTurn ? "bowl" : "pointer";
    rightProp = !teoTurn ? "money" : "bowl";
  } else if (activeSetting === "sidewalk_tea") {
    // Neighboring Sidewalk Stalls ("Hàng Xôi Cạnh Hàng Nước"):
    // Left = Xôi Seller by Cart 1, Right = Iced Tea Seller by Cart 2, Third = Customer buying from both!
    leftX = 215 + gentleSway * 0.35;
    rightX = 575 - gentleSway * 0.35;
    leftY = FLOOR_Y;
    rightY = FLOOR_Y;
    leftPose = teoTurn ? "explain" : "wave";
    rightPose = !teoTurn ? "explain" : "point";
    leftMood = "happy";
    rightMood = isCleverLine ? "scheming" : "happy";
    leftProp = "bowl";
    rightProp = "money";
  } else if (activeSetting === "peach_banquet" || activeSetting === "seafood_diner") {
    // Banquet / Seafood dining table: Only the active character tastes food ("peach" / "bowl"), the other sits conversing/reacting!
    leftX = 325 + gentleSway * 0.3;
    rightX = 755 - gentleSway * 0.3;
    leftY = FLOOR_Y;
    rightY = FLOOR_Y;
    const foodProp: StickProp = activeSetting === "peach_banquet" ? "peach" : "bowl";
    leftPose = teoTurn ? "sit_eat" : "sit";
    rightPose = !teoTurn && subBeat === 0 ? "sit_eat" : "sit";
    leftMood = isCleverLine ? "scheming" : "happy";
    rightMood = isConflictLine ? "shock" : "happy";
    leftProp = leftPose === "sit_eat" ? foodProp : "none";
    rightProp = rightPose === "sit_eat" ? foodProp : "none";
  } else if (activeSetting === "cafe_table" || activeAction === "eating_drinking" || activeAction === "chat_table") {
    // Seated around the cafe/bistro table conversing (cups already rest on the table — NEVER wave cups up and down!)
    leftX = 325 + gentleSway * 0.3;
    rightX = 755 - gentleSway * 0.3;
    leftY = FLOOR_Y;
    rightY = FLOOR_Y;
    leftPose = "sit";
    rightPose = "sit";
    leftMood = isConflictLine && teoTurn ? "shock" : isCleverLine ? "scheming" : "happy";
    rightMood = isConflictLine && teoTurn ? "shock" : "happy";
    leftProp = teoTurn ? (isConflictLine ? "phone" : "money") : "none";
    rightProp = "none";
  } else if (isLiteralMountaineering && activeAction === "climbing_peak") {
    // Only climb when the story is literally about mountaineering/hiking!
    leftX = lerp(195, 435, sceneLocalP);
    leftY = lerp(FLOOR_Y, FLOOR_Y - 195, sceneLocalP);
    leftPose = "climb";
    leftMood = isConflictLine ? "shock" : "serious";
    leftProp = "none";
    rightX = 825 + stepIn * 0.5;
    rightY = FLOOR_Y;
    rightPose = !teoTurn ? "point" : "wave";
    rightMood = "happy";
    rightProp = "pointer";
  } else if (
    activeAction === "typing_desk" ||
    activeSetting === "coding_desk" ||
    activeSetting === "remote_workspace"
  ) {
    // Seated at computer desk typing / thinking while colleague reviews
    leftX = 330;
    leftY = FLOOR_Y;
    leftPose = isThinkingSentence && subBeat === 0 ? "think" : "sit_type";
    leftMood = isConflictLine ? "shock" : "serious";
    leftProp = "none";
    rightX = 795 + stepIn * 0.5;
    rightY = FLOOR_Y;
    rightPose = !teoTurn ? "analyze" : "think";
    rightMood = isCleverLine ? "scheming" : "idea";
    rightProp = "magnifier";
  } else if (
    activeAction === "carrying_load" ||
    activeSetting === "gold_vault" ||
    (activeSetting === "bank_finance" && activeAction === "compare_two")
  ) {
    // Gold vault / Central Bank reserve: Left holds gold bar or explains, Right analyzes with magnifier/chart
    leftX = 255;
    leftY = FLOOR_Y;
    leftPose = subBeat === 0 ? "carry" : teoTurn ? "explain" : "think";
    leftMood = isConflictLine ? "shock" : "serious";
    leftProp = "gold";
    rightX = 815;
    rightY = FLOOR_Y;
    rightPose = !teoTurn ? "analyze" : "think";
    rightMood = isCleverLine ? "scheming" : "idea";
    rightProp = "magnifier";
  } else if (
    activeSetting === "mountain_chart" ||
    activeAction === "analyzing_board" ||
    activeSetting === "debugging_board" ||
    activeSetting === "office_board" ||
    activeSetting === "fed_rate_room" ||
    activeSetting === "interview_room"
  ) {
    // Standing naturally on the floor analyzing the trading screen / flipchart / FED console / interview board
    leftX = 245;
    rightX = 835;
    leftPose = teoTurn
      ? isConflictLine
        ? "tired"
        : isThinkingSentence
          ? "think"
          : "point"
      : "think";
    rightPose = !teoTurn
      ? subBeat % 2 === 0
        ? "analyze"
        : "explain"
      : "think";
    leftMood = isConflictLine ? "shock" : isCleverLine ? "scheming" : "serious";
    rightMood = isPositiveConclusion ? "happy" : isConflictLine ? "serious" : "idea";
    leftProp = isConflictLine ? "phone" : "pointer";
    rightProp = "magnifier";
  } else if (activeAction === "panic_run") {
    // Panicked investor / accident scene / court defendant vs interlocutor
    leftX = 255;
    rightX = 825;
    leftPose = teoTurn ? "tired" : "shrug";
    rightPose = !teoTurn ? "explain" : "point";
    leftMood = "shock";
    rightMood = isConflictLine ? "shock" : "serious";
    leftProp = "none";
    rightProp = "none";
  } else {
    switch (activeAction) {
      case "inspect_car":
        leftX = 235;
        rightX = 845;
        leftPose = teoTurn ? "point" : "think";
        rightPose = !teoTurn ? "explain" : subBeat === 1 ? "shrug" : "think";
        leftMood = isCleverLine ? "scheming" : "cool";
        rightMood = isConflictLine ? "shock" : "happy";
        leftProp = "none";
        rightProp = "phone";
        break;
      case "chat_table":
        leftX = 315;
        rightX = 765;
        leftPose = "sit_eat";
        rightPose = !teoTurn ? "explain" : "sit_eat";
        leftMood = subBeat === 0 || isCleverLine ? "scheming" : "happy";
        rightMood = isConflictLine ? "shock" : "idea";
        leftProp = "coffee";
        rightProp = "coffee";
        break;
      case "charge_ev":
        leftX = 255;
        rightX = 825;
        leftPose = teoTurn ? "point" : "think";
        rightPose = !teoTurn ? "explain" : "wave";
        leftMood = "idea";
        rightMood = "happy";
        leftProp = "bulb";
        rightProp = "phone";
        break;
      case "pass_toll":
        leftX = 255;
        rightX = 825;
        leftPose = teoTurn ? "explain" : "think";
        rightPose = !teoTurn ? "point" : "wave";
        leftMood = isCleverLine ? "scheming" : "happy";
        rightMood = isConflictLine ? "shock" : "cool";
        leftProp = "money";
        rightProp = "none";
        break;
      case "check_bill":
        leftX = 255 + stepIn + gentleSway;
        rightX = 825 + stepIn - gentleSway;
        leftPose = teoTurn ? "analyze" : "think";
        rightPose = !teoTurn ? "point" : "shrug";
        leftMood = isCleverLine ? "scheming" : "shock";
        rightMood = isConflictLine ? "shock" : "serious";
        leftProp = "magnifier";
        rightProp = "none";
        break;
      case "present_board":
        leftX = 255 + stepIn + gentleSway;
        rightX = 825 + stepIn - gentleSway;
        leftPose = teoTurn ? (subBeat >= 1 ? "explain" : "analyze") : "think";
        rightPose = !teoTurn ? "explain" : subBeat === 1 ? "shrug" : "analyze";
        leftMood = isCleverLine ? "scheming" : "idea";
        rightMood = isConflictLine ? "shock" : "serious";
        leftProp = "pointer";
        rightProp = "none";
        break;
      case "compare_two":
        leftX = 255 + stepIn + gentleSway;
        rightX = 825 + stepIn - gentleSway;
        leftPose = teoTurn ? "explain" : "think";
        rightPose = !teoTurn ? (subBeat === 1 ? "point" : "explain") : "shrug";
        leftMood = isCleverLine ? "scheming" : "idea";
        rightMood = isConflictLine ? "shock" : "happy";
        leftProp = "money";
        rightProp = "none";
        break;
      case "relax_celebrate":
      default:
        leftX = 265 + stepIn + gentleSway;
        rightX = 815 + stepIn - gentleSway;
        leftPose = teoTurn ? "explain" : "wave";
        rightPose = !teoTurn ? "explain" : "cheer";
        leftMood = "celebrate";
        rightMood = "celebrate";
        leftProp = "none";
        rightProp = "none";
        break;
    }
  }

  // 2. Sentence-Level Context Improvisation ("Chế cháo theo từng câu thoại"):
  // Unless characters are physically driving a car or seated at a cafe/banquet table,
  // dynamically adapt the active character's action & prop to the exact sentence being spoken!
  const isLockedPhysicalScene =
    activeAction === "driving_car" ||
    activeSetting === "race_track" ||
    activeSetting === "street_vendor" ||
    activeSetting === "sidewalk_tea" ||
    activeSetting === "cafe_table" ||
    activeSetting === "seafood_diner" ||
    activeSetting === "peach_banquet" ||
    (isLiteralMountaineering && activeAction === "climbing_peak");

  const isSoccerContext =
    /(đá bóng|bóng đá|sút bóng|cầu thủ|sân cỏ|thủ môn|ghi bàn|world cup|ngoại hạng|dẫn bóng|trận đấu bóng)/i.test(
      sentenceContext
    );
  const isCookingContext =
    /(nấu ăn|đầu bếp|xào|chiên|chảo|nhà bếp|công thức nấu|nêm nếm)/i.test(sentenceContext);
  const isGymContext =
    /(tập gym|tập tạ|thể hình|nâng tạ|phòng tập|fitness|workout)/i.test(sentenceContext);
  const isMartialContext =
    /(võ thuật|võ sư|thiếu lâm|kungfu|wushu|karate|vovinam)/i.test(sentenceContext);

  const isLeftChef =
    activeAct?.leftOutfit === "chef_coat" ||
    activeAct?.leftHat === "chef_hat" ||
    /(đầu bếp|bếp trưởng)/i.test(activeAct?.charLeft ?? "");
  const isRightChef =
    activeAct?.rightOutfit === "chef_coat" ||
    activeAct?.rightHat === "chef_hat" ||
    /(đầu bếp|bếp trưởng)/i.test(activeAct?.charRight ?? "");

  if (activeSetting === "street_vendor" || activeSetting === "sidewalk_tea") {
    // Street-vendor specific sentence improvisation (money exchange, ward inspection alert, serving hot food)
    if (/(đoàn kiểm tra|trật tự|phường|bị dẹp|dọn hàng|nháy mắt|báo động)/i.test(sentenceContext)) {
      leftPose = teoTurn ? "point" : "tired";
      rightPose = !teoTurn ? "shrug" : "point";
      leftMood = "shock";
      rightMood = "shock";
      leftProp = "none";
      rightProp = "checklist";
    } else if (/(tiền lẻ|trả tiền|mua chỗ|nhường chỗ|sang nhượng|đặt cọc|doanh thu|lãi|vốn)/i.test(sentenceContext)) {
      leftPose = teoTurn ? "explain" : "point";
      rightPose = !teoTurn ? "explain" : "think";
      leftProp = "money";
      rightProp = "bowl";
    }
  } else if (isSoccerContext) {
    // Roleplay as real soccer players kicking/dribbling a ball on the pitch
    leftPose = teoTurn ? (subBeat % 2 === 0 ? "kick_ball" : "dribble_ball") : "dribble_ball";
    leftProp = teoTurn ? "soccer_ball" : "none";
    leftMood = isPositiveConclusion ? "celebrate" : isConflictLine ? "shock" : "cool";
    rightPose = !teoTurn ? (subBeat % 2 === 0 ? "kick_ball" : "dribble_ball") : isPositiveConclusion ? "cheer" : "reach";
    rightProp = !teoTurn ? "soccer_ball" : isPositiveConclusion ? "trophy" : "none";
    rightMood = isPositiveConclusion ? "celebrate" : isConflictLine ? "shock" : "happy";
  } else if (isCookingContext && (isLeftChef || isRightChef)) {
    // Only the character who is actually the Chef tosses the frying pan; the other character converses naturally!
    leftPose = isLeftChef && teoTurn ? "cook_toss" : teoTurn ? "explain" : "think";
    leftProp = isLeftChef ? "frying_pan" : "none";
    leftMood = "happy";
    rightPose = isRightChef && !teoTurn ? "cook_toss" : !teoTurn ? "explain" : "think";
    rightProp = isRightChef ? "frying_pan" : "none";
    rightMood = isConflictLine ? "shock" : "idea";
  } else if (isGymContext) {
    // Roleplay as fitness athletes lifting dumbbells
    leftPose = teoTurn ? "lift_weight" : "reach";
    leftProp = teoTurn ? "dumbbell" : "none";
    leftMood = isConflictLine ? "tired" : "cool";
    rightPose = !teoTurn ? "lift_weight" : "explain";
    rightProp = !teoTurn ? "dumbbell" : "none";
    rightMood = "happy";
  } else if (!isLockedPhysicalScene) {
    if (isSolo) {
      if (isReadingDocSentence) {
        leftPose = "read_book";
        leftProp = "book";
        leftMood = "serious";
      } else if (isWritingNoteSentence) {
        leftPose = "write_note";
        leftProp = "notebook";
        leftMood = "idea";
      } else if (isSearchingComputerSentence) {
        leftPose = "sit_type";
        leftProp = "none";
        leftMood = isConflictLine ? "shock" : "serious";
      } else if (isCheckingPhoneSentence) {
        leftPose = "check_phone";
        leftProp = "phone";
        leftMood = isConflictLine ? "shock" : "serious";
      } else if (isInspectingDetailSentence) {
        leftPose = "analyze";
        leftProp = "magnifier";
        leftMood = isConflictLine ? "shock" : "scheming";
      } else {
        leftPose = isPositiveConclusion ? "cheer" : isCleverLine ? "laugh_belly" : subBeat % 2 === 0 ? "explain" : "reach";
        leftProp = "none";
        leftMood = isPositiveConclusion ? "celebrate" : isConflictLine ? "shock" : "happy";
      }
    } else {
      // Duo mode: Speaker performs the primary contextual action, Listener reacts naturally WITHOUT random notebooks/pointers/phones!
      if (isReadingDocSentence && isWritingNoteSentence) {
        if (teoTurn) {
          leftPose = "write_note";
          leftProp = "notebook";
          leftMood = "idea";
          rightPose = "read_book";
          rightProp = "book";
          rightMood = "serious";
        } else {
          rightPose = "read_book";
          rightProp = "book";
          rightMood = "serious";
          leftPose = "think";
          leftProp = "none";
          leftMood = "idea";
        }
      } else if (isReadingDocSentence) {
        if (teoTurn) {
          leftPose = "read_book";
          leftProp = "book";
          leftMood = "serious";
          rightPose = "think";
          rightProp = "none";
        } else {
          rightPose = "read_book";
          rightProp = "book";
          rightMood = "serious";
          leftPose = "think";
          leftProp = "none";
        }
      } else if (isSearchingComputerSentence) {
        if (teoTurn) {
          leftPose = "sit_type";
          leftProp = "none";
          leftMood = isConflictLine ? "shock" : "serious";
          rightPose = "analyze";
          rightProp = "none";
        } else {
          leftPose = "sit_type";
          leftProp = "none";
          rightPose = "explain";
          rightProp = "none";
          rightMood = "idea";
        }
      } else if (isWritingNoteSentence) {
        if (teoTurn) {
          leftPose = "write_note";
          leftProp = "notebook";
          leftMood = "idea";
          rightPose = "explain";
          rightProp = "none";
        } else {
          rightPose = "write_note";
          rightProp = "notebook";
          rightMood = "idea";
          leftPose = "explain";
          leftProp = "none";
        }
      } else if (isCheckingPhoneSentence) {
        if (teoTurn) {
          leftPose = "check_phone";
          leftProp = "phone";
          leftMood = isConflictLine ? "shock" : "serious";
        } else {
          rightPose = "check_phone";
          rightProp = "phone";
          rightMood = isConflictLine ? "shock" : "serious";
        }
      } else if (isInspectingDetailSentence) {
        if (teoTurn) {
          leftPose = "crouch_inspect";
          leftProp = "magnifier";
          leftMood = isConflictLine ? "shock" : "scheming";
          rightPose = "think";
          rightProp = "none";
        } else {
          rightPose = "crouch_inspect";
          rightProp = "magnifier";
          rightMood = isConflictLine ? "shock" : "scheming";
          leftPose = "think";
          leftProp = "none";
        }
      } else if (/(bẩm|tâu|cúi đầu|lạy|kính thưa|dâng lên)/i.test(sentenceContext)) {
        if (teoTurn) {
          leftPose = "bow_respect";
          leftProp = "none";
          leftMood = isCleverLine ? "scheming" : "serious";
          rightPose = "stand";
          rightProp = "none";
        } else {
          rightPose = "bow_respect";
          rightProp = "none";
          rightMood = "serious";
          leftPose = "stand";
          leftProp = "none";
        }
      } else if (/(bật cười|cười phá|cười ha hả|cười lớn|khoái chí)/i.test(sentenceContext)) {
        if (teoTurn) {
          leftPose = "laugh_belly";
          leftProp = "none";
          leftMood = "celebrate";
          rightPose = "shrug";
          rightProp = "none";
        } else {
          rightPose = "laugh_belly";
          rightProp = "none";
          rightMood = "celebrate";
          leftPose = "explain";
          leftProp = "none";
        }
      } else if (/(chật vật|thiếu|nợ|bẫy|mệt|kiệt sức|tiêu sạch|rỗng|áp lực|lo lắng|khó nhất|gánh nặng|hốt hoảng|sợ hãi)/i.test(sentenceContext)) {
        if (teoTurn) {
          leftPose = subBeat % 2 === 0 ? "slump" : "step_back";
          leftMood = "shock";
          leftProp = "none";
          rightPose = subBeat % 2 === 0 ? "reach" : "point";
          rightMood = "serious";
          rightProp = "none";
        } else {
          leftPose = subBeat % 2 === 0 ? "slump" : "think";
          leftMood = "sad";
          leftProp = "none";
          rightPose = subBeat % 2 === 0 ? "reach" : "explain";
          rightMood = "idea";
          rightProp = "none";
        }
      } else {
        // Dynamic 4-beat storytelling progression per sentence so characters constantly change posture naturally
        const speakerPoses: StickPose[] = ["explain", "reach", "point", "present_check"];
        const listenerPoses: StickPose[] = ["think", "shrug", "stand", "analyze"];
        if (teoTurn) {
          leftPose = isPositiveConclusion ? "cheer" : speakerPoses[subBeat % speakerPoses.length];
          leftMood = isPositiveConclusion ? "celebrate" : isConflictLine ? "shock" : isCleverLine ? "scheming" : "idea";
          leftProp = "none";
          rightPose = isConflictLine ? "step_back" : listenerPoses[subBeat % listenerPoses.length];
          rightProp = "none";
          rightMood = isConflictLine ? "shock" : "serious";
        } else {
          rightPose = isPositiveConclusion ? "cheer" : speakerPoses[subBeat % speakerPoses.length];
          rightMood = isPositiveConclusion ? "celebrate" : isConflictLine ? "shock" : isCleverLine ? "scheming" : "idea";
          rightProp = "none";
          leftPose = isConflictLine ? "step_back" : listenerPoses[subBeat % listenerPoses.length];
          leftProp = "none";
          leftMood = isConflictLine ? "shock" : "happy";
        }
      }
    }
  }

  // 3. Furniture-Safe Pose & Position Alignment:
  const isDeskSetting =
    activeSetting === "coding_desk" ||
    activeSetting === "remote_workspace" ||
    activeSetting === "library_study" ||
    activeSetting === "interview_room";

  if (leftPose === "sit_type") {
    if (isDeskSetting) {
      leftX = 330;
    } else {
      leftPose = "explain";
      leftProp = "none";
    }
  }
  if (rightPose === "sit_type") {
    if (isDeskSetting) {
      rightX = 750;
    } else {
      rightPose = "think";
      rightProp = "none";
    }
  }

  // 4. Dynamic Script-Driven Character Names & Archetype Resolver:
  // If charLeft/charRight are generic ("Tèo"/"Tí") or empty, or if a sentence introduces a specific role, dynamically adapt!
  const rawLeftName = activeAct?.charLeft && activeAct.charLeft !== "Tèo" ? activeAct.charLeft : "";
  const rawRightName = activeAct?.charRight && activeAct.charRight !== "Tí" ? activeAct.charRight : "";
  const finalCharLeft =
    rawLeftName ||
    (activeSetting === "street_vendor" || activeSetting === "sidewalk_tea"
      ? "Cô Bán Hàng"
      : /(follow|tiktok|kênh)/i.test(sentenceContext)
        ? "Chủ Kênh"
        : /(đầu tư|tài chính|tiết kiệm|lương)/i.test(sentenceContext)
          ? "Người Trẻ"
          : "Nhân Vật A");
  const finalCharRight =
    (/(người mới)/i.test(spokenLower) && (activeSetting === "street_vendor" || activeSetting === "sidewalk_tea")
      ? "Người Mới Đến"
      : /(sang nhượng|mua lại)/i.test(spokenLower) && (activeSetting === "street_vendor" || activeSetting === "sidewalk_tea")
        ? "Người Mua Chỗ"
        : /(hàng nước)/i.test(spokenLower)
          ? "Chú Hàng Nước"
          : "") ||
    rawRightName ||
    (activeSetting === "sidewalk_tea"
      ? "Chú Hàng Nước"
      : activeSetting === "street_vendor"
        ? "Khách Mua Hàng"
        : /(follow|tiktok|kênh|thuật toán)/i.test(sentenceContext)
          ? "Thuật Toán AI"
          : /(đầu tư|tài chính|tiết kiệm|lương)/i.test(sentenceContext)
            ? "Chuyên Gia"
            : "Nhân Vật B");
  const leftNameLower = finalCharLeft.toLowerCase();
  const rightNameLower = finalCharRight.toLowerCase();

  const scammerRegex =
    /(lùa gà|úp bô|đa cấp|cam kết lãi|làm giàu không khó|khóa học làm giàu)/i;
  const tycoonRegex =
    /(đại gia|nhà giàu|giàu sụ|giàu xổi|tỷ phú|triệu phú|trăm tỷ|chủ tịch tập đoàn|ông trùm|khoe của)/i;
  const expertRegex = /(chuyên gia|cố vấn|giám đốc|quản lý|nhà tâm lý|william bengen|hr|tuyển dụng|nhãn hàng|đạo diễn)/i;

  const isScammerSentence = scammerRegex.test(sentenceContext);
  const isTycoonFlexSentence = tycoonRegex.test(sentenceContext);
  const isLeftTycoonOrScammer =
    scammerRegex.test(leftNameLower) ||
    tycoonRegex.test(leftNameLower) ||
    (teoTurn && (isScammerSentence || isTycoonFlexSentence));
  const isRightTycoonOrScammer =
    scammerRegex.test(rightNameLower) ||
    tycoonRegex.test(rightNameLower) ||
    (!teoTurn && (isScammerSentence || isTycoonFlexSentence) && !expertRegex.test(rightNameLower));

  // Determine Left Character Accessory (strip gold_chain/scammer_bling if not actually a tycoon/scammer context)
  let finalLeftAccessory: StickAccessory = activeAct?.leftAccessory ?? "none";
  if (
    (finalLeftAccessory === "gold_chain" || finalLeftAccessory === "scammer_bling") &&
    !isLeftTycoonOrScammer
  ) {
    finalLeftAccessory = expertRegex.test(leftNameLower) ? "necktie" : "none";
  }
  if (finalLeftAccessory === "none") {
    if (scammerRegex.test(leftNameLower) || (teoTurn && isScammerSentence)) {
      finalLeftAccessory = "scammer_bling";
    } else if (tycoonRegex.test(leftNameLower) || (teoTurn && isTycoonFlexSentence)) {
      finalLeftAccessory = "gold_chain";
    } else if (expertRegex.test(leftNameLower)) {
      finalLeftAccessory = "necktie";
    }
  }

  // Determine Right Character Accessory (strip gold_chain/scammer_bling if not actually a tycoon/scammer context)
  let finalRightAccessory: StickAccessory = activeAct?.rightAccessory ?? "none";
  if (
    (finalRightAccessory === "gold_chain" || finalRightAccessory === "scammer_bling") &&
    !isRightTycoonOrScammer
  ) {
    finalRightAccessory = expertRegex.test(rightNameLower) ? "necktie" : "none";
  }
  if (finalRightAccessory === "none") {
    if (scammerRegex.test(rightNameLower) || (!teoTurn && isScammerSentence)) {
      finalRightAccessory = "scammer_bling";
    } else if (
      tycoonRegex.test(rightNameLower) ||
      (!teoTurn && isTycoonFlexSentence && !expertRegex.test(rightNameLower))
    ) {
      finalRightAccessory = "gold_chain";
    } else if (expertRegex.test(rightNameLower)) {
      finalRightAccessory = "necktie";
    }
  }

  const isExplicitChecklistContext = /(danh sách|checklist|bảng kiểm|hợp đồng|điều khoản|giấy phép|biên bản)/i.test(sentenceContext);
  const isSodaOrSweetenerContext =
    /(nước ngọt|lon zero|zero calo|cola|coca|pepsi|lon nước|nước có ga|soda|aspartame|sucralose|saccharin|chất tạo ngọt|đồ uống ăn kiêng)/i.test(
      activeSceneText
    );
  const isActualFoodContext =
    !isSodaOrSweetenerContext &&
    /(phở|bún|mì gói|mì cay|tô mì|bát phở|cơm tấm|xôi|cháo|hủ tiếu|bánh canh|quán phở|quán bún|đầu bếp)/i.test(activeSceneText);

  const inferSpecificBuiltInProp = (ctx: string, isLeft: boolean, sceneSeed: number): StickProp => {
    if (/(vàng 9999|thỏi vàng|kho bạc|kim cương|tiệm vàng|tài sản lớn)/i.test(ctx)) return "gold";
    if (/(nước lọc|trà không đường)/i.test(ctx) && /(cầu tạm|chuyển hẳn|thay vì)/i.test(ctx)) {
      return isLeft ? "water_bottle" : "soda_can";
    }
    if (
      /(nước ngọt|lon zero|zero calo|cola|coca|pepsi|lon nước|nước có ga|soda|aspartame|sucralose|saccharin|chất tạo ngọt|đồ uống ăn kiêng)/i.test(
        ctx
      )
    ) {
      return isLeft ? "soda_can" : sceneSeed % 2 === 0 ? "magnifier" : "chart";
    }
    if (
      /(trà sữa|trân châu|quán trà|quán cà phê|ly cà phê|cốc cà phê|pha chế)/i.test(ctx) &&
      !/thìa cà phê|muỗng cà phê/i.test(ctx)
    ) {
      return isLeft ? "coffee" : sceneSeed % 2 === 0 ? "scroll" : "money";
    }
    if (isActualFoodContext) return "bowl";
    if (
      /(tiền|giá|thuế|lương|phí|nợ|vay|tỷ|triệu|đồng|chi phí|lãi|mua|bán|đắt|rẻ|túi tiền|trả góp|ví trả sau|mặt bằng)/i.test(
        ctx
      )
    ) {
      return isLeft ? (sceneSeed % 2 === 0 ? "money" : "chart") : sceneSeed % 2 === 0 ? "chart" : "magnifier";
    }
    if (/(quy định|luật|phạt|cảnh báo|thông báo|cấm|bắt buộc|chính sách)/i.test(ctx)) {
      return isLeft ? "phone" : "megaphone";
    }
    if (/(phần trăm|%|tăng|giảm|thị trường|xu hướng|thống kê|số liệu|tỷ lệ|biểu đồ|nghiên cứu|thí nghiệm)/i.test(ctx)) {
      return isLeft ? "chart" : "magnifier";
    }
    if (/(online|app|ứng dụng|mạng|tiktok|shopee|điện thoại|tin nhắn|deepfake|tài khoản|chạm)/i.test(ctx)) return "phone";
    if (/(thành công|chiến thắng|vô địch|đỉnh cao|giải pháp|cơ hội|thưởng)/i.test(ctx)) return "trophy";
    if (/(nóng|quạt|trưa hè)/i.test(ctx)) return "fan";
    if (/(chiếu chỉ|lệnh|sắc phong|cổ trang|quan|vua)/i.test(ctx)) return "scroll";
    return "none";
  };

  const inferTangibleHandProp = (ctx: string, isLeft: boolean, sceneSeed: number): StickProp => {
    const specific = inferSpecificBuiltInProp(ctx, isLeft, sceneSeed);
    if (specific !== "none") return specific;
    return isLeft ? "microphone" : "magnifier";
  };

  const sentenceStartFrame = currentSpokenLine ? Math.round(currentSpokenLine.start * FPS) : activeTiming?.from ?? 0;
  const sentenceLocalFrame = Math.max(0, f - sentenceStartFrame);

  const sanitizeFoodProp = (p: StickProp | undefined): StickProp => {
    if (!p || p === "wheel" || p === "question" || p === "bulb") return "none";
    if (p === "bowl" && !isActualFoodContext) return isSodaOrSweetenerContext ? "soda_can" : "none";
    if (p === "coffee" && isSodaOrSweetenerContext) return "soda_can";
    if (p === "book") return "scroll";
    if (p === "notebook") return "chart";
    if (p === "checklist") return "scroll";
    return p;
  };

  const rawActLeftProp = sanitizeFoodProp(activeAct?.leftProp);
  const rawActRightProp = sanitizeFoodProp(activeAct?.rightProp);

  // Validate AI-drawn custom handheld SVG: accept any multi-element SVG or vector shape (<path>, <polygon>, <circle>, <ellipse>, or 2+ <rect>/<line>)
  const isValidCustomPropSvg = (raw?: string): boolean => {
    if (!raw || raw.trim().length < 32) return false;
    const tagMatches = raw.match(/<(path|polygon|circle|ellipse|rect|line|polyline)\b/gi) ?? [];
    return /<(path|polygon|circle|ellipse)\b/i.test(raw) || tagMatches.length >= 2;
  };

  // Dynamic AI Handheld Props FIRST (`leftCustomPropSvg` / `rightCustomPropSvg` generated per-scene by Gemini 4.0):
  // e.g. Coke Zero can -> sugar bowl -> cake slice with cherry -> probiotic capsule -> fresh orange -> glass of water -> car key -> ID card!
  // Built-in `StickProp` library serves when AI picks a standard prop (`magnifier`, `chart`, `scroll`, `money`) or as fallback.
  // Story mode (minimalUi): hands stay empty unless the line itself says what is held (lineBeats[].prop).
  const effectiveLeftCustomPropSvg =
    !minimalUi && isValidCustomPropSvg(activeAct?.leftCustomPropSvg) ? activeAct?.leftCustomPropSvg : undefined;
  const effectiveRightCustomPropSvg =
    !minimalUi && !isSolo && isValidCustomPropSvg(activeAct?.rightCustomPropSvg) ? activeAct?.rightCustomPropSvg : undefined;

  const autoContextualLeftProp: StickProp = !effectiveLeftCustomPropSvg
    ? inferTangibleHandProp(activeSceneText, true, activeSceneIdx)
    : "none";
  const autoContextualRightProp: StickProp =
    !effectiveRightCustomPropSvg && !isSolo
      ? rawActLeftProp === "magnifier" && isSodaOrSweetenerContext
        ? "soda_can"
        : inferTangibleHandProp(activeSceneText, false, activeSceneIdx)
      : "none";

  const resolvedLeftProp: StickProp =
    effectiveLeftCustomPropSvg || leftPose === "sit_type" || leftPose === "climb"
      ? "none"
      : rawActLeftProp !== "none"
        ? rawActLeftProp
        : autoContextualLeftProp;
  const resolvedRightProp: StickProp =
    effectiveRightCustomPropSvg || rightPose === "sit_type" || rightPose === "climb" || isSolo
      ? "none"
      : rawActRightProp !== "none"
        ? rawActRightProp
        : autoContextualRightProp;
  // per-line acting (lineBeats) belongs to the story style only; the classic stickman keeps its own choreography
  const lineBeat: StickmanLineBeat | undefined = minimalUi ? activeAct?.lineBeats?.[sceneLineIdx] : undefined;
  // first line of a scene continues from the LAST beat of the previous scene (no pop-in / blink at scene changes)
  const prevActBeats = acts[activeSceneIdx - 1]?.lineBeats;
  const prevLineBeat: StickmanLineBeat | undefined = !minimalUi
    ? undefined
    : sceneLineIdx > 0 ? activeAct?.lineBeats?.[sceneLineIdx - 1] : prevActBeats?.[prevActBeats.length - 1];
  // Story mode: characters enter/leave with the story and only move their lips on their own quoted line.
  const visBlend = Math.min(1, Math.max(0, sentenceLocalFrame / (minimalUi ? 22 : 12)));
  const visOf = (now?: StickmanCharBeat, prev?: StickmanCharBeat) => {
    if (!minimalUi) return 1;
    const a = prev?.hidden ? 0 : 1;
    const b = now?.hidden ? 0 : 1;
    return a + (b - a) * visBlend;
  };
  const leftVis = visOf(lineBeat?.left, prevLineBeat?.left);
  const rightVis = visOf(lineBeat?.right, prevLineBeat?.right);
  const thirdVis = visOf(lineBeat?.third, prevLineBeat?.third);
  const leftSpeak = Boolean(lineBeat?.left?.speak);
  const rightSpeak = Boolean(lineBeat?.right?.speak);
  const finalLeftProp: StickProp = lineBeat?.left?.prop ?? (minimalUi ? "none" : resolvedLeftProp);
  const finalRightProp: StickProp = lineBeat?.right?.prop ?? (minimalUi ? "none" : resolvedRightProp);
  const isLeftVendor =
    /(bán hàng|bán xôi|bán bánh|bán nước|hàng rong|gánh hàng|cô bán|bà bán|chị bán|tiểu thương)/i.test(leftNameLower) ||
    activeSetting === "street_vendor" ||
    activeSetting === "sidewalk_tea";
  const isRightVendor =
    /(bán hàng|bán xôi|bán bánh|bán nước|hàng nước|trà đá|nước mía|gánh hàng)/i.test(rightNameLower) ||
    activeSetting === "sidewalk_tea";

  const finalLeftHat: StickHat =
    activeAct?.leftHat && activeAct?.leftHat !== "none"
      ? activeAct.leftHat === "tophat" && !isLeftTycoonOrScammer
        ? isLeftVendor
          ? "non_la"
          : "none"
        : activeAct.leftHat
      : /(ba chõm|cậu bé|thần đồng|đứa bé)/i.test(leftNameLower)
        ? "three_tuft"
        : isCookingContext || /(đầu bếp|bếp trưởng)/i.test(leftNameLower)
          ? "chef_hat"
          : isGymContext || isMartialContext || /(võ sĩ|vận động viên|gymer)/i.test(leftNameLower)
            ? "headband"
            : isLeftVendor
              ? "non_la"
              : /(đại gia|nhà giàu|tỷ phú|ông trùm)/i.test(leftNameLower)
                ? "tophat"
                : "none";
  const finalRightHat: StickHat =
    activeAct?.rightHat && activeAct?.rightHat !== "none"
      ? activeAct.rightHat === "tophat" && !isRightTycoonOrScammer
        ? isRightVendor
          ? "cap"
          : "none"
        : activeAct.rightHat
      : /(ba chõm|cậu bé|thần đồng|đứa bé)/i.test(rightNameLower)
        ? "three_tuft"
        : isCookingContext || /(đầu bếp|bếp trưởng)/i.test(rightNameLower)
          ? "chef_hat"
          : isGymContext || isMartialContext || /(võ sĩ|vận động viên|gymer)/i.test(rightNameLower)
            ? "headband"
            : isRightVendor
              ? "cap"
              : /(đại gia|nhà giàu|tỷ phú|ông trùm)/i.test(rightNameLower)
                ? "tophat"
                : "none";

  const isHistoricalSetting =
    activeSetting === "royal_palace" ||
    activeSetting === "peach_banquet" ||
    activeSetting === "imperial_court" ||
    activeSetting === "imperial_garden" ||
    activeSetting === "ancient_village";

  const resolveAutoOutfit = (
    nameLower: string,
    hat: StickHat,
    acc: StickAccessory,
    isVendorRole: boolean,
    isRightSide: boolean,
    explicitOutfit?: StickOutfit
  ): StickOutfit => {
    if (explicitOutfit && explicitOutfit !== "none") return explicitOutfit;
    if (isSoccerContext || /(cầu thủ|thủ môn|bóng đá|tiền đạo)/i.test(nameLower)) {
      return "soccer_jersey";
    }
    if (isCookingContext || hat === "chef_hat" || /(đầu bếp|bếp trưởng|nấu ăn)/i.test(nameLower)) {
      return "chef_coat";
    }
    if (isGymContext || /(gymer|thể hình|tập tạ|hlv thể hình)/i.test(nameLower)) {
      return "gym_tank";
    }
    if (isMartialContext || /(võ sĩ|quyền anh|boxing|võ sư)/i.test(nameLower)) {
      return "martial_gi";
    }
    if (isHistoricalSetting || hat === "crown" || hat === "three_tuft" || /(vua|hoàng đế|quan|tể tướng|nương nương|cổ trang|quỳnh)/i.test(nameLower)) {
      return "royal_robe";
    }
    if (hat === "official" || /(cảnh sát|công an|đoàn kiểm tra|trật tự|phường|thanh tra|bảo vệ|quan tòa)/i.test(nameLower)) {
      return "uniform";
    }
    if (activeSetting === "hospital_clinic" || /(bác sĩ|dược sĩ|y tá|chuyên gia y tế|bệnh viện)/i.test(nameLower)) {
      return "doctor_coat";
    }
    if (isVendorRole || hat === "non_la") {
      return "vendor_apron";
    }
    if (
      acc === "necktie" ||
      hat === "scholar" ||
      hat === "tophat" ||
      expertRegex.test(nameLower) ||
      tycoonRegex.test(nameLower) ||
      scammerRegex.test(nameLower)
    ) {
      return "suit";
    }
    if (/(lương|văn phòng|công sở|nhân viên|kỹ sư|lập trình|sếp|doanh nghiệp|kế toán)/i.test(nameLower)) {
      return "office_shirt";
    }
    if (/(tỉnh ngộ|điềm đạm|ung dung|người trẻ|sinh viên|khách|bạn|người qua đường)/i.test(nameLower)) {
      return "hoodie";
    }
    return isRightSide ? "suit" : "office_shirt";
  };

  const finalLeftOutfit: StickOutfit = resolveAutoOutfit(
    leftNameLower,
    finalLeftHat,
    finalLeftAccessory,
    isLeftVendor,
    false,
    activeAct?.leftOutfit
  );
  const finalRightOutfit: StickOutfit = resolveAutoOutfit(
    rightNameLower,
    finalRightHat,
    finalRightAccessory,
    isRightVendor,
    true,
    activeAct?.rightOutfit
  );

  // 5. Multi-Character Stage Resolver (3 or 4 Stickmen when scene is a crowd, market, street vendor, or trio):
  const isInspectionMoment = /(đoàn kiểm tra|trật tự|phường|bị dẹp|dọn hàng|nháy mắt|báo động)/i.test(sentenceContext);
  const hasThirdChar =
    !isSolo &&
    (activeAct?.mode === "trio" ||
      activeAct?.mode === "crowd" ||
      Boolean(activeAct?.charThird) ||
      activeSetting === "street_vendor" ||
      activeSetting === "sidewalk_tea" ||
      /(đoàn kiểm tra|cả dãy|người mua kẻ bán|xếp hàng|đám đông|hàng xôi|hàng nước|nhiều người)/i.test(sentenceContext));

  const hasFourthChar =
    !isSolo &&
    (activeAct?.mode === "crowd" ||
      /(cả dãy|đám đông|xếp hàng|tấp nập|nhiều khách|mọi người xung quanh)/i.test(sentenceContext));

  // Harmoniously space out characters (1, 2, 3, or 4) across the stage so nobody overlaps or blocks the visual showcase!
  if (activeSetting === "custom_scene" && !isSolo) {
    if (hasFourthChar) {
      leftX = 165;
      rightX = 665;
    } else if (hasThirdChar) {
      leftX = 215;
      rightX = 540;
    } else {
      leftX = 285;
      rightX = 795;
    }
  } else {
    if (hasThirdChar && rightX > 720) {
      rightX = 665;
    }
    if (hasFourthChar) {
      leftX = 165;
      rightX = activeSetting === "sidewalk_tea" ? 640 : 665;
    }
  }
  const thirdX =
    activeSetting === "custom_scene"
      ? hasFourthChar
        ? 915
        : 865
      : hasFourthChar
        ? 920
        : 905;
  const thirdY = FLOOR_Y;
  const thirdLabel =
    activeAct?.charThird ||
    (isInspectionMoment
      ? "Đoàn Kiểm Tra"
      : activeSetting === "sidewalk_tea"
        ? "Khách Mua Hàng"
        : activeSetting === "street_vendor"
          ? "Khách Đợi Mua"
          : "Người Qua Đường");
  const thirdHat: StickHat =
    activeAct?.thirdHat ?? (isInspectionMoment ? "official" : activeSetting === "street_vendor" ? "cap" : "none");
  // Extras hold still except on cue (ported from claude-animated-shorts motion.md):
  // Only point/wave when an inspection alert or celebration cue is active; otherwise stand/check phone calmly.
  const thirdPose: StickPose = lineBeat?.third?.pose ?? (minimalUi ? "stand" : isInspectionMoment
    ? "point"
    : activeAction === "relax_celebrate"
      ? "wave"
      : isCheckingPhoneSentence && subBeat % 2 === 0
        ? "check_phone"
        : "stand");
  const thirdMood: StickMood = lineBeat?.third?.mood ?? (isInspectionMoment ? "serious" : isConflictLine ? "shock" : "happy");
  const thirdProp: StickProp = minimalUi
    ? (lineBeat?.third?.prop ?? "none")
    : activeAct?.thirdProp && activeAct.thirdProp !== "checklist"
      ? activeAct.thirdProp
      : isInspectionMoment
        ? "notebook"
        : activeSetting === "street_vendor"
          ? "money"
          : "none";

  const fourthX =
    activeSetting === "custom_scene"
      ? 415
      : activeSetting === "sidewalk_tea"
        ? 495
        : 420;
  const fourthY = activeSetting === "street_vendor" || activeSetting === "sidewalk_tea" ? FLOOR_Y - 12 : FLOOR_Y;
  const fourthLabel = activeSetting === "street_vendor" || activeSetting === "sidewalk_tea" ? "Bác Xe Ôm" : "Khách Quen";

  const barPct = Math.max(10, Math.min(100, activeAct?.progressValue ?? 75)) * Math.min(1, sceneLocalP * 1.4);

  // Keep poses calm and steady across the sentence so held props never jump mid-sentence
  const dynamicLeftPose: StickPose = leftPose;
  const dynamicRightPose: StickPose = rightPose;

  // Per-sentence conversational step-in / step-toward-board choreography
  const leftStepOffset =
    isLockedPhysicalScene || isDeskSetting
      ? 0
      : teoTurn
        ? dynamicLeftPose === "point" || dynamicLeftPose === "crouch_inspect"
          ? 28
          : isConflictLine
            ? -16
            : 16
        : -8;
  const rightStepOffset =
    isLockedPhysicalScene || isDeskSetting
      ? 0
      : !teoTurn
        ? dynamicRightPose === "point" || dynamicRightPose === "crouch_inspect"
          ? -28
          : isConflictLine
            ? 16
            : -16
        : 8;

  const stepBlend = Math.min(1, sentenceLocalFrame / 14);
  // Per-line acting (lineBeats): walk from the previous line's spot to this line's spot, tremble on cue.
  // story mode walks slowly (~1.2 s per change of spot); other styles keep the brisk 0.6 s
  const beatBlend = Math.min(1, sentenceLocalFrame / (minimalUi ? 60 : 18)); // story mode: ~2 s per change of spot
  const beatEase = beatBlend * beatBlend * (3 - 2 * beatBlend);
  const leftDxPrev = beatDx(prevLineBeat?.left, false);
  const leftDxNow = beatDx(lineBeat?.left, false);
  const rightDxPrev = beatDx(prevLineBeat?.right, true);
  const rightDxNow = beatDx(lineBeat?.right, true);
  const leftDepthPrev = beatDepth(prevLineBeat?.left);
  const leftDepthNow = beatDepth(lineBeat?.left);
  const rightDepthPrev = beatDepth(prevLineBeat?.right);
  const rightDepthNow = beatDepth(lineBeat?.right);
  const leftWalking = (Math.abs(leftDxNow - leftDxPrev) > 10 || leftDepthNow !== leftDepthPrev) && beatBlend < 1;
  const rightWalking = (Math.abs(rightDxNow - rightDxPrev) > 10 || rightDepthNow !== rightDepthPrev) && beatBlend < 1;
  // a slow shiver (≈ 4 Hz, small), never a 20 Hz jitter that reads as a glitch
  const shiver = (ph: number) => Math.sin(f * 0.85 + ph) * 1.6 + Math.sin(f * 1.6 + ph * 2) * 0.6;
  // story mode: fear is acted with pose + face, never with a shaking body
  const leftShake = lineBeat?.left?.shake && !minimalUi ? shiver(0) : 0;
  const rightShake = lineBeat?.right?.shake && !minimalUi ? shiver(1.3) : 0;
  // no idle drift: a standing character (and the chair it sits on) stays exactly where it is
  const idleL = 0;
  const idleR = 0;
  const leftDepth = minimalUi ? leftDepthPrev + (leftDepthNow - leftDepthPrev) * beatEase : 0;
  const rightDepth = minimalUi ? rightDepthPrev + (rightDepthNow - rightDepthPrev) * beatEase : 0;
  const leftBeatX = leftDxPrev + (leftDxNow - leftDxPrev) * beatEase + leftShake + idleL;
  const rightBeatX = rightDxPrev + (rightDxNow - rightDxPrev) * beatEase + rightShake + idleR;
  // previous line's pose, for the pose cross-fade
  const walkFrames = minimalUi ? 60 : 18;
  const arrived = (walked: boolean) => walked === false && sentenceLocalFrame >= walkFrames && sentenceLocalFrame < walkFrames + 14;
  const leftMoved = Math.abs(leftDxNow - leftDxPrev) > 10;
  const rightMoved = Math.abs(rightDxNow - rightDxPrev) > 10;
  // pose cross-fade (14 frames) at the start of a line, or right after a walk ends ("walk" → new pose)
  const poseBlend = leftMoved || rightMoved
    ? Math.min(1, Math.max(0, (sentenceLocalFrame - walkFrames) / 14))
    : Math.min(1, sentenceLocalFrame / 14);
  const prevLeftPose: StickPose | undefined = leftMoved && arrived(leftWalking)
    ? "walk"
    : prevLineBeat?.left?.pose ?? (minimalUi ? "stand" : undefined);
  const prevRightPose: StickPose | undefined = rightMoved && arrived(rightWalking)
    ? "walk"
    : prevLineBeat?.right?.pose ?? (minimalUi ? "stand" : undefined);
  const hasBeats = minimalUi && Boolean(activeAct?.lineBeats?.length);
  const portraitGain = minimalUi ? 1.8 : 1;
  // walkers face where they go (a reversed walk cycle reads as moon-walking); "back" keeps facing forward
  const leftFaceFlip = minimalUi && leftWalking && leftDxNow < leftDxPrev;
  const rightFaceFlip = !(minimalUi && rightWalking && rightDxNow > rightDxPrev);
  const choreographedLeftX = Math.min(W - 90, Math.max(90, leftX + (hasBeats ? 0 : leftStepOffset * stepBlend) + leftBeatX * portraitGain));
  const choreographedRightX = Math.min(W - 90, Math.max(90, rightX + (hasBeats ? 0 : rightStepOffset * stepBlend) + rightBeatX * portraitGain));
  if (lineBeat?.left?.mood) leftMood = lineBeat.left.mood;
  if (lineBeat?.right?.mood) rightMood = lineBeat.right.mood;

  const finalLeftPose: StickPose = leftWalking
    ? "walk"
    : (minimalUi && (lineBeat?.left?.pose === "walk" || lineBeat?.left?.pose === "run") ? "stand" : lineBeat?.left?.pose) ?? (minimalUi ? "stand" : isAfterAllSpeech && dynamicLeftPose === "explain" ? "wave" : dynamicLeftPose);
  const finalRightPose: StickPose = rightWalking
    ? "walk"
    : (minimalUi && (lineBeat?.right?.pose === "walk" || lineBeat?.right?.pose === "run") ? "stand" : lineBeat?.right?.pose) ?? (minimalUi ? "stand" : isAfterAllSpeech && dynamicRightPose === "explain" ? "stand" : dynamicRightPose);

  const {width: stageW, height: stageH} = useVideoConfig();
  const isLandscapeStage = stageW > stageH;

  if (isLandscapeStage) {
    const lw = stageW; // 1920
    const lh = stageH; // 1080
    const floorY = 935;
    const theme = (activeAct as any)?.bgTheme || "indoor_modern";
    const themeMap: Record<string, {top: string; mid: string; floor: string; line: string; glow: string}> = {
      city_day: {top: "#0C4A6E", mid: "#075985", floor: "#0F172A", line: "#38BDF8", glow: "rgba(56,189,248,0.16)"},
      city_night: {top: "#090D16", mid: "#1E1B4B", floor: "#090D16", line: "#818CF8", glow: "rgba(129,140,248,0.18)"},
      warm_sunset: {top: "#431407", mid: "#7C2D12", floor: "#1C1917", line: "#FB923C", glow: "rgba(251,146,60,0.18)"},
      dramatic_dark: {top: "#18091C", mid: "#2E1035", floor: "#0B0F19", line: "#F43F5E", glow: "rgba(244,63,94,0.16)"},
      hospital_clean: {top: "#0F2942", mid: "#164E63", floor: "#0F172A", line: "#22D3EE", glow: "rgba(34,211,238,0.16)"},
      nature_outdoor: {top: "#064E3B", mid: "#115E59", floor: "#0F172A", line: "#34D399", glow: "rgba(52,211,153,0.16)"},
      luxury_gold: {top: "#1C1917", mid: "#422006", floor: "#0C0A09", line: "#FACC15", glow: "rgba(250,204,21,0.18)"},
      indoor_modern: {top: "#0B132B", mid: "#1E293B", floor: "#090F1D", line: "#38BDF8", glow: "rgba(56,189,248,0.15)"},
    };
    const pal = themeMap[theme] || themeMap.indoor_modern;
    // Keep Center 2D Stage & Characters anchored on exact integer pixels so text NEVER shimmers or sub-pixel crawls!
    const sentencesPerBeat = 2;
    const visualBeatIdx = Math.floor(sceneLineIdx / sentencesPerBeat);
    const isBeatStartSentence = sceneLineIdx % sentencesPerBeat === 0;

    const beatFadeOpacity =
      isBeatStartSentence && sentenceLocalFrame < 10
        ? 0.84 + (sentenceLocalFrame / 10) * 0.16
        : 1;

    // story mode: cast closer to the centre and kept inside 10–90 % of the width, whatever the moves add up to
    const clampX = (x: number) => (minimalUi ? Math.min(lw * 0.9, Math.max(lw * 0.1, x)) : x);
    const moveGain = minimalUi ? 3.2 : 1.4; // story mode: steps you can actually see across a 1920 px stage
    // Story mode: a lone character stands in the middle; two people who talk stand close together near the middle.
    const wideLeftX = clampX((minimalUi ? (isSolo ? 960 : 770) : isSolo ? 460 : 295) + leftBeatX * moveGain);
    const wideRightX = clampX((minimalUi ? 1150 : 1625) + rightBeatX * moveGain);
    const badgeText = activeAct?.badge || `PHẦN ${activeSceneIdx + 1}`;
    const badgeW = Math.max(240, Math.min(440, badgeText.length * 14 + 48));

    // Sanitize props so characters in non-food videos never hold a noodle bowl or boba cup
    const wideLeftProp: StickProp =
      finalLeftProp === "bowl" && !isActualFoodContext
        ? isSodaOrSweetenerContext
          ? "soda_can"
          : "none"
        : finalLeftProp;
    const wideRightProp: StickProp =
      finalRightProp === "bowl" && !isActualFoodContext
        ? isSodaOrSweetenerContext
          ? "magnifier"
          : "scroll"
        : finalRightProp;

    const activeLeftPose: StickPose = finalLeftPose;
    const activeRightPose: StickPose = finalRightPose;

    // Extract live phrases, numbers, and comparison tags directly from the current 2 sentences of this Beat!
    const beatSlice = sceneLines.slice(visualBeatIdx * sentencesPerBeat, (visualBeatIdx + 1) * sentencesPerBeat);
    const beatSentA = beatSlice[0]?.text || currentSpokenLine?.text || activeAct?.title || "";
    const beatSentB = beatSlice[1]?.text || beatSentA;
    const beatCombinedRaw = `${beatSentA} ${beatSentB}`.trim();

    const DANGLING_VN_LAST_WORDS = new Set([
      "TỔ", "CHẤT", "HỆ", "TỈ", "TỶ", "CƠ", "BỘ", "NHÀ", "TIỂU", "UNG",
      "KHÔNG", "ĐỪNG", "CHƯA", "ĐANG", "SẼ", "ĐÃ", "BỊ", "ĐƯỢC", "LÀ", "VÀ",
      "HAY", "HOẶC", "CỦA", "CHO", "TRONG", "TRÊN", "DƯỚI", "VỚI", "TỪ", "ĐẾN",
      "TỚI", "NHƯ", "KHI", "NẾU", "VÌ", "DO", "MỘT", "NHỮNG", "CÁC", "MỖI", "MỌI",
      "CHIẾC", "CON", "NGƯỜI", "VI", "DUNG", "THỰC", "NGHIÊN", "KHUYẾN", "THÍ",
      "SO", "HÀNH", "ÁP", "CHỖ", "MỚI", "CHỊ", "ANH", "CÒN", "HÃY",
    ]);

    const extractShortPhrase = (raw: string, maxWords = 4, fallback = "CHI TIẾT"): string => {
      const cleaned = raw
        .replace(/[.,!?;:"“”()—–-]/g, " ")
        .replace(
          /^(nhưng|thế nhưng|tuy nhiên|ngược lại|vậy còn|vậy|cùng năm đó|về lý thuyết|có nghĩa là|điều thú vị là|kết quả là|giả thuyết được đưa ra là|câu trả lời cuối cùng là|thứ thật sự đáng lo là|vấn đề lớn hơn là|các nhà khoa học gọi đây là|hôm nay chúng ta sẽ|mỗi ngày bạn|nếu bạn đang|khi phân tử|chính vì vậy|thực tế là|thực tế|bởi vì|vì|thậm chí|ngoài ra|ví dụ|khi bạn|nếu bạn|hãy coi|hãy|còn|trong khi đó)\s+/i,
          "",
        )
        .trim();
      const w = cleaned.split(/\s+/).filter(Boolean);
      if (w.length === 0) return fallback;
      const count = Math.min(w.length, maxWords);
      const candidateWords = w.slice(0, count).map((x) => x.toUpperCase());
      if (count < w.length && DANGLING_VN_LAST_WORDS.has(candidateWords[candidateWords.length - 1])) {
        const nextWord = w[count].toUpperCase();
        if (`${candidateWords.join(" ")} ${nextWord}`.length <= 24) {
          candidateWords.push(nextWord);
        } else if (candidateWords.length > 2) {
          candidateWords.pop();
        }
      }
      while (
        candidateWords.length > 2 &&
        (candidateWords.join(" ").length > 24 || DANGLING_VN_LAST_WORDS.has(candidateWords[candidateWords.length - 1]))
      ) {
        candidateWords.pop();
      }
      return candidateWords.join(" ") || fallback;
    };

    const extractTailPhrase = (raw: string, maxWords = 4, fallback = "KẾT QUẢ"): string => {
      const cleaned = raw.replace(/[.,!?;:"“”()—–-]/g, " ").trim();
      const w = cleaned.split(/\s+/).filter(Boolean);
      if (w.length <= maxWords) return extractShortPhrase(raw, maxWords, fallback);
      const slice = w.slice(Math.max(0, w.length - maxWords)).map((x) => x.toUpperCase());
      while (slice.join(" ").length > 24 && slice.length > 2) {
        slice.shift();
      }
      return slice.join(" ") || fallback;
    };

    const extractNumbers = (raw: string): string[] => {
      const matches = raw.match(
        /\b\d+(?:[.,]\d+)?\s*(?:%|phần\s*trăm|triệu|tỷ|nghìn|ngàn|đồng|đ|k|m|km|phút|giờ|ngày|tuần|tháng|năm|lần|gam|g|mg|miligam|ml|lít|calo|kcal|kg|cân|thìa|lon|ly|quán|người|bước|tầng|lớp)?\b/gi,
      );
      if (!matches) return [];
      const normalized = matches.map((m) =>
        m
          .trim()
          .replace(/\s*phần\s*trăm$/i, "%")
          .toUpperCase(),
      );
      return Array.from(new Set(normalized));
    };

    const sceneAllNums = extractNumbers(activeSceneText);
    const beatNums = extractNumbers(beatCombinedRaw);
    const dynMetricA =
      beatNums[0] ||
      sceneAllNums[0] ||
      (activeAct?.statLeft?.match(/\d+[\w%.,/]*/)?.[0]?.replace(/[:.,;!?]+$/g, "").toUpperCase() ?? "ĐIỂM CHÍNH");
    const dynMetricB =
      beatNums[1] ||
      sceneAllNums.find((n) => n !== dynMetricA) ||
      (activeAct?.statRight?.match(/\d+[\w%.,/]*/)?.[0]?.replace(/[:.,;!?]+$/g, "").toUpperCase() ?? "ĐỐI CHIẾU");

    const isBrokenShortStat = (s?: string) => {
      if (!s) return true;
      const lastW = s.trim().split(/\s+/).pop()?.toUpperCase() || "";
      return DANGLING_VN_LAST_WORDS.has(lastW);
    };
    const safeHeaderStatLeft = !isBrokenShortStat(activeAct?.statLeft)
      ? activeAct!.statLeft
      : sceneAllNums[0] || extractShortPhrase(sceneLines[0]?.text || "", 4, "GÓC NHÌN A");
    const distinctSecondNum = sceneAllNums.find((n) => n !== safeHeaderStatLeft.toUpperCase());
    const safeHeaderStatRight = !isBrokenShortStat(activeAct?.statRight)
      ? activeAct!.statRight
      : distinctSecondNum || extractTailPhrase(sceneLines[1]?.text || sceneLines[0]?.text || "", 4, "GÓC NHÌN B");
    const safeHeaderTitle = !isBrokenShortStat(activeAct?.title)
      ? activeAct!.title
      : extractShortPhrase(sceneLines[0]?.text || "", 5, "PHÂN TÍCH CHI TIẾT");

    const dynLeftLabel = extractShortPhrase(beatSentA, 4, safeHeaderStatLeft.toUpperCase() || "YẾU TỐ 1");
    const dynRightLabel = extractTailPhrase(
      beatSentB !== beatSentA ? beatSentB : safeHeaderStatRight || "",
      4,
      safeHeaderStatRight.toUpperCase() || "YẾU TỐ 2",
    );
    const dynTailLabel = extractTailPhrase(beatSentB, 4, safeHeaderStatRight.toUpperCase() || "TÁC ĐỘNG");
    // Lock dynBanner to the Beat's core takeaway (tail of beatSentA or safeHeaderTitle) so it stays 100% calm & never duplicates dynLeftLabel!
    const candBanner = extractTailPhrase(beatSentA, 5, safeHeaderTitle.slice(0, 28) || "PHÂN TÍCH TRỰC QUAN");
    const dynBanner = candBanner !== dynLeftLabel ? candBanner : safeHeaderTitle.slice(0, 28) || candBanner;

    // Render AI-designed SVG on Beat 0 (`customSvgBeats[0]` or `activeAct.customSvg`), and per-beat `customSvgBeats[visualBeatIdx]` on subsequent beats!
    // Ignore legacy generic fallback scale SVGs (`points="-35,-15 35,-15 0,-55"`) that contained blind 4-word sentence fragments.
    const rawCandidateBeatSvg =
      activeAct?.customSvgBeats?.[visualBeatIdx] ||
      (visualBeatIdx === 0 ? activeAct?.customSvg : undefined);
    const isLegacyGenericFallbackSvg =
      Boolean(rawCandidateBeatSvg) &&
      rawCandidateBeatSvg!.includes('points="-35,-15 35,-15 0,-55"') &&
      rawCandidateBeatSvg!.includes('line x1="-115" y1="-145" x2="115" y2="-175"');
    const aiBeatRawSvg = isLegacyGenericFallbackSvg ? undefined : rawCandidateBeatSvg;
    const cleanAiBeatSvg = aiBeatRawSvg ? sanitizeCustomSvg(aiBeatRawSvg) : "";

    const fullVideoTopicText = `${acts.map((a) => `${a.title ?? ""} ${a.statLeft ?? ""} ${a.statRight ?? ""}`).join(" ")} ${voice.lines
      .slice(0, 12)
      .map((l) => l.text)
      .join(" ")}`.toLowerCase();
    const isFranchiseBobaTopic = /(trà sữa|nhượng quyền)/.test(fullVideoTopicText);

    // Dynamic Content-Adaptive 2D Cartoon Illustrations covering all topics (Health, Science, Finance, Gold, Tech, Tax, Law, Psychology, Business)
    type CenterVisualScene =
      | "ai_beat_svg"
      | "soda_zero_vs_sugar"
      | "brain_taste_signal"
      | "gut_microbiome_lab"
      | "who_safety_gauge"
      | "habit_water_bridge"
      | "dyn_versus_split"
      | "dyn_scale_paradox"
      | "dyn_mechanism_flow"
      | "dyn_audit_scanner"
      | "dyn_calculator_data"
      | "dyn_action_roadmap"
      | "boba_kiosk"
      | "printer_ink"
      | "contract_lock"
      | "market_compare"
      | "conveyor_profit"
      | "cup_cost_layers"
      | "three_stalls"
      | "radar_radius"
      | "scale_balance"
      | "cashflow_burn"
      | "penalty_trap"
      | "night_shutter"
      | "magnifier_audit"
      | "old_shop_survey"
      | "breakeven_calc"
      | "smart_roadmap"
      | "decoy_cups"
      | "clock_brain"
      | "gold_vault_9999"
      | "qwerty_keyboard"
      | "bank_tax_transfer"
      | "diderot_chain";

    // Universal fallback scenes use 100% live text & metrics from the current spoken sentences — ZERO hardcoded boba/franchise labels!
    const UNIVERSAL_DYNAMIC_SCENES: CenterVisualScene[] = [
      "dyn_versus_split",
      "dyn_mechanism_flow",
      "dyn_calculator_data",
      "dyn_scale_paradox",
      "dyn_audit_scanner",
      "dyn_action_roadmap",
    ];

    const FRANCHISE_VISUAL_SCENES: CenterVisualScene[] = [
      "boba_kiosk",
      "printer_ink",
      "contract_lock",
      "market_compare",
      "conveyor_profit",
      "cup_cost_layers",
      "three_stalls",
      "radar_radius",
      "scale_balance",
      "cashflow_burn",
      "penalty_trap",
      "night_shutter",
      "magnifier_audit",
      "old_shop_survey",
      "breakeven_calc",
      "smart_roadmap",
      "decoy_cups",
      "clock_brain",
    ];

    const ACTIVE_FALLBACK_POOL = isFranchiseBobaTopic ? FRANCHISE_VISUAL_SCENES : UNIVERSAL_DYNAMIC_SCENES;

    const matchCandidatesForText = (txt: string): CenterVisualScene[] => {
      const ranked: CenterVisualScene[] = [];
      // 1. Health, Soda, Nutrition & Biomedical Science Visuals
      if (/nước ngọt|lon zero|cola|coca|pepsi|35\s*gam|35g|thìa|ngọt gấp|140\s*calo|vỏ lon|đồ uống ăn kiêng/.test(txt)) {
        ranked.push("soda_zero_vs_sugar");
      }
      if (/lưỡi|thụ thể|bộ não|não nhận|tín hiệu ngọt|lệch pha|chuông báo|thèm đồ ngọt|thèm ngọt|vị giác|miếng bánh/.test(txt)) {
        ranked.push("brain_taste_signal");
      }
      if (/đường ruột|trong ruột|vi sinh|vi khuẩn|đường huyết|tiểu đường|dung nạp|nature|tạp chí cell|cấy vi khuẩn|sữa chua/.test(txt)) {
        ranked.push("gut_microbiome_lab");
      }
      if (/tổ chức y tế|who|ung thư|an toàn|giới hạn|miligam|thể trọng|béo phì|tim mạch|khuyến nghị|quan sát/.test(txt)) {
        ranked.push("who_safety_gauge");
      }
      if (/cầu tạm|nước lọc|trà không đường|quả cam|cai nó|giảm dần|bàn làm việc/.test(txt)) {
        ranked.push("habit_water_bridge");
      }

      // 2. Finance, Gold, Banking, Tax, Tech & Psychology Visuals
      if (/vàng 9999|tiệm vàng|nhẫn vàng|thỏi vàng|nguyên chất|tạp chất|luyện kim/.test(txt)) ranked.push("gold_vault_9999");
      if (/bàn phím|qwerty|máy chữ|gõ phím|kẹt phím|cần gạt/.test(txt)) ranked.push("qwerty_keyboard");
      if (/chuyển khoản|thuế|ngân hàng|sao kê|tài khoản|giao dịch|rửa tiền|sinh trắc học/.test(txt)) ranked.push("bank_tax_transfer");
      if (/diderot|mua 1 món|sắm thêm|tủ đồ|siêu thị|kệ hàng/.test(txt)) ranked.push("diderot_chain");
      if (/máy in|hộp mực|dao cạo|lưỡi dao/.test(txt)) ranked.push("printer_ink");
      if (/chim mồi|bắp nước|size m/.test(txt)) ranked.push("decoy_cups");
      if (/thức khuya|giấc ngủ|ngủ trưa|45 phút|nhịp sinh học/.test(txt)) ranked.push("clock_brain");

      // 3. Franchise / Boba-specific visuals ONLY when the video is actually about Franchise / Boba!
      if (isFranchiseBobaTopic) {
        if (/chợ đầu mối|bên ngoài|tự pha|nhập ngoài|rẻ hơn|gấp đôi|chênh lệch|so sánh/.test(txt)) ranked.push("market_compare");
        if (/hợp đồng|độc quyền|ép mua|trói|ràng buộc|bắt buộc|điều khoản/.test(txt)) ranked.push("contract_lock");
        if (/phạt|cắt cọc|thu hồi|vi phạm|kiểm tra đột xuất|bắt quả tang|cấm/.test(txt)) ranked.push("penalty_trap");
        if (/băng chuyền|tổng công ty|thu lời đều|nguyên liệu|thùng bột|nhập hàng|dây chuyền/.test(txt)) ranked.push("conveyor_profit");
        if (/một ly|tỷ lệ|phần trăm|cấu thành|giá cốt|chiếm tới|chia phần/.test(txt)) ranked.push("cup_cost_layers");
        if (/bán kính|500m|khoảng cách|bảo hộ vùng|cự ly|bản đồ|khu vực/.test(txt)) ranked.push("radar_radius");
        if (/cùng một con phố|mọc lên|sát vách|chia năm xẻ bảy|cạnh tranh|quầy mới|cửa hàng/.test(txt)) ranked.push("three_stalls");
        if (/mặt bằng|chi phí|cán cân|tiền thuê|nhân viên|nặng|đối lập/.test(txt)) ranked.push("scale_balance");
        if (/gồng lỗ|bào mòn|tiền dự phòng|tháng thứ|cạn vốn|hao hụt|mất tiền/.test(txt)) ranked.push("cashflow_burn");
        if (/đóng cửa|sang nhượng|thanh lý|vắng khách|dẹp tiệm|mất trắng|thất bại/.test(txt)) ranked.push("night_shutter");
        if (/quán cũ|đang chạy|ngồi đếm|khảo sát|hỏi thăm|ngày thường|quan sát/.test(txt)) ranked.push("old_shop_survey");
        if (/hòa vốn|bao nhiêu ly|tính toán|con số thực|bảng tính|công thức/.test(txt)) ranked.push("breakeven_calc");
        if (/kiểm tra|soi kỹ|trước khi ký|bảng giá|bộ lọc|thẩm định|xác minh/.test(txt)) ranked.push("magnifier_audit");
        if (/bảo vệ|an toàn|tỉnh táo|nguyên tắc|bước|chủ động|khôn ngoan|bài học|giải pháp/.test(txt)) ranked.push("smart_roadmap");
        if (/trà sữa|khai trương|0 đồng|50 triệu|mở quán|biển hiệu|mồi nhử/.test(txt)) ranked.push("boba_kiosk");
      } else {
        // Universal semantic matching for ALL other topics (Law, Real Estate, Health, Science, Career, Social)
        if (/so sánh|chênh lệch|trong khi|ngược lại|bên kia|phe|thay bằng|tương đương|gấp/.test(txt)) ranked.push("dyn_versus_split");
        if (/nghịch lý|cán cân|đánh đổi|mặt trái|ở giữa|cân bằng|hòa vốn/.test(txt)) ranked.push("dyn_scale_paradox");
        if (/từ .* đến|bước đầu|tiếp theo|dẫn tới|kết quả là|lập tức|đi thẳng|lộ trình/.test(txt)) ranked.push("dyn_mechanism_flow");
        if (/tính|phần trăm|%|con số|tỷ lệ|thống kê|mức|khoảng|năm \d+/.test(txt)) ranked.push("dyn_calculator_data");
        if (/kiểm tra|soi|bóc tách|bằng chứng|nghiên cứu|đối chiếu|xác minh|phát hiện/.test(txt)) ranked.push("dyn_audit_scanner");
        if (/cách|giải pháp|bảo vệ|nguyên tắc|hãy|tốt nhất|lời khuyên|bài học/.test(txt)) ranked.push("dyn_action_roadmap");
      }
      return ranked;
    };

    // Deterministically assign a globally non-repeating sequence of visuals across every beat in the entire video!
    const currentCenterVisual: CenterVisualScene = (() => {
      if (cleanAiBeatSvg) return "ai_beat_svg";
      const history: CenterVisualScene[] = [];
      const usedInCycle = new Set<CenterVisualScene>();

      for (let sIdx = 0; sIdx <= activeSceneIdx; sIdx++) {
        const sId = timings[sIdx]?.id ?? `scene_${sIdx + 1}`;
        const linesOfScene = voice.lines.filter((l) => l.scene === sId);
        const maxBeat =
          sIdx === activeSceneIdx
            ? visualBeatIdx
            : Math.max(0, Math.ceil(linesOfScene.length / sentencesPerBeat) - 1);

        for (let bIdx = 0; bIdx <= maxBeat; bIdx++) {
          if (usedInCycle.size >= Math.max(4, ACTIVE_FALLBACK_POOL.length - 1)) {
            usedInCycle.clear();
          }
          const beatTxt = linesOfScene
            .slice(bIdx * sentencesPerBeat, (bIdx + 1) * sentencesPerBeat)
            .map((l) => l.text)
            .join(" ")
            .toLowerCase();

          const candidates = matchCandidatesForText(beatTxt);
          const recent2 = history.slice(-2);

          // 1. Prefer a keyword-matched scene not in recent 2 beats
          let chosen: CenterVisualScene | undefined =
            candidates.find((c) => !usedInCycle.has(c) && !recent2.includes(c)) ||
            candidates.find((c) => !recent2.includes(c));

          // 2. Otherwise pick the next unused universal dynamic scene
          if (!chosen) {
            const startOffset = (sIdx * 3 + bIdx * 2) % ACTIVE_FALLBACK_POOL.length;
            for (let k = 0; k < ACTIVE_FALLBACK_POOL.length; k++) {
              const cand = ACTIVE_FALLBACK_POOL[(startOffset + k) % ACTIVE_FALLBACK_POOL.length];
              if (!usedInCycle.has(cand) && !recent2.includes(cand)) {
                chosen = cand;
                break;
              }
            }
          }

          const finalChoice = chosen || ACTIVE_FALLBACK_POOL[(history.length * 5) % ACTIVE_FALLBACK_POOL.length];
          history.push(finalChoice);
          usedInCycle.add(finalChoice);
        }
      }

      return history[history.length - 1] || "dyn_versus_split";
    })();

    return (
      <div style={{position: "absolute", inset: 0, overflow: "hidden", background: `linear-gradient(180deg, ${pal.top} 0%, ${pal.mid} 74%, ${pal.floor} 100%)`}}>
        {hasAiBg ? <AiBackdrop items={backdrops ?? []} voice={voice} dim={0.22} still={minimalUi} stageFloor={(floorY - 6) / lh} /> : null}
        <svg
          width={lw}
          height={lh}
          textRendering="geometricPrecision"
          shapeRendering="geometricPrecision"
          style={{position: "absolute", left: 0, top: 0}}
        >
          {/* Subtle Widescreen Spotlight & Studio Floor */}
          {hasAiBg ? null : <polygon points={`780,128 1140,128 1430,${floorY} 490,${floorY}`} fill={pal.glow} />}
          <rect x={0} y={floorY} width={lw} height={lh - floorY} fill={pal.floor} opacity={hasAiBg ? 0.45 : 1} />
          {minimalUi ? null : <line x1={0} y1={floorY} x2={lw} y2={floorY} stroke={pal.line} strokeWidth={5} />}
          <line x1={120} y1={floorY + 26} x2={lw - 120} y2={floorY + 26} stroke="rgba(255,255,255,0.08)" strokeWidth={2} />

          {/* Clean Original Top Widescreen Chapter Header Bar */}
          <g transform={`translate(${lw / 2}, 72)`} style={{display: minimalUi ? "none" : undefined}}>
            <rect
              x={-870}
              y={-52}
              width={1740}
              height={104}
              rx={22}
              fill="rgba(9, 21, 38, 0.9)"
              stroke="rgba(255, 214, 10, 0.5)"
              strokeWidth={3}
            />
            {/* Left Stat Pill */}
            <g transform="translate(-635, 2)">
              <rect x={-195} y={-24} width={390} height={48} rx={14} fill="#1E293B" stroke="#38BDF8" strokeWidth={2.5} />
              <text
                x={0}
                y={7}
                textAnchor="middle"
                fontFamily="Be Vietnam Pro, Inter, system-ui, sans-serif"
                {...fitSvgText(safeHeaderStatLeft, 390, 17, 28)}
                fontWeight={800}
                fill="#38BDF8"
              >
                {safeHeaderStatLeft}
              </text>
            </g>

            {/* Center Chapter Badge + Headline + Progress */}
            <rect x={-badgeW / 2} y={-44} width={badgeW} height={28} rx={14} fill="#FFD60A" />
            <text
              x={0}
              y={-25}
              textAnchor="middle"
              fontFamily="Be Vietnam Pro, Inter, system-ui, sans-serif"
              {...fitSvgText(badgeText, badgeW, 14.5, 24)}
              fontWeight={900}
              fill="#0F172A"
            >
              {badgeText}
            </text>
            <text
              x={0}
              y={14}
              textAnchor="middle"
              fontFamily="Be Vietnam Pro, Inter, system-ui, sans-serif"
              {...fitSvgText(safeHeaderTitle, 820, 26, 24)}
              fontWeight={900}
              fill="#FFFFFF"
            >
              {safeHeaderTitle}
            </text>
            <rect x={-230} y={29} width={460} height={10} rx={5} fill="#1E293B" />
            <rect x={-230} y={29} width={(460 * barPct) / 100} height={10} rx={5} fill="#22C55E" />

            {/* Right Stat Pill */}
            <g transform="translate(635, 2)">
              <rect x={-195} y={-24} width={390} height={48} rx={14} fill="#1E293B" stroke="#FFD60A" strokeWidth={2.5} />
              <text
                x={0}
                y={7}
                textAnchor="middle"
                fontFamily="Be Vietnam Pro, Inter, system-ui, sans-serif"
                {...fitSvgText(safeHeaderStatRight, 390, 17, 28)}
                fontWeight={800}
                fill="#FFD60A"
              >
                {safeHeaderStatRight}
              </text>
            </g>
          </g>

          {/* =========================================================================================
              CENTER VISUAL STAGE (x = 960, y = 520)
              Anchored at exact integer pixels with smooth opacity fade per Beat — ZERO text jitter!
             ========================================================================================= */}
          <g transform={`translate(${Math.round(lw / 2)}, 520)`} opacity={beatFadeOpacity} style={{display: minimalUi ? "none" : undefined}}>
            {currentCenterVisual === "ai_beat_svg" && cleanAiBeatSvg && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#38BDF8" strokeWidth={3.5} />
                <g transform="translate(0, 108) scale(1.12)">
                  <g dangerouslySetInnerHTML={{__html: cleanAiBeatSvg}} />
                </g>
                <rect x={-255} y={114} width={510} height={46} rx={12} fill="#FACC15" stroke="#111827" strokeWidth={2.5} />
                <text x={0} y={142} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "soda_zero_vs_sugar" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#38BDF8" strokeWidth={3.5} />
                {/* Left: Sleek Matte Black Zero-Calorie Soda Can + Fizzy Bubbles */}
                <g transform="translate(-155, -22)">
                  <rect x={-122} y={-135} width={244} height={210} rx={20} fill="#1E293B" stroke="#22C55E" strokeWidth={3.5} />
                  {/* Fizzy Carbonation Bubbles */}
                  {[-18, 4, 22].map((bx, idx) => (
                    <circle
                      key={bx}
                      cx={bx}
                      cy={-105 - (((f + idx * 9) * 0.4) % 16)}
                      r={4.5 - idx * 0.6}
                      fill="#BAE6FD"
                      stroke="#111827"
                      strokeWidth={2}
                    />
                  ))}
                  {/* Aluminum Can Body */}
                  <rect x={-44} y={-92} width={88} height={116} rx={14} fill="#090F1D" stroke="#111827" strokeWidth={3.5} />
                  <rect x={-40} y={-96} width={80} height={12} rx={5} fill="#CBD5E1" stroke="#111827" strokeWidth={2.5} />
                  <rect x={-44} y={-52} width={88} height={36} fill="#EF4444" stroke="#111827" strokeWidth={2.8} />
                  <text x={0} y={-28} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={19} fontWeight={900} fill="#FFFFFF">
                    ZERO
                  </text>
                  <rect x={-106} y={32} width={212} height={34} rx={9} fill="#22C55E" />
                  <text x={0} y={54} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynLeftLabel, 212, 12.5, 24)} fontWeight={900} fill="#0F172A">
                    {dynLeftLabel}
                  </text>
                </g>

                {/* Center VS Lightning Badge */}
                <circle cx={0} cy={-22} r={26} fill="#FACC15" stroke="#111827" strokeWidth={3.5} />
                <text x={0} y={-14} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={17} fontWeight={900} fill="#0F172A">
                  VS
                </text>

                {/* Right: Sugar Cubes / Sweetener Potency Meter */}
                <g transform="translate(155, -22)">
                  <rect x={-122} y={-135} width={244} height={210} rx={20} fill="#1E293B" stroke="#F43F5E" strokeWidth={3.5} />
                  {/* Stacked White Sugar Cubes + Crimson Regular Can */}
                  <rect x={-86} y={-88} width={66} height={96} rx={12} fill="#DC2626" stroke="#111827" strokeWidth={3} />
                  <rect x={-82} y={-92} width={58} height={10} rx={4} fill="#E2E8F0" stroke="#111827" strokeWidth={2} />
                  <text x={-53} y={-34} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={14} fontWeight={900} fill="#FEF08A">
                    COLA
                  </text>
                  {[0, 1, 2].map((row) =>
                    [0, 1].map((col) => (
                      <rect
                        key={`${row}_${col}`}
                        x={6 + col * 36}
                        y={-78 + row * 28}
                        width={30}
                        height={22}
                        rx={4}
                        fill="#F8FAFC"
                        stroke="#111827"
                        strokeWidth={2.5}
                      />
                    )),
                  )}
                  <rect x={-96} y={-124} width={192} height={30} rx={8} fill="#7F1D1D" stroke="#FCA5A5" strokeWidth={2} />
                  <text x={0} y={-104} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynMetricA !== "ĐIỂM CHÍNH" ? dynMetricA : "NGỌT ĐẬM", 192, 13, 20)} fontWeight={900} fill="#FEF08A">
                    {dynMetricA !== "ĐIỂM CHÍNH" ? dynMetricA : "NGỌT ĐẬM"}
                  </text>
                  <rect x={-106} y={32} width={212} height={34} rx={9} fill="#F43F5E" />
                  <text x={0} y={54} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynRightLabel, 212, 12.5, 24)} fontWeight={900} fill="#FFFFFF">
                    {dynRightLabel}
                  </text>
                </g>

                <rect x={-255} y={102} width={510} height={48} rx={14} fill="#FACC15" stroke="#111827" strokeWidth={2.5} />
                <text x={0} y={132} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "brain_taste_signal" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#A855F7" strokeWidth={3.5} />
                {/* Left: Sweet Taste Receptor on Tongue */}
                <g transform="translate(-170, -25)">
                  <rect x={-115} y={-125} width={230} height={198} rx={20} fill="#1E293B" stroke="#FB7185" strokeWidth={3.5} />
                  <path d="M -58 -35 Q 0 -62 58 -35 Q 52 18 0 24 Q -52 18 -58 -35 Z" fill="#FB7185" stroke="#111827" strokeWidth={3.5} />
                  <line x1={0} y1={-45} x2={0} y2={6} stroke="#BE123C" strokeWidth={3.5} strokeLinecap="round" />
                  {/* Sparkling Sweet Molecules */}
                  {[-32, 0, 32].map((sx, idx) => (
                    <circle
                      key={sx}
                      cx={sx}
                      cy={-72 + Math.sin(f * 0.14 + idx) * 5}
                      r={8}
                      fill="#FACC15"
                      stroke="#111827"
                      strokeWidth={2.5}
                    />
                  ))}
                  <rect x={-100} y={32} width={200} height={32} rx={8} fill="#FB7185" />
                  <text x={0} y={53} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynLeftLabel, 200, 12, 22)} fontWeight={900} fill="#0F172A">
                    {dynLeftLabel}
                  </text>
                </g>

                {/* Animated Neural Signal Wave */}
                <g transform="translate(0, -35)">
                  <polyline
                    points="-45,0 -22,-18 -4,16 14,-16 32,0"
                    fill="none"
                    stroke="#38BDF8"
                    strokeWidth={5.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <polygon points="30,-10 48,0 30,10" fill="#FACC15" />
                </g>

                {/* Right: Brain Expectation vs 0-Calorie Mismatch */}
                <g transform="translate(170, -25)">
                  <rect x={-115} y={-125} width={230} height={198} rx={20} fill="#1E293B" stroke="#A855F7" strokeWidth={3.5} />
                  {/* Stylized 2D Brain Lobes */}
                  <circle cx={-22} cy={-48} r={32} fill="#C084FC" stroke="#111827" strokeWidth={3.2} />
                  <circle cx={22} cy={-48} r={32} fill="#A855F7" stroke="#111827" strokeWidth={3.2} />
                  <circle cx={0} cy={-64} r={28} fill="#D8B4FE" stroke="#111827" strokeWidth={3} />
                  <path d="M -18 -50 Q 0 -36 18 -50" fill="none" stroke="#111827" strokeWidth={3} strokeLinecap="round" />
                  <rect x={-84} y={-114} width={168} height={28} rx={8} fill="#FACC15" stroke="#111827" strokeWidth={2} />
                  <text x={0} y={-95} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("LỆCH PHA NĂNG LƯỢNG", 168, 11.5, 22)} fontWeight={900} fill="#0F172A">
                    LỆCH PHA NĂNG LƯỢNG
                  </text>
                  <rect x={-100} y={32} width={200} height={32} rx={8} fill="#A855F7" />
                  <text x={0} y={53} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynRightLabel, 200, 12, 22)} fontWeight={900} fill="#FFFFFF">
                    {dynRightLabel}
                  </text>
                </g>

                <rect x={-255} y={102} width={510} height={48} rx={14} fill="#FACC15" stroke="#111827" strokeWidth={2.5} />
                <text x={0} y={132} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "gut_microbiome_lab" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#22C55E" strokeWidth={3.5} />
                {/* Left: Petri Dish / Gut Microbiome Ecosystem */}
                <g transform="translate(-155, -22)">
                  <rect x={-122} y={-132} width={244} height={206} rx={20} fill="#1E293B" stroke="#22C55E" strokeWidth={3.5} />
                  <circle cx={0} cy={-44} r={64} fill="#0F172A" stroke="#38BDF8" strokeWidth={4} />
                  <circle cx={0} cy={-44} r={52} fill="rgba(34, 197, 94, 0.14)" stroke="#22C55E" strokeWidth={2} strokeDasharray="6 4" />
                  {/* Animated Microbiome Rods & Cocci */}
                  <rect x={-32} y={-64} width={26} height={11} rx={5.5} transform={`rotate(${20 + Math.sin(f * 0.1) * 8} -19 -58)`} fill="#22C55E" stroke="#111827" strokeWidth={2} />
                  <rect x={8} y={-36} width={28} height={11} rx={5.5} transform={`rotate(${-25 + Math.cos(f * 0.1) * 8} 22 -30)`} fill="#F43F5E" stroke="#111827" strokeWidth={2} />
                  <circle cx={-16} cy={-26} r={9} fill="#FACC15" stroke="#111827" strokeWidth={2} />
                  <circle cx={20} cy={-62} r={8} fill="#38BDF8" stroke="#111827" strokeWidth={2} />
                  <rect x={-106} y={32} width={212} height={32} rx={8} fill="#22C55E" />
                  <text x={0} y={53} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynLeftLabel, 212, 12, 24)} fontWeight={900} fill="#0F172A">
                    {dynLeftLabel}
                  </text>
                </g>

                {/* Right: Blood Glucose / Clinical Trial Response Chart */}
                <g transform="translate(155, -22)">
                  <rect x={-122} y={-132} width={244} height={206} rx={20} fill="#1E293B" stroke="#F97316" strokeWidth={3.5} />
                  <rect x={-98} y={-114} width={196} height={30} rx={8} fill="#0F172A" stroke="#FACC15" strokeWidth={2} />
                  <text x={0} y={-94} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynMetricA !== "ĐIỂM CHÍNH" ? dynMetricA : "ĐƯỜNG HUYẾT", 196, 12.5, 22)} fontWeight={900} fill="#FACC15">
                    {dynMetricA !== "ĐIỂM CHÍNH" ? dynMetricA : "ĐƯỜNG HUYẾT"}
                  </text>
                  {/* Grid + Rising Glucose Curve */}
                  <line x1={-88} y1={12} x2={88} y2={12} stroke="#475569" strokeWidth={3} />
                  <line x1={-88} y1={-68} x2={-88} y2={12} stroke="#475569" strokeWidth={3} />
                  <polyline points="-80,4 -35,-12 12,-8 52,-46 82,-62" fill="none" stroke="#F43F5E" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
                  <polyline points="-80,4 -35,0 12,-4 52,-6 82,-8" fill="none" stroke="#38BDF8" strokeWidth={4} strokeDasharray="6 4" strokeLinecap="round" />
                  <circle cx={82} cy={-62} r={8} fill="#FACC15" stroke="#111827" strokeWidth={2.5} />
                  <rect x={-106} y={32} width={212} height={32} rx={8} fill="#F97316" />
                  <text x={0} y={53} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynRightLabel, 212, 12, 24)} fontWeight={900} fill="#0F172A">
                    {dynRightLabel}
                  </text>
                </g>

                <rect x={-255} y={102} width={510} height={48} rx={14} fill="#38BDF8" stroke="#111827" strokeWidth={2.5} />
                <text x={0} y={132} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "who_safety_gauge" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#FACC15" strokeWidth={3.5} />
                {/* Left: Safety Threshold / Risk Semicircle Gauge */}
                <g transform="translate(-155, -20)">
                  <rect x={-122} y={-132} width={244} height={204} rx={20} fill="#1E293B" stroke="#38BDF8" strokeWidth={3.5} />
                  <path d="M -78 -8 A 78 78 0 0 1 78 -8" fill="none" stroke="#334155" strokeWidth={18} strokeLinecap="round" />
                  <path d="M -78 -8 A 78 78 0 0 1 0 -86" fill="none" stroke="#22C55E" strokeWidth={18} strokeLinecap="round" />
                  <path d="M 0 -86 A 78 78 0 0 1 78 -8" fill="none" stroke="#EF4444" strokeWidth={18} strokeLinecap="round" />
                  <g transform={`translate(0, -8) rotate(${18 + Math.sin(f * 0.08) * 14})`}>
                    <line x1={0} y1={0} x2={0} y2={-62} stroke="#FACC15" strokeWidth={6} strokeLinecap="round" />
                    <circle cx={0} cy={0} r={10} fill="#FFFFFF" stroke="#111827" strokeWidth={3} />
                  </g>
                  <text x={0} y={20} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynMetricA !== "ĐIỂM CHÍNH" ? dynMetricA : "KHUYẾN NGHỊ", 190, 15, 20)} fontWeight={900} fill="#FACC15">
                    {dynMetricA !== "ĐIỂM CHÍNH" ? dynMetricA : "KHUYẾN NGHỊ"}
                  </text>
                  <rect x={-106} y={32} width={212} height={32} rx={8} fill="#38BDF8" />
                  <text x={0} y={53} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynLeftLabel, 212, 12, 24)} fontWeight={900} fill="#0F172A">
                    {dynLeftLabel}
                  </text>
                </g>

                {/* Right: Scientific Report Clipboard */}
                <g transform="translate(155, -20)">
                  <rect x={-122} y={-132} width={244} height={204} rx={20} fill="#1E293B" stroke="#FACC15" strokeWidth={3.5} />
                  <rect x={-88} y={-110} width={176} height={126} rx={12} fill="#F8FAFC" stroke="#111827" strokeWidth={3} />
                  <rect x={-38} y={-120} width={76} height={18} rx={6} fill="#64748B" stroke="#111827" strokeWidth={2.5} />
                  <rect x={-72} y={-90} width={144} height={24} rx={6} fill="#EF4444" />
                  <text x={0} y={-73} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynMetricB !== "ĐỐI CHIẾU" ? dynMetricB : "DỮ LIỆU Y TẾ", 144, 11.5, 18)} fontWeight={900} fill="#FFFFFF">
                    {dynMetricB !== "ĐỐI CHIẾU" ? dynMetricB : "DỮ LIỆU Y TẾ"}
                  </text>
                  <line x1={-68} y1={-50} x2={68} y2={-50} stroke="#334155" strokeWidth={5} strokeLinecap="round" />
                  <line x1={-68} y1={-30} x2={52} y2={-30} stroke="#334155" strokeWidth={5} strokeLinecap="round" />
                  <line x1={-68} y1={-10} x2={62} y2={-10} stroke="#0284C7" strokeWidth={5} strokeLinecap="round" />
                  <rect x={-106} y={32} width={212} height={32} rx={8} fill="#FACC15" />
                  <text x={0} y={53} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynRightLabel, 212, 12, 24)} fontWeight={900} fill="#0F172A">
                    {dynRightLabel}
                  </text>
                </g>

                <rect x={-255} y={102} width={510} height={48} rx={14} fill="#EF4444" stroke="#111827" strokeWidth={2.5} />
                <text x={0} y={132} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#FFFFFF">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "habit_water_bridge" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#22C55E" strokeWidth={3.5} />
                {/* 3 Stepping Stones: Sugary Soda -> Zero Bridge -> Pure Water & Fresh Fruit */}
                <g transform="translate(-198, -22)">
                  <rect x={-92} y={-115} width={184} height={185} rx={18} fill="#1E293B" stroke="#EF4444" strokeWidth={3.5} />
                  <rect x={-26} y={-82} width={52} height={74} rx={10} fill="#DC2626" stroke="#111827" strokeWidth={3} />
                  <rect x={-22} y={-86} width={44} height={9} rx={4} fill="#E2E8F0" stroke="#111827" strokeWidth={2} />
                  <text x={0} y={-40} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={12} fontWeight={900} fill="#FEF08A">
                    ĐƯỜNG
                  </text>
                  <rect x={-80} y={18} width={160} height={34} rx={8} fill="#EF4444" />
                  <text x={0} y={40} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("GIẢM DẦN", 160, 12, 18)} fontWeight={900} fill="#FFFFFF">
                    GIẢM DẦN
                  </text>
                </g>

                <polygon points="-92,-28 -74,-38 -74,-18" fill="#FACC15" transform="scale(-1, 1) translate(-166, 0)" />

                <g transform="translate(0, -22)">
                  <rect x={-92} y={-115} width={184} height={185} rx={18} fill="#1E293B" stroke="#FACC15" strokeWidth={3.5} />
                  <rect x={-26} y={-82} width={52} height={74} rx={10} fill="#0F172A" stroke="#111827" strokeWidth={3} />
                  <rect x={-26} y={-54} width={52} height={22} fill="#EF4444" />
                  <text x={0} y={-39} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={11.5} fontWeight={900} fill="#FFFFFF">
                    ZERO
                  </text>
                  <rect x={-80} y={18} width={160} height={34} rx={8} fill="#FACC15" />
                  <text x={0} y={40} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("CẦU TẠM", 160, 12, 18)} fontWeight={900} fill="#0F172A">
                    CẦU TẠM
                  </text>
                </g>

                <g transform="translate(198, -22)">
                  <rect x={-92} y={-115} width={184} height={185} rx={18} fill="#1E293B" stroke="#22C55E" strokeWidth={3.5} />
                  {/* Pure Water Bottle + Fresh Orange */}
                  <rect x={-36} y={-76} width={38} height={68} rx={9} fill="#BAE6FD" stroke="#111827" strokeWidth={2.8} />
                  <rect x={-27} y={-86} width={20} height={10} rx={3} fill="#0284C7" stroke="#111827" strokeWidth={2.2} />
                  <circle cx={26} cy={-28} r={22} fill="#FB923C" stroke="#111827" strokeWidth={2.8} />
                  <ellipse cx={32} cy={-52} rx={9} ry={5} transform="rotate(-25 32 -52)" fill="#22C55E" stroke="#111827" strokeWidth={2} />
                  <rect x={-80} y={18} width={160} height={34} rx={8} fill="#22C55E" />
                  <text x={0} y={40} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("NƯỚC LỌC · TỰ NHIÊN", 160, 11.5, 20)} fontWeight={900} fill="#0F172A">
                    NƯỚC LỌC · TỰ NHIÊN
                  </text>
                </g>

                <rect x={-255} y={102} width={510} height={48} rx={14} fill="#22C55E" stroke="#111827" strokeWidth={2.5} />
                <text x={0} y={132} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "dyn_versus_split" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#38BDF8" strokeWidth={3.5} />
                {/* Left Dynamic Aspect Card */}
                <g transform="translate(-158, -22)">
                  <rect x={-124} y={-130} width={248} height={202} rx={20} fill="#1E293B" stroke="#38BDF8" strokeWidth={3.5} />
                  <polygon points="-104,-108 104,-108 114,-72 -114,-72" fill="#0284C7" stroke="#111827" strokeWidth={3} />
                  <text x={0} y={-85} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(safeHeaderStatLeft || "GÓC NHÌN A", 208, 12.5, 24)} fontWeight={900} fill="#FFFFFF">
                    {safeHeaderStatLeft || "GÓC NHÌN A"}
                  </text>
                  <rect x={-96} y={-48} width={192} height={64} rx={12} fill="#0F172A" stroke="#38BDF8" strokeWidth={2.5} />
                  <text x={0} y={-9} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynMetricA, 184, 18, 22)} fontWeight={900} fill="#38BDF8">
                    {dynMetricA}
                  </text>
                  <rect x={-108} y={28} width={216} height={34} rx={9} fill="#38BDF8" />
                  <text x={0} y={50} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynLeftLabel, 216, 12.5, 24)} fontWeight={900} fill="#0F172A">
                    {dynLeftLabel}
                  </text>
                </g>

                <circle cx={0} cy={-22} r={26} fill="#FACC15" stroke="#111827" strokeWidth={3.5} />
                <text x={0} y={-14} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={17} fontWeight={900} fill="#0F172A">
                  VS
                </text>

                {/* Right Dynamic Aspect Card */}
                <g transform="translate(158, -22)">
                  <rect x={-124} y={-130} width={248} height={202} rx={20} fill="#1E293B" stroke="#F43F5E" strokeWidth={3.5} />
                  <polygon points="-104,-108 104,-108 114,-72 -114,-72" fill="#EF4444" stroke="#111827" strokeWidth={3} />
                  <text x={0} y={-85} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(safeHeaderStatRight || "GÓC NHÌN B", 208, 12.5, 24)} fontWeight={900} fill="#FFFFFF">
                    {safeHeaderStatRight || "GÓC NHÌN B"}
                  </text>
                  <rect x={-96} y={-48} width={192} height={64} rx={12} fill="#7F1D1D" stroke="#F87171" strokeWidth={2.5} />
                  <text x={0} y={-9} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynMetricB, 184, 18, 22)} fontWeight={900} fill="#FEF08A">
                    {dynMetricB}
                  </text>
                  <rect x={-108} y={28} width={216} height={34} rx={9} fill="#F43F5E" />
                  <text x={0} y={50} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynRightLabel, 216, 12.5, 24)} fontWeight={900} fill="#FFFFFF">
                    {dynRightLabel}
                  </text>
                </g>

                <rect x={-255} y={102} width={510} height={48} rx={14} fill="#FACC15" stroke="#111827" strokeWidth={2.5} />
                <text x={0} y={132} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "dyn_scale_paradox" && (
              <g>
                <rect x={-330} y={-205} width={660} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#FACC15" strokeWidth={3.5} />
                {/* 2D Balance Pedestal */}
                <polygon points="0,-58 38,84 -38,84" fill="#64748B" stroke="#111827" strokeWidth={3.5} />
                <rect x={-110} y={84} width={220} height={18} rx={9} fill="#475569" stroke="#111827" strokeWidth={3} />
                {/* Tilted Scale Beam with Upright Horizontal Gravity-Hung Pans (Crisp Zero-Jitter Text!) */}
                <line x1={-184} y1={-84} x2={184} y2={-32} stroke="#FACC15" strokeWidth={9} strokeLinecap="round" />
                <circle cx={0} cy={-58} r={11} fill="#FACC15" stroke="#111827" strokeWidth={3} />
                {/* Left Pan (Higher, Upright Horizontal) */}
                <g transform="translate(-184, -84)">
                  <line x1={0} y1={0} x2={-36} y2={44} stroke="#94A3B8" strokeWidth={3} />
                  <line x1={0} y1={0} x2={36} y2={44} stroke="#94A3B8" strokeWidth={3} />
                  <rect x={-104} y={44} width={208} height={46} rx={11} fill="#22C55E" stroke="#111827" strokeWidth={3} />
                  <text x={0} y={73} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynLeftLabel, 204, 12.5, 24)} fontWeight={900} fill="#0F172A">
                    {dynLeftLabel}
                  </text>
                </g>
                {/* Right Pan (Lower, Upright Horizontal) */}
                <g transform="translate(184, -32)">
                  <line x1={0} y1={0} x2={-38} y2={44} stroke="#94A3B8" strokeWidth={3} />
                  <line x1={0} y1={0} x2={38} y2={44} stroke="#94A3B8" strokeWidth={3} />
                  <rect x={-108} y={44} width={216} height={48} rx={11} fill="#EF4444" stroke="#111827" strokeWidth={3} />
                  <text x={0} y={74} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynRightLabel, 210, 12.5, 24)} fontWeight={900} fill="#FFFFFF">
                    {dynRightLabel}
                  </text>
                </g>
                <rect x={-255} y={114} width={510} height={46} rx={12} fill="#FACC15" stroke="#111827" strokeWidth={2.5} />
                <text x={0} y={142} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "dyn_mechanism_flow" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#38BDF8" strokeWidth={3.5} />
                {[
                  {dx: -200, step: "BƯỚC 1", label: dynLeftLabel, c: "#38BDF8"},
                  {dx: 0, step: "CƠ CHẾ", label: dynMetricA !== "ĐIỂM CHÍNH" ? dynMetricA : (safeHeaderStatLeft || "TÁC ĐỘNG"), c: "#FACC15"},
                  {dx: 200, step: "HỆ QUẢ", label: dynTailLabel, c: "#F43F5E"},
                ].map((node, idx) => (
                  <g key={node.step} transform={`translate(${node.dx}, -25)`}>
                    <rect x={-86} y={-108} width={172} height={182} rx={18} fill="#1E293B" stroke={node.c} strokeWidth={3.5} />
                    <circle cx={0} cy={-52} r={28} fill="rgba(15, 23, 42, 0.9)" stroke={node.c} strokeWidth={3.5} />
                    <text x={0} y={-44} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={20} fontWeight={900} fill={node.c}>
                      {`0${idx + 1}`}
                    </text>
                    <rect x={-78} y={6} width={156} height={44} rx={10} fill={node.c} />
                    <text x={0} y={33} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(node.label, 152, 12, 22)} fontWeight={900} fill={idx === 2 ? "#FFFFFF" : "#0F172A"}>
                      {node.label}
                    </text>
                  </g>
                ))}
                {/* Connecting Flow Arrows */}
                {[-100, 100].map((ax) => (
                  <g key={ax} transform={`translate(${ax + Math.sin(f * 0.14) * 4}, -25)`}>
                    <line x1={-12} y1={0} x2={8} y2={0} stroke="#FACC15" strokeWidth={6} strokeLinecap="round" />
                    <polygon points="6,-10 20,0 6,10" fill="#FACC15" />
                  </g>
                ))}
                <rect x={-255} y={102} width={510} height={48} rx={14} fill="#38BDF8" stroke="#111827" strokeWidth={2.5} />
                <text x={0} y={132} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "dyn_audit_scanner" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#22C55E" strokeWidth={3.5} />
                {[
                  {dx: -198, tag: dynLeftLabel, sub: safeHeaderStatLeft || "Dữ kiện 1", color: "#38BDF8", kind: 0},
                  {dx: 0, tag: dynMetricA !== "ĐIỂM CHÍNH" ? dynMetricA : "ĐỐI CHIẾU", sub: "Phân tích thực tế", color: "#FACC15", kind: 1},
                  {dx: 198, tag: dynRightLabel, sub: safeHeaderStatRight || "Dữ kiện 2", color: "#22C55E", kind: 2},
                ].map((card) => (
                  <g key={card.dx} transform={`translate(${card.dx}, -25)`}>
                    <rect x={-88} y={-108} width={176} height={184} rx={18} fill="#1E293B" stroke={card.color} strokeWidth={3.5} />
                    {/* Clean 2D Geometric Emblem */}
                    {card.kind === 0 ? (
                      <g transform="translate(0, -52)">
                        <rect x={-28} y={-20} width={56} height={40} rx={6} fill="#0F172A" stroke="#38BDF8" strokeWidth={3} />
                        <line x1={-16} y1={-8} x2={16} y2={-8} stroke="#38BDF8" strokeWidth={4} strokeLinecap="round" />
                        <line x1={-16} y1={6} x2={8} y2={6} stroke="#FACC15" strokeWidth={4} strokeLinecap="round" />
                      </g>
                    ) : card.kind === 1 ? (
                      <g transform="translate(0, -52)">
                        <rect x={-22} y={-4} width={11} height={24} rx={2} fill="#38BDF8" />
                        <rect x={-5} y={-14} width={11} height={34} rx={2} fill="#FACC15" />
                        <rect x={12} y={-24} width={11} height={44} rx={2} fill="#22C55E" />
                      </g>
                    ) : (
                      <g transform="translate(0, -52)">
                        <circle cx={0} cy={0} r={22} fill="rgba(34,197,94,0.2)" stroke="#22C55E" strokeWidth={3.5} />
                        <polyline points="-10,1 -2,9 11,-8" fill="none" stroke="#22C55E" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
                      </g>
                    )}
                    <rect x={-78} y={0} width={156} height={36} rx={9} fill={card.color} />
                    <text x={0} y={23} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(card.tag, 152, 12, 22)} fontWeight={900} fill="#0F172A">
                      {card.tag}
                    </text>
                    <text x={0} y={56} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(card.sub, 162, 11.5, 22)} fontWeight={700} fill="#CBD5E1">
                      {card.sub}
                    </text>
                  </g>
                ))}
                <g transform={`translate(${Math.sin(f * 0.055) * 165}, -76)`}>
                  <circle cx={0} cy={0} r={30} fill="rgba(56, 189, 248, 0.22)" stroke="#38BDF8" strokeWidth={5.5} />
                  <line x1={21} y1={21} x2={42} y2={42} stroke="#FACC15" strokeWidth={9} strokeLinecap="round" />
                </g>
                <rect x={-255} y={102} width={510} height={48} rx={14} fill="#22C55E" stroke="#111827" strokeWidth={2.5} />
                <text x={0} y={132} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "dyn_calculator_data" && (
              <g>
                <rect x={-330} y={-205} width={660} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#FACC15" strokeWidth={3.5} />
                {/* Left: 2D Data Meter & Animated Columns */}
                <g transform="translate(-152, -22)">
                  <rect x={-112} y={-125} width={224} height={198} rx={20} fill="#1E293B" stroke="#38BDF8" strokeWidth={3.5} />
                  <rect x={-92} y={-102} width={184} height={46} rx={10} fill="#0F172A" stroke="#22C55E" strokeWidth={2.5} />
                  <text x={0} y={-73} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynMetricA, 178, 17.5, 20)} fontWeight={900} fill="#22C55E">
                    {dynMetricA}
                  </text>
                  {[-56, -18, 20, 58].map((bx, idx) => {
                    const colH = 38 + idx * 18;
                    return (
                      <rect
                        key={bx}
                        x={bx - 13}
                        y={52 - colH}
                        width={26}
                        height={colH}
                        rx={5}
                        fill={idx === 3 ? "#F43F5E" : idx === 2 ? "#FACC15" : "#38BDF8"}
                        stroke="#111827"
                        strokeWidth={2.2}
                      />
                    );
                  })}
                </g>
                {/* Right: Two Dynamic Insight Cards */}
                <g transform="translate(136, -22)">
                  <rect x={-130} y={-120} width={260} height={86} rx={14} fill="#0F172A" stroke="#38BDF8" strokeWidth={3} />
                  <text x={0} y={-88} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(safeHeaderStatLeft || "THÔNG SỐ A", 244, 12, 24)} fontWeight={900} fill="#38BDF8">
                    {safeHeaderStatLeft || "THÔNG SỐ A"}
                  </text>
                  <text x={0} y={-54} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynLeftLabel, 244, 15.5, 24)} fontWeight={900} fill="#FFFFFF">
                    {dynLeftLabel}
                  </text>
                  <rect x={-130} y={-14} width={260} height={86} rx={14} fill="#065F46" stroke="#22C55E" strokeWidth={3} />
                  <text x={0} y={18} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(safeHeaderStatRight || "THÔNG SỐ B", 244, 12, 24)} fontWeight={900} fill="#86EFAC">
                    {safeHeaderStatRight || "THÔNG SỐ B"}
                  </text>
                  <text x={0} y={52} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynRightLabel, 244, 15.5, 24)} fontWeight={900} fill="#FEF08A">
                    {dynRightLabel}
                  </text>
                </g>
                <rect x={-255} y={102} width={510} height={48} rx={14} fill="#FACC15" stroke="#111827" strokeWidth={2.5} />
                <text x={0} y={132} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "dyn_action_roadmap" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#FACC15" strokeWidth={3.5} />
                {[
                  {x: -195, y: 12, w: 176, h: 86, head: "ĐIỂM 1", sub: dynLeftLabel, c: "#38BDF8"},
                  {x: 0, y: -18, w: 176, h: 126, head: "ĐIỂM 2", sub: dynRightLabel, c: "#FACC15"},
                  {x: 195, y: -48, w: 176, h: 166, head: "CHỐT LẠI", sub: dynTailLabel, c: "#22C55E"},
                ].map((st) => (
                  <g key={st.head} transform={`translate(${st.x}, ${st.y})`}>
                    <rect x={-st.w / 2} y={-st.h / 2} width={st.w} height={st.h} rx={14} fill="#1E293B" stroke={st.c} strokeWidth={3.5} />
                    <rect x={-st.w / 2 + 10} y={-st.h / 2 + 10} width={st.w - 20} height={30} rx={8} fill={st.c} />
                    <text x={0} y={-st.h / 2 + 30} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(st.head, st.w - 20, 12, 18)} fontWeight={900} fill="#0F172A">
                      {st.head}
                    </text>
                    <text x={0} y={18} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(st.sub, st.w - 18, 12, 22)} fontWeight={800} fill="#F8FAFC">
                      {st.sub}
                    </text>
                  </g>
                ))}
                <rect x={-255} y={102} width={510} height={48} rx={14} fill="#FACC15" stroke="#111827" strokeWidth={2.5} />
                <text x={0} y={132} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "gold_vault_9999" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#FACC15" strokeWidth={3.5} />
                {/* Stacked 2D Gold Bullion Bars & Purity Assay Meter */}
                <g transform="translate(-145, -15)">
                  <polygon points="-112,35 112,35 90,-20 -90,-20" fill="#FACC15" stroke="#111827" strokeWidth={3.5} />
                  <polygon points="-84,-22 84,-22 66,-72 -66,-72" fill="#FDE047" stroke="#111827" strokeWidth={3.5} />
                  <text x={0} y={-38} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={19} fontWeight={900} fill="#0F172A">
                    999.9
                  </text>
                  <text x={0} y={15} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynLeftLabel, 180, 12.5, 22)} fontWeight={900} fill="#78350F">
                    {dynLeftLabel}
                  </text>
                </g>
                <g transform="translate(145, -15)">
                  <rect x={-122} y={-105} width={244} height={175} rx={18} fill="#1E293B" stroke="#38BDF8" strokeWidth={3.5} />
                  <text x={0} y={-52} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynMetricA !== "MẤU CHỐT" ? dynMetricA : "99.99%", 224, 22, 22)} fontWeight={900} fill="#FACC15">
                    {dynMetricA !== "MẤU CHỐT" ? dynMetricA : "99.99%"}
                  </text>
                  <text x={0} y={-12} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynRightLabel, 224, 13, 24)} fontWeight={800} fill="#E2E8F0">
                    {dynRightLabel}
                  </text>
                  <rect x={-96} y={14} width={192} height={34} rx={8} fill="#22C55E" />
                  <text x={0} y={36} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("CHUẨN QUỐC TẾ", 192, 12, 24)} fontWeight={900} fill="#0F172A">
                    CHUẨN QUỐC TẾ
                  </text>
                </g>
                <rect x={-255} y={96} width={510} height={48} rx={14} fill="#FACC15" />
                <text x={0} y={125} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "qwerty_keyboard" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#38BDF8" strokeWidth={3.5} />
                {/* 2D Mechanical Keyboard Keycaps */}
                <rect x={-255} y={-135} width={510} height={195} rx={18} fill="#1E293B" stroke="#94A3B8" strokeWidth={3.5} />
                {["Q", "W", "E", "R", "T", "Y"].map((k, idx) => (
                  <g key={k} transform={`translate(${-195 + idx * 78}, ${-75 + (idx % 2 === 0 ? -2 : 2)})`}>
                    <rect x={-30} y={-28} width={60} height={56} rx={10} fill="#FACC15" stroke="#111827" strokeWidth={3} />
                    <text x={0} y={8} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={22} fontWeight={900} fill="#0F172A">
                      {k}
                    </text>
                  </g>
                ))}
                <rect x={-215} y={-4} width={430} height={42} rx={10} fill="#38BDF8" stroke="#111827" strokeWidth={3} />
                <text x={0} y={22} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(`${dynLeftLabel} · ${dynRightLabel}`, 430, 13, 26)} fontWeight={900} fill="#0F172A">
                  {dynLeftLabel} · {dynRightLabel}
                </text>
                <rect x={-255} y={96} width={510} height={48} rx={14} fill="#FACC15" />
                <text x={0} y={125} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "bank_tax_transfer" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#38BDF8" strokeWidth={3.5} />
                {/* Left: Banking App Transfer Screen */}
                <g transform="translate(-155, -20)">
                  <rect x={-105} y={-115} width={210} height={205} rx={20} fill="#1E293B" stroke="#38BDF8" strokeWidth={4} />
                  <rect x={-90} y={-82} width={180} height={42} rx={8} fill="#065F46" />
                  <text x={0} y={-56} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(`+${dynMetricA !== "MẤU CHỐT" ? dynMetricA : "CHUYỂN KHOẢN"}`, 180, 12.5, 22)} fontWeight={900} fill="#34D399">
                    +{dynMetricA !== "MẤU CHỐT" ? dynMetricA : "CHUYỂN KHOẢN"}
                  </text>
                  <text x={0} y={6} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynLeftLabel, 195, 12.5, 22)} fontWeight={800} fill="#E2E8F0">
                    {dynLeftLabel}
                  </text>
                </g>
                {/* Animated Transfer Arrow */}
                <g transform={`translate(${Math.sin(f * 0.1) * 6}, -20)`}>
                  <line x1={-25} y1={0} x2={25} y2={0} stroke="#FACC15" strokeWidth={7} strokeLinecap="round" />
                  <polygon points="18,-14 40,0 18,14" fill="#FACC15" />
                </g>
                {/* Right: Tax / Audit Radar */}
                <g transform="translate(155, -20)">
                  <rect x={-115} y={-115} width={230} height={205} rx={20} fill="#1E293B" stroke="#F43F5E" strokeWidth={4} />
                  <circle cx={0} cy={-35} r={42} fill="rgba(244,63,94,0.2)" stroke="#F43F5E" strokeWidth={3.5} />
                  <text x={0} y={-28} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("SAO KÊ", 78, 15, 14)} fontWeight={900} fill="#FACC15">
                    SAO KÊ
                  </text>
                  <text x={0} y={42} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynRightLabel, 210, 12.5, 22)} fontWeight={800} fill="#FFFFFF">
                    {dynRightLabel}
                  </text>
                </g>
                <rect x={-255} y={96} width={510} height={48} rx={14} fill="#FACC15" />
                <text x={0} y={125} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "diderot_chain" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#A855F7" strokeWidth={3.5} />
                {[
                  {dx: -195, icon: "🧥", tag: dynLeftLabel, c: "#38BDF8"},
                  {dx: 0, icon: "👟", tag: "MUA KÈM THÊM", c: "#FACC15"},
                  {dx: 195, icon: "💸", tag: dynRightLabel, c: "#F43F5E"},
                ].map((item, idx) => (
                  <g key={idx} transform={`translate(${item.dx}, -25)`}>
                    <rect x={-88} y={-95} width={176} height={170} rx={18} fill="#1E293B" stroke={item.c} strokeWidth={3.5} />
                    <text x={0} y={-18} textAnchor="middle" fontSize={46}>
                      {item.icon}
                    </text>
                    <rect x={-80} y={18} width={160} height={38} rx={9} fill={item.c} />
                    <text x={0} y={42} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(item.tag, 160, 11.5, 22)} fontWeight={900} fill="#0F172A">
                      {item.tag}
                    </text>
                  </g>
                ))}
                <rect x={-255} y={96} width={510} height={48} rx={14} fill="#A855F7" />
                <text x={0} y={125} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 510, 15, 28)} fontWeight={900} fill="#FFFFFF">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "boba_kiosk" && (
              <g>
                <rect x={-325} y={-205} width={650} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#38BDF8" strokeWidth={3.5} />
                {/* 2D Street Kiosk Roof & Striped Awning */}
                <polygon points="-255,-165 255,-165 275,-112 -275,-112" fill="#EF4444" stroke="#111827" strokeWidth={3.5} />
                {[-200, -100, 0, 100, 200].map((sx) => (
                  <rect key={sx} x={sx - 24} y={-162} width={48} height={48} rx={4} fill="#FEF08A" />
                ))}
                {/* Hanging Lanterns & Menu Sign */}
                <circle cx={-215} cy={-90} r={16} fill="#FACC15" stroke="#111827" strokeWidth={3} />
                <circle cx={215} cy={-90} r={16} fill="#FACC15" stroke="#111827" strokeWidth={3} />
                <rect x={-150} y={-105} width={300} height={34} rx={8} fill="#0F172A" stroke="#FACC15" strokeWidth={2.5} />
                <text x={0} y={-83} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynLeftLabel, 300, 12.5, 24)} fontWeight={900} fill="#FACC15">
                  {dynLeftLabel}
                </text>
                {/* Kiosk Counter + Cup Sealer Machine + Cash Register */}
                <rect x={-250} y={12} width={500} height={115} rx={12} fill="#0284C7" stroke="#111827" strokeWidth={3.5} />
                <rect x={-260} y={-4} width={520} height={20} rx={8} fill="#F8FAFC" stroke="#111827" strokeWidth={3} />
                {/* Cup Sealer Machine on Left */}
                <rect x={-195} y={-76} width={72} height={74} rx={8} fill="#334155" stroke="#111827" strokeWidth={3} />
                <circle cx={-159} cy={-48} r={15} fill="#38BDF8" stroke="#111827" strokeWidth={2.5} />
                <circle cx={-159} cy={-18} r={6} fill="#22C55E" />
                {/* 3 Detailed Boba Cups with Straws & Pearls */}
                {[-55, 25, 105].map((cx, idx) => (
                  <g key={cx} transform={`translate(${cx}, ${-36 + Math.sin(f * 0.09 + idx) * 3})`}>
                    <polygon points="-20,-32 20,-32 14,30 -14,30" fill="#FDE68A" stroke="#111827" strokeWidth={3} />
                    <rect x={-24} y={-38} width={48} height={8} rx={4} fill="#FFFFFF" stroke="#111827" strokeWidth={2.5} />
                    <line x1={3} y1={-38} x2={10} y2={-58} stroke="#EF4444" strokeWidth={4.5} strokeLinecap="round" />
                    <circle cx={-6} cy={18} r={4} fill="#111827" />
                    <circle cx={5} cy={20} r={4} fill="#111827" />
                    <circle cx={0} cy={11} r={4} fill="#111827" />
                  </g>
                ))}
                {/* Dynamic Sentence Banner on Counter */}
                <rect x={-235} y={42} width={470} height={54} rx={14} fill="#FACC15" stroke="#111827" strokeWidth={3} />
                <text x={0} y={74} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(dynBanner, 470, 15, 28)} fontWeight={900} fill="#0F172A">
                  {dynBanner}
                </text>
              </g>
            )}

            {currentCenterVisual === "printer_ink" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#FACC15" strokeWidth={3.5} />
                {/* Left: Detailed 2D Office Printer with Ejecting Paper */}
                <g transform="translate(-170, -15)">
                  <rect x={-120} y={-125} width={240} height={225} rx={20} fill="#1E293B" stroke="#38BDF8" strokeWidth={3.5} />
                  {/* Top Paper Feed */}
                  <polygon points="-55,-105 55,-105 65,-52 -65,-52" fill="#F8FAFC" stroke="#111827" strokeWidth={3} />
                  <line x1={-40} y1={-85} x2={40} y2={-85} stroke="#94A3B8" strokeWidth={4} strokeLinecap="round" />
                  <line x1={-40} y1={-70} x2={25} y2={-70} stroke="#94A3B8" strokeWidth={4} strokeLinecap="round" />
                  {/* Printer Body */}
                  <rect x={-92} y={-55} width={184} height={74} rx={14} fill="#0284C7" stroke="#111827" strokeWidth={3.5} />
                  <rect x={-68} y={-35} width={95} height={18} rx={5} fill="#0F172A" />
                  <circle cx={52} cy={-26} r={8} fill="#22C55E" />
                  <circle cx={72} cy={-26} r={6} fill="#FACC15" />
                  {/* Output Paper Tray */}
                  <polygon points="-60,19 60,19 72,46 -72,46" fill="#FFFFFF" stroke="#111827" strokeWidth={3} />
                  <rect x={-106} y={52} width={212} height={38} rx={10} fill="#22C55E" />
                  <text x={0} y={76} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("MÁY IN BÁN RẺ", 212, 13.5, 24)} fontWeight={900} fill="#0F172A">
                    MÁY IN BÁN RẺ
                  </text>
                </g>
                {/* Center Animated Golden Arrow */}
                <g transform={`translate(${Math.sin(f * 0.1) * 6}, -15)`}>
                  <line x1={-28} y1={0} x2={22} y2={0} stroke="#FACC15" strokeWidth={8} strokeLinecap="round" />
                  <polygon points="18,-15 42,0 18,15" fill="#FACC15" />
                </g>
                {/* Right: Detailed Ink Bottles with Nozzles, Drops & Golden Coins */}
                <g transform="translate(170, -15)">
                  <rect x={-120} y={-125} width={240} height={225} rx={20} fill="#1E293B" stroke="#F43F5E" strokeWidth={3.5} />
                  {[-52, 42].map((bx, idx) => (
                    <g key={bx} transform={`translate(${bx}, -25)`}>
                      {/* Bottle Nozzle & Cap */}
                      <polygon points="-10,-68 10,-68 6,-88 -6,-88" fill="#FACC15" stroke="#111827" strokeWidth={2.5} />
                      <rect x={-16} y={-68} width={32} height={12} rx={4} fill="#334155" stroke="#111827" strokeWidth={2.5} />
                      {/* Ink Bottle Body with Window Gauge */}
                      <rect x={-32} y={-56} width={64} height={86} rx={12} fill={idx === 0 ? "#F43F5E" : "#A855F7"} stroke="#111827" strokeWidth={3} />
                      <rect x={-22} y={-38} width={44} height={50} rx={6} fill="#0F172A" />
                      <text x={0} y={-6} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={14} fontWeight={900} fill="#FACC15">
                        3X$
                      </text>
                    </g>
                  ))}
                  <rect x={-106} y={52} width={212} height={38} rx={10} fill="#F43F5E" />
                  <text x={0} y={76} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("HỘP MỰC ĐẮT ĐỎ", 212, 13.5, 24)} fontWeight={900} fill="#FFFFFF">
                    HỘP MỰC ĐẮT ĐỎ
                  </text>
                </g>
              </g>
            )}

            {currentCenterVisual === "contract_lock" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#F43F5E" strokeWidth={3.5} />
                {/* Left: Detailed Legal Contract Clipboard */}
                <g transform="translate(-142, -15)">
                  <rect x={-122} y={-135} width={220} height={260} rx={14} fill="#FEF9C3" stroke="#111827" strokeWidth={3.5} />
                  <rect x={-50} y={-148} width={76} height={24} rx={8} fill="#64748B" stroke="#111827" strokeWidth={3} />
                  <rect x={-108} y={-102} width={192} height={26} rx={6} fill="#EF4444" />
                  <text x={-12} y={-85} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("ĐIỀU KHOẢN ĐỘC QUYỀN", 192, 11, 20)} fontWeight={900} fill="#FFFFFF">
                    ĐIỀU KHOẢN ĐỘC QUYỀN
                  </text>
                  <line x1={-95} y1={-60} x2={60} y2={-60} stroke="#334155" strokeWidth={6} strokeLinecap="round" />
                  <line x1={-95} y1={-34} x2={45} y2={-34} stroke="#334155" strokeWidth={6} strokeLinecap="round" />
                  <line x1={-95} y1={-8} x2={60} y2={-8} stroke="#EF4444" strokeWidth={6} strokeLinecap="round" />
                  <line x1={-95} y1={18} x2={30} y2={18} stroke="#334155" strokeWidth={6} strokeLinecap="round" />
                  {/* Wax Seal Stamp */}
                  <circle cx={36} cy={72} r={28} fill="rgba(239,68,68,0.22)" stroke="#EF4444" strokeWidth={4} />
                  <text x={36} y={77} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("ĐÃ KÝ", 54, 11.5, 10)} fontWeight={900} fill="#EF4444">
                    ĐÃ KÝ
                  </text>
                </g>
                {/* Right: Ingredient Sacks Well Separated From Center Padlock */}
                <g transform="translate(138, -15)">
                  {/* 2 Ingredient Sacks Positioned Clear of Padlock */}
                  <rect x={-130} y={-98} width={88} height={112} rx={16} fill="#D97706" stroke="#111827" strokeWidth={3} />
                  <text x={-86} y={-55} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("BỘT TRÀ", 88, 12, 16)} fontWeight={900} fill="#FEF08A">
                    BỘT TRÀ
                  </text>
                  <rect x={42} y={-98} width={88} height={112} rx={16} fill="#7C3AED" stroke="#111827" strokeWidth={3} />
                  <text x={86} y={-55} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("SYRUP", 88, 12, 16)} fontWeight={900} fill="#FEF08A">
                    SYRUP
                  </text>
                  {/* Golden Padlock Locking Both Sacks */}
                  <path d="M -24 -22 L -24 -52 A 24 24 0 0 1 24 -52 L 24 -22" fill="none" stroke="#FACC15" strokeWidth={11} strokeLinecap="round" />
                  <rect x={-42} y={-24} width={84} height={76} rx={15} fill="#FACC15" stroke="#111827" strokeWidth={3.5} />
                  <circle cx={0} cy={6} r={10} fill="#0F172A" />
                  <rect x={-4.5} y={6} width={9} height={20} rx={4} fill="#0F172A" />
                  <rect x={-128} y={76} width={256} height={44} rx={12} fill="#EF4444" />
                  <text x={0} y={103} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("TRÓI NGUỒN NGUYÊN LIỆU", 256, 13, 24)} fontWeight={900} fill="#FFFFFF">
                    TRÓI NGUỒN NGUYÊN LIỆU
                  </text>
                </g>
              </g>
            )}

            {currentCenterVisual === "market_compare" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#38BDF8" strokeWidth={3.5} />
                {/* Left: Open Wholesale Market Stall (1X Price) */}
                <g transform="translate(-162, -10)">
                  <rect x={-128} y={-130} width={256} height={240} rx={20} fill="#1E293B" stroke="#22C55E" strokeWidth={3.5} />
                  <polygon points="-112,-105 112,-105 122,-70 -122,-70" fill="#22C55E" stroke="#111827" strokeWidth={3} />
                  <text x={0} y={-83} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("CHỢ ĐẦU MỐI TỰ DO", 220, 12.5, 24)} fontWeight={900} fill="#0F172A">
                    CHỢ ĐẦU MỐI TỰ DO
                  </text>
                  <rect x={-92} y={-45} width={184} height={70} rx={12} fill="#065F46" stroke="#34D399" strokeWidth={2.5} />
                  <text x={0} y={-4} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("GIÁ GỐC 1X", 184, 20, 24)} fontWeight={900} fill="#FEF08A">
                    GIÁ GỐC 1X
                  </text>
                  <rect x={-108} y={45} width={216} height={42} rx={10} fill="#22C55E" />
                  <text x={0} y={71} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("LÃI CAO · TỰ CHỦ", 216, 13, 24)} fontWeight={900} fill="#0F172A">
                    LÃI CAO · TỰ CHỦ
                  </text>
                </g>
                {/* VS Badge */}
                <circle cx={0} cy={-10} r={26} fill="#FACC15" stroke="#111827" strokeWidth={3.5} />
                <text x={0} y={-2} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={17} fontWeight={900} fill="#0F172A">
                  VS
                </text>
                {/* Right: Locked Brand Warehouse (2.5X Price) */}
                <g transform="translate(162, -10)">
                  <rect x={-128} y={-130} width={256} height={240} rx={20} fill="#1E293B" stroke="#EF4444" strokeWidth={3.5} />
                  <polygon points="-112,-105 112,-105 122,-70 -122,-70" fill="#EF4444" stroke="#111827" strokeWidth={3} />
                  <text x={0} y={-83} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("KHO HÃNG ĐỘC QUYỀN", 220, 12.5, 24)} fontWeight={900} fill="#FFFFFF">
                    KHO HÃNG ĐỘC QUYỀN
                  </text>
                  <rect x={-92} y={-45} width={184} height={70} rx={12} fill="#7F1D1D" stroke="#F87171" strokeWidth={2.5} />
                  <text x={0} y={-4} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("GIÁ ÉP 2.5X", 184, 20, 24)} fontWeight={900} fill="#FEF08A">
                    GIÁ ÉP 2.5X
                  </text>
                  <rect x={-108} y={45} width={216} height={42} rx={10} fill="#EF4444" />
                  <text x={0} y={71} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("BỊ ĂN CHÊNH LỆCH", 216, 13, 24)} fontWeight={900} fill="#FFFFFF">
                    BỊ ĂN CHÊNH LỆCH
                  </text>
                </g>
              </g>
            )}

            {currentCenterVisual === "conveyor_profit" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#22C55E" strokeWidth={3.5} />
                {/* Scanner Arch in Center */}
                <rect x={-76} y={-145} width={152} height={165} rx={14} fill="rgba(56, 189, 248, 0.2)" stroke="#38BDF8" strokeWidth={3.5} />
                <text x={0} y={-118} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("TRẠM THU LỜI", 152, 11.5, 20)} fontWeight={900} fill="#38BDF8">
                  TRẠM THU LỜI
                </text>
                {/* Conveyor Belt Track & Spinning Rollers */}
                <rect x={-275} y={12} width={550} height={44} rx={22} fill="#334155" stroke="#111827" strokeWidth={4} />
                {[-215, -110, 0, 110, 215].map((wx) => (
                  <circle key={wx} cx={wx} cy={34} r={14} fill="#94A3B8" stroke="#111827" strokeWidth={3} />
                ))}
                {/* Moving Ingredient Crates Turning Into Cash Stacks */}
                {[-180, -30, 120].map((baseX, idx) => {
                  const moveX = ((baseX + f * 1.2 + 240) % 480) - 240;
                  const isMoney = moveX > 15;
                  const crateTxt = isMoney ? "+LÃI HÃNG" : "BỘT & LY";
                  return (
                    <g key={idx} transform={`translate(${moveX}, -34)`}>
                      <rect
                        x={-58}
                        y={-42}
                        width={116}
                        height={74}
                        rx={12}
                        fill={isMoney ? "#22C55E" : "#F97316"}
                        stroke="#111827"
                        strokeWidth={3.5}
                      />
                      <text x={0} y={-6} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={22} fontWeight={900} fill="#FFFFFF">
                        {isMoney ? "💵" : "📦"}
                      </text>
                      <text x={0} y={20} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(crateTxt, 116, 10.5, 18)} fontWeight={900} fill="#0F172A">
                        {crateTxt}
                      </text>
                    </g>
                  );
                })}
                <rect x={-235} y={82} width={470} height={50} rx={14} fill="#22C55E" stroke="#111827" strokeWidth={3} />
                <text x={0} y={113} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("CỖ MÁY THU LỜI TRỌN ĐỜI", 470, 15.5, 28)} fontWeight={900} fill="#0F172A">
                  CỖ MÁY THU LỜI TRỌN ĐỜI
                </text>
              </g>
            )}

            {currentCenterVisual === "cup_cost_layers" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#FACC15" strokeWidth={3.5} />
                {/* Giant Cross-Section Boba Cup on Left */}
                <g transform="translate(-145, 5)">
                  <line x1={15} y1={-155} x2={38} y2={-195} stroke="#EF4444" strokeWidth={10} strokeLinecap="round" />
                  <rect x={-106} y={-150} width={212} height={18} rx={9} fill="#FFFFFF" stroke="#111827" strokeWidth={3.5} />
                  {/* 4 Cost Layers Inside Cup */}
                  <polygon points="-96,-132 96,-132 86,-50 -86,-50" fill="#EF4444" stroke="#111827" strokeWidth={3} />
                  <text x={0} y={-86} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("45% CỐT HÃNG", 168, 12.5, 20)} fontWeight={900} fill="#FFFFFF">
                    45% CỐT HÃNG
                  </text>
                  <polygon points="-86,-50 86,-50 78,25 -78,25" fill="#F97316" stroke="#111827" strokeWidth={3} />
                  <text x={0} y={-7} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("30% MẶT BẰNG", 152, 12, 20)} fontWeight={900} fill="#FFFFFF">
                    30% MẶT BẰNG
                  </text>
                  <polygon points="-78,25 78,25 70,85 -70,85" fill="#38BDF8" stroke="#111827" strokeWidth={3} />
                  <text x={0} y={60} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("15% NHÂN VIÊN", 136, 11, 20)} fontWeight={900} fill="#0F172A">
                    15% NHÂN VIÊN
                  </text>
                  <polygon points="-70,85 70,85 64,130 -64,130" fill="#22C55E" stroke="#111827" strokeWidth={3} />
                  <text x={0} y={113} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("10% LÃI RÒNG", 124, 10.5, 18)} fontWeight={900} fill="#0F172A">
                    10% LÃI RÒNG
                  </text>
                </g>
                {/* Right Side Breakdown Summary Cards */}
                <g transform="translate(135, -10)">
                  <rect x={-132} y={-125} width={264} height={74} rx={14} fill="#7F1D1D" stroke="#F87171" strokeWidth={3} />
                  <text x={0} y={-93} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("HÃNG ĂN TRƯỚC 45%", 264, 13.5, 24)} fontWeight={900} fill="#FEF08A">
                    HÃNG ĂN TRƯỚC 45%
                  </text>
                  <text x={0} y={-67} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("Thu ngay khi xuất kho", 264, 12, 24)} fontWeight={700} fill="#FFFFFF">
                    Thu ngay khi xuất kho
                  </text>
                  <rect x={-132} y={-28} width={264} height={74} rx={14} fill="#1E293B" stroke="#38BDF8" strokeWidth={3} />
                  <text x={0} y={4} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("CHỦ QUÁN GÁNH 45%", 264, 13.5, 24)} fontWeight={900} fill="#38BDF8">
                    CHỦ QUÁN GÁNH 45%
                  </text>
                  <text x={0} y={30} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("Thuê nhà, điện nước, NV", 264, 12, 24)} fontWeight={700} fill="#E2E8F0">
                    Thuê nhà, điện nước, NV
                  </text>
                  <rect x={-132} y={68} width={264} height={54} rx={14} fill="#22C55E" />
                  <text x={0} y={100} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("BÀO MỎNG BIÊN LỢI NHUẬN", 264, 12.5, 24)} fontWeight={900} fill="#0F172A">
                    BÀO MỎNG BIÊN LỢI NHUẬN
                  </text>
                </g>
              </g>
            )}

            {currentCenterVisual === "three_stalls" && (
              <g>
                <rect x={-340} y={-205} width={680} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#FB923C" strokeWidth={3.5} />
                {[
                  {dx: -205, label: "QUÁN A (THÁNG 1)", color: "#38BDF8"},
                  {dx: 0, label: "QUÁN B (THÁNG 3)", color: "#FACC15"},
                  {dx: 205, label: "QUÁN C (THÁNG 5)", color: "#F43F5E"},
                ].map((st) => (
                  <g key={st.label} transform={`translate(${st.dx}, -25)`}>
                    <rect x={-88} y={-95} width={176} height={165} rx={14} fill="#1E293B" stroke={st.color} strokeWidth={3.5} />
                    <polygon points="-92,-112 92,-112 98,-76 -98,-76" fill={st.color} stroke="#111827" strokeWidth={3} />
                    <text x={0} y={-89} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(st.label, 180, 11, 20)} fontWeight={900} fill="#0F172A">
                      {st.label}
                    </text>
                    {/* Boba Cup + Counter inside each stall */}
                    <polygon points="-18,-35 18,-35 13,18 -13,18" fill="#FDE68A" stroke="#111827" strokeWidth={2.8} />
                    <rect x={-22} y={-41} width={44} height={7} rx={3.5} fill="#FFFFFF" stroke="#111827" strokeWidth={2} />
                    <rect x={-76} y={24} width={152} height={28} rx={6} fill="#334155" />
                    <text x={0} y={42} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("CÙNG THƯƠNG HIỆU", 152, 10.5, 18)} fontWeight={800} fill="#E2E8F0">
                      CÙNG THƯƠNG HIỆU
                    </text>
                  </g>
                ))}
                <rect x={-245} y={84} width={490} height={48} rx={14} fill="#F97316" />
                <text x={0} y={114} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("MỞ SÁT VÁCH · CHIA NHỎ KHÁCH", 490, 15, 28)} fontWeight={900} fill="#FFFFFF">
                  MỞ SÁT VÁCH · CHIA NHỎ KHÁCH
                </text>
              </g>
            )}

            {currentCenterVisual === "radar_radius" && (
              <g>
                <rect x={-330} y={-205} width={660} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#38BDF8" strokeWidth={3.5} />
                {/* Street Map Grid Lines */}
                <line x1={-280} y1={-40} x2={280} y2={-40} stroke="rgba(148,163,184,0.22)" strokeWidth={12} />
                <line x1={-40} y1={-175} x2={-40} y2={95} stroke="rgba(148,163,184,0.22)" strokeWidth={12} />
                {/* Animated Red Radar Rings */}
                <circle cx={0} cy={-35} r={120} fill="rgba(239, 68, 68, 0.14)" stroke="#EF4444" strokeWidth={3.5} strokeDasharray="10 8" />
                <circle cx={0} cy={-35} r={65 + Math.sin(f * 0.08) * 6} fill="rgba(239, 68, 68, 0.2)" stroke="#FACC15" strokeWidth={3} />
                {/* 4 Competing Shop Pins Inside 500m */}
                {[
                  {x: 0, y: -35, label: "QUÁN BẠN", c: "#22C55E"},
                  {x: -75, y: -85, label: "QUẦY MỚI 1", c: "#EF4444"},
                  {x: 82, y: -65, label: "QUẦY MỚI 2", c: "#EF4444"},
                  {x: 55, y: 25, label: "QUẦY MỚI 3", c: "#EF4444"},
                ].map((pin) => (
                  <g key={pin.label} transform={`translate(${pin.x}, ${pin.y})`}>
                    <circle cx={0} cy={0} r={16} fill={pin.c} stroke="#111827" strokeWidth={3} />
                    <rect x={-58} y={-38} width={116} height={22} rx={6} fill="#0F172A" stroke={pin.c} strokeWidth={2} />
                    <text x={0} y={-23} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(pin.label, 116, 10, 16)} fontWeight={900} fill="#FFFFFF">
                      {pin.label}
                    </text>
                  </g>
                ))}
                <rect x={-245} y={96} width={490} height={48} rx={14} fill="#EF4444" />
                <text x={0} y={125} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("BÁN KÍNH 500M · 4 QUÁN CHÈN NHAU", 490, 15, 28)} fontWeight={900} fill="#FFFFFF">
                  BÁN KÍNH 500M · 4 QUÁN CHÈN NHAU
                </text>
              </g>
            )}

            {currentCenterVisual === "scale_balance" && (
              <g>
                <rect x={-325} y={-205} width={650} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#FACC15" strokeWidth={3.5} />
                {/* Balance Pedestal */}
                <polygon points="0,-15 40,115 -40,115" fill="#64748B" stroke="#111827" strokeWidth={3.5} />
                <rect x={-115} y={115} width={230} height={22} rx={10} fill="#475569" stroke="#111827" strokeWidth={3} />
                {/* Beam angled naturally while hanging pans stay strictly horizontal so text NEVER rotates or jitters */}
                <line x1={-185} y1={-55} x2={185} y2={25} stroke="#FACC15" strokeWidth={10} strokeLinecap="round" />
                <circle cx={0} cy={-15} r={10} fill="#FEF08A" stroke="#111827" strokeWidth={3} />
                {/* Left Light Pan (Thin Margin — Upright) */}
                <g transform="translate(-185, -55)">
                  <line x1={0} y1={0} x2={-38} y2={52} stroke="#94A3B8" strokeWidth={3} />
                  <line x1={0} y1={0} x2={38} y2={52} stroke="#94A3B8" strokeWidth={3} />
                  <polygon points="-14,14 14,14 10,50 -10,50" fill="#FDE68A" stroke="#111827" strokeWidth={2.5} />
                  <rect x={-100} y={52} width={200} height={44} rx={10} fill="#22C55E" stroke="#111827" strokeWidth={3} />
                  <text x={0} y={79} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("LÃI MỖI LY MỎNG", 200, 12, 24)} fontWeight={900} fill="#0F172A">
                    LÃI MỖI LY MỎNG
                  </text>
                </g>
                {/* Right Heavy Pan (Stacked Cost Weights — Upright) */}
                <g transform="translate(185, 25)">
                  <line x1={0} y1={0} x2={-42} y2={42} stroke="#94A3B8" strokeWidth={3} />
                  <line x1={0} y1={0} x2={42} y2={42} stroke="#94A3B8" strokeWidth={3} />
                  <rect x={-98} y={6} width={196} height={36} rx={8} fill="#F97316" stroke="#111827" strokeWidth={3} />
                  <text x={0} y={29} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("THUÊ NHÀ + LƯƠNG", 196, 11, 24)} fontWeight={900} fill="#0F172A">
                    THUÊ NHÀ + LƯƠNG
                  </text>
                  <rect x={-108} y={42} width={216} height={52} rx={12} fill="#EF4444" stroke="#111827" strokeWidth={3.5} />
                  <text x={0} y={73} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("GIÁ CỐT ĐỘC QUYỀN", 216, 12.5, 24)} fontWeight={900} fill="#FFFFFF">
                    GIÁ CỐT ĐỘC QUYỀN
                  </text>
                </g>
              </g>
            )}

            {currentCenterVisual === "cashflow_burn" && (
              <g>
                <rect x={-330} y={-205} width={660} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#F97316" strokeWidth={3.5} />
                {/* Left: Flip Calendar (Tháng 1 -> Tháng 3) */}
                <g transform="translate(-145, -20)">
                  <rect x={-115} y={-110} width={230} height={195} rx={18} fill="#F8FAFC" stroke="#111827" strokeWidth={3.5} />
                  <rect x={-115} y={-110} width={230} height={52} rx={16} fill="#EF4444" stroke="#111827" strokeWidth={3} />
                  <text x={0} y={-78} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("LỊCH GỒNG LỖ", 230, 15, 24)} fontWeight={900} fill="#FFFFFF">
                    LỊCH GỒNG LỖ
                  </text>
                  <text x={0} y={10} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={30} fontWeight={900} fill="#0F172A">
                    THÁNG 3
                  </text>
                  <text x={0} y={52} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("CẠN QUỸ DỰ PHÒNG", 220, 13, 24)} fontWeight={800} fill="#EF4444">
                    CẠN QUỸ DỰ PHÒNG
                  </text>
                </g>
                {/* Right: Draining Cash Vault */}
                <g transform="translate(145, -20)">
                  <rect x={-115} y={-110} width={230} height={195} rx={18} fill="#1E293B" stroke="#FACC15" strokeWidth={3.5} />
                  {[0, 1, 2].map((idx) => (
                    <g key={idx} transform={`translate(${(idx - 1) * 58}, ${-25 - idx * 6})`}>
                      <rect x={-32} y={-22} width={64} height={38} rx={8} fill="#22C55E" stroke="#111827" strokeWidth={2.5} />
                      <text x={0} y={4} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={14} fontWeight={900} fill="#0F172A">
                        -$$$
                      </text>
                    </g>
                  ))}
                  <rect x={-85} y={24} width={170} height={24} rx={12} fill="#0F172A" />
                  <rect x={-85} y={24} width={52} height={24} rx={12} fill="#EF4444" />
                </g>
                <rect x={-245} y={96} width={490} height={48} rx={14} fill="#F97316" />
                <text x={0} y={125} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("BÀO MÒN TIỀN TÍCH CÓP MỖI THÁNG", 490, 15, 28)} fontWeight={900} fill="#0F172A">
                  BÀO MÒN TIỀN TÍCH CÓP MỖI THÁNG
                </text>
              </g>
            )}

            {currentCenterVisual === "penalty_trap" && (
              <g>
                <rect x={-330} y={-205} width={660} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#EF4444" strokeWidth={3.5} />
                {/* Outside Ingredient Sack Blocked by Red Barrier */}
                <g transform="translate(-135, -20)">
                  <rect x={-115} y={-100} width={230} height={185} rx={18} fill="#1E293B" stroke="#94A3B8" strokeWidth={3} />
                  <rect x={-92} y={-65} width={184} height={95} rx={14} fill="#0284C7" stroke="#111827" strokeWidth={3} />
                  <text x={0} y={-13} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("BỘT MUA NGOÀI", 184, 12, 24)} fontWeight={900} fill="#FFFFFF">
                    BỘT MUA NGOÀI
                  </text>
                  {/* Red Prohibition Cross */}
                  <circle cx={0} cy={-15} r={68} fill="none" stroke="#EF4444" strokeWidth={10} />
                  <line x1={-48} y1={-63} x2={48} y2={33} stroke="#EF4444" strokeWidth={10} strokeLinecap="round" />
                </g>
                {/* Right: Penalty Stamp & Deposit Forfeiture */}
                <g transform="translate(135, -20)">
                  <rect x={-115} y={-100} width={230} height={185} rx={18} fill="#7F1D1D" stroke="#FACC15" strokeWidth={3.5} />
                  <rect x={-98} y={-60} width={196} height={54} rx={10} fill="#EF4444" stroke="#FEF08A" strokeWidth={3} />
                  <text x={0} y={-27} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("CẮT CỌC 100%", 196, 15.5, 24)} fontWeight={900} fill="#FEF08A">
                    CẮT CỌC 100%
                  </text>
                  <text x={0} y={32} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("Thu hồi biển hiệu ngay", 220, 13, 24)} fontWeight={800} fill="#FFFFFF">
                    Thu hồi biển hiệu ngay
                  </text>
                </g>
                <rect x={-265} y={96} width={530} height={48} rx={14} fill="#EF4444" />
                <text x={0} y={125} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("TỰ Ý NHẬP NGOÀI = MẤT CỌC PHẠT NẶNG", 530, 14, 28)} fontWeight={900} fill="#FFFFFF">
                  TỰ Ý NHẬP NGOÀI = MẤT CỌC PHẠT NẶNG
                </text>
              </g>
            )}

            {currentCenterVisual === "night_shutter" && (
              <g>
                <rect x={-325} y={-205} width={650} height={385} rx={26} fill="rgba(15, 23, 42, 0.9)" stroke="#EF4444" strokeWidth={3.5} />
                {/* Closed Corrugated Metal Shop Shutter */}
                <rect x={-210} y={-145} width={420} height={185} rx={12} fill="#334155" stroke="#111827" strokeWidth={3.5} />
                {[-115, -80, -45, -10, 25].map((ly) => (
                  <line key={ly} x1={-195} y1={ly} x2={195} y2={ly} stroke="#1E293B" strokeWidth={5} />
                ))}
                {/* Falling Red Revenue Line Across Shutter */}
                <polyline
                  points="-180,-120 -60,-90 45,-20 175,28"
                  fill="none"
                  stroke="#EF4444"
                  strokeWidth={10}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Crisp Upright Liquidation Sign */}
                <g transform="translate(0, 92)">
                  <rect x={-235} y={-34} width={470} height={66} rx={16} fill="#EF4444" stroke="#FEF08A" strokeWidth={3.5} />
                  <text x={0} y={6} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("SANG NHƯỢNG · THANH LÝ ĐỒ", 470, 16.5, 28)} fontWeight={900} fill="#FEF08A">
                    SANG NHƯỢNG · THANH LÝ ĐỒ
                  </text>
                </g>
              </g>
            )}

            {currentCenterVisual === "magnifier_audit" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#22C55E" strokeWidth={3.5} />
                {[
                  {dx: -195, icon: "📦", title: "SOI GIÁ BỘT", sub: "So với chợ sỉ", color: "#FACC15"},
                  {dx: 0, icon: "📍", title: "KHOẢNG CÁCH", sub: "Khóa bán kính", color: "#38BDF8"},
                  {dx: 195, icon: "🧮", title: "LÃI THỰC TẾ", sub: "Trừ hết chi phí", color: "#22C55E"},
                ].map((card) => (
                  <g key={card.title} transform={`translate(${card.dx}, -20)`}>
                    <rect x={-88} y={-110} width={176} height={200} rx={18} fill="#1E293B" stroke={card.color} strokeWidth={3.5} />
                    <text x={0} y={-36} textAnchor="middle" fontSize={44}>
                      {card.icon}
                    </text>
                    <rect x={-78} y={14} width={156} height={36} rx={9} fill={card.color} />
                    <text x={0} y={37} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(card.title, 156, 12.5, 20)} fontWeight={900} fill="#0F172A">
                      {card.title}
                    </text>
                    <text x={0} y={72} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(card.sub, 164, 12, 18)} fontWeight={700} fill="#CBD5E1">
                      {card.sub}
                    </text>
                  </g>
                ))}
                {/* Animated Scanning Magnifying Glass Over Top Icons (Never Overlaps Text Pills) */}
                <g transform={`translate(${Math.sin(f * 0.055) * 165}, -68)`}>
                  <circle cx={0} cy={0} r={34} fill="rgba(56, 189, 248, 0.22)" stroke="#38BDF8" strokeWidth={6} />
                  <line x1={24} y1={24} x2={48} y2={48} stroke="#FACC15" strokeWidth={10} strokeLinecap="round" />
                </g>
              </g>
            )}

            {currentCenterVisual === "old_shop_survey" && (
              <g>
                <rect x={-330} y={-205} width={660} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#38BDF8" strokeWidth={3.5} />
                {/* Left: Existing Store Observation */}
                <g transform="translate(-140, -20)">
                  <rect x={-120} y={-105} width={240} height={190} rx={18} fill="#1E293B" stroke="#38BDF8" strokeWidth={3.5} />
                  <rect x={-104} y={-80} width={208} height={34} rx={8} fill="#0284C7" />
                  <text x={0} y={-58} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("QUÁN ĐÃ MỞ 6 THÁNG", 208, 12, 22)} fontWeight={900} fill="#FFFFFF">
                    QUÁN ĐÃ MỞ 6 THÁNG
                  </text>
                  <text x={0} y={8} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("THỨ 3 · THỨ 4", 224, 21, 24)} fontWeight={900} fill="#FACC15">
                    THỨ 3 · THỨ 4
                  </text>
                  <text x={0} y={48} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("Ngồi đếm lượng khách thật", 224, 12.5, 22)} fontWeight={800} fill="#94A3B8">
                    Ngồi đếm lượng khách thật
                  </text>
                </g>
                {/* Right: Tally Counter */}
                <g transform="translate(145, -20)">
                  <rect x={-120} y={-105} width={240} height={190} rx={18} fill="#1E293B" stroke="#22C55E" strokeWidth={3.5} />
                  <circle cx={0} cy={-20} r={54} fill="#0F172A" stroke="#22C55E" strokeWidth={4} />
                  <text x={0} y={-8} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("65 LY", 96, 22, 16)} fontWeight={900} fill="#22C55E">
                    65 LY
                  </text>
                  <text x={0} y={58} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("CON SỐ THỰC TẾ / NGÀY", 224, 12.5, 22)} fontWeight={900} fill="#FACC15">
                    CON SỐ THỰC TẾ / NGÀY
                  </text>
                </g>
                <rect x={-245} y={96} width={490} height={48} rx={14} fill="#38BDF8" />
                <text x={0} y={125} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("KHẢO SÁT QUÁN CŨ VÀO NGÀY THƯỜNG", 490, 15, 28)} fontWeight={900} fill="#0F172A">
                  KHẢO SÁT QUÁN CŨ VÀO NGÀY THƯỜNG
                </text>
              </g>
            )}

            {currentCenterVisual === "breakeven_calc" && (
              <g>
                <rect x={-330} y={-205} width={660} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#FACC15" strokeWidth={3.5} />
                {/* Left: 2D Calculator */}
                <g transform="translate(-150, -15)">
                  <rect x={-110} y={-115} width={220} height={210} rx={20} fill="#334155" stroke="#111827" strokeWidth={3.5} />
                  <rect x={-92} y={-92} width={184} height={48} rx={10} fill="#0F172A" stroke="#22C55E" strokeWidth={2.5} />
                  <text x={0} y={-62} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("70 LY/NGÀY", 184, 18.5, 22)} fontWeight={900} fill="#22C55E">
                    70 LY/NGÀY
                  </text>
                  {[-50, 0, 50].map((bx) =>
                    [-15, 32].map((by) => (
                      <rect key={`${bx}_${by}`} x={bx - 20} y={by} width={40} height={32} rx={6} fill="#64748B" stroke="#111827" strokeWidth={2} />
                    )),
                  )}
                </g>
                {/* Right: Promise vs Reality Comparison */}
                <g transform="translate(135, -15)">
                  <rect x={-130} y={-105} width={260} height={86} rx={14} fill="#7F1D1D" stroke="#EF4444" strokeWidth={3} />
                  <text x={0} y={-72} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("BẢNG TÍNH QUẢNG CÁO", 260, 12.5, 24)} fontWeight={900} fill="#FCA5A5">
                    BẢNG TÍNH QUẢNG CÁO
                  </text>
                  <text x={0} y={-40} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("250 LY/NGÀY (ẢO)", 260, 17, 24)} fontWeight={900} fill="#FFFFFF">
                    250 LY/NGÀY (ẢO)
                  </text>
                  <rect x={-130} y={8} width={260} height={86} rx={14} fill="#065F46" stroke="#22C55E" strokeWidth={3} />
                  <text x={0} y={40} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("BẢNG TÍNH THỰC TẾ", 260, 12.5, 24)} fontWeight={900} fill="#86EFAC">
                    BẢNG TÍNH THỰC TẾ
                  </text>
                  <text x={0} y={72} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("70 LY VẪN SỐNG TỐT", 260, 17, 24)} fontWeight={900} fill="#FEF08A">
                    70 LY VẪN SỐNG TỐT
                  </text>
                </g>
              </g>
            )}

            {currentCenterVisual === "smart_roadmap" && (
              <g>
                <rect x={-335} y={-205} width={670} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#FACC15" strokeWidth={3.5} />
                {/* 3 Ascending Golden Steps + Trophy */}
                {[
                  {x: -195, y: 20, w: 176, h: 75, step: "1. ĐÒI BẢNG GIÁ", sub: "So giá chợ sỉ", c: "#38BDF8"},
                  {x: 0, y: -25, w: 176, h: 120, step: "2. KHÓA CỰ LY", sub: "Bảo hộ 1km", c: "#FACC15"},
                  {x: 195, y: -70, w: 176, h: 165, step: "3. GIỮ TỰ CHỦ", sub: "Bảo toàn vốn", c: "#22C55E"},
                ].map((st) => (
                  <g key={st.step} transform={`translate(${st.x}, ${st.y})`}>
                    <rect x={-st.w / 2} y={-st.h / 2} width={st.w} height={st.h} rx={14} fill="#1E293B" stroke={st.c} strokeWidth={3.5} />
                    <rect x={-st.w / 2 + 8} y={-st.h / 2 + 12} width={st.w - 16} height={32} rx={8} fill={st.c} />
                    <text x={0} y={-st.h / 2 + 32} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(st.step, st.w - 16, 11.5, 18)} fontWeight={900} fill="#0F172A">
                      {st.step}
                    </text>
                    <text x={0} y={18} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(st.sub, st.w - 16, 12.5, 18)} fontWeight={800} fill="#F8FAFC">
                      {st.sub}
                    </text>
                  </g>
                ))}
                <rect x={-245} y={96} width={490} height={48} rx={14} fill="#FACC15" />
                <text x={0} y={125} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("BỘ LỌC ĐẦU TƯ TỈNH TÁO & AN TOÀN", 490, 15, 28)} fontWeight={900} fill="#0F172A">
                  BỘ LỌC ĐẦU TƯ TỈNH TÁO & AN TOÀN
                </text>
              </g>
            )}

            {currentCenterVisual === "decoy_cups" && (
              <g>
                <rect x={-330} y={-205} width={660} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#A855F7" strokeWidth={3.5} />
                {[
                  {dx: -190, h: 95, label: "SIZE S", price: "45K", color: "#64748B"},
                  {dx: 0, h: 130, label: "SIZE M (MỒI)", price: "65K", color: "#F43F5E"},
                  {dx: 190, h: 165, label: "SIZE L", price: "70K", color: "#22C55E"},
                ].map((c) => (
                  <g key={c.label} transform={`translate(${c.dx}, 85)`}>
                    <rect x={-55} y={-c.h - 45} width={110} height={c.h} rx={12} fill={c.color} stroke="#111827" strokeWidth={3.5} />
                    <text x={0} y={-c.h / 2 - 36} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" fontSize={20} fontWeight={900} fill="#FFFFFF">
                      {c.price}
                    </text>
                    <rect x={-78} y={-28} width={156} height={38} rx={10} fill="#1E293B" stroke={c.color} strokeWidth={2.5} />
                    <text x={0} y={-4} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText(c.label, 156, 12.5, 20)} fontWeight={900} fill="#FFFFFF">
                      {c.label}
                    </text>
                  </g>
                ))}
              </g>
            )}

            {currentCenterVisual === "clock_brain" && (
              <g>
                <rect x={-315} y={-205} width={630} height={385} rx={26} fill="rgba(15, 23, 42, 0.88)" stroke="#38BDF8" strokeWidth={3.5} />
                <circle cx={-110} cy={-15} r={92} fill="#1E293B" stroke="#38BDF8" strokeWidth={6} />
                <line x1={-110} y1={-15} x2={-110 + Math.cos(f * 0.06) * 62} y2={-15 + Math.sin(f * 0.06) * 62} stroke="#FACC15" strokeWidth={7} strokeLinecap="round" />
                <line x1={-110} y1={-15} x2={-110 + Math.cos(f * 0.015) * 42} y2={-15 + Math.sin(f * 0.015) * 42} stroke="#FFFFFF" strokeWidth={7} strokeLinecap="round" />
                <rect x={45} y={-95} width={170} height={160} rx={18} fill="#1E293B" stroke="#22C55E" strokeWidth={4} />
                <rect x={65} y={-70} width={130} height={34} rx={8} fill="#22C55E" />
                <rect x={65} y={-24} width={130} height={34} rx={8} fill="#FACC15" />
                <rect x={65} y={22} width={130} height={34} rx={8} fill="#EF4444" />
                <rect x={-215} y={108} width={430} height={46} rx={12} fill="#38BDF8" />
                <text x={0} y={137} textAnchor="middle" fontFamily="Be Vietnam Pro, sans-serif" {...fitSvgText("NHỊP SINH HỌC & NĂNG LƯỢNG", 430, 15, 28)} fontWeight={900} fill="#0F172A">
                  NHỊP SINH HỌC & NĂNG LƯỢNG
                </text>
              </g>
            )}
          </g>

          {/* Expressive Widescreen Main Cast on Left & Right Sides (Open Stage, Clean 2-Speaker Layout) */}
          <BlendStickman
            x={wideLeftX}
            y={(floorY - 6) + leftDepth * 46}
            scale={(minimalUi ? 1.75 : isSolo ? 1.48 : 1.38) * (1 + 0.2 * leftDepth)}
            pose={activeLeftPose}
            mood={leftMood}
            prop={wideLeftProp}
            hat={finalLeftHat}
            flip={leftFaceFlip}
            colorKey={minimalUi ? finalCharLeft : undefined}
            age={activeAct?.leftAge}
            gender={activeAct?.leftGender}
            accessory={finalLeftAccessory}
            outfit={finalLeftOutfit}
            talking={minimalUi ? leftSpeak : isVoiceSpeakingNow && (isSolo ? true : teoTurn)}
            color="#FFFFFF"
            accent="#FFD60A"
            label={minimalUi ? undefined : finalCharLeft}
            bubble={minimalUi ? undefined : isAfterAllSpeech ? undefined : isSolo ? activeDialogue : bubble1}
            bubbleOpacity={bubbleFadeOpacity}
            bubbleLocalFrame={sentenceLocalFrame}
            seed={1}
            swapFrames={swapFrames}
            eerie={minimalUi}
            moodFx={!minimalUi}
            opacity={leftVis}
            customPropSvg={effectiveLeftCustomPropSvg}
            prevPose={prevLeftPose}
            blend={poseBlend}
          />

          {!isSolo && (
            <BlendStickman
              x={wideRightX}
              y={(floorY - 6) + rightDepth * 46}
              scale={(minimalUi ? 1.75 : 1.38) * (1 + 0.2 * rightDepth)}
              pose={activeRightPose}
              mood={rightMood}
              prop={wideRightProp}
              hat={finalRightHat}
            colorKey={minimalUi ? finalCharRight : undefined}
            age={activeAct?.rightAge}
            gender={activeAct?.rightGender}
              accessory={finalRightAccessory}
              outfit={finalRightOutfit}
              talking={minimalUi ? rightSpeak : isVoiceSpeakingNow && !teoTurn}
              color="#FFFFFF"
              accent="#30D5C8"
              flip={rightFaceFlip}
              label={minimalUi ? undefined : finalCharRight}
              bubble={minimalUi ? undefined : bubble2}
              bubbleOpacity={bubbleFadeOpacity}
              bubbleLocalFrame={sentenceLocalFrame}
              seed={2}
              swapFrames={swapFrames}
            eerie={minimalUi}
            moodFx={!minimalUi}
            opacity={rightVis}
              customPropSvg={effectiveRightCustomPropSvg}
              prevPose={prevRightPose}
            blend={poseBlend}
          />
          )}
        </svg>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
      }}
    >
      {/* Smoothly crossfaded Cartoon Settings per scene */}
      {timings.map((t, idx) => {
        const act = acts[idx] ?? acts[0];
        const w =
          idx === 0
            ? 1 - ramp(f, t.from + t.duration - 15, 30)
            : idx === timings.length - 1
              ? ramp(f, t.from - 15, 30)
              : fade(f, t.from - 15, 30, t.from + t.duration + 15);
        if (w <= 0.01) return null;
        const p = Math.max(0, Math.min(1, (f - t.from) / Math.max(1, t.duration)));
        const scText = voice.lines
          .filter((l) => l.scene === t.id)
          .map((l) => l.text)
          .join(" ");
        return (
          <div key={t.id} style={{position: "absolute", inset: 0, opacity: w}}>
            {renderSetting(resolveSceneSetting(act, scText), p, f, scText, act, idx)}
          </div>
        );
      })}

      {hasAiBg ? <AiBackdrop items={backdrops ?? []} voice={voice} still={minimalUi} stageFloor={FLOOR_Y / H} /> : null}

      {/* Unified Top Storyboard Card (y = 240..520) — Never overlaps characters or bottom subtitles */}
      <svg
        width={W}
        height={H}
        textRendering="geometricPrecision"
        shapeRendering="geometricPrecision"
        style={{position: "absolute", left: 0, top: 0}}
      >
        <g transform={`translate(${W / 2}, 380)`} style={{display: minimalUi ? "none" : undefined}}>
          <rect
            x={-410}
            y={-135}
            width={820}
            height={265}
            rx={32}
            fill="rgba(9, 21, 38, 0.86)"
            stroke="rgba(255, 214, 10, 0.55)"
            strokeWidth={4}
          />
          {/* Scene Badge */}
          {(() => {
            const badgeText = activeAct?.badge || `CẢNH ${activeSceneIdx + 1}`;
            const badgeW = Math.max(420, Math.min(680, badgeText.length * 16 + 70));
            return (
              <>
                <rect x={-badgeW / 2} y={-115} width={badgeW} height={42} rx={21} fill="#FFD60A" />
                <text
                  x={0}
                  y={-86}
                  textAnchor="middle"
                  fontFamily="Be Vietnam Pro, Inter, system-ui, sans-serif"
                  {...fitSvgText(badgeText, badgeW, 20, 28)}
                  fontWeight={900}
                  fill="#0F172A"
                >
                  {badgeText}
                </text>
              </>
            );
          })()}

          {/* Main Scene Headline */}
          <text
            x={0}
            y={-22}
            textAnchor="middle"
            fontFamily="Be Vietnam Pro, Inter, system-ui, sans-serif"
            {...fitSvgText(activeAct?.title || "CỐT TRUYỆN CHI TIẾT", 780, 32, 28)}
            fontWeight={900}
            fill="#FFFFFF"
          >
            {activeAct?.title || "CỐT TRUYỆN CHI TIẾT"}
          </text>

          {/* Two Stat Pills (Left & Right) */}
          <g transform="translate(-200, 36)">
            <rect x={-185} y={-28} width={370} height={54} rx={16} fill="#1E293B" stroke="#38BDF8" strokeWidth={3} />
            <text
              x={0}
              y={8}
              textAnchor="middle"
              fontFamily="Be Vietnam Pro, Inter, system-ui, sans-serif"
              {...fitSvgText(activeAct?.statLeft || "Chi tiết A", 370, 20, 28)}
              fontWeight={800}
              fill="#38BDF8"
            >
              {activeAct?.statLeft || "Chi tiết A"}
            </text>
          </g>
          <g transform="translate(200, 36)">
            <rect x={-185} y={-28} width={370} height={54} rx={16} fill="#1E293B" stroke="#FFD60A" strokeWidth={3} />
            <text
              x={0}
              y={8}
              textAnchor="middle"
              fontFamily="Be Vietnam Pro, Inter, system-ui, sans-serif"
              {...fitSvgText(activeAct?.statRight || "Chi tiết B", 370, 20, 28)}
              fontWeight={800}
              fill="#FFD60A"
            >
              {activeAct?.statRight || "Chi tiết B"}
            </text>
          </g>

          {/* Animated Progress / Comparison Bar at the bottom of the Storyboard Card */}
          <rect x={-360} y={86} width={720} height={18} rx={9} fill="#1E293B" />
          <rect x={-360} y={86} width={(720 * barPct) / 100} height={18} rx={9} fill="#22C55E" />
        </g>

        {/* Dynamic Sentence-Driven Objects + AI Custom SVG Objects */}
        {minimalUi ? null : renderDynamicSentenceObjects(
          sentenceContext,
          activeSetting,
          f,
          activeAct?.customSvg,
          currentSpokenLine?.text ?? "",
          sceneLineIdx,
          sceneLines.length,
          sentenceLocalFrame
        )}

        {/* Expressive 2D Comic Characters acting out the mini-story (1, 2, 3, or 4 Stickmen!) */}
        {hasFourthChar && (
          <Stickman
            x={fourthX}
            y={fourthY}
            scale={1.25}
            pose={
              isInspectionMoment
                ? "tired"
                : activeSetting === "street_vendor" || activeSetting === "sidewalk_tea"
                  ? "sit"
                  : "think"
            }
            mood={isInspectionMoment ? "shock" : "happy"}
            prop="none"
            hat="cap"
            outfit="hoodie"
            talking={false}
            color="#E2E8F0"
            accent="#FB923C"
            label={minimalUi ? undefined : fourthLabel}
            seed={4}
            swapFrames={swapFrames}
            eerie={minimalUi}
          />
        )}

        <BlendStickman
          x={choreographedLeftX}
          y={(leftY) + leftDepth * 46}
          scale={(isSolo ? 1.62 : hasThirdChar ? 1.44 : 1.52) * (1 + 0.2 * leftDepth)}
          pose={finalLeftPose}
          mood={leftMood}
          prop={finalLeftProp}
          hat={finalLeftHat}
            flip={leftFaceFlip}
            colorKey={minimalUi ? finalCharLeft : undefined}
            age={activeAct?.leftAge}
            gender={activeAct?.leftGender}
          accessory={finalLeftAccessory}
          outfit={finalLeftOutfit}
          talking={minimalUi ? leftSpeak : isVoiceSpeakingNow && (isSolo ? true : teoTurn)}
          color="#FFFFFF"
          accent="#FFD60A"
          label={minimalUi ? undefined : finalCharLeft}
          bubble={minimalUi ? undefined : isAfterAllSpeech ? undefined : isSolo ? activeDialogue : bubble1}
          bubbleOpacity={bubbleFadeOpacity}
          bubbleLocalFrame={sentenceLocalFrame}
          seed={1}
          swapFrames={swapFrames}
            eerie={minimalUi}
            moodFx={!minimalUi}
            opacity={leftVis}
          customPropSvg={effectiveLeftCustomPropSvg}
          prevPose={prevLeftPose}
            blend={poseBlend}
          />

        {!isSolo && (
          <BlendStickman
            x={choreographedRightX}
            y={(rightY) + rightDepth * 46}
            scale={(hasThirdChar ? 1.44 : 1.52) * (1 + 0.2 * rightDepth)}
            pose={finalRightPose}
            mood={rightMood}
            prop={finalRightProp}
            hat={finalRightHat}
            colorKey={minimalUi ? finalCharRight : undefined}
            age={activeAct?.rightAge}
            gender={activeAct?.rightGender}
            accessory={finalRightAccessory}
            outfit={finalRightOutfit}
            talking={minimalUi ? rightSpeak : isVoiceSpeakingNow && !teoTurn}
            color="#FFFFFF"
            accent="#30D5C8"
            flip={rightFaceFlip}
            label={minimalUi ? undefined : finalCharRight}
            bubble={minimalUi ? undefined : bubble2}
            bubbleOpacity={bubbleFadeOpacity}
            bubbleLocalFrame={sentenceLocalFrame}
            seed={2}
            swapFrames={swapFrames}
            eerie={minimalUi}
            moodFx={!minimalUi}
            opacity={rightVis}
            customPropSvg={effectiveRightCustomPropSvg}
            prevPose={prevRightPose}
            blend={poseBlend}
          />
        )}

        {hasThirdChar && (
          <Stickman
            x={thirdX}
            y={thirdY}
            scale={1.38}
            pose={thirdPose}
            mood={thirdMood}
            prop={thirdProp}
            hat={thirdHat}
            colorKey={minimalUi ? thirdLabel : undefined}
            age={activeAct?.thirdAge}
            gender={activeAct?.thirdGender}
            outfit={activeAct?.thirdOutfit ?? (isInspectionMoment ? "uniform" : "hoodie")}
            talking={minimalUi ? false : false}
            color="#FFFFFF"
            accent="#A78BFA"
            flip
            label={minimalUi ? undefined : thirdLabel}
            seed={3}
            swapFrames={swapFrames}
            eerie={minimalUi}
            moodFx={!minimalUi}
            opacity={thirdVis}
          />
        )}
      </svg>
    </div>
  );
};

