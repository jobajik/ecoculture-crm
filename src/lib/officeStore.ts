import { planWriteoffs, type WriteoffBatch, type WriteoffPlan } from "./writeoffPlan";

// ---------------------------------------------------------------------------
// Подсклад «Офис» (владелец, 02.10.2026): «РОП перемещает цветы на склад в
// офисе и оттуда реализует. В основном оттуда будет продавать бот, когда
// заявки после 12:00 — у нас заявки только до 12:00. Руслан, зав. складом, —
// фактически отгружает клиентам с подсклада». Решения владельца: Руслан видит
// ВСЕ цветы, но только офис; из офиса отгружаются заявки бота после 12:00 и те,
// где менеджер или РОП сами выбрали «Офис»; доставка — такси/inDriver за счёт
// клиента; РОП может вернуть цветок обратно на основной склад.
//
// Устройство:
// - партия знает свой склад (`Store`: пусто — основной, «office» — офис);
// - перемещение в офис ОТРЕЗАЕТ стебли от основной партии в офисную партию той
//   же срезки (`SourceBatchID` — откуда). У офисной партии приход НОЛЬ: стебли
//   уже приняты один раз, и вся аналитика прихода (`quantityIn`) остаётся
//   верной без единой правки. Остатки обоих складов вместе = прежний склад;
// - возврат кладёт стебли обратно в ту же основную партию;
// - заявка знает свой склад (`Store` в Orders); отгружают её только партиями
//   того же склада и только тот, кто ведёт этот склад.
// Чистые правила — здесь (грабли 1.11), проверка `scripts/check-office.ts`.
// ---------------------------------------------------------------------------

export const OFFICE_STORE = "office";
export type StoreCode = "" | "office";

export const STORE_LABELS: Record<StoreCode, string> = { "": "Основной склад", office: "Офис" };

export function storeLabel(store: string | null | undefined): string {
  return STORE_LABELS[normalizeStore(store)];
}

/** Любое присланное значение → «» или «office». Чужое — основной склад. */
export function normalizeStore(raw: unknown): StoreCode {
  return String(raw ?? "").trim().toLowerCase() === OFFICE_STORE ? OFFICE_STORE : "";
}

export const isOffice = (x: { store?: string | null }) => normalizeStore(x.store) === OFFICE_STORE;

/** Только то, что лежит (или отгружается) на этом складе. */
export function inStore<T extends { store?: string | null }>(list: T[], store: StoreCode): T[] {
  return list.filter((x) => normalizeStore(x.store) === store);
}

/** Склад офиса — и в чистом виде, и вместе с розницей Алматы (Руслан). */
export const isOfficeRole = (role: string | null | undefined) => role === "office" || role === "office_retail";

/** Чей склад: зав. складом — основной, склад офиса — офис, админ — оба, остальные — никакой. */
export function storeOfRole(role: string | null | undefined): StoreCode | "any" | null {
  if (isOfficeRole(role)) return OFFICE_STORE;
  if (role === "warehouse") return "";
  if (role === "admin") return "any";
  return null;
}

/** Какой склад показывать роли на главной: свой у склада и склада офиса, остальным — оба вместе. */
export function stockStoreOfRole(role: string | null | undefined): StoreCode | undefined {
  const own = storeOfRole(role);
  return own === "" || own === OFFICE_STORE ? own : undefined;
}

/** Перемещает между складами РОП (решение владельца) и админ. */
export const canMoveStock = (role: string | null | undefined) => role === "sales_head" || role === "admin";

/** Раздел «Офис» видят склад офиса, РОП и админ. */
export const canSeeOffice = (role: string | null | undefined) =>
  isOfficeRole(role) || role === "sales_head" || role === "admin";

/** Кто выбирает склад в клиентской заявке. */
export const canChooseOrderStore = (role: string | null | undefined) =>
  role === "manager" || role === "sales_head" || role === "admin";

/** Может ли этот человек отгружать заявку этого склада. Пусто — может. */
export function shipStoreRefusal(role: string | null | undefined, orderStore: string | null | undefined): string {
  const own = storeOfRole(role);
  const store = normalizeStore(orderStore);
  if (own === "any") return "";
  if (own === null) return "Недостаточно прав: отгружает склад";
  if (own === store) return "";
  return store === OFFICE_STORE
    ? "Эта заявка отгружается из офиса — её собирает склад офиса"
    : "Эта заявка с основного склада — склад офиса её не отгружает";
}

