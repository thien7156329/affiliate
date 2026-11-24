/**
 * Story camera + grade for the stickman stage, driven per narration line by lineBeats:
 *   camera: "wide" | "closeup_left" | "closeup_right" | "closeup_center"  → eased zoom onto a character's face
 *   tension: 0..3  → darker, desaturated, sepia, heavier vignette as the story gets grim
 *   card: "Rằm tháng Bảy – 2022" → a time/place title written into the scene
 * Captions are drawn outside World, so they are never zoomed or darkened.
 */
import React from "react";
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import type {Voice} from "../timings";
import {loadFont} from "@remotion/google-fonts/DancingScript";
import type {StickmanSceneAct} from "./StickmanStage";

const {fontFamily: HAND} = loadFont("normal", {weights: ["500", "700"], subsets: ["latin", "latin-ext", "vietnamese"]});

/** A written thing in the story (last will, letter, poem, note left behind) shown as a handwritten page. */
export type StoryNote = {title?: string; date?: string; lines: string[]};

const NotePage: React.FC<{note: StoryNote; reveal: number; opacity: number; width: number; height: number}> = ({
  note,
  reveal,
  opacity,
  width,
  height,
}) => {
  const u = Math.min(width, height) / 1080;
  const pageW = Math.min(width * 0.62, height * 0.78);
  const pageH = Math.min(height * 0.86, pageW * 1.32);
  const shown = Math.ceil(note.lines.length * reveal);
  return (
    <AbsoluteFill style={{opacity, background: "radial-gradient(ellipse at 50% 50%, rgba(52,36,20,0.97), rgba(10,6,3,1))"}}>
      <div
        style={{
          position: "absolute",
          left: (width - pageW) / 2,
          top: (height - pageH) / 2,
          width: pageW,
          height: pageH,
          background: "#F3E7C9",
          borderRadius: 6 * u,
          boxShadow: "0 18px 60px rgba(0,0,0,0.65)",
          transform: `rotate(-1.2deg) scale(${0.96 + 0.04 * opacity})`,
          backgroundImage:
            "repeating-linear-gradient(180deg, transparent 0, transparent 52px, rgba(120,100,160,0.28) 53px, transparent 55px)," +
            "radial-gradient(ellipse at 20% 15%, rgba(140,100,40,0.25), transparent 30%)," +
            "radial-gradient(ellipse at 80% 85%, rgba(140,100,40,0.22), transparent 28%)",
          padding: `${70 * u}px ${70 * u}px ${60 * u}px ${110 * u}px`,
          boxSizing: "border-box",
          fontFamily: HAND,
          color: "#1E2A4A",
        }}
      >
        {/* red margin line */}
        <div style={{position: "absolute", left: 80 * u, top: 0, bottom: 0, width: 2, background: "rgba(200,60,60,0.45)"}} />
        {note.date ? <div style={{textAlign: "right", fontSize: 54 * u, marginBottom: 20 * u}}>{note.date}</div> : null}
        {note.title ? <div style={{fontSize: 96 * u, fontWeight: 700, marginBottom: 30 * u}}>{note.title}</div> : null}
        {note.lines.map((l, i) => (
          <div key={i} style={{fontSize: 62 * u, lineHeight: 1.55, opacity: i < shown ? 1 : 0, transition: "none"}}>
            {l}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** Shot sizes. The zoom origin sits ON the character, so the framed character never leaves the picture. */
const SCALE = {wide: 1, medium: 1.5, closeup: 1.95} as const;
// Shot-size changes are hard cuts (like the reference stories): a 3-frame snap, not a slide.
const EASE = 3;

/** Face position of each slot as a fraction of the frame (portrait / landscape stage layouts). */
const TARGET = {
  // origin ≈ the character's chest, so the whole upper body stays in frame after the zoom
  portrait: {left: [0.24, 0.74], right: [0.74, 0.74], center: [0.5, 0.74]},
  landscape: {left: [0.4, 0.72], right: [0.6, 0.72], center: [0.5, 0.72]},
} as const;

type Side = "left" | "right" | "center";
type Cam = "wide" | "push" | `${"medium" | "closeup"}_${Side}`;
export const STORY_CAMERAS: Cam[] = [
  "wide", "push", "medium_left", "medium_right", "medium_center", "closeup_left", "closeup_right", "closeup_center",
];

export const StoryCamera: React.FC<{acts: StickmanSceneAct[]; voice: Voice; children: React.ReactNode}> = ({
  acts,
  voice,
  children,
}) => {
  const f = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const t = f / fps;

  // Current global line (with a small lead so the camera lands with the word).
  let g = voice.lines.findIndex((l) => t + 0.1 >= l.start && t <= l.end + 0.35);
  if (g < 0) for (let i = voice.lines.length - 1; i >= 0; i--) if (t >= voice.lines[i].start) { g = i; break; }
  if (g < 0) g = 0;

  const beatAt = (gi: number) => {
    const line = voice.lines[gi];
    if (!line) return undefined;
    const act = acts.find((a) => a.id === line.scene);
    const idx = voice.lines.slice(0, gi).filter((l) => l.scene === line.scene).length;
    return act?.lineBeats?.[idx] as (NonNullable<StickmanSceneAct["lineBeats"]>[number] & {camera?: Cam; tension?: number; card?: string}) | undefined;
  };
  const now = beatAt(g);
  const prev = beatAt(g - 1);
  const lineStart = Math.round((voice.lines[g]?.start ?? 0) * fps);
  const k = Math.min(1, Math.max(0, (f - lineStart + 4) / EASE));
  const e = k * k * (3 - 2 * k);

  const layout = width > height ? TARGET.landscape : TARGET.portrait;
  // explicit camera, else: the speaking character gets a medium shot, else a wide shot
  const camOf = (b: typeof now): Cam => {
    const c = b?.camera as Cam | undefined;
    if (c && STORY_CAMERAS.includes(c)) return c;
    if (b?.left?.speak) return "medium_left";
    if (b?.right?.speak) return "medium_right";
    if ((b as any)?.third?.speak) return "medium_center";
    // story mode: when one character carries the line (the other is hidden or absent), frame that person, never an empty stage
    if (b?.left && !b.left.hidden && (!b.right || b.right.hidden)) return "medium_left";
    if (b?.right && !b.right.hidden && (!b.left || b.left.hidden)) return "medium_right";
    return "wide";
  };
  const lineLen = Math.max(1, Math.round(((voice.lines[g]?.end ?? 0) - (voice.lines[g]?.start ?? 0)) * fps));
  const lineP = Math.min(1, Math.max(0, (f - lineStart) / lineLen));
  const scaleOf = (c: Cam, p: number) =>
    c === "wide" ? 1 : c === "push" ? 1 + 0.1 * p : c.startsWith("medium") ? SCALE.medium : SCALE.closeup;
  const actOf = (gi: number) => acts.find((a) => a.id === voice.lines[gi]?.scene);
  const originOf = (c: Cam, gi: number): readonly number[] => {
    if (c === "wide") return [0.5, 0.5];
    if (c === "push") return layout.center;
    const side = c.split("_")[1] as Side;
    // a solo character stands in the middle of the stage, so the camera aims at the middle
    const a = actOf(gi);
    if (side === "left" && (a?.mode === "solo" || a?.charRight === "")) return layout.center;
    return layout[side];
  };
  const c0 = camOf(prev);
  const c1 = camOf(now);
  // a barely visible drift keeps wide shots alive
  const drift = 1 + 0.015 * (0.5 + 0.5 * Math.sin(t / 5));
  // The scene is a fixed stage: the camera never zooms, pans or drifts — only the characters move inside it.
  void drift;
  // Story shots: eased zoom between shot sizes plus a slow push-in while a line plays (the picture is never frozen).
  const s0 = scaleOf(c0, 1);
  const s1 = scaleOf(c1, lineP);
  const creep = 1 + 0.02 * lineP; // held shots stay nearly still, like the reference
  const s = (s0 + (s1 - s0) * e) * (c1 === "wide" ? creep : 1);
  const o0 = originOf(c0, g - 1);
  const o1 = originOf(c1, g);
  const ox = o0[0] + (o1[0] - o0[0]) * e;
  const oy = o0[1] + (o1[1] - o0[1]) * e;

  // Grade follows tension, smoothed between lines.
  const ten0 = Math.max(0, Math.min(3, Number(prev?.tension) || 0));
  const ten1 = Math.max(0, Math.min(3, Number(now?.tension) || 0));
  const ten = (ten0 + (ten1 - ten0) * e) / 3;
  const filter = ten > 0.01 ? `saturate(${1 - 0.45 * ten}) brightness(${1 - 0.3 * ten}) sepia(${0.35 * ten}) contrast(${1 + 0.08 * ten})` : undefined;

  const card = now?.card;
  const lineEnd = Math.round((voice.lines[g]?.end ?? 0) * fps);
  const cardOpacity = card
    ? interpolate(f, [lineStart - 4, lineStart + 10, lineEnd + 6, lineEnd + 20], [0, 1, 1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"})
    : 0;
  const u = Math.min(width, height) / 1080;

  return (
    <AbsoluteFill style={{overflow: "hidden"}}>
      <AbsoluteFill style={{transform: `scale(${s})`, transformOrigin: `${ox * 100}% ${oy * 100}%`, filter}}>{children}</AbsoluteFill>
      {ten > 0.01 ? (
        <AbsoluteFill
          style={{background: `radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) ${62 - 22 * ten}%, rgba(8,4,2,${0.35 + 0.5 * ten}) 100%)`}}
        />
      ) : null}
      {(() => {
        const note = (now as any)?.note as StoryNote | undefined;
        if (!note?.lines?.length) return null;
        const o = interpolate(f, [lineStart - 6, lineStart + 10, lineEnd + 10, lineEnd + 24], [0, 1, 1, 0], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
        const reveal = Math.min(1, Math.max(0.15, (f - lineStart) / Math.max(1, (lineEnd - lineStart) * 0.85)));
        return <NotePage note={note} reveal={reveal} opacity={o} width={width} height={height} />;
      })()}
      {card ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: height * (width > height ? 0.16 : 0.055),
            textAlign: "center",
            opacity: cardOpacity,
            color: "#F8F1E3",
            fontFamily: "Georgia, 'Times New Roman', serif",
            fontStyle: "italic",
            fontSize: 64 * u,
            letterSpacing: 1,
            textShadow: "0 3px 12px rgba(0,0,0,0.85)",
          }}
        >
          {card}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
