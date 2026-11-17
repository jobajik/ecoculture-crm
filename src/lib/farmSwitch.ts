import { FARM_LABELS, FLOWER_TYPES, MONEY_EPSILON, ORDER_STATUSES, ROLES, formatGrade, getFarmFor } from "./constants";
import { isRegionOrder } from "./orderKind";

/**
 * Хризантема заявки — с одного склада на другой: Есентай ⇄ Rose Farm (17.11.2026).
 *
 * Владелец: «дай возможность зав. складам менять склад при необходимости». За один день склад трижды просил об этом
 * через менеджеров и владельца («Заявка 3JA79, поменять склад отгрузки на Rose Farm»; «Алтай 2 и 4 категория — на
 * Rose Farm»): на одном складе категории нет, на другом есть, а переставить позицию мог только программист.
 *
 * Хризантема Rose Farm — отдельный товар (`chrysanthemum_rf`), поэтому «сменить склад» значит сменить цветок позиции,
 * а с ним — кто собирает, чей это счёт и чья выручка. Сорт, категория, количество и цена не меняются.
 *
 * - **что можно перевести**: позицию хризантемы, по которой ещё ничего не отгружено. Отгруженное — сначала возврат;
 * - **кто**: зав. складом — позиции СВОЕГО производства (отдаёт соседу то, чего у неё нет; чужих позиций она не видит
 *   вовсе — грабли 1.1-ter), администратор — любые. «Объём на город» — только администратор: такую заявку заводят
 *   своим цветком, и у зав. складом после перевода она перестала бы открываться;
 * - **счёт Kaspi, который ещё ждёт оплаты**, останавливает перевод: его сумма после перевода стала бы неверной.
 *   Сначала бухгалтер отменяет счёт;
 * - **деньги**: уже полученное сначала закрывает то, что остаётся у прежней компании (деньги пришли на её кассу),
 *   остальное переходит новой. Общая сумма «получено» не меняется. Строки журнала платежей переносятся так же, при
 *   необходимости строка делится на две. Оплаченный счёт Kaspi — факт, он не трогается.
 *
 * Модуль чистый — проверка `scripts/check-farm-switch.ts`; запись одним атомарным запросом — `repo/farmSwitch.ts`.
 */

const PAIR: Record<string, string> = {
  [FLOWER_TYPES.CHRYSANTHEMUM]: FLOWER_TYPES.CHRYSANTHEMUM_RF,
  [FLOWER_TYPES.CHRYSANTHEMUM_RF]: FLOWER_TYPES.CHRYSANTHEMUM,
};

/** Во что превращается цветок при смене склада; пусто — у этого цветка второго склада нет. */
export function switchTarget(flowerType: string): string {
  return PAIR[flowerType] ?? "";
}

export interface SwitchItem {
  itemId: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  unitPrice: number;
  shippedQuantity: number;
}

export interface SwitchOrder {
  status: string;
  kind?: string;
  paidAmount: number;
  paidRoseFarm: number;
  paidEsentai: number;
  items: SwitchItem[];
}

