/**
 * database.ts — SQLite-backed product storage (replaces products.json)
 *
 * Uses better-sqlite3 (synchronous, ACID, WAL mode) so every write is
 * atomic — no more half-written JSON files.
 *
 * All functions that previously touched data/products.json now go through
 * the helpers exported here.
 */

import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../data/products.db");

// ── Singleton connection ────────────────────────────────────────────────────────
let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL"); // faster concurrent reads
    _db.pragma("foreign_keys = ON");
    _initSchema(_db);
  }
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ── Schema ──────────────────────────────────────────────────────────────────────
function _initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      category            TEXT NOT NULL DEFAULT 'tech',
      affiliate_url       TEXT DEFAULT '',
      hashtags            TEXT DEFAULT '[]',          -- JSON array
      description         TEXT DEFAULT '',
      image_url           TEXT DEFAULT '',
      images              TEXT DEFAULT '[]',          -- JSON array
      video_url           TEXT DEFAULT '',
      promptsObj          TEXT DEFAULT NULL,           -- JSON object
      scene_images        TEXT DEFAULT NULL,           -- JSON array
      scene_urls          TEXT DEFAULT NULL,           -- JSON array
      consensus_feedback  TEXT DEFAULT NULL,
      debate_messages     TEXT DEFAULT NULL,           -- JSON array
      part_feedback       TEXT DEFAULT '',
      episodes            TEXT DEFAULT NULL,           -- JSON array
      enabled             INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT DEFAULT (datetime('now')),
      updated_at          TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at);
    CREATE INDEX IF NOT EXISTS idx_products_enabled ON products(enabled);
  `);
}

// ── Product type (same as scheduler.ts) ─────────────────────────────────────────
export interface Product {
  id: string;
  name: string;
  category: string;
  affiliate_url: string;
  hashtags: string[];
  image_url?: string;
  images?: string[];
  video_url?: string;
  description?: string;
  promptsObj?: any;
  scene_images?: string[];
  scene_urls?: string[];
  consensus_feedback?: string;
  debate_messages?: any[];
  part_feedback?: string;
  episodes?: any[];
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

// ── Row ↔ Product helpers ───────────────────────────────────────────────────────
function rowToProduct(row: any): Product {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    affiliate_url: row.affiliate_url || "",
    hashtags: _parseJson(row.hashtags, []),
    description: row.description || "",
    image_url: row.image_url || "",
    images: _parseJson(row.images, []),
    video_url: row.video_url || "",
    promptsObj: _parseJson(row.promptsObj, undefined),
    scene_images: _parseJson(row.scene_images, undefined),
    scene_urls: _parseJson(row.scene_urls, undefined),
    consensus_feedback: row.consensus_feedback || undefined,
    debate_messages: _parseJson(row.debate_messages, undefined),
    part_feedback: row.part_feedback || "",
    episodes: _parseJson(row.episodes, undefined),
    enabled: row.enabled === 1,
    created_at: row.created_at || undefined,
    updated_at: row.updated_at || undefined,
  };
}

function _parseJson(raw: string | null | undefined, fallback: any): any {
  if (raw === null || raw === undefined || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function _jsonOrNull(val: any): string | null {
  if (val === undefined || val === null) return null;
  return JSON.stringify(val);
}

// ── CRUD operations ─────────────────────────────────────────────────────────────

/**
 * Load all enabled products, sorted by created_at DESC (newest first).
 * Drop-in replacement for the old loadProducts().
 */
export function loadProducts(): Product[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM products WHERE enabled = 1 ORDER BY created_at DESC`
    )
    .all();
  return rows.map(rowToProduct);
}

/**
 * Load ALL products (including disabled), sorted by created_at DESC.
 */
export function loadAllProducts(): Product[] {
  const db = getDb();
  const rows = db
    .prepare(`SELECT * FROM products ORDER BY created_at DESC`)
    .all();
  return rows.map(rowToProduct);
}

/**
 * Load paginated products (enabled only).
 */
export function loadProductsPaginated(
  page: number,
  limit: number
): { products: Product[]; total: number; totalPages: number; has_more: boolean } {
  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS cnt FROM products WHERE enabled = 1`).get() as any
  ).cnt;
  const offset = (page - 1) * limit;
  const rows = db
    .prepare(
      `SELECT * FROM products WHERE enabled = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset);
  const totalPages = Math.ceil(total / limit) || 1;
  return {
    products: rows.map(rowToProduct),
    total,
    totalPages,
    has_more: offset + limit < total,
  };
}

