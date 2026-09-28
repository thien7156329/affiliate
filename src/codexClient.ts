import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export const CODEX_CLI_PATH = process.env.CODEX_CLI_PATH || "/Applications/ChatGPT.app/Contents/Resources/codex";
export const CODEX_MODEL = process.env.CODEX_MODEL || "gpt-5.6-sol";
export const CODEX_EFFORT = process.env.CODEX_EFFORT || "low";

export function isCodexEnabled(): boolean {
  return !["0", "false", "off"].includes((process.env.CODEX_ENABLED || "true").toLowerCase());
}

/**
 * Run non-interactive query against OpenAI Codex (gpt-5.6-sol with low reasoning effort = Sol Mode Light).
 */
export async function callCodexSol(
  systemPrompt: string,
  userPrompt: string,
  jsonMode: boolean = false
): Promise<string> {
  if (!isCodexEnabled()) throw new Error("Codex is disabled by CODEX_ENABLED");

  const executable = CODEX_CLI_PATH;
  if (!fs.existsSync(executable)) {
    throw new Error(`Codex binary not found at ${executable}`);
  }

  const tmpOut = path.join(os.tmpdir(), `codex_out_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  const combinedPrompt = `${systemPrompt}\n\nUSER REQUEST:\n${userPrompt}\n\n${
    jsonMode
      ? "Return only one valid JSON value. Do not wrap it in Markdown fences or add commentary."
      : "Return only the requested final screenplay, without meta commentary."
  }`;

  const timeoutMs = Number(process.env.CODEX_TIMEOUT_MS || 180_000);

  return new Promise<string>((resolve, reject) => {
    const args = [
      "exec",
      "--ephemeral",
      "-m", CODEX_MODEL,
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
          return reject(new Error(`Codex exited with code ${code}: ${stderr || stdout}`));
        }
        reject(new Error("Codex finished but output file was empty"));
      } catch (e) {
        reject(e);
      }
    });
  });
}

