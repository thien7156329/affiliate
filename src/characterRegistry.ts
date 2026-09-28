/**
 * characterRegistry.ts
 *
 * Manages character definitions and voice mappings for Character Voice Consistency.
 * Maps `character_id -> voice_id` (ElevenLabs Voice ID or character pitch/rate settings).
 * Data is persisted in `data/characters.json`.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const CHARACTERS_FILE = path.join(DATA_DIR, "characters.json");

export interface CharacterVoiceSettings {
  pitch_shift?: number;       // FFmpeg pitch ratio (e.g., 1.18 for cute puppy, 0.82 for deep boss)
  speech_rate?: number;       // Words/min or speed multiplier
  elevenlabs_voice_id?: string; // ElevenLabs Voice ID (e.g. "voice_001")
  stability?: number;         // ElevenLabs stability (0.0 - 1.0)
  similarity_boost?: number;  // ElevenLabs similarity boost (0.0 - 1.0)
}

export interface CharacterDefinition {
  id: string;
  name: string;
  avatar_emoji?: string;
  description?: string;
  provider: "elevenlabs" | "macos_say" | "gemini_tts" | "gemini_veo" | "vieneu";
  voice_id: string;
  veo_voice_directive?: string; // Voice casting prompt directive for Google Veo AI video generation
  voice_settings?: CharacterVoiceSettings;
  created_at?: string;
  updated_at?: string;
}

export const DEFAULT_CHARACTERS: Record<string, CharacterDefinition> = {
  mai_be_phuong: {
    id: "mai_be_phuong",
    name: "Mai Bé Phương (Nữ Chính)",
    avatar_emoji: "🎀",
    description: "Nữ chính miền Nam tươi tắn, vui nhộn, tự nhiên không xước (VieNeu TTS)",
    provider: "vieneu",
    voice_id: "Mai Bé Phương",
    veo_voice_directive: "Bright, lively, melodic southern Vietnamese young female voice, playful, sweet and highly expressive TikTok storytelling.",
    voice_settings: {
      pitch_shift: 1.0,
      speech_rate: 175
    }
  },
  xam: {
    id: "xam",
    name: "Xám (Vàng Xám Comic)",
    avatar_emoji: "🐶",
    description: "Chú cún vàng đáng yêu, lạc quan, giọng trong trẻo dễ thương",
    provider: "gemini_veo",
    voice_id: "Puck",
    veo_voice_directive: "Cute, energetic, enthusiastic little puppy voice, cheerful and bright toddler intonation.",
    voice_settings: {
      pitch_shift: 1.0,
      speech_rate: 175
    }
  },
  sep_shiba: {
    id: "sep_shiba",
    name: "Sếp Shiba",
    avatar_emoji: "👔",
    description: "Sếp Shiba công sở đeo kính, giọng trầm nam tính gắt gỏng uy quyền",
    provider: "gemini_veo",
    voice_id: "Charon",
    veo_voice_directive: "Deep, authoritative, comedic office boss baritone voice, stern yet humorous.",
    voice_settings: {
      pitch_shift: 1.0,
      speech_rate: 165
    }
  },
  be_meow: {
    id: "be_meow",
    name: "Bé Meow",
    avatar_emoji: "🐱",
    description: "Mèo chibi trắng đội nón nỉ xanh, giọng trẻ con cực cưng",
    provider: "gemini_veo",
    voice_id: "Aoede",
    veo_voice_directive: "Ultra-cute, delicate, sweet natural voice.",
    voice_settings: {
      pitch_shift: 1.0,
      speech_rate: 175
    }
  },
  bubu: {
    id: "bubu",
    name: "BuBu (Gấu Nâu Chibi)",
    avatar_emoji: "🐻",
    description: "Gấu nâu caramel chibi siêu dễ thương, đầu tròn to phúng phính (≈65% thân), má phúng phính ửng cam đào, mắt hạt cúc đen bóng, miệng :3 toe toét, lông nhung mịn ấm áp, dáng lũn cũn tinh nghịch.",
    provider: "vieneu",
    voice_id: "Mai Bé Phương",
    veo_voice_directive: "Ultra-cute, playful, adorable bubbly toddler child voice with sweet cheerful intonation."
  },
  dudu: {
    id: "dudu",
    name: "DuDu (Gấu Trắng Chibi)",
    avatar_emoji: "🐻‍❄️",
    description: "Gấu trắng tuyết chibi siêu đáng yêu, đầu tròn to phúng phính (≈65% thân), má hồng đào tròn xoe, thắt nơ/khăn nâu ở cổ, mắt hạt cúc đen bóng, miệng :3 chúm chím, lông nhung trắng mịn, tính cách ấm áp dịu dàng.",
    provider: "vieneu",
    voice_id: "DuDu_NamChinh",
    veo_voice_directive: "Warm, gentle, sweet affectionate young boy/toddler voice, soothing and caring brotherly delivery."
  }
};

/**
 * Load character definitions from data/characters.json
 */
export async function loadCharacters(): Promise<Record<string, CharacterDefinition>> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(CHARACTERS_FILE)) {
      fs.writeFileSync(CHARACTERS_FILE, JSON.stringify(DEFAULT_CHARACTERS, null, 2), "utf-8");
      return DEFAULT_CHARACTERS;
    }

    const content = fs.readFileSync(CHARACTERS_FILE, "utf-8");
    const parsed = JSON.parse(content);
    return { ...DEFAULT_CHARACTERS, ...parsed };
  } catch (err: any) {
    console.warn(`⚠️ [CharacterRegistry] Failed to load characters file, using defaults: ${err.message}`);
    return DEFAULT_CHARACTERS;
  }
}

/**
 * Save character definitions to data/characters.json
 */
export async function saveCharacters(characters: Record<string, CharacterDefinition>): Promise<void> {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(CHARACTERS_FILE, JSON.stringify(characters, null, 2), "utf-8");
}

/**
 * Get character by ID
 */
export async function getCharacter(id: string): Promise<CharacterDefinition | null> {
  const list = await loadCharacters();
  return list[id] || null;
}

/**
 * Add or update character definition
 */
export async function upsertCharacter(character: CharacterDefinition): Promise<CharacterDefinition> {
  const list = await loadCharacters();
  const now = new Date().toISOString();
  
  const updated: CharacterDefinition = {
    ...character,
    created_at: list[character.id]?.created_at || now,
    updated_at: now
  };

  list[character.id] = updated;
  await saveCharacters(list);
  return updated;
}

/**
 * Delete character definition
 */
export async function deleteCharacter(id: string): Promise<boolean> {
  const list = await loadCharacters();
  if (list[id]) {
    delete list[id];
    await saveCharacters(list);
    return true;
  }
  return false;
}
