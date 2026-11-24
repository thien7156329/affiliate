/**
 * Story style: one large illustration per panel, slow camera moves on it, cross-fades between panels,
 * and now and then a short silent clip (Veo, image-to-video) that plays before settling on the still.
 * The voice carries the whole story; clips are always muted.
 */
import React from "react";
import {AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import type {Voice} from "../timings";

export type StoryPanel = {
  id: string;
  /** Global index (into voice.lines) of the first narration line shown on this panel. */
  line: number;
  /** Path under public/ (null while not drawn yet → tint placeholder). */
  src: string | null;
  /** Optional silent clip under public/, played from the panel start. */
  clip?: string | null;
  /** Clip length in seconds (Veo ≈ 8 s). */
  clipSeconds?: number;
  camera?: StoryCamera;
};

export type StoryCamera = "push_in" | "pull_out" | "pan_left" | "pan_right" | "rise" | "hold";

const CAMS: StoryCamera[] = ["push_in", "pan_right", "pull_out", "pan_left", "rise"];
const FADE = 18;
/** Cut a little before the line starts, so the picture lands with the word. */
const LEAD = 0.2;

type Timed = StoryPanel & {from: number; to: number; cam: StoryCamera};

export const timePanels = (panels: StoryPanel[], voice: Voice, fps: number, duration: number): Timed[] => {
  const sorted = [...panels].sort((a, b) => a.line - b.line);
  const froms: number[] = [];
  sorted.forEach((p, i) => {
    const want = Math.round(((voice.lines[p.line]?.start ?? 0) - LEAD) * fps);
    froms.push(i === 0 ? 0 : Math.min(duration - 1, Math.max(want, froms[i - 1] + FADE + 1)));
  });
  return sorted.map((p, i) => ({
    ...p,
    from: froms[i],
    to: i + 1 < sorted.length ? froms[i + 1] + FADE : duration,
    cam: p.camera ?? CAMS[i % CAMS.length],
  }));
};

const camTransform = (cam: StoryCamera, t: number) => {
  // t: 0..1 through the panel. Gentle: 6–9 % zoom over the whole panel.
  switch (cam) {
    case "push_in":
      return `scale(${1.04 + 0.08 * t})`;
    case "pull_out":
      return `scale(${1.12 - 0.08 * t})`;
    case "pan_left":
      return `scale(1.12) translateX(${3 - 6 * t}%)`;
    case "pan_right":
      return `scale(1.12) translateX(${-3 + 6 * t}%)`;
    case "rise":
      return `scale(1.12) translateY(${3 - 6 * t}%)`;
    default:
      return "scale(1.05)";
  }
};

const TINTS = [
  ["#1E3A5F", "#0B1220"],
  ["#7C4A1E", "#2A1608"],
  ["#14532D", "#052E16"],
  ["#4C1D95", "#1E1B4B"],
];

const PanelView: React.FC<{p: Timed; idx: number}> = ({p, idx}) => {
  const frame = useCurrentFrame(); // local to the Sequence
  const {fps} = useVideoConfig();
  const len = p.to - p.from;
  const t = Math.min(1, Math.max(0, frame / Math.max(1, len)));
  const opacity = interpolate(frame, [0, FADE], [idx === 0 ? 1 : 0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const clipFrames = p.clip ? Math.round((p.clipSeconds ?? 8) * fps) : 0;
  const stillIn = p.clip ? interpolate(frame, [clipFrames - 12, clipFrames], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"}) : 1;
  const tint = TINTS[idx % TINTS.length];
  const fill: React.CSSProperties = {width: "100%", height: "100%", objectFit: "cover"};
  return (
    <AbsoluteFill style={{opacity}}>
      <AbsoluteFill style={{background: `linear-gradient(160deg, ${tint[0]}, ${tint[1]})`}} />
      {p.src ? (
        <AbsoluteFill style={{opacity: stillIn, transform: camTransform(p.cam, t), transformOrigin: "45% 45%", overflow: "hidden"}}>
          {/* 112 % box anchored top-left: the bottom-right corner (Gemini's sparkle watermark) falls off-frame */}
          <Img src={staticFile(p.src)} style={{position: "absolute", left: 0, top: 0, width: "112%", height: "112%", objectFit: "cover"}} />
        </AbsoluteFill>
      ) : null}
      {p.clip && frame < clipFrames ? (
        <AbsoluteFill style={{opacity: 1 - stillIn}}>
          <OffthreadVideo src={staticFile(p.clip)} muted style={fill} />
        </AbsoluteFill>
      ) : null}
    </AbsoluteFill>
  );
};

export const StoryStage: React.FC<{panels: StoryPanel[]; voice: Voice; duration: number}> = ({panels, voice, duration}) => {
  const {fps} = useVideoConfig();
  const timed = React.useMemo(() => timePanels(panels, voice, fps, duration), [panels, voice, fps, duration]);
  return (
    <AbsoluteFill style={{background: "#0B1220"}}>
      {timed.map((p, i) => (
        <Sequence key={p.id} from={p.from} durationInFrames={Math.max(1, p.to - p.from)} layout="none">
          <PanelView p={p} idx={i} />
        </Sequence>
      ))}
      {/* soft vignette keeps captions readable on bright art */}
      <AbsoluteFill
        style={{background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%)", pointerEvents: "none"}}
      />
    </AbsoluteFill>
  );
};
