/*
 * Отменить заявку вместе с открытыми счетами Kaspi — когда клиент ушёл, а ссылка на оплату ещё живая.
 * Кнопка «Отменить» на сайте счёт Kaspi не трогает: клиент мог бы оплатить отменённую заявку.
 *
 *   npx tsx scripts/cancel-order.ts <json {"code":"EC8AZ","reason":"…"}> [--yes]
 *
 * Без --yes — только показ. Оплаченную или отгруженную заявку не отменяет. Отменённый нами счёт помечается
 * «отменяется» — поэтому вебхук ApiPay не примет это за отказ клиента и бот ему ничего не напишет.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync } from "node:fs";
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems, updateOrderStatus } from "../src/lib/repo/orders";
import { findKaspiInvoice, listKaspiInvoices, updateKaspiInvoiceRow } from "../src/lib/repo/kaspiInvoices";
import { apiPayConfig, cancelInvoice } from "../src/lib/apipay";
import { isOpenKaspiStatus } from "../src/lib/kaspiInvoice";
import { logMoney } from "../src/lib/repo/moneyLog";
import { orderCode } from "../src/lib/paymentStage";
import { MONEY_LOG_ACTIONS, ORDER_STATUSES } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) throw new Error("нужен файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { code: string; reason: string };
  const yes = process.argv.includes("--yes");
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.KASPI_INVOICES]);
  const [orders, invoices] = await Promise.all([listOrdersWithItems(), listKaspiInvoices({ fresh: true })]);
  const code = spec.code.trim().toUpperCase();
  const o = orders.find((x) => orderCode(x.orderId) === code || x.orderId.toUpperCase() === code);
  if (!o) throw new Error(`заявка ${code} не найдена`);
  const open = invoices.filter((i) => i.orderId === o.orderId && isOpenKaspiStatus(i.status));
  console.log(`№${orderCode(o.orderId)} · ${o.clientName} · ${money(o.totalAmount)} · статус ${o.status} · оплачено ${money(o.paidAmount)}`);
  console.log(`открытые счета Kaspi: ${open.map((i) => `№${i.invoiceId} ${money(i.amount)} (${i.status})`).join(", ") || "нет"}`);
  console.log(`причина: ${spec.reason}`);
  if (o.status === ORDER_STATUSES.CANCELLED) return console.log("Уже отменена.");
  if (o.paidAmount > 1) throw new Error("по заявке есть оплата — сначала снять деньги или оформить возврат");
  if (o.items.some((i) => i.shippedQuantity > 0)) throw new Error("по заявке есть отгрузка — отменять нельзя");
  if (!spec.reason?.trim()) throw new Error("нужна причина");
  if (!yes) return console.log("Только показ. Отменить: --yes");

  for (const inv of open) {
    const cfg = apiPayConfig(inv.farm);
    if (!cfg) {
      console.log(`счёт №${inv.invoiceId}: касса ${inv.farm} не подключена — отмените в Kaspi вручную`);
      continue;
    }
    const found = await findKaspiInvoice(inv.invoiceId);
    if (found) await updateKaspiInvoiceRow(found.rowNumber, { Status: "cancelling", UpdatedAt: new Date().toISOString() });
    const res = await cancelInvoice(cfg, inv.invoiceId);
    if (found) await updateKaspiInvoiceRow(found.rowNumber, { Status: String(res?.status || "cancelling"), UpdatedAt: new Date().toISOString() });
    console.log(`счёт №${inv.invoiceId}: ${String(res?.status || "cancelling")}`);
  }
  await updateOrderStatus(o.orderId, ORDER_STATUSES.CANCELLED);
  await logMoney({
    actorEmail: OWNER,
    orderId: o.orderId,
    action: MONEY_LOG_ACTIONS.ORDER_CANCELLED,
    details: `${spec.reason.trim()}${open.length ? ` · счёт Kaspi ${open.map((i) => `№${i.invoiceId}`).join(", ")} отменён` : ""}`,
    amountBefore: o.totalAmount,
    amountAfter: 0,
  });
  console.log("Заявка отменена.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
