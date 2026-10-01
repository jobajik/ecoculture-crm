import { FLOWER_TYPE_LABELS, compareGrades, formatGrade } from "./constants";
import { computeBatchStorageInfo } from "./shelfLife";
import type { Batch, Settings } from "./types";

// ---------------------------------------------------------------------------
// Что бот знает сам, без менеджера (владелец, 01.10.2026: «нужен бот по
// последней рассылке, который будет сам отвечать»). Первая неделя показала:
// бот передавал менеджеру вопросы «что есть в наличии», «пришлите каталог»,
// «есть скидки?» и молчал сутки, а менеджер не отвечал. Теперь у него есть
// живой склад и текст последней рассылки. Чистые функции — проверка в
// `check-broadcasts`.
// ---------------------------------------------------------------------------

const FLOWER_ORDER = ["rose", "chrysanthemum", "eustoma"];

/** Сколько стеблей сказать модели: вниз до сотен, меньше сотни — «мало». */
export function roughStems(n: number): string {
  if (n < 100) return "мало, до 100 шт.";
  const r = n >= 1000 ? Math.floor(n / 500) * 500 : Math.floor(n / 100) * 100;
  return `около ${r.toLocaleString("ru-RU").replace(/\s/g, " ")} шт.`;
}

/**
 * Что сейчас можно продать: остаток партий без просроченных (`critical` —
 * дольше срока хранения, клиенту его не предлагают), сложенный по цветку,
 * сорту и длине/категории. Строка на позицию, количество округлено вниз.
 */
export function stockForBot(batches: Batch[], settings: Settings, now: Date): string {
  const sums = new Map<string, { flower: string; variety: string; grade: string; qty: number }>();
  for (const b of batches) {
    if (!(b.quantityRemaining > 0)) continue;
    const info = computeBatchStorageInfo(b, settings, now);
    if (info.status === "critical" || info.status === "depleted") continue;
    const key = `${b.flowerType}|${b.variety}|${b.grade}`;
    const cur = sums.get(key) ?? { flower: b.flowerType, variety: b.variety || "", grade: b.grade, qty: 0 };
    cur.qty += b.quantityRemaining;
    sums.set(key, cur);
  }
  const fi = (f: string) => {
    const i = FLOWER_ORDER.indexOf(f);
    return i < 0 ? 99 : i;
  };
  const rows = Array.from(sums.values())
    .filter((r) => r.qty > 0)
    .sort((a, b) => fi(a.flower) - fi(b.flower) || a.variety.localeCompare(b.variety, "ru") || compareGrades(a.flower, a.grade, b.grade));
  const text = rows
    .map((r) => `${FLOWER_TYPE_LABELS[r.flower] ?? r.flower} · ${r.variety || "без сорта"} · ${formatGrade(r.grade)} — ${roughStems(r.qty)}`)
    .join("\n");
  return text.length > 6000 ? `${text.slice(0, 6000)}\n…` : text;
}

/** Последняя запущенная рассылка: о чём мы написали клиентам. */
export function lastBroadcastForBot(list: { title: string; text: string; startedAt: string; createdAt: string }[]): string {
  const started = list.filter((b) => b.startedAt && b.text.trim());
  if (started.length === 0) return "";
  const last = started.reduce((a, b) => (b.startedAt > a.startedAt ? b : a));
  const text = last.text.replace(/\{\s*имя\s*\}/gi, "").replace(/[ \t]+\n/g, "\n").trim();
  return `«${last.title}», отправлена ${last.startedAt.slice(0, 10)}:\n${text.slice(0, 2500)}`;
}
