/**
 * videoAnalyzer.ts
 *
 * Uses Gemini 2.5 Flash / Pro Multimodal API to analyze video files,
 * identifying exact speaker segments, timestamps (start/end in seconds),
 * dialogue text, and emotion for character voice alignment.
 */

import axios from "axios";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

export interface DialogueSegment {
  id?: string;
  speaker: string;        // Character ID e.g. "xam", "sep_shiba", "be_meow"
  speaker_name?: string;  // Display name e.g. "Xám", "Sếp Shiba"
  start: number;         // Start timestamp in seconds
  end: number;           // End timestamp in seconds
  text: string;          // Dialogue text in Vietnamese
  emotion?: string;      // "happy" | "angry" | "melancholy" | "excited"
}

export interface VideoAnalysisResult {
  video_duration: number;
  segments: DialogueSegment[];
  summary?: string;
}

/**
 * Helper to get video duration using ffprobe/ffmpeg
 */
export function getVideoDuration(videoPath: string): number {
  try {
    const output = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`, {
      encoding: "utf-8"
    });
    const dur = parseFloat(output.trim());
    return isNaN(dur) ? 10.0 : dur;
  } catch {
    return 10.0;
  }
}

/**
 * Analyze a video to extract speaker timestamps using Gemini Multimodal API.
 * Falls back to script-segmentation if Gemini API key is missing or video analysis fails.
 */
export async function analyzeVideoDialogueTimestamps(
  videoPath: string,
  providedScript?: string,
  knownCharacters: string[] = ["xam", "sep_shiba", "be_meow"]
): Promise<VideoAnalysisResult> {
  const duration = getVideoDuration(videoPath);
  const geminiKey = process.env.GEMINI_API_KEY;

  if (geminiKey && fs.existsSync(videoPath)) {
    try {
      console.log(`🤖 [VideoAnalyzer] Analyzing video with Gemini 2.5: ${path.basename(videoPath)} (${duration.toFixed(1)}s)...`);
      const fileBuffer = fs.readFileSync(videoPath);
      const base64Video = fileBuffer.toString("base64");

      const promptText = `Analyze this video and identify every dialogue segment. 
Known character IDs: ${knownCharacters.join(", ")}.
If there is a provided script, match lines to exact video timestamps:
"${providedScript || "Extract dialogue from video"}"

For each segment, return a JSON array containing objects with:
- "speaker": string (one of known character IDs e.g. xam, sep_shiba, be_meow)
- "start": number (start time in seconds, e.g. 0.8)
- "end": number (end time in seconds, e.g. 3.4)
- "text": string (exact dialogue spoken in Vietnamese)
- "emotion": string (e.g. happy, angry, sad, excited)

IMPORTANT: Return JSON array ONLY. No markdown wrapper.`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
      const payload = {
        contents: [
          {
            role: "user",
            parts: [
              {
                inlineData: {
                  mimeType: "video/mp4",
                  data: base64Video.length < 20 * 1024 * 1024 ? base64Video : undefined // send if small enough
                }
              },
              { text: promptText }
            ].filter(p => p.text || p.inlineData?.data)
          }
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json"
        }
      };

      const response = await axios.post(url, payload, { timeout: 30000 });
      const rawText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (rawText) {
        const cleanJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleanJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const segments: DialogueSegment[] = parsed.map((item: any, idx: number) => ({
            id: `seg_${idx + 1}`,
            speaker: item.speaker || knownCharacters[0] || "xam",
            start: parseFloat(item.start) || 0.0,
            end: parseFloat(item.end) || Math.min(duration, (parseFloat(item.start) || 0.0) + 3.0),
            text: item.text || "",
            emotion: item.emotion || "neutral"
          }));
          return { video_duration: duration, segments, summary: "Analyzed via Gemini 2.5 Flash" };
        }
      }
    } catch (err: any) {
      console.warn(`⚠️ [VideoAnalyzer] Gemini analysis failed/skipped: ${err.message}. Using intelligent script segmentation fallback.`);
    }
  }

  // Fallback: Intelligent script segmentation based on dialogue lines and video duration
  return parseScriptToTimestamps(providedScript || "", duration);
}

/**
 * Fallback parser: Parses raw script lines into timed dialogue segments
 */
export function parseScriptToTimestamps(script: string, videoDuration: number): VideoAnalysisResult {
  const lines = script
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const segments: DialogueSegment[] = [];
  const validLines: Array<{ speaker: string; text: string }> = [];

  for (const line of lines) {
    let speaker = "xam";
    let text = line;

    if (line.includes("Sếp") || line.includes("Shiba") || line.startsWith("👔")) {
      speaker = "sep_shiba";
      text = line.replace(/^[👔🐶🐱]?\s*(Sếp Shiba|Sếp|Shiba):\s*/i, "");
    } else if (line.includes("Xám") || line.startsWith("🐶")) {
      speaker = "xam";
      text = line.replace(/^[👔🐶🐱]?\s*(Xám):\s*/i, "");
    } else if (line.includes("Meow") || line.startsWith("🐱")) {
      speaker = "be_meow";
      text = line.replace(/^[👔🐶🐱]?\s*(Bé Meow|Meow):\s*/i, "");
    }

    text = text.replace(/^["“']|["”']$/g, "").trim();
    if (text) {
      validLines.push({ speaker, text });
    }
  }

  if (validLines.length === 0) {
    validLines.push({
      speaker: "xam",
      text: script || "Xin chào mọi người!"
    });
  }

  const segmentDuration = Math.min(5.0, (videoDuration - 0.5) / validLines.length);

  validLines.forEach((item, idx) => {
    const start = 0.4 + idx * segmentDuration;
    const end = Math.min(videoDuration - 0.1, start + segmentDuration - 0.2);
    segments.push({
      id: `seg_${idx + 1}`,
      speaker: item.speaker,
      start: parseFloat(start.toFixed(2)),
      end: parseFloat(end.toFixed(2)),
      text: item.text,
      emotion: item.speaker === "sep_shiba" ? "angry" : "neutral"
    });
  });

  return { video_duration: videoDuration, segments, summary: "Segmented via script parser" };
}

/**
 * Backward compatibility helper for single video segment speech start timestamp
 */
export async function analyzeVideoSpeakingTimestamp(videoPath: string): Promise<{ start_sec: number }> {
  const result = await analyzeVideoDialogueTimestamps(videoPath);
  const startSec = result.segments.length > 0 ? result.segments[0].start : 0.4;
  return { start_sec: startSec };
}
