import { FLOWER_TYPE_LABELS, formatGrade } from "./constants";

/**
 * «Распродаём в первую очередь» (13.10.2026, владелец: «надо, чтобы ты усиленно распродал 4 категорию по хризантеме,
 * её много — сделай всё, чтобы продавать её»; на складе 44 тыс. свежей и 8,5 тыс. старше срока, за 30 дней продали
 * 3,3 тыс.). Решения владельца: цена прайса для небольших заказов, от 1 000 шт. — 160 ₸; бот предлагает её первой;
 * менеджерам — строка на главной и в утренней сводке; текст идущей рассылки — про неё.
 *
 * Что распродаём — настройка `SalesPush` во вкладке Settings, JSON-список:
 *   [{"flowerType":"chrysanthemum","grade":"Четвёртая","bulkFrom":1000,"bulkPrice":160}]
 * Пустая или испорченная настройка — распродажи нет (ничего не ломается). Ставит и снимает
 * `scripts/sales-push.ts`.
 */
export const SALES_PUSH_SETTING = "SalesPush";

export interface PushItem {
  flowerType: string;
  grade: string;
  /** С какого количества в заказе действует цена опта (0 — скидки нет). */
  bulkFrom: number;
  bulkPrice: number;
}

export function parsePush(raw: string | undefined): PushItem[] {
  if (!raw || !raw.trim()) return [];
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .map((x) => x as Record<string, unknown>)
      .filter((x) => typeof x.flowerType === "string" && typeof x.grade === "string" && x.flowerType && x.grade)
      .map((x) => ({
        flowerType: String(x.flowerType),
        grade: String(x.grade),
        bulkFrom: Math.max(0, Math.round(Number(x.bulkFrom) || 0)),
        bulkPrice: Math.max(0, Math.round(Number(x.bulkPrice) || 0)),
      }));
  } catch {
    return [];
  }
}

const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");

export function pushItemFor(items: PushItem[], flowerType: string, grade: string): PushItem | null {
  return items.find((p) => p.flowerType === flowerType && norm(p.grade) === norm(grade)) ?? null;
}

/**
 * Цена стебля в заказе с учётом распродажи: от `bulkFrom` штук этой позиции — цена опта, если она ниже прайса.
 * Не распродажа или мало штук — цена прайса как есть.
 */
export function pushUnitPrice(items: PushItem[], flowerType: string, grade: string, quantity: number, listPrice: number): number {
  const p = pushItemFor(items, flowerType, grade);
  if (!p || !(p.bulkFrom > 0) || !(p.bulkPrice > 0) || quantity < p.bulkFrom) return listPrice;
  return listPrice > 0 ? Math.min(listPrice, p.bulkPrice) : p.bulkPrice;
}

export interface PushLine {
  flowerType: string;
  grade: string;
  label: string;
  /** Живого (не просроченного) на складе, шт. */
  qty: number;
  /** Сорта по убыванию остатка с ценой прайса. */
  varieties: { variety: string; qty: number; price: number }[];
  bulkFrom: number;
  bulkPrice: number;
}

/** Что сейчас распродаём и сколько этого на складе — для подсказки бота, главной и сводки. */
export function pushLines(
  items: PushItem[],
  stock: { flower: string; variety: string; grade: string; qty: number }[],
  priceOf: (flowerType: string, variety: string, grade: string) => number
): PushLine[] {
  return items.map((p) => {
    const rows = stock.filter((s) => s.flower === p.flowerType && norm(s.grade) === norm(p.grade) && s.qty > 0);
    const varieties = rows
      .map((s) => ({ variety: s.variety, qty: s.qty, price: priceOf(s.flower, s.variety, s.grade) }))
      .sort((a, b) => b.qty - a.qty);
    return {
      flowerType: p.flowerType,
      grade: p.grade,
      label: `${FLOWER_TYPE_LABELS[p.flowerType] ?? p.flowerType}, ${p.flowerType === "chrysanthemum" ? `${p.grade.toLowerCase()} категория` : formatGrade(p.grade)}`,
      qty: rows.reduce((s, r) => s + r.qty, 0),
      varieties,
      bulkFrom: p.bulkFrom,
      bulkPrice: p.bulkPrice,
    };
  });
}

