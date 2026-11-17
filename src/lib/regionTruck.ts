import { FLOWER_TYPES, MONEY_EPSILON, ORDER_STATUSES, ROLES, formatGrade, getGradesFor } from "./constants";
import { cleanDirection } from "./direction";
import { isNotASale, isRegionOrder } from "./orderKind";
import { isRegionStore, normalizeStore, regionStoreForCity, regionStoreInfo, type StoreCode } from "./officeStore";
import { isoWeekday, nextShipDay, type ManagerProfile } from "./managerProfile";
import { isRegionShop, isRetailOrder } from "./retail";

/**
 * Регионы: директор города, заказ на фуру, приёмка (17.11.2026).
 *
 * Владелец: «раз в неделю (понедельник или вторник) мы грузим фуры в регионы, куда едут цветы на ритейл и опт. Хотим
 * подключить директоров региона Караганда, Астана, Семей и Усть-Каменогорск, где будем отслеживать стоки, делать заказ на
 * эти регионы и другие манипуляции. Каждый директор магазина там будет сидеть». Его решения: директор ведёт склад и
 * продаёт; заказ на фуру подаёт директор, грузит склад; приёмку подтверждает директор; видит цены, заявки, оплаты и
 * долги своего города (только смотрит — оплаты остаются у бухгалтера).
 *
 * Что было в живой базе (`scripts/diag-region-trucks.ts`): за 5 недель в каждый из четырёх городов — 10–15 заявок
 * «объём на город» (опт) и, кроме Караганды, 5–6 заявок в карточку «Розница, <город>» (наши магазины), все на
 * понедельник-вторник; заводили их зав. складом и РОП. На складе Астаны накопилось 26 715 стеблей при одной заявке с
 * него — цветок приходил туда в момент отгрузки и никем не списывался.
 *
 * Устройство:
 * - **директор** — тот же менеджер, посаженный в город (`ManagerProfiles`: город, день фуры) с флагом `director`.
 *   Отдельной роли нет: он продаёт клиентам, ведёт лидов и переписку как менеджер. Склад города ведёт любой, кто
 *   посажен в город (как Салтанат с 02.11), директор сверх того подаёт заказ на фуру и видит деньги города;
 * - **заказ на фуру** — одна форма, строки «сорт — длина — на опт — в магазины». На деле это ДВЕ привычные складу
 *   заявки: «объём на город» (опт, без цен — ляжет на склад города) и заявка в карточку розницы города (в магазины, по
 *   внутреннему прайсу). Обе подтверждены сразу: директор подал — склад грузит;
 * - **приёмка**: отгруженное складом — «в пути». Директор вводит, сколько приехало по каждой позиции; принятый опт
 *   ложится на склад города (партии-отрезки основных, `regionArrivalWrites`), недостача остаётся записью с причиной.
 *   Раньше (Астана, 02–16.11) цветок попадал на склад города в момент отгрузки — такие отгрузки считаются принятыми;
 * - приёмка ведётся с фуры 16.11.2026 (`REGION_ACCEPT_FROM`): более старые отгрузки в три новых города на остаток
 *   не попадут, даже если их никто не принимал.
 *
 * Модуль чистый — проверка `scripts/check-region-truck.ts`; запись — `repo/regionTruck.ts`.
 */

/** С какой фуры (по дню отгрузки заявки) ведётся приёмка. */
export const REGION_ACCEPT_FROM = "2026-11-16";

// --- Кто что может ---------------------------------------------------------------------

export interface RegionActor {
  role: string | null | undefined;
  /** Склад региона, куда посажен менеджер (`session.user.store`). */
  store?: string | null;
  /** Директор этого региона (`session.user.director`). */
  director?: boolean;
}

export interface RegionAccess {
  /** Открывает раздел этого города. */
  view: boolean;
  /** Ведёт склад города: отгружает клиентам, списывает, пересчитывает. */
  keeper: boolean;
  /** Подаёт заказ на фуру и отменяет его, пока не начали грузить. */
  order: boolean;
  /** Подтверждает приёмку фуры. */
  accept: boolean;
  /** Видит заявки, оплаты и долги города. */
  money: boolean;
  /** Видит все города (переключатель городов). */
  all: boolean;
}

