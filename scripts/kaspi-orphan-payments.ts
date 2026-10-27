import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Оплаты Kaspi, которые не попали в заявку (27.10.2026, владелец: «по Есентаю не приходят подтверждения, что клиент оплатил»
 * и «таких много — в чём проблема?»). Клиент оплатил счёт, выставленный по заявке, которую потом ОТМЕНИЛИ (обычно — дубль:
 * менеджер завёл заявку дважды, бухгалтер выставил счета по обеим, дубль отменили, а клиент оплатил его счёт). Программа
 * такие деньги сама не проводит (`applyApiPayInvoice`: «заявка отменена — проведите вручную»), и живая заявка того же
 * клиента висит неоплаченной, а бухгалтер выставляет ей счёт снова и снова.
 *
 * Для каждого такого счёта ищет живую заявку того же клиента (карточка или телефон, ±5 дней) с неоплаченной частью этой
 * компании не меньше суммы. С --yes (только при единственной подходящей): копия таблицы, платёж в живую заявку той же
 * датой, счёт связывается с платежом, открытые счета этой компании у живой заявки, если её часть теперь оплачена, —
 * отменяются в ApiPay (чтобы клиент не заплатил дважды). Телефоны — последние 4 цифры.
 *
 *   npx tsx scripts/kaspi-orphan-payments.ts [дней=30] [--yes]
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { findKaspiInvoice, listKaspiInvoices, updateKaspiInvoiceRow } from "../src/lib/repo/kaspiInvoices";
import { listPayments } from "../src/lib/repo/payments";
import { listMoneyLog, logMoney } from "../src/lib/repo/moneyLog";
import { apiPayConfig, cancelInvoice } from "../src/lib/apipay";
import { recordPayment } from "../src/lib/paymentWrite";
import { KASPI_ACTOR } from "../src/lib/kaspiSync";
import { isOpenKaspiStatus, isPaidKaspiStatus } from "../src/lib/kaspiInvoice";
import { farmPayments } from "../src/lib/orderMoney";
import { orderCode } from "../src/lib/paymentStage";
import { phoneKey } from "../src/lib/leads";
import { createBackup } from "../src/lib/backup";
import { localDayKey } from "../src/lib/timezone";
import { FARM_LABELS, MONEY_LOG_ACTIONS, ORDER_STATUSES } from "../src/lib/constants";

