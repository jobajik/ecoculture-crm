import { ORDER_KINDS, ROLES, SHIPMENT_DIRECTIONS } from "./constants";
import { cleanDirection } from "./direction";

/**
 * Оптовый объём на город — заявка без клиента.
 *
 * Владелец объяснил это одной фразой: «она не продаёт клиенту, а только городу
 * двигает объём, только количество; сумму по поступлениям подтверждает потом
 * Юлия». Из этой фразы следует ВСЁ устройство:
 *
 * - **контрагента нет.** Ни карточки, ни имени, ни телефона. Заводить
 *   фиктивного клиента «Опт, Астана» я не стал: он тут же попал бы в
 *   клиентскую базу и в «долю трёх крупнейших клиентов», а никакого клиента на
 *   самом деле нет. Поэтому у такой заявки `ClientID` пустой — единственное
 *   исключение из правила «заявка только на клиента из базы», и именно потому,
 *   что здесь это не продажа конкретному клиенту;
 * - **цены в позициях нет.** Только количество. Сумма заявки равна нулю, и это
 *   не ошибка в данных, а её природа;
 * - **счёта нет, значит нет и долга.** Такая заявка не идёт ни в выручку, ни в
 *   долги, ни в список звонков, ни в бонусы, ни в клиентскую базу — ровно так
 *   же, как заявка в наш магазин;
 * - **деньги приходят с другой стороны.** Бухгалтер вписывает на заявке,
 *   сколько по этому городу поступило. Эта сумма — единственный денежный
 *   показатель раздела, и она НЕ равна «цена × количество», потому что цены
 *   здесь и не было.
 *
 * Первую версию этого раздела я сделал неправильно: построил её поверх обычной
 * клиентской формы, добавив к ней поле «направление». Владелец сказал прямо:
 * «Ты неправильно сделал. Опт регионы — это просто типа выставляешь количество,
 * сорт и выбираешь регион. Без клиентов и прочее». Отсюда отдельный вид заявки,
 * а не ещё одно поле в чужой форме.
 */

/** Приводит значение колонки к виду. Неизвестное — обычная заявка (грабли 1.10). */
export function cleanOrderKind(value: string | null | undefined): string {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === ORDER_KINDS.REGION ? ORDER_KINDS.REGION : ORDER_KINDS.CLIENT;
}

/** Это оптовый объём на город? */
export function isRegionOrder(order: { kind?: string } | null | undefined): boolean {
  return cleanOrderKind(order?.kind) === ORDER_KINDS.REGION;
}

/**
 * Заявка, по которой клиенту НЕ выставляют счёт.
 *
 * Две разные вещи с одинаковыми последствиями для денег: перемещение в наш
 * магазин и объём на город. Функция одна на обе, потому что применяется она в
 * восьми местах, и второе условие, дописанное руками в каждом, рано или поздно
 * где-нибудь забудут — ровно так разъехалась когда-то проверка готовности
 * заявки по четырём местам.
 */
export function hasNoClientInvoice(
  order: { retail?: string; kind?: string } | null | undefined
): boolean {
  return Boolean((order?.retail || "").trim()) || isRegionOrder(order);
}

/** Кто заводит городские заявки. Это работа РОПа — так решил владелец. */
export function canFillRegionOrders(role: string | null | undefined): boolean {
  return role === ROLES.SALES_HEAD || role === ROLES.ADMIN;
}

/**
 * Города, в которые оформляют объём.
 *
 * Это тот же закрытый список, что и в плане отгрузок. Иначе факт не лёг бы на
 * план: город, которого в плане нет, сравнивать было бы не с чем, а лишнее
 * направление в плане навсегда осталось бы с прочерком в факте.
 */
export const REGION_ORDER_DIRECTIONS: string[] = SHIPMENT_DIRECTIONS;

