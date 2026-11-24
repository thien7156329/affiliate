/**
 * `bun run dev|still|render|cover <id>`: Remotion on one video's own entry.
 *
 *   dev <id>                         Studio on src/videos/<id>/entry.tsx
 *   still <id> [--frame=N] [--safe]  out/<id>/still-<N>.png (--safe draws the safe zones)
 *   render <id>                      out/<id>/<id>.mp4
 *   cover <id> [--safe]              out/<id>/<id>-cover.png + .jpg (--safe → out/<id>/cover-safe.png)
 *
 * Every video registers the composition ids `Video` and `Cover`.
 */
import {existsSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";
import {FPS} from "../src/shared/theme";
import {spokenEndSeconds, type Voice} from "../src/shared/timings";
import {loadNarration, voiceHash} from "./lib/narration";
import {die, ensureDir, flag, outDir, p, videoDir} from "./lib/paths";
import {duration, must, run} from "./lib/proc";

const [mode, id] = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const MODES = ["dev", "still", "render", "cover", "chapter"];
if (mode === "dev" && !id) {
  await import("./preview");
  await new Promise(() => {});
}
if (!MODES.includes(mode) || !id) die(`usage: bun run ${MODES.join("|")} <id> [--frame=N] [--safe]`);
const entry = join(videoDir(id), "entry.tsx");
if (!existsSync(entry)) die(`no video "${id}": src/videos/${id}/entry.tsx does not exist`);
// Windows: node_modules/.bin/remotion is a .cmd shim that cannot take JSON args (--props={"safe":true}); run the CLI through node.
const remotionCli = process.platform === "win32" ? ["node", p("node_modules/@remotion/cli/remotion-cli.js")] : [p("node_modules/.bin/remotion")];
const runRemotion = (args: string[], opts: Parameters<typeof run>[2]) => run(remotionCli[0], [...remotionCli.slice(1), ...args], opts);
const relEntry = `src/videos/${id}/entry.tsx`;
const safe = flag("safe") !== undefined;
const MIN = 60_000;

// voice.json sanity: estimated or stale timing renders silently wrong
const voicePath = join(videoDir(id), "voice.json");
let voice: Voice | undefined;
if (existsSync(voicePath) && existsSync(join(videoDir(id), "narration.json"))) {
  voice = JSON.parse(readFileSync(voicePath, "utf8")) as Voice;
  const n = loadNarration(id);
  if (voice.estimated) {
    const msg = `voice.json is an estimate (no audio). Run \`bun run tts ${id}\` first.`;
    if (mode === "render" && flag("allow-estimated") === undefined) die(`${msg} (--allow-estimated to render anyway)`);
    console.warn(`! ${msg}`);
  } else if (voice.hash !== voiceHash(n)) {
    console.warn(`! narration.json changed since the last TTS: timing is stale. Run \`bun run tts ${id}\`.`);
  }
  if (voice.audio && !existsSync(p("public", voice.audio))) {
    die(`voice.json points at public/${voice.audio}, which does not exist. Run \`bun run tts ${id} --force\`.`);
  }
}

const remotion = async (args: string[], timeoutMs: number) => {
  const r = await runRemotion(args, {inherit: true, timeoutMs});
  if (r.timedOut) die(`remotion ${args[0]} timed out after ${timeoutMs / MIN} min`);
  if (r.code !== 0) die(`remotion ${args[0]} exited ${r.code}`);
};
const mustExist = (file: string, since: number) => {
  if (!existsSync(file) || statSync(file).mtimeMs < since || statSync(file).size === 0) {
    die(`${file} was not written (exit 0 is not proof). Re-run the renderer directly on a few frames to see the error.`);
  }
};

const out = ensureDir(outDir(id));
const started = Date.now() - 1000;
const props = JSON.stringify({safe});

if (mode === "dev") {
  const r = await runRemotion(["studio", relEntry], {inherit: true, timeoutMs: 24 * 60 * MIN});
  process.exit(r.code);
}

if (mode === "still") {
  const f = flag("frame");
  const frame = typeof f === "string" ? Number(f) : 0;
  if (!Number.isInteger(frame) || frame < 0) die(`--frame must be a frame number, got "${f}"`);
  const file = join(out, `still-${frame}.png`);
  await remotion(["still", relEntry, "Video", file, `--frame=${frame}`, `--props=${props}`], 30 * MIN);
  mustExist(file, started);
  console.log(`+ out/${id}/still-${frame}.png${safe ? " (safe-zone overlay on)" : ""}. Open it and look (§7).`);
}

if (mode === "render") {
  const file = join(out, `${id}.mp4`);
  await remotion(["render", relEntry, "Video", file, "--codec=h264", `--props=${props}`], 180 * MIN);
  mustExist(file, started);
  const got = await duration(file);
  const want = voice ? Math.ceil(spokenEndSeconds(voice) * FPS) / FPS : NaN;
  console.log(`+ out/${id}/${id}.mp4  ${got.toFixed(2)} s${voice ? ` (voice ${spokenEndSeconds(voice).toFixed(2)} s ≈ ${want.toFixed(2)} s)` : ""}`);
  if (voice && Math.abs(got - want) > 0.25) console.warn(`! duration differs from voice end by ${(got - want).toFixed(2)} s`);
  console.log(`  Next: pull frames from the mp4 and look, then \`bun run normalize ${id}\`.`);
}

if (mode === "chapter") {
  // bun run chapter <id> --from=<sec> --to=<sec> --n=<k>: half-size draft of one time range → <out>/chapters/ch<k>.mp4 (for review)
  const fromS = Number(flag("from") ?? 0);
  const toS = Number(flag("to") ?? 0);
  const n = String(flag("n") ?? "1").padStart(2, "0");
  if (!Number.isFinite(fromS) || !Number.isFinite(toS) || toS <= fromS) die("--from=<sec> --to=<sec> are required (to > from)");
  const dir = ensureDir(join(out, "chapters"));
  const file = join(dir, `ch${n}.mp4`);
  const f0 = Math.max(0, Math.floor(fromS * FPS));
  // never past the last frame of the composition (the final chapter ends at the voice end)
  const lastFrame = voice ? Math.ceil(spokenEndSeconds(voice) * FPS) - 1 : Infinity;
  const f1 = Math.min(Math.ceil(toS * FPS) - 1, lastFrame);
  await remotion(["render", relEntry, "Video", file, "--codec=h264", "--scale=0.5", "--crf=30", `--frames=${f0}-${f1}`, `--props=${props}`], 60 * MIN);
  mustExist(file, started);
  console.log(`+ ${file}  frames ${f0}-${f1} (draft, half size)`);
}

if (mode === "cover") {
  const png = join(out, safe ? "cover-safe.png" : `${id}-cover.png`);
  await remotion(["still", relEntry, "Cover", png, `--props=${props}`], 30 * MIN);
  mustExist(png, started);
  if (safe) {
    console.log(`+ out/${id}/cover-safe.png (overlay on, not for upload)`);
  } else {
    const jpg = join(out, `${id}-cover.jpg`);
    // -q:v 2 ≈ JPEG quality 92; 4:4:4 keeps text edges clean
    await must("ffmpeg", ["-v", "error", "-y", "-i", png, "-pix_fmt", "yuvj444p", "-q:v", "2", jpg], {timeoutMs: 60_000});
    console.log(`+ out/${id}/${id}-cover.png and .jpg. Check it at 200 px wide (sk-handoff, §10).`);
  }
}
