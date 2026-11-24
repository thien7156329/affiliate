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
};

const FADE = 14;

export const AiBackdrop: React.FC<{items: AiBackdropItem[]; voice: Voice; dim?: number; still?: boolean}> = ({
  items,
  voice,
  dim = 0.32,
  still = false,
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
              <Img
                src={staticFile(b.src)}
                style={{position: "absolute", left: 0, top: 0, width: "112%", height: "112%", objectFit: "cover"}}
              />
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
