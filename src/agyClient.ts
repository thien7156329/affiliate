import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export const AGY_DEFAULT_MODEL = process.env.AGY_MODEL || "gemini-4-argon-low";

type AgyJsonOutput = {
  status?: string;
  response?: string;
  error?: string;
};

export function isAgyEnabled(): boolean {
  return !["0", "false", "off"].includes((process.env.AGY_ENABLED || "true").toLowerCase());
}

export function resolveAgyExecutable(): string {
  if (process.env.AGY_CLI_PATH && existsSync(process.env.AGY_CLI_PATH)) {
    return process.env.AGY_CLI_PATH;
  }
  const candidates = [
    process.env.AGY_CLI_PATH,
    "/Users/letrongthien/Downloads/projects/teams_bot_server/.tools/bin/agy",
    "/usr/local/bin/agy",
    "/opt/homebrew/bin/agy",
    "agy",
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "agy";
}

/** Run one isolated, non-interactive AGY turn. Resolves immediately when JSON completes or rejects immediately on error. */
export async function callAgy(
  systemPrompt: string,
  userPrompt: string,
  jsonMode: boolean = false,
  model: string = AGY_DEFAULT_MODEL,
  timeoutMsOverride?: number,
  addDirs?: string[]
): Promise<string> {
  if (!isAgyEnabled()) throw new Error("AGY is disabled by AGY_ENABLED");

  const executable = resolveAgyExecutable();
  const lowerModel = model.toLowerCase();
  const isArgon = lowerModel.includes("argon");
  const isCarbon = lowerModel.includes("carbon");
  const isOpus = lowerModel.includes("opus");
  const defaultTimeout = isOpus
    ? Number(process.env.OPUS_TIMEOUT_MS || 300_000) // 5 phút cho Opus
    : isCarbon
    ? Number(process.env.CARBON_TIMEOUT_MS || 270_000) // 4.5 phút cho Carbon
    : isArgon
    ? Number(process.env.ARGON_TIMEOUT_MS || 240_000) // 4 phút cho Argon
    : Number(process.env.AGY_TIMEOUT_MS || 240_000); // 4 phút cho các model khác
  const timeoutMs = timeoutMsOverride || defaultTimeout;

  const combinedPrompt = `${systemPrompt}\n\nUSER REQUEST:\n${userPrompt}\n\n${
    jsonMode
      ? "Return only one valid JSON value. Do not wrap it in Markdown fences or add commentary."
      : "Return only the requested final answer, without meta commentary."
  }`;

  const cliArgs = [
    "--print",
    combinedPrompt,
    "--model",
    model,
    "--output-format",
    "json",
    "--print-timeout",
    `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`,
    "--disable-slash-commands",
    "--dangerously-skip-permissions",
  ];
  if (Array.isArray(addDirs)) {
    for (const dir of addDirs) {
      if (dir && existsSync(dir)) {
        cliArgs.push("--add-dir", dir);
      }
    }
  }

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      executable,
      cliArgs,
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    let stdoutStr = "";
    let stderrStr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill("SIGKILL"); } catch {}
        reject(new Error(`AGY timed out after ${Math.round(timeoutMs / 1000)}s`));
      }
    }, timeoutMs + 10_000);

    function cleanup() {
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch {}
    }

    function tryParseOutput(): boolean {
      if (settled) return true;
      const trimmed = stdoutStr.trim();
      const firstBrace = trimmed.indexOf("{");
      const lastBrace = trimmed.lastIndexOf("}");
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        try {
          const jsonStr = trimmed.slice(firstBrace, lastBrace + 1);
          const parsed = JSON.parse(jsonStr) as AgyJsonOutput;
          if (parsed && typeof parsed.status === "string") {
            if (parsed.status === "SUCCESS" && parsed.response?.trim()) {
              settled = true;
              cleanup();
              let resp = parsed.response.trim();
              if (jsonMode) {
                resp = resp.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
                const f = resp.indexOf("{");
                const l = resp.lastIndexOf("}");
                if (f >= 0 && l > f) resp = resp.slice(f, l + 1);
              }
              resolve(resp);
              return true;
            } else if (parsed.status === "ERROR") {
              settled = true;
              cleanup();
              reject(new Error(parsed.error || stderrStr || "AGY returned ERROR status"));
              return true;
            }
          }
        } catch {
          // JSON might still be streaming chunks
        }
      }
      return false;
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutStr += chunk.toString("utf8");
      tryParseOutput();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderrStr += text;
      // Fast error check: quota, rate limit, or fatal failure
      if (!settled && (stderrStr.includes("Individual quota reached") || stderrStr.includes("RESOURCE_EXHAUSTED"))) {
        settled = true;
        cleanup();
        reject(new Error(stderrStr.trim()));
      }
    });

    child.on("close", (code) => {
      if (settled) return;
      if (!tryParseOutput()) {
        settled = true;
        cleanup();
        reject(new Error(`AGY process exited with code ${code}: ${(stderrStr || stdoutStr).trim().slice(0, 500)}`));
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(err);
      }
    });
  });
}
