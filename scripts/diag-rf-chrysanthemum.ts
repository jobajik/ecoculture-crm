import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Хризантема Rose Farm на живых данных (03.11.2026): кто отвечает за склад каждого хозяйства, сколько хризантемы на складе
 * у каждого и кем она принята, какие цены у Rose Farm сейчас (свои или взятые у Есентая). Ничего не меняет.
 *   npx tsx scripts/diag-rf-chrysanthemum.ts
 */
import { listUsers } from "../src/lib/repo/users";
import { listBatches } from "../src/lib/repo/batches";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { listVarietiesByType } from "../src/lib/repo/varieties";
import { getSettings } from "../src/lib/repo/settings";
import { FARM_LABELS, FLOWER_TYPE_LABELS, compareGrades, flowerTypesForFarm, formatGrade, getFarmFor } from "../src/lib/constants";

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

async function main() {
  const [users, batches, prices, varieties, settings] = await Promise.all([
    listUsers(),
    listBatches(),
    getCurrentPrices(),
    listVarietiesByType(),
    getSettings(),
  ]);

  console.log("=== Ответственные по хозяйствам ===");
  for (const farm of ["rose_farm", "esentai"]) {
    const staff = users.filter((u) => u.active && u.farm === farm);
    console.log(`${FARM_LABELS[farm]}: цветки ${flowerTypesForFarm(farm).map((f) => FLOWER_TYPE_LABELS[f]).join(", ")}`);
    for (const u of staff) console.log(`  ${u.role.padEnd(12)} ${u.name || u.email}`);
    if (!staff.length) console.log("  (никто не закреплён)");
  }

  const farmOf = new Map(users.map((u) => [u.email, u.farm ?? ""]));
  for (const ft of ["chrysanthemum", "chrysanthemum_rf"]) {
    const list = batches.filter((b) => b.flowerType === ft && b.quantityRemaining > 0);
    const total = list.reduce((s, b) => s + b.quantityRemaining, 0);
    console.log(`\n=== ${FLOWER_TYPE_LABELS[ft]} (${FARM_LABELS[getFarmFor(ft) ?? ""]}): на складе ${nf(total)} шт., партий ${list.length}, срок ${settings.shelfLifeDays[ft]} дн. ===`);
    const byReceiver = new Map<string, number>();
    for (const b of list) {
      const who = farmOf.get((b.receivedByEmail || "").toLowerCase());
      const k = who ? FARM_LABELS[who] ?? who : b.receivedByEmail || "—";
      byReceiver.set(k, (byReceiver.get(k) ?? 0) + b.quantityRemaining);
    }
    for (const [k, q] of byReceiver) console.log(`  принял сотрудник ${k}: ${nf(q)}`);
    console.log(`  сортов в справочнике: ${(varieties[ft] ?? []).length}`);
  }

  console.log("\n=== Цены «Хризантема Rose Farm» (Все сорта) ===");
  const rows = Array.from(prices.values())
    .filter((r) => r.flowerType === "chrysanthemum_rf" && !r.variety)
    .sort((a, b) => compareGrades("chrysanthemum_rf", a.grade, b.grade));
  for (const r of rows) console.log(`  ${formatGrade(r.grade).padEnd(14)} ${nf(r.price)} ₸ ${r.borrowedFrom ? "(как у Есентая)" : "(своя)"}`);
  if (!rows.length) console.log("  цен нет");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
