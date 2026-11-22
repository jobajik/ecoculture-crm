import { FLOWER_TYPES, formatGrade, getFarmFor, getGradesFor } from "./constants";
import { planWholeOrderShipment, type WholeShipBatch } from "./shipRules";

/**
 * Погрузка фуры в город — работа зав. складом с заказом региона (22.11.2026).
 *
 * Владелец: «по регионам мне нужно сделать так, чтобы с производства перемещение делали зав. склады и я видел стоки их по
 * городам… интерфейс, где они [менеджеры городов] могут делать заказ на следующую фуру: форму заполнить и отправить
 * зав. складам, а им было легко работать с формой, если каких-то позиций нет и прочее».
 *
 * До этого заказ города лежал в общей «Очереди на отгрузку» двумя заявками («объём на город» и заявка в магазины), и склад
 * отгружал их как клиентские: позиция за позицией, а «нет на складе» оставалось висеть недогруженной строкой — город не
 * знал, приедет ли она. Теперь у склада один экран «Фуры в регионы» (`/warehouse/trucks`): заказы города на день фуры
 * одной таблицей — «просили / есть на складе / гружу». По каждой позиции склад отвечает:
 *
 * - гружу столько-то (не больше, чем просили и чем лежит на основном складе);
 * - остального нет — позиция ЗАКРЫВАЕТСЯ: количество в заявке становится фактом отгрузки, сколько просили — остаётся в
 *   `AskedQuantity`, причина — в `StockNote`. Заказ уходит из очереди, город видит «просили 500, приехало 300 — нет на
 *   складе»;
 * - догружу позже — позиция остаётся открытой, как раньше;
 * - замена или свой цветок без заказа — новая позиция в заявке «объём на город» с пометкой «Добавил склад» (заказа города
 *   на эту фуру нет — заявка заводится тут же). Это и есть «перемещение с производства делает зав. складом».
 *
 * Отгруженное по-прежнему «в пути», пока город не подтвердит приёмку (`regionTruck.ts`). Модуль чистый — проверка
 * `scripts/check-truck-load.ts`; запись одним атомарным запросом — `commitTruckLoad` в `repo/regionTruck.ts`.
 */

/** Что делать с тем, что склад не догрузил по позиции. */
export const REST_OPTIONS = [
  { code: "none", label: "нет на складе", closes: true },
  { code: "quality", label: "не прошло по качеству", closes: true },
  { code: "keep", label: "догружу позже", closes: false },
] as const;
export type RestCode = (typeof REST_OPTIONS)[number]["code"];

export const restOption = (code: string) => REST_OPTIONS.find((o) => o.code === code) ?? null;

/** Пометка позиции, которую в заказ дописал склад (замена или свой цветок без заказа). */
export const EXTRA_NOTE = "Добавил склад";
export const isWarehouseExtra = (note: string | null | undefined) => (note || "").startsWith(EXTRA_NOTE);

export interface LoadOrderItem {
  orderId: string;
  itemId: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  shippedQuantity: number;
  askedQuantity?: number;
  stockNote?: string;
}

export interface LoadLine {
  itemId: string;
  /** Сколько гружу сейчас. */
  load: number;
  /** Что с остатком, если гружу меньше, чем осталось отгрузить. */
  rest: string;
}

export interface LoadExtra {
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  /** Пояснение городу: «вместо Altaj Вторая». */
  note?: string;
}

export interface LoadPlan {
  /** Отгрузка по позициям заказов: из каких партий. */
  ship: { orderId: string; itemId: string; parts: { batchId: string; quantity: number }[] }[];
  /** Закрытые позиции: новое количество (= отгружено), сколько просили, ответ склада. */
  trims: { orderId: string; itemId: string; quantity: number; asked: number; note: string }[];
  /** Позиции, которые дописывает склад, с раскладкой по партиям. */
  extras: { flowerType: string; variety: string; grade: string; quantity: number; note: string; parts: { batchId: string; quantity: number }[] }[];
  /** Сколько стеблей уезжает. */
  total: number;
  /** Сколько стеблей город не получит (закрыто без отгрузки). */
  closedShort: number;
}

const MAX_LINE = 500_000;
const FLOWERS = new Set<string>(Object.values(FLOWER_TYPES));
const norm = (s: string) => s.trim().toLowerCase();
const nameOf = (x: { variety: string; grade: string }) => `${x.variety.trim() || "позиция"} ${formatGrade(x.grade)}`.trim();

/**
 * Проверка и раскладка погрузки. Строка — отказ словами (грабли 1.11: решает сервер). `items` — открытые позиции заказов
 * этого города на этот день фуры, `batches` — партии ОСНОВНОГО склада, `farm` — производство зав. складом (у
 * администратора — null: любой цветок). Раскладка по партиям — от старой срезки к свежей, общая на все строки: две
 * строки одного сорта не возьмут один и тот же стебель.
 */
