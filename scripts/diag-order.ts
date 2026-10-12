/*
 * Всё об одной заявке — чтобы разобрать «клиент всё оплатил, а программа показывает долг».
 * Ничего не меняет.
 *
 *   npx tsx scripts/diag-order.ts <короткий номер или ORD-…> [ещё номера]
 *
 * Печатает: шапку (сумма, оплачено, по компаниям, статус), позиции (заказано / отгружено / цена),
 * платежи, счета Kaspi, отгрузки, рекламации, журнал денег; затем другие заявки того же клиента
 * за ±10 дней с их оплатами и платежи с суммой остатка по всей базе за ±10 дней — вдруг деньги
 * легли не на ту заявку.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listPayments } from "../src/lib/repo/payments";
import { listKaspiInvoices } from "../src/lib/repo/kaspiInvoices";
import { listMoneyLog } from "../src/lib/repo/moneyLog";
import { listShipments } from "../src/lib/repo/shipments";
import { listClaims } from "../src/lib/repo/claims";
import { orderCode } from "../src/lib/paymentStage";

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const day = (iso: string) => String(iso || "").slice(0, 10);
const daysBetween = (a: string, b: string) => Math.abs(Date.parse(day(a)) - Date.parse(day(b))) / 86400000;

async function main() {
  const codes = process.argv.slice(2).map((c) => c.trim().toUpperCase()).filter(Boolean);
  if (codes.length === 0) throw new Error("нужен номер заявки");
  await prefetchTables([
    SHEET_TABS.ORDERS,
    SHEET_TABS.ORDER_ITEMS,
    SHEET_TABS.CLIENTS,
    SHEET_TABS.PAYMENTS,
    SHEET_TABS.KASPI_INVOICES,
    SHEET_TABS.MONEY_LOG,
    SHEET_TABS.SHIPMENTS,
    SHEET_TABS.CLAIMS,
  ]);
  const [orders, payments, invoices, log, shipments, claims] = await Promise.all([
    listOrdersWithItems(),
    listPayments(),
    listKaspiInvoices(),
    listMoneyLog(),
    listShipments(),
    listClaims(),
  ]);

  for (const code of codes) {
    const o = orders.find((x) => x.orderId.toUpperCase() === code || orderCode(x.orderId) === code);
    if (!o) {
      console.log(`\n### ${code}: заявка не найдена`);
      continue;
    }
    console.log(`\n### №${orderCode(o.orderId)} (${o.orderId}) — ${o.clientName}`);
    console.log(`создана ${o.createdAt} · менеджер ${o.managerEmail} · доставка ${o.deliveryDate} · статус ${o.status}`);
    console.log(`сумма ${money(o.totalAmount)} · оплачено ${money(o.paidAmount)} (флаг ${o.paid ? "да" : "нет"}, день ${o.paidAt || "—"})`);
    console.log(`по компаниям: Rose Farm ${money(o.paidRoseFarm)}, Есентай ${money(o.paidEsentai)} · способ «${o.paymentMethod}» · подтв. ${o.managerConfirmed ? "да" : "нет"}`);
    console.log(`клиент ${o.clientId} · условия «${o.clientPaymentTerms ?? ""}» · 1С «${o.realization1c ?? ""}» · заметка «${o.notes ?? ""}»`);
    console.log("позиции:");
    for (const i of o.items) {
      console.log(`  ${i.itemId}: ${i.flowerType} ${i.variety} ${i.grade} — ${i.quantity} шт. × ${money(i.unitPrice)} = ${money(i.quantity * i.unitPrice)} · отгружено ${i.shippedQuantity}`);
    }
    const pays = payments.filter((p) => p.orderId === o.orderId);
    console.log(`платежи (${pays.length}), сумма ${money(pays.reduce((s, p) => s + p.amount, 0))}:`);
    for (const p of pays) console.log(`  ${p.date} · ${money(p.amount)} · ${p.method} · ${p.farm || "—"} · ${p.flowerType || "—"} · ${p.accountantEmail} · «${p.note}» · внесён ${p.createdAt}`);
    const inv = invoices.filter((k) => k.orderId === o.orderId);
    console.log(`счета Kaspi (${inv.length}):`);
    for (const k of inv) console.log(`  ${k.createdAt} · ${money(k.amount)} · ${k.farm} · ${k.status} · на ${k.phone} · платёж ${k.paymentId || "—"} · оплачен ${k.paidAt || "—"}`);
    const sh = shipments.filter((s) => s.orderId === o.orderId);
    console.log(`отгрузки (${sh.length}): ${sh.map((s) => `${day(s.createdAt)} ${s.quantity} шт.`).join(", ") || "—"}`);
    const cl = claims.filter((c) => c.orderId === o.orderId);
    if (cl.length) console.log(`рекламации: ${cl.map((c) => JSON.stringify(c)).join("\n  ")}`);
    console.log("журнал денег:");
    for (const l of log.filter((x) => x.orderId === o.orderId)) {
      console.log(`  ${l.createdAt} · ${l.actorEmail} · ${l.action} · ${money(l.amountBefore)} → ${money(l.amountAfter)} · ${l.details.slice(0, 300)}`);
    }

    const near = orders.filter(
      (x) => x.orderId !== o.orderId && ((o.clientId && x.clientId === o.clientId) || x.clientName.trim().toLowerCase() === o.clientName.trim().toLowerCase()) && daysBetween(x.createdAt, o.createdAt) <= 10
    );
    console.log(`другие заявки клиента за ±10 дней (${near.length}):`);
    for (const x of near) {
      const xp = payments.filter((p) => p.orderId === x.orderId);
      console.log(
        `  №${orderCode(x.orderId)} · ${day(x.createdAt)} · доставка ${x.deliveryDate} · ${x.status} · сумма ${money(x.totalAmount)} · оплачено ${money(x.paidAmount)} · платежи: ${xp.map((p) => `${p.date} ${money(p.amount)} ${p.method}`).join(", ") || "—"}`
      );
    }
    const owed = Math.round(o.totalAmount - o.paidAmount);
    const same = payments.filter((p) => Math.abs(p.amount - owed) < 1 && daysBetween(p.date || p.createdAt, o.createdAt) <= 10 && p.orderId !== o.orderId);
    console.log(`платежи на ${money(owed)} по другим заявкам за ±10 дней (${same.length}):`);
    for (const p of same) {
      const x = orders.find((y) => y.orderId === p.orderId);
      console.log(`  ${p.date} · №${x ? orderCode(x.orderId) : p.orderId} ${x?.clientName ?? "(заявки нет)"} · ${p.method} · ${p.accountantEmail} · «${p.note}»`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
