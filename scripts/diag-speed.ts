import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Сколько стоит чтение данных из Google-таблицы (13.11.2026, владелец: «что нужно сделать, чтобы страницы открывались
 * гораздо быстрее? проблема может быть в Google-таблицах?»). Ничего не меняет. Печатает по каждой вкладке: строк,
 * объём ответа и время одного свежего чтения; затем время чтения наборов вкладок, которые берут самые частые страницы
 * (одним запросом, как `prefetchTables`). Время меряется с этого компьютера — у сайта (сервер Vercel) оно того же порядка.
 *
 *   npx tsx scripts/diag-speed.ts
 */
import { forgetReads, prefetchTables, readTable, SHEET_TABS } from "../src/lib/sheets";

const T = SHEET_TABS;
const SETS: [string, string[]][] = [
  ["Заявки (список)", [T.ORDERS, T.ORDER_ITEMS, T.CLIENTS, T.USERS]],
  ["Заявка (страница)", [T.ORDERS, T.ORDER_ITEMS, T.CLIENTS, T.USERS, T.SHIPMENTS, T.BATCHES, T.PAYMENTS, T.KASPI_INVOICES, T.CLAIMS]],
  ["Оплаты", [T.ORDERS, T.ORDER_ITEMS, T.CLIENTS, T.USERS, T.PAYMENTS, T.KASPI_INVOICES]],
  ["Склад / остатки", [T.BATCHES, T.ORDERS, T.ORDER_ITEMS, T.SHIPMENTS, T.WRITEOFFS]],
  ["Переписки", [T.WA_MESSAGES, T.LEADS, T.CLIENTS, T.USERS, T.ASSISTANT_LOG, T.LEAD_ANALYSES, T.LEAD_TOUCHES]],
  ["Лиды (доска)", [T.LEADS, T.LEAD_TOUCHES, T.WA_MESSAGES, T.LEAD_ANALYSES, T.CLIENTS, T.USERS]],
];

async function main() {
  const names = Array.from(new Set(SETS.flatMap(([, tabs]) => tabs)));
  console.log("Вкладка".padEnd(18), "строк".padStart(8), "знаков".padStart(11), "мс".padStart(7));
  const cost = new Map<string, { rows: number; chars: number; ms: number }>();
  for (const tab of names) {
    const t0 = Date.now();
    const table = await readTable(tab, { fresh: true });
    const ms = Date.now() - t0;
    const chars = table.rows.reduce((s, r) => s + r.reduce((x, c) => x + String(c ?? "").length, 0), 0);
    cost.set(tab, { rows: table.rows.length, chars, ms });
    console.log(tab.padEnd(18), String(table.rows.length).padStart(8), String(chars).padStart(11), String(ms).padStart(7));
  }
  console.log("\nНаборы страниц (одним запросом):");
  for (const [label, tabs] of SETS) {
    const times: number[] = [];
    for (let i = 0; i < 2; i++) {
      forgetReads();
      const t0 = Date.now();
      await prefetchTables(tabs);
      times.push(Date.now() - t0);
    }
    const rows = tabs.reduce((s, t) => s + (cost.get(t)?.rows ?? 0), 0);
    const chars = tabs.reduce((s, t) => s + (cost.get(t)?.chars ?? 0), 0);
    console.log(`${label.padEnd(20)} ${tabs.length} вкладок · ${rows} строк · ${(chars / 1e6).toFixed(1)} млн знаков · ${times.join(" и ")} мс`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
