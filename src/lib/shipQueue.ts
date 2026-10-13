/**
 * Очередь на отгрузку по дню доставки: «Опаздывают / Сегодня / Завтра / Позже».
 *
 * Список уже отсортирован (`byUrgency`), группы только разрезают его подписями —
 * зав. складом с телефона видит, что горит, не читая дат. Заявка без даты
 * доставки — отдельной группой в конце: ей ещё надо назначить день.
 */
export type DeliveryGroupKey = "late" | "today" | "tomorrow" | "later" | "nodate";

export const DELIVERY_GROUP_LABELS: Record<DeliveryGroupKey, string> = {
  late: "Опаздывают",
  today: "Сегодня",
  tomorrow: "Завтра",
  later: "Позже",
  nodate: "Без даты доставки",
};

const ORDER: DeliveryGroupKey[] = ["late", "today", "tomorrow", "later", "nodate"];

/** Следующий день после «ГГГГ-ММ-ДД» — по календарю, без часовых поясов. */
export function nextDayKey(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + 1));
  return t.toISOString().slice(0, 10);
}

export function deliveryGroup(deliveryDate: string | null | undefined, today: string): DeliveryGroupKey {
  const day = String(deliveryDate ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "nodate";
  if (day < today) return "late";
  if (day === today) return "today";
  if (day === nextDayKey(today)) return "tomorrow";
  return "later";
}

/** Разрезать список на группы, сохранив порядок внутри каждой; пустые группы не возвращаются. */
export function groupByDelivery<T extends { deliveryDate: string }>(
  orders: T[],
  today: string
): { key: DeliveryGroupKey; label: string; orders: T[] }[] {
  const groups = new Map<DeliveryGroupKey, T[]>();
  for (const o of orders) {
    const k = deliveryGroup(o.deliveryDate, today);
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  return ORDER.filter((k) => groups.has(k)).map((k) => ({
    key: k,
    label: DELIVERY_GROUP_LABELS[k],
    orders: groups.get(k)!,
  }));
}