const n = (v: number) => Math.round(v).toLocaleString("ru-RU").replace(/\s/g, " ");
/** Остаток для людей: вниз до сотен (точное число бот не называет). */
const about = (v: number) => (v >= 1000 ? `около ${n(Math.floor(v / 1000) * 1000)}` : v >= 100 ? `около ${n(Math.floor(v / 100) * 100)}` : n(v));

/** Одна строка для человека: «Хризантема, 4 категория — около 44 000 шт.: Altaj 180 ₸ …; от 1 000 шт. — 160 ₸». */
export function pushLineText(line: PushLine): string {
  const vars = line.varieties
    .slice(0, 4)
    .map((v) => `${v.variety}${v.price > 0 ? ` ${n(v.price)} ₸` : ""}`)
    .join(", ");
  const bulk = line.bulkFrom > 0 && line.bulkPrice > 0 ? `; от ${n(line.bulkFrom)} шт. — ${n(line.bulkPrice)} ₸` : "";
  return `${line.label} — ${about(line.qty)} шт.${vars ? `: ${vars}` : ""}${bulk}`;
}

/** Блок подсказки бота. Пусто — распродажи нет или позиции уже нет на складе. */
export function pushPromptBlock(lines: PushLine[]): string {
  const live = lines.filter((l) => l.qty >= 50);
  if (live.length === 0) return "";
  return [
    "РАСПРОДАЁМ В ПЕРВУЮ ОЧЕРЕДЬ (указание владельца, этого много на складе):",
    ...live.map((l) => `• ${pushLineText(l)}`),
    ...live
      .filter((l) => l.bulkFrom > 0 && l.bulkPrice > 0)
      .map(
        (l) =>
          `ЦЕНА ОТ ОБЪЁМА: ${l.label} от ${n(l.bulkFrom)} шт. в заказе — ${n(l.bulkPrice)} ₸ за КАЖДЫЙ стебель этой позиции (не прайс). ` +
          `Сумму такого заказа считай по ${n(l.bulkPrice)} ₸ и скажи, что это цена от объёма.`
      ),
    "Как продавать это:",
    "- Клиент спрашивает о хризантеме вообще, о наличии, о ценах или просит «подешевле» — предложи ЭТО первым, с фото (photo этой",
    "  позицией), ценой и одним конкретным количеством; одной короткой фразой скажи, что есть и другие категории.",
    "  Цену от объёма называй сам: «от N шт. — X ₸ за стебель».",
    "- «Дорого» на любую позицию — предложи это как выгодную замену, посчитай сумму.",
    "- Клиент выбрал другое — один раз предложи добавить это к той же доставке (для витрины, на объём, в букеты подешевле).",
    "- Клиент назвал конкретную позицию и количество — оформляй её, не переубеждай.",
    "- Не называй это «неликвидом», «остатками» или «уценкой»: это срез своей теплицы по выгодной цене.",
  ].join("\n");
}

/** Сколько распродаваемой позиции продано за дни [from, to] (день оформления; какие заявки считать — решает `isSale`). */
export function pushSold<O extends { status: string; createdAt: string; items: { flowerType: string; grade: string; quantity: number }[] }>(
  item: Pick<PushItem, "flowerType" | "grade">,
  orders: O[],
  from: string,
  to: string,
  dayOf: (iso: string) => string,
  isSale: (o: O) => boolean
): number {
  let stems = 0;
  for (const o of orders) {
    if (o.status === "cancelled" || !o.createdAt || !isSale(o)) continue;
    const day = dayOf(o.createdAt);
    if (day < from || day > to) continue;
    for (const it of o.items) if (it.flowerType === item.flowerType && norm(it.grade) === norm(item.grade)) stems += it.quantity;
  }
  return stems;
}
