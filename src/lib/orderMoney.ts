import { FARM_LABELS, FARM_ORDER, MONEY_EPSILON, PAID_FIELD_BY_FARM, getFarmFor } from "./constants";

/**
 * Деньги по заявке в разрезе КОМПАНИЙ.
 *
 * Счёт клиенту выставляют два разных ТОО: розу и эустому продаёт Rose Farm,
 * хризантему — Есентай Агро Хим. В смешанной заявке счетов два, и клиент платит
 * двумя переводами. До этого в заявке была одна общая сумма «получено», и
 * бухгалтер не могла показать частый случай: одно ТОО деньги получило, второе
 * ещё нет. Внешне это выглядело как «оплачено наполовину» — то же самое, что
 * недоплата, хотя это совсем другая ситуация и разговор с клиентом другой.
 *
 * Всё здесь чистое и без обращений к таблице: это проверяет тест
 * (`scripts/check-accounting.ts`), а деньги — то, в чём ошибка дороже всего.
 */

export interface FarmMoney {
  farm: string;
  farmLabel: string;
  /** Куда в строке заявки писать полученное этой компанией. */
  field: "paidRoseFarm" | "paidEsentai";
  amount: number;
}

/** Строка заявки в объёме, нужном для счёта: тип цветка, сколько и почём. */
export interface InvoiceItem {
  flowerType: string;
  quantity: number;
  unitPrice: number;
}

const round2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

/**
 * Счёт по компаниям: сколько эта заявка стоит у Rose Farm и сколько у Есентая.
 *
 * Компанию НЕ выбирают руками — она однозначно следует из цветка. Возвращаются
 * только те компании, чей цветок в заявке есть: в заявке на одну розу второй
 * строки с нулём быть не должно, иначе бухгалтер каждый раз ищет глазами, какая
 * из двух строк настоящая.
 *
 * Порядок постоянный (`FARM_ORDER`), а не порядок позиций в заявке: список
 * компаний, который прыгает от заявки к заявке, читается медленнее.
 */
export function invoiceByFarm(items: InvoiceItem[]): FarmMoney[] {
  const sums = new Map<string, number>();
  for (const item of items) {
    const farm = getFarmFor(item.flowerType);
    if (!farm || !PAID_FIELD_BY_FARM[farm]) continue;
    const amount = (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
    sums.set(farm, (sums.get(farm) ?? 0) + amount);
  }
  return FARM_ORDER.filter((farm) => sums.has(farm)).map((farm) => ({
    farm,
    farmLabel: FARM_LABELS[farm] ?? farm,
    field: PAID_FIELD_BY_FARM[farm],
    amount: round2(sums.get(farm) ?? 0),
  }));
}

/**
 * Разложить общую сумму по компаниям пропорционально счёту.
 *
 * Нужно там, где сумму вносят одним числом: кнопка «оплачено целиком», снятие
 * оплаты, пересчёт по рекламации, и старые заявки, у которых разбивки в таблице
 * ещё нет. Остаток от округления отдаётся последней компании, чтобы сумма
 * частей ТОЧНО совпала с целым: разъехавшиеся на тенге числа в деньгах читаются
 * как ошибка, и её будут искать.
 */
export function spreadByInvoice(total: number, invoice: FarmMoney[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (invoice.length === 0) return out;

  const goal = round2(Math.max(0, Number(total) || 0));
  const sum = invoice.reduce((s, row) => s + row.amount, 0);
  let left = goal;

  invoice.forEach((row, idx) => {
    if (idx === invoice.length - 1) {
      out[row.farm] = round2(Math.max(0, left));
      return;
    }
    const part = sum > 0 ? round2((goal * row.amount) / sum) : 0;
    out[row.farm] = part;
    left = round2(left - part);
  });
  return out;
}

/**
 * Сколько по факту получено каждой компанией.
 *
 * Разбивке в таблице верим, только когда она сходится с общей суммой. Иначе это
 * либо старая заявка, заведённая до появления разбивки (там колонки пустые, а
 * деньги есть), либо сумму меняли одним числом — и показывать «получено 0 + 0»
 * при оплаченной заявке нельзя ни в том, ни в другом случае.
 */
export function paidByFarm(
  order: { paidAmount: number; paidRoseFarm: number; paidEsentai: number },
  invoice: FarmMoney[]
): FarmMoney[] {
  const total = Number(order.paidAmount) || 0;
  const split = (Number(order.paidRoseFarm) || 0) + (Number(order.paidEsentai) || 0);
  const trust = split > 0 && Math.abs(split - total) <= MONEY_EPSILON;
  const spread = spreadByInvoice(total, invoice);

  return invoice.map((row) => ({
    ...row,
    amount: trust ? round2(Number(order[row.field]) || 0) : (spread[row.farm] ?? 0),
  }));
}

/** Счёт и оплата рядом — то, с чем работает панель бухгалтера. */
export interface FarmPayment {
  farm: string;
  farmLabel: string;
  /** Счёт этой компании по заявке. */
  amount: number;
  /** Сколько по нему получено. */
  paidAmount: number;
}

export function farmPayments(
  order: { paidAmount: number; paidRoseFarm: number; paidEsentai: number; items: InvoiceItem[] }
): FarmPayment[] {
  const invoice = invoiceByFarm(order.items);
  const paid = paidByFarm(order, invoice);
  return invoice.map((row, idx) => ({
    farm: row.farm,
    farmLabel: row.farmLabel,
    amount: row.amount,
    paidAmount: paid[idx]?.amount ?? 0,
  }));
}
