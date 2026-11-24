/**
 * bun run bg <id>  — render the AI backgrounds of a stickman-explainer video (FLUX schnell, local).
 * Reads src/videos/<id>/explainer.json, writes src/videos/<id>/backgrounds.json.
 */
import {buildVideoBackgrounds} from "./lib/explainer_bg";

const id = process.argv[2];
if (!id) {
  console.error("usage: bun run bg <id>");
  process.exit(1);
}
const t0 = Date.now();
const res = await buildVideoBackgrounds(id, {
  onProgress: (d, n, bg) => console.log(`[bg] ${d}/${n} ${bg}`),
  log: (s) => console.log(s),
});
const ok = res.filter((r) => r.src).length;
console.log(`[bg] ${ok}/${res.length} backgrounds ready in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
if (res.length && ok === 0) process.exitCode = 2;
