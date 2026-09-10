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
  provider: "elevenlabs" | "macos_say" | "gemini_tts";
  voice_id: string;
  voice_settings?: CharacterVoiceSettings;
  created_at?: string;
  updated_at?: string;
}

export const DEFAULT_CHARACTERS: Record<string, CharacterDefinition> = {
  xam: {
    id: "xam",
    name: "Xám (Vàng Xám Comic)",
    avatar_emoji: "🐶",
    description: "Chú cún vàng đáng yêu, lạc quan, giọng trong trẻo dễ thương",
    provider: "macos_say",
    voice_id: "voice_xam_puppy_001",
    voice_settings: {
      pitch_shift: 1.18,
      speech_rate: 185,
      elevenlabs_voice_id: "EXAVITQu4vr4xnSDxMaL", // Default ElevenLabs voice ID placeholder
      stability: 0.75,
      similarity_boost: 0.85
    }
  },
  sep_shiba: {
    id: "sep_shiba",
    name: "Sếp Shiba",
    avatar_emoji: "👔",
    description: "Sếp Shiba công sở đeo kính, giọng trầm nam tính gắt gỏng uy quyền",
    provider: "macos_say",
    voice_id: "voice_shiba_boss_002",
    voice_settings: {
      pitch_shift: 0.82,
      speech_rate: 155,
      elevenlabs_voice_id: "ErXwobaYiN019PkySvjV",
      stability: 0.85,
      similarity_boost: 0.90
    }
  },
  be_meow: {
    id: "be_meow",
    name: "Bé Meow",
    avatar_emoji: "🐱",
    description: "Mèo chibi trắng đội nón nỉ xanh, giọng trẻ con cực cưng",
    provider: "macos_say",
    voice_id: "voice_meow_chibi_003",
    voice_settings: {
      pitch_shift: 1.25,
      speech_rate: 190,
      elevenlabs_voice_id: "MF3mGyEYCl7XYWbV9V6O",
      stability: 0.70,
      similarity_boost: 0.80
    }
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
