import { FLOWER_TYPES, FLOWER_TYPE_LABELS, compareGrades, formatGrade, getFarmFor, retailLabel } from "../constants";
import { inStore, isOffice, isOfficeRole, type StoreCode } from "../officeStore";
import { farmScopeFor, isRetailOrder } from "../retail";
import { isConsignment, isRegionOrder } from "../orderKind";
import { isReadyToShip, notReadyReason, shipsOnCredit } from "../orderReady";
import { byUrgency, orderStage } from "../orderStage";
import { orderCode } from "../paymentStage";
import { deliveryGroup, type DeliveryGroupKey } from "../shipQueue";
import { computeBatchStorageInfo, type BatchStorageInfo, type StorageStatus } from "../shelfLife";
import { receivedOn } from "../receivedToday";
import { likelyDuplicates } from "../batchFix";
import { formatDay } from "../formatDate";
import type { Batch, OrderWithItems, Settings, Shipment } from "../types";

/**
 * «Мой день» склада (19.10.2026, макет принят владельцем): что отгрузить сегодня, что опаздывает, что ждёт
 * чужого хода, сколько лежит и на сколько хватит. Одна чистая функция на зав. складом производства (только свой
 * цветок — грабли 1.1-ter) и склад офиса (только офисные заявки и офисные партии — `officeStore.ts`).
 *
 * Правила — те же, что на страницах склада: готовность — `isReadyToShip`, порядок — `byUrgency`, группы по дню
 * доставки — `deliveryGroup`, срок хранения — `computeBatchStorageInfo`, «хватит на» — без просроченного, по темпу
 * отгрузок последних семи дней (как в `stock.ts`). Второй копии правил здесь нет: только раскладка по карточкам.
 */
export interface DayQueueRow {
  orderId: string;
  code: string;
  client: string;
  /** Пояснение рядом с клиентом: «наш магазин», «объём на город», телефон у офиса. */
  note: string;
  /** Позиции одной строкой: «Jumilia 60 — 800 · Altaj Первая — 300» (сколько ещё отгрузить). */
  lines: string;
  /** Сколько стеблей ещё отгрузить. */
  stems: number;
  delivery: string;
  lateDays: number;
  /** Метка готовности: «готова · оплачена», «готова · в долг · Отсрочка 7 дней», «магазин»… */
  ready: string;
  href: string;
}

export interface DayWaitingRow {
  orderId: string;
  code: string;
  client: string;
  delivery: string;
  /** «Ждёт подтверждения менеджера и оплаты» — `notReadyReason`. */
  reason: string;
  lateDays: number;
  href: string;
}

export interface DayGradeLine {
  key: string;
  label: string;
  qty: number;
  /** Доли стеблей по сроку, в сумме 1. */
  ok: number;
  warning: number;
  critical: number;
}

export interface DayReceivedRow {
  batchId: string;
  label: string;
  qty: number;
  time: string;
  duplicate: boolean;
}

export interface WarehouseDay {
  store: StoreCode;
  tiles: {
    todayOrders: number;
    todayStems: number;
    late: number;
    lateStems: number;
    waiting: number;
    stockStems: number;
    criticalStems: number;
    warningStems: number;
    /** На сколько дней хватит непросроченного при темпе недели; null — отгрузок не было. */
    coverDays: number | null;
  };
  queue: {
    late: DayQueueRow[];
    today: DayQueueRow[];
    tomorrow: DayQueueRow[];
    laterCount: number;
    laterStems: number;
    nodateCount: number;
  };
  waiting: DayWaitingRow[];
  grades: DayGradeLine[];
  received: DayReceivedRow[];
}

export interface WarehouseDayInput {
  role: string;
  farm: string | null;
  email: string;
  orders: OrderWithItems[];
  batches: Batch[];
  shipments: Shipment[];
  settings: Settings;
  today: string;
  now: Date;
}

const FLOWER_ORDER: string[] = [FLOWER_TYPES.ROSE, FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.EUSTOMA];

/** Склад, который видит роль: офис — «office», остальные — основной. */
export function dayStoreOf(role: string): StoreCode {
  return isOfficeRole(role) ? "office" : "";
}