export interface RegionOrderInput {
  role: string | null | undefined;
  direction: string;
  deliveryDate: string;
  items: { variety: string; grade: string; quantity: number }[];
}

/**
 * Почему городскую заявку принять нельзя. Пустая строка — можно.
 *
 * Проверки сервера, а не формы: серверное действие вызывается обычным
 * запросом, и спрятанное поле ничего не запрещает (грабли 1.11).
 */
export function regionOrderRefusal(input: RegionOrderInput): string {
  if (!canFillRegionOrders(input.role)) {
    return "Заявки по регионам оформляет руководитель отдела продаж";
  }
  if (!cleanDirection(input.direction)) return "Выберите регион";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deliveryDate)) return "Укажите дату отгрузки";
  if (!input.items || input.items.length === 0) return "Добавьте хотя бы одну позицию";
  for (const item of input.items) {
    if (!item.variety.trim()) return "У каждой позиции должен быть выбран сорт";
    if (!item.grade) return "У каждой позиции должна быть выбрана длина или категория";
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      return "Укажите количество по каждой позиции";
    }
    if (!Number.isInteger(item.quantity)) {
      return "Количество считается в стеблях, целым числом";
    }
  }
  return "";
}

/**
 * Кто вписывает сумму поступлений и сколько её можно вписать.
 *
 * Сумма здесь НЕ сверяется с суммой заявки: суммы у заявки нет. Проверяем
 * только то, что можно проверить, — что это неотрицательное число и что
 * вписывает его бухгалтер.
 */
export function regionIncomeRefusal(input: {
  role: string | null | undefined;
  amount: number;
  status: string;
  cancelledStatus: string;
}): string {
  if (input.role !== ROLES.ACCOUNTANT && input.role !== ROLES.ADMIN) {
    return "Поступления по региону отмечает бухгалтер";
  }
  if (!Number.isFinite(input.amount) || input.amount < 0) {
    return "Сумма не может быть отрицательной";
  }
  if (input.status === input.cancelledStatus) {
    return "Заявка отменена — деньги по ней не проводятся";
  }
  return "";
}

export interface RegionIncomeRow {
  direction: string;
  /** Сколько стеблей ушло в город за период. */
  stems: number;
  /** Сколько денег по этим заявкам подтвердил бухгалтер. */
  income: number;
  /** Заявок в периоде и сколько из них ещё без суммы. */
  orders: number;
  waitingIncome: number;
}

/**
 * Поступления по городам за период.
 *
 * Отдельно от плана и факта в стеблях: это разные вопросы и разные люди. Объём
 * ставит РОП сразу, деньги подтверждает бухгалтер потом — иногда через неделю.
 * Поэтому «ещё без суммы» показывается числом: без него было бы непонятно,
 * то ли город не заплатил, то ли Юлия ещё не дошла до этих строк.
 */
export function buildRegionIncome(input: {
  orders: {
    direction: string;
    deliveryDate: string;
    status: string;
    kind?: string;
    paidAmount: number;
    items: { quantity: number }[];
  }[];
  from: string;
  to: string;
  cancelledStatus: string;
}): RegionIncomeRow[] {
  const map = new Map<string, RegionIncomeRow>();
  for (const order of input.orders) {
    if (!isRegionOrder(order)) continue;
    if (order.status === input.cancelledStatus) continue;
    if (!order.deliveryDate || order.deliveryDate < input.from || order.deliveryDate > input.to) {
      continue;
    }
    const direction = cleanDirection(order.direction);
    if (!direction) continue;
    const row =
      map.get(direction) ?? { direction, stems: 0, income: 0, orders: 0, waitingIncome: 0 };
    row.stems += order.items.reduce((s, i) => s + i.quantity, 0);
    row.income += order.paidAmount;
    row.orders += 1;
    if (order.paidAmount <= 0) row.waitingIncome += 1;
    map.set(direction, row);
  }
  return Array.from(map.values()).sort((a, b) => b.stems - a.stems);
}
