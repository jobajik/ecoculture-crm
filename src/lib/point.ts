import { FLOWER_TYPES, FLOWER_TYPE_LABELS, MONEY_EPSILON, ORDER_STATUSES, ROLES, bonusRateFor } from "./constants";
import { isConsignment } from "./orderKind";

// ---------------------------------------------------------------------------
// Наша точка на базаре («Пожарка»). Сентябрь 2026, владелец: «это наша точка
// на базаре, по сути мы туда перемещаем товар, а уже по факту продажи
// реализуем. Деньги принимаются на Kaspi (они сами выставляют) или наличкой.
// Нужно реализовать как перемещение, но заявку они должны делать как обычно».
//
// Его решения:
//   - деньги — ОТЧЁТОМ ЗА ДЕНЬ (Kaspi и наличные), без привязки к заявкам;
//   - вносит бухгалтер (РОП смотрит);
//   - выручка точки идёт в бонус менеджеру по ставке цветка;
//   - списания на точке учитываются, и программа показывает, сколько товара
//     там примерно осталось.
//
// Заявка с направлением «Пожарка» — перемещение (`isNotASale`): ни продаж, ни
// рейтинга, ни «Оплат». Отвезённое считается по ОТГРУЖЕННОМУ количеству и
// цене заявки, в день доставки (нет даты — в день оформления).
//
// Здесь только чистые функции — их зовут страница, действия, рейтинг и
// проверка `scripts/check-point.ts`. Модуль без googleapis (грабли 1.8).
// ---------------------------------------------------------------------------

export const POINT_NAME = "Точка на базаре";

export interface PointDay {
  date: string;
  kaspi: number;
  cash: number;
  note: string;
  accountantEmail: string;
  updatedAt: string;
}

export interface PointWriteoff {
  writeoffId: string;
  date: string;
  flowerType: string;
  quantity: number;
  /** Во что обошлось — по средней цене отвезённого этого цветка на день записи. */
  amount: number;
  reason: string;
  createdByEmail: string;
  createdAt: string;
}

export interface TransferOrder {
  orderId: string;
  createdAt: string;
  deliveryDate: string;
  managerEmail: string;
  status: string;
  direction?: string;
  retail?: string;
  kind?: string;
  paidAmount: number;
  paidAt: string;
  items: { flowerType: string; quantity: number; unitPrice: number; shippedQuantity: number }[];
}

const FLOWERS = [FLOWER_TYPES.ROSE, FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.EUSTOMA] as string[];
const round2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const dayOf = (iso: string) => (iso || "").slice(0, 10);

/** Заявки-перемещения на точку (не отменённые). */
export function pointTransfers<T extends TransferOrder>(orders: T[]): T[] {
  return orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && isConsignment(o));
}

/** День перемещения: доставка, без неё — оформление. */
export function transferDay(o: TransferOrder): string {
  return dayOf(o.deliveryDate) || dayOf(o.createdAt);
}

/** Что уехало на точку по заявке: отгруженные стебли и их стоимость по цене заявки. */
export function transferLines(o: TransferOrder): { flowerType: string; stems: number; amount: number }[] {
  return o.items
    .filter((i) => (Number(i.shippedQuantity) || 0) > 0)
    .map((i) => ({
      flowerType: i.flowerType,
      stems: Number(i.shippedQuantity) || 0,
      amount: (Number(i.shippedQuantity) || 0) * (Number(i.unitPrice) || 0),
    }));
}

// --- Проверки ввода ------------------------------------------------------------

export function canEditPoint(role: string | null | undefined): boolean {
  return role === ROLES.ACCOUNTANT || role === ROLES.ADMIN;
}

export function pointDayRefusal(input: { role: string | null | undefined; date: string; today: string; kaspi: number; cash: number }): string {
  if (!canEditPoint(input.role)) return "Выручку точки вносит бухгалтер";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Укажите день";
  if (input.date > input.today) return "День не может быть в будущем";
  for (const v of [input.kaspi, input.cash]) {
    if (!Number.isFinite(v) || v < 0) return "Суммы — неотрицательные числа";
    if (v > 100_000_000) return "Слишком большая сумма — проверьте";
  }
  return "";
}

