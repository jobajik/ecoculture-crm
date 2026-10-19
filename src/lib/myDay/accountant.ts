import { FARM_LABELS, FARM_ORDER, FLOWER_TYPE_LABELS, MONEY_EPSILON } from "../constants";
import type { CallRow, FinanceOrderRow } from "../finance";
import type { PaymentStatusBoard } from "../paymentStatus";
import type { CashByFlower } from "../cashByFlower";

/**
 * «Мой день» бухгалтера (19.10.2026, макет принят владельцем): что с деньгами ПРЯМО СЕЙЧАС и что делать первым.
 *
 * Ничего не считается заново — всё берётся из того, что уже считают страницы «Оплат»: список звонков
 * (`getFinanceSnapshot().calls`, он уже в порядке срочности), доска статуса оплат (`buildPaymentStatus`: дорожки
 * «Kaspi не дошёл» и «Нет отметки о счёте», «пришло сегодня» по дню ПОСТУПЛЕНИЯ) и касса по цветкам. Два разных
 * числа об одном и том же на двух страницах читаются как ошибка, поэтому своих правил здесь нет — только отбор и порядок.
 *
 * Чистая функция: её зовут страница и `scripts/check-myday-accountant.ts`.
 */

export type CallReason = "broken" | "overdue" | "due_today";

export interface DayCall {
  orderId: string;
  code: string;
  clientName: string;
  clientPhone: string;
  managerName: string;
  debt: number;
  reason: CallReason;
  /** Почему звоним — словами из «Долгов и звонков». */
  why: string;
  /** Когда по заявке последний раз напоминали в WhatsApp (ГГГГ-ММ-ДД); пусто — не напоминали. */
  remindedAt: string;
}

export interface DayInvoice {
  orderId: string;
  code: string;
  clientName: string;
  debt: number;
  /** Почему счёт ещё не ушёл — заметка бухгалтера; пусто — заметки нет. */
  note: string;
  /** Дней с доставки (или с оформления). */
  days: number;
  row: FinanceOrderRow;
}

export interface DayPayment {
  orderId: string;
  code: string;
  clientName: string;
  amount: number;
  method: string;
  viaKaspi: boolean;
}

export interface KaspiLine {
  farm: string;
  label: string;
  state: "ok" | "broken" | "unknown" | "off";
  text: string;
}

export interface AccountantDay {
  kaspi: KaspiLine[];
  tiles: {
    paidToday: { amount: number; kaspiAmount: number; count: number };
    waiting: { amount: number; orders: number };
    overdue: { amount: number; orders: number; brokenPromises: number };
    kaspiProblems: { count: number; amount: number };
    noInvoice: number;
  };
  calls: DayCall[];
  /** Сколько строк звонков всего (в карточке показываем первые `CALLS_SHOWN`). */
  callsTotal: number;
  /** Обещали заплатить позже — скрыты до срока. */
  promisedLater: number;
  invoices: DayInvoice[];
  invoicesTotal: number;
  payments: DayPayment[];
  byFlower: { flowerType: string; label: string; amount: number }[];
}

export const CALLS_SHOWN = 6;
export const INVOICES_SHOWN = 5;
export const PAYMENTS_SHOWN = 5;

/** Зачем звонить — три причины, в этом же порядке. Остальные долги в «Мой день» не идут: их очередь не сегодня. */
export function callReason(c: Pick<CallRow, "promiseState" | "overdue" | "dueDate">, todayKey: string): CallReason | null {
  if (c.promiseState === "broken") return "broken";
  if (c.promiseState === "future") return null;
  if (c.overdue) return "overdue";
  if (c.promiseState === "today" || (c.dueDate && c.dueDate === todayKey)) return "due_today";
  return null;
}

const REASON_RANK: Record<CallReason, number> = { broken: 0, overdue: 1, due_today: 2 };

