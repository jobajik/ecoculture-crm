import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
/** Платежи и Kaspi-счета, чья заявка удалена. Ничего не меняет. */
import { readTable, rowToRecord, SHEET_TABS } from "../src/lib/sheets";

async function main() {
  const ids = new Set((await readTable(SHEET_TABS.ORDERS)).rows.map((r) => rowToRecord(SHEET_TABS.ORDERS, r).OrderID));
  for (const tab of [SHEET_TABS.PAYMENTS, SHEET_TABS.KASPI_INVOICES]) {
    const rows = (await readTable(tab)).rows.map((r) => rowToRecord(tab, r)).filter((r) => r.OrderID && !ids.has(r.OrderID));
    console.log(`${tab}: без заявки ${rows.length}`);
    for (const r of rows.slice(-10)) console.log(`  ${r.OrderID} · ${r.Amount ?? ""} · ${r.Status ?? r.Method ?? ""} · ${r.PaidAt ?? r.CreatedAt ?? ""}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
