import { MONEY_EPSILON } from "./constants";
import type { FinanceOrderRow } from "./finance";
import { isOpenKaspiStatus, isPaidKaspiStatus, kaspiErrorText, kaspiStatusLabel } from "./kaspiInvoice";
import type { KaspiInvoice } from "./types";

// ---------------------------------------------------------------------------
// «Статус оплат» — где сейчас каждый неоплаченный счёт.
//
// Владелец: «какой-то дашборд, чтобы можно было видеть статус по оплатам»;
// выбрал «все оплаты, Kaspi внутри». Вопрос страницы — «что мне сейчас делать с
// деньгами», поэтому заявка стоит ровно в ОДНОЙ дорожке, и дорожка говорит, чей
// ход:
//
//   Kaspi не дошёл       — счёт истёк, отменён или с ошибкой: выставить заново;
//   Нет отметки о счёте  — счёт не выставлен (или отправлен мимо программы);
//   Ждём оплату в Kaspi  — счёт у клиента, программа проведёт оплату сама;
//   Счёт отправлен       — отмечен вручную, ждём денег;
//   Оплачено частично    — часть пришла, ждём остаток.
//
// Названия честные (грабли 1.10): пустая отметка — «нет отметки», а не «счёт не
// отправлен»: у заявок, заведённых до отметки, она пуста, хотя счета ушли.
//
// Модуль без обращений к таблице: его зовут и страница, и `check-payment-status`.
// ---------------------------------------------------------------------------

export type StatusLane = "kaspi_problem" | "no_invoice" | "kaspi_pending" | "invoiced" | "partial";

export const STATUS_LANES: { key: StatusLane; label: string; hint: string }[] = [
  { key: "kaspi_problem", label: "Kaspi не дошёл", hint: "счёт истёк, отменён или с ошибкой — выставить заново" },
  { key: "no_invoice", label: "Нет отметки о счёте", hint: "выставить Kaspi-счёт или отметить отправленный" },
  { key: "kaspi_pending", label: "Ждём оплату в Kaspi", hint: "оплата проведётся сама" },
  { key: "invoiced", label: "Счёт отправлен", hint: "отправлен мимо Kaspi-счёта — ждём денег" },
  { key: "partial", label: "Оплачено частично", hint: "ждём остаток" },
];

export interface StatusKaspi {
  invoiceId: string;
  status: string;
  statusLabel: string;
  amount: number;
  phone: string;
  createdAt: string;
  farm: string;
  /** Для «Kaspi не дошёл» — почему, словами. */
  problem: string;
}

export interface StatusRow {
  row: FinanceOrderRow;
  lane: StatusLane;
  /** Самый свежий Kaspi-счёт, который объясняет дорожку. */
  kaspi: StatusKaspi | null;
  /** Дней с доставки (или с оформления, если доставки нет). */
  days: number;
}

export interface PaidTodayRow {
  orderId: string;
  code: string;
  clientName: string;
  amount: number;
  method: string;
  /** Платёж проведён программой по оплаченному Kaspi-счёту. */
  viaKaspi: boolean;
}

export interface PaymentStatusBoard {
  lanes: { key: StatusLane; label: string; hint: string; rows: StatusRow[]; count: number; amount: number }[];
  paidToday: { amount: number; count: number; kaspiAmount: number; rows: PaidTodayRow[] };
  /** Kaspi за 7 дней: сколько выставлено и сколько из этого оплачено. */
  kaspiWeek: { sent: number; sentAmount: number; paid: number; paidAmount: number };
}

function dayDiff(fromKey: string, toKey: string): number {
  const [y1, m1, d1] = fromKey.split("-").map(Number);
  const [y2, m2, d2] = toKey.split("-").map(Number);
  if (!y1 || !y2) return 0;
  return Math.max(0, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000));
}

function toStatusKaspi(inv: KaspiInvoice): StatusKaspi {
  const problem =
    inv.status === "error"
      ? `ошибка: ${kaspiErrorText(inv.errorCode, inv.errorMessage)}`
      : inv.status === "expired"
        ? "клиент не оплатил, счёт истёк"
        : inv.status === "cancelled"
          ? "счёт отменён"
          : "";
  return {
    invoiceId: inv.invoiceId,
    status: inv.status,
    statusLabel: kaspiStatusLabel(inv.status),
    amount: inv.amount,
    phone: inv.phone,
    createdAt: inv.createdAt,
    farm: inv.farm,
    problem,
  };
}

