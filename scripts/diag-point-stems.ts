import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Точка на базаре в штуках: начало, отвезли, продано (внесено / ≈ по деньгам), списано, конец —
 * по цветку, за этот и прошлый месяц. Ничего не меняет.
 *
 *   npx tsx scripts/diag-point-stems.ts [ГГГГ-ММ]
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listPointDays, listPointWriteoffs } from "../src/lib/repo/point";
import { pointStemFlow } from "../src/lib/point";
import { localDayKey } from "../src/lib/timezone";
import { periodShift } from "../src/lib/constants";

async function main() {
  const today = localDayKey();
  const month = process.argv[2] || today.slice(0, 7);
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.POINT_SALES, SHEET_TABS.POINT_WRITEOFFS]);
  const [orders, days, writeoffs] = await Promise.all([listOrdersWithItems(), listPointDays(), listPointWriteoffs()]);
  console.log(`дней выручки: ${days.length}, со штуками: ${days.filter((d) => d.soldStems).length}; списаний: ${writeoffs.length}`);
  for (const m of [periodShift(month, -1), month]) {
    const flow = pointStemFlow({ orders, days, writeoffs, month: m, today });
    console.log(`\n${m}: цветок | начало | отвезли | продано внесено | ≈ по деньгам | списано | конец`);
    for (const f of flow.flowers) console.log(`  ${f.label} | ${f.start} | ${f.transferred} | ${f.sold} | ${f.soldEstimated} | ${f.writeoff} | ${f.end}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
