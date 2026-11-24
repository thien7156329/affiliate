import React from "react";
import {AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import {ease, lerp, ramp} from "../motion/anim";
import type {Voice} from "../timings";
import {FONT} from "../theme";
import {ThayLa} from "./ThayLa";
import type {
  ExplainerBackground,
  ExplainerBeat,
  ExplainerCamera,
  ExplainerPlace,
  ExplainerTransition,
} from "./types";

/**
 * Stickman explainer stage: AI-illustrated backgrounds + the Thầy Lá narrator.
 * - One beat per narration line. Consecutive beats on the same background form one shot,
 *   and the camera keeps moving through the whole shot (each beat starts where the last ended).
 * - A new background comes in with a transition (fade / wipe / ink reveal / zoom through).
 * - The narrator walks between places, changes pose and mood per beat, and lip-syncs to word timings.
 * - Callouts (circle / arrow / label) draw themselves on in hand-drawn strokes.
 */

const LEAD_SECONDS = 0.2;
const TRANSITION_FRAMES = 20;
const DEFAULT_TRANSITIONS: ExplainerTransition[] = ["fade", "wipe", "ink", "zoom_through"];

type Cam = {z: number; cx: number; cy: number};

type TimedBeat = ExplainerBeat & {
  from: number;
  to: number;
  shot: number;
  camStart: Cam;
  camEnd: Cam;
};

const clamp01 = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

const clampCam = (c: Cam): Cam => {
  const z = clamp01(c.z, 1.02, 1.7);
  const half = 0.5 / z;
  return {z, cx: clamp01(c.cx, half, 1 - half), cy: clamp01(c.cy, half, 1 - half)};
};

const moveCam = (s: Cam, cam: ExplainerCamera, focus?: [number, number]): Cam => {
  const fx = focus?.[0] ?? s.cx;
  const fy = focus?.[1] ?? s.cy;
  // Pans need room to travel: make sure the frame is zoomed in enough first.
  const panZ = Math.max(s.z, 1.22);
  switch (cam) {
    case "push_in":
      return clampCam({z: s.z * 1.14, cx: lerp(s.cx, fx, 0.6), cy: lerp(s.cy, fy, 0.6)});
    case "pull_out":
      return clampCam({z: s.z / 1.14, cx: lerp(s.cx, 0.5, 0.5), cy: lerp(s.cy, 0.5, 0.5)});
    case "pan_left":
      return clampCam({z: panZ, cx: s.cx - 0.11, cy: lerp(s.cy, fy, 0.3)});
    case "pan_right":
      return clampCam({z: panZ, cx: s.cx + 0.11, cy: lerp(s.cy, fy, 0.3)});
    case "tilt_up":
      return clampCam({z: panZ, cx: lerp(s.cx, fx, 0.3), cy: s.cy - 0.09});
    case "tilt_down":
      return clampCam({z: panZ, cx: lerp(s.cx, fx, 0.3), cy: s.cy + 0.09});
    case "hold":
    default:
      return clampCam({z: s.z * 1.03, cx: lerp(s.cx, fx, 0.25), cy: lerp(s.cy, fy, 0.25)});
  }
};

/** Keeps a little velocity at the beat boundaries so a shot reads as one continuous move. */
const camEase = (k: number) => 0.55 * k + 0.45 * ease(k);

const camAt = (b: TimedBeat, f: number): Cam => {
  const k = camEase(clamp01((f - b.from) / Math.max(1, b.to - b.from), 0, 1));
  return {
    z: lerp(b.camStart.z, b.camEnd.z, k),
    cx: lerp(b.camStart.cx, b.camEnd.cx, k),
    cy: lerp(b.camStart.cy, b.camEnd.cy, k),
  };
};

export const timeBeats = (beats: ExplainerBeat[], voice: Voice, fps: number, duration: number): TimedBeat[] => {
  const sorted = [...beats].sort((a, b) => a.line - b.line);
  const froms: number[] = [];
  sorted.forEach((b, i) => {
    const line = voice.lines[b.line];
    const want = i === 0 ? 0 : Math.round(((line?.start ?? 0) - LEAD_SECONDS) * fps);
    froms.push(i === 0 ? 0 : Math.min(duration - 1, Math.max(want, froms[i - 1] + 1)));
  });
  const out: TimedBeat[] = [];
  let shot = -1;
  sorted.forEach((b, i) => {
    const newShot = i === 0 || sorted[i - 1].bg !== b.bg;
    if (newShot) shot++;
    const cam = b.camera ?? "hold";
    const start: Cam = newShot
      ? clampCam({
          z: cam === "pull_out" ? 1.38 : 1.1,
          cx: b.focus?.[0] ?? 0.5,
          cy: b.focus?.[1] ?? 0.5,
        })
      : out[i - 1].camEnd;
    out.push({
      ...b,
      from: froms[i],
      to: i + 1 < sorted.length ? froms[i + 1] : duration,
      shot,
      camStart: start,
      camEnd: moveCam(start, cam, b.focus),
    });
  });
  return out;
};

const BgLayer: React.FC<{
  bg: ExplainerBackground | undefined;
  cam: Cam;
  width: number;
  height: number;
  style?: React.CSSProperties;
}> = ({bg, cam, width, height, style}) => {
  const w = width * cam.z;
  const h = height * cam.z;
  const left = width / 2 - cam.cx * w;
  const top = height / 2 - cam.cy * h;
  const tint = bg?.tint ?? ["#1E3A5F", "#0B1220"];
  return (
    <AbsoluteFill style={{overflow: "hidden", ...style}}>
      {bg?.src ? (
        <Img src={staticFile(bg.src)} style={{position: "absolute", left, top, width: w, height: h, objectFit: "cover"}} />
      ) : (
        <div
          style={{
            position: "absolute",
            left,
            top,
            width: w,
            height: h,
            background: `radial-gradient(120% 90% at 50% 30%, ${tint[0]} 0%, ${tint[1]} 100%)`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};

/**
 * Mouth opening 0..1 at time t: open while words are spoken, short gaps between words are bridged,
 * edges fade over ~70 ms so the mouth never flickers.
 */
const mouthAt = (voice: Voice, t: number, f: number): number => {
  const ws = voice.words;
  if (!ws.length) return 0;
  let lo = 0;
  let hi = ws.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ws[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  const cur = ws[lo];
  const next = ws[lo + 1];
  const FADE = 0.07;
  const BRIDGE = 0.16;
  let env = 0;
  if (t >= cur.start && t <= cur.end) env = 1;
  else if (t > cur.end && next && next.start - cur.end <= BRIDGE && t < next.start) env = 0.55;
  else if (t > cur.end) env = Math.max(0, 1 - (t - cur.end) / FADE);
  else env = Math.max(0, 1 - (cur.start - t) / FADE);
  if (t < cur.start && t > cur.start - FADE) env = Math.max(env, 1 - (cur.start - t) / FADE);
  if (env <= 0) return 0;
  return env * (0.45 + 0.55 * Math.abs(Math.sin(f * 0.55)));
};

/** Is a word being spoken at time t (seconds)? Binary search over voice.words. */
const speakingAt = (voice: Voice, t: number): boolean => {
  const ws = voice.words;
  let lo = 0;
  let hi = ws.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ws[mid].end < t) lo = mid + 1;
    else if (ws[mid].start > t) hi = mid - 1;
    else return true;
  }
  return false;
};

/** Portrait (9:16) keeps the narrator nearer the middle so he is never cut by the frame edge. */
const placeX = (place: ExplainerPlace | undefined, width: number, side: number, tall = false): number => {
  switch (place ?? "left") {
    case "right":
      return width * (tall ? 0.7 : 0.82);
    case "center":
      return width * 0.5;
    case "off":
      return side < 0 ? -width * 0.14 : width * 1.14;
    case "left":
    default:
      return width * (tall ? 0.3 : 0.18);
  }
};

const Callout: React.FC<{
  beat: TimedBeat;
  f: number;
  width: number;
  height: number;
  handX: number;
  handY: number;
  /** First frame the narrator is standing still (callouts wait for the walk to finish). */
  start: number;
}> = ({beat, f, width, height, handX, handY, start}) => {
  const c = beat.callout;
  if (!c?.text) return null;
  const draw = ramp(f, start, 16);
  const textIn = ramp(f, start + 10, 10);
  const out = 1 - ramp(f, beat.to - 8, 8);
  if (draw <= 0 || out <= 0) return null;
  const kind = c.kind ?? "label";
  const tall = height > width;
  const x = clamp01(c.x ?? 0.62, tall ? 0.3 : 0.12, tall ? 0.7 : 0.88) * width;
  const y = clamp01(c.y ?? 0.35, 0.12, tall ? 0.5 : 0.7) * height;
  const s = Math.min(width, height) / 1080;
  const stroke = "#FDE047";
  const dash = {pathLength: 1, strokeDasharray: 1, strokeDashoffset: 1 - draw} as const;

  let path = "";
  let tx = x;
  let ty = y - 70 * s;
  if (kind === "circle") {
    const rx = 120 * s;
    const ry = 78 * s;
    // Hand-drawn loop that overshoots its start, like a marker circle.
    path = `M ${x + rx} ${y - ry * 0.15}
      C ${x + rx * 1.05} ${y + ry * 1.1}, ${x - rx * 1.1} ${y + ry * 1.05}, ${x - rx} ${y}
      C ${x - rx * 0.95} ${y - ry * 1.15}, ${x + rx * 0.9} ${y - ry * 1.2}, ${x + rx * 1.08} ${y - ry * 0.05}`;
    ty = y - ry - 34 * s;
  } else if (kind === "arrow") {
    const mx = (handX + x) / 2;
    const my = Math.min(handY, y) - 90 * s;
    path = `M ${handX} ${handY} Q ${mx} ${my} ${x} ${y}`;
    tx = mx;
    ty = my - 18 * s;
  } else {
    path = `M ${x - 130 * s} ${y + 22 * s} Q ${x} ${y + 34 * s} ${x + 130 * s} ${y + 18 * s}`;
    ty = y;
  }
  const angle = kind === "arrow" ? Math.atan2(y - ((handY + y) / 2 - 45 * s), x - (handX + x) / 2) : 0;
  const head = 26 * s;

  return (
    <svg width={width} height={height} style={{position: "absolute", left: 0, top: 0, opacity: out}}>
      <path d={path} fill="none" stroke="#111827" strokeWidth={15 * s} strokeLinecap="round" {...dash} />
      <path d={path} fill="none" stroke={stroke} strokeWidth={9 * s} strokeLinecap="round" {...dash} />
      {kind === "arrow" && draw > 0.92 && (
        <path
          d={`M ${x - head * Math.cos(angle - 0.5)} ${y - head * Math.sin(angle - 0.5)} L ${x} ${y} L ${x - head * Math.cos(angle + 0.5)} ${y - head * Math.sin(angle + 0.5)}`}
          fill="none"
          stroke={stroke}
          strokeWidth={9 * s}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{filter: "drop-shadow(0 0 2px #111827)"}}
        />
      )}
      <text
        x={tx}
        y={ty}
        textAnchor="middle"
        fontFamily={FONT.sans}
        fontWeight={900}
        fontSize={46 * s}
        fill="#FFFFFF"
        stroke="#111827"
        strokeWidth={10 * s}
        paintOrder="stroke"
        strokeLinejoin="round"
        opacity={textIn}
        transform={`rotate(-3 ${tx} ${ty}) translate(0 ${(1 - textIn) * 14 * s})`}
      >
        {c.text.toUpperCase()}
      </text>
    </svg>
  );
};

export const ExplainerStage: React.FC<{
  beats: ExplainerBeat[];
  backgrounds: ExplainerBackground[];
  voice: Voice;
  duration: number;
}> = ({beats, backgrounds, voice, duration}) => {
  const f = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const timed = React.useMemo(() => timeBeats(beats, voice, fps, duration), [beats, voice, fps, duration]);
  const bgById = React.useMemo(() => new Map(backgrounds.map((b) => [b.id, b])), [backgrounds]);
  const swapFrames = React.useMemo(() => timed.map((b) => b.from), [timed]);

  if (!timed.length) return <AbsoluteFill style={{background: "#0B1220"}} />;

  let i = timed.findIndex((b) => f >= b.from && f < b.to);
  if (i < 0) i = f < timed[0].from ? 0 : timed.length - 1;
  const beat = timed[i];
  const cam = camAt(beat, f);

  // ── Background (with transition when this beat opened a new shot) ──
  const shotStartIdx = timed.findIndex((b) => b.shot === beat.shot);
  const shotStart = timed[shotStartIdx];
  const prevBeat = shotStartIdx > 0 ? timed[shotStartIdx - 1] : null;
  const trType: ExplainerTransition =
    shotStart.transition ?? DEFAULT_TRANSITIONS[beat.shot % DEFAULT_TRANSITIONS.length];
  const p = prevBeat && trType !== "cut" ? ramp(f, shotStart.from, TRANSITION_FRAMES) : 1;
  const inTransition = prevBeat !== null && p < 1;

  const tall = height > width;
  const stand = placeX(beat.place, width, -1, tall);
  const scale = (Math.min(width, height) / 1080) * (tall ? 2.05 : 1.75);
  // Portrait: stand above the caption band (captions sit around 80–88% of the height).
  const groundY = height * (tall ? 0.79 : 0.965);

  let incomingStyle: React.CSSProperties = {};
  let outgoingStyle: React.CSSProperties = {};
  if (inTransition) {
    if (trType === "fade") incomingStyle = {opacity: p};
    else if (trType === "wipe") incomingStyle = {clipPath: `inset(0 ${((1 - p) * 100).toFixed(2)}% 0 0)`};
    else if (trType === "ink")
      incomingStyle = {clipPath: `circle(${(p * 120).toFixed(2)}% at ${((stand / width) * 100).toFixed(1)}% 55%)`};
    else if (trType === "zoom_through") {
      outgoingStyle = {transform: `scale(${1 + 0.35 * p})`, opacity: 1 - p};
      incomingStyle = {transform: `scale(${1.12 - 0.12 * p})`, opacity: p};
    }
  }

  // ── Narrator: walk between places, then act the beat ──
  const prevPlaceBeat = i > 0 ? timed[i - 1] : null;
  const fromX = prevPlaceBeat ? placeX(prevPlaceBeat.place, width, -1, tall) : -width * 0.14;
  const dx = stand - fromX;
  const walkFrames = Math.round(clamp01((Math.abs(dx) / width) * 70, 0, 40));
  const walkK = walkFrames > 0 ? ramp(f, beat.from, walkFrames) : 1;
  const walking = walkFrames > 0 && walkK < 1;
  const parallax = -(cam.cx - 0.5) * width * 0.12;
  const manX = lerp(fromX, stand, walkK) + parallax;

  const calloutX = (beat.callout?.x ?? 0.5) * width;
  const faceLeft = walking
    ? dx < 0
    : beat.place === "right"
      ? true
      : beat.place === "center"
        ? calloutX < width / 2
        : false;

  const t = f / fps;
  const mouth = mouthAt(voice, t, f);
  const talkingNow = mouth > 0 || speakingAt(voice, t);
  // Pose-to-pose: when the pose changes on the spot, cross-fade the old pose out over a few frames.
  const POSE_BLEND = 7;
  const prevActBeat = i > 0 ? timed[i - 1] : null;
  const blendK = ramp(f, beat.from + walkFrames, POSE_BLEND);
  const blending =
    !walking &&
    prevActBeat !== null &&
    walkFrames === 0 &&
    prevActBeat.place !== "off" &&
    (prevActBeat.pose !== beat.pose || prevActBeat.prop !== beat.prop) &&
    blendK < 1;
  // Arrow callouts start from where the narrator's hand will be once he stops walking.
  const standFaceLeft =
    beat.place === "right" ? true : beat.place === "center" ? calloutX < width / 2 : false;
  const handX = stand + parallax + (standFaceLeft ? -1 : 1) * 75 * scale;
  const handY = groundY - 150 * scale;
  const calloutStart = beat.from + walkFrames + 6;
  const fadeOutTail = 1 - ramp(f, duration - 12, 12);

  return (
    <AbsoluteFill style={{background: "#0B1220", opacity: fadeOutTail}}>
      {inTransition && prevBeat && (
        <BgLayer bg={bgById.get(prevBeat.bg)} cam={prevBeat.camEnd} width={width} height={height} style={outgoingStyle} />
      )}
      <BgLayer bg={bgById.get(beat.bg)} cam={cam} width={width} height={height} style={incomingStyle} />

      {/* Ink edge on wipes */}
      {inTransition && trType === "wipe" && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${(p * 100).toFixed(2)}%`,
            width: 14,
            marginLeft: -7,
            background: "#111827",
            boxShadow: "0 0 18px rgba(0,0,0,0.6)",
          }}
        />
      )}

      {/* Bottom wash so the narrator and captions sit on a readable ground */}
      <AbsoluteFill style={{background: "linear-gradient(180deg, rgba(0,0,0,0) 62%, rgba(0,0,0,0.38) 100%)"}} />

      {beat.place !== "off" || walking ? (
        <svg width={width} height={height} style={{position: "absolute", left: 0, top: 0}}>
          <ellipse cx={manX} cy={groundY + 4} rx={60 * scale} ry={11 * scale} fill="rgba(0,0,0,0.35)" />
          {blending && prevActBeat ? (
            <g opacity={1 - blendK}>
              <ThayLa
                x={manX}
                y={groundY}
                scale={scale}
                pose={prevActBeat.pose ?? "explain"}
                mood={prevActBeat.mood ?? "happy"}
                prop={prevActBeat.prop ?? "none"}
                talking={talkingNow}
                mouth={mouth}
                flip={faceLeft}
                frame={f}
                swapFrames={swapFrames}
              />
            </g>
          ) : null}
          <g opacity={blending ? blendK : 1}>
          <ThayLa
            x={manX}
            y={groundY}
            scale={scale}
            pose={walking ? "walk" : beat.pose ?? "explain"}
            mood={beat.mood ?? "happy"}
            prop={walking ? "none" : beat.prop ?? "none"}
            talking={talkingNow}
            mouth={mouth}
            flip={faceLeft}
            frame={f}
            swapFrames={swapFrames}
          />
          </g>
        </svg>
      ) : null}

      <Callout beat={beat} f={f} width={width} height={height} handX={handX} handY={handY} start={calloutStart} />

      {/* Soft vignette */}
      <AbsoluteFill
        style={{
          background: "radial-gradient(120% 100% at 50% 45%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.42) 100%)",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};