export function pointWriteoffRefusal(input: {
  role: string | null | undefined;
  date: string;
  today: string;
  flowerType: string;
  quantity: number;
  reason: string;
}): string {
  if (!canEditPoint(input.role)) return "Списание на точке вносит бухгалтер";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Укажите день";
  if (input.date > input.today) return "День не может быть в будущем";
  if (!FLOWERS.includes(input.flowerType)) return "Выберите цветок";
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) return "Количество — целое число стеблей больше нуля";
  if (input.quantity > 100_000) return "Слишком много — проверьте количество";
  if (!(input.reason || "").trim()) return "Напишите причину: завял, сломан, не продался…";
  return "";
}

/** Средняя цена стебля цветка по всем перемещениям до дня включительно — цена списания. */
export function avgTransferPrice(orders: TransferOrder[], flowerType: string, uptoDay: string): number {
  let stems = 0;
  let amount = 0;
  for (const o of pointTransfers(orders)) {
    if (transferDay(o) > uptoDay) continue;
    for (const l of transferLines(o)) {
      if (l.flowerType !== flowerType) continue;
      stems += l.stems;
      amount += l.amount;
    }
  }
  return stems > 0 ? round2(amount / stems) : 0;
}

// --- Отчёт ----------------------------------------------------------------------

export interface PointDayRow {
  date: string;
  transferred: number;
  kaspi: number;
  cash: number;
  /** Деньги, внесённые раньше платежом прямо на заявку-перемещение. */
  fromOrders: number;
  writeoff: number;
  note: string;
}

export interface PointFlowerRow {
  flowerType: string;
  label: string;
  stems: number;
  amount: number;
  writeoffStems: number;
  writeoffAmount: number;
}

export interface PointReport {
  month: string;
  transferred: { stems: number; amount: number };
  revenue: { kaspi: number; cash: number; fromOrders: number; total: number };
  writeoffs: { stems: number; amount: number };
  flowers: PointFlowerRow[];
  days: PointDayRow[];
  /**
   * Сколько товара на точке примерно сейчас (на конец месяца или на сегодня):
   * всё отвезённое − вся выручка − все списания, в деньгах по цене заявок.
   * Растёт месяц за месяцем — значит где-то теряется товар или деньги.
   */
  onPoint: number;
  /** Доля выручки от отвезённого за месяц, %. */
  sellThrough: number;
}

/**
 * Месяц точки. Деньги — из отчётов за день плюс то, что по старинке внесли
 * платежом на заявку-перемещение (по дню оплаты), чтобы прежние деньги не
 * пропали из виду после перехода на отчёт.
 */
