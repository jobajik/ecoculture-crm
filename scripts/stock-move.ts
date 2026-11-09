import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Переместить цветок между основным складом и офисом из командной строки (09.11.2026, Разия в субботу отправила в офис
 * хризантему и эустому, а записать в CRM было негде). То же, что форма РОПа «Склад → Офис» (`moveStock`): раскладка от
 * старых срезок к свежим, всё или ничего, журнал StockMoves. Без --yes — показ остатков производства и раскладки.
 *
 *   npx tsx scripts/stock-move.ts <json> [--yes]
 *   json: { "direction": "to_office", "farm": "rose_farm", "note": "…",
 *           "lines": [{ "flowerType": "chrysanthemum_rf", "variety": "Altaj", "grade": "Третья", "quantity": 135 }] }
 */
import { readFileSync } from "node:fs";
import { listBatches } from "../src/lib/repo/batches";
import { moveStock, previewStockMove } from "../src/lib/repo/stockMoves";
import { inStore, type MoveDirection, type MoveLine } from "../src/lib/officeStore";
import { positionLabel, stockPositions } from "../src/lib/writeoffPlan";

const OWNER = "y.sadakbayev@gmail.com";

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const yes = process.argv.includes("--yes");
  if (!file) throw new Error("Укажите файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { direction?: MoveDirection; farm?: string; note?: string; lines: MoveLine[] };
  const direction: MoveDirection = spec.direction === "to_main" ? "to_main" : "to_office";
  const batches = await listBatches();
  const from = stockPositions(inStore(batches, direction === "to_office" ? "" : "office"), spec.farm || null);
  console.log(`Сейчас ${direction === "to_office" ? "на основном складе" : "в офисе"}${spec.farm ? ` (${spec.farm})` : ""}:`);
  for (const p of from.sort((a, b) => a.flowerType.localeCompare(b.flowerType) || a.variety.localeCompare(b.variety))) console.log(`  ${positionLabel(p).padEnd(44)} ${p.stock}`);
  if (!Array.isArray(spec.lines) || !spec.lines.length) return console.log("\nСтрок для перемещения нет.");
  const plan = await previewStockMove(direction, spec.lines);
  console.log(`\nРаскладка (${direction === "to_office" ? "Склад → Офис" : "Офис → Склад"}):`);
  spec.lines.forEach((l, i) => {
    const parts = plan.byLine[i] ?? [];
    console.log(`  ${positionLabel(l)} × ${l.quantity}: ${plan.errors[i] ? `ОШИБКА — ${plan.errors[i]}` : parts.map((p) => `${p.batchId} (${p.harvestDate}) ${p.quantity}`).join(", ")}`);
  });
  if (plan.errors.some(Boolean)) return console.log("\nЕсть ошибки — ничего не перемещаю.");
  console.log(`Всего ${plan.total} шт.`);
  if (!yes) return console.log("\nТолько показ. Переместить — с --yes.");
  const r = await moveStock({ direction, lines: spec.lines, byEmail: OWNER, note: spec.note || "" });
  console.log(`Перемещено ${r.total} шт. из ${r.batches} партий.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
