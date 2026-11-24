/**
 * Cloned narrator voices (VieNeu ref_audio), used only with the voice owner's permission.
 * Name shown in the Studio → reference clip under shorts-kit/voices/ (git-ignored).
 */
import {existsSync} from "node:fs";
import {p} from "../paths";

export const VOICE_CLONES: Record<string, string> = {
  /** Anh Minh (Tam tai kỳ truyện) — permission given to the channel owner, 2026-11-23. */
  "Anh Minh": "voices/anh-minh.wav",
  /** Same narrator, second reference clip (10:32 of the source video) — for A/B testing. */
  "Anh Minh B": "voices/anh-minh-ref-b.wav",
};

export const isClonedVoice = (name?: string | null) => Boolean(name && VOICE_CLONES[name]);

/** Preset name → itself; clone name → absolute path of its reference clip (VieNeu treats .wav as ref_audio). */
export const resolveVoice = (name?: string | null): string | undefined => {
  if (!name) return undefined;
  const rel = VOICE_CLONES[name];
  if (!rel) return name;
  const abs = p(rel);
  if (!existsSync(abs)) throw new Error(`Thiếu file mẫu giọng clone "${name}": ${rel}`);
  return abs;
};