const NOTHING: RegionAccess = { view: false, keeper: false, order: false, accept: false, money: false, all: false };

/** Права в разделе города. Чужой город и незнакомая роль — ничего (грабли 1.10). */
export function regionAccess(actor: RegionActor, pageStore: string | null | undefined): RegionAccess {
  const store = normalizeStore(pageStore);
  if (!isRegionStore(store)) return NOTHING;
  if (actor.role === ROLES.ADMIN) return { view: true, keeper: true, order: true, accept: true, money: true, all: true };
  // РОП заводила объём на города и раньше; оплаты и долги смотрит — как в «Деньгах».
  if (actor.role === ROLES.SALES_HEAD) return { ...NOTHING, view: true, order: true, money: true, all: true };
  // Зав. складом видит, что заказали и что принял город; чужие деньги её не касаются.
  if (actor.role === ROLES.WAREHOUSE) return { ...NOTHING, view: true, all: true };
  if (actor.role === ROLES.MANAGER && normalizeStore(actor.store) === store) {
    const director = actor.director === true;
    return { view: true, keeper: true, order: director, accept: true, money: director, all: false };
  }
  return NOTHING;
}

/** Видит ли человек раздел «Регионы» вообще (для меню и обзора). */
export function regionHome(actor: RegionActor): { all: boolean; own: StoreCode } {
  const all = actor.role === ROLES.ADMIN || actor.role === ROLES.SALES_HEAD || actor.role === ROLES.WAREHOUSE;
  const own = actor.role === ROLES.MANAGER && isRegionStore(actor.store) ? normalizeStore(actor.store) : "";
  return { all, own };
}

// --- Кто сидит в городе ----------------------------------------------------------------

export interface RegionSeat {
  store: StoreCode;
  /** Почты директоров города (обычно один). */
  directors: string[];
  /** Менеджеры города без флага директора (ведут склад, как Салтанат). */
  managers: string[];
  /** День фуры: 1 — понедельник … 7; по директору, нет — по менеджеру города, нет — понедельник. */
  truckWeekday: number;
}

export const DEFAULT_TRUCK_WEEKDAY = 1;

export function regionSeat(profiles: Record<string, ManagerProfile>, store: StoreCode): RegionSeat {
  const seated = Object.entries(profiles).filter(([, p]) => regionStoreForCity(p.city) === store);
  const directors = seated.filter(([, p]) => p.director).map(([email]) => email);
  const managers = seated.filter(([, p]) => !p.director).map(([email]) => email);
  const day = seated.find(([, p]) => p.director && p.shipWeekday)?.[1].shipWeekday ?? seated.find(([, p]) => p.shipWeekday)?.[1].shipWeekday ?? DEFAULT_TRUCK_WEEKDAY;
  return { store, directors, managers, truckWeekday: day };
}

/** Ближайший день фуры города. */
export function nextTruckDay(today: string, weekday: number, almatyHour: number): string {
  return nextShipDay(today, weekday >= 1 && weekday <= 7 ? weekday : DEFAULT_TRUCK_WEEKDAY, almatyHour);
}

/**
 * Назначить директора города (чистая правка сырого объекта настройки — неизвестные поля профилей не теряются).
 * `email` пуст — снять директора. Прежний директор города остаётся менеджером без города (стиль продавца и род — его).
 * День фуры — города: ставится всем, кто в нём сидит.
 */