/** Заявки, которые видит этот склад: офис — только офисные, зав. складом — не офисные и только свой цветок. */
export function dayOrdersFor(input: Pick<WarehouseDayInput, "role" | "farm" | "email" | "orders">): OrderWithItems[] {
  if (isOfficeRole(input.role)) return inStore(input.orders, "office").filter((o) => o.items.length > 0);
  return input.orders
    .filter((o) => !isOffice(o))
    .map((o) => {
      const scope = farmScopeFor({ role: input.role, farm: input.farm, order: o, email: input.email });
      if (!scope) return o;
      return { ...o, items: o.items.filter((i) => getFarmFor(i.flowerType) === scope) };
    })
    .filter((o) => o.items.length > 0);
}

/** Партии этого склада: офис — офисные, зав. складом — основные своего цветка. Только с остатком. */
export function dayBatchesFor(input: Pick<WarehouseDayInput, "role" | "farm" | "batches">): Batch[] {
  const store = dayStoreOf(input.role);
  return inStore(input.batches, store).filter(
    (b) => b.quantityRemaining > 0 && (!input.farm || store === "office" || getFarmFor(b.flowerType) === input.farm)
  );
}

function remaining(o: OrderWithItems): number {
  return o.items.reduce((s, i) => s + Math.max(0, i.quantity - i.shippedQuantity), 0);
}

function linesOf(o: OrderWithItems): string {
  return o.items
    .map((i) => `${i.variety} ${formatGrade(i.grade)} — ${Math.max(0, i.quantity - i.shippedQuantity).toLocaleString("ru-RU")}`)
    .join(" · ");
}

function deliveryLabel(day: string, today: string, tomorrow: string): string {
  if (!day) return "без даты";
  if (day === today) return "сегодня";
  if (day === tomorrow) return "завтра";
  return formatDay(day);
}

/** Почему заявку можно собирать — одним словом рядом с кнопкой. */
export function readyLabel(o: OrderWithItems): string {
  if (isRetailOrder(o)) return `готова · ${retailLabel(o.retail)}`;
  if (isRegionOrder(o)) return "готова · объём на город";
  if (isConsignment(o)) return "готова · на реализацию";
  if (shipsOnCredit(o)) return `готова · в долг · ${String(o.clientPaymentTerms ?? "").trim()}`;
  return "готова · оплачена";
}

function noteOf(o: OrderWithItems, store: StoreCode): string {
  if (isRetailOrder(o)) return "наш магазин";
  if (isRegionOrder(o)) return "объём на город";
  if (store === "office" && o.clientPhone) return o.clientPhone;
  return "";
}

