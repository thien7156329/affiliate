import type {StickMood, StickPose, StickProp} from "../figures/Stickman";

/** How the camera moves across the background during one beat. Moves chain: a beat starts where the last one ended. */
export type ExplainerCamera =
  | "push_in"
  | "pull_out"
  | "pan_left"
  | "pan_right"
  | "tilt_up"
  | "tilt_down"
  | "hold";

/** How a new background replaces the previous one. */
export type ExplainerTransition = "cut" | "fade" | "wipe" | "zoom_through" | "ink";

/** Where the narrator stands. "off" walks him out of frame for a full-picture beat. */
export type ExplainerPlace = "left" | "right" | "center" | "off";

export type ExplainerCallout = {
  /** 1–4 words, drawn on as a hand-written label. */
  text: string;
  /** Point of interest in screen space, 0..1. */
  x?: number;
  y?: number;
  kind?: "circle" | "arrow" | "label";
};

/** One beat = one narration line (global index into voice.lines). */
export type ExplainerBeat = {
  line: number;
  /** Background id (key into the backgrounds map). Consecutive beats sharing a bg form one continuous shot. */
  bg: string;
  camera?: ExplainerCamera;
  /** Point of interest inside the background image, 0..1 — the camera drifts toward it. */
  focus?: [number, number];
  place?: ExplainerPlace;
  pose?: StickPose;
  mood?: StickMood;
  prop?: StickProp;
  callout?: ExplainerCallout;
  /** Used when this beat starts a new background. */
  transition?: ExplainerTransition;
};

export type ExplainerBackground = {
  id: string;
  /** Path under public/ (for staticFile), or null while the image is not generated yet. */
  src: string | null;
  /** Fallback gradient colours when src is null. */
  tint?: [string, string];
};
