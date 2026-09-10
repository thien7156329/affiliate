import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const AGY_DEFAULT_MODEL = process.env.AGY_MODEL || "gemini-3.8-flash-high";

type AgyJsonOutput = {
  status?: string;
  response?: string;
};

export function isAgyEnabled(): boolean {
  return !["0", "false", "off"].includes((process.env.AGY_ENABLED || "true").toLowerCase());
}

/** Run one isolated, non-interactive AGY turn. No shell is used, so prompts are passed safely. */
export async function callAgy(
  systemPrompt: string,
  userPrompt: string,
  jsonMode: boolean = false,
  model: string = AGY_DEFAULT_MODEL
): Promise<string> {
  if (!isAgyEnabled()) throw new Error("AGY is disabled by AGY_ENABLED");

  const executable = process.env.AGY_CLI_PATH || "agy";
  const timeoutMs = Number(process.env.AGY_TIMEOUT_MS || 300_000);
  const combinedPrompt = `${systemPrompt}\n\nUSER REQUEST:\n${userPrompt}\n\n${
    jsonMode
      ? "Return only one valid JSON value. Do not wrap it in Markdown fences or add commentary."
      : "Return only the requested final answer, without meta commentary."
  }`;

  const { stdout, stderr } = await execFileAsync(
    executable,
    [
      "--print",
      combinedPrompt,
      "--model",
      model,
      "--output-format",
      "json",
      "--print-timeout",
      `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`,
      "--disable-slash-commands",
    ],
    { timeout: timeoutMs + 5_000, maxBuffer: 20 * 1024 * 1024 }
  );

  let output: AgyJsonOutput;
  try {
    output = JSON.parse(stdout.trim()) as AgyJsonOutput;
  } catch {
    throw new Error(`AGY returned invalid JSON output: ${(stderr || stdout).trim().slice(0, 500)}`);
  }

  if (output.status !== "SUCCESS" || !output.response?.trim()) {
    throw new Error(`AGY failed: ${(stderr || stdout).trim().slice(0, 500)}`);
  }
  let response = output.response.trim();
  if (jsonMode) {
    response = response.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const firstBrace = response.indexOf("{");
    const lastBrace = response.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      response = response.slice(firstBrace, lastBrace + 1);
    }
  }
  return response;
}
