/**
 * «Сорта и ростовки на складе» на живых данных, без браузера: `npx tsx scripts/diag-stock-matrix.ts [склад: main|office|astana|all]`.
 * Печатает итоги по цветкам, ростовкам и последним дням срезки — то же, что видно на `/warehouse/stock`.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { listBatches } from "../src/lib/repo/batches";
import { buildStockMatrix, EARLIER } from "../src/lib/stockMatrix";
import { localDayKey } from "../src/lib/timezone";
import { formatGrade } from "../src/lib/constants";

async function main() {
  const arg = process.argv[2] || "main";
  const store = arg === "all" ? "all" : arg === "office" ? "office" : arg === "astana" ? "astana" : "";
  const m = buildStockMatrix({ batches: await listBatches(), today: localDayKey(), store });
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  console.log(`Склад ${arg}: ${nf(m.total)} шт., сортов ${m.varieties}, партий ${m.batches}`);
  for (const f of m.flowers) {
    console.log(`\n${f.flowerType}: ${nf(f.total)} шт., сортов ${f.rows.length}`);
    console.log("  ростовки: " + f.grades.map((g) => `${formatGrade(g)} ${nf(f.gradeTotals[g])}`).join(" · "));
    console.log("  срезка:   " + f.dates.map((d) => `${d === EARLIER ? "раньше" : d ? d.slice(5) : "без даты"} ${nf(f.dateTotals[d])}`).join(" · "));
    for (const r of f.rows.slice(0, 5)) console.log(`  ${r.variety.padEnd(22)} ${nf(r.total).padStart(8)}  ${r.oldest || "—"} … ${r.newest || "—"}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