/**
 * Find a single product by ID.
 */
export function findProductById(id: string): Product | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
  return row ? rowToProduct(row) : undefined;
}

/**
 * Create a new product. Returns the created product.
 */
export function createProduct(data: Partial<Product> & { id: string; name: string }): Product {
  const db = getDb();
  const nowIso = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO products (
      id, name, category, affiliate_url, hashtags, description,
      image_url, images, video_url, promptsObj, scene_images, scene_urls,
      consensus_feedback, debate_messages, part_feedback, episodes,
      enabled, created_at, updated_at
    ) VALUES (
      @id, @name, @category, @affiliate_url, @hashtags, @description,
      @image_url, @images, @video_url, @promptsObj, @scene_images, @scene_urls,
      @consensus_feedback, @debate_messages, @part_feedback, @episodes,
      @enabled, @created_at, @updated_at
    )
  `);

  stmt.run({
    id: data.id,
    name: data.name,
    category: data.category || "tech",
    affiliate_url: data.affiliate_url || "",
    hashtags: _jsonOrNull(data.hashtags || []),
    description: data.description || "",
    image_url: data.image_url || "",
    images: _jsonOrNull(data.images || []),
    video_url: data.video_url || "",
    promptsObj: _jsonOrNull(data.promptsObj),
    scene_images: _jsonOrNull(data.scene_images),
    scene_urls: _jsonOrNull(data.scene_urls),
    consensus_feedback: data.consensus_feedback || null,
    debate_messages: _jsonOrNull(data.debate_messages),
    part_feedback: data.part_feedback || "",
    episodes: _jsonOrNull(data.episodes),
    enabled: data.enabled !== false ? 1 : 0,
    created_at: data.created_at || nowIso,
    updated_at: data.updated_at || nowIso,
  });

  return findProductById(data.id)!;
}

/**
 * Update an existing product (partial update — only provided fields are changed).
 * Returns the updated product or undefined if not found.
 */
export function updateProduct(id: string, updates: Partial<Product>): Product | undefined {
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);
  if (!existing) return undefined;

  const setClauses: string[] = [];
  const params: any = { id };

  const directFields: (keyof Product)[] = [
    "name", "category", "affiliate_url", "description",
    "image_url", "video_url", "consensus_feedback", "part_feedback",
  ];
  for (const f of directFields) {
    if (updates[f] !== undefined) {
      setClauses.push(`${f} = @${f}`);
      params[f] = updates[f];
    }
  }

  const jsonFields: (keyof Product)[] = [
    "hashtags", "images", "promptsObj", "scene_images",
    "scene_urls", "debate_messages", "episodes",
  ];
  for (const f of jsonFields) {
    if (updates[f] !== undefined) {
      setClauses.push(`${f} = @${f}`);
      params[f] = _jsonOrNull(updates[f]);
    }
  }

  if (updates.enabled !== undefined) {
    setClauses.push(`enabled = @enabled`);
    params.enabled = updates.enabled ? 1 : 0;
  }

  if (updates.created_at !== undefined) {
    setClauses.push(`created_at = @created_at`);
    params.created_at = updates.created_at;
  }

  // Always bump updated_at
  setClauses.push(`updated_at = @updated_at`);
  params.updated_at = updates.updated_at || new Date().toISOString();

  if (setClauses.length === 0) return rowToProduct(existing);

  db.prepare(`UPDATE products SET ${setClauses.join(", ")} WHERE id = @id`).run(params);
  return findProductById(id);
}

/**
 * Delete a product by ID. Returns true if deleted.
 */
export function deleteProduct(id: string): boolean {
  const db = getDb();
  const info = db.prepare(`DELETE FROM products WHERE id = ?`).run(id);
  return info.changes > 0;
}

/**
 * Upsert: create if not exists, update if exists.
 */
export function upsertProduct(data: Partial<Product> & { id: string; name: string }): Product {
  const existing = findProductById(data.id);
  if (existing) {
    return updateProduct(data.id, data)!;
  }
  return createProduct(data);
}
