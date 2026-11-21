import "dotenv/config";
import { isCodexEnabled, CODEX_TERRA_MODEL } from "./codexClient.js";
import { AGY_DEFAULT_MODEL } from "./agyClient.js";

export const GEMINI_CARBON_MODEL = process.env.CARBON_MODEL || "gemini-4-carbon-low";
export const GEMINI_ARGON_MODEL = "gemini-4-argon-low";

/**
 * Format any raw model ID (e.g. "gemini-4-carbon-low", "gemini-4-argon-high", "gpt-5.6-terra") into a clean display label.
 */
export function formatModelDisplayName(modelId?: string): string {
  if (!modelId) return "AI Model";
  const lower = modelId.toLowerCase();
  if (lower.includes("claude-opus-5-5-high") || lower.includes("opus-5-5-high") || lower.includes("opus-5.5-high")) return "Claude Opus 5.5 High";
  if (lower.includes("claude-opus-5-5-medium") || lower.includes("claude-opus-5-5-med") || lower.includes("opus-5-5-med") || lower.includes("opus-5.5-med")) return "Claude Opus 5.5 Med";
  if (lower.includes("claude-opus-5-5-low") || lower.includes("opus-5-5-low") || lower.includes("opus-5.5-low")) return "Claude Opus 5.5 Low";
  if (lower.includes("claude-opus-5-5") || lower.includes("opus-5.5") || lower.includes("opus-5-5")) return "Claude Opus 5.5";
  if (lower.includes("claude-sonnet-5-5-high") || lower.includes("sonnet-5-5-high")) return "Claude Sonnet 5.5 High";
  if (lower.includes("claude-sonnet-5-5")) return "Claude Sonnet 5.5";
  if (lower.includes("gemini-4-carbon-high") || lower.includes("carbon-4-high") || lower.includes("carbon-4.0-high")) return "Gemini 4 Carbon High";
  if (lower.includes("gemini-4-carbon-medium") || lower.includes("gemini-4-carbon-med") || lower.includes("carbon-4-med")) return "Gemini 4 Carbon Med";
  if (lower.includes("gemini-4-carbon-low") || lower.includes("carbon-4-low")) return "Gemini 4 Carbon Low";
  if (lower.includes("gemini-4-carbon") || lower.includes("carbon")) return "Gemini 4 Carbon";
  if (lower.includes("gemini-4-argon-high") || lower.includes("argon-4-high") || lower.includes("argon-4.0-high")) return "Gemini 4 Argon High";
  if (lower.includes("gemini-4-argon-medium") || lower.includes("gemini-4-argon-med") || lower.includes("argon-4-med")) return "Gemini 4 Argon Med";
  if (lower.includes("gemini-4-argon-low") || lower.includes("argon-4-low")) return "Gemini 4 Argon Low";
  if (lower.includes("gemini-4-argon") || lower.includes("gemini-4") || lower.includes("argon")) return "Gemini 4 Argon";
  if (lower.includes("gemini-3.8")) return "Gemini 3.8 Flash";
  if (lower.includes("gpt-5.6-terra")) return "OpenAI GPT-5.6 Terra";
  if (lower.includes("gpt-5.6-sol")) return "OpenAI Codex Sol";
  if (lower.includes("glm-5")) return "Zhipu AI GLM-5";
  return modelId;
}

export function getScriptwriterModel(): string {
  return process.env.SCRIPTWRITER_MODEL || "claude-opus-5-5-medium";
}

export function getAuditorModel(): string {
  return process.env.AUDITOR_MODEL || "gemini-4-argon-low";
}

export function getValidatorModel(): string {
  return process.env.AGY_MODEL || AGY_DEFAULT_MODEL || "gemini-4-argon-low";
}

export function getActiveAiInfo() {
  const scriptwriterModel = getScriptwriterModel();
  const auditorModel = getAuditorModel();
  const validatorModel = getValidatorModel();

  const ai1Label = formatModelDisplayName(scriptwriterModel);
  const ai2Label = formatModelDisplayName(auditorModel);
  const validatorLabel = formatModelDisplayName(validatorModel);

  return {
    ai1: {
      id: scriptwriterModel,
      name: `AI 1 (${ai1Label})`,
      label: ai1Label,
      role: "Sáng tác kịch bản 3D",
    },
    ai2: {
      id: auditorModel,
      name: `AI 2 (${ai2Label})`,
      label: ai2Label,
      role: "Kiểm định tiêu chí & bố cục",
    },
    validator: {
      id: validatorModel,
      name: `Hệ Thống Kiểm Định (${validatorLabel})`,
      label: validatorLabel,
      role: "Kiểm định an toàn Veo 3",
    },
  };
}