export function planTruckLoad(input: { items: LoadOrderItem[]; batches: WholeShipBatch[]; lines: LoadLine[]; extras: LoadExtra[]; farm: string | null }): LoadPlan | string {
  const byId = new Map(input.items.map((i) => [i.itemId, i]));
  const own = (flowerType: string) => !input.farm || getFarmFor(flowerType) === input.farm;
  const seen = new Set<string>();
  const want: { key: string; flowerType: string; variety: string; grade: string; quantity: number }[] = [];
  const trims: LoadPlan["trims"] = [];
  const shipLines: { itemId: string; orderId: string; load: number }[] = [];

  for (const l of input.lines ?? []) {
    const item = byId.get(String(l.itemId || ""));
    if (!item) return "Заказ изменился, пока страница была открыта, — обновите её и проверьте цифры";
    if (seen.has(item.itemId)) return `${nameOf(item)}: позиция указана дважды`;
    seen.add(item.itemId);
    if (!own(item.flowerType)) return `${nameOf(item)}: это цветок другого производства — его грузит другой склад`;
    const left = Math.max(0, item.quantity - item.shippedQuantity);
    const load = Number(l.load);
    if (!Number.isFinite(load) || load < 0 || !Number.isInteger(load)) return `${nameOf(item)}: количество — целое число стеблей, не меньше нуля`;
    if (load > left) return `${nameOf(item)}: осталось отгрузить ${left} шт., а указано ${load}. Больше, чем просили, — добавьте отдельной позицией`;
    if (load > 0) {
      shipLines.push({ itemId: item.itemId, orderId: item.orderId, load });
      want.push({ key: item.itemId, flowerType: item.flowerType, variety: item.variety, grade: item.grade, quantity: load });
    }
    if (load < left) {
      const rest = restOption(l.rest);
      if (!rest) return `${nameOf(item)}: укажите, что с остальным — нет на складе или догрузите позже`;
      if (rest.closes) trims.push({ orderId: item.orderId, itemId: item.itemId, quantity: item.shippedQuantity + load, asked: item.askedQuantity && item.askedQuantity > 0 ? item.askedQuantity : item.quantity, note: rest.label });
    }
  }

  // Свои позиции склада: одинаковые складываются.
  const extraMap = new Map<string, { flowerType: string; variety: string; grade: string; quantity: number; note: string }>();
  for (const e of input.extras ?? []) {
    const quantity = Number(e.quantity);
    const variety = String(e.variety || "").trim();
    const flowerType = String(e.flowerType || "");
    const grade = String(e.grade || "");
    const name = nameOf({ variety, grade });
    if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity < 0) return `${name}: количество — целое число стеблей`;
    if (quantity === 0) continue;
    if (quantity > MAX_LINE) return `${name}: слишком большое количество — проверьте цифру`;
    if (!FLOWERS.has(flowerType)) return "Выберите цветок из списка";
    if (!variety) return "У добавленной позиции должен быть выбран сорт";
    if (!getGradesFor(flowerType as never).includes(grade)) return `${name}: выберите длину или категорию из списка`;
    if (!own(flowerType)) return `${name}: это цветок другого производства — добавить его может другой склад`;
    const key = `${flowerType}|${norm(variety)}|${grade}`;
    const note = String(e.note ?? "").trim().slice(0, 120);
    const prev = extraMap.get(key);
    if (prev) {
      prev.quantity += quantity;
      if (note && !prev.note.includes(note)) prev.note = prev.note ? `${prev.note}; ${note}` : note;
    } else extraMap.set(key, { flowerType, variety, grade, quantity, note });
  }
  const extraList = Array.from(extraMap.entries());
  for (const [key, e] of extraList) want.push({ key: `extra:${key}`, flowerType: e.flowerType, variety: e.variety, grade: e.grade, quantity: e.quantity });

  if (want.length === 0 && trims.length === 0) return "Укажите, что грузите, или отметьте, чего нет на складе";

  const plan = planWholeOrderShipment(
    want.map((w) => ({ itemId: w.key, flowerType: w.flowerType, variety: w.variety, grade: w.grade, quantity: w.quantity, shippedQuantity: 0 })),
    input.batches
  );
  if (plan.shortages.length > 0) {
    const s = plan.shortages[0];
    const w = want.find((x) => x.key === s.itemId)!;
    const have = w.quantity - s.missing;
    return `${nameOf(w)}: на складе ${have > 0 ? `только ${have} шт.` : "этой позиции нет"}, а грузите ${w.quantity}. Поправьте количество`;
  }
  const partsOf = new Map(plan.lines.map((l) => [l.itemId, l.parts]));
  const ship = shipLines.map((l) => ({ orderId: l.orderId, itemId: l.itemId, parts: partsOf.get(l.itemId) ?? [] }));
  const extras = extraList.map(([key, e]) => ({ ...e, note: e.note ? `${EXTRA_NOTE}: ${e.note}` : EXTRA_NOTE, parts: partsOf.get(`extra:${key}`) ?? [] }));
  const closedShort = trims.reduce((s, t) => {
    const item = byId.get(t.itemId)!;
    return s + (item.quantity - t.quantity);
  }, 0);
  return { ship, trims, extras, total: plan.total, closedShort };
}

/** Что уже ответил склад по позиции: сколько просили и чего не будет. */
export function warehouseReply(item: { quantity: number; askedQuantity?: number; stockNote?: string }): { asked: number; missing: number; note: string; extra: boolean } {
  const extra = isWarehouseExtra(item.stockNote);
  const asked = extra ? 0 : item.askedQuantity && item.askedQuantity > 0 ? item.askedQuantity : item.quantity;
  return { asked, missing: extra ? 0 : Math.max(0, asked - item.quantity), note: item.stockNote || "", extra };
}

/**
 * Остаток основного склада для экрана погрузки: «цветок|сорт|длина» → шт. (только своё производство). Сорт и длина — как
 * в партии; ключ — без регистра и пробелов, чтобы «Red Naomi » и «red naomi» были одной позицией.
 */
export function mainStockMap(batches: { flowerType: string; variety: string; grade: string; quantityRemaining: number }[], farm: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of batches) {
    if (!(b.quantityRemaining > 0)) continue;
    if (farm && getFarmFor(b.flowerType) !== farm) continue;
    const k = stockKey(b.flowerType, b.variety, b.grade);
    out[k] = (out[k] ?? 0) + b.quantityRemaining;
  }
  return out;
}

export const stockKey = (flowerType: string, variety: string, grade: string) => `${flowerType}|${norm(variety)}|${norm(grade)}`;
