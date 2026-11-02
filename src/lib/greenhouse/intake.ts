import { toIsoDate } from "../sheetDate";
import { TOP_GRADES_BY_FLOWER_TYPE } from "../constants";
import { cleanBlock, compareBlocks, plausibleDate, shiftDay } from "../payroll/work";

/**
 * Приёмка Rose Farm (02.11.2026, владелец: «такой же учёт для Rose Farm, где будет приёмка цветка по характеристикам:
 * розы, эустомы и с завтрашнего дня хризантема — но это хризантема только от Rose Farm»).
 *
 * У Есентая теплица ведётся циклами и блоками (`production.ts`): черенкование → посадка → срезка. У Rose Farm роза
 * многолетняя, циклов нет, и главный вопрос другой — ЧТО пришло из теплицы: сколько стеблей какого сорта, какой длины
 * (у хризантемы — категории), какого веса и с каким бутоном, сколько брака и почему. Поэтому учёт свой:
 *   принято — сорт × длина/категория, стеблей;
 *   замер — по сорту за день: вес стебля, высота бутона (роза), бутонов/цветков на стебле (эустома, хризантема);
 *   брак — сорт, причина, стеблей.
 * Хризантема здесь — своя, Rose Farm: она живёт в записях Rose Farm (колонка Farm), и с хризантемой Есентая не
 * смешивается ни в одном расчёте.
 *
 * Чистые функции без таблицы и сессии; проверка — `scripts/check-intake.ts`.
 */

export const INTAKE_FLOWERS = ["rose", "eustoma", "chrysanthemum"] as const;
export type IntakeFlower = (typeof INTAKE_FLOWERS)[number];
export const INTAKE_FLOWER_LABELS: Record<IntakeFlower, string> = { rose: "Роза", eustoma: "Эустома", chrysanthemum: "Хризантема" };
export function isIntakeFlower(v: unknown): v is IntakeFlower {
  return INTAKE_FLOWERS.includes(v as IntakeFlower);
}

export type MeasureKey = "stemG" | "headCm" | "buds";
export interface MeasureSpec {
  key: MeasureKey;
  label: string;
  short: string;
  unit: string;
  min: number;
  max: number;
  /** Сколько знаков после запятой показывать и хранить. */
  digits: number;
}

export interface IntakeFlowerSpec {
  /** Колонки, которые видны всегда. */
  grades: string[];
  /** Редкие колонки — под «ещё». */
  more: string[];
  /** «Длина» / «Категория». */
  gradeNoun: string;
  measures: MeasureSpec[];
}

const STEM_G = (max: number): MeasureSpec => ({ key: "stemG", label: "Вес стебля", short: "Вес", unit: "г", min: 5, max, digits: 0 });

/**
 * Что принимается по каждому цветку. Длины и категории — те же, что на складе (`GRADES_BY_FLOWER_TYPE`), без «Уценки»:
 * уценка — решение о цене, а не характеристика цветка. «Брак» хризантемы — не категория, а строка брака с причиной.
 */
export const INTAKE_SPECS: Record<IntakeFlower, IntakeFlowerSpec> = {
  rose: {
    grades: ["40", "50", "60", "70", "80", "90", "100", "Мини-микс"],
    more: ["40 (2 сорт)", "50 (2 сорт)", "60 (2 сорт)", "70 (2 сорт)", "B-quality"],
    gradeNoun: "Длина",
    measures: [STEM_G(200), { key: "headCm", label: "Высота бутона", short: "Бутон", unit: "см", min: 1.5, max: 10, digits: 1 }],
  },
  eustoma: {
    grades: ["Стандарт", "50", "Мини-микс"],
    more: [],
    gradeNoun: "Длина",
    measures: [STEM_G(200), { key: "buds", label: "Бутонов на стебле", short: "Бутонов", unit: "шт.", min: 1, max: 40, digits: 1 }],
  },
  chrysanthemum: {
    grades: ["Высшая", "Первая", "Вторая", "Третья", "Четвёртая", "Мини-микс"],
    more: ["Нераскрывшийся"],
    gradeNoun: "Категория",
    measures: [STEM_G(400), { key: "buds", label: "Цветков на стебле", short: "Цветков", unit: "шт.", min: 1, max: 40, digits: 1 }],
  },
};

