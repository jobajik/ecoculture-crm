/**
 * Цены из прайса прямо в тексте рассылки (октябрь 2026, владелец: «текст для
 * рассылки клиентам хризантемы, цены бот должен взять из базы»). В тексте пишут
 * `{цены хризантема}` (или «розы», «эустома») — при отправке вместо метки встаёт
 * действующий клиентский прайс этого цветка. Цена не вбивается руками в текст и
 * не расходится с прайсом, который видят менеджеры и бот.
 *
 * Как складывается блок: у большинства сортов цена одна — она идёт строкой на
 * категорию («• Высшая — 490 ₸»); сорта с особой ценой — отдельной строкой ниже
 * («Altaj: Высшая 580 · Первая 530 ₸»). Сорт без своей цены живёт по общей
 * «Все сорта». Чистые функции: их зовёт сервер при отправке и форма для
 * предпросмотра (грабли 1.8).
 */
import { FLOWER_TYPE_LABELS, compareGrades, formatGrade } from "./constants";
import { BASE_VARIETY, priceKey } from "./priceList";

const ACCUSATIVE: Record<string, string> = { rose: "розу", chrysanthemum: "хризантему", eustoma: "эустому" };

/**
 * `{цены хризантема}` — весь прайс цветка; `{цены хризантема Altaj}` — только один
 * сорт (владелец, 01.10: «слишком громоздко, оставь только цены на Алтай»).
 * Сорт пишется как в прайсе, регистр не важен.
 */
export const PRICE_TAG_RE = /\{\s*цены\s+([а-яё]+)(?:\s+([^{}]+?))?\s*\}/gi;

/** «хризантема», «хризантемы», «Розы» → код цветка; незнакомое — пусто. */
export function flowerOfTag(word: string): string {
  const w = word.toLowerCase().replace(/ё/g, "е");
  if (w.startsWith("хриз")) return "chrysanthemum";
  if (w.startsWith("роз")) return "rose";
  if (w.startsWith("эуст")) return "eustoma";
  return "";
}

/** Какие цветы упомянуты метками в тексте. */
export function priceTagFlowers(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text || "").matchAll(PRICE_TAG_RE)) out.add(flowerOfTag(m[1]) || `?${m[1]}`);
  return Array.from(out);
}

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

/**
 * Цены одного сорта строкой на категорию: «• Высшая — 580 ₸». Своей цены нет —
 * берётся общая «Все сорта». Сорт ищется без учёта регистра; не нашёлся — пусто.
 */
export function varietyPriceBlock(flowerType: string, variety: string, prices: Record<string, number>): string {
  const want = variety.trim().toLowerCase().replace(/ё/g, "е");
  const prefix = `${flowerType}|`;
  let name = "";
  const grades = new Set<string>();
  for (const [key, price] of Object.entries(prices)) {
    if (!key.startsWith(prefix) || !(price > 0)) continue;
    const [, v, g] = key.split("|");
    grades.add(g);
    if (v && v.toLowerCase().replace(/ё/g, "е") === want) name = v;
  }
  if (!name) return "";
  return Array.from(grades)
    .sort((a, b) => compareGrades(flowerType, a, b))
    .map((g) => {
      const own = prices[priceKey(flowerType, name, g)] ?? 0;
      const p = own > 0 ? own : prices[priceKey(flowerType, BASE_VARIETY, g)] ?? 0;
      return p > 0 ? `• ${formatGrade(g)} — ${money(p)}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Блок цен цветка из действующего прайса. `prices` — позиции «цветок|сорт|длина»
 * → цена (ноль и отсутствие — «цены нет»). Пусто — цен на цветок нет вовсе.
 */
export function priceBlock(flowerType: string, prices: Record<string, number>): string {
  const prefix = `${flowerType}|`;
  const varieties = new Set<string>();
  const grades = new Set<string>();
  for (const [key, price] of Object.entries(prices)) {
    if (!key.startsWith(prefix) || !(price > 0)) continue;
    const [, variety, grade] = key.split("|");
    if (variety !== BASE_VARIETY) varieties.add(variety);
    grades.add(grade);
  }
  if (grades.size === 0) return "";
  const gradeList = Array.from(grades).sort((a, b) => compareGrades(flowerType, a, b));
  const effective = (variety: string, grade: string) => {
    const own = prices[priceKey(flowerType, variety, grade)] ?? 0;
    return own > 0 ? own : prices[priceKey(flowerType, BASE_VARIETY, grade)] ?? 0;
  };

  // Общая цена «Все сорта» — тоже участник: ею живут сорта без своей цены.
  const members = [BASE_VARIETY, ...Array.from(varieties)];
  const groups = new Map<string, string[]>();
  for (const v of members) {
    const vector = gradeList.map((g) => effective(v, g));
    if (vector.every((p) => !(p > 0))) continue;
    const key = vector.join("/");
    groups.set(key, [...(groups.get(key) ?? []), v]);
  }
  const ordered = Array.from(groups.entries()).sort((a, b) => b[1].length - a[1].length);
  if (ordered.length === 0) return "";

  const [mainKey] = ordered[0];
  const main = mainKey.split("/").map(Number);
  const lines = gradeList.map((g, i) => (main[i] > 0 ? `• ${formatGrade(g)} — ${money(main[i])}` : "")).filter(Boolean);
  for (const [key, vs] of ordered.slice(1)) {
    const vector = key.split("/").map(Number);
    const names = vs.map((v) => (v === BASE_VARIETY ? "остальные сорта" : v)).join(", ");
    const parts = gradeList.map((g, i) => (vector[i] > 0 ? `${formatGrade(g)} ${Math.round(vector[i]).toLocaleString("ru-RU")}` : "")).filter(Boolean);
    lines.push(`• ${names}: ${parts.join(" · ")} ₸`);
  }
  return lines.join("\n");
}

/** Подставляет блоки цен вместо меток. Метка без цен остаётся как есть — её поймает `priceTagsRefusal`. */
export function fillPrices(text: string, prices: Record<string, number>): string {
  return String(text || "").replace(PRICE_TAG_RE, (whole, word: string, variety?: string) => {
    const flower = flowerOfTag(word);
    const block = !flower ? "" : variety ? varietyPriceBlock(flower, variety, prices) : priceBlock(flower, prices);
    return block || whole;
  });
}

/** Отказ до создания рассылки: метка незнакомого цветка или цветка без цен в прайсе. */
export function priceTagsRefusal(text: string, prices: Record<string, number>): string {
  for (const m of String(text || "").matchAll(PRICE_TAG_RE)) {
    const f = flowerOfTag(m[1]);
    const variety = (m[2] || "").trim();
    if (f && variety && !varietyPriceBlock(f, variety, prices)) {
      return `В прайсе нет цен на сорт «${variety}» — проверьте написание, как в прайсе`;
    }
  }
  for (const f of priceTagFlowers(text)) {
    if (f.startsWith("?")) return `Не понял метку {цены ${f.slice(1)}} — пишите {цены роза}, {цены хризантема} или {цены эустома}`;
    if (!priceBlock(f, prices)) return `В прайсе нет цен на ${ACCUSATIVE[f] ?? (FLOWER_TYPE_LABELS[f] ?? f).toLowerCase()} — заполните прайс или уберите метку`;
  }
  return "";
}