/** Партия обязана лежать на складе заявки. Пусто — лежит. */
export function batchStoreRefusal(batchStore: string | null | undefined, orderStore: string | null | undefined): string {
  if (normalizeStore(batchStore) === normalizeStore(orderStore)) return "";
  return normalizeStore(orderStore) === OFFICE_STORE
    ? "партия лежит на основном складе, а заявка — из офиса"
    : "партия лежит в офисе, а заявка — с основного склада";
}

/** С этого часа (по Алматы) основной склад заявки не принимает — бот продаёт из офиса. */
export const OFFICE_FROM_HOUR = 12;

/**
 * Склад, с которого бот продаёт сейчас: до 12:00 — основной, после — офис.
 * Офис пуст — продаём с основного (на завтра), чтобы не терять клиента.
 */
export function botStoreFor(almatyHour: number, officeHasStock: boolean): StoreCode {
  return almatyHour >= OFFICE_FROM_HOUR && officeHasStock ? OFFICE_STORE : "";
}

/** Час по Алматы (0–23). */
export function almatyHourOf(d: Date): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "numeric", hour12: false }).format(d);
  return Number(h) % 24;
}

/**
 * Склад заказа бота: после 12:00 заказ НА СЕГОДНЯ собирается в офисе (если там
 * есть живой цветок), всё остальное — основной склад, как раньше.
 */
export function botOrderStore(input: { almatyHour: number; deliveryDate: string; today: string; officeHasStock: boolean }): StoreCode {
  return input.deliveryDate === input.today ? botStoreFor(input.almatyHour, input.officeHasStock) : "";
}

/** Что сказать модели о складах. После 12:00 у неё два списка: «сегодня из офиса» и «на завтра». */
export function botStoreNote(officeToday: boolean, almatyHour: number): string {
  if (officeToday) {
    return (
      "Сейчас после 12:00. Заказ на СЕГОДНЯ — только из списка «Сегодня, из офиса»: отправляем такси или inDriver, " +
      "доставку оплачивает клиент. Чего нет в офисе — предлагай на завтра из списка «На завтра и позже»."
    );
  }
  if (almatyHour >= OFFICE_FROM_HOUR) {
    return "Заказы на сегодня принимаем до 12:00 — сейчас оформляй доставку на завтра.";
  }
  return "";
}

/**
 * Поменять склад у оформленной заявки: только клиентская (не наш магазин, не
 * объём на город), не отменена и ещё ничего не отгружено — иначе часть уехала
 * бы с одного склада, часть с другого. Кто ведёт заявку (менеджер, РОП, админ)
 * и склад офиса (когда в офисе не хватило — отдать на основной).
 */
export function storeChangeRefusal(input: {
  role: string;
  isOwner: boolean;
  order: { status: string; kind: string; retail: string; store: string; items: { shippedQuantity: number }[] };
  to: string;
}): string {
  const { role, isOwner, order } = input;
  const to = normalizeStore(input.to);
  if (normalizeStore(order.store) === to) return "Заявка уже на этом складе";
  if (!(role === "admin" || role === "sales_head" || isOfficeRole(role) || (role === "manager" && isOwner))) {
    return "Склад заявки меняет её менеджер, РОП или склад офиса";
  }
  // Склад офиса только ОТДАЁТ свою заявку на основной (в офисе не хватило) —
  // забрать себе чужую основную заявку он не может.
  if (isOfficeRole(role) && !(normalizeStore(order.store) === OFFICE_STORE && to === "")) {
    return "Склад офиса может только отдать офисную заявку на основной склад";
  }
  if (order.kind || order.retail) return "Склад выбирается только у заявки клиенту";
  if (order.status === "cancelled") return "Заявка отменена";
  if (order.items.some((i) => i.shippedQuantity > 0)) return "По заявке уже есть отгрузка — склад не меняется";
  return "";
}

// --- Перемещение ---------------------------------------------------------------

export type MoveDirection = "to_office" | "to_main";

export interface MoveLine {
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
}

/**
 * Раскладка перемещения по партиям склада, ОТКУДА везём: от старой срезки к
 * свежей, всё или ничего — то же правило, что у списания общим количеством
 * (`planWriteoffs`), поэтому и ошибки там те же самые.
 */
