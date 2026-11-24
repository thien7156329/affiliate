/**
 * "Đạo cụ tạo video" (video props) on S3: every image used to build videos lives under
 *   s3://<bucket>/dao-cu-tao-video/<category>/<file>
 * and one catalogue lists them all:
 *   s3://<bucket>/dao-cu-tao-video/index.json   (mirror: shorts-kit/props-index.json)
 * Entries are keyed by content hash, so re-running never uploads the same image twice.
 * Credentials/bucket come from the project .env (AWS_*, S3_BUCKET_NAME) — never hard-coded.
 */
import {createHash} from "node:crypto";
import {existsSync, readFileSync, statSync, writeFileSync} from "node:fs";
import {basename, extname, join, resolve} from "node:path";
import {GetObjectCommand, PutObjectCommand, S3Client} from "@aws-sdk/client-s3";

const KIT = resolve(import.meta.dir, "../..");
const ROOT = resolve(KIT, "..");
export const PROPS_PREFIX = "dao-cu-tao-video/";
export const LOCAL_INDEX = join(KIT, "props-index.json");

export type PropEntry = {
  key: string;
  url: string;
  category: string;
  sha1: string;
  bytes: number;
  aspect?: "9:16" | "16:9";
  tags?: string[];
  prompt?: string;
  tone?: string;
  source: string; // path relative to the affiliate repo
  addedAt: string;
};
export type PropsIndex = {updatedAt: string; bucket: string; prefix: string; items: Record<string, PropEntry>};

const env = (() => {
  const out: Record<string, string> = {};
  for (const f of [join(ROOT, ".env"), join(KIT, ".env")]) {
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
      if (m && !(m[1] in out)) out[m[1]] = m[2].trim();
    }
  }
  return (k: string) => process.env[k] || out[k] || "";
})();

const bucket = () => env("S3_BUCKET_NAME");
const region = () => env("AWS_REGION") || "us-east-1";
let client: S3Client | null = null;
const s3 = () =>
  (client ??= new S3Client({
    region: region(),
    credentials: {accessKeyId: env("AWS_ACCESS_KEY_ID"), secretAccessKey: env("AWS_SECRET_ACCESS_KEY")},
  }));

export const propsConfigured = () => Boolean(bucket() && env("AWS_ACCESS_KEY_ID") && env("AWS_SECRET_ACCESS_KEY"));
const publicUrl = (key: string) => `https://${bucket()}.s3.${region()}.amazonaws.com/${key.split("/").map(encodeURIComponent).join("/")}`;
const MIME: Record<string, string> = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"};

export const loadIndex = async (): Promise<PropsIndex> => {
  const empty: PropsIndex = {updatedAt: new Date().toISOString(), bucket: bucket(), prefix: PROPS_PREFIX, items: {}};
  try {
    const r = await s3().send(new GetObjectCommand({Bucket: bucket(), Key: `${PROPS_PREFIX}index.json`}));
    return JSON.parse(await r.Body!.transformToString());
  } catch {
    try {
      return JSON.parse(readFileSync(LOCAL_INDEX, "utf8"));
    } catch {
      return empty;
    }
  }
};

export const saveIndex = async (idx: PropsIndex) => {
  idx.updatedAt = new Date().toISOString();
  const body = JSON.stringify(idx, null, 1);
  writeFileSync(LOCAL_INDEX, `${body}\n`);
  await s3().send(
    new PutObjectCommand({Bucket: bucket(), Key: `${PROPS_PREFIX}index.json`, Body: body, ContentType: "application/json; charset=utf-8"}),
  );
};

/** Upload one image (skipped when the same content is already in the index). Returns the entry. */
export const putProp = async (
  idx: PropsIndex,
  abs: string,
  category: string,
  meta: Partial<Pick<PropEntry, "aspect" | "tags" | "prompt" | "tone">> = {},
): Promise<{entry: PropEntry; uploaded: boolean}> => {
  const buf = readFileSync(abs);
  const sha1 = createHash("sha1").update(buf).digest("hex");
  const existing = idx.items[sha1];
  if (existing) {
    // keep catalogue info fresh (tags may be added later) without re-uploading
    Object.assign(existing, Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined)));
    return {entry: existing, uploaded: false};
  }
  const ext = extname(abs).toLowerCase();
  const key = `${PROPS_PREFIX}${category}/${sha1.slice(0, 10)}-${basename(abs).replace(/[^\w.-]+/g, "_").slice(-60)}`;
  await s3().send(new PutObjectCommand({Bucket: bucket(), Key: key, Body: buf, ContentType: MIME[ext] ?? "application/octet-stream"}));
  const entry: PropEntry = {
    key,
    url: publicUrl(key),
    category,
    sha1,
    bytes: statSync(abs).size,
    ...meta,
    source: abs.startsWith(ROOT) ? abs.slice(ROOT.length + 1) : abs,
    addedAt: new Date().toISOString(),
  };
  idx.items[sha1] = entry;
  return {entry, uploaded: true};
};