export function intakeGrades(flower: IntakeFlower): string[] {
  return [...INTAKE_SPECS[flower].grades, ...INTAKE_SPECS[flower].more];
}

/** Подпись колонки: «60», «2с 50», «Высш.». */
export function gradeShort(grade: string): string {
  const m = grade.match(/^(\d+) \(2 сорт\)$/);
  if (m) return `2с ${m[1]}`;
  const map: Record<string, string> = { Высшая: "Высш.", Первая: "1", Вторая: "2", Третья: "3", Четвёртая: "4", "Мини-микс": "Мини", Нераскрывшийся: "Нерас.", "B-quality": "B", Стандарт: "Станд." };
  return map[grade] ?? grade;
}

export function gradeLabel(flower: IntakeFlower, grade: string): string {
  if (/^\d+$/.test(grade)) return `${grade} см`;
  const m = grade.match(/^(\d+) \(2 сорт\)$/);
  if (m) return `2 сорт ${m[1]} см`;
  return flower === "chrysanthemum" && ["Высшая", "Первая", "Вторая", "Третья", "Четвёртая"].includes(grade) ? `${grade} кат.` : grade;
}

export const REJECT_REASONS = [
  { code: "botrytis", label: "Ботритис (серая гниль)" },
  { code: "mildew", label: "Мучнистая роса" },
  { code: "pests", label: "Вредители (трипс, клещ, тля)" },
  { code: "bud", label: "Мелкий или кривой бутон" },
  { code: "crooked", label: "Кривой или слабый стебель" },
  { code: "open", label: "Перерос, раскрылся" },
  { code: "short", label: "Короткий стебель" },
  { code: "leaves", label: "Листья: пятна, желтизна" },
  { code: "damage", label: "Механические повреждения" },
  { code: "other", label: "Другое" },
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number]["code"];
export function reasonLabel(code: string): string {
  return REJECT_REASONS.find((r) => r.code === code)?.label ?? (code || "Без причины");
}

/** Цвет длины/категории на полосках: длинные — темнее. 2 сорт и прочее — серые и жёлтые, мини — голубой. */
export const INTAKE_GRADE_COLORS: Record<string, string> = {
  "40": "#d7ebc9",
  "50": "#b4da9c",
  "60": "#8cc56f",
  "70": "#5fab55",
  "80": "#3f9a5c",
  "90": "#2c7f47",
  "100": "#1f6b3a",
  "Мини-микс": "#7aa6d6",
  "40 (2 сорт)": "#efd9a0",
  "50 (2 сорт)": "#e8c97c",
  "60 (2 сорт)": "#e2b95a",
  "70 (2 сорт)": "#d9a33b",
  "B-quality": "#c4b8a6",
  Стандарт: "#3f9a5c",
  Высшая: "#1f6b3a",
  Первая: "#3f9a5c",
  Вторая: "#8cc56f",
  Третья: "#e2c14a",
  Четвёртая: "#e39a3b",
  Нераскрывшийся: "#b48ac9",
};

// --- Записи --------------------------------------------------------------------------------------------------------

export type IntakeKind = "accept" | "reject" | "measure";

export interface IntakeRow {
  id: string;
  farm: string;
  date: string;
  flower: IntakeFlower;
  block: string;
  variety: string;
  kind: IntakeKind;
  /** accept — длина/категория. */
  grade: string;
  /** reject — причина. */
  reason: string;
  /** accept, reject — стеблей. */
  qty: number;
  /** measure — средний вес стебля, г; высота бутона, см; бутонов (цветков) на стебле. 0 — не мерили. */
  stemG: number;
  headCm: number;
  buds: number;
  note: string;
}

