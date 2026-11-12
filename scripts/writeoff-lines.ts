import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Списать цветок общим количеством из командной строки — то же, что форма «Склад → Списание» (`createWriteoffsByPlan`:
 * от старых срезок к свежим, всё или ничего). 12.11.2026, зав. складом Rose Farm: «Руслану Алтай Высший 100 шт. на
 * замену отправила — с CRM списать?»; владелец: «списать как замену клиенту». Без --yes — показ раскладки.
 *
 *   npx tsx scripts/writeoff-lines.ts <json> [--yes]
 *   json: { "farm": "rose_farm", "store": "", "lines": [{ "flowerType": "chrysanthemum_rf", "variety": "Altaj",
 *           "grade": "Высшая", "quantity": 100, "reason": "Замена клиенту …" }] }
 */
import { readFileSync } from "node:fs";
import { createWriteoffsByPlan, planWriteoffsFromSheet } from "../src/lib/repo/writeoffs";
import type { WriteoffLine } from "../src/lib/writeoffPlan";
import type { StoreCode } from "../src/lib/officeStore";

const OWNER = "y.sadakbayev@gmail.com";

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const yes = process.argv.includes("--yes");
  if (!file) throw new Error("Укажите файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { farm?: string; store?: string; lines: WriteoffLine[] };
  const store = (spec.store || "") as StoreCode;
  const plan = await planWriteoffsFromSheet({ lines: spec.lines, farm: spec.farm || null, store });
  spec.lines.forEach((l, i) => {
    const parts = plan.byLine[i] ?? [];
    console.log(`${l.flowerType} · ${l.variety} · ${l.grade} × ${l.quantity} («${l.reason}»): ${plan.errors[i] ? `ОШИБКА — ${plan.errors[i]}` : parts.map((p) => `${p.batchId} (${p.harvestDate}) ${p.quantity}`).join(", ")}`);
  });
  if (plan.errors.some(Boolean)) return console.log("Есть ошибки — ничего не списано.");
  if (!yes) return console.log("Только показ. Списать — с --yes.");
  const r = await createWriteoffsByPlan({ lines: spec.lines, farm: spec.farm || null, store, warehouseEmail: OWNER });
  console.log(`Списано ${r.plan.total} шт., строк журнала: ${r.ids.length} (${r.ids.join(", ")}).`);
}

main().catch((e) => {
  console.error("Не получилось:", e instanceof Error ? e.message : e);
  process.exit(1);
});
