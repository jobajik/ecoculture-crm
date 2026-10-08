import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Приёмка за зав. складом из файла JSON — когда в справочнике нет сортов и загрузка Excel их
 * отвергает. Новые сорта дописываются во вкладку Varieties (`addVarieties: true`), партии
 * заводятся так же, как при загрузке приёмки (`createBatches`) — от имени зав. складом
 * производства. Та же партия (день срезки, цветок, сорт, градация, количество) второй раз не
 * заводится. Без --yes — показ. Русские слова — в JSON (из .bat они портятся):
 *   { "farm": "rose_farm", "addVarieties": true, "rows": [
 *       { "harvestDate": "2026-10-05", "flowerType": "eustoma", "variety": "…", "grade": "50", "quantity": 180, "location": "…" } ] }
 *
 * Только завести сорта без партий: `"varieties": [ { "flowerType": "eustoma", "variety": "…" } ]`, `rows` можно не давать.
 *
 *   npx tsx scripts/receive-json.ts <json> [--yes]
 *
 * 08.10.2026: Разия (Rose Farm) — эустома от 05.10, сортов «Arena I Pure White», «Celeb 2 Gold» и др. в CRM не было.
 */
import { readFileSync } from "node:fs";
import { appendRows, SHEET_TABS } from "../src/lib/sheets";
import { createBatches, listBatches } from "../src/lib/repo/batches";
import { listVarietiesByType, normalizeVariety } from "../src/lib/repo/varieties";
import { listUsers } from "../src/lib/repo/users";
import { ROLES, getGradesFor, type FlowerType } from "../src/lib/constants";

interface Row { harvestDate: string; flowerType: string; variety: string; grade: string; quantity: number; location?: string }

async function main() {
  const spec = JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^﻿/, "")) as {
    farm: string;
    addVarieties?: boolean;
    rows?: Row[];
    varieties?: { flowerType: string; variety: string }[];
  };
  const apply = process.argv.includes("--yes");
  const keeper = (await listUsers()).find((u) => u.role === ROLES.WAREHOUSE && u.farm === spec.farm && u.active);
  const email = keeper?.email || "y.sadakbayev@gmail.com";
  console.log(`Принимает: ${keeper ? `${keeper.name || keeper.email} (${keeper.email})` : "владелец — зав. складом не найден"}`);

  const catalog = await listVarietiesByType();
  const newVarieties: { FlowerType: string; Variety: string; Active: string }[] = [];
  const batches = await listBatches();
  const toCreate: Parameters<typeof createBatches>[0] = [];
  for (const v of spec.varieties ?? []) {
    const name = v.variety.trim().replace(/\s+/g, " ");
    if (normalizeVariety(name, v.flowerType, catalog)) {
      console.log(`  сорт уже есть: ${name}`);
      continue;
    }
    if (!newVarieties.some((x) => x.FlowerType === v.flowerType && x.Variety.toLowerCase() === name.toLowerCase())) {
      newVarieties.push({ FlowerType: v.flowerType, Variety: name, Active: "TRUE" });
    }
  }
  for (const r of spec.rows ?? []) {
    const known = normalizeVariety(r.variety, r.flowerType, catalog);
    const variety = known ?? r.variety.trim().replace(/\s+/g, " ");
    if (!known) {
      if (!spec.addVarieties) {
        console.log(`  НЕТ СОРТА «${variety}» (${r.flowerType}) — строка пропущена`);
        continue;
      }
      if (!newVarieties.some((v) => v.FlowerType === r.flowerType && v.Variety === variety)) {
        newVarieties.push({ FlowerType: r.flowerType, Variety: variety, Active: "TRUE" });
      }
    }
    if (!getGradesFor(r.flowerType).includes(r.grade)) {
      console.log(`  неизвестная градация «${r.grade}» у «${variety}» — строка пропущена`);
      continue;
    }
    const dup = batches.find(
      (b) => b.harvestDate === r.harvestDate && b.flowerType === r.flowerType && b.variety === variety && b.grade === r.grade && b.quantityIn === r.quantity && !b.store,
    );
    if (dup) {
      console.log(`  уже есть партия ${dup.batchId}: ${variety} ${r.grade} — ${r.quantity} шт. от ${r.harvestDate} — пропускаю`);
      continue;
    }
    console.log(`  партия: ${r.harvestDate} · ${r.flowerType} | ${variety}${known ? "" : " (новый сорт)"} | ${r.grade} | ${r.quantity} шт. · ${r.location || ""}`);
    toCreate.push({
      harvestDate: r.harvestDate,
      flowerType: r.flowerType as FlowerType,
      variety,
      grade: r.grade,
      quantityIn: Math.round(r.quantity),
      location: r.location || "",
      receivedByEmail: email,
    });
  }
  console.log(`\nНовых сортов: ${newVarieties.length}${newVarieties.length ? ` (${newVarieties.map((v) => v.Variety).join(", ")})` : ""}`);
  console.log(`Партий: ${toCreate.length}, стеблей: ${toCreate.reduce((s, b) => s + b.quantityIn, 0)}`);
  if (!apply) return console.log("Только показ. Записать: --yes");
  if (newVarieties.length) await appendRows(SHEET_TABS.VARIETIES, newVarieties);
  const ids = toCreate.length ? await createBatches(toCreate) : [];
  console.log(`Записано: сортов ${newVarieties.length}, партий ${ids.length} (${ids.join(", ")})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