export interface SwitchLedgerRow {
  paymentId: string;
  amount: number;
  farm: string;
  flowerType: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const money = (v: number) => `${round2(v).toLocaleString("ru-RU")} ₸`;
const farmName = (farm: string) => FARM_LABELS[farm] ?? farm;

/** Позиции, которые этот человек может перевести на другой склад (для показа блока на заявке). */
export function switchableItems(order: SwitchOrder, role: string | null | undefined, farm: string | null | undefined): SwitchItem[] {
  if (order.status === ORDER_STATUSES.CANCELLED) return [];
  if (role !== ROLES.ADMIN && role !== ROLES.WAREHOUSE) return [];
  if (role === ROLES.WAREHOUSE && (!farm || isRegionOrder(order))) return [];
  return order.items.filter(
    (i) => switchTarget(i.flowerType) !== "" && i.shippedQuantity === 0 && (role === ROLES.ADMIN || getFarmFor(i.flowerType) === farm)
  );
}

export interface FarmSwitchPlan {
  fromFarm: string;
  toFarm: string;
  toFlower: string;
  itemIds: string[];
  movedAmount: number;
  /** Сколько полученных денег переходит новой компании. */
  movedPaid: number;
  /** Новые значения «получено» по компаниям (только когда меняются). */
  paid: { roseFarm: number; esentai: number } | null;
  paymentUpdates: { paymentId: string; amount?: number; farm?: string; flowerType?: string }[];
  /** Вторая половина разделённой строки платежа. */
  paymentSplits: { fromPaymentId: string; amount: number; farm: string; flowerType: string }[];
  describe: string;
}

/**
 * Проверка и расчёт. Строка — отказ, объект — что записать. Проверяется именно присланное (грабли 1.11): чужая
 * позиция, отгруженная, не хризантема, позиции с разных складов в одном запросе.
 */
export function planFarmSwitch(input: {
  order: SwitchOrder;
  itemIds: string[];
  role: string | null | undefined;
  farm: string | null | undefined;
  ledger: SwitchLedgerRow[];
  /** Компании, чьи счета Kaspi по этой заявке ещё ждут оплаты. */
  openInvoiceFarms: string[];
}): FarmSwitchPlan | string {
  const { order } = input;
  if (input.role !== ROLES.ADMIN && input.role !== ROLES.WAREHOUSE) {
    return "Склад отгрузки хризантемы меняет зав. складом или администратор";
  }
  // Пустое производство закрывает, а не открывает (грабли 1.10).
  if (input.role === ROLES.WAREHOUSE && !input.farm) {
    return "У вас не указано производство. Попросите администратора заполнить его в «Настройки → Сотрудники».";
  }
  if (order.status === ORDER_STATUSES.CANCELLED) return "Заявка отменена";
  if (input.role === ROLES.WAREHOUSE && isRegionOrder(order)) return "В объёме на город склад меняет администратор";

  const ids = Array.from(new Set((input.itemIds ?? []).map((v) => String(v || "").trim()).filter(Boolean)));
  if (ids.length === 0) return "Отметьте позиции, которые нужно перевести";
  const moving: SwitchItem[] = [];
  for (const id of ids) {
    const item = order.items.find((i) => i.itemId === id);
    if (!item) return "Позиция не из этой заявки — обновите страницу";
    const name = `${item.variety} ${formatGrade(item.grade)}`;
    if (!switchTarget(item.flowerType)) return `${name}: второй склад есть только у хризантемы`;
    if (input.role === ROLES.WAREHOUSE && getFarmFor(item.flowerType) !== input.farm) return `${name} — не ваше производство`;
    if (item.shippedQuantity > 0) return `${name}: по позиции уже отгружено ${item.shippedQuantity} шт. — сначала оформите возврат`;
    moving.push(item);
  }
  const fromFlower = moving[0].flowerType;
  if (moving.some((i) => i.flowerType !== fromFlower)) return "За один раз переводятся позиции одного склада";
  const toFlower = switchTarget(fromFlower);
  const fromFarm = getFarmFor(fromFlower) ?? "";
  const toFarm = getFarmFor(toFlower) ?? "";

  const open = input.openInvoiceFarms.filter((f) => f === fromFarm || f === toFarm);
  if (open.length > 0) {
    return `По заявке ждёт оплаты счёт Kaspi (${open.map(farmName).join(", ")}). После перевода его сумма станет неверной — сначала бухгалтер отменяет счёт`;
  }

  const movedAmount = round2(moving.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
  const movingIds = new Set(moving.map((i) => i.itemId));
  const stayAmount = round2(
    order.items.filter((i) => getFarmFor(i.flowerType) === fromFarm && !movingIds.has(i.itemId)).reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  );

  // Сколько получено прежней компанией. У заявки одной компании её поле могли и не вести — тогда это весь итог.
  const farmsBefore = new Set(order.items.map((i) => getFarmFor(i.flowerType)));
  const single = farmsBefore.size <= 1;
  const fields = { rose_farm: round2(order.paidRoseFarm || 0), esentai: round2(order.paidEsentai || 0) } as Record<string, number>;
  const total = round2(order.paidAmount || 0);
  const trusted = Math.abs(fields.rose_farm + fields.esentai - total) <= MONEY_EPSILON;
  if (!trusted && !single && total > MONEY_EPSILON) {
    return "Оплата по этой заявке не разнесена по компаниям — склад переведёт администратор после бухгалтера";
  }
  const paidFrom = single ? total : fields[fromFarm] ?? 0;
  const paidTo = single ? 0 : fields[toFarm] ?? 0;
  const wantMove = round2(Math.max(0, paidFrom - stayAmount));

  // Строки журнала: деньги прежней компании за этот цветок (или не разнесённые по цветкам). Переносим с конца.
  const own = input.ledger.filter((p) => p.farm === fromFarm || (p.farm === "" && single));
  const movable = own.filter((p) => !p.flowerType || p.flowerType === fromFlower);
  const movableSum = round2(movable.reduce((s, p) => s + p.amount, 0));
  // Журнал ведётся — переносим не больше, чем в нём есть за этот цветок: итог и журнал не должны разойтись.
  const movedPaid = input.ledger.length > 0 ? Math.min(wantMove, movableSum) : wantMove;

  const paymentUpdates: FarmSwitchPlan["paymentUpdates"] = [];
  const paymentSplits: FarmSwitchPlan["paymentSplits"] = [];
  let left = movedPaid;
  const moved = new Set<string>();
  for (const p of [...movable].reverse()) {
    if (left <= MONEY_EPSILON) break;
    if (p.amount <= left + MONEY_EPSILON) {
      paymentUpdates.push({ paymentId: p.paymentId, farm: toFarm, flowerType: toFlower });
      moved.add(p.paymentId);
      left = round2(left - p.amount);
    } else {
      paymentUpdates.push({ paymentId: p.paymentId, amount: round2(p.amount - left), farm: fromFarm });
      paymentSplits.push({ fromPaymentId: p.paymentId, amount: left, farm: toFarm, flowerType: toFlower });
      moved.add(p.paymentId);
      left = 0;
    }
  }
  // Заявка была одной компании и вела журнал без компании в строке — оставшимся строкам её проставляем.
  for (const p of own) {
    if (!moved.has(p.paymentId) && p.farm === "") paymentUpdates.push({ paymentId: p.paymentId, farm: fromFarm });
  }

  const next = { ...fields };
  next[fromFarm] = round2(paidFrom - movedPaid);
  next[toFarm] = round2(paidTo + movedPaid);
  const paidChanged = total > MONEY_EPSILON && (Math.abs(next.rose_farm - fields.rose_farm) > MONEY_EPSILON || Math.abs(next.esentai - fields.esentai) > MONEY_EPSILON);

  return {
    fromFarm,
    toFarm,
    toFlower,
    itemIds: moving.map((i) => i.itemId),
    movedAmount,
    movedPaid,
    paid: paidChanged ? { roseFarm: next.rose_farm, esentai: next.esentai } : null,
    paymentUpdates,
    paymentSplits,
    describe:
      `Склад отгрузки: ${farmName(fromFarm)} → ${farmName(toFarm)} (${moving.map((i) => `${i.variety} ${formatGrade(i.grade)} ${i.quantity} шт.`).join("; ")}), ${money(movedAmount)}` +
      (movedPaid > MONEY_EPSILON ? ` · из полученного ${money(movedPaid)} — на ${farmName(toFarm)}` : ""),
  };
}
