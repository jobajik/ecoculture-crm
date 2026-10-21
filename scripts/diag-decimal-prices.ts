import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Позиции заявок с дробной ценой или ценой, записанной «по-русски» («154,5»): до 21.10.2026 программа читала такую
 * ячейку как 0 — сумма заявки, бонус и долг считались без этих позиций. Печатает заявки, менеджера, позицию, как цена
 * лежит в ячейке и как теперь читается. Ничего не меняет.
 *
 *   npx tsx scripts/diag-decimal-prices.ts [с какого дня ГГГГ-ММ-ДД]
 */
import { readTable, rowToRecord, SHEET_TABS } from "../src/lib/sheets";
import { sheetNumber } from "../src/lib/sheetCell";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { orderCode } from "../src/lib/paymentStage";

async function main() {
  const from = process.argv[2] || "";
  const [items, orders] = await Promise.all([readTable(SHEET_TABS.ORDER_ITEMS), listOrdersWithItems()]);
  const byId = new Map(orders.map((o) => [o.orderId, o]));
  let n = 0;
  for (const row of items.rows) {
    const r = rowToRecord(SHEET_TABS.ORDER_ITEMS, row);
    const raw = String(r.UnitPrice ?? "");
    const price = sheetNumber(raw);
    const odd = /,/.test(raw) || /\s/.test(raw.trim()) || (price > 0 && !Number.isInteger(price)) || (raw.trim() !== "" && Number(raw) !== price);
    if (!odd) continue;
    const o = byId.get(r.OrderID);
    if (!o || (from && o.createdAt.slice(0, 10) < from)) continue;
    n++;
    console.log(`№${orderCode(o.orderId)} · ${o.createdAt.slice(0, 10)} · ${o.managerEmail} · ${o.clientName} · ${r.Variety} ${r.Grade} × ${r.Quantity} · в ячейке «${raw}» → ${price} ₸ · сумма заявки теперь ${o.totalAmount}`);
  }
  console.log(`\nТаких позиций: ${n}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
