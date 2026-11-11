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
/**
 * Региональный склад «Астана» (02.11.2026, владелец: «перемещение с основного склада в регион — это количество должно
 * списываться с нашего остатка и поступать на остаток склада Астаны; заявки через чат-бот после отправки — с остатков
 * Астаны»). Решения владельца: на склад Астаны цветок попадает ОТГРУЗКОЙ «объёма на город» (`regionArrivalWrites`),
 * ведёт склад менеджер Астаны (Салтанат — по городу в `ManagerProfiles`), со склада Астаны — любая заявка клиенту
 * Астаны, пока там есть товар; прайс общий.
 */
export const ASTANA_STORE = "astana";
export type StoreCode = "" | "office" | "astana";

export const STORE_LABELS: Record<StoreCode, string> = { "": "Основной склад", office: "Офис", astana: "Астана" };

/** Региональные склады: код, подпись и как пишут город (карточка клиента, направление заявки, профиль менеджера). */
export const REGION_STORES: { code: StoreCode; label: string; cities: string[] }[] = [
  { code: ASTANA_STORE, label: "Астана", cities: ["астана", "нур-султан", "нурсултан", "нур султан", "astana"] },
];

const cityKey = (city: string | null | undefined) => String(city ?? "").trim().toLowerCase().replace(/ё/g, "е").replace(/^г\.?\s*/, "");

/** Склад региона по городу; не региональный город — «» (основной). */
export function regionStoreForCity(city: string | null | undefined): StoreCode {
  const k = cityKey(city);
  if (!k) return "";
  return REGION_STORES.find((r) => r.cities.includes(k))?.code ?? "";
}

export const isRegionStore = (store: string | null | undefined) => REGION_STORES.some((r) => r.code === normalizeStore(store));

export function storeLabel(store: string | null | undefined): string {
  return STORE_LABELS[normalizeStore(store)];
}

/** Любое присланное значение → «», «office» или код регионального склада. Чужое — основной склад. */
export function normalizeStore(raw: unknown): StoreCode {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === OFFICE_STORE) return OFFICE_STORE;
  if (REGION_STORES.some((r) => r.code === v)) return v as StoreCode;
  return "";
}

export const isOffice = (x: { store?: string | null }) => normalizeStore(x.store) === OFFICE_STORE;
/** Лежит или отгружается с основного склада. */
export const isMainStore = (x: { store?: string | null }) => normalizeStore(x.store) === "";

/** Только то, что лежит (или отгружается) на этом складе. */
export function inStore<T extends { store?: string | null }>(list: T[], store: StoreCode): T[] {
  return list.filter((x) => normalizeStore(x.store) === store);
}

/** Склад офиса — и в чистом виде, и вместе с розницей Алматы (Руслан). */
export const isOfficeRole = (role: string | null | undefined) => role === "office" || role === "office_retail";

/**
 * Чей склад: зав. складом — основной, склад офиса — офис, менеджер региона со своим складом (`regionStore`, по городу
 * профиля) — его региональный склад, админ — любой, остальные — никакой.
 */
export function storeOfRole(role: string | null | undefined, regionStore: StoreCode = ""): StoreCode | "any" | null {
  if (isOfficeRole(role)) return OFFICE_STORE;
  if (role === "warehouse") return "";
  if (role === "admin") return "any";
  if (role === "manager" && isRegionStore(regionStore)) return regionStore;
  return null;
}

/** Какой склад показывать роли на главной: свой у склада, склада офиса и менеджера региона, остальным — все вместе. */
export function stockStoreOfRole(role: string | null | undefined, regionStore: StoreCode = ""): StoreCode | undefined {
  const own = storeOfRole(role, regionStore);
  return own === "any" || own === null ? undefined : own;
}

/** Перемещает между складами РОП (решение владельца) и админ. */
export const canMoveStock = (role: string | null | undefined) => role === "sales_head" || role === "admin";

/**
 * Зав. складом тоже может ОТДАТЬ цветок в офис, но только свой (09.11.2026, Разия: «субботу күні склад
 * офисқа эустома пен хризантема жібердім, CRM-де Офис склад деген жоқ» — отправила в офис по факту, а записать было
 * некуда, и владелец переносил руками). С 11.11.2026 она же ВОЗВРАЩАЕТ свой цветок из офиса на основной склад: РОП
 * ушёл (владелец: «дай зав. складам возможность сажать регионы и прочее» — за 45 дней РОП сделала 17 перемещений в офис
 * и 8 возвратов), и вернуть стало некому, кроме админа. Чужой цветок — по-прежнему нельзя (грабли 1.1-ter).
 * Пусто — можно; иначе — почему нельзя.
 */
export function moveRefusal(
  role: string | null | undefined,
  farm: string | null | undefined,
  direction: MoveDirection,
  lines: { flowerType: string }[],
  farmFlowers: (farm: string | null | undefined) => string[]
): string {
  if (canMoveStock(role)) return "";
  if (role !== "warehouse") return "Перемещает цветок между складами РОП или администратор";
  if (direction !== "to_office" && direction !== "to_main") return "Зав. складом перемещает цветок только между основным складом и офисом";
  if (!farm) return "У вас не указано производство — перемещать нельзя";
  const own = new Set(farmFlowers(farm));
  const alien = lines.find((l) => !own.has(l.flowerType));
  if (alien) return direction === "to_office" ? "В офис можно отдать только цветок своего производства" : "Из офиса можно вернуть только цветок своего производства";
  return "";
}
export const canMoveToOffice = (role: string | null | undefined) => canMoveStock(role) || role === "warehouse";

