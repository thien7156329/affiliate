/**
 * Story sound bed (ghost stories): real recorded music + per-scene ambience, all from public/sfx/story/
 * (Pixabay Content License — free commercial use, no attribution; sources in public/sfx/real/manifest.json).
 *
 *   music: one bed under the whole video, full under the storytelling, softer from `softFrom` (science part)
 *   ambience: scene sound chosen per narration line (crickets, rain, wind, clock, or silence), cross-faded
 */
import React from "react";
import {Html5Audio, Sequence, interpolate, staticFile, useVideoConfig} from "remotion";
import type {Voice} from "../timings";

export const STORY_MUSIC = ["music_ambient", "music_drone", "music_suspense"] as const;
export const STORY_AMBIENCE = ["crickets", "rain", "wind", "clock"] as const;
export type StoryAmbience = (typeof STORY_AMBIENCE)[number] | "none";

const AMB_FILE: Record<(typeof STORY_AMBIENCE)[number], string> = {
  crickets: "sfx/story/amb_crickets.mp3",
  rain: "sfx/story/amb_rain.mp3",
  wind: "sfx/story/amb_wind.mp3",
  clock: "sfx/story/amb_clock.mp3",
};
const FADE = 30;

/** Pick one music bed per video, stable for the same id. */
export const musicFor = (key: string) => {
  let h = 7;
  for (const ch of key) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return STORY_MUSIC[h % STORY_MUSIC.length];
};

export const StoryAudio: React.FC<{
  voice: Voice;
  /** frame where the science/explanation part starts (bed gets softer) */
  softFrom: number;
  music: string;
  /** ambience changes: from this narration line on, play this scene sound */
  ambience: readonly {line: number; id: string}[];
}> = ({voice, softFrom, music, ambience}) => {
  const {fps, durationInFrames} = useVideoConfig();
  const segs = React.useMemo(() => {
    const sorted = [...ambience].sort((a, b) => a.line - b.line);
    const out: {from: number; to: number; id: string}[] = [];
    sorted.forEach((a, i) => {
      const from = Math.round((voice.lines[a.line]?.start ?? 0) * fps);
      const next = sorted[i + 1];
      const to = next ? Math.round((voice.lines[next.line]?.start ?? 0) * fps) : durationInFrames;
      if (a.id in AMB_FILE && to > from + 10) out.push({from, to, id: a.id});
    });
    return out;
  }, [ambience, voice, fps, durationInFrames]);

  return (
    <>
      <Html5Audio
        src={staticFile(`sfx/story/${music}.mp3`)}
        loop
        loopVolumeCurveBehavior="extend"
        volume={(f) =>
          interpolate(f, [0, 60, Math.max(61, softFrom - 45), Math.max(62, softFrom + 45)], [0, 0.15, 0.15, 0.1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />
      {/* Constant eerie layer (low, whole video): the creepy "ma mị" undertone for every story */}
      <Html5Audio
        src={staticFile("sfx/horror/ambience_eerie.mp3")}
        loop
        loopVolumeCurveBehavior="extend"
        volume={(f) =>
          interpolate(f, [0, 90, Math.max(91, durationInFrames - 60), durationInFrames], [0, 0.11, 0.11, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })
        }
      />
      {segs.map((s) => (
        <Sequence key={`${s.from}-${s.id}`} from={s.from} durationInFrames={s.to - s.from + FADE} layout="none">
          <Html5Audio
            src={staticFile(AMB_FILE[s.id as keyof typeof AMB_FILE])}
            loop
            loopVolumeCurveBehavior="extend"
            volume={(f) =>
              interpolate(f, [0, FADE, s.to - s.from, s.to - s.from + FADE], [0, 0.35, 0.35, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })
            }
          />
        </Sequence>
      ))}
    </>
  );
};
