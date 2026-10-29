import { HARVEST_GRADES, type LogKind } from "./production";

/**
 * «Внести день» (29.10.2026, владелец: «не нравятся эти вкладки — переделать и визуально, и по логике ведения»;
 * выбрал «один ввод за день»). Ответственный открывает день и вносит всё сразу: срезку, брак, черенкование и кто
 * сколько сделал, — и сохраняет одной кнопкой. Здесь чистые правила этого сохранения; запись — `saveGreenhouseDay`.
 *
 * Главное правило — удалять только то, что человек ВИДЕЛ: браузер присылает номера строк, которые были на экране
 * (`known`), и удаляются лишь те из них, которых в присланном больше нет. Строку, которую за это время записал другой
 * человек, сохранение не тронет.
 */

export const DAY_SECTIONS = ["harvest", "waste", "cuttings", "people"] as const;
export type DaySection = (typeof DAY_SECTIONS)[number];

export const DAY_SECTION_LABELS: Record<DaySection, string> = {
  harvest: "Срезка",
  waste: "Брак",
  cuttings: "Черенкование",
  people: "Выработка",
};

export function isDaySection(v: unknown): v is DaySection {
  return DAY_SECTIONS.includes(v as DaySection);
}

export interface DayPlan<T> {
  add: T[];
  update: T[];
  /** Номера строк, которые убрать. */
  remove: string[];
  error: string;
}

/**
 * Что сделать с журналом дня: строки без номера — новые, с номером — правка (номер обязан быть среди строк этого дня),
 * удаляются строки из `known`, которых в присланном нет.
 */
export function planDayRows<T>(existingIds: string[], rows: T[], idOf: (r: T) => string, known: string[]): DayPlan<T> {
  const existing = new Set(existingIds);
  const seen = new Set<string>();
  const add: T[] = [];
  const update: T[] = [];
  for (const r of rows) {
    const id = idOf(r).trim();
    if (!id) {
      add.push(r);
      continue;
    }
    if (!existing.has(id)) return { add: [], update: [], remove: [], error: "Одну из записей этого дня уже удалили или перенесли на другой день — обновите страницу." };
    if (seen.has(id)) return { add: [], update: [], remove: [], error: "Одна запись пришла дважды — обновите страницу." };
    seen.add(id);
    update.push(r);
  }
  const remove = known.map((k) => k.trim()).filter((k) => k && existing.has(k) && !seen.has(k));
  return { add, update, remove: Array.from(new Set(remove)), error: "" };
}

/** Следующая категория срезки после этой: сорт режут подряд «Высшая, Первая, Вторая…». Последняя — остаётся. */
export function nextGrade(grade: string, used: string[] = []): string {
  const order = HARVEST_GRADES;
  const i = order.indexOf(grade);
  const taken = new Set(used);
  for (let j = Math.max(0, i + 1); j < order.length; j++) if (!taken.has(order[j])) return order[j];
  return i >= 0 ? order[i] : order[0];
}

/** Итог раздела дня для плиток: штук и строк. Брак и черенкование — тоже штуками. */
export function sectionTotal(rows: { qty: number | string }[]): { qty: number; rows: number } {
  let qty = 0;
  let n = 0;
  for (const r of rows) {
    const v = Number(String(r.qty).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) continue;
    qty += v;
    n += 1;
  }
  return { qty, rows: n };
}

export const LOG_OF_SECTION: Partial<Record<DaySection, LogKind>> = { harvest: "harvest", waste: "waste", cuttings: "cuttings" };

/** Блок на странице дня: цикл, который на нём в этот день, состояние и сорта этого цикла (первыми в выборе сорта). */
export interface DayBlock {
  block: string;
  cycle: number;
  status: string;
  statusLabel: string;
  varieties: string[];
}

/** Строка журнала в браузере. */
export interface DayLogRow {
  id: string;
  cycle: number;
  block: string;
  variety: string;
  kind: string;
  qty: number;
  weightKg: number;
  part: string;
  line: string;
  note: string;
}

/** Блок, с которого открыть день: где сегодня больше всего записей, иначе первый, что режется, иначе первый. */
export function defaultDayBlock(blocks: DayBlock[], rows: { block: string }[], asked?: string): string {
  if (asked && blocks.some((b) => b.block === asked)) return asked;
  const count = new Map<string, number>();
  for (const r of rows) count.set(r.block, (count.get(r.block) ?? 0) + 1);
  let best = "";
  let bestN = 0;
  for (const b of blocks) {
    const n = count.get(b.block) ?? 0;
    if (n > bestN) {
      best = b.block;
      bestN = n;
    }
  }
  if (best) return best;
  return blocks.find((b) => b.status === "harvest")?.block ?? blocks[0]?.block ?? "";
}
