/**
 * migrate-to-sqlite.ts — One-time migration: products.json → SQLite
 *
 * Usage: npx tsx src/migrate-to-sqlite.ts
 *
 * - Reads existing data/products.json
 * - Creates data/products.db with all products
 * - Reports results
 * - Does NOT delete the JSON file (kept as backup)
 */

import { existsSync } from "fs";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getDb, closeDb, createProduct, findProductById } from "./database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCTS_JSON = path.resolve(__dirname, "../data/products.json");

async function main() {
  console.log("🔄 Migration: products.json → SQLite\n");

  if (!existsSync(PRODUCTS_JSON)) {
    console.log("⚠️  No products.json found. Creating empty database...");
    getDb(); // initializes schema
    closeDb();
    console.log("✅ Empty database created at data/products.db");
    return;
  }

  // Read JSON
  const raw = await fs.readFile(PRODUCTS_JSON, "utf-8");
  let products: any[];
  try {
    products = JSON.parse(raw);
  } catch (err: any) {
    console.error(`❌ Failed to parse products.json: ${err.message}`);
    process.exit(1);
  }

  console.log(`📦 Found ${products.length} products in products.json\n`);

  // Initialize DB (creates schema)
  const db = getDb();

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  for (const p of products) {
    try {
      // Skip if already exists (idempotent migration)
      if (findProductById(p.id)) {
        skipped++;
        continue;
      }

      createProduct({
        id: p.id,
        name: p.name || "Unnamed",
        category: p.category || "tech",
        affiliate_url: p.affiliate_url || "",
        hashtags: p.hashtags || [],
        description: p.description || "",
        image_url: p.image_url || "",
        images: p.images || [],
        video_url: p.video_url || "",
        promptsObj: p.promptsObj || undefined,
        scene_images: p.scene_images || undefined,
        scene_urls: p.scene_urls || undefined,
        consensus_feedback: p.consensus_feedback || undefined,
        debate_messages: p.debate_messages || undefined,
        part_feedback: p.part_feedback || "",
        episodes: p.episodes || undefined,
        enabled: p.enabled !== false,
        created_at: p.created_at || undefined,
        updated_at: p.updated_at || undefined,
      });
      imported++;
    } catch (err: any) {
      errors++;
      console.error(`  ❌ Failed to import ${p.id} (${p.name}): ${err.message}`);
    }
  }

  closeDb();

  console.log(`\n📊 Migration Results:`);
  console.log(`  ✅ Imported: ${imported}`);
  console.log(`  ⏭️  Skipped (already exists): ${skipped}`);
  console.log(`  ❌ Errors: ${errors}`);
  console.log(`  📁 Database: data/products.db`);
  console.log(`\n💡 products.json kept as backup. You can delete it when ready.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
