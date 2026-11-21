import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

function findCodexCli(): string {
  if (process.env.CODEX_CLI_PATH && fs.existsSync(process.env.CODEX_CLI_PATH)) {
    return process.env.CODEX_CLI_PATH;
  }
  const candidates = [
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
    "/Applications/ChatGPT.app/Contents/Resources/codex",
    "/usr/local/bin/codex",
    "/opt/homebrew/bin/codex"
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return process.env.CODEX_CLI_PATH || "/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex";
}

export const CODEX_CLI_PATH = findCodexCli();
export const CODEX_MODEL = process.env.CODEX_MODEL || "gpt-5.6-sol";
export const CODEX_TERRA_MODEL = process.env.CODEX_TERRA_MODEL || "gpt-5.6-terra";
export const CODEX_EFFORT = process.env.CODEX_EFFORT || "low";

let codexExhaustedUntil: number = Date.now() + 3600_000 * 24; // Initialized as exhausted because usage limit was reached

export function isCodexExhausted(): boolean {
  return Date.now() < codexExhaustedUntil;
}

export function markCodexExhausted(durationMs: number = 3600_000 * 24): void {
  codexExhaustedUntil = Date.now() + durationMs;
  console.log(`⚠️ [Codex] Marked Codex as exhausted for ${Math.round(durationMs / 60000)} minutes.`);
}

export function resetCodexExhausted(): void {
  codexExhaustedUntil = 0;
}

export function isCodexEnabled(): boolean {
  if (isCodexExhausted()) return false;
  return !["0", "false", "off"].includes((process.env.CODEX_ENABLED || "true").toLowerCase());
}

/**
 * Run non-interactive query against OpenAI Codex with selectable model (e.g. gpt-5.6-terra or gpt-5.6-sol).
 */
export async function callCodex(
  systemPrompt: string,
  userPrompt: string,
  jsonMode: boolean = false,
  modelOverride?: string
): Promise<string> {
  if (!isCodexEnabled()) throw new Error("Codex is disabled by CODEX_ENABLED");

  const executable = findCodexCli();
  if (!fs.existsSync(executable)) {
    throw new Error(`Codex binary not found at ${executable}`);
  }

  const targetModel = modelOverride || CODEX_MODEL;
  const tmpOut = path.join(os.tmpdir(), `codex_out_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  const combinedPrompt = `${systemPrompt}\n\nUSER REQUEST:\n${userPrompt}\n\n${
    jsonMode
      ? "Return only one valid JSON value. Do not wrap it in Markdown fences or add commentary."
      : "Return only the requested final screenplay, without meta commentary."
  }`;

  const timeoutMs = Number(process.env.CODEX_TIMEOUT_MS || 45_000);

  return new Promise<string>((resolve, reject) => {
    const args = [
      "exec",
      "--ephemeral",
      "-m", targetModel,
      "-c", `model_reasoning_effort="${CODEX_EFFORT}"`,
      "-s", "read-only",
      "--skip-git-repo-check",
      "-o", tmpOut,
      combinedPrompt
    ];

    const proc = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      if (fs.existsSync(tmpOut)) { try { fs.unlinkSync(tmpOut); } catch {} }
      reject(new Error(`Codex call timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (fs.existsSync(tmpOut)) { try { fs.unlinkSync(tmpOut); } catch {} }
      reject(err);
    });

    proc.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (fs.existsSync(tmpOut)) {
          let result = fs.readFileSync(tmpOut, "utf-8").trim();
          fs.unlinkSync(tmpOut);
          if (jsonMode) {
            result = result.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
            const firstBrace = result.indexOf("{");
            const lastBrace = result.lastIndexOf("}");
            if (firstBrace >= 0 && lastBrace > firstBrace) {
              result = result.slice(firstBrace, lastBrace + 1);
            }
          }
          if (result) {
            return resolve(result);
          }
        }
        if (code !== 0) {
          const errText = `${stderr} ${stdout}`.trim();
          if (
            errText.includes("hit your usage limit") ||
            errText.includes("Upgrade to Plus") ||
            errText.includes("rate limit")
          ) {
            markCodexExhausted(3600_000 * 24);
          }
          return reject(new Error(`Codex exited with code ${code}: ${errText}`));
        }
        reject(new Error("Codex finished but output file was empty"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Run query against OpenAI Codex Sol (gpt-5.6-sol).
 */
export async function callCodexSol(
  systemPrompt: string,
  userPrompt: string,
  jsonMode: boolean = false
): Promise<string> {
  return callCodex(systemPrompt, userPrompt, jsonMode, CODEX_MODEL);
}

/**
 * Run query against OpenAI Codex Terra (gpt-5.6-terra) for fast and robust script review.
 */
export async function callCodexTerra(
  systemPrompt: string,
  userPrompt: string,
  jsonMode: boolean = false
): Promise<string> {
  return callCodex(systemPrompt, userPrompt, jsonMode, CODEX_TERRA_MODEL);
}
