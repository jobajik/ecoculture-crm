import { MONEY_EPSILON } from "./constants";
import { isNotASale } from "./orderKind";
import { dueDateOf } from "./debtReminder";
import type { OrderWithItems } from "./types";

/**
 * Как дела с деньгами по заявке — одной меткой (новый вид, 19.10.2026): «Оплачено», «Частично», «Ждём оплату»,
 * «Просрочено». Просрочено — срок прошёл: день доставки (нет — оформления) плюс отсрочка из карточки клиента
 * (`dueDateOf`, то же правило, что у напоминаний о долгах). Отменённые, перемещения, точка и объём на город — без
 * счёта. Считается на сервере: правило живёт в модуле напоминаний, тащить его в браузер незачем.
 */
export type PayTone = "good" | "wait" | "bad" | "muted";

export interface PayState {
  tone: PayTone;
  label: string;
  /** Это продажа со счётом (не отменена, не перемещение). */
  sale: boolean;
  paid: number;
  debt: number;
  late: boolean;
}

export function orderPayState(o: OrderWithItems, today: string): PayState {
  if (o.status === "cancelled") return { tone: "muted", label: "Отменена", sale: false, paid: 0, debt: 0, late: false };
  if (isNotASale(o)) return { tone: "muted", label: "Без счёта", sale: false, paid: 0, debt: 0, late: false };
  const paid = Math.min(o.paidAmount, o.totalAmount);
  const rest = o.totalAmount - paid;
  if (rest <= MONEY_EPSILON) return { tone: "good", label: "Оплачено", sale: true, paid, debt: 0, late: false };
  const due = dueDateOf(o);
  const late = !!due && due < today;
  if (late) return { tone: "bad", label: "Просрочено", sale: true, paid, debt: rest, late };
  return { tone: "wait", label: paid > MONEY_EPSILON ? "Частично" : "Ждём оплату", sale: true, paid, debt: rest, late };
}
