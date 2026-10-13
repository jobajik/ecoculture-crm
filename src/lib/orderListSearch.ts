import { matchesOrderSearch } from "./paymentStage";

/**
 * Поиск в списке «Заявки». Основа — тот же `matchesOrderSearch`, что в «Оплатах»
 * (клиент, менеджер, короткий номер, сумма), плюс то, что знает менеджер:
 * телефон клиента и сорт из позиций. Имя менеджера — по-человечески (из Users),
 * почта тоже находит.
 */
export function matchesOrderListSearch(
  order: {
    orderId: string;
    clientName: string;
    clientPhone?: string;
    managerEmail: string;
    totalAmount: number;
    items: { variety: string }[];
  },
  managerName: string,
  query: string
): boolean {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return true;
  if (
    matchesOrderSearch(
      {
        orderId: order.orderId,
        clientName: order.clientName || "",
        managerName: `${managerName || ""} ${order.managerEmail || ""}`,
        amount: order.totalAmount,
      },
      q
    )
  ) {
    return true;
  }
  if (order.items.some((i) => (i.variety || "").toLowerCase().includes(q))) return true;

  // Телефон: от четырёх цифр, «8 701…» и «+7 701…» — одно и то же.
  const qd = q.replace(/\D/g, "");
  if (qd.length >= 4 && qd.length === q.replace(/[\s()+-]/g, "").length) {
    const pd = (order.clientPhone || "").replace(/\D/g, "");
    if (pd.includes(qd)) return true;
    if (qd.startsWith("8") && qd.length >= 5 && pd.includes(`7${qd.slice(1)}`)) return true;
  }
  return false;
}
