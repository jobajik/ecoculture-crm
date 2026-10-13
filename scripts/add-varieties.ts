import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Дописать сорта в справочник (вкладка Varieties) — по просьбе агронома или склада, у которых
 * доступа к справочнику нет. Уже существующие (без учёта регистра) не дублируются. Без --yes — показ.
 *
 *   npx tsx scripts/add-varieties.ts <json> [--yes]
 *   json: { "flowerType": "chrysanthemum", "varieties": ["Bonita", "Podolsk"] }
 */
import { readFileSync } from "node:fs";
import { appendRows, SHEET_TABS } from "../src/lib/sheets";
import { listVarietiesByType } from "../src/lib/repo/varieties";
import { FLOWER_TYPE_LABELS } from "../src/lib/constants";

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) throw new Error("Укажите файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { flowerType: string; varieties: string[] };
  if (!FLOWER_TYPE_LABELS[spec.flowerType]) throw new Error(`Непонятный цветок «${spec.flowerType}»`);
  const known = ((await listVarietiesByType())[spec.flowerType] ?? []).map((v) => v.toLowerCase());
  const fresh = Array.from(new Set(spec.varieties.map((v) => v.trim().replace(/\s+/g, " ")).filter(Boolean))).filter((v) => !known.includes(v.toLowerCase()));
  console.log(`${FLOWER_TYPE_LABELS[spec.flowerType]}: уже есть ${known.length}; новые — ${fresh.join(", ") || "нет"}`);
  if (!fresh.length || !process.argv.includes("--yes")) return console.log(fresh.length ? "Только показ. Записать: --yes" : "");
  await appendRows(
    SHEET_TABS.VARIETIES,
    fresh.map((v) => ({ FlowerType: spec.flowerType, Variety: v, Active: "TRUE" }))
  );
  console.log("Записано.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