export function setRegionDirector(
  raw: Record<string, Record<string, unknown>>,
  input: { store: StoreCode; email: string; weekday: number }
): Record<string, Record<string, unknown>> {
  const info = regionStoreInfo(input.store);
  if (!info) throw new Error("Город не из списка регионов");
  const weekday = Number.isInteger(input.weekday) && input.weekday >= 1 && input.weekday <= 7 ? input.weekday : DEFAULT_TRUCK_WEEKDAY;
  const email = input.email.trim().toLowerCase();
  const seatedHere = Object.values(raw).some((v) => v && typeof v === "object" && regionStoreForCity(typeof v.city === "string" ? v.city : "") === input.store);
  if (!email && !seatedHere) throw new Error("Сначала выберите директора: день фуры хранится в его профиле");
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(raw)) {
    const p = { ...(value && typeof value === "object" ? value : {}) };
    const here = regionStoreForCity(typeof p.city === "string" ? p.city : "") === input.store;
    if (here && p.director === true && key.trim().toLowerCase() !== email) {
      // Прежний директор: из города снимаем целиком — иначе он остался бы «менеджером города» со складом.
      p.director = false;
      p.city = "";
      p.shipWeekday = null;
    } else if (here) {
      p.shipWeekday = weekday;
    }
    out[key] = p;
  }
  if (email) {
    const key = Object.keys(out).find((k) => k.trim().toLowerCase() === email) ?? email;
    out[key] = { female: false, closer: false, ...(out[key] ?? {}), city: info.label, shipWeekday: weekday, director: true };
  }
  return out;
}

// --- Заказ на фуру ---------------------------------------------------------------------

export interface TruckLineInput {
  flowerType: string;
  variety: string;
  grade: string;
  /** На опт — на склад города. */
  wholesale: number;
  /** В наши магазины города. */
  retail: number;
}

export interface TruckItem {
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
}

const MAX_LINE = 500_000;
const FLOWERS = new Set<string>(Object.values(FLOWER_TYPES));

/** Почему заказ на фуру принять нельзя. Пусто — можно. Проверка сервера (грабли 1.11). */
export function truckOrderRefusal(input: {
  access: RegionAccess;
  deliveryDate: string;
  today: string;
  lines: TruckLineInput[];
  /** Есть ли у города действующая карточка розницы. */
  hasRetailCard: boolean;
}): string {
  if (!input.access.order) return "Заказ на фуру подаёт директор региона";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate) || Number.isNaN(Date.parse(`${input.deliveryDate}T00:00:00Z`))) return "Укажите день, когда уходит фура";
  if (input.deliveryDate < input.today) return "День фуры уже прошёл";
  const lines = input.lines ?? [];
  let any = false;
  for (const l of lines) {
    const name = `${(l.variety || "").trim() || "позиция"} ${formatGrade(l.grade || "")}`.trim();
    for (const q of [l.wholesale, l.retail]) {
      if (!Number.isFinite(q) || q < 0) return `${name}: количество не может быть меньше нуля`;
      if (!Number.isInteger(q)) return `${name}: количество считается в стеблях, целым числом`;
      if (q > MAX_LINE) return `${name}: слишком большое количество — проверьте цифру`;
    }
    if (l.wholesale + l.retail === 0) continue;
    any = true;
    if (!FLOWERS.has(l.flowerType)) return "Выберите цветок из списка";
    if (!(l.variety || "").trim()) return "У каждой позиции должен быть выбран сорт";
    if (!getGradesFor(l.flowerType as never).includes(l.grade)) return `${name}: выберите длину или категорию из списка`;
    if (l.retail > 0 && !input.hasRetailCard) return "В этом городе нет карточки наших магазинов — заказ в магазины оформить не на кого";
  }
  if (!any) return "Укажите количество хотя бы по одной позиции";
  return "";
}

/** Строки формы → позиции двух заявок; одинаковые позиции складываются. */
export function splitTruckLines(lines: TruckLineInput[]): { wholesale: TruckItem[]; retail: TruckItem[] } {
  const collect = (pick: (l: TruckLineInput) => number): TruckItem[] => {
    const map = new Map<string, TruckItem>();
    for (const l of lines) {
      const quantity = pick(l);
      if (!(quantity > 0)) continue;
      const variety = l.variety.trim();
      const key = `${l.flowerType}|${variety.toLowerCase()}|${l.grade}`;
      const prev = map.get(key);
      if (prev) prev.quantity += quantity;
      else map.set(key, { flowerType: l.flowerType, variety, grade: l.grade, quantity });
    }
    return Array.from(map.values());
  };
  return { wholesale: collect((l) => l.wholesale), retail: collect((l) => l.retail) };
}

export type TruckKind = "wholesale" | "retail";

interface TruckOrderLike {
  orderId: string;
  status: string;
  kind?: string;
  retail?: string;
  direction?: string;
  clientId?: string;
  deliveryDate: string;
}