const DAY = 86400000;

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes("--yes");
  const days = Number(args.find((a) => a !== "--yes")) || 30;
  const since = new Date(Date.now() - days * DAY).toISOString();
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.KASPI_INVOICES, SHEET_TABS.MONEY_LOG, SHEET_TABS.PAYMENTS]);
  const [orders, invoices, payments, log] = await Promise.all([listOrdersWithItems(), listKaspiInvoices({ fresh: true }), listPayments({ fresh: true }), listMoneyLog()]);
  const byId = new Map(orders.map((o) => [o.orderId, o]));

  const orphans = invoices.filter((i) => !i.sandbox && i.createdAt >= since && isPaidKaspiStatus(i.status) && !i.paymentId);
  const cancelledWithInvoices = orders.filter((o) => o.createdAt >= since && o.status === ORDER_STATUSES.CANCELLED && invoices.some((i) => i.orderId === o.orderId));
  console.log(`За ${days} дн.: оплачено счетов ${invoices.filter((i) => !i.sandbox && i.createdAt >= since && isPaidKaspiStatus(i.status)).length}, из них НЕ проведено в заявку — ${orphans.length}.`);
  console.log(`Отменённых заявок, по которым выставлялись счета: ${cancelledWithInvoices.length}.\n`);

  const plans: { inv: (typeof orphans)[number]; target: (typeof orders)[number] }[] = [];
  for (const inv of orphans) {
    const src = byId.get(inv.orderId);
    const why = log.filter((l) => l.orderId === inv.orderId && l.action === "order_cancelled").map((l) => `${l.createdAt.slice(5, 16)} ${l.actorEmail}: ${l.details.replace(/\s+/g, " ").slice(0, 120)}`)[0] || "";
    const keys = new Set([phoneKey(src?.clientPhone), phoneKey(inv.phone)].filter(Boolean));
    const t0 = Date.parse(src?.createdAt || inv.createdAt);
    const already = payments.some((p) => p.note.includes(inv.invoiceId));
    const candidates = orders
      .filter((o) => o.orderId !== inv.orderId && o.status !== ORDER_STATUSES.CANCELLED)
      .filter((o) => (src?.clientId && o.clientId === src.clientId) || keys.has(phoneKey(o.clientPhone)))
      .filter((o) => Math.abs(Date.parse(o.createdAt) - t0) <= 5 * DAY)
      .map((o) => {
        const part = farmPayments(o).find((f) => f.farm === inv.farm);
        return { o, due: part ? Math.round((part.amount - part.paidAmount) * 100) / 100 : 0 };
      })
      .filter((c) => c.due >= inv.amount - 0.5);
    console.log(
      `• счёт №${inv.invoiceId} · ${FARM_LABELS[inv.farm] ?? inv.farm} · ${inv.amount} ₸ · …${inv.phone.slice(-4)} · оплачен ${inv.paidAt.slice(0, 16)}\n` +
        `  по заявке №${orderCode(inv.orderId)} (${src ? `${src.clientName}, ${src.status}, менеджер ${src.managerEmail}` : "не найдена"})${why ? `\n  отменена ${why}` : ""}` +
        (already ? "\n  в журнале платежей уже есть платёж с этим счётом — пропускаю" : "") +
        `\n  живая заявка того же клиента с неоплаченной частью: ${candidates.length ? candidates.map((c) => `№${orderCode(c.o.orderId)} (${c.o.createdAt.slice(5, 16)}, ${c.o.status}, не оплачено по компании ${c.due} ₸)`).join("; ") : "НЕТ — разобрать вручную (возврат или куда отнести)"}`
    );
    if (!already && candidates.length === 1) plans.push({ inv, target: candidates[0].o });
  }

  console.log(`\nМожно провести автоматически: ${plans.length} из ${orphans.length}.`);
  if (!yes || !plans.length) return;

  const backup = await createBackup(new Date(), (m) => console.log(`  копия: ${m}`));
  console.log(`Копия таблицы: ${backup.url}`);
  for (const { inv, target } of plans) {
    const paidAt = inv.paidAt ? new Date(inv.paidAt) : new Date();
    const res = await recordPayment({
      orderId: target.orderId,
      farm: inv.farm,
      date: localDayKey(Number.isNaN(paidAt.getTime()) ? new Date() : paidAt),
      amount: inv.amount,
      method: "Каспи",
      note: `Kaspi-счёт №${inv.invoiceId} — оплачен по отменённой заявке №${orderCode(inv.orderId)}`,
      actorEmail: KASPI_ACTOR,
    });
    const row = await findKaspiInvoice(inv.invoiceId);
    if (row) await updateKaspiInvoiceRow(row.rowNumber, { PaymentID: res?.paymentId ?? "", ErrorMessage: `Проведено в заявку №${orderCode(target.orderId)}`, UpdatedAt: new Date().toISOString() });
    console.log(`✓ ${inv.amount} ₸ → №${orderCode(target.orderId)}, получено теперь ${res?.paidAfter ?? "?"} ₸`);

    // Часть компании оплачена — открытые счета этой компании у живой заявки клиенту больше не нужны.
    const fresh = (await listOrdersWithItems()).find((o) => o.orderId === target.orderId);
    const part = fresh ? farmPayments(fresh).find((f) => f.farm === inv.farm) : undefined;
    if (!part || part.amount - part.paidAmount > 0.5) continue;
    const cfg = apiPayConfig(inv.farm);
    for (const open of (await listKaspiInvoices({ fresh: true })).filter((x) => x.orderId === target.orderId && x.farm === inv.farm && isOpenKaspiStatus(x.status))) {
      if (!cfg) break;
      try {
        const c = await cancelInvoice(cfg, open.invoiceId);
        const r = await findKaspiInvoice(open.invoiceId);
        if (r) await updateKaspiInvoiceRow(r.rowNumber, { Status: String(c?.status || "cancelling"), UpdatedAt: new Date().toISOString() });
        await logMoney({ actorEmail: KASPI_ACTOR, orderId: target.orderId, action: MONEY_LOG_ACTIONS.INVOICE_SENT, details: `Счёт Kaspi №${open.invoiceId} отменён — часть уже оплачена (счёт №${inv.invoiceId})`, amountBefore: 0, amountAfter: 0 });
        console.log(`  отменён лишний счёт №${open.invoiceId} на ${open.amount} ₸`);
      } catch (e) {
        console.log(`  счёт №${open.invoiceId} отменить не вышло: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
