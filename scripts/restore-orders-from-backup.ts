import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Вернуть удалённую заявку из резервной копии таблицы (19.11.2026: №2NAUT удалили вместе с FR7VT и FMEZT, а Юлия
 * следом написала, что заявка Карлыгаш оплачена и её надо перевести на склад Астаны, а не удалять).
 *
 * Копию делает каждое удаление (`delete-orders.ts`, ссылка — в его журнале `_temp/delete-orders.log`) и ночное
 * расписание. Скрипт читает из копии строки заявки во вкладках Orders, OrderItems, Payments и Claims — ровно такими,
 * какими они были, колонка в колонку по заголовкам копии, — и дописывает их в живую таблицу одной записью. Если такая
 * заявка в живой таблице уже есть, ничего не пишет: второй экземпляр задвоил бы выручку. Счета Kaspi, журнал денег и
 * отгрузки удалением не трогаются — их возвращать не нужно. В журнал денег — строка «заявка возвращена из копии».
 *
 *   npx tsx scripts/restore-orders-from-backup.ts <id копии> ORD-… [ORD-…] [--yes]
 */
import { google } from "googleapis";
import { commitAtomic, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../src/lib/sheets";
import { logMoney } from "../src/lib/repo/moneyLog";
import { MONEY_LOG_ACTIONS } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";
const TABS = [SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.PAYMENTS, SHEET_TABS.CLAIMS];

function client() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  return google.sheets({ version: "v4", auth });
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const yes = process.argv.includes("--yes");
  const [backupId, ...ids] = args;
  if (!backupId || ids.length === 0) throw new Error("Нужны id копии и номера заявок (ORD-…)");

  const res = await client().spreadsheets.values.batchGet({ spreadsheetId: backupId, ranges: TABS.map((t) => `${t}!A:ZZ`) });
  const backup = new Map<string, { headers: string[]; rows: string[][] }>();
  TABS.forEach((tab, i) => {
    const values = (res.data.valueRanges?.[i]?.values ?? []) as string[][];
    backup.set(tab, { headers: values[0] ?? [], rows: values.slice(1) });
  });
  const liveOrders = await readTable(SHEET_TABS.ORDERS, { fresh: true });
  const live = new Set(liveOrders.rows.map((r) => rowToRecord(SHEET_TABS.ORDERS, r).OrderID));

  const ops: WriteOp[] = [];
  const restored: string[] = [];
  for (const id of ids) {
    if (live.has(id)) {
      console.log(`${id}: уже есть в таблице — не трогаю`);
      continue;
    }
    let found = 0;
    for (const tab of TABS) {
      const b = backup.get(tab)!;
      const col = b.headers.indexOf("OrderID");
      if (col < 0) continue;
      const rows = b.rows.filter((r) => (r[col] || "").trim() === id);
      if (rows.length === 0) continue;
      found += rows.length;
      const records = rows.map((r) => Object.fromEntries(b.headers.map((h, i) => [h, r[i] ?? ""])));
      for (const rec of records) console.log(`  ${tab}: ${Object.entries(rec).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${String(v).slice(0, 60)}`).join(" | ")}`);
      ops.push({ kind: "append", tab, records });
    }
    if (found === 0) console.log(`${id}: в копии не нашлась`);
    else {
      console.log(`${id}: строк в копии ${found}`);
      restored.push(id);
    }
  }
  if (!yes) return console.log("\nПоказ. Вернуть — добавьте --yes.");
  if (ops.length === 0) return console.log("\nВозвращать нечего.");
  await commitAtomic(ops);
  for (const id of restored) {
    await logMoney({ actorEmail: OWNER, orderId: id, action: MONEY_LOG_ACTIONS.ORDER_EDITED, details: `Заявка возвращена из резервной копии (${backupId}) после ошибочного удаления`, amountBefore: 0, amountAfter: 0 });
  }
  console.log(`\nВозвращено заявок: ${restored.length}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
