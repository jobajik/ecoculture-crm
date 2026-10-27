import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Заявки по коротким номерам (№G2K6T): клиент, менеджер, позиции, статус, деньги, счета Kaspi и журнал денег. Для разбора
 * «клиент оплатил, а оплата не пришла» (27.10.2026). Телефоны — последние 4 цифры. Ничего не меняет.
 *
 *   npx tsx scripts/diag-orders-by-code.ts G2K6T Z848X …
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listKaspiInvoices } from "../src/lib/repo/kaspiInvoices";
import { listMoneyLog } from "../src/lib/repo/moneyLog";
import { listPayments } from "../src/lib/repo/payments";
import { orderCode } from "../src/lib/paymentStage";

async function main() {
  const codes = process.argv.slice(2).map((c) => c.toUpperCase());
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.KASPI_INVOICES, SHEET_TABS.MONEY_LOG, SHEET_TABS.PAYMENTS]);
  const [orders, invoices, log, payments] = await Promise.all([listOrdersWithItems(), listKaspiInvoices({ fresh: true }), listMoneyLog(), listPayments({ fresh: true })]);
  for (const code of codes) {
    const o = orders.find((x) => orderCode(x.orderId) === code);
    if (!o) {
      console.log(`\n№${code}: не найдена`);
      continue;
    }
    console.log(`\n=== №${code} · ${o.clientName} · …${o.clientPhone.replace(/\D/g, "").slice(-4)} · менеджер ${o.managerEmail} ===`);
    console.log(`создана ${o.createdAt.slice(0, 16)} · доставка ${o.deliveryDate} · статус ${o.status} · сумма ${o.totalAmount} · получено ${o.paidAmount}`);
    console.log(`заметка: ${(o.notes || "").replace(/\s+/g, " ").slice(0, 200)}`);
    for (const it of o.items) console.log(`  • ${it.flowerType} ${it.variety} ${it.grade} — ${it.quantity} × ${it.unitPrice}`);
    for (const i of invoices.filter((x) => x.orderId === o.orderId)) console.log(`  счёт ${i.farm} ${i.amount} ₸: ${i.status}${i.paidAt ? `, оплачен ${i.paidAt.slice(0, 16)}` : ""} · создан ${i.createdAt.slice(0, 16)} · ${i.errorMessage}`);
    for (const p of payments.filter((x) => x.orderId === o.orderId)) console.log(`  платёж ${p.amount} ₸ ${p.date} ${p.method} (${p.accountantEmail}) ${p.note}`);
    for (const l of log.filter((x) => x.orderId === o.orderId)) console.log(`  журнал ${l.createdAt.slice(0, 16)} ${l.actorEmail}: ${l.action} — ${l.details.replace(/\s+/g, " ").slice(0, 200)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
