import { MONEY_EPSILON, ROLES } from "./constants";

/**
 * Удаление заявки СОВСЕМ — и почему его почти всегда делать нельзя.
 *
 * В программе уже есть отмена: заявка остаётся в базе, помечается отменённой и
 * выходит из выручки, долгов и бонусов. Этого хватает в девяти случаях из
 * десяти, и придуман этот путь именно для того, чтобы данные не исчезали.
 *
 * Но остаётся десятый случай: заявку завели по ошибке, дважды или «на пробу».
 * Отменённая она не исчезает — она копится в списках отменённых и каждый раз
 * заставляет вспоминать, что это было. Владелец попросил дать возможность
 * убирать такие совсем, и только администратору.
 *
 * **Вернуть удалённое нельзя: в Google-таблице нет корзины.** Поэтому правило
 * жёсткое — удаляется только то, по чему НИЧЕГО НЕ ПРОИСХОДИЛО:
 *
 * - нет отгрузок. Отгрузка уменьшила остаток партии; удали заявку — и со склада
 *   пропадут стебли, а объяснить куда будет нечем: ни продажи, ни списания;
 * - не приходило денег. Полученная сумма — это факт, который видела бухгалтер и
 *   видел банк. Стереть его значит получить расхождение кассы с программой;
 * - нет рекламаций. Рекламация — след разговора с клиентом, и без заявки она
 *   превращается в строку про несуществующий заказ.
 *
 * Всё остальное отменяется, а не удаляется. Отказы написаны словами и говорят,
 * что делать вместо: запрет без объяснения человек обходит, а не соблюдает.
 */

export interface DeletableOrder {
  status: string;
  paidAmount: number;
  items: { shippedQuantity: number }[];
}

export interface DeleteCheckInput {
  order: DeletableOrder;
  role: string | null | undefined;
  /** Сколько записей отгрузки ссылается на эту заявку. */
  shipments: number;
  /** Сколько рекламаций по ней заведено. */
  claims: number;
  shippedStatus: string;
}

/** Причина отказа или пустая строка, если удалить можно. */
export function deleteOrderRefusal(input: DeleteCheckInput): string {
  const { order, role, shipments, claims, shippedStatus } = input;

  // Роль проверяется первой: чужому человеку незачем знать, что именно мешает
  // удалить чужую заявку.
  if (role !== ROLES.ADMIN) {
    return "Удалять заявки может только администратор. Обычный путь — отменить заявку.";
  }

  const shipped = order.items.reduce((sum, i) => sum + (Number(i.shippedQuantity) || 0), 0);
  if (shipped > 0 || shipments > 0 || order.status === shippedStatus) {
    return (
      "По заявке уже была отгрузка — удалять нельзя: цветок уехал со склада, и без заявки " +
      "эти стебли пропали бы из отчётов без следа. Если товар вернули, оформите рекламацию."
    );
  }

  if (order.paidAmount > MONEY_EPSILON) {
    return (
      `По заявке получено ${Math.round(order.paidAmount).toLocaleString("ru-RU")} ₸ — удалять ` +
      "нельзя: деньги исчезли бы из выручки. Сначала снимите оплату в разделе «Оплаты»."
    );
  }

  if (claims > 0) {
    return (
      "По заявке есть рекламация — удалять нельзя: это след разговора с клиентом, и без " +
      "заявки он станет строкой про несуществующий заказ."
    );
  }

  return "";
}

/** Показывать ли кнопку удаления. Правило то же, что проверит сервер. */
export function canDeleteOrder(input: DeleteCheckInput): boolean {
  return deleteOrderRefusal(input) === "";
}

/**
 * Строка для журнала действий по деньгам.
 *
 * Журнал — единственное, что останется от заявки: сама она исчезнет, а он
 * только дописывается и не стирается ни из интерфейса, ни из кода. Поэтому
 * запись обязана читаться САМА ПО СЕБЕ, без похода в заявку, которой уже нет:
 * кто клиент, на сколько была заявка, что в ней лежало и почему её убрали.
 */
