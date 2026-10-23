import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Розы на складе и в прайсе по длинам: сорт, свободно, цена (своя или общая). Для расчёта стоимости поручением
 * (23.10.2026): видно, какие сорта кустовые и откуда разброс цен. Ничего не меняет.
 *
 *   npx tsx scripts/diag-rose-prices.ts [цветок]
 */
import { loadPhotoContext } from "../src/lib/botPhotoSend";
import { priceFor } from "../src/lib/priceList";

async function main() {
  const flower = process.argv[2] || "rose";
  const ctx = await loadPhotoContext();
  console.log("Прайс:");
  for (const r of Array.from(ctx.prices.values()).filter((r) => r.flowerType === flower).sort((a, b) => (a.grade + a.variety < b.grade + b.variety ? -1 : 1)))
    console.log(`  ${r.grade.padEnd(14)} ${(r.variety || "(все сорта)").padEnd(26)} ${r.price}`);
  console.log("Склад:");
  for (const s of ctx.stock.filter((s) => s.flower === flower).sort((a, b) => (a.grade + a.variety < b.grade + b.variety ? -1 : 1)))
    console.log(`  ${s.grade.padEnd(14)} ${s.variety.padEnd(26)} ${String(s.qty).padStart(6)} шт. · цена ${priceFor(ctx.prices, flower, s.variety, s.grade)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
