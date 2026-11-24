/**
 * bun run props:pull — on a new machine, download every video prop listed in s3://<bucket>/dao-cu-tao-video/index.json
 * back to its original path (same relative path as on the machine that uploaded it). Existing identical files are skipped.
 *   bun run props:pull                 # everything
 *   bun run props:pull bg-library      # one category (bg-library | story | product | long)
 * Needs the project .env (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME) copied from the old machine.
 */
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {loadIndex, propsConfigured} from "./lib/props_s3";

const ROOT = resolve(import.meta.dir, "../..");
const only = process.argv[2];

if (!propsConfigured()) {
  console.error("Thiếu cấu hình S3 trong .env (chép file .env từ máy cũ sang thư mục affiliate/).");
  process.exit(1);
}
const idx = await loadIndex();
const items = Object.values(idx.items).filter((e) => !only || e.category === only);
console.log(`Danh mục: ${items.length} ảnh${only ? ` (${only})` : ""}`);

let got = 0;
let skip = 0;
let fail = 0;
for (let i = 0; i < items.length; i += 8) {
  await Promise.all(
    items.slice(i, i + 8).map(async (e) => {
      const dest = join(ROOT, e.source);
      if (existsSync(dest) && createHash("sha1").update(readFileSync(dest)).digest("hex") === e.sha1) {
        skip++;
        return;
      }
      try {
        const r = await fetch(e.url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        mkdirSync(dirname(dest), {recursive: true});
        writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
        got++;
      } catch (err) {
        fail++;
        console.warn(`  ! ${e.key}: ${(err as Error).message}`);
      }
    }),
  );
}
console.log(`Xong: tải ${got}, đã có ${skip}, lỗi ${fail}`);
