import { shiftDay } from "../payroll/work";
import { daysBetween } from "./insights";
import type { GreenhouseReport, ReportRow } from "./dashboard";
import { QUALITY_GROUPS, qualityOf, weekStart } from "./views";
import type { GhCutting, GhCycle, GhHarvest, GhWaste } from "./production";

/**
 * «Аналитика → Срезка» (30.10.2026, владелец: «и Аналитику тоже переделай»). Было восемь тонких вкладок по одному
 * графику или рейтингу и без отбора. Стало: период со стрелками, блок и сорт (одна строка отбора, как в «Записях»),
 * а на экране — цифры с изменением к такому же сроку перед ним, срезка во времени и сравнение блоков и сортов одной
 * таблицей. Чистые функции; проверка — `check-greenhouse` («Аналитика»).
 */

type GhInput = { cycles: GhCycle[]; harvest: GhHarvest[]; cuttings: GhCutting[]; waste: GhWaste[] };

/** Данные теплицы, суженные до блока и сорта. Даты циклов остаются целиком — они про посадку, а не про отбор. */
export function filterGh<T extends GhInput>(data: T, block: string, variety: string): T {
  if (!block && !variety) return data;
  const v = variety.trim().toLowerCase();
  const ok = (r: { block: string; variety: string }) => (!block || r.block === block) && (!v || r.variety.trim().toLowerCase() === v);
  return { ...data, harvest: data.harvest.filter(ok), cuttings: data.cuttings.filter(ok), waste: data.waste.filter(ok) };
}

export type SeriesBy = "day" | "week" | "month";
const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** Срезка во времени тремя группами качества: до двух месяцев — по дням, до полугода — по неделям, дальше — по месяцам. */
export function qualitySeries(harvest: GhHarvest[], from: string, to: string): { by: SeriesBy; points: ({ label: string; key: string; total: number } & Record<string, number | string>)[] } {
  const days = daysBetween(from, to) + 1;
  const by: SeriesBy = days <= 62 ? "day" : days <= 190 ? "week" : "month";
  const keyOf = (d: string) => (by === "day" ? d : by === "week" ? weekStart(d) : d.slice(0, 7));
  const labelOf = (k: string) => (by === "month" ? `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}` : `${Number(k.slice(8, 10))} ${MONTHS[Number(k.slice(5, 7)) - 1]}`);
  const map = new Map<string, { label: string; key: string; total: number } & Record<string, number | string>>();
  const blank = (k: string) => {
    const p: { label: string; key: string; total: number } & Record<string, number | string> = { label: labelOf(k), key: k, total: 0 };
    for (const g of QUALITY_GROUPS) p[g.label] = 0;
    return p;
  };
  // Пустые дни и недели — нулём, чтобы перерыв в срезке был виден.
  for (let d = from; d <= to; d = shiftDay(d, by === "day" ? 1 : by === "week" ? 7 : 28)) {
    const k = keyOf(d);
    if (!map.has(k)) map.set(k, blank(k));
  }
  for (const h of harvest) {
    if (h.date < from || h.date > to || h.qty <= 0) continue;
    const k = keyOf(h.date);
    const p = map.get(k) ?? blank(k);
    const g = QUALITY_GROUPS.find((x) => x.key === qualityOf(h.grade))!;
    p[g.label] = (p[g.label] as number) + h.qty;
    p.total += h.qty;
    map.set(k, p);
  }
  return { by, points: Array.from(map.values()).sort((a, b) => a.key.localeCompare(b.key)) };
}

export interface CompareRow extends ReportRow {
  prevQty: number;
  /** Изменение срезки к прошлому такому же сроку, %. */
  change: number | null;
  /** Доля в срезке периода, %. */
  share: number;
  /** В чём строка лучшая и в чём отстаёт (высшая и 1-я, вес, потери). */
  best: ("top" | "weight" | "loss")[];
  worst: ("top" | "weight" | "loss")[];
}

