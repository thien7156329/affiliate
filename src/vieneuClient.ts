import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

const VIENEU_PYTHON = "/Users/letrongthien/.local/share/uv/tools/vieneu/bin/python";

export interface VieneuGenerateOptions {
  text: string;
  outputPath: string;
  voice?: string;
  temperature?: number;
  topP?: number;
  applyWatermark?: boolean;
}

/**
 * Generates speech using local VieNeu-TTS v3 Turbo with optimal settings:
 * - voice: "Mai Bé Phương" (default)
 * - temperature: 0.4 (clean, natural, avoids scratchy artifacts)
 * - top_p: 0.9
 * - apply_watermark: false (pure clean sound)
 */
export async function generateSpeechWithVieneu(options: VieneuGenerateOptions): Promise<string> {
  const {
    text,
    outputPath,
    voice = "Mai Bé Phương",
    temperature = 0.4,
    topP = 0.9,
    applyWatermark = false,
  } = options;

  const cleanText = text.replace(/"/g, '\\"').replace(/\n/g, " ").trim();
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const script = `
from vieneu import Vieneu
import os

tts = Vieneu(mode="v3turbo")
audio = tts.infer(
    text="${cleanText}",
    voice="${voice}",
    temperature=${temperature},
    top_p=${topP},
    apply_watermark=${applyWatermark ? "True" : "False"}
)
os.makedirs(os.path.dirname(os.path.abspath("${outputPath}")), exist_ok=True)
tts.save(audio, "${outputPath}")
print("SUCCESS")
`;

  try {
    const { stdout } = await execAsync(
      `"${VIENEU_PYTHON}" -c '${script.replace(/'/g, "'\\''")}'`,
      { timeout: 60000 }
    );

    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
      throw new Error(`VieNeu output file is empty or was not created: ${outputPath}`);
    }

    console.log(`🔊 [VieNeu TTS] Generated speech for voice "${voice}": ${path.basename(outputPath)}`);
    return outputPath;
  } catch (err: any) {
    console.error(`❌ [VieNeu TTS] Error generating speech: ${err.message}`);
    throw err;
  }
}