/** Строка из браузера — поля текстом; сервер проверяет (`cleanIntakeRow`). */
export interface IntakeDraft {
  id?: string;
  flower: string;
  block?: string;
  variety: string;
  kind: string;
  grade?: string;
  reason?: string;
  qty?: string | number;
  stemG?: string | number;
  headCm?: string | number;
  buds?: string | number;
  note?: string;
}

export type IntakeClean = Omit<IntakeRow, "farm">;

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  const s = String(v ?? "")
    .replace(/[\s ]+/g, "")
    .replace(",", ".");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function key(text: unknown): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

/** Сорт в одном написании со списком: «avalanche » = «Avalanche»; незнакомый — как ввели (новый сорт бывает). */
export function intakeVariety(raw: unknown, known: string[]): string {
  const v = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  if (!v) return "";
  return known.find((k) => key(k) === key(v)) ?? v;
}

export function measureOutOfRange(flower: IntakeFlower, k: MeasureKey, value: number): string {
  const spec = INTAKE_SPECS[flower].measures.find((m) => m.key === k);
  if (!spec) return "у этого цветка так не меряют";
  if (value < spec.min || value > spec.max) return `${spec.label.toLowerCase()} — от ${spec.min} до ${spec.max} ${spec.unit}`;
  return "";
}

/**
 * Строка приёмки из браузера → проверенная (грабли 1.11). Принято — длина/категория из списка цветка и целое число
 * стеблей; брак — причина из списка и стебли; замер — хоть одна характеристика, каждая в пределах цветка.
 */
export function cleanIntakeRow(d: IntakeDraft, date: string, today: string, known: string[]): { row: IntakeClean | null; error: string } {
  const day = toIsoDate(date);
  if (!day || !plausibleDate(day, today)) return { row: null, error: "дата непонятна" };
  if (day > today) return { row: null, error: "дата из будущего" };
  if (!isIntakeFlower(d.flower)) return { row: null, error: "не указан цветок" };
  const flower = d.flower;
  const variety = intakeVariety(d.variety, known);
  if (!variety) return { row: null, error: "не указан сорт" };
  const block = cleanBlock(String(d.block ?? "")).slice(0, 30);
  const base: IntakeClean = { id: String(d.id ?? "").trim(), date: day, flower, block, variety, kind: "accept", grade: "", reason: "", qty: 0, stemG: 0, headCm: 0, buds: 0, note: String(d.note ?? "").trim().slice(0, 200) };
  if (d.kind === "accept") {
    const grade = String(d.grade ?? "").trim();
    if (!intakeGrades(flower).includes(grade)) return { row: null, error: `${variety}: не указана ${INTAKE_SPECS[flower].gradeNoun.toLowerCase()}` };
    const qty = num(d.qty);
    if (Number.isNaN(qty) || qty < 0 || !Number.isInteger(qty)) return { row: null, error: `${variety}, ${gradeLabel(flower, grade)}: стебли — целое число` };
    if (qty <= 0) return { row: null, error: `${variety}, ${gradeLabel(flower, grade)}: стеблей больше нуля` };
    if (qty > 200000) return { row: null, error: `${variety}, ${gradeLabel(flower, grade)}: слишком много — проверьте число` };
    return { row: { ...base, kind: "accept", grade, qty }, error: "" };
  }
  if (d.kind === "reject") {
    const reason = String(d.reason ?? "").trim();
    if (!REJECT_REASONS.some((r) => r.code === reason)) return { row: null, error: `брак ${variety}: не указана причина` };
    const qty = num(d.qty);
    if (Number.isNaN(qty) || qty <= 0 || !Number.isInteger(qty)) return { row: null, error: `брак ${variety}: стеблей — целое число больше нуля` };
    return { row: { ...base, kind: "reject", reason, qty }, error: "" };
  }
  if (d.kind === "measure") {
    const out: Record<MeasureKey, number> = { stemG: 0, headCm: 0, buds: 0 };
    for (const k of ["stemG", "headCm", "buds"] as MeasureKey[]) {
      const v = num(d[k]);
      if (Number.isNaN(v) || v < 0) return { row: null, error: `${variety}: характеристики — числом` };
      if (!v) continue;
      const bad = measureOutOfRange(flower, k, v);
      if (bad) return { row: null, error: `${variety}: ${bad}` };
      const digits = INTAKE_SPECS[flower].measures.find((m) => m.key === k)?.digits ?? 0;
      out[k] = Math.round(v * 10 ** digits) / 10 ** digits;
    }
    if (!out.stemG && !out.headCm && !out.buds) return { row: null, error: "" };
    return { row: { ...base, kind: "measure", ...out }, error: "" };
  }
  return { row: null, error: "непонятная строка" };
}

