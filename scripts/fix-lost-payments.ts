/*
 * Заявки, у которых в журнале платежей денег больше, чем в итоге заявки, и разница складывается из
 * отдельных платежей, — их запись итога потерялась (два Kaspi-счёта оплачены в одну секунду, №YKLQQ).
 *
 *   npx tsx scripts/fix-lost-payments.ts                 — только показ, ничего не меняет
 *   npx tsx scripts/fix-lost-payments.ts --yes YKLQQ …   — копия таблицы, затем исправить ЭТИ заявки
 *
 * Исправляются только названные номера: разницу «журнал больше итога» даёт и законное «вернули переплату».
 *
 * 16.11.2026, №6C93W: у смешанной заявки части компаний записались обе, а общий итог — только последний (40 000 из
 * 67 000); за два дня «остаток 27 000» перевыставили клиенту счетами пять раз, два счёта ещё ждали оплаты. Поэтому
 * после исправления, если заявка оплачена целиком, её счета Kaspi, которые ещё ждут оплаты, ОТМЕНЯЮТСЯ — иначе клиент
 * заплатит второй раз. Телефоны не печатаются.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listPayments } from "../src/lib/repo/payments";
import { lostPaymentFix } from "../src/lib/payments";
import { invoiceByFarm } from "../src/lib/orderMoney";
import { orderCode } from "../src/lib/paymentStage";
import { repairLostPayments } from "../src/lib/paymentWrite";
import { createBackup } from "../src/lib/backup";
import { MONEY_EPSILON, MONEY_LOG_ACTIONS, ORDER_STATUSES, PAID_FIELD_BY_FARM } from "../src/lib/constants";
import { findKaspiInvoice, listKaspiInvoices, updateKaspiInvoiceRow } from "../src/lib/repo/kaspiInvoices";
import { apiPayConfig, cancelInvoice } from "../src/lib/apipay";
import { isOpenKaspiStatus } from "../src/lib/kaspiInvoice";
import { getOrderById } from "../src/lib/repo/orders";
import { logMoney } from "../src/lib/repo/moneyLog";

const OWNER = "y.sadakbayev@gmail.com";
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

async function main() {
  const yes = process.argv.includes("--yes");
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((a) => a.toUpperCase());
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.PAYMENTS]);
  const [orders, payments, invoices] = await Promise.all([listOrdersWithItems(), listPayments(), listKaspiInvoices({ fresh: true })]);
  const found: { code: string; orderId: string }[] = [];
  for (const o of orders) {
    if (o.status === ORDER_STATUSES.CANCELLED) continue;
    const ledger = payments.filter((p) => p.orderId === o.orderId);
    if (ledger.length === 0) continue;
    const farms = invoiceByFarm(o.items).map((f) => f.farm);
    const paidByFarm: Record<string, number> = {};
    for (const f of farms) {
      const field = PAID_FIELD_BY_FARM[f];
      if (field) paidByFarm[f] = Number((o as unknown as Record<string, number>)[field]) || 0;
    }
    const fix = lostPaymentFix({ farms, paidAmount: o.paidAmount, paidByFarm, ledger, now: new Date(), recentOnly: false });
    if (!fix) continue;
    const code = orderCode(o.orderId);
    found.push({ code, orderId: o.orderId });
    console.log(
      `№${code} · ${o.clientName} · ${o.createdAt.slice(0, 10)} · сумма ${money(o.totalAmount)} · в итоге ${money(o.paidAmount)} · ` +
        `в журнале ${money(ledger.reduce((s, p) => s + p.amount, 0))} → станет ${money(fix.paidAmount)} (+${money(fix.added)})` +
        (farms.length > 1 ? ` · по компаниям сейчас: ${farms.map((f) => `${f} ${money(paidByFarm[f] ?? 0)}`).join(", ")}` : "")
    );
    const open = invoices.filter((i) => i.orderId === o.orderId && isOpenKaspiStatus(i.status));
    if (open.length > 0) {
      console.log(`    ждут оплаты счета Kaspi: ${open.map((i) => `№${i.invoiceId} ${money(i.amount)} от ${i.createdAt.slice(0, 16)}`).join(", ")}${fix.paidAmount >= o.totalAmount - MONEY_EPSILON ? " — после исправления будут отменены" : ""}`);
    }
  }
  console.log(`\nНайдено заявок: ${found.length}`);
  if (!yes) return console.log("Только показ. Исправить: --yes <номера>");
  const todo = found.filter((f) => wanted.includes(f.code) || wanted.includes(f.orderId.toUpperCase()));
  if (todo.length === 0) return console.log("Названных номеров среди найденных нет — ничего не меняю.");
  const backup = await createBackup(new Date(), (m) => console.log(`  копия: ${m}`));
  console.log(`Копия таблицы: ${backup.url}`);
  for (const t of todo) {
    const after = await repairLostPayments(t.orderId, OWNER, false);
    console.log(`№${t.code}: ${after === null ? "не изменилось" : `итог теперь ${money(after)}`}`);
    // Оплачена целиком — счета, которые ещё ждут оплаты, клиенту больше не нужны.
    const order = await getOrderById(t.orderId);
    if (!order || order.paidAmount < order.totalAmount - MONEY_EPSILON) continue;
    const cancelled: string[] = [];
    for (const inv of invoices.filter((i) => i.orderId === t.orderId && isOpenKaspiStatus(i.status))) {
      const cfg = apiPayConfig(inv.farm);
      if (!cfg) {
        console.log(`  счёт №${inv.invoiceId}: касса ${inv.farm} не подключена — отмените в Kaspi вручную`);
        continue;
      }
      try {
        // «Отменяется» ставим ДО запроса: тогда вебхук ApiPay не примет отмену за отказ клиента (и бот ему не напишет).
        const found = await findKaspiInvoice(inv.invoiceId);
        if (found) await updateKaspiInvoiceRow(found.rowNumber, { Status: "cancelling", UpdatedAt: new Date().toISOString() });
        const res = await cancelInvoice(cfg, inv.invoiceId);
        if (found) await updateKaspiInvoiceRow(found.rowNumber, { Status: String(res?.status || "cancelling"), UpdatedAt: new Date().toISOString() });
        console.log(`  счёт №${inv.invoiceId} на ${money(inv.amount)}: ${String(res?.status || "cancelling")}`);
        cancelled.push(`№${inv.invoiceId} на ${money(inv.amount)}`);
      } catch (err) {
        console.log(`  счёт №${inv.invoiceId}: не отменился — ${err instanceof Error ? err.message : err}. Отмените на заявке кнопкой «Отменить счёт».`);
      }
    }
    if (cancelled.length > 0) {
      await logMoney({
        actorEmail: OWNER,
        orderId: t.orderId,
        action: MONEY_LOG_ACTIONS.INVOICE_SENT, // тем же действием отмену счёта пишет и кнопка бухгалтера
        details: `Заявка оплачена целиком — лишние счета Kaspi отменены: ${cancelled.join(", ")}`,
        amountBefore: order.paidAmount,
        amountAfter: order.paidAmount,
      });
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