export function describeDeletedOrder(input: {
  orderId: string;
  clientName: string;
  managerEmail: string;
  totalAmount: number;
  items: { variety: string; grade: string; quantity: number }[];
  reason: string;
}): string {
  const positions = input.items
    .map((i) => `${i.variety} ${i.grade} — ${i.quantity} шт.`)
    .join("; ");
  const parts = [
    `Удалена заявка ${input.orderId}`,
    `клиент: ${input.clientName || "не указан"}`,
    `менеджер: ${input.managerEmail || "не указан"}`,
    `сумма: ${Math.round(input.totalAmount).toLocaleString("ru-RU")} ₸`,
  ];
  if (positions) parts.push(`позиции: ${positions}`);
  parts.push(`причина: ${input.reason.trim()}`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Удаление администратором — В ТОМ ЧИСЛЕ с деньгами и отгрузкой (сентябрь 2026).
//
// Владелец: «сделай админам, чтобы можно было изменять и удалять заявки прямо
// там». Его решение: удалять всё — вместе с заявкой уходят её платежи и
// рекламации (деньги уходят из выручки), а если по заявке была отгрузка, сайт
// СПРАШИВАЕТ, что со стеблями:
//   - «вернуть на склад» — заявка была ошибочной, цветок никуда не ехал: строки
//     журнала отгрузок удаляются, стебли возвращаются в те же партии;
//   - «цветок уехал» — строки журнала остаются (иначе партии опустели бы без
//     следа — грабли 1.16) с пометкой «заявка удалена».
// Запрещено одно: удалять заявку, по которой Kaspi-счёт ещё ждёт оплаты, —
// клиент может заплатить, и деньги придут в пустоту. Сначала отменить счёт.
// ---------------------------------------------------------------------------

export type StockChoice = "return" | "keep";

export interface AdminDeleteInput {
  role: string | null | undefined;
  order: DeletableOrder & { totalAmount?: number };
  /** Строки журнала отгрузок этой заявки (с минусом — возвраты). */
  shipments: { batchId: string; quantity: number }[];
  payments: number;
  claims: number;
  /** Kaspi-счета по заявке, которые ещё ждут оплаты. */
  openKaspi: number;
  stock?: StockChoice | "";
}

export interface AdminDeleteSummary {
  shippedStems: number;
  paidAmount: number;
  payments: number;
  claims: number;
  /** Что вернуть в партии, если выбрано «вернуть на склад». */
  stockReturn: { batchId: string; quantity: number }[];
}

/** Что по заявке уже случилось — для окна подтверждения и для проверки сервера. */
export function adminDeleteSummary(input: Omit<AdminDeleteInput, "role" | "stock" | "openKaspi">): AdminDeleteSummary {
  const byBatch = new Map<string, number>();
  for (const s of input.shipments) byBatch.set(s.batchId, (byBatch.get(s.batchId) ?? 0) + (Number(s.quantity) || 0));
  const fromItems = input.order.items.reduce((sum, i) => sum + (Number(i.shippedQuantity) || 0), 0);
  const fromJournal = Array.from(byBatch.values()).reduce((a, b) => a + b, 0);
  return {
    shippedStems: Math.max(fromItems, fromJournal),
    paidAmount: Math.max(0, input.order.paidAmount),
    payments: input.payments,
    claims: input.claims,
    stockReturn: Array.from(byBatch.entries())
      .filter(([id, q]) => id && q > 0)
      .map(([batchId, quantity]) => ({ batchId, quantity })),
  };
}

/** Почему администратор НЕ может удалить; пустая строка — можно. */
export function adminDeleteRefusal(input: AdminDeleteInput): string {
  if (input.role !== ROLES.ADMIN) {
    return "Удалять заявки может только администратор. Обычный путь — отменить заявку.";
  }
  if (input.openKaspi > 0) {
    return "По заявке висит Kaspi-счёт, который ждёт оплаты. Сначала отмените его в панели оплаты — иначе клиент заплатит по заявке, которой нет.";
  }
  const s = adminDeleteSummary(input);
  if (s.shippedStems > 0 && input.stock !== "return" && input.stock !== "keep") {
    return "По заявке была отгрузка — выберите, вернуть стебли на склад или цветок уехал.";
  }
  return "";
}

/** Что именно уйдёт вместе с заявкой — одной фразой для журнала. */
export function describeAdminDeletion(
  s: AdminDeleteSummary,
  stock: StockChoice | "" | undefined,
  /** Сколько на самом деле вернулось в партии (у старых заявок отгрузка бывает без строки журнала). */
  returned?: number
): string {
  const parts: string[] = [];
  if (s.paidAmount > MONEY_EPSILON) {
    parts.push(`из выручки ушло ${Math.round(s.paidAmount).toLocaleString("ru-RU")} ₸${s.payments ? ` (платежей: ${s.payments})` : ""}`);
  }
  if (s.claims > 0) parts.push(`рекламаций удалено: ${s.claims}`);
  if (s.shippedStems > 0) {
    parts.push(
      stock === "return"
        ? returned !== undefined && returned < s.shippedStems
          ? `возвращено на склад ${returned.toLocaleString("ru-RU")} из ${s.shippedStems.toLocaleString("ru-RU")} шт. (остальное без партии в журнале)`
          : `${s.shippedStems.toLocaleString("ru-RU")} шт. возвращено на склад`
        : `${s.shippedStems.toLocaleString("ru-RU")} шт. отгружено — цветок уехал, склад не трогали`
    );
  }
  return parts.join(" · ");
}