/** Это заказ на фуру в этот город? Опт — объём на город, магазины — заявка в карточку розницы города. */
export function truckKindOf(order: TruckOrderLike, store: StoreCode, retailCardIds: Set<string>): TruckKind | null {
  if (isRegionOrder(order)) return regionStoreForCity(cleanDirection(order.direction)) === store ? "wholesale" : null;
  if (isRetailOrder(order) && isRegionShop(order) && !!order.clientId && retailCardIds.has(order.clientId)) return "retail";
  return null;
}

/** Карточки розницы города: «Розница, Семей» — наш магазин направления «регионы» с городом этого склада. */
export function retailCardsOf<T extends { clientId: string; retail?: string | null; city?: string | null; active?: boolean }>(clients: T[], store: StoreCode): T[] {
  return clients.filter((c) => isRegionShop(c) && regionStoreForCity(c.city) === store);
}

/** Отменить заказ на фуру можно, пока склад ничего по нему не отгрузил. Пусто — можно. */
export function truckCancelRefusal(input: { access: RegionAccess; order: { status: string; items: { shippedQuantity: number }[] } | null; kind: TruckKind | null }): string {
  if (!input.access.order) return "Заказ на фуру отменяет директор региона";
  if (!input.order || !input.kind) return "Это не заказ на фуру этого города";
  if (input.order.status === ORDER_STATUSES.CANCELLED) return "Заказ уже отменён";
  if (input.order.items.some((i) => i.shippedQuantity > 0)) return "Склад уже начал грузить этот заказ — отменить его нельзя, позвоните на склад";
  return "";
}

// --- Приёмка ---------------------------------------------------------------------------

export interface TruckShipRow {
  orderId: string;
  itemId: string;
  batchId: string;
  quantity: number;
  createdAt: string;
}

export interface TruckMoveRow {
  direction: string;
  fromBatchId: string;
  quantity: number;
  note: string;
  createdAt: string;
}

export interface TruckReceiptRow {
  orderId: string;
  itemId: string;
  shipped: number;
  accepted: number;
  createdAt: string;
  byEmail?: string;
  note?: string;
}

export interface PendingItem {
  itemId: string;
  /** Сколько отгружено и ещё не принято. */
  quantity: number;
  /** Из каких партий основного склада это уехало (для прихода на склад города). */
  parts: { batchId: string; quantity: number }[];
}

const ms = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/** Пометка строки журнала перемещений, которую пишет приёмка (а не отгрузка — как было до 17.11.2026). */
export const RECEIPT_MOVE_PREFIX = "Приёмка фуры";

/**
 * Что по заказу отгружено и ещё не принято городом — по позициям.
 *
 * Строка отгрузки закрыта, если (а) по позиции уже была приёмка ПОЗЖЕ этой строки или (б) это старая отгрузка, при
 * которой цветок лёг на склад города сразу (так было у Астаны до 17.11.2026): в журнале перемещений есть приход из той
 * же партии с номером этой заявки — он «гасит» самые ранние отгрузки из этой партии на своё количество. Сверка идёт по
 * КОЛИЧЕСТВУ, а не по времени записи: дата в таблице может вернуться в другом виде (грабли 1.9-bis), и отгрузка, уже
 * лежащая на складе города, показалась бы «в пути» — её приняли бы второй раз. Возвраты (строки с минусом) вычитаются.
 */