/** Повторы в одном дне: одна и та же клетка «сорт × длина» или замер сорта дважды — это ошибка ввода, а не сложение. */
export function intakeDuplicate(rows: IntakeClean[]): string {
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.kind === "reject") continue;
    const k = [r.kind, r.flower, r.block, key(r.variety), r.grade].join("|");
    if (seen.has(k)) return r.kind === "measure" ? `${r.variety}: характеристики записаны дважды` : `${r.variety}, ${gradeLabel(r.flower, r.grade)}: строка дважды — сложите в одну`;
    seen.add(k);
  }
  return "";
}

// --- Сводки --------------------------------------------------------------------------------------------------------

export interface IntakeFilter {
  from: string;
  to: string;
  flower?: IntakeFlower | "";
  variety?: string;
  block?: string;
}

export function filterIntake(rows: IntakeRow[], f: IntakeFilter): IntakeRow[] {
  return rows.filter((r) => r.date >= f.from && r.date <= f.to && (!f.flower || r.flower === f.flower) && (!f.variety || r.variety === f.variety) && (!f.block || r.block === f.block));
}

export interface GradeQty {
  grade: string;
  qty: number;
}

export interface MeasureAvg {
  stemG: number | null;
  headCm: number | null;
  buds: number | null;
}

export interface IntakeStats {
  accepted: number;
  rejected: number;
  /** Брак от всего, что пришло (принято + брак). */
  rejectPct: number | null;
  byGrade: GradeQty[];
  /** Длинные/высшая: роза 80+ см, хризантема высшая, эустома «Стандарт» (`TOP_GRADES_BY_FLOWER_TYPE`). */
  topPct: number | null;
  /** Второй сорт розы, B-quality, нераскрывшийся. */
  secondPct: number | null;
  /** Средняя длина розы первого сорта, см. */
  avgLength: number | null;
  measures: MeasureAvg;
  days: number;
}

const SECOND = (g: string) => / \(2 сорт\)$/.test(g) || g === "B-quality" || g === "Нераскрывшийся";

/**
 * Итоги набора записей ОДНОГО цветка. Характеристики сорта — средние по замерам, взвешенные стеблями, принятыми
 * в тот же день по тому же сорту (замер на тысячу стеблей весит больше, чем на сотню); без принятого — вес один.
 */