export function kaspiLines(
  health: { farm: string; state: "ok" | "broken" | "unknown"; reason?: string }[],
  configured: string[]
): KaspiLine[] {
  return FARM_ORDER.map((farm) => {
    const label = FARM_LABELS[farm] ?? farm;
    if (!configured.includes(farm)) return { farm, label, state: "off", text: `${label} — касса не подключена` };
    const h = health.find((x) => x.farm === farm);
    if (!h || h.state === "unknown") return { farm, label, state: "unknown", text: `${label} — касса подключена` };
    if (h.state === "broken") return { farm, label, state: "broken", text: `${label} — касса отключилась${h.reason ? `: ${h.reason}` : ""}` };
    return { farm, label, state: "ok", text: `${label} — касса работает` };
  });
}

export function buildAccountantDay(input: {
  calls: CallRow[];
  openRows: FinanceOrderRow[];
  debtOverdueTotal: number;
  board: PaymentStatusBoard;
  cash: CashByFlower;
  /** Последнее ушедшее напоминание по заявке (ГГГГ-ММ-ДД). */
  remindedByOrder: Map<string, string>;
  kaspiHealth: { farm: string; state: "ok" | "broken" | "unknown"; reason?: string }[];
  kaspiConfigured: string[];
  todayKey: string;
}): AccountantDay {
  const { calls, openRows, board, cash, remindedByOrder, todayKey } = input;

  const dayCalls: DayCall[] = calls
    .map((c) => ({ c, reason: callReason(c, todayKey) }))
    .filter((x): x is { c: CallRow; reason: CallReason } => x.reason !== null)
    .sort((a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason] || b.c.days - a.c.days || b.c.debt - a.c.debt)
    .map(({ c, reason }) => ({
      orderId: c.orderId,
      code: c.code,
      clientName: c.clientName,
      clientPhone: c.clientPhone,
      managerName: c.managerName,
      debt: c.debt,
      reason,
      why: c.why,
      remindedAt: remindedByOrder.get(c.orderId) ?? "",
    }));

  const promisedLater = calls.filter((c) => c.promiseState === "future" && c.debt > MONEY_EPSILON).length;
  const brokenPromises = calls.filter((c) => c.promiseState === "broken").length;
  const overdueOrders = calls.filter((c) => c.overdue).length;

  const noInvoiceLane = board.lanes.find((l) => l.key === "no_invoice");
  const kaspiLane = board.lanes.find((l) => l.key === "kaspi_problem");
  const invoices: DayInvoice[] = (noInvoiceLane?.rows ?? []).map((r) => ({
    orderId: r.row.orderId,
    code: r.row.code,
    clientName: r.row.clientName || "(без названия)",
    debt: r.row.debt,
    note: r.row.invoiceNote,
    days: r.days,
    row: r.row,
  }));

  const waitingRows = openRows.filter((r) => r.debt > MONEY_EPSILON);

  const byFlower = cash.rows
    .filter((r) => r.amount > MONEY_EPSILON)
    .map((r) => ({ flowerType: r.flowerType, label: FLOWER_TYPE_LABELS[r.flowerType] ?? r.flowerType, amount: r.amount }));

  return {
    kaspi: kaspiLines(input.kaspiHealth, input.kaspiConfigured),
    tiles: {
      paidToday: { amount: board.paidToday.amount, kaspiAmount: board.paidToday.kaspiAmount, count: board.paidToday.count },
      waiting: { amount: waitingRows.reduce((s, r) => s + r.debt, 0), orders: waitingRows.length },
      overdue: { amount: input.debtOverdueTotal, orders: overdueOrders, brokenPromises },
      kaspiProblems: { count: kaspiLane?.count ?? 0, amount: kaspiLane?.amount ?? 0 },
      noInvoice: invoices.length,
    },
    calls: dayCalls.slice(0, CALLS_SHOWN),
    callsTotal: dayCalls.length,
    promisedLater,
    invoices: invoices.slice(0, INVOICES_SHOWN),
    invoicesTotal: invoices.length,
    payments: board.paidToday.rows.slice(0, PAYMENTS_SHOWN).map((p) => ({
      orderId: p.orderId,
      code: p.code,
      clientName: p.clientName,
      amount: p.amount,
      method: p.method,
      viaKaspi: p.viaKaspi,
    })),
    byFlower,
  };
}
