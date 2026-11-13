import { ROLES, getFarmFor, farmLabel, FLOWER_TYPE_LABELS } from "./constants";
import { canFillRegionOrders } from "./orderKind";

/**
 * Отгрузка в РФ с ценами в рублях — заявка, которую заводит сам зав. складом (13.11.2026).
 *
 * Владелец: «сделай возможность для зав. складов сделать отгрузку: там будут рублёвые цены, которые они забьют
 * вручную; цветы по факту; саму заявку создают они». Его решения: только направление «РФ»; на клиента из базы; рубли
 * считаются ОТДЕЛЬНО — в тенговую выручку не идут, а сколько тенге реально поступило, вписывает бухгалтер, как по
 * регионам; заявка и отгрузка — одним шагом, из партий, которые реально уехали.
 *
 * Поэтому это та же «заявка по региону» (`ORDER_KINDS.REGION`, направление «РФ»): счёта Kaspi нет, долга нет, в
 * продажи и рейтинг не идёт, поступления вписывает бухгалтер. Отличий два: у заявки есть клиент из базы и у позиций
 * есть цена в рублях (`PriceRub`, последняя колонка `OrderItems`); цена в тенге остаётся нулём.
 *
 * Модуль чистый — проверка `scripts/check-rub-shipment.ts`.
 */

export const RUB_DIRECTION = "РФ";

export interface RubLineInput {
  batchId: string;
  quantity: number;
  priceRub: number;
}

export interface RubBatch {
  batchId: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantityRemaining: number;
  /** Склад партии: пусто — основной. */
  store: string;
}

export interface RubItemPlan {
  flowerType: string;
  variety: string;
  grade: string;
  priceRub: number;
  quantity: number;
  parts: { batchId: string; quantity: number }[];
}

/** Рубли с копейками: два знака, не больше. */
export function cleanRub(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Есть ли у заявки рублёвые цены — по ним она и узнаётся. */
export function hasRubPrices(order: { items?: { priceRub?: number }[] } | null | undefined): boolean {
  return Boolean(order?.items?.some((i) => (i.priceRub ?? 0) > 0));
}

export function rubTotal(items: { quantity: number; priceRub?: number }[]): number {
  return cleanRub(items.reduce((sum, i) => sum + i.quantity * (i.priceRub ?? 0), 0));
}

export function formatRub(value: number): string {
  const clean = cleanRub(value);
  return `${clean.toLocaleString("ru-RU", { minimumFractionDigits: Number.isInteger(clean) ? 0 : 2, maximumFractionDigits: 2 })} ₽`;
}

/**
 * Почему такую отгрузку принять нельзя. Пустая строка — можно. Проверка сервера: форма подсказывает то же самое, но
 * вкладка могла быть открыта со вчерашними остатками (грабли 1.11).
 */
export function rubShipmentRefusal(input: {
  role: string | null | undefined;
  /** Производство зав. складом; у РОПа и админа пусто. */
  farm?: string | null;
  client: { active: boolean; retail?: string } | null | undefined;
  deliveryDate: string;
  today: string;
  lines: RubLineInput[];
  batches: Map<string, RubBatch>;
}): string {
  if (!canFillRegionOrders(input.role)) return "Отгрузку в РФ оформляет зав. складом, руководитель отдела продаж или администратор";
  if (input.role === ROLES.WAREHOUSE && !input.farm) {
    return "У вас не указано производство. Попросите администратора заполнить его в «Настройки → Сотрудники».";
  }
  if (!input.client) return "Выберите клиента из базы";
  if (!input.client.active) return "Карточка этого клиента выключена — выберите другого или попросите администратора включить её";
  if ((input.client.retail || "").trim()) return "Это наш магазин, а не покупатель — для него есть заявка в магазин";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate)) return "Укажите дату отгрузки";
  if (input.deliveryDate > input.today) return "Отгрузка записывается по факту — дата не может быть в будущем";
  if (!input.lines || input.lines.length === 0) return "Добавьте хотя бы одну партию";

  const taken = new Map<string, number>();
  for (const line of input.lines) {
    const batch = input.batches.get(line.batchId);
    if (!batch) return "Одной из партий уже нет на складе — обновите страницу";
    const name = `${FLOWER_TYPE_LABELS[batch.flowerType] ?? batch.flowerType} ${batch.variety} ${batch.grade}`;
    if ((batch.store || "").trim()) return `${name}: партия не на основном складе`;
    if (input.role === ROLES.WAREHOUSE && getFarmFor(batch.flowerType) !== input.farm) {
      return `${name} — это производство «${farmLabel(getFarmFor(batch.flowerType))}», его отгружает их зав. складом`;
    }
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) return `${name}: укажите количество`;
    if (!Number.isInteger(line.quantity)) return `${name}: количество считается в стеблях, целым числом`;
    if (!Number.isFinite(line.priceRub) || line.priceRub <= 0) return `${name}: укажите цену в рублях`;
    if (line.priceRub > 100_000) return `${name}: цена ${line.priceRub} ₽ за стебель — похоже на опечатку`;
    const sum = (taken.get(line.batchId) ?? 0) + line.quantity;
    taken.set(line.batchId, sum);
    if (sum > batch.quantityRemaining) {
      return `${name}: в партии осталось ${batch.quantityRemaining} шт., а отмечено ${sum}`;
    }
  }
  return "";
}

/**
 * Строки формы (партия, количество, цена) → позиции заявки. Один сорт, одна длина и одна цена — одна позиция, даже
 * если цветок взят из трёх партий; та же позиция по другой цене — отдельная строка заявки. Партия, указанная дважды
 * в одной позиции, складывается.
 */
export function planRubItems(lines: RubLineInput[], batches: Map<string, RubBatch>): RubItemPlan[] {
  const items: RubItemPlan[] = [];
  for (const line of lines) {
    const batch = batches.get(line.batchId);
    if (!batch) continue;
    const priceRub = cleanRub(line.priceRub);
    let item = items.find((i) => i.flowerType === batch.flowerType && i.variety === batch.variety && i.grade === batch.grade && i.priceRub === priceRub);
    if (!item) {
      item = { flowerType: batch.flowerType, variety: batch.variety, grade: batch.grade, priceRub, quantity: 0, parts: [] };
      items.push(item);
    }
    item.quantity += line.quantity;
    const part = item.parts.find((p) => p.batchId === line.batchId);
    if (part) part.quantity += line.quantity;
    else item.parts.push({ batchId: line.batchId, quantity: line.quantity });
  }
  return items;
}
