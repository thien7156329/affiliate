/**
 * bun run props:sync — upload every image used to make videos to S3 "dao-cu-tao-video/" and refresh index.json.
 *   bg-library   shorts-kit/public/img/bg-library   (AI backgrounds, with tags/prompt/aspect from its index.json)
 *   story        shorts-kit/public/img/story        (picture-book panels / character sheets)
 *   product      data/downloads                     (product photos, Gemini scene keyframes)
 *   long         data/long-downloads
 * Safe to re-run: content already in the catalogue is skipped.
 */
import {existsSync, readdirSync, readFileSync, statSync} from "node:fs";
import {join, resolve} from "node:path";
import {loadIndex, propsConfigured, putProp, saveIndex} from "./lib/props_s3";

const KIT = resolve(import.meta.dir, "..");
const ROOT = resolve(KIT, "..");
const IMG = /\.(png|jpe?g|webp)$/i;

const walk = (dir: string): string[] =>
  !existsSync(dir)
    ? []
    : readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : IMG.test(n) ? [p] : [];
      });

if (!propsConfigured()) {
  console.error("Thiếu cấu hình S3 (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / S3_BUCKET_NAME) trong .env");
  process.exit(1);
}

const lib: {file: string; tags?: string[]; prompt?: string; aspect?: "9:16" | "16:9"; tone?: string}[] = (() => {
  try {
    return JSON.parse(readFileSync(join(KIT, "public/img/bg-library/index.json"), "utf8"));
  } catch {
    return [];
  }
})();
const libMeta = new Map(lib.map((e) => [e.file.split("/").pop(), e]));

const groups: [string, string][] = [
  ["bg-library", join(KIT, "public/img/bg-library")],
  ["story", join(KIT, "public/img/story")],
  ["product", join(ROOT, "data/downloads")],
  ["long", join(ROOT, "data/long-downloads")],
];

const idx = await loadIndex();
let up = 0;
let skip = 0;
let bytes = 0;
const t0 = Date.now();
for (const [cat, dir] of groups) {
  const files = walk(dir);
  console.log(`${cat}: ${files.length} ảnh`);
  // small parallel batches: S3 handles it fine, the network stays the bottleneck
  for (let i = 0; i < files.length; i += 8) {
    const batch = files.slice(i, i + 8);
    const res = await Promise.all(
      batch.map((f) => {
        const m = cat === "bg-library" ? libMeta.get(f.split("/").pop()) : undefined;
        return putProp(idx, f, cat, m ? {tags: m.tags, prompt: m.prompt, aspect: m.aspect, tone: m.tone} : {}).catch((e) => {
          console.warn(`  ! ${f}: ${(e as Error).message}`);
          return null;
        });
      }),
    );
    for (const r of res) {
      if (!r) continue;
      if (r.uploaded) {
        up++;
        bytes += r.entry.bytes;
      } else skip++;
    }
    if ((i / 8) % 20 === 0) await saveIndex(idx); // checkpoint
  }
}
await saveIndex(idx);
console.log(
  `Xong: ${up} ảnh mới (${(bytes / 1e6).toFixed(1)} MB), ${skip} đã có sẵn, ${Object.keys(idx.items).length} ảnh trong danh mục — ${Math.round((Date.now() - t0) / 1000)}s`,
);
