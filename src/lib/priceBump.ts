import { BASE_VARIETY, priceKey, type PriceRow } from "./priceList";

/**
 * Поднять (или опустить) прайс разом на сумму — «роза +10 ₸ на все виды и ростовки, эустома Стандарт +100 ₸»
 * (23.11.2026, владелец). В прайсе цена лежит строками «цветок · сорт · длина»: общая «Все сорта» и отдельные цены
 * сортов, которые её перебивают. Двигаются ОБЕ: поднять только общую — сорта со своей ценой останутся на старой.
 *
 * Правила: трогаем только строки с ценой (ноль — «цены нет», прибавка сделала бы из пустоты цену 10 ₸); взятые у
 * другого цветка (`borrowedFrom`) не пишем — они сдвинутся сами вместе с источником или не должны сдвигаться вовсе;
 * цена не может стать нулём или минусом. Модуль чистый — проверка `scripts/check-price-bump.ts`.
 *
 * 26.11.2026 — «поменяй прайс на эустому 50 см на 250 тенге за стебель»: правило может не прибавлять, а СТАВИТЬ цену
 * (`set`). Ставится всем строкам этой длины — общей и сортам со своей ценой: иначе сорт остался бы на старой и перебил
 * новую общую. Строка, где цена уже такая, не пишется, но правило пустым не считается.
 */
export interface BumpRule {
  flowerType: string;
  /** Пусто — все длины и категории этого цветка. */
  grade?: string;
  /** На сколько тенге изменить цену стебля (минус — опустить). */
  delta?: number;
  /** Или поставить цену стебля — вместо `delta`. */
  set?: number;
}

export interface BumpLine {
  flowerType: string;
  variety: string;
  grade: string;
  before: number;
  after: number;
}

export function planPriceBump(prices: Map<string, PriceRow>, rules: BumpRule[]): { lines: BumpLine[]; empty: BumpRule[] } | string {
  const lines = new Map<string, BumpLine>();
  const empty: BumpRule[] = [];
  for (const rule of rules) {
    const setting = rule.set !== undefined && rule.set !== null;
    if (setting && rule.delta) return "В правиле что-то одно: прибавить (delta) или поставить цену (set)";
    const delta = Number(rule.delta);
    const target = Number(rule.set);
    if (!rule.flowerType) return "В правиле нужен цветок";
    if (setting ? !(Number.isFinite(target) && target > 0) : !Number.isFinite(delta) || delta === 0) return setting ? "Цена должна быть больше нуля" : "В правиле нужен цветок и сумма, отличная от нуля";
    let hit = 0;
    for (const row of prices.values()) {
      if (row.flowerType !== rule.flowerType || row.borrowedFrom || !(row.price > 0)) continue;
      if (rule.grade && row.grade !== rule.grade) continue;
      const key = priceKey(row.flowerType, row.variety, row.grade);
      if (lines.has(key)) return `Позиция «${row.variety || "Все сорта"} · ${row.grade}» попала в два правила — уберите пересечение`;
      const after = Math.round((setting ? target : row.price + delta) * 100) / 100;
      // Цена уже такая — писать нечего, но позиция найдена.
      if (after === row.price) {
        hit++;
        continue;
      }
      if (!(after > 0)) return `«${row.variety || "Все сорта"} · ${row.grade}»: цена ${row.price} ₸ после изменения на ${delta} ₸ стала бы не больше нуля`;
      lines.set(key, { flowerType: row.flowerType, variety: row.variety, grade: row.grade, before: row.price, after });
      hit++;
    }
    if (hit === 0) empty.push(rule);
  }
  const list = Array.from(lines.values()).sort(
    (a, b) => a.flowerType.localeCompare(b.flowerType) || Number(a.variety !== BASE_VARIETY) - Number(b.variety !== BASE_VARIETY) || a.variety.localeCompare(b.variety, "ru") || a.grade.localeCompare(b.grade, "ru", { numeric: true })
  );
  return { lines: list, empty };
}

const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const moneyDigits = (n: number) => Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ");

/**
 * Уже собранные, но ещё не ушедшие тексты рассылок: строка позиции «• Эустома Corelli Pink, 50 см — *150 ₸*» с ПРЕЖНЕЙ
 * ценой получает новую. Прайс меняют среди дня, а план автопилота собран в 9:00 — без этого клиенту ушла бы цена, которой
 * уже нет, а бот на его ответ назвал бы другую. Трогается только строка, где стоит именно прежняя цена этой позиции;
 * `names` — как программа пишет цветок и длину в тексте («Эустома», «50 см»).
 */
export function repriceText(text: string, lines: BumpLine[], names: { flower: (flowerType: string) => string; grade: (grade: string) => string }): string {
  if (!text || !lines.length) return text;
  const groups = new Map<string, BumpLine[]>();
  for (const l of lines) groups.set(`${l.flowerType}|${l.grade}`, [...(groups.get(`${l.flowerType}|${l.grade}`) ?? []), l]);
  return text
    .split("\n")
    .map((row) => {
      if (!row.includes("₸")) return row;
      for (const list of Array.from(groups.values())) {
        const re = new RegExp(`^(\\s*[•·▪-]?\\s*${esc(names.flower(list[0].flowerType))}\\s+)(.*?)(,\\s*${esc(names.grade(list[0].grade))}\\s*[—–-]\\s*\\*?)(\\d(?:[\\d\\s\\u00a0\\u202f]*\\d)?)(\\s*₸)`, "iu");
        const m = re.exec(row);
        if (!m) continue;
        const variety = m[2].trim();
        const line = list.find((l) => l.variety === variety) ?? list.find((l) => l.variety === BASE_VARIETY);
        if (!line || Number(m[4].replace(/[^\d]/g, "")) !== Math.round(line.before)) continue;
        return row.replace(re, `$1$2$3${moneyDigits(line.after)}$5`);
      }
      return row;
    })
    .join("\n");
}
