import { toIsoDate } from "../sheetDate";
import { CHRYSANTHEMUM_GRADES } from "../constants";
import { cleanBlock, compareBlocks, plausibleDate, shiftDay, workHash } from "../payroll/work";

/**
 * Теплица — производственный учёт хризантемы по циклам и блокам (29.10.2026, владелец: «не вижу аналитику поблочно
 * с циклами и прочее»). Источник — книга агронома Есентая: «Учёт цветка» (срезка по сортам и категориям с весом),
 * «Черенкование» (приход, факт, брак, выбраковка, маточник), «Учёт брака» (повилика, клещ, тля…), «Данные по датам»
 * (цикл × блок: черенкование, посадка, план срезки) и листы аналитики, которые здесь считаются сами
 * (`summarizeBlock`, `summarizeCycles`).
 *
 * Чистые функции без таблицы и сессии; проверка — `scripts/check-greenhouse.ts`.
 */

// --- Справочники -------------------------------------------------------------------

export const CUTTING_KINDS = [
  { code: "invoice", label: "Приход по инвойсу", short: "Инвойс", aliases: ["приход по инвойсу", "инвойс"] },
  { code: "actual", label: "Количество по факту", short: "Факт", aliases: ["количество по факту", "по факту", "факт"] },
  { code: "dept_cull", label: "Брак с отделения", short: "Брак отд.", aliases: ["брак с отделения"] },
  { code: "nursery_cull", label: "Брак с рассадника", short: "Брак расс.", aliases: ["брак с рассадника"] },
  { code: "cull", label: "Выбраковка", short: "Выбраковка", aliases: ["выбраковка"] },
  { code: "from_stock", label: "С маточника", short: "С маточника", aliases: ["с маточника"] },
  { code: "to_stock", label: "На маточник", short: "На маточник", aliases: ["на маточник"] },
] as const;
export type CuttingKind = (typeof CUTTING_KINDS)[number]["code"];

export const WASTE_KINDS = [
  { code: "dodder", label: "Повилика", aliases: ["повилика"] },
  { code: "tech", label: "Тех брак", aliases: ["тех брак", "тех. брак", "технический брак"] },
  { code: "mite", label: "Паутинный клещ", aliases: ["паутинный клещ", "клещ"] },
  { code: "aphid", label: "Тля", aliases: ["тля"] },
  { code: "thrips", label: "Трипс", aliases: ["трипс"] },
  { code: "rust", label: "Ржавчина", aliases: ["ржавчина"] },
  { code: "botrytis", label: "Ботритис", aliases: ["ботритис"] },
  { code: "other", label: "Другое", aliases: ["другое", "прочее"] },
] as const;
export type WasteKind = (typeof WASTE_KINDS)[number]["code"];

/** Категории срезки — те же, что у хризантемы в CRM (`CHRYSANTHEMUM_GRADES`); в книге они писались цифрой. */
export const HARVEST_GRADES: readonly string[] = CHRYSANTHEMUM_GRADES;
const GRADE_ALIASES: Record<string, string> = {
  "1": "Первая",
  "2": "Вторая",
  "3": "Третья",
  "4": "Четвёртая",
  "5": "Четвёртая",
  высший: "Высшая",
  высшая: "Высшая",
  первый: "Первая",
  второй: "Вторая",
  третий: "Третья",
  четвертый: "Четвёртая",
  четвертая: "Четвёртая",
  mini: "Мини-микс",
  мини: "Мини-микс",
  "мини-микс": "Мини-микс",
  brak: "Брак",
  брак: "Брак",
  нераскрывшийся: "Нераскрывшийся",
  уценка: "Уценка",
};
/** Высшая и первая — «ликвид» по решению владельца (`LIQUID_GRADES_BY_FLOWER_TYPE` шире: там и вторая). */
export const TOP_GRADES = ["Высшая", "Первая"];

/** Сорта из книги агронома — подсказка для ввода; новый сорт вводится как есть. */
export const GH_VARIETIES = [
  "Altaj",
  "Altaj Yellow",
  "Arlisa",
  "Bacardi",
  "Bacardi Sunny",
  "Ballerinas",
  "Ballerinas Dark",
  "Ballerinas Pink",
  "Bigoudi Purple",
  "Bigoudi Red",
  "Bislet Purple",
  "Bislet White",
  "Bonita",
  "Celebrate",
  "Chic",
  "Dutchmaster",
  "Fianna",
  "Graffiti",
  "Hardwell",
  "Karma Pink",
  "Kaya",
  "Kennedy",
  "Kennedy Rossy",
  "Lamira",
  "Lamira Red",
  "Malibu",
  "Malibu Purple",
  "Memphis Autumn",
  "Momoko Pink",
  "Momoko White",
  "Pastela Blush (Pink)",
  "Pastela Cava (White)",
  "Pastela Sunny",
  "Pina Colada",
  "Podolsk",
  "Podolsk Purple",
  "Podolsk Yellow",
  "Rabelo",
  "Redstart",
  "Rihanna",
  "Topspin",
  "Zehnya Sunny",
];
const VARIETY_ALIASES: Record<string, string> = { padolsk: "Podolsk", "padolsk purple": "Podolsk Purple", chik: "Chic" };

