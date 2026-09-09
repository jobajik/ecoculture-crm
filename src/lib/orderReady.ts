import { MONEY_EPSILON } from "./constants";

/**
 * Готовность заявки к отгрузке — одно правило на всю программу.
 *
 * Порядок в хозяйстве такой: менеджер согласовал заявку с клиентом и поставил
 * свою галочку, бухгалтер увидел деньги и провёл оплату, и только после этого
 * зав. складом собирает и отгружает. До этого заявка у неё висит в списке —
 * чтобы она знала, что готовится, — но отгрузить её нельзя.
 *
 * Раньше проверки не было нигде: кнопка «Отгрузить» стояла на новой, никем не
 * подтверждённой и неоплаченной заявке, и сервер такую отгрузку принимал. Это
 * значит, что цветок мог уехать к клиенту раньше денег.
 *
 * Правило живёт в одном файле, потому что спрашивают о нём в четырёх местах:
 * страница заявки, список склада, страница отгрузки и серверное действие.
 * Разъедься эти проверки по местам — рано или поздно одна отстанет, и дыра
 * вернётся именно там.
 */

export interface ShipGateOrder {
  managerConfirmed: boolean;
  paid: boolean;
  paidAmount: number;
  totalAmount: number;
}

/** Заявку можно отгружать. */
export function isReadyToShip(order: ShipGateOrder): boolean {
  return order.managerConfirmed && order.paid;
}

/**
 * Чего именно не хватает — короткими кусками, чтобы собрать фразу.
 * Пустой список означает, что заявка готова.
 */
export function missingForShip(order: ShipGateOrder): string[] {
  const missing: string[] = [];
  if (!order.managerConfirmed) missing.push("подтверждения менеджера");
  if (!order.paid) {
    const rest = order.totalAmount - order.paidAmount;
    // Частичная оплата — это тоже «не оплачено», но зав. складом полезно
    // видеть, что деньги уже идут, а не думать, что клиент молчит.
    missing.push(
      order.paidAmount > MONEY_EPSILON && rest > MONEY_EPSILON
        ? `остатка оплаты ${Math.round(rest).toLocaleString("ru-RU")} ₸`
        : "оплаты"
    );
  }
  return missing;
}

/**
 * Готовая фраза для человека: «Ждёт подтверждения менеджера и оплаты».
 * Для готовой заявки возвращает пустую строку.
 */
export function notReadyReason(order: ShipGateOrder): string {
  const missing = missingForShip(order);
  if (missing.length === 0) return "";
  return `Ждёт ${missing.join(" и ")}`;
}