export function pendingReceipt(input: {
  order: { orderId: string; status: string; deliveryDate: string };
  shipments: TruckShipRow[];
  moves: TruckMoveRow[];
  receipts: TruckReceiptRow[];
}): PendingItem[] {
  const { order } = input;
  if (order.status === ORDER_STATUSES.CANCELLED) return [];
  if (!order.deliveryDate || order.deliveryDate < REGION_ACCEPT_FROM) return [];
  // Сколько из каждой партии легло на склад города сразу при отгрузке (старое правило).
  const landedAtOnce = new Map<string, number>();
  for (const m of input.moves) {
    if (m.direction !== "to_region" || m.note.startsWith(RECEIPT_MOVE_PREFIX) || !m.note.includes(order.orderId)) continue;
    landedAtOnce.set(m.fromBatchId, (landedAtOnce.get(m.fromBatchId) ?? 0) + m.quantity);
  }
  const lastReceipt = new Map<string, number>();
  for (const r of input.receipts) {
    if (r.orderId !== order.orderId) continue;
    lastReceipt.set(r.itemId, Math.max(lastReceipt.get(r.itemId) ?? 0, ms(r.createdAt)));
  }
  const byItem = new Map<string, Map<string, number>>();
  const rows = input.shipments.filter((s) => s.orderId === order.orderId).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
  for (const s of rows) {
    let quantity = s.quantity;
    if (quantity > 0) {
      const covered = Math.min(quantity, landedAtOnce.get(s.batchId) ?? 0);
      if (covered > 0) {
        landedAtOnce.set(s.batchId, (landedAtOnce.get(s.batchId) ?? 0) - covered);
        quantity -= covered;
      }
    }
    if (quantity === 0) continue;
    if (ms(s.createdAt) <= (lastReceipt.get(s.itemId) ?? 0)) continue;
    const parts = byItem.get(s.itemId) ?? new Map<string, number>();
    parts.set(s.batchId, (parts.get(s.batchId) ?? 0) + quantity);
    byItem.set(s.itemId, parts);
  }
  const out: PendingItem[] = [];
  for (const [itemId, parts] of byItem) {
    const list = Array.from(parts.entries())
      .map(([batchId, quantity]) => ({ batchId, quantity }))
      .filter((p) => p.quantity > 0);
    // Возврат мог прийтись на другую партию, чем отгрузка: общий минус снимаем с конца.
    let minus = -Array.from(parts.values()).filter((q) => q < 0).reduce((s, q) => s + q, 0);
    for (let i = list.length - 1; i >= 0 && minus > 0; i--) {
      const take = Math.min(list[i].quantity, minus);
      list[i].quantity -= take;
      minus -= take;
    }
    const left = list.filter((p) => p.quantity > 0);
    const quantity = left.reduce((s, p) => s + p.quantity, 0);
    if (quantity > 0) out.push({ itemId, quantity, parts: left });
  }
  return out;
}

export interface ReceiptLineInput {
  itemId: string;
  /** Сколько, по мнению формы, ждёт приёмки — сверяется с сервером: склад мог дописать отгрузку. */
  shipped: number;
  accepted: number;
}

export interface ReceiptPlan {
  lines: { itemId: string; shipped: number; accepted: number }[];
  /** Что ложится на склад города: партия основного склада → сколько (только у опта). */
  landing: { batchId: string; quantity: number }[];
  shipped: number;
  accepted: number;
  shortage: number;
  note: string;
}

/**
 * Проверка и расчёт приёмки. Строка — отказ. Принимается весь ожидающий заказ разом: по каждой позиции — сколько
 * приехало (не больше отгруженного). Недостача требует причины словами.
 */
export function planTruckReceipt(input: {
  access: RegionAccess;
  kind: TruckKind | null;
  pending: PendingItem[];
  lines: ReceiptLineInput[];
  note: string;
}): ReceiptPlan | string {
  if (!input.access.accept) return "Приёмку фуры подтверждает тот, кто ведёт склад города";
  if (!input.kind) return "Это не заказ на фуру этого города";
  if (input.pending.length === 0) return "По этому заказу нечего принимать — обновите страницу";
  const byId = new Map((input.lines ?? []).map((l) => [String(l.itemId || ""), l]));
  const lines: ReceiptPlan["lines"] = [];
  const landing = new Map<string, number>();
  for (const p of input.pending) {
    const l = byId.get(p.itemId);
    if (!l) return "Склад дописал отгрузку, пока страница была открыта — обновите её и проверьте цифры";
    if (Number(l.shipped) !== p.quantity) return "Склад дописал отгрузку, пока страница была открыта — обновите её и проверьте цифры";
    const accepted = Number(l.accepted);
    if (!Number.isFinite(accepted) || accepted < 0 || !Number.isInteger(accepted)) return "Принято — целое число стеблей, не меньше нуля";
    if (accepted > p.quantity) return `Принять можно не больше отгруженного (${p.quantity} шт.). Приехало больше — попросите склад дописать отгрузку`;
    lines.push({ itemId: p.itemId, shipped: p.quantity, accepted });
    if (input.kind === "wholesale") {
      let left = accepted;
      for (const part of p.parts) {
        if (left <= 0) break;
        const take = Math.min(part.quantity, left);
        landing.set(part.batchId, (landing.get(part.batchId) ?? 0) + take);
        left -= take;
      }
    }
  }
  if (byId.size > input.pending.length) return "В приёмке есть позиция, которой нет в заказе — обновите страницу";
  const shipped = lines.reduce((s, l) => s + l.shipped, 0);
  const accepted = lines.reduce((s, l) => s + l.accepted, 0);
  const note = String(input.note ?? "").trim().slice(0, 300);
  if (accepted < shipped && note.length < 3) return "Приехало меньше, чем отгружено, — напишите, что случилось (не доложили, бой, пересорт)";
  return {
    lines,
    landing: Array.from(landing.entries()).map(([batchId, quantity]) => ({ batchId, quantity })),
    shipped,
    accepted,
    shortage: shipped - accepted,
    note,
  };
}

