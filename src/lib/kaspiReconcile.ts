import { listKaspiInvoices } from "./repo/kaspiInvoices";
import { listPayments } from "./repo/payments";
import { listOrdersWithItems } from "./repo/orders";
import { saveSettings } from "./repo/settings";
import { apiPayConfig, getInvoice } from "./apipay";
import { applyApiPayInvoice, KASPI_ACTOR, LOST_KASPI_WINDOW_MIN } from "./kaspiSync";
import { isOpenKaspiStatus, isPaidKaspiStatus, recordedPaymentId } from "./kaspiInvoice";
import { repairLostPayments } from "./paymentWrite";
import { lostPaymentFix } from "./payments";
import { invoiceByFarm } from "./orderMoney";
import { orderCode } from "./paymentStage";
import { ORDER_STATUSES, PAID_FIELD_BY_FARM } from "./constants";

// ---------------------------------------------------------------------------
// Сверка Kaspi сама, раз в час (26.11.2026). Владелец со снимком чата «CRM»: менеджер пишет «№ VNJMB — 8 000 оплачено,
// в CRM висит как долг», «№ Q0GGT — 47 175 оплачено». Обе заявки клиенты оплатили по счёту Kaspi:
//  - Q0GGT: ApiPay не доставил уведомление об оплате (у них «1 из 10 уведомлений — таймаут», 27.10.2026). Счёт шесть дней
//    стоял у нас «ждёт оплаты», заявка — в долгах. Лечилось только ручным `kaspi-reconcile.ts`;
//  - VNJMB: платёж лёг в журнал, а запись итога заявки не прошла, и повторное уведомление только связало счёт с
//    платежом (`applyApiPayInvoice`, ветка «уже в журнале»).
// Теперь обе дыры закрывает проход: (1) счета, которые у нас ещё ждут оплаты дольше `MIN_AGE_MIN`, спрашиваются у ApiPay
// и проводятся так же, как кнопкой «Обновить статус»; (2) заявки, у которых платёж Kaspi последних двух суток есть в
// журнале, а в итоге его нет, — итог возвращается (`repairLostPayments`). Денег проход не придумывает: проводит только
// то, что ApiPay назвал оплаченным, и только то, что уже записано в журнале платежей.
// ---------------------------------------------------------------------------

export const KASPI_RECONCILE_LAST_RUN = "KaspiReconcileLastRun";
/** Уведомление об оплате приходит за секунды; моложе этого счёт не трогаем — пусть дойдёт само. */
const MIN_AGE_MIN = 15;
/** Старше стольких дней открытый счёт уже не сверяем: он истёк, а оплата «в долг» идёт через бухгалтера. */
const MAX_AGE_DAYS = 6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface KaspiReconcileResult {
  checked: number;
  paid: string[];
  updated: number;
  repaired: string[];
  errors: number;
}

export async function reconcileKaspi(options: { budgetMs?: number; limit?: number } = {}): Promise<KaspiReconcileResult> {
  const started = Date.now();
  const budget = options.budgetMs ?? 40000;
  const now = Date.now();
  const out: KaspiReconcileResult = { checked: 0, paid: [], updated: 0, repaired: [], errors: 0 };
  const invoices = (await listKaspiInvoices({ fresh: true })).filter((i) => !i.sandbox);
  const due = invoices
    .filter((i) => {
      const age = now - Date.parse(i.createdAt);
      if (!(age > MIN_AGE_MIN * 60000 && age < MAX_AGE_DAYS * 86400000)) return false;
      return isOpenKaspiStatus(i.status) || i.status === "cancelling" || (isPaidKaspiStatus(i.status) && !recordedPaymentId(i.paymentId));
    })
    // Сначала старые: они дольше всех висят «в долгах».
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, options.limit ?? 40);
  for (const i of due) {
    if (Date.now() - started > budget) break;
    const cfg = apiPayConfig(i.farm);
    if (!cfg) continue;
    try {
      const live = await getInvoice(cfg, i.invoiceId);
      out.checked += 1;
      const st = String(live.status || "");
      if (st === i.status && !(isPaidKaspiStatus(st) && !recordedPaymentId(i.paymentId))) continue;
      const res = await applyApiPayInvoice(live);
      if (res === "paid") out.paid.push(`№${orderCode(i.orderId)} ${Math.round(i.amount)} ₸`);
      else if (res === "updated") out.updated += 1;
    } catch (err) {
      out.errors += 1;
      console.error("kaspi reconcile:", err instanceof Error ? err.message : err);
    }
    await sleep(250);
  }

  // Платёж Kaspi в журнале есть, а в итоге заявки его нет.
  if (Date.now() - started < budget) {
    try {
      const since = new Date(now - LOST_KASPI_WINDOW_MIN * 60000).toISOString();
      const ledger = await listPayments({ fresh: true });
      const recentIds = new Set(ledger.filter((p) => p.accountantEmail === KASPI_ACTOR && p.createdAt >= since).map((p) => p.orderId));
      if (recentIds.size) {
        const orders = (await listOrdersWithItems()).filter((o) => recentIds.has(o.orderId) && o.status !== ORDER_STATUSES.CANCELLED);
        for (const o of orders) {
          const farms = invoiceByFarm(o.items).map((f) => f.farm);
          const paidByFarm: Record<string, number> = {};
          for (const f of farms) {
            const field = PAID_FIELD_BY_FARM[f];
            if (field) paidByFarm[f] = Number((o as unknown as Record<string, number>)[field]) || 0;
          }
          const mine = ledger.filter((p) => p.orderId === o.orderId);
          if (!lostPaymentFix({ farms, paidAmount: o.paidAmount, paidByFarm, ledger: mine, now: new Date(), recentOnly: true, windowMin: LOST_KASPI_WINDOW_MIN })) continue;
          if (Date.now() - started > budget) break;
          const fixed = await repairLostPayments(o.orderId, KASPI_ACTOR, true, LOST_KASPI_WINDOW_MIN);
          if (fixed !== null) out.repaired.push(`№${orderCode(o.orderId)}`);
        }
      }
    } catch (err) {
      out.errors += 1;
      console.error("kaspi reconcile repair:", err instanceof Error ? err.message : err);
    }
  }
  const note = `${new Date().toISOString()} · проверено ${out.checked} из ${due.length} · оплачено и проведено: ${out.paid.join(", ") || "нет"} · статусов обновлено ${out.updated} · итог возвращён: ${out.repaired.join(", ") || "нет"}${out.errors ? ` · ошибок ${out.errors}` : ""}`;
  await saveSettings({ [KASPI_RECONCILE_LAST_RUN]: note.slice(0, 900) }).catch(() => undefined);
  return out;
}

/** Часовой проход будит сверку своей функцией (`/api/kaspi/reconcile`). */
export async function kickKaspiReconcile(origin: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) return;
  try {
    await fetch(`${origin}/api/kaspi/reconcile`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(1500) });
  } catch {
    // Оборвали сами — сверка идёт своей функцией.
  }
}
