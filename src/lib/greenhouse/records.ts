import { compareBlocks } from "../payroll/work";
import { CUTTING_KINDS, HARVEST_GRADES, WASTE_KINDS, type GhCutting, type GhCycle, type GhHarvest, type GhWaste } from "./production";

/**
 * «Записи» теплицы по дням (30.10.2026, владелец: «вкладку Записи прям переделай, не очень»). Было — плоский журнал:
 * строка на категорию, на день с двумя блоками выходило 30 строк, за месяц — полотно в шесть с половиной тысяч пикселей.
 * Стало — карточка на день: сверху итоги дня по журналам, внутри — лист дня в том виде, как его пишут в книге:
 * строка «блок · сорт», категории в ряд. Правят на «Внести день» (у каждого листа ссылка на тот же день и блок), здесь
 * ищут и проверяют: сверху — «Проверьте» (вес стебля вне 10–400 г, задвоенные строки, срезка раньше посадки цикла,
 * выработка без карточки). Чистые функции; проверка — `check-greenhouse` («Записи»).
 */

export type RecordKind = "harvest" | "waste" | "cuttings" | "work";
export const RECORD_KINDS: { key: RecordKind; label: string }[] = [
  { key: "harvest", label: "Срезка" },
  { key: "waste", label: "Брак" },
  { key: "cuttings", label: "Черенкование" },
  { key: "work", label: "Выработка" },
];

export interface WorkLine {
  date: string;
  area: string;
  areaLabel: string;
  name: string;
  hasCard: boolean;
  block: string;
  typeLabel: string;
  qty: number;
  hours: number;
}

export interface HarvestSheetRow {
  block: string;
  cycle: number;
  variety: string;
  byGrade: Record<string, number>;
  total: number;
  /** Средний вес стебля по правдоподобным строкам, г. */
  avgG: number | null;
}

export interface SimpleRow {
  block: string;
  cycle: number;
  variety: string;
  kind: string;
  label: string;
  qty: number;
  extra: string;
}

export interface WorkAreaDay {
  area: string;
  label: string;
  people: number;
  qty: number;
  hours: number;
  rows: WorkLine[];
}

export interface DayRecords {
  date: string;
  harvest: HarvestSheetRow[];
  /** Категории, которые есть в этот день, — в порядке книги. */
  grades: string[];
  harvestTotal: number;
  harvestBlocks: string[];
  waste: SimpleRow[];
  wasteTotal: number;
  cuttings: SimpleRow[];
  work: WorkAreaDay[];
  workPeople: number;
}

export interface RecordFilter {
  from: string;
  to: string;
  block?: string;
  variety?: string;
  /** Только записи этого цикла (из карточки блока). У выработки цикла нет — она тогда не показывается. */
  cycle?: number;
  kinds: RecordKind[];
}

const sameVariety = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const plausibleG = (g: number) => g >= 10 && g <= 400;

export function blockName(b: string): string {
  return b === "—" || !b ? "весь цикл" : /^\d+$/.test(b) ? `Блок ${b}` : b;
}