// --- Список заказов на фуру ------------------------------------------------------------

export type TruckStage = "waiting" | "loading" | "transit" | "received" | "old" | "cancelled";

export const TRUCK_STAGE_LABELS: Record<TruckStage, string> = {
  waiting: "Ждёт загрузки",
  loading: "Грузится",
  transit: "В пути — ждёт приёмки",
  received: "Принято",
  // Отгружено до 16.11.2026: приёмка тогда не велась, на остаток города это не ложилось (кроме Астаны со 02.11).
  old: "Отгружено",
  cancelled: "Отменён",
};

export interface TruckOrderView {
  orderId: string;
  kind: TruckKind;
  deliveryDate: string;
  createdAt: string;
  managerEmail: string;
  stage: TruckStage;
  ordered: number;
  shipped: number;
  /** Ждёт приёмки, шт. */
  pending: number;
  /** Принято и недостача по записям приёмки (у старых отгрузок Астаны записей нет). */
  accepted: number;
  shortage: number;
  shortageNote: string;
  items: {
    itemId: string;
    flowerType: string;
    variety: string;
    grade: string;
    quantity: number;
    shipped: number;
    pending: number;
    accepted: number | null;
  }[];
}

interface TruckOrderFull extends TruckOrderLike {
  createdAt: string;
  managerEmail: string;
  items: { itemId: string; flowerType: string; variety: string; grade: string; quantity: number; shippedQuantity: number }[];
}