export function buildWarehouseDay(input: WarehouseDayInput): WarehouseDay {
  const store = dayStoreOf(input.role);
  const today = input.today;
  const tomorrow = new Date(`${today}T00:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowKey = tomorrow.toISOString().slice(0, 10);

  const orders = dayOrdersFor(input);
  const stageOf = (o: OrderWithItems) => orderStage(o, today);
  const pending = orders
    .filter((o) => {
      const k = stageOf(o).key;
      return k !== "shipped" && k !== "cancelled";
    })
    .sort(byUrgency(stageOf));

  const queueRow = (o: OrderWithItems): DayQueueRow => {
    const day = String(o.deliveryDate || "").slice(0, 10);
    return {
      orderId: o.orderId,
      code: orderCode(o.orderId),
      client: o.clientName || "—",
      note: noteOf(o, store),
      lines: linesOf(o),
      stems: remaining(o),
      delivery: deliveryLabel(day, today, tomorrowKey),
      lateDays: stageOf(o).lateDays,
      ready: readyLabel(o),
      href: `/warehouse/ship/${encodeURIComponent(o.orderId)}`,
    };
  };
  const ready = pending.filter((o) => isReadyToShip(o));
  const grouped = new Map<DeliveryGroupKey, DayQueueRow[]>();
  for (const o of ready) {
    const k = deliveryGroup(o.deliveryDate, today);
    grouped.set(k, [...(grouped.get(k) ?? []), queueRow(o)]);
  }
  const later = grouped.get("later") ?? [];
  const late = grouped.get("late") ?? [];
  const todayRows = grouped.get("today") ?? [];

  const waiting: DayWaitingRow[] = pending
    .filter((o) => !isReadyToShip(o))
    .map((o) => ({
      orderId: o.orderId,
      code: orderCode(o.orderId),
      client: o.clientName || "—",
      delivery: deliveryLabel(String(o.deliveryDate || "").slice(0, 10), today, tomorrowKey),
      reason: notReadyReason(o),
      lateDays: stageOf(o).lateDays,
      href: `/orders/${encodeURIComponent(o.orderId)}`,
    }));

  // Склад: доли по сроку хранения на каждую ростовку/категорию, порядок — как думает владелец (`compareGrades`).
  const batches = dayBatchesFor(input);
  const infos: BatchStorageInfo[] = batches.map((b) => computeBatchStorageInfo(b, input.settings, input.now));
  const byGrade = new Map<string, { flowerType: string; grade: string; qty: Record<StorageStatus, number> }>();
  for (const i of infos) {
    const key = `${i.batch.flowerType}:${i.batch.grade.trim().toLowerCase()}`;
    const g = byGrade.get(key) ?? { flowerType: i.batch.flowerType, grade: i.batch.grade, qty: { ok: 0, warning: 0, critical: 0, depleted: 0 } };
    g.qty[i.status] += i.batch.quantityRemaining;
    byGrade.set(key, g);
  }
  const grades: DayGradeLine[] = Array.from(byGrade.entries())
    .map(([key, g]) => {
      const total = g.qty.ok + g.qty.warning + g.qty.critical;
      return {
        key,
        label: `${FLOWER_TYPE_LABELS[g.flowerType] ?? g.flowerType} ${formatGrade(g.grade)}`.trim(),
        qty: total,
        ok: total > 0 ? g.qty.ok / total : 0,
        warning: total > 0 ? g.qty.warning / total : 0,
        critical: total > 0 ? g.qty.critical / total : 0,
        flowerType: g.flowerType,
        grade: g.grade,
      };
    })
    .sort(
      (a, b) =>
        FLOWER_ORDER.indexOf(a.flowerType) - FLOWER_ORDER.indexOf(b.flowerType) ||
        compareGrades(a.flowerType, a.grade, b.grade)
    )
    .map(({ flowerType: _f, grade: _g, ...line }) => line);

  const stockStems = infos.reduce((s, i) => s + i.batch.quantityRemaining, 0);
  const criticalStems = infos.filter((i) => i.status === "critical").reduce((s, i) => s + i.batch.quantityRemaining, 0);
  const warningStems = infos.filter((i) => i.status === "warning").reduce((s, i) => s + i.batch.quantityRemaining, 0);

  // «Хватит на»: отгрузки последних 7 дней из партий этого склада, запас — без просроченного (как в `stock.ts`).
  const weekAgo = new Date(`${today}T00:00:00Z`);
  weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);
  const weekAgoKey = weekAgo.toISOString().slice(0, 10);
  const scopeIds = new Set(inStore(input.batches, store).filter((b) => !input.farm || store === "office" || getFarmFor(b.flowerType) === input.farm).map((b) => b.batchId));
  const shipped7 = input.shipments
    .filter((sh) => (sh.createdAt || "").slice(0, 10) >= weekAgoKey && scopeIds.has(sh.batchId))
    .reduce((s, sh) => s + sh.quantity, 0);
  const coverDays = shipped7 > 0 ? Math.max(0, stockStems - criticalStems) / (shipped7 / 7) : null;

  // Принято сегодня — только основной склад: в офис цветок приходит перемещением, не приёмкой.
  const dupes = likelyDuplicates(input.batches);
  const received: DayReceivedRow[] =
    store === "office"
      ? []
      : receivedOn(
          input.batches.filter((b) => !input.farm || getFarmFor(b.flowerType) === input.farm),
          today
        ).map((b) => ({
          batchId: b.batchId,
          label: `${FLOWER_TYPE_LABELS[b.flowerType] ?? b.flowerType} ${b.variety} ${formatGrade(b.grade)}`.trim(),
          qty: b.quantityIn,
          time: timeOf(b.receivedAt),
          duplicate: dupes.has(b.batchId),
        }));

  return {
    store,
    tiles: {
      todayOrders: todayRows.length,
      todayStems: todayRows.reduce((s, r) => s + r.stems, 0),
      late: late.length,
      lateStems: late.reduce((s, r) => s + r.stems, 0),
      waiting: waiting.length,
      stockStems,
      criticalStems,
      warningStems,
      coverDays,
    },
    queue: {
      late,
      today: todayRows,
      tomorrow: grouped.get("tomorrow") ?? [],
      laterCount: later.length,
      laterStems: later.reduce((s, r) => s + r.stems, 0),
      nodateCount: (grouped.get("nodate") ?? []).length,
    },
    waiting,
    grades,
    received,
  };
}

/** «07:20» из отметки приёмки; пусто — если времени нет. */
function timeOf(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime()) || !/\d{2}:\d{2}/.test(raw)) return "";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" }).format(d);
}
