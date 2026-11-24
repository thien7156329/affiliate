import React from "react";
import {useCurrentFrame} from "remotion";

export type StickPose =
  | "stand"
  | "walk"
  | "run"
  | "wave"
  | "point"
  | "point-right"
  | "explain"
  | "think"
  | "jump"
  | "cheer"
  | "dance"
  | "shrug"
  | "sit"
  | "tired"
  | "present_check"
  | "drive"
  | "sit_eat"
  | "sit_type"
  | "climb"
  | "analyze"
  | "carry"
  | "read_book"
  | "write_note"
  | "check_phone"
  | "reach"
  | "slump"
  | "crouch_inspect"
  | "step_back"
  | "kick_ball"
  | "dribble_ball"
  | "cook_toss"
  | "lift_weight"
  | "boxing_punch"
  | "sword_slash"
  | "sword_parry"
  | "bow_respect"
  | "kneel_pray"
  /** On a phone call: the phone is pressed to the ear, the other arm hangs. */
  | "phone_call"
  | "laugh_belly";

export type StickMood =
  | "happy"
  | "shock"
  | "serious"
  | "sad"
  | "cool"
  | "idea"
  | "celebrate"
  | "confused"
  | "scheming";

export type StickProp =
  | "none"
  | "phone"
  | "money"
  | "coffee"
  | "laptop"
  | "chart"
  | "question"
  | "bulb"
  | "peach"
  | "scroll"
  | "fan"
  | "sword"
  | "checklist"
  | "magnifier"
  | "pointer"
  | "gold"
  | "bowl"
  | "wheel"
  | "book"
  | "notebook"
  | "megaphone"
  | "soccer_ball"
  | "frying_pan"
  | "dumbbell"
  | "microphone"
  | "trophy"
  | "soda_can"
  | "water_bottle";

export type StickHat =
  | "none"
  | "crown"
  | "scholar"
  | "official"
  | "cap"
  | "tophat"
  | "non_la"
  | "chef_hat"
  | "headband"
  | "three_tuft"
  /** Small conical hat tipped back on the crown, with a chin strap (Thầy Lá) */
  | "non_la_back"
  /** Men's traditional wrapped turban (khăn đóng), old times */
  | "khan_dong";

/** Hair drawn under the hat. */
export type StickHair = "none" | "side_swoop";
/** Life stage: size, proportions, hair colour and posture. */
export type StickAge = "child" | "teen" | "adult" | "elder";
export type StickGender = "m" | "f";
const AGE_SCALE: Record<StickAge, number> = {child: 0.7, teen: 0.87, adult: 1, elder: 0.96};

export type StickAccessory = "none" | "gold_chain" | "scammer_bling" | "necktie";

export type StickOutfit =
  | "none"
  | "suit"
  | "office_shirt"
  | "hoodie"
  | "vendor_apron"
  | "doctor_coat"
  | "uniform"
  | "royal_robe"
  | "soccer_jersey"
  | "chef_coat"
  | "gym_tank"
  | "martial_gi"
  /** Indigo shirt, rolled collar, red pen in the pocket (Thầy Lá) */
  | "teacher_shirt"
  /** Old-times Vietnam: plain loose shirt with cloth buttons + black trousers (both genders) */
  | "ao_ba_ba"
  /** Women's long tunic: front/back panels falling over the trousers to the knee */
  | "ao_dai"
  /** Men's dark traditional robe to the knee (elders, village notables) */
  | "ao_the";

export interface StickCustomRig {
  leanX?: number;
  hipY?: number;
  headTiltDeg?: number;
  lHand?: [number, number];
  rHand?: [number, number];
  lFoot?: [number, number];
  rFoot?: [number, number];
  customOutfitNode?: React.ReactNode;
  customPropNode?: React.ReactNode;
}

type P2 = [number, number];