/** Раздел «Офис» видят склад офиса, РОП и админ. */
export const canSeeOffice = (role: string | null | undefined) =>
  isOfficeRole(role) || role === "sales_head" || role === "admin";

/** Кто выбирает склад в клиентской заявке. */
export const canChooseOrderStore = (role: string | null | undefined) =>
  role === "manager" || role === "sales_head" || role === "admin";

/** Может ли этот человек отгружать заявку этого склада. Пусто — может. */
export function shipStoreRefusal(role: string | null | undefined, orderStore: string | null | undefined, regionStore: StoreCode = ""): string {
  const own = storeOfRole(role, regionStore);
  const store = normalizeStore(orderStore);
  if (own === "any") return "";
  if (own === null) return "Недостаточно прав: отгружает склад";
  if (own === store) return "";
  if (store === OFFICE_STORE) return "Эта заявка отгружается из офиса — её собирает склад офиса";
  if (isRegionStore(store)) return `Эта заявка со склада «${storeLabel(store)}» — её отгружает менеджер региона`;
  return `Эта заявка с основного склада — склад «${storeLabel(own)}» её не отгружает`;
}

/** Партия обязана лежать на складе заявки. Пусто — лежит. */
export function batchStoreRefusal(batchStore: string | null | undefined, orderStore: string | null | undefined): string {
  if (normalizeStore(batchStore) === normalizeStore(orderStore)) return "";
  const where = (s: string | null | undefined) => (normalizeStore(s) === "" ? "на основном складе" : normalizeStore(s) === OFFICE_STORE ? "в офисе" : `на складе «${storeLabel(s)}»`);
  const from = (s: string | null | undefined) => (normalizeStore(s) === "" ? "с основного склада" : normalizeStore(s) === OFFICE_STORE ? "из офиса" : `со склада «${storeLabel(s)}»`);
  return `партия лежит ${where(batchStore)}, а заявка — ${from(orderStore)}`;
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
      "доставку оплачивает клиент. Чего нет в офисе, но есть в «На завтра и позже», — НЕ пиши «нет на складе» или " +
      "«закончилась»: «на сегодня уже разобрали, на завтра есть — оформить на завтра?»"
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
  if (to === OFFICE_STORE && isRegionStore(order.store)) return "Заявку регионального склада в офис не переводят — сначала на основной";
  if (order.kind || order.retail) return "Склад выбирается только у заявки клиенту";
  if (order.status === "cancelled") return "Заявка отменена";
  if (order.items.some((i) => i.shippedQuantity > 0)) return "По заявке уже есть отгрузка — склад не меняется";
  return "";
}

// --- Перемещение ---------------------------------------------------------------

/** to_region — приход на региональный склад отгрузкой «объёма на город» (`regionArrivalWrites`). */
export type MoveDirection = "to_office" | "to_main" | "to_region";

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

// --- Приход на региональный склад ------------------------------------------------

/**
 * «Объём на город» отгружен с основного склада — те же стебли приходят на склад региона (решение владельца 02.11.2026:
 * перемещение — это отгрузка объёма). Как у офиса: региональная партия — ОТРЕЗОК основной той же срезки
 * (`SourceBatchID`), приход ноль (стебли уже приняты один раз), уже есть партия региона от этой основной — прибавляем.
 * Ничего не пишет — только считает; пишет `createOrderShipments` одним запросом вместе с отгрузкой.
 */
export function regionArrivalWrites(input: {
  store: StoreCode;
  taken: { batchId: string; quantity: number }[];
  rows: MoveBatchRow[];
  byEmail: string;
  newId: () => string;
}): Omit<MoveWrites, "error"> {
  const out: Omit<MoveWrites, "error"> = { updates: [], appends: [], moves: [] };
  if (!isRegionStore(input.store)) return out;
  const byId = new Map(input.rows.map((r) => [r.batchId, r]));
  const added = new Map<number, number>(); // строка региональной партии → прибавка
  const created = new Map<string, Record<string, unknown>>();
  for (const t of input.taken) {
    const qty = Math.round(Number(t.quantity));
    const from = byId.get(t.batchId);
    if (!from || !(qty > 0)) continue;
    const existing = input.rows.find((r) => normalizeStore(r.store) === input.store && r.sourceBatchId === from.batchId);
    let toId: string;
    if (existing) {
      added.set(existing.rowNumber, (added.get(existing.rowNumber) ?? 0) + qty);
      toId = existing.batchId;
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
          QuantityIn: 0,
          QuantityRemaining: qty,
          Location: storeLabel(input.store),
          ReceivedByEmail: input.byEmail,
          Store: input.store,
          SourceBatchID: from.batchId,
        });
      }
    }
    out.moves.push({ fromBatchId: from.batchId, toBatchId: toId, quantity: qty, flowerType: from.flowerType, variety: from.variety, grade: from.grade });
  }
  for (const r of input.rows) {
    const plus = added.get(r.rowNumber);
    if (plus) out.updates.push({ rowNumber: r.rowNumber, quantityRemaining: r.quantityRemaining + plus });
  }
  out.appends = Array.from(created.values());
  return out;
}