/** В какую дорожку встаёт заявка — одно правило для страницы и для проверки. */
export function statusLaneOf(
  row: Pick<FinanceOrderRow, "paidAmount" | "invoiceSentAt" | "farms">,
  invoices: KaspiInvoice[]
): { lane: StatusLane; kaspi: KaspiInvoice | null } {
  const sorted = [...invoices].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const open = sorted.find((i) => isOpenKaspiStatus(i.status));
  if (open) return { lane: "kaspi_pending", kaspi: open };
  // Последний счёт по компании, у которой ещё есть долг, не дошёл — значит,
  // клиент счёта в руках не держит, и это первое, что надо исправить.
  const owedFarms = new Set(row.farms.filter((f) => f.amount - f.paidAmount > MONEY_EPSILON).map((f) => f.farm));
  for (const inv of sorted) {
    if (owedFarms.size > 0 && !owedFarms.has(inv.farm)) continue;
    const latestForFarm = sorted.find((i) => i.farm === inv.farm);
    if (latestForFarm !== inv) continue;
    if (!isPaidKaspiStatus(inv.status)) return { lane: "kaspi_problem", kaspi: inv };
  }
  if (row.paidAmount > MONEY_EPSILON) return { lane: "partial", kaspi: sorted[0] ?? null };
  if ((row.invoiceSentAt || "").trim()) return { lane: "invoiced", kaspi: sorted[0] ?? null };
  return { lane: "no_invoice", kaspi: null };
}

/**
 * Доска «Статус оплат». `openRows` — заявки с долгом по всей базе,
 * `recentPaidRows` — заявки с платежом за неделю, `invoices` — все Kaspi-счета.
 */
export function buildPaymentStatus(
  openRows: FinanceOrderRow[],
  recentPaidRows: FinanceOrderRow[],
  invoices: KaspiInvoice[],
  todayKey: string
): PaymentStatusBoard {
  const byOrder = new Map<string, KaspiInvoice[]>();
  for (const inv of invoices) {
    const list = byOrder.get(inv.orderId) ?? [];
    list.push(inv);
    byOrder.set(inv.orderId, list);
  }

  const rows: StatusRow[] = openRows
    .filter((r) => r.debt > MONEY_EPSILON)
    .map((row) => {
      const { lane, kaspi } = statusLaneOf(row, byOrder.get(row.orderId) ?? []);
      return {
        row,
        lane,
        kaspi: kaspi ? toStatusKaspi(kaspi) : null,
        days: dayDiff(row.deliveryDate || row.createdDate, todayKey),
      };
    });

  // Внутри дорожки — сначала самые давние: они дольше всех без денег.
  const lanes = STATUS_LANES.map((l) => {
    const laneRows = rows
      .filter((r) => r.lane === l.key)
      .sort((a, b) => b.days - a.days || b.row.debt - a.row.debt);
    return {
      ...l,
      rows: laneRows,
      count: laneRows.length,
      amount: laneRows.reduce((s, r) => s + r.row.debt, 0),
    };
  });

  // Оплачено сегодня — по дню ПОСТУПЛЕНИЯ, из журнала платежей.
  const paidInvoiceIds = new Set(invoices.filter((i) => isPaidKaspiStatus(i.status)).map((i) => i.paymentId));
  const todayRows: PaidTodayRow[] = [];
  for (const r of recentPaidRows) {
    for (const p of r.payments) {
      if (p.date !== todayKey || p.amount <= 0) continue;
      todayRows.push({
        orderId: r.orderId,
        code: r.code,
        clientName: r.clientName,
        amount: p.amount,
        method: p.method,
        viaKaspi: paidInvoiceIds.has(p.paymentId),
      });
    }
  }
  todayRows.sort((a, b) => b.amount - a.amount);

  const weekAgo = (() => {
    const [y, m, d] = todayKey.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d - 6));
    return t.toISOString().slice(0, 10);
  })();
  const week = invoices.filter((i) => (i.createdAt || "").slice(0, 10) >= weekAgo && !i.sandbox);
  const weekPaid = week.filter((i) => isPaidKaspiStatus(i.status));

  return {
    lanes,
    paidToday: {
      amount: todayRows.reduce((s, r) => s + r.amount, 0),
      count: todayRows.length,
      kaspiAmount: todayRows.filter((r) => r.viaKaspi).reduce((s, r) => s + r.amount, 0),
      rows: todayRows,
    },
    kaspiWeek: {
      sent: week.length,
      sentAmount: week.reduce((s, i) => s + i.amount, 0),
      paid: weekPaid.length,
      paidAmount: weekPaid.reduce((s, i) => s + i.amount, 0),
    },
  };
}
