/**
 * AI-drawn backdrop layer for the stickman stage: one image per beat (≈ 2 narration lines), slow camera drift,
 * cross-fades on the line where the beat starts, and a scrim so figures, cards and captions stay readable.
 * Sits BETWEEN the preset setting (kept as fallback underneath) and the figures.
 */
import React from "react";
import {AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig} from "remotion";
import type {Voice} from "../timings";

export type AiBackdropItem = {
  /** Global index into voice.lines where this backdrop starts. */
  line: number;
  /** Path under public/; null = keep the preset setting for this beat. */
  src: string | null;
  /** Measured ground line of the picture (fraction of its height): moved onto the stage floor so feet touch the ground. */
  floor?: number;
};

/** Scale + vertical offset that puts the picture's ground line `f` on the stage floor `g`, still covering the frame
 *  (and pushing the bottom-right corner — Gemini's watermark — at least 4 % off-frame). */
export const fitToFloor = (f: number, g: number) => {
  // ≥ 9 % of the picture hangs below the frame so the bottom-right watermark never shows
  const s = Math.min(1.9, Math.max(1.14, g / Math.max(0.05, f), (1.09 - g) / Math.max(0.05, 1 - f)));
  return {s, top: g - f * s};
};

const FADE = 14;

export const AiBackdrop: React.FC<{items: AiBackdropItem[]; voice: Voice; dim?: number; still?: boolean; stageFloor?: number}> = ({
  items,
  voice,
  dim = 0.32,
  still = false,
  stageFloor,
}) => {
  const f = useCurrentFrame();
  const {fps, durationInFrames} = useVideoConfig();
  const timed = React.useMemo(() => {
    const sorted = [...items].sort((a, b) => a.line - b.line);
    return sorted.map((it, i) => {
      const from = i === 0 ? 0 : Math.max(0, Math.round(((voice.lines[it.line]?.start ?? 0) - 0.15) * fps));
      const next = sorted[i + 1];
      const to = next ? Math.max(from + 1, Math.round(((voice.lines[next.line]?.start ?? 0) - 0.15) * fps)) : durationInFrames;
      return {...it, from, to, k: i};
    });
  }, [items, voice, fps, durationInFrames]);

  return (
    <AbsoluteFill style={{overflow: "hidden"}}>
      {timed.map((b) => {
        if (!b.src || f < b.from - 1 || f > b.to + FADE) return null;
        const inW = b.k === 0 ? 1 : Math.min(1, Math.max(0, (f - b.from) / FADE));
        const t = Math.min(1, Math.max(0, (f - b.from) / Math.max(1, b.to - b.from)));
        // alternate push-in / drift so consecutive beats never move the same way
        const mv = b.k % 3;
        const transform = still
          ? "none"
          : mv === 0
            ? `scale(${1.12 + 0.07 * t})`
            : mv === 1
              ? `scale(1.16) translateX(${-2.5 + 5 * t}%)`
              : `scale(1.16) translateX(${2.5 - 5 * t}%)`;
        return (
          <AbsoluteFill key={`${b.line}-${b.src}`} style={{opacity: inW}}>
            {/* 112 % box anchored top-left crops the bottom-right corner (Gemini watermark) */}
            <AbsoluteFill style={{transform, transformOrigin: "45% 45%"}}>
              {(() => {
                // measured ground → stage floor; otherwise the old 112 % top-left crop
                const fit = b.floor && stageFloor ? fitToFloor(b.floor, stageFloor) : null;
                const s = fit?.s ?? 1.12;
                const top = fit ? `${fit.top * 100}%` : 0;
                const left = fit ? `${-(s - 1) * 30}%` : 0; // most of the extra width hangs off the RIGHT edge
                return (
                  <Img
                    src={staticFile(b.src)}
                    style={{position: "absolute", left, top, width: `${s * 100}%`, height: `${s * 100}%`, objectFit: "cover"}}
                  />
                );
              })()}
            </AbsoluteFill>
          </AbsoluteFill>
        );
      })}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(0,0,0,${dim + 0.15}) 0%, rgba(0,0,0,${dim * 0.5}) 35%, rgba(0,0,0,${dim * 0.6}) 70%, rgba(0,0,0,${dim + 0.2}) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};
