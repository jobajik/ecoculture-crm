/**
 * «Срез · продажи · списания» на живых данных, без браузера: `npx tsx scripts/diag-flow.ts <от> <до> [farm] [flower] [файл.json]`.
 * Печатает итоги, по цветку и по категориям; с файлом — пишет весь расчёт в JSON.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { writeFileSync } from "fs";
import { loadFlowReport } from "../src/lib/repo/flowReport";
import { avgPrice } from "../src/lib/monthReport";
import { cleanRange } from "../src/lib/flowReport";
import { localDayKey } from "../src/lib/timezone";

async function main() {
  const [from0, to0, farm = "", flower = "", out = ""] = process.argv.slice(2);
  const { from, to } = cleanRange(from0, to0, localDayKey());
  const r = await loadFlowReport(from, to, farm, flower);
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const line = (x: { label: string; cut: number; sold: { qty: number; sum: number; priced: number }; shipped: number; writeoff: number; takeouts: number; remaining: number }) =>
    `${x.label.padEnd(34)} срез ${nf(x.cut).padStart(8)}  прод ${nf(x.sold.qty).padStart(8)} ${nf(x.sold.sum).padStart(12)} ₸ ср ${nf(avgPrice(x.sold)).padStart(5)}  отгр ${nf(x.shipped).padStart(8)}  спис ${nf(x.writeoff).padStart(7)}  выд ${nf(x.takeouts).padStart(5)}  ост ${nf(x.remaining).padStart(8)}`;
  console.log(`Период ${r.from} — ${r.to} (${r.days} дн.), прошлый ${r.prevFrom} — ${r.prevTo}; ${farm || "всё"} ${flower}`);
  console.log(line(r.total));
  console.log(`Остаток: начало ${nf(r.balance.start)}, конец ${nf(r.balance.end)}, сейчас ${nf(r.balance.now)}, Астана ${nf(r.balance.region)}; в офис ${nf(r.toOffice)}, в регион ${nf(r.toRegion)}, со склада Астаны продано ${nf(r.regionSold)}`);
  console.log("\nПо компаниям:");
  for (const x of r.byFarm) console.log(line(x));
  console.log("\nПо цветку:");
  for (const x of r.byFlower) console.log(line(x));
  console.log("\nПо категориям:");
  for (const x of r.byGrade) console.log(line(x));
  console.log("\nКаналы:", r.channels.map((c) => `${c.label}: ${nf(c.money.qty)} шт / ${nf(c.money.sum)} ₸ / ${c.orders} заявок`).join("; "));
  console.log("Списания:", r.writeoffReasons.map((x) => `${x.reason} ${nf(x.qty)}`).join(", "), "| возраст:", r.writeoffAge.map((x) => `${x.bucket} ${nf(x.qty)}`).join(", "), `| медиана ${r.writeoffAgeMedian}`);
  console.log("Свежесть:", r.stockAge.map((x) => `${x.label} [${x.buckets.map(nf).join(" / ")}]`).join("; "));
  console.log("Отгрузка возраст:", r.shipAge.map((x) => `${x.label} медиана ${x.median} дн., >7 дн. ${nf(x.over7)} из ${nf(x.qty)}`).join("; "));
  console.log("План/факт:", r.forecast.map((f) => `${f.label} ${nf(f.plan)} / ${nf(f.fact)}`).join("; ") || "нет");
  console.log(`Динамика (${r.timeline.unit}):`, r.timeline.points.map((p) => `${p.label} ${p.cut}/${p.sold}/${p.shipped}/${p.writeoff}`).join("  "));
  console.log("\nВыводы:");
  for (const i of r.insights) console.log(` ${i.level}: ${i.text}`);
  if (out) {
    writeFileSync(out, JSON.stringify(r, null, 1));
    console.log(`\nЗаписано: ${out}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