/** Заказы на фуру города: что заказано, что отгружено, что ждёт приёмки, что принято. Свежие — первыми. */
export function buildTruckOrders(input: {
  store: StoreCode;
  orders: TruckOrderFull[];
  retailCardIds: Set<string>;
  shipments: TruckShipRow[];
  moves: TruckMoveRow[];
  receipts: TruckReceiptRow[];
  /** Не показывать заказы с днём фуры раньше этого дня. */
  from: string;
}): TruckOrderView[] {
  const out: TruckOrderView[] = [];
  for (const o of input.orders) {
    const kind = truckKindOf(o, input.store, input.retailCardIds);
    if (!kind || !o.deliveryDate || o.deliveryDate < input.from) continue;
    const pending = pendingReceipt({ order: o, shipments: input.shipments, moves: input.moves, receipts: input.receipts });
    const pendingBy = new Map(pending.map((p) => [p.itemId, p.quantity]));
    const receipts = input.receipts.filter((r) => r.orderId === o.orderId);
    const acceptedBy = new Map<string, number>();
    for (const r of receipts) acceptedBy.set(r.itemId, (acceptedBy.get(r.itemId) ?? 0) + r.accepted);
    const ordered = o.items.reduce((s, i) => s + i.quantity, 0);
    const shipped = o.items.reduce((s, i) => s + i.shippedQuantity, 0);
    const pendingTotal = pending.reduce((s, p) => s + p.quantity, 0);
    const stage: TruckStage =
      o.status === ORDER_STATUSES.CANCELLED
        ? "cancelled"
        : pendingTotal > 0
          ? "transit"
          : shipped <= 0
            ? "waiting"
            : shipped < ordered && o.status !== ORDER_STATUSES.SHIPPED
              ? "loading"
              : o.deliveryDate < REGION_ACCEPT_FROM
                ? "old"
                : "received";
    out.push({
      orderId: o.orderId,
      kind,
      deliveryDate: o.deliveryDate,
      createdAt: o.createdAt,
      managerEmail: o.managerEmail,
      stage,
      ordered,
      shipped,
      pending: pendingTotal,
      accepted: receipts.reduce((s, r) => s + r.accepted, 0),
      shortage: receipts.reduce((s, r) => s + (r.shipped - r.accepted), 0),
      shortageNote: receipts.find((r) => r.shipped > r.accepted && r.note)?.note ?? "",
      items: o.items.map((i) => ({
        itemId: i.itemId,
        flowerType: i.flowerType,
        variety: i.variety,
        grade: i.grade,
        quantity: i.quantity,
        shipped: i.shippedQuantity,
        pending: pendingBy.get(i.itemId) ?? 0,
        accepted: acceptedBy.has(i.itemId) ? acceptedBy.get(i.itemId)! : null,
      })),
    });
  }
  // Свежая фура — первой; внутри дня отменённые — в конце, остальные — по времени заказа (новые выше).
  const cancelled = (v: TruckOrderView) => (v.stage === "cancelled" ? 1 : 0);
  return out.sort(
    (a, b) => (a.deliveryDate === b.deliveryDate ? cancelled(a) - cancelled(b) || (a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1) : a.deliveryDate < b.deliveryDate ? 1 : -1)
  );
}

// --- Деньги города ---------------------------------------------------------------------

interface CityOrderLike {
  orderId: string;
  status: string;
  kind?: string;
  retail?: string;
  direction?: string;
  clientName?: string;
  clientId?: string;
  store?: string;
  createdAt: string;
  deliveryDate: string;
  totalAmount: number;
  paidAmount: number;
}

/**
 * Клиентские заявки города: отгружаются со склада города, или клиент из этого города, или направление заявки — этот
 * город. Перемещения в наши магазины и объём на город сюда не идут — у них нет счёта.
 */
export function cityClientOrders<T extends CityOrderLike>(orders: T[], store: StoreCode, cityOfClient: (clientId: string) => string | null | undefined): T[] {
  return orders.filter((o) => {
    if (isNotASale(o)) return false;
    if (normalizeStore(o.store) === store) return true;
    if (regionStoreForCity(cleanDirection(o.direction)) === store) return true;
    return !!o.clientId && regionStoreForCity(cityOfClient(o.clientId)) === store;
  });
}

export interface CityMoney {
  /** Продано за месяц (по дню оформления), без отменённых. */
  monthSales: number;
  monthOrders: number;
  monthPaid: number;
  /** Долг сейчас по всем неотменённым заявкам города и сколько из него просрочено. */
  debt: number;
  debtOrders: number;
  late: number;
  lateOrders: number;
}

export function cityMoney(input: {
  orders: (CityOrderLike & { debt: number; late: boolean })[];
  /** «ГГГГ-ММ». */
  month: string;
}): CityMoney {
  const out: CityMoney = { monthSales: 0, monthOrders: 0, monthPaid: 0, debt: 0, debtOrders: 0, late: 0, lateOrders: 0 };
  for (const o of input.orders) {
    if (o.status === ORDER_STATUSES.CANCELLED) continue;
    if ((o.createdAt || "").slice(0, 7) === input.month) {
      out.monthSales += o.totalAmount;
      out.monthOrders += 1;
      out.monthPaid += Math.min(o.paidAmount, o.totalAmount);
    }
    if (o.debt > MONEY_EPSILON) {
      out.debt += o.debt;
      out.debtOrders += 1;
      if (o.late) {
        out.late += o.debt;
        out.lateOrders += 1;
      }
    }
  }
  return out;
}

/** «пн», «вт» … для подписи дня фуры. */
export const WEEKDAY_SHORT = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"];
export const WEEKDAY_FULL = ["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
export { isoWeekday };
