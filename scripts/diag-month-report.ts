import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/** «Итоги месяца» на живых данных — то же, что страница `/analytics/month`, текстом. Ничего не меняет.
 *   npx tsx scripts/diag-month-report.ts [ГГГГ-ММ] [esentai|rose_farm]
 */
import { loadMonthReport } from "../src/lib/repo/monthReport";
import { avgPrice, cleanMonth, CHANNEL_LABELS } from "../src/lib/monthReport";
import { localDayKey } from "../src/lib/timezone";

async function main() {
  const args = process.argv.slice(2);
  const month = cleanMonth(args.find((a) => /^\d{4}-\d{2}$/.test(a)), localDayKey());
  const farm = args.find((a) => a === "esentai" || a === "rose_farm") || "";
  const r = await loadMonthReport(month, farm);
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  console.log(`${month} ${farm || "всё хозяйство"}: срезано ${nf(r.cut.total)} (${r.cut.batches} парт.), прошлый ${nf(r.cut.prevTotal)}`);
  for (const c of r.channels) console.log(`  ${CHANNEL_LABELS[c.channel].padEnd(26)} ${nf(c.money.qty).padStart(9)} шт. ${nf(c.money.sum).padStart(12)} ₸ ср ${nf(avgPrice(c.money))}`);
  console.log(`  ИТОГО ${nf(r.sold.qty)} шт. ${nf(r.sold.sum)} ₸; клиенты ${nf(r.clients.qty)} / ${nf(r.clients.sum)} ₸, заявок ${r.clients.orders}, клиентов ${r.clients.clientCount}, новых ${r.clients.newClients}`);
  console.log(`  списано ${nf(r.writeoff.total)} (из срезки месяца ${nf(r.writeoff.fromMonthCut)}), отгружено ${nf(r.shipped)}, на складе из срезки ${nf(r.leftFromCut)}`);
  console.log(`  недели: ${r.weeks.map((w) => `${w.label}: срез ${nf(w.cut)} / ушло ${nf(w.sold)} / спис ${nf(w.writeoff)}`).join(" · ")}`);
  for (const x of r.insights) console.log(`  [${x.level}] ${x.text}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
