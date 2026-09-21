// Порядок заявок на листе сборки. Отдельный файл без обращений к таблице:
// его зовёт и сервер (picklist.ts), и браузер (PicklistView) — грабли 1.8.
/**
 * Порядок заявок на листе: СВЕЖИЕ ПЕРВЫМИ, а не по алфавиту клиента.
 *
 * Просьба РОПа: «чтобы заявки, отбитые менеджером, выходили не в алфавитном
 * порядке, а по времени поступления — более поздние вверху». По алфавиту
 * только что пришедшая заявка терялась в середине листа, и понять, что
 * добавилось с утра, можно было лишь сверяя с прошлой распечаткой.
 *
 * Менеджеры тоже идут по свежести: первым — тот, чья заявка пришла последней.
 * Внутри менеджера — от новой к старой. При равном времени — по номеру, чтобы
 * порядок не прыгал между обновлениями страницы.
 */
export function byNewest(
  a: { createdAt: string; orderId: string },
  b: { createdAt: string; orderId: string }
): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.orderId < b.orderId ? 1 : a.orderId > b.orderId ? -1 : 0;
}

/** Заявки, сложенные по менеджерам: менеджер со свежей заявкой — первым. */
export function orderPicklistColumns<T extends { createdAt: string; orderId: string; managerEmail: string }>(
  orders: T[]
): T[] {
  const sorted = [...orders].sort(byNewest);
  const managers: string[] = [];
  for (const o of sorted) if (!managers.includes(o.managerEmail)) managers.push(o.managerEmail);
  return managers.flatMap((m) => sorted.filter((o) => o.managerEmail === m));
}