function key(text: unknown): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .replace(/[.,;:`]+$/g, "")
    .trim();
}

export function gradeOf(raw: unknown): string {
  const k = key(raw);
  if (!k) return "";
  const exact = HARVEST_GRADES.find((g) => key(g) === k);
  if (exact) return exact;
  return GRADE_ALIASES[k] ?? "";
}

/** Сорт в одном написании: «Ballerinas dark», «Karma PInk» и «Chik» — не три сорта (регистр, пробелы, синонимы). */
export function canonicalVariety(raw: unknown, known: string[] = GH_VARIETIES): string {
  const v = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const k = key(v);
  if (!k) return "";
  const alias = VARIETY_ALIASES[k];
  if (alias) return alias;
  const found = known.find((n) => key(n) === k) ?? GH_VARIETIES.find((n) => key(n) === k);
  return found ?? v;
}

export function cuttingKindOf(raw: unknown): CuttingKind | null {
  const k = key(raw);
  if (!k) return null;
  return (CUTTING_KINDS.find((c) => c.code === k || key(c.label) === k || (c.aliases as readonly string[]).includes(k))?.code as CuttingKind | undefined) ?? null;
}
export function wasteKindOf(raw: unknown): WasteKind | null {
  const k = key(raw);
  if (!k) return null;
  return (WASTE_KINDS.find((c) => c.code === k || key(c.label) === k || (c.aliases as readonly string[]).includes(k))?.code as WasteKind | undefined) ?? null;
}
export function cuttingKindLabel(code: string): string {
  return CUTTING_KINDS.find((c) => c.code === code)?.label ?? code;
}
export function wasteKindLabel(code: string): string {
  return WASTE_KINDS.find((c) => c.code === code)?.label ?? code;
}

export function cycleOf(raw: unknown): number {
  const n = Number(String(raw ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n) : 0;
}

/** Вес из книги: «29 кг», «7, 6», 338.2 → килограммы; непонятное — 0 (без веса). */
export function weightKgOf(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) && raw >= 0 && raw < 100000 ? Math.round(raw * 100) / 100 : 0;
  const s = String(raw ?? "")
    .toLowerCase()
    .replace(/кг|kg/g, "")
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : 0;
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "")
    .replace(/\s+/g, "")
    .replace(/[`'’]+$/g, "")
    .replace(",", ".");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

// --- Записи -----------------------------------------------------------------------

export interface GhCycle {
  farm: string;
  cycle: number;
  block: string;
  cuttingsAt: string;
  plantedAt: string;
  plannedHarvestAt: string;
  note: string;
  updatedBy: string;
  updatedAt: string;
}

export interface GhHarvest {
  id: string;
  farm: string;
  date: string;
  cycle: number;
  block: string;
  variety: string;
  grade: string;
  qty: number;
  weightKg: number;
  note: string;
}

export interface GhCutting {
  id: string;
  farm: string;
  cycle: number;
  date: string;
  block: string;
  part: string;
  line: string;
  variety: string;
  kind: string;
  qty: number;
  note: string;
}

export interface GhWaste {
  id: string;
  farm: string;
  date: string;
  cycle: number;
  block: string;
  variety: string;
  qty: number;
  kind: string;
  note: string;
}

/** Строка формы любого журнала — поля как текст; сервер проверяет (`cleanLogRow`). */
export type LogKind = "harvest" | "cuttings" | "waste";
export interface LogRowDraft {
  id: string;
  date: string;
  cycle: string | number;
  block: string;
  variety: string;
  /** harvest — категория; cuttings — вид записи; waste — причина. */
  kind: string;
  qty: string | number;
  /** harvest — вес, кг. */
  weightKg?: string | number;
  part?: string;
  line?: string;
  note?: string;
}

export interface LogRowClean {
  id: string;
  date: string;
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

export function cleanLogRow(log: LogKind, draft: LogRowDraft, today: string, known: string[] = GH_VARIETIES): { row: LogRowClean | null; error: string } {
  const date = toIsoDate(String(draft.date ?? ""));
  if (!date) return { row: null, error: "нет даты" };
  if (date > today) return { row: null, error: "дата из будущего" };
  if (!plausibleDate(date, today)) return { row: null, error: "дата непонятна" };
  const cycle = cycleOf(draft.cycle);
  if (!cycle) return { row: null, error: "не указан цикл" };
  const block = cleanBlock(String(draft.block ?? ""));
  if (!block) return { row: null, error: "не указан блок" };
  const variety = canonicalVariety(draft.variety, known);
  if (!variety) return { row: null, error: "не указан сорт" };
  const qty = num(draft.qty);
  if (Number.isNaN(qty) || qty < 0) return { row: null, error: "количество — число" };
  let kind = "";
  let weightKg = 0;
  if (log === "harvest") {
    kind = gradeOf(draft.kind);
    if (!kind) return { row: null, error: "не указана категория" };
    const w = weightKgOf(draft.weightKg ?? "");
    weightKg = w;
    if (qty <= 0) return { row: null, error: "количество больше нуля" };
  } else if (log === "cuttings") {
    const k = cuttingKindOf(draft.kind);
    if (!k) return { row: null, error: "не указан вид записи" };
    kind = k;
    if (qty <= 0) return { row: null, error: "количество больше нуля" };
  } else {
    const k = wasteKindOf(draft.kind);
    if (!k) return { row: null, error: "не указана причина брака" };
    kind = k;
    if (qty <= 0) return { row: null, error: "количество больше нуля" };
  }
  return {
    row: {
      id: String(draft.id ?? "").trim(),
      date,
      cycle,
      block,
      variety,
      kind,
      qty: Math.round(qty),
      weightKg,
      part: String(draft.part ?? "").trim().slice(0, 20),
      line: String(draft.line ?? "").trim().slice(0, 20),
      note: String(draft.note ?? "").trim().slice(0, 200),
    },
    error: "",
  };
}

export interface CycleDraft {
  cycle: string | number;
  block: string;
  cuttingsAt: string;
  plantedAt: string;
  plannedHarvestAt: string;
  note: string;
}

export function cleanCycle(draft: CycleDraft): { cycle: Omit<GhCycle, "farm" | "updatedBy" | "updatedAt"> | null; error: string } {
  const cycle = cycleOf(draft.cycle);
  if (!cycle) return { cycle: null, error: "Номер цикла — целое число." };
  const block = cleanBlock(String(draft.block ?? ""));
  if (!block) return { cycle: null, error: "Укажите блок." };
  const d = (v: string, name: string): string | null => {
    const s = String(v ?? "").trim();
    if (!s) return "";
    const iso = toIsoDate(s);
    return iso || null;
  };
  const cuttingsAt = d(draft.cuttingsAt, "черенкования");
  const plantedAt = d(draft.plantedAt, "посадки");
  const plannedHarvestAt = d(draft.plannedHarvestAt, "срезки");
  if (cuttingsAt === null || plantedAt === null || plannedHarvestAt === null) return { cycle: null, error: "Дата записана неверно." };
  if (cuttingsAt && plantedAt && plantedAt < cuttingsAt) return { cycle: null, error: "Посадка раньше черенкования." };
  if (plantedAt && plannedHarvestAt && plannedHarvestAt < plantedAt) return { cycle: null, error: "План срезки раньше посадки." };
  return { cycle: { cycle, block, cuttingsAt, plantedAt, plannedHarvestAt, note: String(draft.note ?? "").trim().slice(0, 200) }, error: "" };
}

/** По книге: срезка начинается примерно через 76 дней после посадки, посадка — через ~3 недели после черенкования. */
export const PLANT_TO_HARVEST_DAYS = 76;
/** Сколько ждать срезку после ожидаемой даты, прежде чем сказать «срезки нет». */
export const NO_HARVEST_GRACE_DAYS = 30;
export const CUTTING_TO_PLANT_DAYS = 21;

// --- Загрузка из книги -------------------------------------------------------------

export interface ImportLogRow extends LogRowClean {
  ordinal: number;
}
export interface ImportResult {
  rows: ImportLogRow[];
  skipped: { line: number; why: string }[];
}

/** Лист книги → журнал. */
export function logForSheet(name: string): LogKind | "cycles" | null {
  const k = key(name);
  if (/учет цветка|учёт цветка|учет цветк/.test(k)) return "harvest";
  if (/^черенкование/.test(k)) return "cuttings";
  if (/брак/.test(k) && /учет|учёт/.test(k)) return "waste";
  if (/данные по датам/.test(k)) return "cycles";
  return null;
}

function headerIndex(first: string[], re: RegExp, fallback: number, hasHeader: boolean): number {
  if (!hasHeader) return fallback;
  const i = first.findIndex((c) => re.test(c));
  return i >= 0 ? i : fallback;
}

function rowKeyOf(r: LogRowClean): string {
  return [r.date, r.cycle, r.block, key(r.variety), r.kind, r.qty, r.weightKg, r.part, r.line].join("|");
}

function withOrdinals(rows: LogRowClean[]): ImportLogRow[] {
  const counts = new Map<string, number>();
  return rows.map((r) => {
    const k = rowKeyOf(r);
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    return { ...r, ordinal: n };
  });
}

export function importLogId(farm: string, log: LogKind, r: ImportLogRow): string {
  const prefix = log === "harvest" ? "H" : log === "cuttings" ? "C" : "W";
  return `${prefix}${workHash(`${farm}|${log}|${rowKeyOf(r)}|${r.ordinal}`)}`;
}

/** «Учёт цветка»: Дата, Блок, Сорт, Кол-во, Категория, Вес, Цикл. */
export function parseHarvestSheet(matrix: string[][], today: string, known: string[] = GH_VARIETIES): ImportResult {
  const first = matrix[0] ?? [];
  const hasHeader = first.some((c) => /дата/i.test(c));
  const cDate = headerIndex(first, /дата/i, 0, hasHeader);
  const cBlock = headerIndex(first, /блок/i, 1, hasHeader);
  const cVar = headerIndex(first, /сорт/i, 2, hasHeader);
  const cQty = headerIndex(first, /кол/i, 3, hasHeader);
  const cGrade = headerIndex(first, /катег/i, 4, hasHeader);
  const cWeight = headerIndex(first, /вес/i, 5, hasHeader);
  const cCycle = headerIndex(first, /цикл/i, 6, hasHeader);
  const skipped: ImportResult["skipped"] = [];
  const rows: LogRowClean[] = [];
  for (let i = hasHeader ? 1 : 0; i < matrix.length; i++) {
    const r = matrix[i] ?? [];
    if (r.every((c) => !String(c ?? "").trim())) continue;
    const line = i + 1;
    const cell = (c: number) => String(r[c] ?? "").trim();
    const { row, error } = cleanLogRow("harvest", { id: "", date: cell(cDate), cycle: cell(cCycle), block: cell(cBlock), variety: cell(cVar), kind: cell(cGrade), qty: cell(cQty), weightKg: cell(cWeight) }, today, known);
    if (!row) {
      skipped.push({ line, why: `${error}${error.includes("дат") ? ` («${cell(cDate)}»)` : error.includes("катег") ? ` («${cell(cGrade)}»)` : ""}` });
      continue;
    }
    rows.push(row);
  }
  return { rows: withOrdinals(rows), skipped };
}

/** «Черенкование»: Цикл, Дата, Сорт, Неделя, Тип учёта, Количество, Блок, Секция, Линия. */
export function parseCuttingsSheet(matrix: string[][], today: string, known: string[] = GH_VARIETIES): ImportResult {
  const first = matrix[0] ?? [];
  const hasHeader = first.some((c) => /дата/i.test(c));
  const cCycle = headerIndex(first, /цикл/i, 0, hasHeader);
  const cDate = headerIndex(first, /дата/i, 1, hasHeader);
  const cVar = headerIndex(first, /сорт/i, 2, hasHeader);
  const cKind = headerIndex(first, /тип/i, 4, hasHeader);
  const cQty = headerIndex(first, /кол/i, 5, hasHeader);
  const cBlock = headerIndex(first, /блок/i, 6, hasHeader);
  const cPart = headerIndex(first, /секц/i, 7, hasHeader);
  const cLine = headerIndex(first, /лини/i, 8, hasHeader);
  const skipped: ImportResult["skipped"] = [];
  const rows: LogRowClean[] = [];
  for (let i = hasHeader ? 1 : 0; i < matrix.length; i++) {
    const r = matrix[i] ?? [];
    if (r.every((c) => !String(c ?? "").trim())) continue;
    const line = i + 1;
    const cell = (c: number) => String(r[c] ?? "").trim();
    // Строки без блока — приход по инвойсу на весь цикл: блок «—».
    const block = cell(cBlock) || "—";
    const { row, error } = cleanLogRow("cuttings", { id: "", date: cell(cDate), cycle: cell(cCycle), block, variety: cell(cVar), kind: cell(cKind), qty: cell(cQty), part: cell(cPart), line: cell(cLine) }, today, known);
    if (!row) {
      if (error === "количество больше нуля") continue; // нулевые строки книги — не запись
      skipped.push({ line, why: `${error}${error.includes("дат") ? ` («${cell(cDate)}»)` : error.includes("вид") ? ` («${cell(cKind)}»)` : ""}` });
      continue;
    }
    rows.push(row);
  }
  return { rows: withOrdinals(rows), skipped };
}

/** «Учёт брака»: Цикл, Дата брака, Блок, Сорт, Кол-во, Тип брака. */
export function parseWasteSheet(matrix: string[][], today: string, known: string[] = GH_VARIETIES): ImportResult {
  const first = matrix[0] ?? [];
  const hasHeader = first.some((c) => /дата/i.test(c));
  const cCycle = headerIndex(first, /цикл/i, 0, hasHeader);
  const cDate = headerIndex(first, /дата/i, 1, hasHeader);
  const cBlock = headerIndex(first, /блок/i, 2, hasHeader);
  const cVar = headerIndex(first, /сорт/i, 3, hasHeader);
  const cQty = headerIndex(first, /кол/i, 4, hasHeader);
  const cKind = headerIndex(first, /тип|причин/i, 5, hasHeader);
  const skipped: ImportResult["skipped"] = [];
  const rows: LogRowClean[] = [];
  for (let i = hasHeader ? 1 : 0; i < matrix.length; i++) {
    const r = matrix[i] ?? [];
    if (r.every((c) => !String(c ?? "").trim())) continue;
    const line = i + 1;
    const cell = (c: number) => String(r[c] ?? "").trim();
    const { row, error } = cleanLogRow("waste", { id: "", date: cell(cDate), cycle: cell(cCycle), block: cell(cBlock), variety: cell(cVar), kind: cell(cKind), qty: cell(cQty) }, today, known);
    if (!row) {
      skipped.push({ line, why: `${error}${error.includes("причин") ? ` («${cell(cKind)}»)` : ""}` });
      continue;
    }
    rows.push(row);
  }
  return { rows: withOrdinals(rows), skipped };
}

/** «Данные по датам»: Цикл, Блок, Дата черенкования, Дата посадки, дата планируемой срезки. */
export function parseCyclesSheet(matrix: string[][]): { rows: Omit<GhCycle, "farm" | "updatedBy" | "updatedAt">[]; skipped: { line: number; why: string }[] } {
  const first = matrix[0] ?? [];
  const hasHeader = first.some((c) => /цикл/i.test(c));
  const skipped: { line: number; why: string }[] = [];
  const rows: Omit<GhCycle, "farm" | "updatedBy" | "updatedAt">[] = [];
  const seen = new Set<string>();
  for (let i = hasHeader ? 1 : 0; i < matrix.length; i++) {
    const r = matrix[i] ?? [];
    if (r.every((c) => !String(c ?? "").trim())) continue;
    const cell = (c: number) => String(r[c] ?? "").trim();
    const { cycle, error } = cleanCycle({ cycle: cell(0), block: cell(1), cuttingsAt: cell(2), plantedAt: cell(3), plannedHarvestAt: cell(4), note: "" });
    if (!cycle) {
      skipped.push({ line: i + 1, why: error });
      continue;
    }
    const k = `${cycle.cycle}|${cycle.block}`;
    if (seen.has(k)) {
      skipped.push({ line: i + 1, why: "цикл и блок повторяются" });
      continue;
    }
    seen.add(k);
    rows.push(cycle);
  }
  return { rows, skipped };
}

// --- Сводки --------------------------------------------------------------------

export interface VarietyRow {
  variety: string;
  invoice: number;
  actual: number;
  /** Факт к инвойсу, % (в книге «% лишних черенков»). */
  extraPct: number | null;
  deptCull: number;
  nurseryCull: number;
  techCull: number;
  cull: number;
  fromStock: number;
  toStock: number;
  planted: number;
  harvested: number;
  remaining: number;
  yieldPct: number | null;
  /** Срезано по категориям. */
  byGrade: Record<string, number>;
  /** Средний вес стебля по категориям, г (где взвешивали). */
  weightByGrade: Record<string, number>;
  avgWeight: number | null;
  /** Брак на блоке по причинам (повилика и т. п.). */
  wasteByKind: Record<string, number>;
  wasteTotal: number;
}

export interface BlockSummary {
  cycle: number;
  block: string;
  dates: Pick<GhCycle, "cuttingsAt" | "plantedAt" | "plannedHarvestAt" | "note">;
  firstHarvestAt: string;
  lastHarvestAt: string;
  /** План срезки из книги, а где его нет — посадка + `PLANT_TO_HARVEST_DAYS`. */
  expectedHarvestAt: string;
  expectedIsEstimate: boolean;
  varieties: VarietyRow[];
  totals: Omit<VarietyRow, "variety">;
  grades: string[];
  harvestByDay: { date: string; qty: number }[];
  wasteByDay: { date: string; qty: number }[];
  /** Доли категорий в срезке, %. */
  gradeShare: Record<string, number>;
  topShare: number | null;
  status: BlockStatus;
}

export type BlockStatus = "planned" | "cuttings" | "growing" | "harvest" | "done" | "noharvest" | "empty";
export const BLOCK_STATUS_LABELS: Record<BlockStatus, string> = {
  planned: "запланирован",
  cuttings: "черенкование",
  growing: "растёт",
  harvest: "срезка",
  done: "завершён",
  noharvest: "срезки нет",
  empty: "нет данных",
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (a: number, b: number): number | null => (b > 0 ? r1((a * 100) / b) : null);
/** Выход — только когда что-то срезали: «0 %» у растущего блока читается как провал. */
const yieldOf = (harvested: number, planted: number): number | null => (harvested > 0 ? pct(harvested, planted) : null);

function emptyRow(variety: string): VarietyRow {
  return { variety, invoice: 0, actual: 0, extraPct: null, deptCull: 0, nurseryCull: 0, techCull: 0, cull: 0, fromStock: 0, toStock: 0, planted: 0, harvested: 0, remaining: 0, yieldPct: null, byGrade: {}, weightByGrade: {}, avgWeight: null, wasteByKind: {}, wasteTotal: 0 };
}

/**
 * Сколько черенков пришло на блок: факт, а где факт не считали — инвойс; плюс черенки с собственного маточника (с 7-го
 * цикла книга ведёт посадку почти целиком «С маточника», без инвойса и факта — без этого слагаемого посажено было бы 0).
 */
export function sourceOf(x: Pick<VarietyRow, "actual" | "invoice" | "fromStock">): number {
  return (x.actual > 0 ? x.actual : x.invoice) + x.fromStock;
}

/** Сколько черенков пришло на блок — по сортам (у одного сорта есть факт, у другого только инвойс). */
export function blockSource(s: Pick<BlockSummary, "varieties">): number {
  return s.varieties.reduce((sum, v) => sum + sourceOf(v), 0);
}

/** Вес строки срезки правдоподобен: 10–400 г на стебель (в книге встречается вес, вписанный в граммах или с лишними нулями). */
export function plausibleWeight(qty: number, weightKg: number): boolean {
  if (!(qty > 0) || !(weightKg > 0)) return false;
  const g = (weightKg * 1000) / qty;
  return g >= 10 && g <= 400;
}

/** Состояние блока по датам и срезке; `today` — чтобы «срезка» не висела вечно. */
export function blockStatus(dates: Pick<GhCycle, "cuttingsAt" | "plantedAt"> & { plannedHarvestAt?: string }, firstHarvestAt: string, lastHarvestAt: string, hasAny: boolean, today: string): BlockStatus {
  if (lastHarvestAt) return shiftDay(lastHarvestAt, 14) >= today ? "harvest" : "done";
  if (firstHarvestAt) return "harvest";
  if (dates.plantedAt && dates.plantedAt <= today) {
    // Срезка должна была начаться больше месяца назад, а её нет — блок не «растёт вечно», а остался без записей срезки.
    const expected = dates.plannedHarvestAt || shiftDay(dates.plantedAt, PLANT_TO_HARVEST_DAYS);
    return shiftDay(expected, NO_HARVEST_GRACE_DAYS) < today ? "noharvest" : "growing";
  }
  if (dates.cuttingsAt && dates.cuttingsAt <= today) return "cuttings";
  if (dates.cuttingsAt || dates.plantedAt) return "planned";
  return hasAny ? "cuttings" : "empty";
}

/** Сводка по одному циклу × блоку — лист «Данные по черенкованию по блокам» и «Проценты по блокам» книги разом. */
export function summarizeBlock(
  cycle: number,
  block: string,
  data: { cycles: GhCycle[]; harvest: GhHarvest[]; cuttings: GhCutting[]; waste: GhWaste[] },
  today: string,
): BlockSummary {
  const c = data.cycles.find((x) => x.cycle === cycle && x.block === block);
  const dates = { cuttingsAt: c?.cuttingsAt ?? "", plantedAt: c?.plantedAt ?? "", plannedHarvestAt: c?.plannedHarvestAt ?? "", note: c?.note ?? "" };
  const rows = new Map<string, VarietyRow>();
  const row = (v: string) => {
    let x = rows.get(v);
    if (!x) {
      x = emptyRow(v);
      rows.set(v, x);
    }
    return x;
  };
  for (const e of data.cuttings) {
    if (e.cycle !== cycle || e.block !== block) continue;
    const x = row(e.variety);
    if (e.kind === "invoice") x.invoice += e.qty;
    else if (e.kind === "actual") x.actual += e.qty;
    else if (e.kind === "dept_cull") x.deptCull += e.qty;
    else if (e.kind === "nursery_cull") x.nurseryCull += e.qty;
    else if (e.kind === "cull") x.cull += e.qty;
    else if (e.kind === "from_stock") x.fromStock += e.qty;
    else if (e.kind === "to_stock") x.toStock += e.qty;
  }
  for (const w of data.waste) {
    if (w.cycle !== cycle || w.block !== block) continue;
    const x = row(w.variety);
    if (w.kind === "tech") x.techCull += w.qty;
    else {
      x.wasteByKind[w.kind] = (x.wasteByKind[w.kind] ?? 0) + w.qty;
      x.wasteTotal += w.qty;
    }
  }
  const weightAcc = new Map<string, { g: number; qty: number }>();
  const byDay = new Map<string, number>();
  let first = "";
  let last = "";
  for (const h of data.harvest) {
    if (h.cycle !== cycle || h.block !== block) continue;
    const x = row(h.variety);
    x.harvested += h.qty;
    x.byGrade[h.grade] = (x.byGrade[h.grade] ?? 0) + h.qty;
    if (plausibleWeight(h.qty, h.weightKg)) {
      const k = `${h.variety}|${h.grade}`;
      const acc = weightAcc.get(k) ?? { g: 0, qty: 0 };
      acc.g += h.weightKg * 1000;
      acc.qty += h.qty;
      weightAcc.set(k, acc);
    }
    byDay.set(h.date, (byDay.get(h.date) ?? 0) + h.qty);
    if (!first || h.date < first) first = h.date;
    if (!last || h.date > last) last = h.date;
  }
  const wasteDay = new Map<string, number>();
  for (const w of data.waste) if (w.cycle === cycle && w.block === block && w.kind !== "tech") wasteDay.set(w.date, (wasteDay.get(w.date) ?? 0) + w.qty);
  const varieties = Array.from(rows.values())
    .map((x) => {
      x.planted = Math.max(0, sourceOf(x) - x.deptCull - x.nurseryCull - x.techCull - x.cull);
      x.remaining = x.planted - x.harvested;
      x.extraPct = pct(x.actual, x.invoice);
      x.yieldPct = yieldOf(x.harvested, x.planted);
      let g = 0;
      let q = 0;
      for (const grade of Object.keys(x.byGrade)) {
        const acc = weightAcc.get(`${x.variety}|${grade}`);
        if (acc && acc.qty > 0) {
          x.weightByGrade[grade] = r1(acc.g / acc.qty);
          g += acc.g;
          q += acc.qty;
        }
      }
      x.avgWeight = q > 0 ? r1(g / q) : null;
      return x;
    })
    .sort((a, b) => b.harvested - a.harvested || b.planted - a.planted || a.variety.localeCompare(b.variety));
  const totals = emptyRow("");
  for (const x of varieties) {
    totals.invoice += x.invoice;
    totals.actual += x.actual;
    totals.deptCull += x.deptCull;
    totals.nurseryCull += x.nurseryCull;
    totals.techCull += x.techCull;
    totals.cull += x.cull;
    totals.fromStock += x.fromStock;
    totals.toStock += x.toStock;
    totals.planted += x.planted;
    totals.harvested += x.harvested;
    totals.wasteTotal += x.wasteTotal;
    for (const [g, q] of Object.entries(x.byGrade)) totals.byGrade[g] = (totals.byGrade[g] ?? 0) + q;
    for (const [k, q] of Object.entries(x.wasteByKind)) totals.wasteByKind[k] = (totals.wasteByKind[k] ?? 0) + q;
  }
  totals.remaining = totals.planted - totals.harvested;
  totals.extraPct = pct(totals.actual, totals.invoice);
  totals.yieldPct = yieldOf(totals.harvested, totals.planted);
  // Средний вес по категории на весь блок — взвешенно по штукам, только по взвешенным строкам.
  let tg = 0;
  let tq = 0;
  const gradeW = new Map<string, { g: number; qty: number }>();
  for (const [k, acc] of weightAcc) {
    const grade = k.split("|")[1];
    tg += acc.g;
    tq += acc.qty;
    const a = gradeW.get(grade) ?? { g: 0, qty: 0 };
    a.g += acc.g;
    a.qty += acc.qty;
    gradeW.set(grade, a);
  }
  for (const [grade, a] of gradeW) if (a.qty > 0) totals.weightByGrade[grade] = r1(a.g / a.qty);
  totals.avgWeight = tq > 0 ? r1(tg / tq) : null;
  const grades = HARVEST_GRADES.filter((g) => (totals.byGrade[g] ?? 0) > 0);
  const gradeShare: Record<string, number> = {};
  for (const g of grades) gradeShare[g] = r1(((totals.byGrade[g] ?? 0) * 100) / totals.harvested);
  const top = TOP_GRADES.reduce((s, g) => s + (totals.byGrade[g] ?? 0), 0);
  const { variety: _v, ...totalsOnly } = totals;
  const hasAny = varieties.length > 0;
  return {
    cycle,
    block,
    dates,
    firstHarvestAt: first,
    lastHarvestAt: last,
    expectedHarvestAt: dates.plannedHarvestAt || (dates.plantedAt ? shiftDay(dates.plantedAt, PLANT_TO_HARVEST_DAYS) : ""),
    expectedIsEstimate: !dates.plannedHarvestAt && !!dates.plantedAt,
    varieties,
    totals: totalsOnly,
    grades,
    harvestByDay: Array.from(byDay.entries())
      .map(([date, qty]) => ({ date, qty }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    wasteByDay: Array.from(wasteDay.entries())
      .map(([date, qty]) => ({ date, qty }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    gradeShare,
    topShare: totals.harvested > 0 ? r1((top * 100) / totals.harvested) : null,
    status: blockStatus(dates, first, last, hasAny, today),
  };
}

/** Все пары цикл × блок, которые где-то встречаются: в датах, черенковании, срезке или браке. */
export function cycleBlocks(data: { cycles: GhCycle[]; harvest: GhHarvest[]; cuttings: GhCutting[]; waste: GhWaste[] }): { cycle: number; block: string }[] {
  const seen = new Map<string, { cycle: number; block: string }>();
  const add = (cycle: number, block: string) => {
    if (!cycle || !block || block === "—") return;
    seen.set(`${cycle}|${block}`, { cycle, block });
  };
  for (const c of data.cycles) add(c.cycle, c.block);
  for (const h of data.harvest) add(h.cycle, h.block);
  for (const c of data.cuttings) add(c.cycle, c.block);
  for (const w of data.waste) add(w.cycle, w.block);
  return Array.from(seen.values()).sort((a, b) => b.cycle - a.cycle || compareBlocks(a.block, b.block));
}

export interface CycleRow {
  cycle: number;
  blocks: BlockSummary[];
  planted: number;
  harvested: number;
  yieldPct: number | null;
  topShare: number | null;
  avgWeight: number | null;
  wasteTotal: number;
  cullPct: number | null;
  firstCuttingsAt: string;
  lastHarvestAt: string;
}

/** Сводка по циклам: блоки внутри, итоги цикла. Новые циклы первыми. */
export function summarizeCycles(data: { cycles: GhCycle[]; harvest: GhHarvest[]; cuttings: GhCutting[]; waste: GhWaste[] }, today: string): CycleRow[] {
  const pairs = cycleBlocks(data);
  const byCycle = new Map<number, BlockSummary[]>();
  for (const p of pairs) {
    const s = summarizeBlock(p.cycle, p.block, data, today);
    const list = byCycle.get(p.cycle) ?? [];
    list.push(s);
    byCycle.set(p.cycle, list);
  }
  return Array.from(byCycle.entries())
    .map(([cycle, blocks]) => {
      const planted = blocks.reduce((s, b) => s + b.totals.planted, 0);
      const harvested = blocks.reduce((s, b) => s + b.totals.harvested, 0);
      const actual = blocks.reduce((s, b) => s + blockSource(b), 0);
      const loss = blocks.reduce((s, b) => s + b.totals.deptCull + b.totals.nurseryCull + b.totals.techCull + b.totals.cull, 0);
      const top = blocks.reduce((s, b) => s + TOP_GRADES.reduce((x, g) => x + (b.totals.byGrade[g] ?? 0), 0), 0);
      let wg = 0;
      let wq = 0;
      for (const b of blocks) {
        if (b.totals.avgWeight !== null) {
          // Взвешенно по срезанному с весом: приближённо — по всему срезанному блока.
          wg += b.totals.avgWeight * b.totals.harvested;
          wq += b.totals.harvested;
        }
      }
      const cuttingsDates = blocks.map((b) => b.dates.cuttingsAt).filter(Boolean).sort();
      const lastHarvest = blocks.map((b) => b.lastHarvestAt).filter(Boolean).sort();
      return {
        cycle,
        blocks,
        planted,
        harvested,
        yieldPct: yieldOf(harvested, planted),
        topShare: harvested > 0 ? r1((top * 100) / harvested) : null,
        avgWeight: wq > 0 ? r1(wg / wq) : null,
        wasteTotal: blocks.reduce((s, b) => s + b.totals.wasteTotal, 0),
        cullPct: actual > 0 ? r1((loss * 100) / actual) : null,
        firstCuttingsAt: cuttingsDates[0] ?? "",
        lastHarvestAt: lastHarvest[lastHarvest.length - 1] ?? "",
      };
    })
    .sort((a, b) => b.cycle - a.cycle);
}

export interface VarietyAcross {
  variety: string;
  cycles: number;
  planted: number;
  harvested: number;
  yieldPct: number | null;
  topShare: number | null;
  avgWeight: number | null;
  wasteTotal: number;
}

/** Сорта поверх циклов — «какой сорт даёт больше и лучше». */
export function summarizeVarieties(rows: CycleRow[]): VarietyAcross[] {
  const acc = new Map<string, VarietyAcross & { _cycles: Set<number>; _top: number; _wg: number; _wq: number }>();
  for (const c of rows) {
    for (const b of c.blocks) {
      for (const v of b.varieties) {
        let a = acc.get(v.variety);
        if (!a) {
          a = { variety: v.variety, cycles: 0, planted: 0, harvested: 0, yieldPct: null, topShare: null, avgWeight: null, wasteTotal: 0, _cycles: new Set(), _top: 0, _wg: 0, _wq: 0 };
          acc.set(v.variety, a);
        }
        a._cycles.add(c.cycle);
        a.planted += v.planted;
        a.harvested += v.harvested;
        a.wasteTotal += v.wasteTotal;
        a._top += TOP_GRADES.reduce((s, g) => s + (v.byGrade[g] ?? 0), 0);
        if (v.avgWeight !== null) {
          a._wg += v.avgWeight * v.harvested;
          a._wq += v.harvested;
        }
      }
    }
  }
  return Array.from(acc.values())
    .map(({ _cycles, _top, _wg, _wq, ...a }) => ({ ...a, cycles: _cycles.size, yieldPct: yieldOf(a.harvested, a.planted), topShare: a.harvested > 0 ? r1((_top * 100) / a.harvested) : null, avgWeight: _wq > 0 ? r1(_wg / _wq) : null }))
    .sort((a, b) => b.harvested - a.harvested);
}

/** Длительности по датам, дней: черенкование → посадка, посадка → первая срезка (план и факт), срезка целиком. */
export function blockTimeline(s: Pick<BlockSummary, "dates" | "firstHarvestAt" | "lastHarvestAt">): { rooting: number | null; growing: number | null; growingPlan: number | null; harvesting: number | null; delay: number | null } {
  const days = (a: string, b: string) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) : null);
  return {
    rooting: days(s.dates.cuttingsAt, s.dates.plantedAt),
    growing: days(s.dates.plantedAt, s.firstHarvestAt),
    growingPlan: days(s.dates.plantedAt, s.dates.plannedHarvestAt),
    harvesting: days(s.firstHarvestAt, s.lastHarvestAt),
    delay: days(s.dates.plannedHarvestAt, s.firstHarvestAt),
  };
}

/** Цикл блока на дату — тот, чья посадка последняя не позже даты (иначе самый большой номер по записям). */
export function currentCycleFor(block: string, date: string, data: { cycles: GhCycle[]; harvest: GhHarvest[] }): number {
  const dated = data.cycles.filter((c) => c.block === block && c.plantedAt && c.plantedAt <= date).sort((a, b) => b.plantedAt.localeCompare(a.plantedAt));
  if (dated.length) return dated[0].cycle;
  const anyDated = data.cycles.filter((c) => c.block === block && c.cuttingsAt && c.cuttingsAt <= date).sort((a, b) => b.cuttingsAt.localeCompare(a.cuttingsAt));
  if (anyDated.length) return anyDated[0].cycle;
  const fromHarvest = data.harvest.filter((h) => h.block === block && h.date <= date).sort((a, b) => b.date.localeCompare(a.date));
  if (fromHarvest.length) return fromHarvest[0].cycle;
  const all = data.cycles.map((c) => c.cycle);
  return all.length ? Math.max(...all) : 0;
}