export function recordDays(
  data: { harvest: GhHarvest[]; waste: GhWaste[]; cuttings: GhCutting[]; work?: WorkLine[] },
  f: RecordFilter,
): DayRecords[] {
  const ok = (r: { date: string; block: string; variety?: string; cycle?: number }) =>
    r.date >= f.from &&
    r.date <= f.to &&
    (!f.block || r.block === f.block) &&
    (!f.variety || (r.variety !== undefined && sameVariety(r.variety, f.variety))) &&
    (!f.cycle || r.cycle === f.cycle);
  const days = new Map<string, DayRecords>();
  const day = (date: string) => {
    let d = days.get(date);
    if (!d) {
      d = { date, harvest: [], grades: [], harvestTotal: 0, harvestBlocks: [], waste: [], wasteTotal: 0, cuttings: [], work: [], workPeople: 0 };
      days.set(date, d);
    }
    return d;
  };

  if (f.kinds.includes("harvest")) {
    const sheet = new Map<string, HarvestSheetRow & { kg: number; kgQty: number }>();
    const gradeSets = new Map<string, Set<string>>();
    for (const h of data.harvest) {
      if (!ok(h) || h.qty <= 0) continue;
      const key = `${h.date}|${h.block}|${h.cycle}|${h.variety.trim().toLowerCase()}`;
      let r = sheet.get(key);
      if (!r) {
        r = { block: h.block, cycle: h.cycle, variety: h.variety, byGrade: {}, total: 0, avgG: null, kg: 0, kgQty: 0 };
        sheet.set(key, r);
      }
      r.byGrade[h.grade] = (r.byGrade[h.grade] ?? 0) + h.qty;
      r.total += h.qty;
      if (h.weightKg > 0 && plausibleG((h.weightKg * 1000) / h.qty)) {
        r.kg += h.weightKg;
        r.kgQty += h.qty;
      }
      const gs = gradeSets.get(h.date) ?? new Set<string>();
      gs.add(h.grade);
      gradeSets.set(h.date, gs);
    }
    for (const [key, r] of sheet) {
      const d = day(key.slice(0, 10));
      const { kg, kgQty, ...row } = r;
      d.harvest.push({ ...row, avgG: kgQty ? Math.round((kg * 1000) / kgQty) : null });
      d.harvestTotal += r.total;
    }
    for (const [date, gs] of gradeSets) {
      const d = day(date);
      d.grades = HARVEST_GRADES.filter((g) => gs.has(g)).concat(Array.from(gs).filter((g) => !HARVEST_GRADES.includes(g)));
    }
  }
  if (f.kinds.includes("waste"))
    for (const w of data.waste) {
      if (!ok(w) || w.qty <= 0) continue;
      const d = day(w.date);
      d.waste.push({ block: w.block, cycle: w.cycle, variety: w.variety, kind: w.kind, label: WASTE_KINDS.find((k) => k.code === w.kind)?.label ?? w.kind, qty: w.qty, extra: w.note });
      d.wasteTotal += w.qty;
    }
  if (f.kinds.includes("cuttings"))
    for (const c of data.cuttings) {
      if (!ok(c) || c.qty <= 0) continue;
      day(c.date).cuttings.push({
        block: c.block,
        cycle: c.cycle,
        variety: c.variety,
        kind: c.kind,
        label: CUTTING_KINDS.find((k) => k.code === c.kind)?.label ?? c.kind,
        qty: c.qty,
        extra: [c.part && `секц. ${c.part}`, c.line && `линия ${c.line}`].filter(Boolean).join(", "),
      });
    }
  if (f.kinds.includes("work") && data.work) {
    // У выработки нет сорта: отбор по сорту её не показывает.
    if (!f.variety && !f.cycle)
      for (const w of data.work) {
        if (!ok({ date: w.date, block: w.block })) continue;
        const d = day(w.date);
        let a = d.work.find((x) => x.area === w.area);
        if (!a) {
          a = { area: w.area, label: w.areaLabel, people: 0, qty: 0, hours: 0, rows: [] };
          d.work.push(a);
        }
        a.rows.push(w);
        a.qty += w.qty;
        a.hours += w.hours;
      }
  }

  const byBlockVariety = (a: { block: string; variety: string }, b: { block: string; variety: string }) => compareBlocks(a.block, b.block) || a.variety.localeCompare(b.variety);
  for (const d of days.values()) {
    d.harvest.sort(byBlockVariety);
    d.harvestBlocks = Array.from(new Set(d.harvest.map((r) => r.block))).sort(compareBlocks);
    d.waste.sort((a, b) => byBlockVariety(a, b) || b.qty - a.qty);
    d.cuttings.sort((a, b) => byBlockVariety(a, b) || a.label.localeCompare(b.label));
    const everyone = new Set<string>();
    for (const a of d.work) {
      a.people = new Set(a.rows.map((r) => r.name)).size;
      a.rows.forEach((r) => everyone.add(r.name));
      a.rows.sort((x, y) => x.name.localeCompare(y.name, "ru") || compareBlocks(x.block, y.block));
    }
    d.work.sort((a, b) => a.area.localeCompare(b.area));
    d.workPeople = everyone.size;
  }
  return Array.from(days.values())
    .filter((d) => d.harvest.length || d.waste.length || d.cuttings.length || d.work.length)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Итоги отобранного за период — по журналам. */
export function recordTotals(days: DayRecords[]): { harvest: number; waste: number; cuttings: number; workRows: number; days: number } {
  return {
    harvest: days.reduce((s, d) => s + d.harvestTotal, 0),
    waste: days.reduce((s, d) => s + d.wasteTotal, 0),
    cuttings: days.reduce((s, d) => s + d.cuttings.length, 0),
    workRows: days.reduce((s, d) => s + d.work.reduce((x, a) => x + a.rows.length, 0), 0),
    days: days.length,
  };
}

// --- Проверьте ----------------------------------------------------------------------------------------------------

export interface RecordIssue {
  date: string;
  kind: RecordKind;
  block: string;
  text: string;
}

const n0 = (n: number) => Math.round(n).toLocaleString("ru-RU");

/**
 * Что в записях похоже на ошибку ввода. Только то, что видно наверняка: вес стебля вне 10–400 г (ошибка в килограммах),
 * две одинаковые строки в один день (задвоили), срезка цикла раньше его посадки, выработка без карточки сотрудника.
 * Сверху — свежие.
 */
export function recordIssues(
  data: { cycles: GhCycle[]; harvest: GhHarvest[]; waste: GhWaste[]; cuttings: GhCutting[]; work?: WorkLine[] },
  f: RecordFilter,
): RecordIssue[] {
  const out: RecordIssue[] = [];
  const inF = (r: { date: string; block: string; variety?: string; cycle?: number }) =>
    r.date >= f.from &&
    r.date <= f.to &&
    (!f.block || r.block === f.block) &&
    (!f.variety || (r.variety !== undefined && sameVariety(r.variety, f.variety))) &&
    (!f.cycle || r.cycle === f.cycle);
  const planted = new Map(data.cycles.map((c) => [`${c.cycle}|${c.block}`, c.plantedAt]));

  if (f.kinds.includes("harvest")) {
    const dup = new Map<string, { h: GhHarvest; n: number }>();
    const early = new Set<string>();
    for (const h of data.harvest) {
      if (!inF(h)) continue;
      if (h.weightKg > 0 && h.qty > 0) {
        const g = (h.weightKg * 1000) / h.qty;
        if (!plausibleG(g))
          out.push({
            date: h.date,
            kind: "harvest",
            block: h.block,
            text: `${blockName(h.block)} · ${h.variety} · ${h.grade}: ${n0(h.qty)} шт. весят ${h.weightKg.toLocaleString("ru-RU")} кг — это ${n0(g)} г за стебель. Проверьте вес.`,
          });
      }
      const k = `${h.date}|${h.block}|${h.cycle}|${h.variety.toLowerCase()}|${h.grade}`;
      const x = dup.get(k);
      if (x) x.n += 1;
      else dup.set(k, { h, n: 1 });
      const p = planted.get(`${h.cycle}|${h.block}`);
      const ek = `${h.date}|${h.block}|${h.cycle}`;
      if (p && h.date < p && !early.has(ek)) {
        early.add(ek);
        out.push({ date: h.date, kind: "harvest", block: h.block, text: `${blockName(h.block)}: срезка записана в цикл ${h.cycle}, а он посажен только ${p.split("-").reverse().join(".")}. Не тот цикл?` });
      }
    }
    for (const { h, n } of dup.values())
      if (n > 1) out.push({ date: h.date, kind: "harvest", block: h.block, text: `${blockName(h.block)} · ${h.variety} · ${h.grade}: ${n} одинаковые строки в один день. Не задвоили?` });
  }
  if (f.kinds.includes("waste")) {
    const dup = new Map<string, { w: GhWaste; n: number }>();
    for (const w of data.waste) {
      if (!inF(w)) continue;
      const k = `${w.date}|${w.block}|${w.variety.toLowerCase()}|${w.kind}`;
      const x = dup.get(k);
      if (x) x.n += 1;
      else dup.set(k, { w, n: 1 });
    }
    for (const { w, n } of dup.values())
      if (n > 1) out.push({ date: w.date, kind: "waste", block: w.block, text: `Брак · ${blockName(w.block)} · ${w.variety}: ${n} одинаковые строки в один день. Не задвоили?` });
  }
  if (f.kinds.includes("work") && data.work && !f.variety && !f.cycle) {
    const noCard = data.work.filter((w) => !w.hasCard && w.date >= f.from && w.date <= f.to && (!f.block || w.block === f.block));
    if (noCard.length) {
      const names = Array.from(new Set(noCard.map((w) => w.name)));
      const last = noCard.reduce((m, w) => (w.date > m ? w.date : m), "");
      out.push({ date: last, kind: "work", block: "", text: `Выработка без карточки сотрудника: ${noCard.length} строк, ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` и ещё ${names.length - 3}` : ""}. В оплате труда такие люди считаются отдельно — привяжите имя к карточке.` });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