export function pointReport(input: {
  orders: TransferOrder[];
  days: PointDay[];
  writeoffs: PointWriteoff[];
  month: string;
  today: string;
}): PointReport {
  const { month, today } = input;
  const inMonth = (d: string) => d.slice(0, 7) === month;
  const endDay = [today, `${month}-31`].sort()[0];
  const transfers = pointTransfers(input.orders);

  const dayRows = new Map<string, PointDayRow>();
  const row = (d: string) => {
    let r = dayRows.get(d);
    if (!r) {
      r = { date: d, transferred: 0, kaspi: 0, cash: 0, fromOrders: 0, writeoff: 0, note: "" };
      dayRows.set(d, r);
    }
    return r;
  };
  const flowerMap = new Map<string, PointFlowerRow>();
  const flower = (f: string) => {
    let r = flowerMap.get(f);
    if (!r) {
      r = { flowerType: f, label: FLOWER_TYPE_LABELS[f] ?? f, stems: 0, amount: 0, writeoffStems: 0, writeoffAmount: 0 };
      flowerMap.set(f, r);
    }
    return r;
  };

  let allTransferred = 0;
  let allRevenue = 0;
  let allWriteoffs = 0;
  const out: PointReport = {
    month,
    transferred: { stems: 0, amount: 0 },
    revenue: { kaspi: 0, cash: 0, fromOrders: 0, total: 0 },
    writeoffs: { stems: 0, amount: 0 },
    flowers: [],
    days: [],
    onPoint: 0,
    sellThrough: 0,
  };

  for (const o of transfers) {
    const d = transferDay(o);
    const lines = transferLines(o);
    const amount = lines.reduce((s, l) => s + l.amount, 0);
    if (d && d <= endDay) allTransferred += amount;
    if (inMonth(d) && amount > 0) {
      row(d).transferred += amount;
      for (const l of lines) {
        const f = flower(l.flowerType);
        f.stems += l.stems;
        f.amount += l.amount;
        out.transferred.stems += l.stems;
        out.transferred.amount += l.amount;
      }
    }
    const paidDay = dayOf(o.paidAt);
    if (o.paidAmount > MONEY_EPSILON && paidDay) {
      if (paidDay <= endDay) allRevenue += o.paidAmount;
      if (inMonth(paidDay)) {
        row(paidDay).fromOrders += o.paidAmount;
        out.revenue.fromOrders += o.paidAmount;
      }
    }
  }

  for (const day of input.days) {
    const total = (Number(day.kaspi) || 0) + (Number(day.cash) || 0);
    if (day.date <= endDay) allRevenue += total;
    if (!inMonth(day.date)) continue;
    const r = row(day.date);
    r.kaspi += Number(day.kaspi) || 0;
    r.cash += Number(day.cash) || 0;
    r.note = day.note;
    out.revenue.kaspi += Number(day.kaspi) || 0;
    out.revenue.cash += Number(day.cash) || 0;
  }

  for (const w of input.writeoffs) {
    if (w.date <= endDay) allWriteoffs += Number(w.amount) || 0;
    if (!inMonth(w.date)) continue;
    row(w.date).writeoff += Number(w.amount) || 0;
    const f = flower(w.flowerType);
    f.writeoffStems += Number(w.quantity) || 0;
    f.writeoffAmount += Number(w.amount) || 0;
    out.writeoffs.stems += Number(w.quantity) || 0;
    out.writeoffs.amount += Number(w.amount) || 0;
  }

  out.revenue.total = round2(out.revenue.kaspi + out.revenue.cash + out.revenue.fromOrders);
  out.transferred.amount = round2(out.transferred.amount);
  out.writeoffs.amount = round2(out.writeoffs.amount);
  out.onPoint = round2(allTransferred - allRevenue - allWriteoffs);
  out.sellThrough = out.transferred.amount > 0 ? Math.round((out.revenue.total / out.transferred.amount) * 100) : 0;
  const order = [...FLOWERS, ...[...flowerMap.keys()].filter((f) => !FLOWERS.includes(f)).sort()];
  out.flowers = order.filter((f) => flowerMap.has(f)).map((f) => flowerMap.get(f)!);
  out.days = [...dayRows.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  return out;
}

// --- Бонус с выручки точки ---------------------------------------------------------

export interface PointBonusShare {
  managerEmail: string;
  flowerType: string;
  /** Часть выручки точки, засчитанная менеджеру по этому цветку. */
  amount: number;
  bonus: number;
}

/**
 * Выручка точки за период → менеджерам и цветкам. Деньги на базаре не
 * привязаны к заявкам, поэтому делятся ПО ОТВЕЗЁННОМУ за тот же период:
 * кто сколько и какого цветка перевёз на точку, такую долю выручки и получает.
 * Не возили ничего в периоде — берутся перемещения за 60 дней до его конца.
 * Ставка — по цветку, как у обычных продаж.
 */
export function pointBonusShares(input: { orders: TransferOrder[]; days: PointDay[]; from: string; to: string }): PointBonusShare[] {
  const { from, to } = input;
  const inRange = (d: string) => d >= from && d <= to;
  const transfers = pointTransfers(input.orders);
  let revenue = input.days.filter((d) => inRange(d.date)).reduce((s, d) => s + (Number(d.kaspi) || 0) + (Number(d.cash) || 0), 0);
  // Прежние платежи на заявки-перемещения — тоже выручка точки (по дню оплаты).
  revenue += transfers.filter((o) => inRange(dayOf(o.paidAt))).reduce((s, o) => s + (Number(o.paidAmount) || 0), 0);
  if (revenue <= MONEY_EPSILON) return [];

  const weigh = (fromDay: string) => {
    const w = new Map<string, number>();
    for (const o of transfers) {
      const d = transferDay(o);
      if (d < fromDay || d > to) continue;
      for (const l of transferLines(o)) {
        const key = `${o.managerEmail}|${l.flowerType}`;
        w.set(key, (w.get(key) ?? 0) + l.amount);
      }
    }
    return w;
  };
  let weights = weigh(from);
  if ([...weights.values()].reduce((s, v) => s + v, 0) <= 0) {
    const [y, m, d] = to.split("-").map(Number);
    const back = new Date(Date.UTC(y, m - 1, d - 60));
    weights = weigh(back.toISOString().slice(0, 10));
  }
  const total = [...weights.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) return [];
  return [...weights.entries()].map(([key, w]) => {
    const [managerEmail, flowerType] = key.split("|");
    const amount = round2((revenue * w) / total);
    return { managerEmail, flowerType, amount, bonus: round2(amount * bonusRateFor(flowerType)) };
  });
}