export function planStockMove(lines: MoveLine[], fromBatches: WriteoffBatch[]): WriteoffPlan {
  return planWriteoffs({ lines: lines.map((l) => ({ ...l, reason: "" })), batches: fromBatches, farm: null });
}

export interface MoveBatchRow {
  rowNumber: number;
  batchId: string;
  receivedAt: string;
  harvestDate: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantityRemaining: number;
  store: string;
  sourceBatchId: string;
}

export interface MoveWrites {
  /** Новые остатки партий: строка → остаток. */
  updates: { rowNumber: number; quantityRemaining: number }[];
  /** Новые офисные партии (записи вкладки Batches). */
  appends: Record<string, unknown>[];
  /** По строке журнала на партию. */
  moves: { fromBatchId: string; toBatchId: string; quantity: number; flowerType: string; variety: string; grade: string }[];
  error: string;
}

/**
 * Что записать по раскладке. В офис: основная партия убывает, офисная партия
 * той же основной (уже есть — прибавляем, нет — заводим) растёт. Обратно:
 * офисная убывает, её основная растёт. Ничего не пишет — только считает.
 */
export function moveWrites(input: {
  direction: MoveDirection;
  parts: { batchId: string; quantity: number }[];
  rows: MoveBatchRow[];
  byEmail: string;
  newId: () => string;
}): MoveWrites {
  const out: MoveWrites = { updates: [], appends: [], moves: [], error: "" };
  const remaining = new Map(input.rows.map((r) => [r.batchId, r.quantityRemaining]));
  const byId = new Map(input.rows.map((r) => [r.batchId, r]));
  const created = new Map<string, Record<string, unknown>>(); // основная партия → новая офисная
  const fail = (error: string): MoveWrites => ({ updates: [], appends: [], moves: [], error });

  for (const part of input.parts) {
    const from = byId.get(part.batchId);
    const qty = Math.round(Number(part.quantity));
    if (!from) return fail(`партия ${part.batchId} не найдена`);
    if (!(qty > 0)) continue;
    const fromStore = normalizeStore(from.store);
    if (input.direction === "to_office" ? fromStore !== "" : fromStore !== OFFICE_STORE) {
      return fail(`партия ${part.batchId} лежит не на том складе`);
    }
    const left = remaining.get(from.batchId) ?? 0;
    if (left < qty) return fail(`в партии ${from.batchId} осталось ${left} шт., а перемещается ${qty}`);
    remaining.set(from.batchId, left - qty);

    let toId: string;
    if (input.direction === "to_office") {
      const office = input.rows.find((r) => normalizeStore(r.store) === OFFICE_STORE && r.sourceBatchId === from.batchId);
      if (office) {
        toId = office.batchId;
        remaining.set(office.batchId, (remaining.get(office.batchId) ?? 0) + qty);
      } else {
        const fresh = created.get(from.batchId);
        if (fresh) {
          fresh.QuantityRemaining = Number(fresh.QuantityRemaining) + qty;
          toId = String(fresh.BatchID);
        } else {
          toId = input.newId();
          created.set(from.batchId, {
            BatchID: toId,
            ReceivedAt: from.receivedAt,
            HarvestDate: from.harvestDate,
            FlowerType: from.flowerType,
            Variety: from.variety,
            Grade: from.grade,
            // Приход ноль: стебли уже приняты основной партией (см. шапку файла).
            QuantityIn: 0,
            QuantityRemaining: qty,
            Location: "Офис",
            ReceivedByEmail: input.byEmail,
            Store: OFFICE_STORE,
            SourceBatchID: from.batchId,
          });
        }
      }
    } else {
      const main = byId.get(from.sourceBatchId);
      if (!main || normalizeStore(main.store) !== "") {
        return fail(`не нашлась основная партия, из которой пришла ${from.batchId}`);
      }
      toId = main.batchId;
      remaining.set(main.batchId, (remaining.get(main.batchId) ?? 0) + qty);
    }
    out.moves.push({ fromBatchId: from.batchId, toBatchId: toId, quantity: qty, flowerType: from.flowerType, variety: from.variety, grade: from.grade });
  }

  for (const r of input.rows) {
    const now = remaining.get(r.batchId) ?? r.quantityRemaining;
    if (now !== r.quantityRemaining) out.updates.push({ rowNumber: r.rowNumber, quantityRemaining: now });
  }
  out.appends = Array.from(created.values());
  return out;
}