export function intakeStats(rows: IntakeRow[], flower: IntakeFlower): IntakeStats {
  const mine = rows.filter((r) => r.flower === flower);
  const gradeMap = new Map<string, number>();
  let accepted = 0;
  let rejected = 0;
  let lenSum = 0;
  let lenQty = 0;
  const days = new Set<string>();
  const dayVariety = new Map<string, number>();
  for (const r of mine) {
    if (r.kind === "accept") {
      accepted += r.qty;
      gradeMap.set(r.grade, (gradeMap.get(r.grade) ?? 0) + r.qty);
      if (/^\d+$/.test(r.grade)) {
        lenSum += Number(r.grade) * r.qty;
        lenQty += r.qty;
      }
      const k = `${r.date}|${r.block}|${key(r.variety)}`;
      dayVariety.set(k, (dayVariety.get(k) ?? 0) + r.qty);
      days.add(r.date);
    } else if (r.kind === "reject") {
      rejected += r.qty;
      days.add(r.date);
    }
  }
  const sums: Record<MeasureKey, [number, number]> = { stemG: [0, 0], headCm: [0, 0], buds: [0, 0] };
  for (const r of mine) {
    if (r.kind !== "measure") continue;
    const w = dayVariety.get(`${r.date}|${r.block}|${key(r.variety)}`) || 1;
    for (const k of ["stemG", "headCm", "buds"] as MeasureKey[]) {
      if (r[k] > 0) {
        sums[k][0] += r[k] * w;
        sums[k][1] += w;
      }
    }
  }
  const avg = (k: MeasureKey) => (sums[k][1] ? sums[k][0] / sums[k][1] : null);
  const order = intakeGrades(flower);
  const byGrade = Array.from(gradeMap, ([grade, qty]) => ({ grade, qty })).sort((a, b) => {
    const ia = order.indexOf(a.grade);
    const ib = order.indexOf(b.grade);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  const top = TOP_GRADES_BY_FLOWER_TYPE[flower] ?? [];
  const topQty = byGrade.filter((g) => top.includes(g.grade)).reduce((s, g) => s + g.qty, 0);
  const secondQty = byGrade.filter((g) => SECOND(g.grade)).reduce((s, g) => s + g.qty, 0);
  const all = accepted + rejected;
  return {
    accepted,
    rejected,
    rejectPct: all ? (rejected * 100) / all : null,
    byGrade,
    topPct: accepted ? (topQty * 100) / accepted : null,
    secondPct: accepted ? (secondQty * 100) / accepted : null,
    avgLength: flower === "rose" && lenQty ? lenSum / lenQty : null,
    measures: { stemG: avg("stemG"), headCm: avg("headCm"), buds: avg("buds") },
    days: days.size,
  };
}

/** Какие цветки есть в записях — в порядке «роза, эустома, хризантема». */
export function flowersIn(rows: IntakeRow[]): IntakeFlower[] {
  const set = new Set(rows.filter((r) => r.kind !== "measure").map((r) => r.flower));
  return INTAKE_FLOWERS.filter((f) => set.has(f));
}

export interface VarietyStats extends IntakeStats {
  flower: IntakeFlower;
  variety: string;
  /** Доля сорта в принятом своего цветка. */
  share: number;
}

export function byVariety(rows: IntakeRow[]): VarietyStats[] {
  const groups = new Map<string, IntakeRow[]>();
  for (const r of rows) {
    const k = `${r.flower}|${r.variety}`;
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  const totals = new Map<IntakeFlower, number>();
  for (const r of rows) if (r.kind === "accept") totals.set(r.flower, (totals.get(r.flower) ?? 0) + r.qty);
  const out: VarietyStats[] = [];
  for (const list of Array.from(groups.values())) {
    const { flower, variety } = list[0];
    const s = intakeStats(list, flower);
    if (!s.accepted && !s.rejected) continue;
    const t = totals.get(flower) ?? 0;
    out.push({ ...s, flower, variety, share: t ? (s.accepted * 100) / t : 0 });
  }
  return out.sort((a, b) => INTAKE_FLOWERS.indexOf(a.flower) - INTAKE_FLOWERS.indexOf(b.flower) || b.accepted - a.accepted || a.variety.localeCompare(b.variety));
}

export interface BlockStats {
  block: string;
  accepted: number;
  rejected: number;
  rejectPct: number | null;
  byFlower: Partial<Record<IntakeFlower, number>>;
}

export function byBlock(rows: IntakeRow[]): BlockStats[] {
  const map = new Map<string, BlockStats>();
  for (const r of rows) {
    if (r.kind === "measure") continue;
    const b = r.block || "";
    const s = map.get(b) ?? { block: b, accepted: 0, rejected: 0, rejectPct: null, byFlower: {} };
    if (r.kind === "accept") {
      s.accepted += r.qty;
      s.byFlower[r.flower] = (s.byFlower[r.flower] ?? 0) + r.qty;
    } else s.rejected += r.qty;
    map.set(b, s);
  }
  return Array.from(map.values())
    .map((s) => ({ ...s, rejectPct: s.accepted + s.rejected ? (s.rejected * 100) / (s.accepted + s.rejected) : null }))
    .sort((a, b) => (a.block ? 0 : 1) - (b.block ? 0 : 1) || compareBlocks(a.block, b.block));
}

export interface ReasonStats {
  reason: string;
  label: string;
  qty: number;
  share: number;
}

export function byReason(rows: IntakeRow[]): ReasonStats[] {
  const map = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    if (r.kind !== "reject") continue;
    map.set(r.reason, (map.get(r.reason) ?? 0) + r.qty);
    total += r.qty;
  }
  return Array.from(map, ([reason, qty]) => ({ reason, label: reasonLabel(reason), qty, share: total ? (qty * 100) / total : 0 })).sort((a, b) => b.qty - a.qty);
}

export interface DayStats {
  date: string;
  byFlower: Record<IntakeFlower, number>;
  accepted: number;
  rejected: number;
}

/** По дням периода — с пустыми днями: провал в приёмке должен быть виден, а не схлопнут. */
export function byDay(rows: IntakeRow[], from: string, to: string): DayStats[] {
  const map = new Map<string, DayStats>();
  for (let d = from; d <= to; d = shiftDay(d, 1)) map.set(d, { date: d, byFlower: { rose: 0, eustoma: 0, chrysanthemum: 0 }, accepted: 0, rejected: 0 });
  for (const r of rows) {
    const s = map.get(r.date);
    if (!s) continue;
    if (r.kind === "accept") {
      s.byFlower[r.flower] += r.qty;
      s.accepted += r.qty;
    } else if (r.kind === "reject") s.rejected += r.qty;
  }
  return Array.from(map.values());
}

/** Изменение к прошлому периоду в процентах; при пустом прошлом — null (не «+∞ %»). */
export function changePct(now: number, before: number): number | null {
  if (!before) return null;
  return ((now - before) * 100) / before;
}

/**
 * Выводы словами — по цветку, только то, что правда отличается: брак выше прошлого, длина/высшая к прошлому, сорт с
 * самым большим браком (если он заметно выше среднего), главная причина брака.
 */
export function intakeInsights(now: IntakeRow[], prev: IntakeRow[]): string[] {
  const out: string[] = [];
  for (const f of flowersIn(now)) {
    const a = intakeStats(now, f);
    const b = intakeStats(prev, f);
    const name = INTAKE_FLOWER_LABELS[f];
    const ch = changePct(a.accepted, b.accepted);
    if (ch !== null && Math.abs(ch) >= 15) out.push(`${name}: принято ${ch > 0 ? "больше" : "меньше"}, чем в прошлый период, на ${Math.round(Math.abs(ch))} %.`);
    if (f === "rose" && a.avgLength !== null && b.avgLength !== null && Math.abs(a.avgLength - b.avgLength) >= 2)
      out.push(`Роза стала ${a.avgLength > b.avgLength ? "длиннее" : "короче"}: в среднем ${Math.round(a.avgLength)} см против ${Math.round(b.avgLength)} см.`);
    if (a.rejectPct !== null && a.rejectPct >= 3 && b.rejectPct !== null && a.rejectPct - b.rejectPct >= 2)
      out.push(`${name}: брак вырос до ${a.rejectPct.toFixed(1).replace(".", ",")} % (было ${b.rejectPct.toFixed(1).replace(".", ",")} %).`);
    const vs = byVariety(now.filter((r) => r.flower === f)).filter((v) => v.accepted + v.rejected >= 200 && v.rejectPct !== null);
    if (a.rejectPct !== null && vs.length >= 2) {
      const worst = vs.reduce((x, y) => ((y.rejectPct ?? 0) > (x.rejectPct ?? 0) ? y : x));
      if ((worst.rejectPct ?? 0) >= 5 && (worst.rejectPct ?? 0) >= a.rejectPct * 1.5) out.push(`${name}: больше всего брака у ${worst.variety} — ${Math.round(worst.rejectPct ?? 0)} % от пришедшего.`);
    }
  }
  const reasons = byReason(now);
  if (reasons.length && reasons[0].share >= 40 && reasons[0].qty >= 50) out.push(`Главная причина брака — «${reasons[0].label}»: ${Math.round(reasons[0].share)} % всего брака.`);
  return out.slice(0, 5);
}

// --- День приёмки в браузере ---------------------------------------------------------------------------------------

/** Строка сорта на экране дня: клетки по длинам, замер, блок. */
export interface IntakeLine {
  flower: IntakeFlower;
  block: string;
  variety: string;
  cells: Record<string, { id: string; qty: number }>;
  measure: { id: string; stemG: number; headCm: number; buds: number } | null;
}

export interface IntakeReject {
  id: string;
  flower: IntakeFlower;
  block: string;
  variety: string;
  reason: string;
  qty: number;
  note: string;
}

export interface IntakeDay {
  lines: IntakeLine[];
  rejects: IntakeReject[];
}

/** Записи одного дня → строки сортов и брак, как их видит человек. */
export function intakeDay(rows: IntakeRow[], date: string): IntakeDay {
  const lines = new Map<string, IntakeLine>();
  const rejects: IntakeReject[] = [];
  const line = (r: IntakeRow) => {
    const k = `${r.flower}|${r.block}|${key(r.variety)}`;
    let l = lines.get(k);
    if (!l) {
      l = { flower: r.flower, block: r.block, variety: r.variety, cells: {}, measure: null };
      lines.set(k, l);
    }
    return l;
  };
  for (const r of rows) {
    if (r.date !== date) continue;
    if (r.kind === "accept") line(r).cells[r.grade] = { id: r.id, qty: r.qty };
    else if (r.kind === "measure") line(r).measure = { id: r.id, stemG: r.stemG, headCm: r.headCm, buds: r.buds };
    else rejects.push({ id: r.id, flower: r.flower, block: r.block, variety: r.variety, reason: r.reason, qty: r.qty, note: r.note });
  }
  return { lines: Array.from(lines.values()), rejects };
}

/** Сорта, которые принимали за последние дни (свежие и крупные — первыми): подсказка «повторить вчерашние». */
export function recentVarieties(rows: IntakeRow[], flower: IntakeFlower, before: string, days = 14): { variety: string; block: string }[] {
  const from = shiftDay(before, -days);
  const score = new Map<string, { variety: string; block: string; last: string; qty: number }>();
  for (const r of rows) {
    if (r.flower !== flower || r.kind !== "accept" || r.date >= before || r.date < from) continue;
    const k = `${r.block}|${key(r.variety)}`;
    const s = score.get(k) ?? { variety: r.variety, block: r.block, last: r.date, qty: 0 };
    s.qty += r.qty;
    if (r.date > s.last) s.last = r.date;
    score.set(k, s);
  }
  return Array.from(score.values())
    .sort((a, b) => b.last.localeCompare(a.last) || b.qty - a.qty)
    .map(({ variety, block }) => ({ variety, block }));
}

/** Последний день до `before`, когда этот цветок принимали, — с его сортами (для «как в прошлый раз»). */
export function lastIntakeLines(rows: IntakeRow[], flower: IntakeFlower, before: string): { date: string; lines: { variety: string; block: string }[] } | null {
  let last = "";
  for (const r of rows) if (r.flower === flower && r.kind === "accept" && r.date < before && r.date > last) last = r.date;
  if (!last) return null;
  const seen = new Set<string>();
  const lines: { variety: string; block: string }[] = [];
  for (const r of rows) {
    if (r.flower !== flower || r.kind !== "accept" || r.date !== last) continue;
    const k = `${r.block}|${key(r.variety)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    lines.push({ variety: r.variety, block: r.block });
  }
  return { date: last, lines };
}