/** Deterministic per-character pseudo-random in [0, 1) (from claude-animated-shorts toon.ts) */
const rnd = (seed: number, k: number): number => {
  const x = Math.sin(seed * 127.1 + k * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const clampVal = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

/**
 * Superellipse "bean" contour generator (ported from claude-animated-shorts toon.ts):
 * Separate crown (nTop = 1.75) & jaw (nBot = 2.3) exponents, chin taper (egg = -0.11),
 * one-side cheek bulge toward facing direction (asym = +0.07), and subtle organic harmonics.
 */
const blobPts = (
  cx: number,
  cy: number,
  opts: {
    a: number;
    b: number;
    nTop: number;
    nBot: number;
    egg: number;
    asym: number;
    rot: number;
    noise: number;
    seed: number;
  },
  n = 56
): P2[] => {
  const ph = [rnd(opts.seed, 11), rnd(opts.seed, 12), rnd(opts.seed, 13)].map((v) => v * Math.PI * 2);
  const pts: P2[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const e = 2 / (s < 0 ? opts.nTop : opts.nBot);
    let X = Math.sign(c) * Math.abs(c) ** e;
    const Y = Math.sign(s) * Math.abs(s) ** e;
    X *= (1 + opts.egg * Y) * (1 + opts.asym * Math.sign(X));
    const r =
      1 +
      opts.noise *
        (Math.cos(2 * t + ph[0]) + 0.7 * Math.cos(3 * t + ph[1]) + 0.5 * Math.cos(4 * t + ph[2]));
    const x = opts.a * X * r;
    const y = opts.b * Y * r;
    pts.push([
      cx + x * Math.cos(opts.rot) - y * Math.sin(opts.rot),
      cy + x * Math.sin(opts.rot) + y * Math.cos(opts.rot),
    ]);
  }
  return pts;
};

const ptsToSvgPath = (pts: P2[]): string =>
  pts.map(([px, py], i) => `${i === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)}`).join(" ") + " Z";

/**
 * Variable-width thick-thin ink ring path (ported from claude-animated-shorts toon.ts `inkRing`):
 * w(theta) = w0 * (1 + k * cos(theta - thickAngle)), weighted thicker on the bottom/shadow side (~3:1 ratio).
 */
const inkRingSvgPath = (pts: P2[], w0: number, thickAngle = 1.12, k = 0.44): string => {
  const n = pts.length;
  let cx = 0;
  let cy = 0;
  for (const [px, py] of pts) {
    cx += px / n;
    cy += py / n;
  }
  const out: P2[] = [];
  const inn: P2[] = [];
  pts.forEach((q, i) => {
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    let nx = b[1] - a[1];
    let ny = a[0] - b[0];
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    const h = 0.5 * w0 * (1 + k * Math.cos(Math.atan2(q[1] - cy, q[0] - cx) - thickAngle));
    out.push([q[0] + nx * h, q[1] + ny * h]);
    inn.push([q[0] - nx * h, q[1] - ny * h]);
  });
  return `${ptsToSvgPath(out)} ${ptsToSvgPath(inn.reverse())}`;
};

/** Two-bone leg Inverse Kinematics solver (knee always bends forward +x, ported from toon.ts `ik`) */
const solveLegIK = (hip: P2, ank: P2, l1: number, l2: number): P2 => {
  const dx = ank[0] - hip[0];
  const dy = ank[1] - hip[1];
  const d = clampVal(Math.hypot(dx, dy), 1, l1 + l2 - 0.01);
  const A = Math.acos(clampVal((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const k = Math.atan2(dy, dx) - A;
  return [hip[0] + l1 * Math.cos(k), hip[1] + l1 * Math.sin(k)];
};

/**
 * 4-Frame Shaped Blinking (`[0.5, 1, 1, 0.5]`) + Automatic Blink Across Expression Swaps
 * (ported from claude-animated-shorts `lidAt` in motion.md):
 * - Blinks every 0.65 - 2.3s (20 - 69 frames at 30fps) with a 4-frame half/shut/shut/half profile.
 * - Automatically triggers a 4-frame blink across any sentence/expression swap frame so face changes never pop!
 */
const BLINK_PROFILE = [0.5, 1, 1, 0.5] as const;
const computeEyelidClosure = (f: number, seed: number, swapFrames: number[] = []): number => {
  for (const sf of swapFrames) {
    const k = Math.floor(f - sf) + 1;
    if (k >= 0 && k < 4) return BLINK_PROFILE[k];
  }
  let s = Math.floor(-30 * rnd(seed, 9));
  for (let n = 0; s <= f && n < 300; n++) {
    const k = Math.floor(f - s);
    if (k >= 0 && k < 4) return BLINK_PROFILE[k];
    s += Math.floor(20 + 48 * rnd(seed * 31 + n, 13)); // 0.67s - 2.27s gap
  }
  return 0;
};

/**
 * Cartoon Hand with 4 fingers + thumb (matches 2D comic stickman reference style).
 */
const CartoonHand: React.FC<{
  x: number;
  y: number;
  angle?: number;
  gesture?: "open" | "point" | "chin" | "chest" | "grip";
}> = ({x, y, angle = 0, gesture = "open"}) => {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      {gesture === "point" ? (
        <g fill="#FFFFFF" stroke="#111827" strokeWidth={3} strokeLinejoin="round">
          {/* Palm */}
          <ellipse cx={0} cy={0} rx={8} ry={7} />
          {/* Extended index finger */}
          <rect x={4} y={-4} width={15} height={6} rx={3} />
          {/* Curled fingers */}
          <circle cx={4} cy={4} r={3.5} />
          {/* Thumb */}
          <ellipse cx={-2} cy={-6} rx={4.5} ry={3} transform="rotate(-25 -2 -6)" />
        </g>
      ) : gesture === "chin" ? (
        <g fill="#FFFFFF" stroke="#111827" strokeWidth={3} strokeLinejoin="round">
          {/* Index finger touching chin */}
          <rect x={-3} y={-14} width={6} height={14} rx={3} transform="rotate(-12)" />
          <ellipse cx={0} cy={0} rx={8} ry={6.5} />
          <circle cx={5} cy={-1} r={3.5} />
          <circle cx={5} cy={4} r={3.2} />
        </g>
      ) : gesture === "chest" ? (
        <g fill="#FFFFFF" stroke="#111827" strokeWidth={2.8} strokeLinejoin="round">
          <ellipse cx={0} cy={0} rx={9} ry={7} />
          <rect x={2} y={-6} width={11} height={4.2} rx={2.1} />
          <rect x={3} y={-1.5} width={12} height={4.2} rx={2.1} />
          <rect x={2} y={3} width={10} height={4.2} rx={2.1} />
          <ellipse cx={-3} cy={-6} rx={5} ry={3} transform="rotate(-35 -3 -6)" />
        </g>
      ) : (
        <g fill="#FFFFFF" stroke="#111827" strokeWidth={2.8} strokeLinejoin="round">
          {/* Palm + 4 cartoon fingers */}
          <ellipse cx={0} cy={0} rx={8} ry={6.5} />
          <rect x={3} y={-5.5} width={9} height={4} rx={2} transform="rotate(-10 3 -5.5)" />
          <rect x={4} y={-1} width={10} height={4} rx={2} />
          <rect x={3} y={3.5} width={8.5} height={4} rx={2} transform="rotate(10 3 3.5)" />
          <ellipse cx={-3} cy={-5.5} rx={4.5} ry={2.8} transform="rotate(-35 -3 -5.5)" />
        </g>
      )}
    </g>
  );
};

/**
 * Expressive 2D Comic / Marshmallow Stickman ("Chibi Comic Figure"):
 * - Plump cel-shaded bean torso (with optional tunic/collar tint)
 * - Large expressive comic head with 3D crescent shading
 * - Big white sclera eyes, moving pupils, catchlight sparkles, expressive eyebrows & under-eye fatigue lines
 * - Rich mouth shapes (teeth, tongue, smirk, gasp, natural talking lip-sync)
 * - Curved articulated limbs, cartoon hands with fingers, and oval cartoon feet
 * Origin (x, y) is the ground point between the feet.
 */

/** Torso/sleeve colour of an outfit (sleeves share it so arms read as clothing, visible on any backdrop). */
const outfitFill = (outfit: StickOutfit, seed: number, color: string): string =>
  outfit === "suit"
  ? "#1E293B"
  : outfit === "office_shirt"
  ? "#38BDF8"
  : outfit === "teacher_shirt"
  ? "#4F46E5"
  : outfit === "hoodie"
  ? seed % 2 === 0
  ? "#10B981"
  : "#F59E0B"
  : outfit === "vendor_apron"
  ? "#FDE047"
  : outfit === "doctor_coat"
  ? "#0D9488"
  : outfit === "uniform"
  ? "#15803D"
  : outfit === "royal_robe"
  ? "#991B1B"
  : outfit === "soccer_jersey"
  ? seed % 2 === 0
  ? "#DC2626"
  : "#2563EB"
  : outfit === "chef_coat"
  ? "#F8FAFC"
  : outfit === "gym_tank"
  ? "#F97316"
  : outfit === "martial_gi"
  ? "#FFFFFF"
  : outfit === "ao_ba_ba"
  ? ["#5B3A29", "#1F2937", "#3B3F7A", "#6B4F3A", "#7C2D12", "#365314", "#4C1D95", "#78716C"][seed % 8]
  : outfit === "ao_dai"
  ? ["#9F1239", "#6D28D9", "#0F766E", "#B45309"][seed % 4]
  : outfit === "ao_the"
  ? ["#111827", "#1E3A5F"][seed % 2]
  : color;
const PANTS = "#475569";
/** Trouser colours picked per character (colorKey) so each person keeps one look through the video. */
const PANTS_PALETTE = ["#1F2937", "#64748B", "#3F2E22", "#0F766E", "#57534E", "#1E3A5F", "#7F1D1D", "#A8A29E"];
const SHIRT_PALETTE = ["#38BDF8", "#0EA5E9", "#14B8A6", "#F59E0B", "#A855F7", "#EF4444", "#84CC16", "#F472B6"];
const hashKey = (k: string) => {
  let h = 7;
  for (const ch of k) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h;
};
const LIMB_OUTLINE = "#0B0F17";

export const Stickman: React.FC<{
  x: number;
  y: number;
  scale?: number;
  pose?: StickPose;
  mood?: StickMood;
  prop?: StickProp;
  hat?: StickHat;
  hair?: StickHair;
  accessory?: StickAccessory;
  outfit?: StickOutfit;
  talking?: boolean;
  /** Mouth opening 0..1 from the voice level; overrides the generic talking flap when set. */
  mouth?: number;
  /** Keep the back arm visible (hand on hip / palm out) instead of tucked behind the torso. */
  backHandOnHip?: boolean;
  /** Life stage (child smaller, elder stooped with grey hair). Default adult. */
  age?: StickAge;
  /** Ghost-story look: never smiling, tired eye bags, a paler body. */
  eerie?: boolean;
  /** Character identity for colours (e.g. the character's name): same key → same shirt/trouser colours. */
  colorKey?: string;
  /** Hair style hint when no hair/hat is set: "f" gets a bun / pigtails. */
  gender?: StickGender;
  /** Pop-up mood effects (thought cloud on "think", ?! and sweat on confused/shock). Explicit bulb/question props still show. */
  moodFx?: boolean;
  color?: string;
  accent?: string;
  flip?: boolean;
  label?: string;
  bubble?: string;
  bubbleOpacity?: number;
  /** Frames elapsed since the current spoken line started (drives elastic pop-in on speech bubbles) */
  bubbleLocalFrame?: number;
  opacity?: number;
  frame?: number;
  /** Deterministic per-character seed (1, 2, 3, 4) for unique head contour & blink rhythm */
  seed?: number;
  /** Frame timestamps where sentence/expression swaps happen (triggers a 4-frame blink across swaps) */
  swapFrames?: number[];
  /** Optional custom bone/keyframe rig or MDM mocap override */
  customRig?: StickCustomRig;
  /** Optional AI-generated raw SVG for any custom handheld prop/weapon */
  customPropSvg?: string;
}> = ({
  x,
  y,
  scale = 1,
  pose = "stand",
  mood = "happy",
  prop = "none",
  hat = "none",
  hair = "none",
  accessory = "none",
  outfit = "none",
  talking = false,
  mouth,
  backHandOnHip = false,
  age = "adult",
  gender,
  eerie = false,
  colorKey,
  moodFx = true,
  color = "#FFFFFF",
  accent = "#FFD60A",
  flip = false,
  label,
  bubble,
  bubbleOpacity = 1,
  bubbleLocalFrame,
  opacity = 1,
  frame: frameProp,
  seed = 1,
  swapFrames = [],
  customRig,
  customPropSvg,
}) => {
  const now = useCurrentFrame();
  const f = frameProp ?? now;
  // eerie: smiles/cool/celebrate read wrong in a ghost story → serious; body a touch paler
  if (eerie && (mood === "happy" || mood === "cool" || mood === "celebrate" || mood === "idea" || mood === "scheming")) mood = "serious";
  if (eerie && color === "#FFFFFF") color = "#E7E5E4";
  const colorSeed = colorKey ? hashKey(colorKey) : seed;
  // everyday shirts get a per-character colour; costume outfits use their own palettes indexed by the same seed
  const SLEEVE =
    colorKey && (outfit === "office_shirt" || outfit === "hoodie" || outfit === "none")
      ? SHIRT_PALETTE[colorSeed % SHIRT_PALETTE.length]
      : outfitFill(outfit, colorSeed, color);
  const PANTS_C = colorKey ? PANTS_PALETTE[Math.floor(colorSeed / 97) % PANTS_PALETTE.length] : PANTS;
  // per-character silhouette: women trousers / knee skirt / long skirt, little boys shorts
  const bottom: "trousers" | "shorts" | "skirt" | "long_skirt" =
    !colorKey || outfit === "ao_dai" || outfit === "ao_the" || outfit === "suit" || outfit === "doctor_coat"
      ? "trousers"
      : gender === "f"
        ? (["trousers", "skirt", "long_skirt"] as const)[Math.floor(colorSeed / 31) % 3]
        : age === "child"
          ? "shorts"
          : "trousers";
  const SKIN = color; // bare legs below shorts/skirts use the body colour
  const shirtPattern: "plain" | "stripes" | "dots" =
    colorKey && (outfit === "office_shirt" || outfit === "hoodie" || outfit === "none")
      ? (["plain", "stripes", "dots"] as const)[Math.floor(colorSeed / 13) % 3]
      : "plain";
  const SLEEVE_BACK = SLEEVE; // same colour; the dark outline separates it from the torso

  const isJump = pose === "jump" || pose === "cheer";
  const isDance = pose === "dance";
  const isKneel = pose === "kneel_pray";
  const isBow = pose === "bow_respect" || isKneel;
  const isSeated = isKneel || pose === "sit" || pose === "sit_eat" || pose === "sit_type" || pose === "drive";
  const isClimb = pose === "climb";
  const isLocomotion = pose === "walk" || pose === "run" || pose === "dribble_ball";
  const isKick = pose === "kick_ball";
  const t = f * (pose === "run" || pose === "dribble_ball" ? 0.32 : isClimb ? 0.22 : pose === "walk" ? 0.22 : isDance ? 0.24 : 0.1);
  const kickSwing = isKick ? Math.sin(f * 0.24) : 0;

  // Acted Idles & Speech Cadence (from claude-animated-shorts motion.md):
  // - Non-speaking listeners stay grounded and calm (minimal idle bob, occasional gentle head nod).
  // - Active speakers (`talking === true`) have lively speech-synced cadence & head tilt.
  const talkCadence = talking ? Math.sin(f * 0.28 + seed) * 2.6 : 0;
  const breathe = talking ? Math.sin(f * 0.12 + seed) * 2.0 : Math.sin(f * 0.05 + seed * 2) * 0.7;

  // Walk/Run bob: 4-5% of height, lowest at foot contact (cos(2*t)), matching motion.md
  const walkPhase = ((f * (pose === "run" || pose === "dribble_ball" ? 0.048 : 0.036) + seed * 0.17) % 1 + 1) % 1;
  const walkBob = isLocomotion ? (pose === "run" || pose === "dribble_ball" ? 5.5 : 3.6) * Math.cos(4 * Math.PI * walkPhase) : 0;

  // No hopping: "jump"/"cheer"/"dance" keep their raised-arm gesture but stand still
  // (the 28px bounce loop was distracting and added nothing to the story).
  const bounce = isJump || isDance
    ? breathe
    : isKick
      ? -Math.max(0, kickSwing) * 8
      : isLocomotion
          ? walkBob
          : isClimb
            ? -Math.abs(Math.sin(t)) * 5
            : pose === "drive"
              ? Math.sin(f * 0.35) * 1.6
              : pose === "carry" || pose === "lift_weight"
                ? Math.abs(Math.sin(f * 0.18)) * 4.2
                : breathe - Math.abs(talkCadence) * 0.6;

  // Forward lean & dynamic step-lean cycle (from stix poses.md & claude-animated-shorts)
  const leanX =
    customRig?.leanX ??
    (pose === "slump" || pose === "crouch_inspect"
      ? 22
      : isBow
        ? isKneel
          ? 24 + Math.sin(f * 0.045) * 10
          : 26 + Math.sin(f * 0.14) * 4
        : isKick
          ? -kickSwing * 14
          : pose === "boxing_punch"
            ? 14 + Math.sin(f * 0.45) * 6
            : pose === "reach"
              ? 18
              : pose === "step_back" || pose === "laugh_belly"
                ? -10
                : pose === "think" || pose === "analyze" || pose === "read_book" || pose === "write_note" || pose === "check_phone"
                  ? 14
                  : pose === "tired"
                    ? 16
                    : isClimb
                      ? 18
                      : pose === "sit_type"
                        ? 12
                        : pose === "carry" || pose === "lift_weight"
                          ? -8
                          : isLocomotion
                            ? 5 + 3.5 * Math.cos(4 * Math.PI * walkPhase)
                            : pose === "explain" || pose === "point"
                              ? 6 + (talking ? Math.sin(f * 0.16) * 3.2 : 0)
                              : isDance
                                ? Math.sin(t * 0.5) * 10
                                : talking
                                  ? 3 + Math.sin(f * 0.14 + seed) * 2.2
                                  : 1.5);

  const hipY =
    customRig?.hipY ??
    ((isKneel
      ? -38
      : isSeated
      ? -48
      : pose === "crouch_inspect"
        ? -50
        : pose === "slump" || pose === "carry" || pose === "lift_weight" || isBow
          ? -58
          : pose === "tired" || pose === "think"
            ? -64
            : -70) + bounce);
  const shX = leanX;
  const shY =
    hipY -
    (pose === "crouch_inspect" || isBow
      ? 60
      : pose === "slump"
        ? 64
        : pose === "tired" || pose === "think" || pose === "carry"
          ? 68
          : 74);
  const headX =
    shX +
    (pose === "slump" || pose === "crouch_inspect" || isBow
      ? 14
      : pose === "reach"
        ? 10
        : pose === "step_back" || pose === "laugh_belly"
          ? -6
          : pose === "think" || pose === "analyze" || pose === "read_book" || pose === "write_note" || pose === "check_phone"
            ? 10
            : pose === "tired"
              ? 12
              : talking
                ? 2 + Math.sin(f * 0.18 + seed) * 2.4
                : 1);
  const headY =
    shY -
    (pose === "slump" || isBow
      ? 38
      : pose === "read_book" || pose === "write_note" || pose === "check_phone" || pose === "crouch_inspect"
        ? 40
        : 44);

  // Expressive Head Tilt (in degrees) around the chin
  const headTiltDeg =
    customRig?.headTiltDeg ??
    (isBow
      ? 14 + Math.sin(f * 0.14) * 3
      : pose === "laugh_belly"
        ? -12 + Math.sin(f * 0.35) * 4
        : talking
          ? Math.sin(f * 0.22 + seed) * 3.8
          : mood === "confused" || pose === "think"
            ? -4.5 + Math.sin(f * 0.06 + seed) * 1.5
            : mood === "shock"
              ? -3
              : Math.sin(f * 0.04 + seed * 3) * 1.2);

  // Cycloid + 2-Bone Inverse Kinematics Leg Mechanics
  const strideW = pose === "run" || pose === "dribble_ball" ? 44 : 30;
  const liftH = pose === "run" || pose === "dribble_ball" ? 18 : 12;
  const evalCycloidFoot = (phOffset: number) => {
    const c = ((walkPhase + phOffset) % 1 + 1) % 1;
    if (c < 0.5) {
      const s = c / 0.5;
      return {x: strideW * 0.5 - strideW * s, y: 0, pitch: 0};
    }
    const s = (c - 0.5) / 0.5;
    const cx = -strideW * 0.5 + strideW * s - (strideW / Math.PI) * Math.sin(2 * Math.PI * s);
    const cy = -liftH * Math.sin(Math.PI * s);
    const pitch = 24 * Math.sin(Math.PI * s) * (1 - 1.55 * s);
    return {x: cx, y: cy, pitch};
  };

  const lCyc = evalCycloidFoot(0);
  const rCyc = evalCycloidFoot(0.5);
  const lStep = Math.sin(t);
  const rStep = -Math.sin(t);

  const lFootX =
    customRig?.lFoot?.[0] ??
    (isKneel
      ? -20
      : isSeated
      ? 36
      : isKick
        ? -16
        : isClimb
          ? 12 + lStep * 10
          : isLocomotion
            ? lCyc.x - 2
            : -15);
  const rFootX =
    customRig?.rFoot?.[0] ??
    (isKneel
      ? -6
      : isSeated
      ? 46
      : isKick
        ? 14 + kickSwing * 46
        : isClimb
          ? 24 + rStep * 10
          : isLocomotion
            ? rCyc.x + 4
            : 17);
  const lFootY =
    customRig?.lFoot?.[1] ??
    (isKneel
      ? -4
      : isSeated
      ? -6
      : isKick
        ? 0
        : isClimb
          ? -14 + lStep * 14
          : isLocomotion
            ? lCyc.y
            : 0);
  const rFootY =
    customRig?.rFoot?.[1] ??
    (isKneel
      ? -4
      : isSeated
      ? 0
      : isKick
        ? -Math.max(0, kickSwing + 0.3) * 28
        : isClimb
          ? -14 + rStep * 14
          : isLocomotion
            ? rCyc.y
            : 0);
  const lFootPitch = isLocomotion ? lCyc.pitch : 0;
  const rFootPitch = isKick ? -kickSwing * 32 : isLocomotion ? rCyc.pitch : 0;

  // Solve 2-bone IK for left & right knees so knees ALWAYS bend anatomically forward (+X)
  const legSegLen = 38;
  const lIK = solveLegIK([-8, hipY + 4], [lFootX, lFootY], legSegLen, legSegLen);
  const rIK = solveLegIK([8, hipY + 4], [rFootX, rFootY], legSegLen, legSegLen);
  const lKneeX = isKneel ? 16 : isSeated ? 24 : isClimb ? 18 : pose === "crouch_inspect" ? 14 : isLocomotion ? lIK[0] : -8;
  const rKneeX = isKneel ? 26 : isSeated ? 30 : isClimb ? 28 : pose === "crouch_inspect" ? 24 : isLocomotion ? rIK[0] : 12;
  const lKneeY = isKneel ? -3 : isSeated ? -44 : isClimb ? hipY + 18 + lStep * 10 : pose === "crouch_inspect" ? -26 : isLocomotion ? lIK[1] : (hipY + lFootY) * 0.52;
  const rKneeY = isKneel ? -3 : isSeated ? -40 : isClimb ? hipY + 18 + rStep * 10 : pose === "crouch_inspect" ? -24 : isLocomotion ? rIK[1] : (hipY + rFootY) * 0.52;

  // Arms & Hand Gestures (default 3/4 inward posture: both arms angled naturally toward the conversation partner +X!)
  let lElbow: [number, number] = [shX - 10, shY + 28];
  let lHand: [number, number] = [shX + 14, shY + 46 + Math.sin(f * 0.08) * 2];
  let rElbow: [number, number] = [shX + 24, shY + 28];
  let rHand: [number, number] = [shX + 36, shY + 46 - Math.sin(f * 0.08) * 2];
  let lGesture: "open" | "point" | "chin" | "chest" | "grip" = "open";
  let rGesture: "open" | "point" | "chin" | "chest" | "grip" = "open";
  let lHandAngle = 18;
  let rHandAngle = 10;

  // Eating cycle (0 = resting near table, 1 = lifting food/drink right up to mouth)
  const eatCycle = pose === "sit_eat" ? (Math.sin(f * 0.16) + 1) * 0.5 : 0;

  if (pose === "drive") {
    const steer = Math.sin(f * 0.22) * 7;
    lElbow = [shX + 12, shY + 26];
    lHand = [shX + 38, shY + 24 - steer];
    lGesture = "grip";
    lHandAngle = -15;
    rElbow = [shX + 20, shY + 22];
    rHand = [shX + 48, shY + 18 + steer];
    rGesture = "grip";
    rHandAngle = -20;
  } else if (pose === "sit") {
    // Seated at a table conversing: Speaker gestures naturally at chest/table level; Listener rests hands calmly or touches chin
    lElbow = [shX - 16, shY + 28];
    lHand = [shX + 16, shY + 36];
    lGesture = "open";
    lHandAngle = 10;
    if (talking) {
      const talkG = Math.sin(f * 0.14) * 5;
      rElbow = [shX + 26, shY + 22];
      rHand = [shX + 54 + talkG, shY + 14 - talkG * 0.5];
      rGesture = prop !== "none" ? "grip" : "point";
      rHandAngle = -14;
    } else if (mood === "shock" || mood === "confused" || mood === "scheming") {
      rElbow = [shX + 30, shY + 24];
      rHand = [headX + 16, headY + 34];
      rGesture = "chin";
      rHandAngle = 0;
    } else {
      rElbow = [shX + 20, shY + 28];
      rHand = [shX + 34, shY + 36];
      rGesture = "open";
      rHandAngle = 5;
    }
  } else if (pose === "sit_eat") {
    // Seated eating actual food (peach / seafood bowl): brings food right to mouth (headX + 20, headY + 22)
    lElbow = [shX - 16, shY + 28];
    lHand = [shX + 18, shY + 38];
    lGesture = "open";
    lHandAngle = 10;
    rElbow = [shX + 28, shY + 22 - eatCycle * 12];
    rHand = [
      shX + 50 - (shX + 50 - (headX + 22)) * eatCycle,
      shY + 32 - (shY + 32 - (headY + 22)) * eatCycle,
    ];
    rGesture = "grip";
    rHandAngle = -20 - eatCycle * 25;
  } else if (pose === "sit_type") {
    // Rapidly typing with both hands on laptop keyboard
    const typeDelta = Math.sin(f * 0.65) * 6;
    lElbow = [shX + 8, shY + 28];
    lHand = [shX + 36, shY + 32 + typeDelta];
    lGesture = "open";
    lHandAngle = -10;
    rElbow = [shX + 18, shY + 28];
    rHand = [shX + 52, shY + 32 - typeDelta];
    rGesture = "open";
    rHandAngle = -10;
  } else if (pose === "climb") {
    // Alternating hands reaching high up to grip mountain/chart ledges
    const reach = Math.sin(t) * 20;
    lElbow = [shX + 8, shY - 6 + reach * 0.4];
    lHand = [shX + 28, shY - 28 + reach];
    lGesture = "grip";
    lHandAngle = -65;
    rElbow = [shX + 20, shY - 6 - reach * 0.4];
    rHand = [shX + 42, shY - 28 - reach];
    rGesture = "grip";
    rHandAngle = -55;
  } else if (pose === "analyze") {
    // Scanning up and down with a magnifying glass or pointer stick while other hand touches chin
    const scanY = Math.sin(f * 0.14) * 16;
    lElbow = [shX - 18, shY + 24];
    lHand = [headX + 12, headY + 34];
    lGesture = "chin";
    lHandAngle = 0;
    rElbow = [shX + 32, shY + 12 + scanY * 0.4];
    rHand = [shX + 64, shY - 8 + scanY];
    rGesture = "grip";
    rHandAngle = -15;
  } else if (pose === "carry") {
    // Straining while carrying heavy gold bars / crate with both hands
    const strain = Math.sin(f * 0.25) * 3;
    lElbow = [shX + 6, shY + 28];
    lHand = [shX + 38, shY + 18 + strain];
    lGesture = "grip";
    lHandAngle = -20;
    rElbow = [shX + 18, shY + 30];
    rHand = [shX + 48, shY + 22 + strain];
    rGesture = "grip";
    rHandAngle = -25;
  } else if (pose === "read_book") {
    // Holding an open 2-page reference book/document at chest/waist level (NEVER covering the face/chin!)
    const readBob = Math.sin(f * 0.14) * 2;
    lElbow = [shX + 10, shY + 34];
    lHand = [shX + 44, shY + 34 + readBob];
    lGesture = "grip";
    lHandAngle = -10;
    rElbow = [shX + 28, shY + 34];
    rHand = [shX + 68, shY + 34 + readBob];
    rGesture = "grip";
    rHandAngle = -18;
  } else if (pose === "write_note") {
    // Left hand holds clipboard/notepad at chest/waist level, Right hand writes onto the paper (NEVER covering face!)
    const scribbleX = Math.sin(f * 0.65) * 4;
    const scribbleY = Math.cos(f * 0.45) * 3;
    lElbow = [shX + 24, shY + 34];
    lHand = [shX + 62, shY + 34];
    lGesture = "grip";
    lHandAngle = -8;
    rElbow = [shX + 16, shY + 28];
    rHand = [shX + 42 + scribbleX, shY + 22 + scribbleY];
    rGesture = "grip";
    rHandAngle = 12;
  } else if (pose === "check_phone") {
    // Holding smartphone at chest level out in front (NEVER covering face!)
    const scrollBob = Math.sin(f * 0.22) * 2.5;
    lElbow = [shX - 20, shY + 28];
    lHand = [shX - 10, shY + 46];
    lGesture = "open";
    lHandAngle = 60;
    rElbow = [shX + 28, shY + 28];
    rHand = [shX + 56, shY + 24 + scrollBob];
    rGesture = "grip";
    rHandAngle = -15;
  } else if (pose === "think") {
    // Classic comic thinking pose (hand on chin, other hand resting at hip/back like Image 1)
    rElbow = [shX + 34, shY + 26];
    rHand = [headX + 18, headY + 34];
    rGesture = "chin";
    rHandAngle = 0;
    lElbow = [shX - 26, shY + 28];
    lHand = [shX - 22, shY + 56];
    lGesture = "open";
    lHandAngle = 80;
  } else if (pose === "present_check") {
    // Proud presentation pose (left hand on chest, right hand holding up checklist/prop like Image 3)
    lElbow = [shX - 28, shY + 28];
    lHand = [shX - 2, shY + 26];
    lGesture = "chest";
    lHandAngle = -10;
    rElbow = [shX + 34, shY + 18];
    rHand = [shX + 68, shY - 6 + Math.sin(f * 0.1) * 3];
    rGesture = "grip";
    rHandAngle = -15;
  } else if (pose === "wave") {
    const w = Math.sin(f * 0.26) * 12;
    rElbow = [shX + 30, shY - 2];
    rHand = [shX + 54 + w, shY - 36];
    rHandAngle = -40 + w;
    lElbow = [shX - 10, shY + 26];
    lHand = [shX + 16, shY + 42];
    lHandAngle = 15;
  } else if (pose === "point" || pose === "point-right") {
    const pointArc = talking ? Math.sin(f * 0.1) * 10 : 0;
    rElbow = [shX + 32, shY + 10];
    rHand = [shX + 70 + pointArc * 0.6, shY - 6 - pointArc * 0.5];
    rGesture = prop !== "none" || Boolean(customPropSvg) ? "grip" : "point";
    rHandAngle = -12;
    lElbow = [shX - 24, shY + 26];
    lHand = [-16, hipY - 8];
    lGesture = "chest";
    lHandAngle = 45;
  } else if (pose === "reach") {
    // Expressive reaching / presenting gesture: back hand grounded on hip, front arm sweeping smoothly from chest out toward partner/board
    const sweep = talking ? (Math.sin(f * 0.09 + seed) + 1) * 0.5 : 0.35;
    lElbow = [shX - 24, shY + 26];
    lHand = [-16, hipY - 8];
    lGesture = "chest";
    lHandAngle = 45;
    rElbow = [shX + 28 + sweep * 14, shY + 18 - sweep * 12];
    rHand = [shX + 54 + sweep * 28, shY + 16 - sweep * 26];
    rGesture = prop !== "none" || Boolean(customPropSvg) ? "grip" : sweep > 0.6 ? "point" : "open";
    rHandAngle = -8 - sweep * 14;
  } else if (pose === "slump") {
    // Exhausted / broke / defeated slouching pose: one hand on forehead/chest, other arm hanging heavy
    lElbow = [shX - 18, shY + 28];
    lHand = [-12, hipY - 4];
    lGesture = "open";
    lHandAngle = 75;
    rElbow = [shX + 18, shY + 32];
    rHand = [shX + 32, shY + 54];
    rGesture = prop !== "none" || Boolean(customPropSvg) ? "grip" : "open";
    rHandAngle = 65;
  } else if (pose === "crouch_inspect") {
    // Deep crouch leaning in to inspect a clue or number closely
    const scan = talking ? Math.sin(f * 0.11) * 8 : 0;
    lElbow = [shX - 20, shY + 26];
    lHand = [-14, hipY - 6];
    lGesture = "chest";
    lHandAngle = 40;
    rElbow = [shX + 34, shY + 16];
    rHand = [shX + 66 + scan * 0.5, shY + 8 + scan];
    rGesture = prop !== "none" || Boolean(customPropSvg) ? "grip" : "point";
    rHandAngle = -10;
  } else if (pose === "step_back") {
    // Startled / surprised recoil pose: calm defensive palm out in front, other hand on chest (NO robotic high-frequency jitter!)
    lElbow = [shX - 20, shY + 24];
    lHand = [shX + 4, shY + 24];
    lGesture = "chest";
    lHandAngle = -10;
    rElbow = [shX + 24, shY + 22];
    rHand = [shX + 52, shY + 6];
    rGesture = prop !== "none" || Boolean(customPropSvg) ? "grip" : "open";
    rHandAngle = -24;
  } else if (pose === "explain") {
    // Natural multi-phase human storytelling cadence (NO two-hand vertical bobbing in place!):
    // Back hand rests on hip or gestures gently at waist; Front hand arcs smoothly between chest, partner, and visual board
    const phase = talking ? Math.sin(f * 0.085 + seed) : -0.4;
    const lift = talking ? Math.cos(f * 0.085 + seed) : 0;
    lElbow = [shX - 24, shY + 26];
    lHand = talking && phase > 0.35 ? [shX + 22, shY + 28 - phase * 10] : [-16, hipY - 8];
    lGesture = talking && phase > 0.35 ? "open" : "chest";
    lHandAngle = talking && phase > 0.35 ? -6 : 45;
    rElbow = [shX + 28 + Math.max(0, phase) * 10, shY + 20 - Math.max(0, lift) * 8];
    rHand = [
      shX + 54 + (talking ? (phase + 1) * 12 : 4),
      shY + 14 - (talking ? lift * 16 : 0),
    ];
    rGesture =
      prop !== "none" || Boolean(customPropSvg)
        ? "grip"
        : lift > 0.45
          ? "point"
          : "open";
    rHandAngle = -10 - (talking ? lift * 12 : 0);
  } else if (pose === "shrug" || pose === "tired") {
    const openSpread = talking ? (Math.sin(f * 0.09) + 1) * 5 : 0;
    lElbow = [shX - 18, shY + 28];
    lHand = [shX + 16, shY + 22 - openSpread * 0.4];
    lGesture = "open";
    lHandAngle = -12;
    rElbow = [shX + 26, shY + 26];
    rHand = [shX + 54 + openSpread, shY + 14 - openSpread * 0.5];
    rGesture = prop !== "none" || Boolean(customPropSvg) ? "grip" : "open";
    rHandAngle = -18;
  } else if (isJump) {
    // Celebrating / Cheering toward the partner without covering the face or flinging arm far backward
    const w = Math.sin(f * 0.25) * 5;
    lElbow = [shX - 10, shY + 8];
    lHand = [shX + 18 - w, shY - 22];
    lHandAngle = -45;
    rElbow = [shX + 34, shY + 2];
    rHand = [shX + 58 + w, shY - 28];
    rHandAngle = -45;
  } else if (isDance) {
    const d = Math.sin(t) * 16;
    lElbow = [shX - 8, shY + 18];
    lHand = [shX + 22, shY + 4 + d];
    rElbow = [shX + 28, shY + 16];
    rHand = [shX + 52, shY - 2 - d];
  } else if (pose === "kick_ball") {
    // Athletic counter-balance arm swing while kicking a soccer ball
    lElbow = [shX - 18 - kickSwing * 10, shY + 14];
    lHand = [shX - 34 - kickSwing * 18, shY + 4 - kickSwing * 8];
    lHandAngle = -35;
    rElbow = [shX + 26 + kickSwing * 8, shY + 16];
    rHand = [shX + 52 + kickSwing * 14, shY + 6 + kickSwing * 6];
    rHandAngle = -15;
  } else if (pose === "cook_toss") {
    // Tossing a frying pan with right hand, seasoning with left hand
    const toss = Math.sin(f * 0.28) * 10;
    lElbow = [shX + 10, shY + 14];
    lHand = [shX + 38, shY - 4 - toss * 0.5];
    lGesture = "point";
    rElbow = [shX + 24, shY + 26];
    rHand = [shX + 54, shY + 18 - Math.abs(toss)];
    rGesture = "grip";
    rHandAngle = -12 - toss * 0.8;
  } else if (pose === "lift_weight") {
    // Overhead / bicep curl lifting heavy dumbbell
    const curl = (Math.sin(f * 0.2) + 1) * 0.5;
    lElbow = [shX - 10, shY + 24];
    lHand = [shX + 12, shY + 34];
    rElbow = [shX + 28, shY + 24 - curl * 12];
    rHand = [shX + 48, shY + 28 - curl * 48];
    rGesture = "grip";
    rHandAngle = -20 - curl * 45;
  } else if (pose === "boxing_punch") {
    // Rapid alternating boxing punches
    const punch = Math.sin(f * 0.45);
    lElbow = [shX + 14, shY + 18];
    lHand = [shX + 42 + Math.max(0, -punch) * 34, shY + 6];
    lGesture = "grip";
    rElbow = [shX + 24, shY + 14];
    rHand = [shX + 48 + Math.max(0, punch) * 38, shY + 2];
    rGesture = "grip";
  } else if (pose === "sword_slash") {
    // Dynamic high-speed sword slash arc forward (+X) with counter-balanced off-hand
    const slashWave = Math.sin(f * 0.42);
    lElbow = [shX - 18, shY + 20];
    lHand = [shX - 32 - slashWave * 8, shY + 28];
    lGesture = "open";
    rElbow = [shX + 30 + slashWave * 10, shY + 10 + slashWave * 8];
    rHand = [shX + 64 + Math.max(0, slashWave) * 18, shY + 12 + slashWave * 24];
    rGesture = "grip";
    rHandAngle = slashWave * 38;
  } else if (pose === "sword_parry") {
    // Defensive guard stance holding sword angled across front torso with sparks
    const guardVib = Math.sin(f * 0.55) * 3.5;
    lElbow = [shX + 12, shY + 22];
    lHand = [shX + 38, shY + 16 + guardVib];
    lGesture = "open";
    rElbow = [shX + 26, shY + 24];
    rHand = [shX + 54, shY + 14 - guardVib];
    rGesture = "grip";
    rHandAngle = -28;
  } else if (isBow) {
    // Clasped hands in front of chest while bowing respectfully
    lElbow = [shX + 8, shY + 24];
    lHand = [shX + 36, shY + 14];
    lGesture = "chest";
    rElbow = [shX + 18, shY + 24];
    rHand = [shX + 38, shY + 14];
    rGesture = "chest";
  } else if (pose === "phone_call") {
    // Phone against the ear (right hand), left arm relaxed — not a phone held out in front of the body
    rElbow = [shX + 34, shY + 22];
    rHand = [headX + 30, headY + 6];
    rGesture = "grip";
    rHandAngle = 70;
    lElbow = [shX - 14, shY + 30];
    lHand = [shX - 6, shY + 56];
    lGesture = "open";
    lHandAngle = 20;
  } else if (pose === "laugh_belly") {
    // Holding belly with left hand while pointing/laughing with right hand
    const laughShake = Math.sin(f * 0.4) * 4;
    lElbow = [shX - 12, shY + 28];
    lHand = [shX + 10, hipY - 14 + laughShake];
    lGesture = "chest";
    rElbow = [shX + 28, shY + 16];
    rHand = [shX + 58, shY + 4 - laughShake];
    rGesture = "point";
  } else if (pose === "walk" || pose === "run" || pose === "dribble_ball") {
    const armSwing = pose === "run" || pose === "dribble_ball" ? 26 : 18;
    lHand = [shX - Math.sin(t) * armSwing, shY + 50];
    lElbow = [shX - Math.sin(t) * armSwing * 0.5 - 8, shY + 26];
    rHand = [shX + Math.sin(t) * armSwing, shY + 50];
    rElbow = [shX + Math.sin(t) * armSwing * 0.5 + 8, shY + 26];
  }

  // Universal Held-Prop Hand Stabilizer:
  // Whenever a character is holding a prop, keep their right hand (`rHand`) steady in front of the body
  // so the held item NEVER teleports between hands, morphs into a different item, or jumps when poses/sentences change!
  const hasCustomPropSvg = Boolean(customPropSvg && customPropSvg.trim().length > 0);
  const activeProp: StickProp =
    hasCustomPropSvg || pose === "sit_type" || pose === "climb"
      ? "none"
      : prop !== "none"
        ? prop
        : pose === "write_note"
          ? "notebook"
          : pose === "read_book"
            ? "book"
            : pose === "check_phone" || pose === "phone_call"
              ? "phone"
              : "none";
  const isHoldingAnyProp = hasCustomPropSvg || activeProp !== "none";
  const isSpecialPropPose =
    pose === "phone_call" ||
    pose === "drive" ||
    pose === "sit_eat" ||
    pose === "carry" ||
    pose === "cook_toss" ||
    pose === "lift_weight" ||
    pose === "boxing_punch" ||
    pose === "sword_slash" ||
    pose === "sword_parry";

  if (isHoldingAnyProp && !isSpecialPropPose) {
    rElbow = [shX + 26, shY + 24];
    rHand = [shX + 54, shY + 18];
    rGesture = "grip";
    rHandAngle = -10;
    if (pose === "think" || pose === "analyze") {
      lElbow = [shX - 18, shY + 24];
      lHand = [headX + 12, headY + 34];
      lGesture = "chin";
      lHandAngle = 0;
    } else if (pose === "write_note" || pose === "read_book") {
      lElbow = [shX - 24, shY + 26];
      lHand = [-16, hipY - 8];
      lGesture = "chest";
      lHandAngle = 45;
    }
  }

  // A back hand tucked behind the torso reads as a missing arm — always move it out where it can be seen:
  // narrator (backHandOnHip) → hand on hip; everyone else → arm hanging relaxed beside the body.
  // story mode idle life: hands drift a little, elbows follow (slow, out of phase), so a standing figure breathes
  if (eerie && !isLocomotion && !isSeated && !isClimb) {
    const a = f * 0.05 + seed * 1.7;
    lHand = [lHand[0] + Math.sin(a) * 1.4, lHand[1] + Math.sin(a * 0.8 + 1) * 1.1];
    rHand = [rHand[0] + Math.sin(a + 2.1) * 1.4, rHand[1] + Math.sin(a * 0.8 + 3) * 1.1];
  }
  // story mode walking: arms hang close to the hips with a small swing (no big arm-flailing walk cycle)
  if (eerie && isLocomotion) {
    const sw = Math.sin(f * 0.22) * 5;
    lElbow = [shX - 24, shY + 30];
    lHand = [shX - 26 + sw, hipY - 4];
    rElbow = [shX + 26, shY + 30];
    rHand = [shX + 28 - sw, hipY - 4];
  }
  // story mode: the back hand never crosses over to the front side (no crossed arms / tangled fingers)
  if (eerie && !isSeated && lHand[0] > shX - 6) {
    lHand = [shX - 16, lHand[1]];
    lElbow = [Math.min(lElbow[0], shX - 22), lElbow[1]];
  }
  // story mode: the front hand stays on its own side too, unless the pose needs it at the face/chest
  if (
    eerie && !isSeated && rHand[0] < shX + 6 &&
    pose !== "think" && pose !== "check_phone" && pose !== "read_book" && pose !== "write_note" && pose !== "bow_respect"
  ) {
    rHand = [shX + 18, rHand[1]];
    rElbow = [Math.max(rElbow[0], shX + 22), rElbow[1]];
  }
  const tuckedBehindTorso = lHand[0] > shX - 34 && lHand[0] < shX + 26 && lHand[1] > shY + 4;
  if (
    tuckedBehindTorso &&
    !isSeated &&
    !isLocomotion &&
    !isClimb &&
    pose !== "carry" &&
    pose !== "lift_weight" &&
    pose !== "think" &&
    pose !== "read_book" &&
    pose !== "write_note" &&
    pose !== "check_phone"
  ) {
    if (pose === "shrug" || pose === "tired") {
      lElbow = [shX - 36, shY + 30];
      lHand = [shX - 50, shY + 12];
      lGesture = "open";
      lHandAngle = 200;
    } else if (backHandOnHip) {
      // Hand on hip (akimbo): elbow pointing out, knuckles resting on the waist
      lElbow = [shX - 44, shY + 36];
      lHand = [-30, hipY - 14];
      lGesture = "chest";
      lHandAngle = 160;
    } else {
      // Relaxed arm hanging just outside the torso, with a small idle sway so it never looks pasted on.
      const sway = Math.sin(f * 0.07 + seed) * 2.5;
      lElbow = [shX - 34, shY + 34];
      lHand = [shX - 38 + sway, hipY + 2];
      lHandAngle = 95;
    }
  }

  if (customRig?.lHand) lHand = customRig.lHand;
  if (customRig?.rHand) rHand = customRig.rHand;

  const dir = flip ? -1 : 1;
  const isChewing = pose === "sit_eat" && eatCycle > 0.45;
  const mouthOpen =
    mouth !== undefined && !isChewing
      ? mouth > 0.04
        ? 2.5 + Math.min(1, mouth) * 7
        : 0
      : talking || isChewing
        ? Math.abs(Math.sin(f * (isChewing ? 0.48 : 0.36))) * 6.5 + 2.5
        : 0;

  // 4-Frame Shaped Blinking (`[0.5, 1, 1, 0.5]`) + Automatic Blink on Sentence/Expression Swaps
  const lidClosure = computeEyelidClosure(f, seed, swapFrames);
  const isBlinking = lidClosure >= 1;
  const isHalfBlink = lidClosure > 0 && lidClosure < 1;

  // Locked Eye-Contact Gaze (`pupilShiftX`, `pupilShiftY`):
  // Pupils always look forward (+X) toward the conversation partner at horizontal eye-level (never rolling up or wandering sideways!)
  const isLookingAtHeldObject =
    pose === "read_book" || pose === "write_note" || pose === "check_phone" || pose === "sit_type" || pose === "crouch_inspect";
  const pupilShiftX = isLookingAtHeldObject
    ? 3.6 + Math.sin(f * 0.22) * 1.2
    : 3.8 + Math.sin(f * 0.05) * 0.5;
  const pupilShiftY = isLookingAtHeldObject ? 1.8 : 0;

  // Safe prop anchor: ALWAYS anchor to rHand so the prop never teleports to the back hand (`lHand`) on `think`!
  const propX = rHand[0] + 4;
  const propY = rHand[1] - 2;

  // Auto-wrap & balance speech bubble (1–3 balanced lines, never leaving a 1-word orphan line!)
  const rawBubble = bubble?.trim() ?? "";
  const bubbleLines: string[] = [];
  if (rawBubble) {
    const words = rawBubble.split(/\s+/).filter(Boolean);
    if (rawBubble.length <= 26 || words.length <= 4) {
      bubbleLines.push(rawBubble);
    } else {
      const targetLineCount = rawBubble.length > 56 ? 3 : 2;
      const targetChars = Math.ceil(rawBubble.length / targetLineCount) + 2;
      let cur = "";
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (next.length > Math.max(18, Math.min(29, targetChars)) && cur && bubbleLines.length < targetLineCount - 1) {
          bubbleLines.push(cur);
          cur = w;
        } else {
          cur = next;
        }
      }
      if (cur) bubbleLines.push(cur);
    }
  }
  const maxLineChars = bubbleLines.reduce((m, l) => Math.max(m, l.length), 0);
  const bubbleFontSize = maxLineChars > 32 ? 15 : maxLineChars > 27 ? 16 : bubbleLines.length > 1 ? 17 : 18;
  const bubbleW = Math.round(Math.max(184, Math.min(400, maxLineChars * (bubbleFontSize * 0.64) + 46)));
  const bubbleH = bubbleLines.length >= 3 ? 90 : bubbleLines.length === 2 ? 68 : 46;
  const bubbleTop = -bubbleH + 14;
  // Moderate, lively head-following speech bubble above character's head:
  // Smoothly tracks the character's actual head sway (headX), vertical bob (headY/bounce),
  // and head nod/tilt (headTiltDeg) at a damped ~60% ratio — expressive yet gentle on the eyes!
  const popProgress =
    bubbleLocalFrame !== undefined ? Math.max(0, Math.min(1, bubbleLocalFrame / 10)) : 1;
  const bubblePopScale =
    bubbleLocalFrame !== undefined && bubbleLocalFrame < 10
      ? 0.92 + 0.08 * popProgress + Math.sin(popProgress * Math.PI) * 0.025
      : 1;
  const bubblePopRiseY =
    bubbleLocalFrame !== undefined && bubbleLocalFrame < 10 ? (1 - popProgress) * 6 : 0;
  const bubbleTalkPulse = talking ? 1 + Math.sin(f * 0.18 + seed) * 0.007 : 1;
  const bubbleScale = bubblePopScale * bubbleTalkPulse;

  const basePostureHeadY = headY - bounce;
  const dampedHeadBounceY = Math.max(-10, Math.min(8, bounce * 0.62));
  const gentleAirFloatY = Math.sin(f * 0.1 + seed) * 1.6;
  const clampedHeadDeltaX = Math.max(-10, Math.min(14, headX - 3));
  const headFollowX = dir * (clampedHeadDeltaX * 0.6 + headTiltDeg * 0.28);

  const bubbleTiltDeg = Math.max(-1.1, Math.min(1.1, dir * headTiltDeg * 0.24));
  const bubbleX = dir * 66 + headFollowX;
  const bubbleY =
    basePostureHeadY - (hat !== "none" ? 94 : 82) + dampedHeadBounceY + gentleAirFloatY + bubblePopRiseY;

  const showUnderEyeBags = !eerie && (mood === "shock" || mood === "sad" || mood === "confused" || pose === "tired" || pose === "think");

  return (
    <g
      transform={`translate(${Math.round(x)} ${Math.round(y)}) scale(${scale * AGE_SCALE[age]})${age === "elder" ? " rotate(5)" : ""}`}
      opacity={opacity}
      textRendering="geometricPrecision"
    >
      {/* Soft Ground Contact Shadow (like reference images) */}
      <ellipse cx={0} cy={5} rx={44} ry={9} fill="rgba(15, 23, 42, 0.28)" />

      {/* Character Body & Head (flipped horizontally when facing left) */}
      <g transform={`scale(${dir} 1)`} strokeLinecap="round" strokeLinejoin="round">
        {/* 2D Cel-Shaded Comic Chair when seated at a table or desk */}
        {(pose === "sit" || pose === "sit_eat" || pose === "sit_type") && (
          <g>
            {/* Chair backrest */}
            <rect x={-32} y={hipY - 56} width={10} height={62} rx={3} fill="#D97706" stroke="#111827" strokeWidth={3.2} />
            <rect x={-36} y={hipY - 62} width={28} height={18} rx={4} fill="#F59E0B" stroke="#111827" strokeWidth={3.2} />
            {/* Chair seat */}
            <rect x={-32} y={hipY + 2} width={58} height={9} rx={3} fill="#F59E0B" stroke="#111827" strokeWidth={3.2} />
            {/* Chair legs */}
            <rect x={-28} y={hipY + 11} width={8} height={Math.max(18, -hipY - 9)} fill="#B45309" stroke="#111827" strokeWidth={2.8} />
            <rect x={14} y={hipY + 11} width={8} height={Math.max(18, -hipY - 9)} fill="#B45309" stroke="#111827" strokeWidth={2.8} />
          </g>
        )}

        {/* Back Leg (trouser colour + dark outline) */}
        <path d={`M -8 ${hipY + 4} Q ${lKneeX} ${lKneeY} ${lFootX} ${lFootY}`} stroke={LIMB_OUTLINE} strokeWidth={16} strokeLinecap="round" fill="none" />
        <path d={`M -8 ${hipY + 4} Q ${lKneeX} ${lKneeY} ${lFootX} ${lFootY}`} stroke={bottom === "trousers" ? PANTS_C : SKIN} strokeWidth={12} strokeLinecap="round" fill="none" />
        {bottom === "shorts" ? (
          <path d={`M -8 ${hipY + 4} L ${(-8 + lKneeX) / 2} ${(hipY + 4 + lKneeY) / 2}`} stroke={PANTS_C} strokeWidth={14} strokeLinecap="butt" fill="none" />
        ) : null}
        {/* Back Oval Cartoon Foot with Cycloid Ankle Pitch */}
        <ellipse
          cx={lFootX + 5}
          cy={lFootY + 2}
          rx={12}
          ry={5.5}
          transform={lFootPitch ? `rotate(${lFootPitch.toFixed(1)} ${lFootX + 5} ${lFootY + 2})` : undefined}
          fill="#FFFFFF"
          stroke="#111827"
          strokeWidth={3.5}
        />


        {/* Plump Marshmallow / Bean Torso with 3D Cel-Shading & Role Outfit (`StickOutfit`) */}
        {(() => {
          const torsoClipId = `torso-clip-${seed}-${Math.round(x)}-${Math.round(y)}`;
          const torsoD = `M ${shX - 15} ${shY}
                C ${shX - 28} ${shY + 24}, -26 ${hipY - 12}, -16 ${hipY + 6}
                Q 0 ${hipY + 14}, 18 ${hipY + 6}
                C 28 ${hipY - 12}, ${shX + 26} ${shY + 24}, ${shX + 15} ${shY}
                Q ${shX} ${shY - 6}, ${shX - 15} ${shY} Z`;
          const baseTorsoFill = colorKey ? SLEEVE : outfitFill(outfit, seed, color);
          return (
            <g>
              <defs>
                <clipPath id={torsoClipId}>
                  <path d={torsoD} />
                </clipPath>
              </defs>

              {/* Base Torso Fill */}
              <path d={torsoD} fill={baseTorsoFill} />

              {/* Clipped 2D Cartoon Outfit Details (angled 3/4 inward +X toward the conversation partner) */}
              <g clipPath={`url(#${torsoClipId})`}>
                {shirtPattern === "stripes"
                  ? [0, 1, 2, 3, 4, 5].map((i) => (
                      <rect key={i} x={-60} y={shY + 6 + i * 16} width={120} height={6} fill="rgba(255,255,255,0.28)" />
                    ))
                  : shirtPattern === "dots"
                    ? Array.from({length: 18}, (_, i) => (
                        <circle key={i} cx={-30 + (i % 6) * 13 + (Math.floor(i / 6) % 2) * 6} cy={shY + 12 + Math.floor(i / 6) * 22} r={3} fill="rgba(255,255,255,0.4)" />
                      ))
                    : null}
                {outfit === "suit" && (
                  <g>
                    {/* Crisp White V-Shirt Insert */}
                    <polygon
                      points={`${shX - 7},${shY - 6} ${shX + 18},${shY - 6} ${shX + 7},${shY + 42}`}
                      fill="#FFFFFF"
                      stroke="#111827"
                      strokeWidth={2.4}
                    />
                    {/* Blazer Lapels */}
                    <polyline
                      points={`${shX - 10},${shY + 2} ${shX - 4},${shY + 20} ${shX + 7},${shY + 42} ${shX + 17},${shY + 20} ${shX + 20},${shY + 2}`}
                      fill="none"
                      stroke="#475569"
                      strokeWidth={2.5}
                    />
                    {/* Red Silk Tie inside Suit */}
                    <polygon
                      points={`${shX + 3},${shY + 3} ${shX + 10},${shY + 3} ${shX + 8},${shY + 10} ${shX + 4},${shY + 10}`}
                      fill="#EF4444"
                      stroke="#111827"
                      strokeWidth={1.8}
                    />
                    <polygon
                      points={`${shX + 4},${shY + 10} ${shX + 8},${shY + 10} ${shX + 11},${shY + 33} ${shX + 7},${shY + 40} ${shX + 3},${shY + 33}`}
                      fill="#DC2626"
                      stroke="#111827"
                      strokeWidth={2}
                    />
                    {/* Pocket Square & Gold Blazer Buttons */}
                    <polygon
                      points={`${shX + 12},${shY + 25} ${shX + 20},${shY + 25} ${shX + 16},${shY + 17}`}
                      fill={accent}
                      stroke="#111827"
                      strokeWidth={1.8}
                    />
                    <circle cx={shX + 7} cy={shY + 48} r={2.4} fill="#FACC15" stroke="#111827" strokeWidth={1.4} />
                    <circle cx={shX + 7} cy={shY + 57} r={2.4} fill="#FACC15" stroke="#111827" strokeWidth={1.4} />
                  </g>
                )}

                {outfit === "office_shirt" && (
                  <g>
                    {/* Dark Trousers & Belt with Gold Buckle at Hip */}
                    <rect x={-34} y={hipY - 12} width={70} height={32} fill="#1E293B" stroke="#111827" strokeWidth={2.8} />
                    <rect x={-34} y={hipY - 14} width={70} height={6} fill="#0F172A" />
                    <rect x={2} y={hipY - 15} width={9} height={8} rx={1.5} fill="#FACC15" stroke="#111827" strokeWidth={1.8} />
                    {/* Button Placket & White Buttons */}
                    <line x1={shX + 7} y1={shY + 8} x2={6} y2={hipY - 14} stroke="#E0F2FE" strokeWidth={5} />
                    <circle cx={shX + 7} cy={shY + 19} r={2} fill="#FFFFFF" stroke="#111827" strokeWidth={1.4} />
                    <circle cx={shX + 7} cy={shY + 31} r={2} fill="#FFFFFF" stroke="#111827" strokeWidth={1.4} />
                    <circle cx={shX + 7} cy={shY + 43} r={2} fill="#FFFFFF" stroke="#111827" strokeWidth={1.4} />
                    {/* Crisp White Folded Shirt Collar */}
                    <polygon
                      points={`${shX - 8},${shY - 2} ${shX + 1},${shY + 12} ${shX + 7},${shY + 5} ${shX + 13},${shY + 12} ${shX + 18},${shY - 2}`}
                      fill="#FFFFFF"
                      stroke="#111827"
                      strokeWidth={2.4}
                    />
                    {/* Breast Pocket */}
                    <rect x={shX + 11} y={shY + 21} width={10} height={12} rx={2} fill="#0284C7" stroke="#111827" strokeWidth={2} />
                  </g>
                )}

                {outfit === "teacher_shirt" && (
                  <g>
                    {/* Khaki trousers & brown belt */}
                    <rect x={-34} y={hipY - 12} width={70} height={32} fill="#A16207" stroke="#111827" strokeWidth={2.8} />
                    <rect x={-34} y={hipY - 14} width={70} height={6} fill="#422006" />
                    {/* Open collar */}
                    <polygon
                      points={`${shX - 8},${shY - 2} ${shX + 2},${shY + 13} ${shX + 7},${shY + 6} ${shX + 12},${shY + 13} ${shX + 18},${shY - 2}`}
                      fill="#E0E7FF"
                      stroke="#111827"
                      strokeWidth={2.4}
                    />
                    <line x1={shX + 7} y1={shY + 10} x2={6} y2={hipY - 14} stroke="#3730A3" strokeWidth={3} />
                    {/* Pocket with a red pen */}
                    <rect x={shX + 12} y={shY + 18} width={7} height={16} rx={2} fill="#EF4444" stroke="#111827" strokeWidth={1.6} />
                    <rect x={shX + 9} y={shY + 24} width={13} height={13} rx={2} fill="#4338CA" stroke="#111827" strokeWidth={2} />
                  </g>
                )}

                {outfit === "hoodie" && (
                  <g>
                    {/* Dark Denim Jeans Waist at Hip */}
                    <rect x={-34} y={hipY - 10} width={70} height={30} fill="#1E3A8A" stroke="#111827" strokeWidth={2.8} />
                    {/* Kangaroo Front Pouch Pocket */}
                    <polygon
                      points={`-10,${hipY - 10} -5,${hipY - 27} 18,${hipY - 27} 23,${hipY - 10}`}
                      fill="rgba(15, 23, 42, 0.18)"
                      stroke="#111827"
                      strokeWidth={2.4}
                    />
                    {/* Hoodie Collar & White Drawstrings */}
                    <path
                      d={`M ${shX - 9} ${shY + 2} Q ${shX + 7} ${shY + 14} ${shX + 18} ${shY + 2}`}
                      fill="none"
                      stroke="#111827"
                      strokeWidth={3.2}
                    />
                    <line x1={shX + 3} y1={shY + 9} x2={shX + 2} y2={shY + 25} stroke="#FFFFFF" strokeWidth={2.8} strokeLinecap="round" />
                    <line x1={shX + 10} y1={shY + 9} x2={shX + 11} y2={shY + 23} stroke="#FFFFFF" strokeWidth={2.8} strokeLinecap="round" />
                  </g>
                )}

                {(outfit === "ao_ba_ba" || outfit === "ao_the") && (
                  <g>
                    {/* black trousers at the hip */}
                    <rect x={-34} y={hipY - 10} width={70} height={30} fill="#111827" />
                    {/* round collarless neck + cloth knot buttons */}
                    <path d={`M ${shX - 8} ${shY - 1} Q ${shX + 5} ${shY + 9} ${shX + 18} ${shY - 1}`} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth={2.6} />
                    {[16, 30, 44].map((dy) => (
                      <circle key={dy} cx={shX + 6} cy={shY + dy} r={2.2} fill="rgba(255,255,255,0.55)" stroke="#111827" strokeWidth={1.2} />
                    ))}
                    {/* two hip pockets of the áo bà ba */}
                    {outfit === "ao_ba_ba" ? (
                      <>
                        <rect x={-22} y={hipY - 30} width={14} height={12} rx={2} fill="rgba(0,0,0,0.18)" stroke="#111827" strokeWidth={1.6} />
                        <rect x={12} y={hipY - 30} width={14} height={12} rx={2} fill="rgba(0,0,0,0.18)" stroke="#111827" strokeWidth={1.6} />
                      </>
                    ) : null}
                  </g>
                )}

                {outfit === "ao_dai" && (
                  <g>
                    {/* high mandarin collar + diagonal fastening */}
                    <rect x={shX - 6} y={shY - 6} width={22} height={8} rx={3} fill="rgba(255,255,255,0.35)" stroke="#111827" strokeWidth={1.8} />
                    <path d={`M ${shX + 14} ${shY + 2} Q ${shX + 22} ${shY + 18} ${shX + 20} ${shY + 34}`} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={2.2} />
                  </g>
                )}

                {outfit === "vendor_apron" && (
                  <g>
                    {/* Red Street-Vendor Apron & Neck Straps */}
                    <line x1={shX - 4} y1={shY} x2={-5} y2={shY + 16} stroke="#DC2626" strokeWidth={4.5} />
                    <line x1={shX + 12} y1={shY} x2={15} y2={shY + 16} stroke="#DC2626" strokeWidth={4.5} />
                    <rect x={-18} y={shY + 15} width={48} height={68} rx={4} fill="#DC2626" stroke="#111827" strokeWidth={2.8} />
                    <rect x={-6} y={hipY - 28} width={25} height={16} rx={3} fill="#FEF08A" stroke="#111827" strokeWidth={2.4} />
                  </g>
                )}

                {outfit === "doctor_coat" && (
                  <g>
                    {/* Open White Medical Coat Panels over Teal Scrubs */}
                    <rect x={-28} y={shY - 4} width={28} height={90} fill="#FFFFFF" stroke="#111827" strokeWidth={2.5} />
                    <rect x={11} y={shY - 4} width={28} height={90} fill="#FFFFFF" stroke="#111827" strokeWidth={2.5} />
                    {/* Stethoscope around Neck */}
                    <path
                      d={`M ${shX - 6} ${shY + 2} Q ${shX - 8} ${shY + 22} ${shX - 1} ${shY + 26} M ${shX + 13} ${shY + 2} Q ${shX + 16} ${shY + 20} ${shX + 12} ${shY + 26}`}
                      fill="none"
                      stroke="#334155"
                      strokeWidth={3}
                    />
                    <circle cx={shX + 12} cy={shY + 28} r={4.5} fill="#E2E8F0" stroke="#111827" strokeWidth={2.2} />
                  </g>
                )}

                {outfit === "uniform" && (
                  <g>
                    {/* Dark Trousers & Belt with Gold Buckle */}
                    <rect x={-34} y={hipY - 12} width={70} height={32} fill="#0F172A" stroke="#111827" strokeWidth={2.8} />
                    <rect x={2} y={hipY - 15} width={9} height={8} rx={1.5} fill="#FACC15" stroke="#111827" strokeWidth={1.8} />
                    {/* Red Collar Tabs & Gold Chest Shield Badge */}
                    <polygon
                      points={`${shX - 8},${shY - 2} ${shX + 1},${shY + 11} ${shX + 7},${shY + 5} ${shX + 13},${shY + 11} ${shX + 18},${shY - 2}`}
                      fill="#EF4444"
                      stroke="#111827"
                      strokeWidth={2.2}
                    />
                    <circle cx={shX + 12} cy={shY + 22} r={5.5} fill="#FACC15" stroke="#111827" strokeWidth={2} />
                  </g>
                )}

                {outfit === "royal_robe" && (
                  <g>
                    {/* Imperial Gold Crossover Collar & Embroidered Waist Sash */}
                    <path
                      d={`M ${shX - 9} ${shY} L ${shX + 7} ${shY + 26} L ${shX + 18} ${shY} M ${shX + 7} ${shY + 26} L 6 ${hipY + 10}`}
                      fill="none"
                      stroke="#FACC15"
                      strokeWidth={5}
                    />
                    <rect x={-32} y={hipY - 18} width={68} height={11} fill="#F59E0B" stroke="#FEF08A" strokeWidth={2.2} />
                  </g>
                )}

                {outfit === "soccer_jersey" && (
                  <g>
                    {/* Sporty Shorts & Gold Collar Trim + Bold #10 Number */}
                    <rect x={-34} y={hipY - 14} width={70} height={34} fill="#FFFFFF" stroke="#111827" strokeWidth={2.6} />
                    <path
                      d={`M ${shX - 9} ${shY - 2} Q ${shX + 4} ${shY + 12} ${shX + 16} ${shY - 2}`}
                      fill="none"
                      stroke="#FACC15"
                      strokeWidth={4.5}
                    />
                    <text
                      x={shX + 5}
                      y={shY + 46}
                      textAnchor="middle"
                      fontSize={22}
                      fontWeight={900}
                      fill="#FACC15"
                      stroke="#111827"
                      strokeWidth={2.8}
                      paintOrder="stroke"
                    >
                      10
                    </text>
                  </g>
                )}

                {outfit === "chef_coat" && (
                  <g>
                    {/* Double-Breasted White Chef Coat + Red Neckerchief */}
                    <rect x={-34} y={hipY - 12} width={70} height={32} fill="#1E293B" stroke="#111827" strokeWidth={2.6} />
                    <polygon
                      points={`${shX - 10},${shY} ${shX + 18},${shY} ${shX + 6},${shY + 18}`}
                      fill="#EF4444"
                      stroke="#111827"
                      strokeWidth={2.2}
                    />
                    <line x1={shX - 2} y1={shY + 16} x2={shX - 2} y2={hipY - 12} stroke="#111827" strokeWidth={2.2} />
                    <line x1={shX + 10} y1={shY + 16} x2={shX + 10} y2={hipY - 12} stroke="#111827" strokeWidth={2.2} />
                    <circle cx={shX - 2} cy={shY + 26} r={2.6} fill="#111827" />
                    <circle cx={shX + 10} cy={shY + 26} r={2.6} fill="#111827" />
                    <circle cx={shX - 2} cy={shY + 42} r={2.6} fill="#111827" />
                    <circle cx={shX + 10} cy={shY + 42} r={2.6} fill="#111827" />
                  </g>
                )}

                {outfit === "gym_tank" && (
                  <g>
                    {/* Athletic Tank Top Cutouts & Dark Gym Shorts */}
                    <rect x={-34} y={hipY - 14} width={70} height={34} fill="#0F172A" stroke="#111827" strokeWidth={2.6} />
                    <circle cx={shX - 16} cy={shY + 14} r={11} fill={color} stroke="#111827" strokeWidth={2.2} />
                    <circle cx={shX + 18} cy={shY + 14} r={11} fill={color} stroke="#111827" strokeWidth={2.2} />
                    <rect x={-26} y={shY + 28} width={56} height={8} fill="#FACC15" opacity={0.9} />
                  </g>
                )}

                {outfit === "martial_gi" && (
                  <g>
                    {/* Crossover V-Collar Martial Arts Gi & Black Belt */}
                    <path
                      d={`M ${shX - 10} ${shY - 2} L ${shX + 6} ${shY + 34} L ${shX + 18} ${shY - 2}`}
                      fill="none"
                      stroke="#111827"
                      strokeWidth={4}
                    />
                    <rect x={-34} y={hipY - 18} width={70} height={11} fill="#111827" stroke="#FACC15" strokeWidth={1.8} />
                    <path d={`M 4 ${hipY - 10} L -4 ${hipY + 10} M 8 ${hipY - 10} L 16 ${hipY + 10}`} stroke="#111827" strokeWidth={5} strokeLinecap="round" />
                  </g>
                )}

                {customRig?.customOutfitNode}

                {/* Left-edge 3D Cel-Shade Crescent inside the bean torso */}
                <path
                  d={`M ${shX - 13} ${shY + 4}
                      C ${shX - 23} ${shY + 24}, -21 ${hipY - 12}, -12 ${hipY + 3}
                      Q -4 ${hipY + 7}, -4 ${hipY + 2}
                      C -12 ${hipY - 14}, ${shX - 13} ${shY + 24}, ${shX - 6} ${shY + 4} Z`}
                  fill="#0F172A"
                  opacity={outfit === "none" ? 0.14 : 0.18}
                />

                {outfit === "none" && (
                  /* Subtle Role Sash / Tie Accent when no outfit is worn */
                  <path
                    d={`M ${shX - 8} ${shY + 3} Q ${shX + 2} ${shY + 16} ${shX + 10} ${shY + 3}`}
                    fill="none"
                    stroke={accent}
                    strokeWidth={5}
                  />
                )}
              </g>

              {/* Outer Crisp Bold Cartoon Contour on top of clipped outfit */}
              <path d={torsoD} fill="none" stroke="#1A1423" strokeWidth={4.6} />
            </g>
          );
        })()}

        {/* Front Leg (trouser colour + dark outline) */}
        <path d={`M 8 ${hipY + 4} Q ${rKneeX} ${rKneeY} ${rFootX} ${rFootY}`} stroke={LIMB_OUTLINE} strokeWidth={16} strokeLinecap="round" fill="none" />
        <path d={`M 8 ${hipY + 4} Q ${rKneeX} ${rKneeY} ${rFootX} ${rFootY}`} stroke={bottom === "trousers" ? PANTS_C : SKIN} strokeWidth={12} strokeLinecap="round" fill="none" />
        {bottom === "shorts" ? (
          <path d={`M 8 ${hipY + 4} L ${(8 + rKneeX) / 2} ${(hipY + 4 + rKneeY) / 2}`} stroke={PANTS_C} strokeWidth={14} strokeLinecap="butt" fill="none" />
        ) : null}
        {/* Front Oval Cartoon Foot with Cycloid Ankle Pitch */}
        <ellipse
          cx={rFootX + 6}
          cy={rFootY + 2}
          rx={12.5}
          ry={5.8}
          transform={rFootPitch ? `rotate(${rFootPitch.toFixed(1)} ${rFootX + 6} ${rFootY + 2})` : undefined}
          fill="#FFFFFF"
          stroke="#111827"
          strokeWidth={3.5}
        />

        {/* Skirts (per-character silhouette) */}
        {(bottom === "skirt" || bottom === "long_skirt") && !isSeated ? (() => {
          const hem = bottom === "skirt" ? hipY * 0.45 : hipY * 0.12;
          const flare = bottom === "skirt" ? 36 : 40;
          const sway = Math.sin(f * 0.1 + colorSeed) * 2;
          return (
            <g>
              <path
                d={`M -22 ${hipY - 4} L 24 ${hipY - 4} L ${flare + sway} ${hem} Q 2 ${hem + 8} ${-flare + 4 + sway} ${hem} Z`}
                fill={PANTS_C}
                stroke={LIMB_OUTLINE}
                strokeWidth={3}
                strokeLinejoin="round"
              />
              <path d={`M -6 ${hipY + 6} L ${-10 + sway} ${hem - 2} M 10 ${hipY + 6} L ${12 + sway} ${hem - 2}`} stroke="rgba(0,0,0,0.22)" strokeWidth={2} />
            </g>
          );
        })() : null}

        {/* Large Expressive Cartoon Head with 3D Crescent Shading & Subtle Nod */}
        <g transform={`rotate(${(headTiltDeg * 0.35).toFixed(2)} ${headX} ${headY + 34})`}>
          {/* Women's long hair BEHIND the head: falls to the shoulders without covering the face */}
          {hair === "none" && gender === "f" && (age === "adult" || age === "teen") ? (
            <path
              transform={`translate(${headX} ${headY})`}
              d="M -46 -18 Q -52 22 -44 58 Q -32 66 -20 58 L 20 58 Q 32 66 44 58 Q 52 22 46 -18 Q 0 -68 -46 -18 Z"
              fill="#2A1D17"
              stroke="#0B0F17"
              strokeWidth={3}
              strokeLinejoin="round"
            />
          ) : null}
          {/* Base Round Head Circle */}
          <circle cx={headX} cy={headY} r={42} fill={color} stroke="#111827" strokeWidth={4.5} />
          {/* Crescent 3D Shadow along the back/bottom of the head */}
          <path
            d={`M ${headX - 24} ${headY - 32}
                A 39 39 0 0 0 ${headX + 12} ${headY + 37}
                A 37 40 0 0 1 ${headX - 24} ${headY - 32} Z`}
            fill="#CBD5E1"
            opacity={eerie ? 0.35 : 0.85}
          />
          {/* Re-stroke head outline cleanly on top of shadow */}
          <circle cx={headX} cy={headY} r={42} fill="none" stroke="#111827" strokeWidth={4.5} />

          {/* Hair (under any hat) */}
          {hair === "side_swoop" && (
            <g transform={`translate(${headX} ${headY})`}>
              {/* Black side-swept fringe: thick at the back of the crown, one sharp lock dipping over the forehead */}
              <path
                d="M -38 -19 C -42 -46, 8 -58, 34 -34 Q 42 -26, 42 -15
                   Q 32 -24, 20 -26 L 22 -33 Q 8 -26, -4 -27 L -2 -34
                   Q -16 -26, -28 -22 Q -34 -21, -38 -19 Z"
                fill="#111827"
                stroke="#111827"
                strokeWidth={2.5}
                strokeLinejoin="round"
              />
              {/* Sheen */}
              <path d="M -20 -42 Q -2 -50, 18 -44" fill="none" stroke="#475569" strokeWidth={3} strokeLinecap="round" />
            </g>
          )}

          {/* Age / gender hair when no explicit hair style is set */}
          {hair === "none" && (age !== "adult" || gender) && (() => {
            const grey = age === "elder";
            const fill = grey ? "#D1D5DB" : "#111827";
            const f = gender === "f";
            return (
              <g transform={`translate(${headX} ${headY})`}>
                {f && age === "elder" ? (
                  // grandma: white hair combed back + round bun on top, forehead lines
                  <>
                    {/* bun first, so the hair cap overlaps its base (attached at the back of the crown) */}
                    <circle cx={-12} cy={-46} r={15} fill="#F3F4F6" stroke="#9CA3AF" strokeWidth={2.5} />
                    <path d="M -20 -48 Q -12 -56 -4 -48" fill="none" stroke="#D1D5DB" strokeWidth={2} />
                    {/* white hair combed back, covering down to the ears */}
                    <path d="M -45 8 C -51 -48, 45 -56, 45 6 Q 41 -10 34 -18 Q 0 -30 -34 -18 Q -41 -10 -45 8 Z" fill="#F3F4F6" stroke="#9CA3AF" strokeWidth={2.5} strokeLinejoin="round" />
                    <path d="M -36 -6 Q -30 -30 -6 -38 M 36 -6 Q 30 -30 6 -38 M -22 -24 Q 0 -34 22 -24" fill="none" stroke="#D1D5DB" strokeWidth={2} strokeLinecap="round" />

                  </>
                ) : f && age !== "child" ? (
                  // young woman: crown with a side part, small bun on top (long hair is drawn behind the head)
                  <>
                    <circle cx={0} cy={-50} r={12} fill="#2A1D17" stroke="#111827" strokeWidth={2.5} />
                    <rect x={-5} y={-42} width={10} height={4} rx={2} fill="#F472B6" />
                    <path d="M -42 -6 C -46 -52, 38 -58, 43 -8 Q 34 -30, 10 -34 Q 2 -26, -6 -33 Q -28 -30, -42 -6 Z" fill="#2A1D17" stroke="#111827" strokeWidth={2.5} strokeLinejoin="round" />
                  </>
                ) : age === "child" && !f ? (
                  // little boy: short bowl cut + one curl sticking up
                  <>
                    <path d="M -42 -4 C -46 -52, 42 -54, 42 -4 Q 38 -14, 30 -12 L 26 -22 Q 0 -30, -26 -22 L -30 -12 Q -38 -14, -42 -4 Z" fill="#2A1D17" stroke="#111827" strokeWidth={2.5} strokeLinejoin="round" />
                    <path d="M 2 -46 C -4 -60, 12 -64, 10 -54" fill="none" stroke="#111827" strokeWidth={3} strokeLinecap="round" />
                  </>
                ) : grey ? (
                  // grandpa: one clean grey cap, receding at the front
                  <path d="M -42 -4 C -46 -46, 40 -52, 42 -4 Q 36 -22, 26 -28 Q 0 -36, -26 -28 Q -36 -22, -42 -4 Z" fill={fill} stroke="#6B7280" strokeWidth={2.5} strokeLinejoin="round" />
                ) : (
                  // hair cap (black)
                  <path d="M -40 -12 C -44 -50, 40 -54, 41 -12 Q 28 -30, 0 -30 Q -26 -30, -40 -12 Z" fill={fill} stroke="#111827" strokeWidth={2.5} strokeLinejoin="round" />
                )}
                {grey && !f ? (
                  // grandpa (like the reference): short dark moustache right above the mouth + small pointed white goatee
                  // under the chin. The face is 3/4, so the mouth sits at (+15, +21) from the head centre.
                  <>
                    <path d="M 8 29 Q 15 33 22 29 L 15 50 Z" transform={eerie ? "translate(-15 0)" : undefined} fill="#F3F4F6" stroke="#9CA3AF" strokeWidth={1.8} strokeLinejoin="round" />
                  </>
                ) : null}
                {f && age === "child" ? (
                  // two pigtails
                  <>
                    <path d="M -38 -14 q -18 6 -16 24 q 10 -10 18 -16 z" fill={fill} stroke="#111827" strokeWidth={2.5} />
                    <path d="M 38 -14 q 18 6 16 24 q -10 -10 -18 -16 z" fill={fill} stroke="#111827" strokeWidth={2.5} />
                  </>
                ) : null}
                {grey && !eerie ? (
                  // wrinkles under the eyes
                  <path d="M -24 14 q 6 4 12 0 M 12 14 q 6 4 12 0" fill="none" stroke="#9CA3AF" strokeWidth={1.6} strokeLinecap="round" opacity={0.6} />
                ) : null}
              </g>
            );
          })()}

          {/* Role Headwear (Crown, Scholar Hat, Official Hat, Cap) */}
          {hat === "crown" && (
            <g transform={`translate(${headX} ${headY - 38})`}>
              <polygon
                points="-30,6 -24,-22 -10,-8 0,-28 10,-8 24,-22 30,6"
                fill="#FFD60A"
                stroke="#111827"
                strokeWidth={3.5}
              />
              <circle cx={0} cy={-6} r={5} fill="#EF4444" stroke="#111827" strokeWidth={2} />
            </g>
          )}
          {hat === "scholar" && (
            <g transform={`translate(${headX} ${headY - 36})`}>
              <rect x={-30} y={-12} width={60} height={18} rx={7} fill="#1E293B" stroke="#111827" strokeWidth={3.5} />
              <rect x={-18} y={-26} width={36} height={16} rx={5} fill="#0F172A" stroke="#FFD60A" strokeWidth={2.5} />
            </g>
          )}
          {hat === "official" && (
            <g transform={`translate(${headX} ${headY - 36})`}>
              <ellipse cx={-38} cy={-4} rx={14} ry={5.5} fill="#1E293B" stroke="#111827" strokeWidth={3} />
              <ellipse cx={38} cy={-4} rx={14} ry={5.5} fill="#1E293B" stroke="#111827" strokeWidth={3} />
              <rect x={-26} y={-18} width={52} height={22} rx={7} fill="#7F1D1D" stroke="#FFD60A" strokeWidth={3} />
            </g>
          )}
          {hat === "cap" && (
            <g transform={`translate(${headX} ${headY - 34})`}>
              <path d="M -30 4 Q 0 -26 28 4 Z" fill="#0284C7" stroke="#111827" strokeWidth={3.5} />
              <line x1={-8} y1={4} x2={38} y2={4} stroke="#0284C7" strokeWidth={7} />
            </g>
          )}
          {hat === "tophat" && (
            <g transform={`translate(${headX} ${headY - 36})`}>
              {/* Tycoon / Capitalist Top Hat with Golden "$" Band */}
              <ellipse cx={0} cy={4} rx={38} ry={7} fill="#0F172A" stroke="#111827" strokeWidth={3.5} />
              <rect x={-24} y={-34} width={48} height={38} rx={4} fill="#1E293B" stroke="#111827" strokeWidth={3.5} />
              <rect x={-24} y={-8} width={48} height={10} fill="#FACC15" stroke="#111827" strokeWidth={2.5} />
              <text x={4} y={-14} textAnchor="middle" fontSize={15} fontWeight={900} fill="#FACC15" stroke="#111827" strokeWidth={2.5} paintOrder="stroke">
                $
              </text>
            </g>
          )}
          {hat === "khan_dong" && (
            <g transform={`translate(${headX} ${headY - 30})`}>
              {/* khăn đóng (as in the reference): a flat cylinder band on the crown, horizontal wraps, small ^ fold in front.
                  Sits ABOVE the eyebrows: bottom edge ≈ 14 px above the eyes. */}
              <rect x={-41} y={-18} width={82} height={26} rx={6} fill="#1F2933" stroke="#0B0F17" strokeWidth={3} />
              <path d="M -40 -10 H 40 M -40 -2 H 40" stroke="#3E4C59" strokeWidth={2.4} />
            </g>
          )}

          {hat === "non_la" && (
            <g transform={`translate(${headX} ${headY - 28})`}>
              {/* Traditional Vietnamese Conical Bamboo Hat (Nón Lá) */}
              <polygon
                points="-46,8 0,-28 46,8"
                fill="#FDE68A"
                stroke="#111827"
                strokeWidth={3.5}
                strokeLinejoin="round"
              />
              <line x1={-31} y1={-3} x2={31} y2={-3} stroke="#D97706" strokeWidth={2} />
              <line x1={-17} y1={-14} x2={17} y2={-14} stroke="#D97706" strokeWidth={2} />
              <line x1={0} y1={-28} x2={-22} y2={8} stroke="#B45309" strokeWidth={1.6} opacity={0.65} />
              <line x1={0} y1={-28} x2={22} y2={8} stroke="#B45309" strokeWidth={1.6} opacity={0.65} />
            </g>
          )}
          {hat === "non_la_back" && (
            <g>
              <g transform={`translate(${headX - 12} ${headY - 50}) rotate(-18)`}>
                {/* Small conical hat tipped back on the crown */}
                <polygon points="-40,6 0,-26 40,6" fill="#FDE68A" stroke="#111827" strokeWidth={3.5} strokeLinejoin="round" />
                <path d="M -40 6 Q 0 13 40 6" fill="none" stroke="#111827" strokeWidth={3} />
                <line x1={-26} y1={-5} x2={26} y2={-5} stroke="#D97706" strokeWidth={2} />
                <line x1={-13} y1={-15} x2={13} y2={-15} stroke="#D97706" strokeWidth={2} />
                <line x1={0} y1={-26} x2={-18} y2={6} stroke="#B45309" strokeWidth={1.5} opacity={0.6} />
                <line x1={0} y1={-26} x2={18} y2={6} stroke="#B45309" strokeWidth={1.5} opacity={0.6} />
                {/* Shade on the back slope */}
                <polygon points="-40,6 0,-26 -14,6" fill="#B45309" opacity={0.18} />
              </g>
            </g>
          )}
          {hat === "chef_hat" && (
            <g transform={`translate(${headX} ${headY - 36})`}>
              {/* Puffy White Chef Toque */}
              <path
                d="M -24 4 C -34 -12, -22 -30, -10 -24 C -4 -36, 12 -36, 16 -24 C 28 -28, 34 -10, 24 4 Z"
                fill="#FFFFFF"
                stroke="#111827"
                strokeWidth={3.5}
              />
              <rect x={-24} y={-2} width={48} height={10} rx={3} fill="#F8FAFC" stroke="#111827" strokeWidth={3} />
            </g>
          )}
          {hat === "headband" && (
            <g transform={`translate(${headX} ${headY - 24})`}>
              {/* Athletic / Martial Arts Red Headband with Trailing Tails */}
              <path d="M -38 6 Q -54 0 -62 12 M -38 8 Q -52 12 -58 22" stroke="#EF4444" strokeWidth={5} strokeLinecap="round" fill="none" />
              <rect x={-40} y={0} width={80} height={11} rx={5} fill="#EF4444" stroke="#111827" strokeWidth={3} />
            </g>
          )}
          {hat === "three_tuft" && (
            <g transform={`translate(${headX} ${headY - 40})`}>
              {/* Traditional Vietnamese Kid Three-Tuft Hair (Đầu Ba Chõm) */}
              <ellipse cx={0} cy={-4} rx={9} ry={12} fill="#111827" />
              <ellipse cx={-24} cy={6} rx={8} ry={10} transform="rotate(-28 -24 6)" fill="#111827" />
              <ellipse cx={24} cy={6} rx={8} ry={10} transform="rotate(28 24 6)" fill="#111827" />
              <circle cx={0} cy={4} r={3.5} fill="#EF4444" />
            </g>
          )}

          {/* story mode: the face looks straight at the viewer — eyes + mouth centred on the head (the default is a 3/4 face) */}
          <g transform={eerie ? "translate(-15 0)" : undefined}>
          {/* Expressive Cartoon Eyes + Lidded Half-Blink + Pupils + Eyebrows + Under-eye Bags */}
          {mood === "cool" || accessory === "scammer_bling" ? (
            <g>
              {/* Deal-With-It / Lùa Gà Golden-Framed Dark Shades */}
              <rect
                x={headX - 6}
                y={headY - 14}
                width={20}
                height={13}
                rx={3}
                fill="#111827"
                stroke={accessory === "scammer_bling" ? "#FACC15" : "#111827"}
                strokeWidth={2.5}
              />
              <rect
                x={headX + 18}
                y={headY - 14}
                width={20}
                height={13}
                rx={3}
                fill="#111827"
                stroke={accessory === "scammer_bling" ? "#FACC15" : "#111827"}
                strokeWidth={2.5}
              />
              <line x1={headX - 18} y1={headY - 9} x2={headX + 38} y2={headY - 9} stroke="#111827" strokeWidth={3.5} />
              <line x1={headX - 3} y1={headY - 11} x2={headX + 6} y2={headY - 11} stroke="#FFFFFF" strokeWidth={2} />
              <line x1={headX + 21} y1={headY - 11} x2={headX + 30} y2={headY - 11} stroke="#FFFFFF" strokeWidth={2} />
            </g>
          ) : (
            // story mode: whole eye cluster (eyes, pupils, bags, brows) at ~70 % around the midpoint between the eyes
            <g transform={eerie ? `translate(${headX + 15.5} ${headY - 4}) scale(0.7) translate(${-(headX + 15.5)} ${-(headY - 4)})` : undefined}>
              {/* Left & Right Sclera with Crisp Cartoon Outline & Natural 4-Frame Blink */}
              {isBlinking ? (
                <>
                  <path d={`M ${headX - 4} ${headY - 5} Q ${headX + 5} ${headY - 2} ${headX + 14} ${headY - 5}`} stroke="#111827" strokeWidth={3.6} fill="none" />
                  <path d={`M ${headX + 18} ${headY - 5} Q ${headX + 27} ${headY - 2} ${headX + 36} ${headY - 5}`} stroke="#111827" strokeWidth={3.6} fill="none" />
                </>
              ) : (
                <>
                  <ellipse
                    cx={headX + 5}
                    cy={headY - 6}
                    rx={mood === "shock" ? 11.2 : 10.5}
                    ry={isHalfBlink ? 7.5 : mood === "shock" ? 14.8 : 13}
                    fill="#FFFFFF"
                    stroke="#111827"
                    strokeWidth={3.2}
                  />
                  <ellipse
                    cx={headX + 26}
                    cy={headY - 6}
                    rx={mood === "shock" ? 11.2 : 10.5}
                    ry={isHalfBlink ? 7.5 : mood === "shock" ? 14.8 : 13}
                    fill="#FFFFFF"
                    stroke="#111827"
                    strokeWidth={3.2}
                  />
                  {/* Moving Black Pupils */}
                  <circle
                    cx={headX + 5 + pupilShiftX}
                    cy={headY - 6 + pupilShiftY * (isHalfBlink ? 0.4 : 1)}
                    r={mood === "shock" ? 3.8 : 5.2}
                    fill="#111827"
                  />
                  <circle
                    cx={headX + 26 + pupilShiftX}
                    cy={headY - 6 + pupilShiftY * (isHalfBlink ? 0.4 : 1)}
                    r={mood === "shock" ? 3.8 : 5.2}
                    fill="#111827"
                  />
                  {/* Subtle Catchlights on eyes */}
                  {!isHalfBlink && (
                    <>
                      <circle cx={headX + 3.5 + pupilShiftX} cy={headY - 8.5 + pupilShiftY} r={1.6} fill="#FFFFFF" />
                      <circle cx={headX + 24.5 + pupilShiftX} cy={headY - 8.5 + pupilShiftY} r={1.6} fill="#FFFFFF" />
                    </>
                  )}
                </>
              )}

              {/* Under-eye fatigue / expression lines */}
              {showUnderEyeBags && (
                <g stroke="#475569" strokeWidth={2.2} fill="none">
                  <path d={`M ${headX - 2} ${headY + 9} Q ${headX + 5} ${headY + 13} ${headX + 12} ${headY + 9}`} />
                  <path d={`M ${headX + 19} ${headY + 9} Q ${headX + 26} ${headY + 13} ${headX + 33} ${headY + 9}`} />
                </g>
              )}

              {/* Expressive Tapered Comic Eyebrows */}
              {mood === "shock" || mood === "sad" || pose === "tired" ? (
                <g stroke="#1A1423" strokeWidth={3.8} fill="none">
                  {/* Worried / Overwhelmed slanted eyebrows */}
                  <path d={`M ${headX - 6} ${headY - 20} Q ${headX + 3} ${headY - 24} ${headX + 11} ${headY - 27}`} />
                  <path d={`M ${headX + 20} ${headY - 27} Q ${headX + 28} ${headY - 24} ${headX + 37} ${headY - 20}`} />
                </g>
              ) : mood === "confused" || pose === "think" || mood === "scheming" ? (
                <g stroke="#1A1423" strokeWidth={3.8} fill="none">
                  {/* Clever / Scheming / Thinking asymmetric eyebrows (one brow raised higher, matching characters.md) */}
                  <path d={`M ${headX - 5} ${headY - 20} Q ${headX + 5} ${headY - 25} ${headX + 13} ${headY - 21}`} />
                  <path d={`M ${headX + 19} ${headY - 26} Q ${headX + 27} ${headY - 32} ${headX + 36} ${headY - 24}`} />
                </g>
              ) : mood === "serious" ? (
                <g stroke="#1A1423" strokeWidth={4.2} fill="none">
                  <line x1={headX - 5} y1={headY - 25} x2={headX + 13} y2={headY - 20} />
                  <line x1={headX + 19} y1={headY - 20} x2={headX + 36} y2={headY - 25} />
                </g>
              ) : (
                <g stroke="#1A1423" strokeWidth={3.8} fill="none">
                  {/* Happy / Proud arched eyebrows */}
                  <path d={`M ${headX - 5} ${headY - 22} Q ${headX + 5} ${headY - 29} ${headX + 13} ${headY - 23}`} />
                  <path d={`M ${headX + 19} ${headY - 23} Q ${headX + 27} ${headY - 29} ${headX + 36} ${headY - 22}`} />
                </g>
              )}
            </g>
          )}

          {/* Expressive Mouth (clean dark cavity + clipped pink tongue + crisp lip outline — no floating white gap!) */}
          {talking && (mouth === undefined || mouthOpen > 0) ? (
            <g>
              <defs>
                <clipPath id={`mouth-talk-${seed}`}>
                  <ellipse cx={headX + 15} cy={headY + 21} rx={9.5} ry={mouthOpen} />
                </clipPath>
              </defs>
              <ellipse
                cx={headX + 15}
                cy={headY + 21}
                rx={9.5}
                ry={mouthOpen}
                fill="#5A1E28"
              />
              {mouthOpen > 3.6 && (
                <ellipse
                  cx={headX + 15}
                  cy={headY + 21 + mouthOpen * 0.55}
                  rx={7.2}
                  ry={Math.max(2.5, mouthOpen * 0.55)}
                  fill="#FB7185"
                  clipPath={`url(#mouth-talk-${seed})`}
                />
              )}
              <ellipse
                cx={headX + 15}
                cy={headY + 21}
                rx={9.5}
                ry={mouthOpen}
                fill="none"
                stroke="#1A1423"
                strokeWidth={3}
              />
            </g>
          ) : mood === "shock" ? (
            <g>
              {/* Tall "O" / Gasp Mouth with clipped tongue */}
              <defs>
                <clipPath id={`mouth-shock-${seed}`}>
                  <ellipse cx={headX + 15.5} cy={headY + 21} rx={8.5} ry={6.5} />
                </clipPath>
              </defs>
              <ellipse
                cx={headX + 15.5}
                cy={headY + 21}
                rx={8.5}
                ry={6.5}
                fill="#5A1E28"
              />
              <ellipse
                cx={headX + 15.5}
                cy={headY + 25.5}
                rx={6.5}
                ry={4.2}
                fill="#FB7185"
                clipPath={`url(#mouth-shock-${seed})`}
              />
              <ellipse
                cx={headX + 15.5}
                cy={headY + 21}
                rx={8.5}
                ry={6.5}
                fill="none"
                stroke="#1A1423"
                strokeWidth={3}
              />
            </g>
          ) : mood === "celebrate" ? (
            <g>
              {/* Open D-Grin with clipped pink tongue & crisp outline */}
              <defs>
                <clipPath id={`mouth-cel-${seed}`}>
                  <path d={`M ${headX + 3} ${headY + 17} L ${headX + 27} ${headY + 17} A 12 10 0 0 1 ${headX + 3} ${headY + 17} Z`} />
                </clipPath>
              </defs>
              <path
                d={`M ${headX + 3} ${headY + 17} L ${headX + 27} ${headY + 17} A 12 10 0 0 1 ${headX + 3} ${headY + 17} Z`}
                fill="#5A1E28"
              />
              <ellipse
                cx={headX + 15}
                cy={headY + 26}
                rx={8.5}
                ry={4.8}
                fill="#FB7185"
                clipPath={`url(#mouth-cel-${seed})`}
              />
              <path
                d={`M ${headX + 3} ${headY + 17} L ${headX + 27} ${headY + 17} A 12 10 0 0 1 ${headX + 3} ${headY + 17} Z`}
                fill="none"
                stroke="#1A1423"
                strokeWidth={3}
                strokeLinejoin="round"
              />
            </g>
          ) : (pose === "think" && !eerie) || mood === "scheming" ? (
            /* Clever tilted smirk (matching toon.ts `smirk`) */
            <path
              d={`M ${headX + 2} ${headY + 18} Q ${headX + 11} ${headY + 25} ${headX + 22} ${headY + 15.5}`}
              stroke="#1A1423"
              strokeWidth={3.5}
              fill="none"
            />
          ) : mood === "sad" || mood === "confused" ? (
            <path
              d={`M ${headX + 5} ${headY + 25} Q ${headX + 15} ${headY + 16} ${headX + 25} ${headY + 25}`}
              stroke="#1A1423"
              strokeWidth={3.5}
              fill="none"
            />
          ) : mood === "serious" ? (
            <line x1={headX + 6} y1={headY + 21} x2={headX + 23} y2={headY + 20} stroke="#1A1423" strokeWidth={3.6} />
          ) : eerie ? (
            // story mode: no default smile — a small flat, uneasy mouth
            <path d={`M ${headX + 8} ${headY + 21} Q ${headX + 15} ${headY + 19} ${headX + 22} ${headY + 21}`} stroke="#1A1423" strokeWidth={3.4} fill="none" strokeLinecap="round" />
          ) : (
            /* Confident warm smile */
            <path
              d={`M ${headX + 3} ${headY + 17} Q ${headX + 15} ${headY + 29} ${headX + 27} ${headY + 17}`}
              stroke="#1A1423"
              strokeWidth={3.8}
              fill="none"
            />
          )}
          </g>
        </g>

        {/* Neck & Chest Accessories: Moderate, well-proportioned Gold Chain & Pendant for Đại Gia / Nhà Giàu, or Corporate Necktie */}
        {(accessory === "gold_chain" || accessory === "scammer_bling") && (
          <g>
            {/* Neat Gold Chain Curve around the collarbone */}
            <path
              d={`M ${shX - 11} ${shY + 3} Q ${shX + 1} ${shY + 22} ${shX + 13} ${shY + 3}`}
              fill="none"
              stroke="#111827"
              strokeWidth={6}
              strokeLinecap="round"
            />
            <path
              d={`M ${shX - 11} ${shY + 3} Q ${shX + 1} ${shY + 22} ${shX + 13} ${shY + 3}`}
              fill="none"
              stroke="#FACC15"
              strokeWidth={3.2}
              strokeDasharray="4 2"
              strokeLinecap="round"
            />
            {/* Moderate Gold Ingot Pendant sitting neatly on the chest */}
            <g transform={`translate(${shX + 1} ${shY + 26}) rotate(${Math.sin(f * 0.14) * 3})`}>
              <circle cx={0} cy={-9} r={3} fill="#FACC15" stroke="#111827" strokeWidth={2} />
              <polygon
                points="-14,9 14,9 10,-7 -10,-7"
                fill="#F59E0B"
                stroke="#111827"
                strokeWidth={2.6}
                strokeLinejoin="round"
              />
              <polygon
                points="-10,6 10,6 7,-4 -7,-4"
                fill="#FACC15"
                stroke="#B45309"
                strokeWidth={1.2}
                strokeLinejoin="round"
              />
              <text
                x={0}
                y={4}
                textAnchor="middle"
                fontSize={8.5}
                fontWeight={900}
                fill="#111827"
                fontFamily="Inter, system-ui, sans-serif"
              >
                {accessory === "scammer_bling" ? "$" : "9999"}
              </text>
            </g>
          </g>
        )}
        {accessory === "necktie" && outfit !== "suit" && (
          <g transform={`translate(${shX + 2} ${shY + 4})`}>
            <polygon points="-5,0 5,0 3,8 -3,8" fill="#EF4444" stroke="#111827" strokeWidth={2.4} />
            <polygon points="-3,8 3,8 7,34 0,42 -7,34" fill="#DC2626" stroke="#111827" strokeWidth={2.6} />
          </g>
        )}

        {/* Back Arm — drawn AFTER the torso so it is never hidden behind the body (the "one-armed" bug) */}
        <path
          d={`M ${shX - 14} ${shY + 8} Q ${lElbow[0]} ${lElbow[1]} ${lHand[0]} ${lHand[1]}`}
          stroke={LIMB_OUTLINE}
          strokeWidth={16}
          strokeLinecap="round"
          fill="none"
        />
        <path
          d={`M ${shX - 14} ${shY + 8} Q ${lElbow[0]} ${lElbow[1]} ${lHand[0]} ${lHand[1]}`}
          stroke={SLEEVE_BACK}
          strokeWidth={12}
          strokeLinecap="round"
          fill="none"
        />
        {eerie ? (
          <circle cx={lHand[0]} cy={lHand[1]} r={9} fill={color} stroke={LIMB_OUTLINE} strokeWidth={3.5} />
        ) : (
          <CartoonHand x={lHand[0]} y={lHand[1]} angle={lHandAngle} gesture={lGesture} />
        )}

        {/* Long tunic panels (áo dài / áo the) falling from the hip toward the knees, over the legs */}
        {(outfit === "ao_dai" || outfit === "ao_the") && !isSeated && (() => {
          const fill = outfit === "ao_dai" ? ["#9F1239", "#6D28D9", "#0F766E", "#B45309"][colorSeed % 4] : ["#111827", "#1E3A5F"][colorSeed % 2];
          const knee = hipY * (outfit === "ao_dai" ? 0.22 : 0.3);
          const sway = Math.sin(f * 0.11 + seed) * 2.5;
          return (
            <g>
              <path d={`M -20 ${hipY} L 20 ${hipY} L ${18 + sway} ${knee} Q 0 ${knee + 6} ${-18 + sway} ${knee} Z`} fill={fill} stroke="#111827" strokeWidth={2.8} strokeLinejoin="round" />
              <path d={`M 0 ${hipY + 4} L ${sway * 0.6} ${knee + 2}`} stroke="rgba(0,0,0,0.25)" strokeWidth={2} />
            </g>
          );
        })()}

        {/* Front Arm (drawn in front of body & head so chin-touching / checklist-holding looks natural) */}
        <path
          d={`M ${shX + 12} ${shY + 10} Q ${rElbow[0]} ${rElbow[1]} ${rHand[0]} ${rHand[1]}`}
          stroke={LIMB_OUTLINE}
          strokeWidth={16}
          strokeLinecap="round"
          fill="none"
        />
        <path
          d={`M ${shX + 12} ${shY + 10} Q ${rElbow[0]} ${rElbow[1]} ${rHand[0]} ${rHand[1]}`}
          stroke={SLEEVE}
          strokeWidth={12}
          strokeLinecap="round"
          fill="none"
        />

        {/* Handheld Props (Strictly 1 exclusive activeProp at a time, ALWAYS clamped below chin/face level shY + 32!) */}
        {activeProp === "checklist" && (
          <g transform={`translate(${Math.max(propX + 12, shX + 58)} ${Math.max(propY, shY + 32)}) scale(0.88) rotate(-6)`}>
            {/* White Paper Sheet with big Checkmark (matches Image 3) */}
            <rect x={-22} y={-28} width={44} height={54} rx={3} fill="#FFFFFF" stroke="#111827" strokeWidth={3.5} />
            <polyline
              points="-11,2 -2,12 14,-12"
              fill="none"
              stroke="#16A34A"
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        )}
        {pose === "phone_call" && (
          <g transform={`translate(${rHand[0] + 3} ${rHand[1] - 4}) rotate(8)`}>
            <rect x={-6} y={-20} width={12} height={34} rx={4} fill="#0F172A" stroke="#111827" strokeWidth={3} />
            <rect x={-3} y={-15} width={6} height={22} rx={2} fill="#38BDF8" opacity={0.75} />
          </g>
        )}
        {activeProp === "phone" && pose !== "phone_call" && (
          <g transform={`translate(${Math.max(propX + 4, shX + 52)} ${Math.max(propY, shY + 26)}) rotate(-15)`}>
            <rect x={-11} y={-22} width={22} height={38} rx={4} fill="#0F172A" stroke="#111827" strokeWidth={3} />
            <rect x={-8} y={-16} width={16} height={26} rx={2} fill="#38BDF8" opacity={0.8 + Math.sin(f * 0.25) * 0.2} />
            {/* Animated notification / news feed bars on screen */}
            <line x1={-5} y1={-10} x2={5} y2={-10} stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" />
            <line x1={-5} y1={-4} x2={3} y2={-4} stroke="#FEF08A" strokeWidth={2.2} strokeLinecap="round" />
            <line x1={-5} y1={2} x2={5} y2={2} stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" />
          </g>
        )}
        {activeProp === "book" && (
          <g
            transform={`translate(${Math.max((lHand[0] + rHand[0]) * 0.5 + 16, shX + 62)} ${Math.max(rHand[1] + 6, shY + 36)}) scale(0.84) rotate(-6)`}
          >
            {/* Open 2-Page Hardcover Reference Book / Document held cleanly at chest/waist level */}
            <rect x={-32} y={-22} width={64} height={42} rx={4} fill="#EF4444" stroke="#111827" strokeWidth={3.2} />
            {/* Left Page */}
            <path d="M -28 -19 Q -14 -22 0 -17 L 0 17 Q -14 14 -28 17 Z" fill="#FFFFFF" stroke="#111827" strokeWidth={2.4} />
            {/* Right Page */}
            <path d="M 0 -17 Q 14 -22 28 -19 L 28 17 Q 14 14 0 17 Z" fill="#F8FAFC" stroke="#111827" strokeWidth={2.4} />
            {/* Text lines on left & right pages */}
            {[-10, -3, 4, 10].map((ly) => (
              <g key={ly} stroke="#475569" strokeWidth={2} strokeLinecap="round">
                <line x1={-22} y1={ly} x2={-5} y2={ly} />
                <line x1={5} y1={ly} x2={22} y2={ly} />
              </g>
            ))}
            {/* Animated Flipping Page Leaf */}
            <path
              d={`M 0 -17 Q ${Math.sin(f * 0.18) * 22} -26 ${Math.sin(f * 0.18) * 24} 14 L 0 17 Z`}
              fill="#FEF08A"
              stroke="#111827"
              strokeWidth={1.8}
              opacity={0.9}
            />
          </g>
        )}
        {activeProp === "notebook" && (
          <g transform={`translate(${Math.max(lHand[0] + 12, shX + 58)} ${Math.max(lHand[1], shY + 34)}) scale(0.86) rotate(-8)`}>
            {/* Single Clipboard / Notepad held out in front at chest/waist level */}
            <rect x={-20} y={-26} width={40} height={50} rx={4} fill="#D97706" stroke="#111827" strokeWidth={3} />
            <rect x={-16} y={-20} width={32} height={40} rx={2} fill="#FFFFFF" stroke="#111827" strokeWidth={2.2} />
            <rect x={-8} y={-28} width={16} height={6} rx={2} fill="#64748B" stroke="#111827" strokeWidth={2} />
            {[-11, -3, 5, 13].map((ny) => (
              <line key={ny} x1={-11} y1={ny} x2={10} y2={ny} stroke="#334155" strokeWidth={2.2} strokeLinecap="round" />
            ))}
          </g>
        )}
        {pose === "sit_type" && (
          <g transform={`translate(${shX + 56} ${shY + 34})`}>
            {/* Open Laptop resting flush on the desk surface right under typing hands */}
            <line x1={-22} y1={2} x2={16} y2={2} stroke="#334155" strokeWidth={5.5} strokeLinecap="round" />
            <g transform="translate(8, 2) rotate(-14)">
              <rect x={-6} y={-36} width={44} height={34} rx={4} fill="#0F172A" stroke="#111827" strokeWidth={3} />
              <rect x={-2} y={-32} width={36} height={26} rx={2} fill="#1E293B" />
              <line x1={2} y1={-25} x2={24} y2={-25} stroke="#38BDF8" strokeWidth={2.5} strokeLinecap="round" />
              <line x1={2} y1={-18} x2={14 + Math.sin(f * 0.4) * 8} y2={-18} stroke="#22C55E" strokeWidth={2.5} strokeLinecap="round" />
              <line x1={2} y1={-11} x2={28} y2={-11} stroke="#FACC15" strokeWidth={2.5} strokeLinecap="round" />
            </g>
          </g>
        )}
        {activeProp === "money" && (
          <g transform={`translate(${propX + 4} ${propY - 6}) rotate(-10)`}>
            {/* Thick Fanned Stack of Cash Bills with Gold Band */}
            <rect x={-20} y={-18} width={40} height={24} rx={3} transform="rotate(-14)" fill="#16A34A" stroke="#111827" strokeWidth={2.8} />
            <rect x={-20} y={-15} width={40} height={24} rx={3} transform="rotate(-5)" fill="#22C55E" stroke="#111827" strokeWidth={2.8} />
            <rect x={-20} y={-12} width={42} height={24} rx={3} fill="#4ADE80" stroke="#111827" strokeWidth={3} />
            <rect x={-4} y={-12} width={10} height={24} fill="#FACC15" stroke="#111827" strokeWidth={2.2} />
            <text x={1} y={4} textAnchor="middle" fontSize={14} fontWeight={900} fill="#111827">
              $
            </text>
          </g>
        )}
        {activeProp === "megaphone" && (
          <g transform={`translate(${propX + 8} ${propY - 8}) rotate(-15)`}>
            {/* Scammer / Hype Megaphone ("Loa Lùa Gà X100!") */}
            <rect x={-14} y={4} width={8} height={18} rx={2} fill="#334155" stroke="#111827" strokeWidth={2.5} />
            <polygon points="-16,-8 22,-24 22,16 -16,4" fill="#EF4444" stroke="#111827" strokeWidth={3.2} strokeLinejoin="round" />
            <ellipse cx={22} cy={-4} rx={6} ry={20} fill="#FACC15" stroke="#111827" strokeWidth={3} />
            {/* Sound waves */}
            <line x1={32} y1={-12} x2={44} y2={-18} stroke="#FACC15" strokeWidth={3.2} strokeLinecap="round" />
            <line x1={34} y1={-4} x2={48} y2={-4} stroke="#FACC15" strokeWidth={3.2} strokeLinecap="round" />
            <line x1={32} y1={4} x2={44} y2={10} stroke="#FACC15" strokeWidth={3.2} strokeLinecap="round" />
          </g>
        )}
        {activeProp === "coffee" && (
          <g transform={`translate(${propX + 4} ${propY - 4})`}>
            {/* Angled Red Straw */}
            <line x1={2} y1={-14} x2={9} y2={-30} stroke="#EF4444" strokeWidth={4} strokeLinecap="round" />
            {/* Takeaway Cup Body (tapered trapezoid, never a candle!) */}
            <polygon points="-13,-14 13,-14 10,16 -10,16" fill="#FDE68A" stroke="#111827" strokeWidth={3} strokeLinejoin="round" />
            {/* Cup Sleeve */}
            <polygon points="-11.5,-4 11.5,-4 10.5,6 -10.5,6" fill="#D97706" stroke="#111827" strokeWidth={2.2} />
            {/* Boba Pearls at bottom */}
            <circle cx={-4} cy={11} r={2.3} fill="#111827" />
            <circle cx={2} cy={11.5} r={2.3} fill="#111827" />
            <circle cx={6} cy={10.5} r={2.1} fill="#111827" />
            {/* White Flat Lid */}
            <rect x={-15} y={-18} width={30} height={5} rx={2.5} fill="#FFFFFF" stroke="#111827" strokeWidth={2.6} />
          </g>
        )}
        {activeProp === "soda_can" && (
          <g transform={`translate(${propX + 13} ${propY - 6}) rotate(-8)`}>
            {/* Fizzy Carbonation Bubbles above Open Can Tab */}
            <circle cx={-3} cy={-25 - ((f * 0.35) % 8)} r={2.3} fill="#BAE6FD" stroke="#111827" strokeWidth={1.4} />
            <circle cx={5} cy={-29 - (((f + 11) * 0.35) % 8)} r={1.9} fill="#FFFFFF" stroke="#111827" strokeWidth={1.3} />
            {/* Pull-Tab on Rim */}
            <ellipse cx={3} cy={-21} rx={4.5} ry={2.5} fill="#E2E8F0" stroke="#111827" strokeWidth={2} />
            {/* Sleek Matte Charcoal Zero-Calorie Aluminum Can Body */}
            <rect x={-13} y={-18} width={26} height={36} rx={5} fill="#0F172A" stroke="#111827" strokeWidth={3} />
            {/* Metallic Silver Top & Bottom Beveled Rims */}
            <rect x={-12} y={-19} width={24} height={4.5} rx={2} fill="#CBD5E1" stroke="#111827" strokeWidth={2.2} />
            <rect x={-11.5} y={15} width={23} height={4} rx={2} fill="#94A3B8" stroke="#111827" strokeWidth={2.2} />
            {/* Bold Crimson "ZERO" Center Band */}
            <rect x={-13} y={-7} width={26} height={13} fill="#EF4444" stroke="#111827" strokeWidth={2.2} />
            <text
              x={0}
              y={2.5}
              textAnchor="middle"
              fontSize={7.8}
              fontWeight={900}
              fill="#FFFFFF"
              fontFamily="Be Vietnam Pro, Inter, sans-serif"
            >
              ZERO
            </text>
            {/* Cold Condensation Highlight */}
            <line x1={-8} y1={-12} x2={-8} y2={11} stroke="rgba(255,255,255,0.32)" strokeWidth={2.2} strokeLinecap="round" />
          </g>
        )}
        {activeProp === "water_bottle" && (
          <g transform={`translate(${propX + 12} ${propY - 6}) rotate(-8)`}>
            {/* Bottle Cap & Neck */}
            <rect x={-6} y={-24} width={12} height={6} rx={2} fill="#0284C7" stroke="#111827" strokeWidth={2.4} />
            <polygon points="-7,-18 7,-18 12,-10 -12,-10" fill="#E0F2FE" stroke="#111827" strokeWidth={2.6} />
            {/* Clear Mineral Water Bottle Body */}
            <rect x={-12} y={-10} width={24} height={29} rx={5} fill="#BAE6FD" stroke="#111827" strokeWidth={2.8} />
            {/* Pure Blue Label Band */}
            <rect x={-12} y={-1} width={24} height={10} fill="#0284C7" stroke="#111827" strokeWidth={2} />
            <circle cx={0} cy={4} r={2.8} fill="#FFFFFF" />
          </g>
        )}
        {activeProp === "laptop" && (
          <g transform={`translate(${propX + 6} ${propY - 2})`}>
            <rect x={-20} y={-18} width={36} height={24} rx={3} fill="#334155" stroke="#111827" strokeWidth={3} />
            <line x1={-24} y1={6} x2={20} y2={6} stroke="#E2E8F0" strokeWidth={4.5} />
          </g>
        )}
        {activeProp === "chart" && (
          <g transform={`translate(${propX + 8} ${propY - 4}) scale(0.84)`}>
            <rect x={-22} y={-24} width={44} height={46} rx={5} fill="#0F172A" stroke="#111827" strokeWidth={3.5} />
            <rect x={-14} y={0} width={7} height={14} rx={1.5} fill="#38BDF8" />
            <rect x={-3} y={-8} width={7} height={22} rx={1.5} fill="#FACC15" />
            <rect x={8} y={-16} width={7} height={30} rx={1.5} fill="#F43F5E" />
          </g>
        )}
        {activeProp === "peach" && (
          <g transform={`translate(${propX + 4} ${propY - 6})`}>
            <path d="M 0 -20 C 16 -20 20 -2 0 16 C -20 -2 -16 -20 0 -20 Z" fill="#FB7185" stroke="#111827" strokeWidth={3} />
            <ellipse cx={7} cy={-15} rx={8} ry={4.5} transform="rotate(-25 7 -15)" fill="#22C55E" stroke="#111827" strokeWidth={2.5} />
          </g>
        )}
        {activeProp === "scroll" && (
          <g transform={`translate(${propX + 8} ${propY - 2}) rotate(-8)`}>
            {/* Clipboard Backing Board */}
            <rect x={-19} y={-24} width={38} height={48} rx={4.5} fill="#D97706" stroke="#111827" strokeWidth={3} />
            {/* White Contract / Document Sheet */}
            <rect x={-15} y={-19} width={30} height={38} rx={2} fill="#FFFFFF" stroke="#111827" strokeWidth={2.2} />
            {/* Metallic Top Clip */}
            <rect x={-9} y={-27} width={18} height={7} rx={2.5} fill="#94A3B8" stroke="#111827" strokeWidth={2.4} />
            {/* Contract Header Bar & Clause Lines */}
            <rect x={-11} y={-14} width={22} height={4.5} rx={1.5} fill="#EF4444" />
            <line x1={-11} y1={-5} x2={11} y2={-5} stroke="#334155" strokeWidth={2.2} strokeLinecap="round" />
            <line x1={-11} y1={1} x2={9} y2={1} stroke="#334155" strokeWidth={2.2} strokeLinecap="round" />
            <line x1={-11} y1={7} x2={3} y2={7} stroke="#334155" strokeWidth={2.2} strokeLinecap="round" />
            {/* Red Official Contract Stamp */}
            <circle cx={7} cy={11} r={5} fill="rgba(239, 68, 68, 0.22)" stroke="#EF4444" strokeWidth={2} />
            <circle cx={7} cy={11} r={1.8} fill="#EF4444" />
          </g>
        )}
        {activeProp === "fan" && (
          <g transform={`translate(${propX + 4} ${propY - 4}) rotate(-15)`}>
            <path d="M 0 12 L -20 -14 Q 0 -28 20 -14 Z" fill="#FEF08A" stroke="#111827" strokeWidth={3} />
            <line x1={0} y1={12} x2={-9} y2={-16} stroke="#B45309" strokeWidth={2} />
            <line x1={0} y1={12} x2={9} y2={-16} stroke="#B45309" strokeWidth={2} />
          </g>
        )}
        {activeProp === "sword" && (
          <g transform={`translate(${propX + 6} ${propY - 4}) rotate(-20)`}>
            <polygon points="-4,4 5,4 6,-44 0,-54 -5,-44" fill="#E2E8F0" stroke="#111827" strokeWidth={2.8} />
            <line x1={1} y1={2} x2={1} y2={-46} stroke="#38BDF8" strokeWidth={2} />
            <rect x={-11} y={4} width={22} height={5.5} rx={2} fill="#FACC15" stroke="#111827" strokeWidth={2.2} />
            <rect x={-3.5} y={9.5} width={7} height={13} rx={2} fill="#991B1B" stroke="#111827" strokeWidth={2.2} />
          </g>
        )}
        {activeProp === "magnifier" && (
          <g transform={`translate(${propX + 6} ${propY - 10}) rotate(-18)`}>
            <rect x={-4} y={10} width={8} height={24} rx={3} fill="#78350F" stroke="#111827" strokeWidth={2.8} />
            <circle cx={0} cy={-12} r={22} fill="rgba(56, 189, 248, 0.35)" stroke="#111827" strokeWidth={4} />
            <circle cx={0} cy={-12} r={17} fill="none" stroke="#BAE6FD" strokeWidth={2.5} />
            <line x1={-9} y1={-20} x2={-2} y2={-24} stroke="#FFFFFF" strokeWidth={3} strokeLinecap="round" />
          </g>
        )}
        {activeProp === "pointer" && (
          <g transform={`translate(${propX + 4} ${propY - 4}) rotate(-28)`}>
            <line x1={0} y1={8} x2={58} y2={-38} stroke="#B45309" strokeWidth={5} strokeLinecap="round" />
            <circle cx={58} cy={-38} r={5.5} fill="#EF4444" stroke="#111827" strokeWidth={2.5} />
          </g>
        )}
        {activeProp === "gold" && (
          <g transform={`translate(${propX + 4} ${propY - 6})`}>
            {/* Heavy Stack of 999.9 Gold Bullion Bars */}
            <polygon points="-24,6 24,6 18,-8 -18,-8" fill="#F59E0B" stroke="#111827" strokeWidth={3} />
            <polygon points="-18,-8 18,-8 13,-21 -13,-21" fill="#FACC15" stroke="#111827" strokeWidth={3} />
            <line x1={-6} y1={-28} x2={-10} y2={-36} stroke="#FEF08A" strokeWidth={2.5} strokeLinecap="round" />
            <line x1={8} y1={-28} x2={12} y2={-36} stroke="#FEF08A" strokeWidth={2.5} strokeLinecap="round" />
          </g>
        )}
        {activeProp === "bowl" && (
          <g transform={`translate(${propX + 4} ${propY - 4})`}>
            {/* Steaming Hot Bowl of Food + Chopsticks */}
            <line x1={-4} y1={-16} x2={18} y2={-28} stroke="#78350F" strokeWidth={3} strokeLinecap="round" />
            <line x1={0} y1={-12} x2={20} y2={-22} stroke="#78350F" strokeWidth={3} strokeLinecap="round" />
            <path d="M -20 -8 L 20 -8 Q 16 14 0 14 Q -16 14 -20 -8 Z" fill="#FB7185" stroke="#111827" strokeWidth={3} />
            <ellipse cx={0} cy={-8} rx={20} ry={5} fill="#FEF08A" stroke="#111827" strokeWidth={2.5} />
          </g>
        )}
        {activeProp === "wheel" && (
          <g transform={`translate(${rHand[0] + 6} ${rHand[1] - 2}) rotate(${Math.sin(f * 0.22) * 18})`}>
            <circle cx={0} cy={0} r={20} fill="none" stroke="#1E293B" strokeWidth={5.5} />
            <circle cx={0} cy={0} r={5.5} fill="#38BDF8" stroke="#111827" strokeWidth={2.5} />
            <line x1={-18} y1={0} x2={18} y2={0} stroke="#1E293B" strokeWidth={4} />
            <line x1={0} y1={0} x2={0} y2={18} stroke="#1E293B" strokeWidth={4} />
          </g>
        )}
        {activeProp === "soccer_ball" && (
          <g
            transform={`translate(${
              pose === "kick_ball"
                ? rFootX + 26 + Math.max(0, Math.sin(f * 0.28)) * 42
                : rFootX + 18 + Math.sin(f * 0.34) * 10
            } ${
              pose === "kick_ball"
                ? rFootY - 6 - Math.max(0, Math.sin(f * 0.28)) * 28
                : -12 - Math.abs(Math.cos(f * 0.34)) * 18
            }) rotate(${(f * 14) % 360})`}
          >
            <circle cx={0} cy={0} r={16} fill="#FFFFFF" stroke="#111827" strokeWidth={3.2} />
            <polygon points="0,-7 6,-2 4,5 -4,5 -6,-2" fill="#111827" />
            <line x1={0} y1={-7} x2={0} y2={-16} stroke="#111827" strokeWidth={2.2} />
            <line x1={6} y1={-2} x2={15} y2={-5} stroke="#111827" strokeWidth={2.2} />
            <line x1={4} y1={5} x2={10} y2={13} stroke="#111827" strokeWidth={2.2} />
            <line x1={-4} y1={5} x2={-10} y2={13} stroke="#111827" strokeWidth={2.2} />
            <line x1={-6} y1={-2} x2={-15} y2={-5} stroke="#111827" strokeWidth={2.2} />
          </g>
        )}
        {activeProp === "frying_pan" && (
          <g transform={`translate(${rHand[0] + 4} ${rHand[1] - 2}) rotate(${Math.sin(f * 0.36) * 14 - 8})`}>
            {/* Skillet Handle & Pan Body + Sizzling Food Toss */}
            <line x1={-8} y1={2} x2={10} y2={2} stroke="#111827" strokeWidth={5} strokeLinecap="round" />
            <path d="M 8 -4 L 46 -4 L 40 8 L 12 8 Z" fill="#334155" stroke="#111827" strokeWidth={3} />
            <circle
              cx={26}
              cy={-12 - Math.abs(Math.sin(f * 0.36)) * 18}
              r={6}
              fill="#FACC15"
              stroke="#111827"
              strokeWidth={2.2}
            />
            <path
              d={`M 18 -8 Q 22 ${-18 - Math.abs(Math.sin(f * 0.36)) * 12} 26 -8`}
              fill="none"
              stroke="#FB923C"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          </g>
        )}
        {activeProp === "dumbbell" && (
          <g transform={`translate(${rHand[0]} ${rHand[1]})`}>
            <line x1={-20} y1={0} x2={20} y2={0} stroke="#475569" strokeWidth={5} strokeLinecap="round" />
            <rect x={-26} y={-12} width={8} height={24} rx={2.5} fill="#0F172A" stroke="#111827" strokeWidth={2.5} />
            <rect x={18} y={-12} width={8} height={24} rx={2.5} fill="#0F172A" stroke="#111827" strokeWidth={2.5} />
          </g>
        )}
        {activeProp === "microphone" && (
          <g transform={`translate(${propX + 4} ${propY - 8}) rotate(-18)`}>
            <rect x={-4} y={-2} width={8} height={22} rx={3} fill="#334155" stroke="#111827" strokeWidth={2.6} />
            <circle cx={0} cy={-8} r={9} fill="#94A3B8" stroke="#111827" strokeWidth={2.8} />
            <line x1={-6} y1={-8} x2={6} y2={-8} stroke="#111827" strokeWidth={2} />
          </g>
        )}
        {activeProp === "trophy" && (
          <g transform={`translate(${propX + 6} ${propY - 10})`}>
            <path d="M -14 -18 L 14 -18 Q 12 4 0 6 Q -12 4 -14 -18 Z" fill="#FACC15" stroke="#111827" strokeWidth={2.8} />
            <path d="M -14 -14 C -22 -14, -22 -2, -11 -2 M 14 -14 C 22 -14, 22 -2, 11 -2" fill="none" stroke="#F59E0B" strokeWidth={3} />
            <rect x={-4} y={6} width={8} height={8} fill="#F59E0B" stroke="#111827" strokeWidth={2.2} />
            <rect x={-11} y={14} width={22} height={6} rx={2} fill="#78350F" stroke="#111827" strokeWidth={2.5} />
          </g>
        )}
        {hasCustomPropSvg && (
          <g
            transform={`translate(${propX + 12} ${propY - 5}) rotate(-8) scale(1.06)`}
            dangerouslySetInnerHTML={{
              __html: (customPropSvg ?? "")
                .replace(/<\/?svg[^>]*>/gi, "")
                .replace(/<script[\s\S]*?<\/script>/gi, ""),
            }}
          />
        )}
        {customRig?.customPropNode}

        {/* Front Cartoon Hand with Fingers */}
        {eerie ? (
          <circle cx={rHand[0]} cy={rHand[1]} r={9} fill={color} stroke={LIMB_OUTLINE} strokeWidth={3.5} />
        ) : (
          <CartoonHand x={rHand[0]} y={rHand[1]} angle={rHandAngle} gesture={rGesture} />
        )}

        {/* Visible Yellow Pencil / Pen held in Front Hand when writing on the clipboard */}
        {activeProp === "notebook" && (
          <g transform={`translate(${rHand[0]} ${rHand[1]}) rotate(16)`}>
            {/* Pink Eraser end */}
            <rect x={-12} y={-3.5} width={6} height={7} rx={1.5} fill="#FB7185" stroke="#111827" strokeWidth={2} />
            {/* Yellow Pencil Barrel extending forward (+X) from hand toward the clipboard */}
            <rect x={-6} y={-3.5} width={24} height={7} rx={1} fill="#FACC15" stroke="#111827" strokeWidth={2.2} />
            {/* Sharpened Wood & Graphite Tip touching the paper */}
            <polygon points="18,-3.5 27,0 18,3.5" fill="#FDE68A" stroke="#111827" strokeWidth={2} />
            <circle cx={25.5} cy={0} r={2} fill="#111827" />
          </g>
        )}
      </g>

      {/* Fluffy Comic Thought Cloud with Glowing Lightning Bolt (positioned on outer side -dir*68 so it NEVER collides with center speech bubbles!) */}
      {(prop === "bulb" || (moodFx && pose === "think")) && !rawBubble && (
        <g transform={`translate(${-dir * 68} ${headY - (hat !== "none" ? 96 : 80) + Math.sin(f * 0.14) * 3})`}>
          {/* Trailing thought bubbles o O */}
          <circle cx={dir * 34} cy={30} r={4.5} fill="#FFFFFF" stroke="#111827" strokeWidth={2.8} />
          <circle cx={dir * 22} cy={18} r={7} fill="#FFFFFF" stroke="#111827" strokeWidth={3} />
          {/* Golden outer glow */}
          <circle cx={0} cy={-8} r={38} fill="rgba(250, 204, 21, 0.28)" />
          {/* Fluffy Cloud Shape */}
          <path
            d="M -26 6
               C -38 6, -42 -12, -28 -18
               C -28 -32, -8 -36, 0 -26
               C 10 -36, 28 -30, 28 -16
               C 42 -12, 38 8, 24 8
               C 18 18, -16 18, -26 6 Z"
            fill="#FFFFFF"
            stroke="#111827"
            strokeWidth={3.5}
          />
          {/* Lightning Bolt + Sparkles inside Thought Cloud */}
          <polygon
            points="4,-22 -10,-4 0,-4 -5,12 12,-6 2,-6"
            fill="#FACC15"
            stroke="#111827"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          <circle cx={-16} cy={-12} r={2.5} fill="#FACC15" />
          <circle cx={18} cy={-10} r={2.5} fill="#FACC15" />
        </g>
      )}

      {/* Overwhelmed Sweat Drops & Question Mark when shocked/confused (outer side so it never collides with speech bubbles) */}
      {(prop === "question" || (moodFx && (mood === "confused" || mood === "shock"))) && !rawBubble && (
        <g transform={`translate(${-dir * 52} ${headY - 46 + Math.sin(f * 0.2) * 3})`}>
          <path d="M -18 8 C -22 16, -14 20, -14 12 Z" fill="#38BDF8" stroke="#111827" strokeWidth={2} />
          <text
            x={4}
            y={4}
            textAnchor="middle"
            fontSize={30}
            fontWeight={900}
            fill="#FF375F"
            stroke="#111827"
            strokeWidth={4.5}
            paintOrder="stroke"
            fontFamily="sans-serif"
          >
            ?!
          </text>
        </g>
      )}

      {/* Lively Character Speech Bubble (floats, tilts & pops in with character while center stage text stays still) */}
      {bubbleLines.length > 0 && bubbleOpacity > 0.02 ? (
        <g
          transform={`translate(${bubbleX.toFixed(2)} ${bubbleY.toFixed(2)}) rotate(${bubbleTiltDeg.toFixed(2)}) scale(${bubbleScale.toFixed(3)})`}
          opacity={bubbleOpacity}
          textRendering="geometricPrecision"
        >
          <rect
            x={-bubbleW / 2}
            y={bubbleTop}
            width={bubbleW}
            height={bubbleH}
            rx={18}
            fill="#FFFFFF"
            stroke="#111827"
            strokeWidth={3.8}
          />
          <polygon
            points={`${-dir * 32},14 ${-dir * 48},28 ${-dir * 16},14`}
            fill="#FFFFFF"
            stroke="#111827"
            strokeWidth={3}
          />
          {bubbleLines.length === 1 ? (
            <text
              x={0}
              y={-1}
              textAnchor="middle"
              fontSize={bubbleFontSize}
              fontWeight={800}
              fill="#111827"
              textRendering="geometricPrecision"
              fontFamily="Be Vietnam Pro, Inter, sans-serif"
            >
              {bubbleLines[0]}
            </text>
          ) : (
            <>
              {bubbleLines.map((ln, idx) => (
                <text
                  key={idx}
                  x={0}
                  y={bubbleTop + 26 + idx * 22}
                  textAnchor="middle"
                  fontSize={bubbleFontSize}
                  fontWeight={800}
                  fill="#111827"
                  textRendering="geometricPrecision"
                  fontFamily="Be Vietnam Pro, Inter, sans-serif"
                >
                  {ln}
                </text>
              ))}
            </>
          )}
        </g>
      ) : null}

      {/* Name badge below feet */}
      {label ? (
        <text
          x={0}
          y={32}
          textAnchor="middle"
          fontSize={19}
          fontWeight={900}
          fill={accent}
          stroke="#111827"
          strokeWidth={4.5}
          paintOrder="stroke"
          fontFamily="Be Vietnam Pro, Inter, sans-serif"
        >
          {label}
        </text>
      ) : null}
    </g>
  );
};