/**
 * Блоки или сорта периода рядом с прошлым таким же сроком. Лучший и худший по высшей и 1-й, весу и потерям — только
 * среди тех, кто дал заметную долю (от 5 % срезки): блок, где срезали сто штук, не должен становиться «лучшим».
 */
export function compareRows(cur: ReportRow[], prev: ReportRow[], total: number): CompareRow[] {
  const prevBy = new Map(prev.map((r) => [r.key, r.qty]));
  const rows: CompareRow[] = cur
    .filter((r) => r.qty > 0 || r.waste > 0)
    .map((r) => {
      const pq = prevBy.get(r.key) ?? 0;
      return { ...r, prevQty: pq, change: pq > 0 ? Math.round(((r.qty - pq) * 100) / pq) : null, share: total ? Math.round((r.qty * 1000) / total) / 10 : 0, best: [], worst: [] };
    });
  const big = rows.filter((r) => r.share >= 5);
  if (big.length >= 3) {
    const mark = (key: "top" | "weight" | "loss", val: (r: CompareRow) => number | null, higherBetter: boolean) => {
      const withVal = big.filter((r) => val(r) !== null);
      if (withVal.length < 3) return;
      const sorted = [...withVal].sort((a, b) => (val(b)! - val(a)!) * (higherBetter ? 1 : -1));
      if (val(sorted[0]) === val(sorted[sorted.length - 1])) return;
      sorted[0].best.push(key);
      sorted[sorted.length - 1].worst.push(key);
    };
    mark("top", (r) => r.topPct, true);
    mark("loss", (r) => r.lossPct, false);
    mark("weight", (r) => r.avgWeight, true);
  }
  return rows.sort((a, b) => b.qty - a.qty);
}

const pct = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`;
const n0 = (n: number) => Math.round(n).toLocaleString("ru-RU");

/** Выводы словами — три-четыре строки сверху. */
export function periodInsights(rep: GreenhouseReport, prev: GreenhouseReport, blocks: CompareRow[], varieties: CompareRow[]): string[] {
  const out: string[] = [];
  const t = rep.totals;
  if (!t.qty) return out;
  const p = rep.prev.qty;
  if (p > 0) {
    const ch = Math.round(((t.qty - p) * 100) / p);
    out.push(Math.abs(ch) < 3 ? `Срезали ${n0(t.qty)} — столько же, сколько за прошлый такой же срок.` : `Срезали ${n0(t.qty)} — на ${Math.abs(ch)} % ${ch > 0 ? "больше" : "меньше"}, чем за прошлый такой же срок (${n0(p)}).`);
  } else out.push(`Срезали ${n0(t.qty)} за ${t.days} ${t.days === 1 ? "день" : t.days < 5 ? "дня" : "дней"} срезки.`);
  if (t.topPct !== null && prev.totals.topPct !== null && Math.abs(t.topPct - prev.totals.topPct) >= 3)
    out.push(`Высшей и 1-й ${t.topPct > prev.totals.topPct ? "стало больше" : "стало меньше"}: ${pct(t.topPct)} против ${pct(prev.totals.topPct)}.`);
  const bestTop = blocks.find((b) => b.best.includes("top"));
  const worstTop = blocks.find((b) => b.worst.includes("top"));
  if (bestTop && worstTop && bestTop !== worstTop) out.push(`Лучше всех по качеству — ${bestTop.label} (высшая и 1-я ${pct(bestTop.topPct!)}), слабее — ${worstTop.label} (${pct(worstTop.topPct!)}).`);
  const worstLoss = blocks.find((b) => b.worst.includes("loss"));
  if (worstLoss && worstLoss.lossPct !== null && rep.loss.lossPct !== null && worstLoss.lossPct > rep.loss.lossPct * 1.3)
    out.push(`Потери выше всего на ${worstLoss.label.toLowerCase()} — ${pct(worstLoss.lossPct)} при ${pct(rep.loss.lossPct)} в среднем.`);
  if (varieties.length > 1 && varieties[0].share >= 50) out.push(`${varieties[0].label} — ${pct(varieties[0].share)} всей срезки.`);
  return out.slice(0, 4);
}
