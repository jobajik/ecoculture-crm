import { compareGrades, formatGrade, FLOWER_TYPE_LABELS } from "./constants";
import { priceKey, type PriceRow } from "./priceList";

// ---------------------------------------------------------------------------
// Каталог для клиентов — картинка JPEG на каждый цветок (владелец, 01.10.2026:
// «каталог в формате JPEG, который ты будешь рассылать: красиво, в светлых
// тонах, прайс с цветком, фотографии с теплицы»). Решение владельца: каталог
// ЖИВОЙ — собирается из действующего прайса и склада в момент запроса, поэтому
// старых цен в нём не бывает. Здесь — чистые правила (что попадает на страницу);
// рисует `catalogImage.tsx`, отдаёт `/api/catalog/<цветок>`. Проверка —
// `scripts/check-bot-photos.ts`.
// ---------------------------------------------------------------------------

export const CATALOG_FLOWERS = ["chrysanthemum", "rose", "eustoma"] as const;

/** Сорта с одинаковыми ценами — одна карточка; цены — по градациям. */
export interface CatalogGroup {
  varieties: string[];
  inStock: boolean;
  prices: { grade: string; label: string; price: number }[];
}

export interface CatalogPage {
  flowerType: string;
  title: string;
  groups: CatalogGroup[];
}

/** На складе «есть», если позиции хотя бы столько — меньше клиенту обещать неловко. */
const IN_STOCK_MIN = 50;

/**
 * Страница каталога по цветку. Сорта — те, у кого есть своя цена, и те, что
 * лежат на складе (они продаются по общей цене «Все сорта»). У сорта цена по
 * каждой градации: своя или общая. Сорта с одинаковым набором цен — одной
 * карточкой; сначала то, что есть на складе. Нет ни одной цены — страницы нет.
 */
export function catalogPage(input: {
  flowerType: string;
  prices: Map<string, PriceRow>;
  stock: { flower: string; variety: string; grade: string; qty: number }[];
}): CatalogPage | null {
  const { flowerType: f, prices } = input;
  const rows = Array.from(prices.values()).filter((r) => r.flowerType === f && r.price > 0);
  if (rows.length === 0) return null;
  const stock = input.stock.filter((s) => s.flower === f && s.qty > 0);
  const grades = Array.from(new Set(rows.map((r) => r.grade))).sort((a, b) => compareGrades(f, a, b));
  const own = Array.from(new Set(rows.filter((r) => r.variety).map((r) => r.variety)));
  const stocked = Array.from(new Set(stock.map((s) => s.variety).filter(Boolean)));
  const hasBase = rows.some((r) => !r.variety);
  const varieties = Array.from(new Set([...own, ...(hasBase ? stocked : [])])).sort((a, b) => a.localeCompare(b, "ru"));
  const priceOf = (v: string, g: string) => {
    const p = prices.get(priceKey(f, v, g));
    if (p && p.price > 0) return p.price;
    return prices.get(priceKey(f, "", g))?.price ?? 0;
  };
  const inStock = (v: string) => stock.filter((s) => s.variety === v).reduce((n, s) => n + s.qty, 0) >= IN_STOCK_MIN;

  const byVector = new Map<string, CatalogGroup>();
  const order: string[] = [];
  for (const v of varieties) {
    const list = grades.map((g) => ({ grade: g, label: formatGrade(g), price: priceOf(v, g) })).filter((x) => x.price > 0);
    if (list.length === 0) continue;
    const key = `${inStock(v) ? 1 : 0}|${list.map((x) => `${x.grade}:${x.price}`).join("/")}`;
    const found = byVector.get(key);
    if (found) found.varieties.push(v);
    else {
      byVector.set(key, { varieties: [v], inStock: inStock(v), prices: list });
      order.push(key);
    }
  }
  // Сортов нет вовсе (только общая цена) — одна карточка «Все сорта».
  if (byVector.size === 0 && hasBase) {
    const list = grades.map((g) => ({ grade: g, label: formatGrade(g), price: priceOf("", g) })).filter((x) => x.price > 0);
    if (list.length) {
      byVector.set("base", { varieties: ["Все сорта"], inStock: stock.reduce((n, s) => n + s.qty, 0) >= IN_STOCK_MIN, prices: list });
      order.push("base");
    }
  }
  const groups = order
    .map((k) => byVector.get(k)!)
    .sort((a, b) => Number(b.inStock) - Number(a.inStock) || b.varieties.length - a.varieties.length);
  if (groups.length === 0) return null;
  return { flowerType: f, title: FLOWER_TYPE_LABELS[f] ?? f, groups };
}

/** Какие цветы есть в каталоге: по порядку, только с ценами. */
export function catalogFlowers(prices: Map<string, PriceRow>): string[] {
  return CATALOG_FLOWERS.filter((f) => Array.from(prices.values()).some((r) => r.flowerType === f && r.price > 0));
}

/** Слово из разговора модели («роза», «rose», «хризантемы») → код цветка; пусто — все. */
export function catalogFlowerOf(raw: string): string {
  const t = String(raw || "").toLowerCase();
  if (/хриз|chrys/.test(t)) return "chrysanthemum";
  if (/эуст|eust|лизиант/.test(t)) return "eustoma";
  if (/роз|rose/.test(t)) return "rose";
  return "";
}

/**
 * Примерная высота страницы (Satori рисует в заданный размер): шапка, фото,
 * карточки сортов (строки названий и цен), подвал. С запасом — пустое место
 * внизу лучше обрезанной карточки.
 */
export function catalogPageHeight(page: CatalogPage, gallery: number, hasHero = true): number {
  let h = hasHero ? 1020 : 700; // поля, шапка, большое фото (без фото — плашка), заголовок прайса, подвал
  if (gallery > 0) h += 300;
  for (const g of page.groups) {
    const names = g.varieties.join(", ");
    const nameLines = Math.max(1, Math.ceil(names.length / 40));
    const chipRows = Math.ceil(g.prices.length / 4);
    h += 90 + nameLines * 40 + chipRows * 72 + 18;
  }
  return Math.max(hasHero ? 1350 : 1080, Math.min(5000, Math.round(h)));
}
