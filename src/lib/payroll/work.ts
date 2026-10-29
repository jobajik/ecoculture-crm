import { nameKey } from "./rules";
import type { PayrollScope } from "./access";
import type { Employee } from "./types";
import { toIsoDate } from "../sheetDate";

/**
 * Выработка цветоводов — чистые правила (этап 7 модуля «Зарплата», 29.10.2026).
 *
 * Владелец прислал книгу «Учёт работ цветоводов-срезчиков ТОО Есентай Агро Хим» и лист расчёта зарплаты к ней:
 * четыре участка (срезка; сортировка и упаковка; посадка и черенкование; подготовка к посадке), строка на человека,
 * день, блок и вид работ с количеством и часами. Оплата сдельная: на каждый вид работ — бюджет месяца, каждый получает
 * долю бюджета, равную его доле в выработке по этому виду. Срезка, сортировка, упаковка, посадка — по штукам; уборка и
 * удаление центр-бутона — по часам; подготовка — по блок-секциям (строка с «1» на человека за блок-секцию).
 *
 * Здесь нет ни таблицы, ни сессии: всё, что можно проверить на сервере и показать в браузере, — чистые функции,
 * покрытые `scripts/check-payroll-work.ts`.
 */

// --- Участки и виды работ -----------------------------------------------------------

export const WORK_AREAS = ["cut", "pack", "plant", "prep"] as const;
export type WorkArea = (typeof WORK_AREAS)[number];

export const AREA_LABELS: Record<WorkArea, string> = {
  cut: "Срезка",
  pack: "Сортировка и упаковка",
  plant: "Посадка и черенкование",
  prep: "Подготовка к посадке",
};

/** Название отдела — как в листе расчёта зарплаты. */
export const AREA_DEPT_LABELS: Record<WorkArea, string> = {
  cut: "Отдел срезки",
  pack: "Отдел сортировки и упаковки",
  plant: "Отдел посадки и черенкования",
  prep: "Отдел подготовки к посадке",
};

export type WorkBasis = "qty" | "hours";

export interface WorkType {
  code: string;
  label: string;
  /** Чем считается доля бюджета: штуки или часы. У вида «по часам» количество не вводится. */
  basis: WorkBasis;
  /** Единица количества для подписи: «шт», «блок-секц.». */
  unit: string;
  /** Как этот вид назывался в старом Excel — для загрузки истории. */
  aliases: string[];
  /** Главный вид участка — его показывает сводка и график. */
  main?: boolean;
}

const BUD: Omit<WorkType, "basis"> = { code: "bud", label: "Центр-бутон", unit: "шт", aliases: ["основной бутон", "центр-бутон", "центр бутона", "удаление центр-бутона", "уборка бутона"] };
const CLEANUP: WorkType = { code: "cleanup", label: "Уборка", basis: "hours", unit: "ч", aliases: ["уборка"] };
const OTHER: WorkType = { code: "other", label: "Прочие работы", basis: "hours", unit: "ч", aliases: ["прочее", "прочие работы", "присутствие"] };

export const WORK_TYPES: Record<WorkArea, WorkType[]> = {
  cut: [
    { code: "cut", label: "Срезка", basis: "qty", unit: "шт", aliases: ["срезка"], main: true },
    CLEANUP,
    { ...BUD, basis: "hours", unit: "ч" },
    { code: "sortpack", label: "Сортировка и упаковка", basis: "qty", unit: "шт", aliases: ["сортировка и упаковка"] },
    OTHER,
  ],
  pack: [
    { code: "sort", label: "Сортировка", basis: "qty", unit: "шт", aliases: ["сортировка"], main: true },
    { code: "pack", label: "Упаковка", basis: "qty", unit: "шт", aliases: ["упаковка"] },
    { code: "perforation", label: "Перфорация", basis: "qty", unit: "шт", aliases: ["перфорация", "перфорация упаковки"] },
    { code: "boxes", label: "Коробки", basis: "qty", unit: "шт", aliases: ["коробки", "сборка коробки"] },
    { ...BUD, basis: "qty" },
    CLEANUP,
    OTHER,
  ],
  plant: [
    { code: "cuttings", label: "Черенкование", basis: "qty", unit: "шт", aliases: ["черенкование"], main: true },
    { code: "planting", label: "Посадка", basis: "qty", unit: "шт", aliases: ["посадка"] },
    { code: "fill_trays", label: "Наполнение кассет", basis: "qty", unit: "шт", aliases: ["наполнение кассет"] },
    { code: "place_trays", label: "Расстановка кассет", basis: "qty", unit: "шт", aliases: ["расстановка кассет"] },
    { code: "nursery_cull", label: "Брак с рассадника", basis: "qty", unit: "шт", aliases: ["брак с рассадника", "выбраковка"] },
    { ...BUD, basis: "hours", unit: "ч" },
    OTHER,
  ],
  prep: [
    { code: "net_up", label: "Поднятие сетки", basis: "qty", unit: "блок-секц.", aliases: ["поднятие сетки"], main: true },
    { code: "crossbars", label: "Установка поперечных", basis: "qty", unit: "блок-секц.", aliases: ["установка поперечных"] },
    { code: "leveling", label: "Выравнивание", basis: "qty", unit: "блок-секц.", aliases: ["выравнивание"] },
    { code: "rebar_drive", label: "Забивание арматуры", basis: "qty", unit: "блок-секц.", aliases: ["забивание арматуры"] },
    { code: "net_stretch", label: "Натягивание сетки", basis: "qty", unit: "блок-секц.", aliases: ["натягивание сетки"] },
    { code: "pegs", label: "Колышки", basis: "qty", unit: "блок-секц.", aliases: ["колышки"] },
    { code: "rebar_bring", label: "Привоз арматуры", basis: "qty", unit: "блок-секц.", aliases: ["привоз арматуры", "привоз арматуру"] },
    { code: "hook", label: "Крючок", basis: "qty", unit: "блок-секц.", aliases: ["крючок"] },
    OTHER,
  ],
};

export function isWorkArea(value: string): value is WorkArea {
  return (WORK_AREAS as readonly string[]).includes(value);
}

export function workType(area: WorkArea, code: string): WorkType | null {
  return WORK_TYPES[area].find((t) => t.code === code) ?? null;
}

export function workTypeLabel(area: string, code: string): string {
  if (!isWorkArea(area)) return code;
  return workType(area, code)?.label ?? code;
}

function aliasKey(text: string): string {
  return nameKey(text).replace(/[.,;:]+$/g, "").trim();
}

/** Вид работ по тому, как он написан в старом Excel («Основной бутон », «Привоз арматуру »). */
export function workTypeByLabel(area: WorkArea, label: string): WorkType | null {
  const key = aliasKey(label);
  if (!key) return null;
  return WORK_TYPES[area].find((t) => t.code === key || aliasKey(t.label) === key || t.aliases.includes(key)) ?? null;
}

/** Блок-секция у подготовки: «1 секция » → «1». */
export function partOf(raw: string): string {
  const m = /(\d)/.exec(String(raw ?? ""));
  return m ? m[1] : "";
}

export const PARTS = ["1", "2", "3", "4"];

export function partLabel(part: string): string {
  return part ? `${part} секция` : "";
}

/** Блок как его вводят: число — числом без нулей, остальное — как есть («Маточник», «Rose Farm»). */
export function cleanBlock(raw: string): string {
  const v = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (/^\d+([.,]0+)?$/.test(v)) return String(Number(v.replace(",", ".")));
  return v;
}

export const KNOWN_BLOCKS = [...Array.from({ length: 14 }, (_, i) => String(i + 1)), "Маточник", "Rose Farm"];

/** Блоки по порядку: числа по возрастанию, потом слова. */
export function compareBlocks(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  const aNum = a !== "" && Number.isFinite(na);
  const bNum = b !== "" && Number.isFinite(nb);
  if (aNum && bNum) return na - nb;
  if (aNum) return -1;
  if (bNum) return 1;
  return a.localeCompare(b, "ru");
}

// --- Записи ---------------------------------------------------------------------

export interface WorkEntry {
  workId: string;
  farm: string;
  /** ГГГГ-ММ-ДД */
  date: string;
  area: WorkArea;
  /** Карточка сотрудника; пусто — строка из старого учёта, человек известен только по имени. */
  employeeId: string;
  /** ФИО снимком (у строк с карточкой — на момент записи). */
  name: string;
  block: string;
  /** Секция блока у подготовки: «1»–«4»; у остальных пусто. */
  part: string;
  workType: string;
  qty: number;
  hours: number;
  note: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface WorkBudget {
  /** ГГГГ-ММ */
  month: string;
  farm: string;
  area: WorkArea;
  workType: string;
  amount: number;
  note: string;
  updatedBy: string;
  updatedAt: string;
}

export interface WorkNameLink {
  farm: string;
  name: string;
  employeeId: string;
}

/** Кто это — карточка или имя из старого учёта. Один ключ на человека для сводок и расчёта. */
export function personKey(entry: Pick<WorkEntry, "employeeId" | "name">): string {
  return entry.employeeId ? `id:${entry.employeeId}` : `name:${nameKey(entry.name)}`;
}

/** Черновик строки из формы ввода за день. */
export interface WorkRowDraft {
  /** Пусто — новая строка. */
  workId: string;
  employeeId: string;
  /** ФИО строки из старого учёта без карточки: такую строку можно править и удалять, но не заводить заново. */
  name?: string;
  block: string;
  part: string;
  workType: string;
  qty: number | string;
  hours: number | string;
  note: string;
}

export interface WorkRowClean {
  workId: string;
  /** Пусто — строка старого учёта без карточки (тогда `name` обязателен). */
  employeeId: string;
  name: string;
  block: string;
  part: string;
  workType: string;
  qty: number;
  hours: number;
  note: string;
}

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v ?? "")
    .replace(/\s+/g, "")
    .replace(",", ".");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Одна строка формы — в чистом виде или текст, что с ней не так. */
export function cleanWorkRow(area: WorkArea, draft: WorkRowDraft): { row: WorkRowClean | null; error: string } {
  const employeeId = String(draft.employeeId ?? "").trim();
  const name = String(draft.name ?? "").replace(/\s+/g, " ").trim();
  const legacy = !employeeId && !!String(draft.workId ?? "").trim() && !!name;
  if (!employeeId && !legacy) return { row: null, error: "не выбран сотрудник" };
  const type = workType(area, String(draft.workType ?? "").trim());
  if (!type) return { row: null, error: "не выбран вид работ" };
  const qty = type.basis === "hours" ? 0 : num(draft.qty);
  const hours = num(draft.hours);
  if (Number.isNaN(qty) || qty < 0) return { row: null, error: "количество — число" };
  if (Number.isNaN(hours) || hours < 0 || hours > 24) return { row: null, error: "часы — число до 24" };
  if (type.basis === "qty" && qty === 0 && hours === 0) return { row: null, error: "пустая строка: ни количества, ни часов" };
  if (type.basis === "hours" && hours === 0) return { row: null, error: `«${type.label}» считается по часам — впишите часы` };
  const block = cleanBlock(String(draft.block ?? ""));
  const part = area === "prep" ? partOf(String(draft.part ?? "")) : "";
  if (area === "prep" && !part) return { row: null, error: "у подготовки нужна секция блока (1–4)" };
  return {
    row: {
      workId: String(draft.workId ?? "").trim(),
      employeeId,
      name: legacy ? name : "",
      block,
      part,
      workType: type.code,
      qty: Math.round(qty * 100) / 100,
      hours: Math.round(hours * 100) / 100,
      note: String(draft.note ?? "").trim().slice(0, 200),
    },
    error: "",
  };
}

/** Что можно человеку в выработке: ввод — админ, бухгалтер по ЗП и начальник; бюджеты — кто видит деньги и правит ставки. */
export function workEditRefusal(scope: PayrollScope | null): string {
  if (!scope) return "Раздел «Зарплата» для вашей почты не открыт.";
  if (!scope.editsWork) return "Выработку записывает ответственный за участок (начальник), бухгалтер по зарплате или администратор.";
  return "";
}

export function workBudgetRefusal(scope: PayrollScope | null): string {
  if (!scope) return "Раздел «Зарплата» для вашей почты не открыт.";
  if (!scope.editsRates) return "Бюджеты на виды работ ставит бухгалтер по зарплате или администратор.";
  return "";
}

/** Проверка всего дня перед записью: дата, участок и каждая строка. Возвращает чистые строки или текст отказа. */
export function cleanWorkDay(
  scope: PayrollScope | null,
  area: string,
  date: string,
  drafts: WorkRowDraft[],
  employees: Pick<Employee, "employeeId" | "fullName">[],
  today: string,
): { rows: WorkRowClean[]; error: string } {
  const refusal = workEditRefusal(scope);
  if (refusal) return { rows: [], error: refusal };
  if (!isWorkArea(area)) return { rows: [], error: "Неизвестный участок." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || toIsoDate(date) !== date) return { rows: [], error: "Дата записана неверно." };
  if (date > today) return { rows: [], error: "Выработку на будущий день не записывают — только по факту." };
  const known = new Set(employees.map((e) => e.employeeId));
  const rows: WorkRowClean[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();
  drafts.forEach((d, i) => {
    const { row, error } = cleanWorkRow(area, d);
    if (!row) {
      errors.push(`строка ${i + 1}: ${error}`);
      return;
    }
    if (row.employeeId && !known.has(row.employeeId)) {
      errors.push(`строка ${i + 1}: сотрудник не из штата этой компании`);
      return;
    }
    // Один человек, один блок, один вид работ в день — одна строка: двойная запись удвоила бы долю в бюджете.
    const key = `${row.employeeId || `name:${nameKey(row.name)}`}|${row.block}|${row.part}|${row.workType}`;
    if (seen.has(key)) {
      errors.push(`строка ${i + 1}: повторяет строку ${seen.get(key)! + 1} (тот же сотрудник, блок и вид работ) — сложите количество в одну`);
      return;
    }
    seen.set(key, i);
    rows.push(row);
  });
  if (errors.length) return { rows: [], error: errors.slice(0, 5).join("; ") + (errors.length > 5 ? ` — и ещё ${errors.length - 5}` : "") };
  return { rows, error: "" };
}

// --- Загрузка истории из Excel ---------------------------------------------------------

/** Лист книги → участок. Названия в книге пишутся и с «ё», и без. */
export function areaForSheet(name: string): WorkArea | null {
  const k = aliasKey(name);
  if (/срезк/.test(k)) return "cut";
  if (/сортиров/.test(k)) return "pack";
  if (/посадк/.test(k) && !/подготов/.test(k)) return "plant";
  if (/подготов/.test(k)) return "prep";
  return null;
}

export interface ImportRow {
  area: WorkArea;
  date: string;
  name: string;
  block: string;
  part: string;
  workType: string;
  qty: number;
  hours: number;
  /** Порядковый номер среди одинаковых строк файла: вторая такая же строка — не дубль, а вторая запись. */
  ordinal: number;
}

export interface ImportSheetResult {
  area: WorkArea;
  rows: ImportRow[];
  skipped: { line: number; why: string }[];
  /** Чужие названия видов работ — показать, но не грузить. */
  unknownTypes: Record<string, number>;
}

/** Даты старого учёта бывают с опечатками («0202-06-29», «2037-01-27»): такие строки не грузятся, а показываются. */
export function plausibleDate(iso: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const max = toIsoDate(new Date(Date.parse(today) + 2 * 86400000));
  return iso >= "2023-01-01" && iso <= max;
}

/**
 * Разбор листа учёта: «Дата, ФИО, Блок, Вид работ, Кол-во, Часов» (срезка, сортировка, посадка) или «Дата, ФИО, Блок,
 * Секция, №, Вид работ, Кол-во» (подготовка — у неё шапки нет, первая строка уже данные). Колонки узнаются по шапке,
 * а без шапки — по положению.
 */
export function parseWorkSheet(area: WorkArea, matrix: string[][], today: string): ImportSheetResult {
  const skipped: { line: number; why: string }[] = [];
  const unknownTypes: Record<string, number> = {};
  const raw: Omit<ImportRow, "ordinal">[] = [];
  const first = matrix[0] ?? [];
  const hasHeader = first.some((c) => /дата/i.test(c)) || first.some((c) => /фио/i.test(c));
  const col = (re: RegExp, fallback: number) => {
    if (!hasHeader) return fallback;
    const i = first.findIndex((c) => re.test(c));
    return i >= 0 ? i : fallback;
  };
  const prep = area === "prep";
  const cDate = col(/дата/i, 0);
  const cName = col(/фио/i, 1);
  const cBlock = col(/блок/i, 2);
  const cPart = prep ? col(/секц/i, 3) : -1;
  const cType = col(/вид/i, prep ? 5 : 3);
  const cQty = col(/кол/i, prep ? 6 : 4);
  const cHours = prep ? -1 : col(/час/i, 5);
  for (let i = hasHeader ? 1 : 0; i < matrix.length; i++) {
    const r = matrix[i] ?? [];
    const line = i + 1;
    const cell = (c: number) => (c >= 0 ? String(r[c] ?? "").trim() : "");
    if (r.every((c) => !String(c ?? "").trim())) continue;
    const name = cell(cName).replace(/\s+/g, " ").replace(/ /g, " ").trim();
    const dateRaw = cell(cDate);
    const date = toIsoDate(dateRaw);
    if (!name) {
      skipped.push({ line, why: "нет ФИО" });
      continue;
    }
    if (!plausibleDate(date, today)) {
      skipped.push({ line, why: `дата непонятна: «${dateRaw}»` });
      continue;
    }
    const typeRaw = cell(cType);
    let type = typeRaw ? workTypeByLabel(area, typeRaw) : null;
    if (typeRaw && !type) {
      unknownTypes[typeRaw] = (unknownTypes[typeRaw] ?? 0) + 1;
      skipped.push({ line, why: `неизвестный вид работ «${typeRaw}»` });
      continue;
    }
    const qtyN = num(cell(cQty));
    const hoursN = num(cell(cHours));
    const qty = Number.isNaN(qtyN) ? 0 : qtyN;
    const hours = Number.isNaN(hoursN) ? 0 : hoursN;
    if (!type) {
      // Без вида работ, но с часами — так в книге отмечали присутствие окладных на блоке.
      if (hours > 0 || prep) type = workType(area, "other")!;
      else {
        skipped.push({ line, why: "нет вида работ и часов" });
        continue;
      }
    }
    if (type.basis === "qty" && qty <= 0 && hours <= 0 && !prep) {
      skipped.push({ line, why: "ни количества, ни часов" });
      continue;
    }
    const part = prep ? partOf(cell(cPart)) : "";
    raw.push({
      area,
      date,
      name,
      block: cleanBlock(cell(cBlock)),
      part,
      workType: type.code,
      qty: prep ? (qty > 0 ? qty : 1) : Math.round(qty * 100) / 100,
      hours: Math.round(hours * 100) / 100,
    });
  }
  const counts = new Map<string, number>();
  const rows: ImportRow[] = raw.map((r) => {
    const key = importKeyOf(r);
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return { ...r, ordinal: n };
  });
  return { area, rows, skipped, unknownTypes };
}

function importKeyOf(r: Omit<ImportRow, "ordinal">): string {
  return [r.area, r.date, nameKey(r.name), r.block, r.part, r.workType, r.qty, r.hours].join("|");
}

/** Короткий устойчивый хэш (два FNV-1a с разными затравками): одинаковая строка файла — одинаковый WorkID. */
export function workHash(text: string): string {
  const fnv = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return fnv(2166136261) + fnv(1540483477);
}

export function importWorkId(farm: string, r: ImportRow): string {
  return `X${workHash(`${farm}|${importKeyOf(r)}|${r.ordinal}`)}`;
}

// --- Сопоставление имён с карточками ------------------------------------------------------

/** Ключ «фамилия имя» — по нему узнаётся человек, записанный без отчества или с опечаткой в нём. */
export function twoWordKey(name: string): string {
  return nameKey(name).split(" ").slice(0, 2).join(" ");
}

/**
 * Карточка по имени: сначала точное совпадение ФИО, потом привязка из PayrollWorkNames, потом «фамилия имя», если
 * такой человек один. Двое с одинаковыми «фамилия имя» — не угадываем (грабли: «Маргарит» в базе шесть).
 */
export function matchEmployeeByName(
  name: string,
  employees: Pick<Employee, "employeeId" | "fullName">[],
  links: Pick<WorkNameLink, "name" | "employeeId">[] = [],
): string {
  const key = nameKey(name);
  if (!key) return "";
  const exact = employees.filter((e) => nameKey(e.fullName) === key);
  if (exact.length === 1) return exact[0].employeeId;
  const link = links.find((l) => nameKey(l.name) === key);
  if (link && employees.some((e) => e.employeeId === link.employeeId)) return link.employeeId;
  const two = twoWordKey(name);
  if (two.split(" ").length < 2) return "";
  const loose = employees.filter((e) => twoWordKey(e.fullName) === two);
  return loose.length === 1 ? loose[0].employeeId : "";
}

/** Имя как показать человеку: карточка главнее снимка. */
export function displayName(entry: Pick<WorkEntry, "employeeId" | "name">, employees: Map<string, Pick<Employee, "fullName">>): string {
  const e = entry.employeeId ? employees.get(entry.employeeId) : undefined;
  return e?.fullName || entry.name || "—";
}

// --- Периоды ------------------------------------------------------------------------

export function isMonthKey(v: string): boolean {
  return /^\d{4}-\d{2}$/.test(v);
}

export function monthRange(month: string): { from: string; to: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

export function shiftDay(date: string, delta: number): string {
  const d = new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86400000);
  return d.toISOString().slice(0, 10);
}

/** Период страницы: из адреса (`from`, `to`), иначе месяц, иначе текущий месяц. Концы включительно, не длиннее года. */
export function periodFor(params: { from?: string; to?: string; month?: string } | undefined, today: string): { from: string; to: string; month: string } {
  const month = params?.month && isMonthKey(params.month) ? params.month : today.slice(0, 7);
  const mr = monthRange(month);
  let from = params?.from && toIsoDate(params.from) === params.from ? params.from : mr.from;
  let to = params?.to && toIsoDate(params.to) === params.to ? params.to : params?.from ? from : mr.to;
  if (to < from) [from, to] = [to, from];
  if (shiftDay(from, 366) < to) to = shiftDay(from, 366);
  return { from, to, month: from.slice(0, 7) };
}

/** Такой же по длине период перед этим — для сравнения «а в прошлый раз». */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  return { from: shiftDay(from, -days), to: shiftDay(from, -1) };
}

// --- Сводки -----------------------------------------------------------------------

export interface TypeTotal {
  workType: string;
  label: string;
  basis: WorkBasis;
  unit: string;
  qty: number;
  hours: number;
  /** Человеко-дней с этим видом работ. */
  personDays: number;
  people: number;
  days: number;
  blocks: number;
}

export interface PersonTotal {
  key: string;
  employeeId: string;
  name: string;
  qty: number;
  hours: number;
  days: number;
  byType: Record<string, { qty: number; hours: number }>;
  /** Штук в час по главному виду участка (если есть и штуки, и часы). */
  perHour: number | null;
}

export interface BlockTotal {
  block: string;
  qty: number;
  hours: number;
  days: number;
  people: number;
  byType: Record<string, number>;
}

export interface DayTotal {
  date: string;
  qty: number;
  hours: number;
  people: number;
}

export interface AreaSummary {
  area: WorkArea;
  entries: number;
  types: TypeTotal[];
  people: PersonTotal[];
  blocks: BlockTotal[];
  days: DayTotal[];
  /** Главный вид участка: всего штук, часов по нему и штук в час. */
  main: { workType: string; label: string; unit: string; qty: number; hours: number; perHour: number | null; people: number; days: number } | null;
  personDays: number;
}

/** Сводка по участку за период. Имена — через карточки, где они есть. */
export function summarizeArea(area: WorkArea, entries: WorkEntry[], names: Map<string, Pick<Employee, "fullName">>): AreaSummary {
  const list = entries.filter((e) => e.area === area);
  const typeMap = new Map<string, TypeTotal & { _people: Set<string>; _days: Set<string>; _blocks: Set<string>; _pd: Set<string> }>();
  const personMap = new Map<string, PersonTotal & { _days: Set<string> }>();
  const blockMap = new Map<string, BlockTotal & { _days: Set<string>; _people: Set<string> }>();
  const dayMap = new Map<string, DayTotal & { _people: Set<string> }>();
  const pdAll = new Set<string>();
  for (const e of list) {
    const type = workType(area, e.workType) ?? { code: e.workType, label: e.workType, basis: "qty" as WorkBasis, unit: "шт", aliases: [] };
    const pk = personKey(e);
    pdAll.add(`${pk}|${e.date}`);
    let t = typeMap.get(type.code);
    if (!t) {
      t = { workType: type.code, label: type.label, basis: type.basis, unit: type.unit, qty: 0, hours: 0, personDays: 0, people: 0, days: 0, blocks: 0, _people: new Set(), _days: new Set(), _blocks: new Set(), _pd: new Set() };
      typeMap.set(type.code, t);
    }
    t.qty += e.qty;
    t.hours += e.hours;
    t._people.add(pk);
    t._days.add(e.date);
    t._pd.add(`${pk}|${e.date}`);
    if (e.block) t._blocks.add(e.block);
    let p = personMap.get(pk);
    if (!p) {
      p = { key: pk, employeeId: e.employeeId, name: displayName(e, names), qty: 0, hours: 0, days: 0, byType: {}, perHour: null, _days: new Set() };
      personMap.set(pk, p);
    }
    p.qty += e.qty;
    p.hours += e.hours;
    p._days.add(e.date);
    const bt = (p.byType[type.code] ??= { qty: 0, hours: 0 });
    bt.qty += e.qty;
    bt.hours += e.hours;
    const bkey = e.block || "—";
    let b = blockMap.get(bkey);
    if (!b) {
      b = { block: bkey, qty: 0, hours: 0, days: 0, people: 0, byType: {}, _days: new Set(), _people: new Set() };
      blockMap.set(bkey, b);
    }
    b.qty += e.qty;
    b.hours += e.hours;
    b._days.add(e.date);
    b._people.add(pk);
    b.byType[type.code] = (b.byType[type.code] ?? 0) + (type.basis === "qty" ? e.qty : e.hours);
    let d = dayMap.get(e.date);
    if (!d) {
      d = { date: e.date, qty: 0, hours: 0, people: 0, _people: new Set() };
      dayMap.set(e.date, d);
    }
    d.qty += e.qty;
    d.hours += e.hours;
    d._people.add(pk);
  }
  const order = WORK_TYPES[area].map((t) => t.code);
  const types: TypeTotal[] = Array.from(typeMap.values())
    .map(({ _people, _days, _blocks, _pd, ...t }) => ({ ...t, people: _people.size, days: _days.size, blocks: _blocks.size, personDays: _pd.size, qty: round2(t.qty), hours: round2(t.hours) }))
    .sort((a, b) => order.indexOf(a.workType) - order.indexOf(b.workType));
  const mainType = WORK_TYPES[area].find((t) => t.main)!;
  const people: PersonTotal[] = Array.from(personMap.values())
    .map(({ _days, ...p }) => {
      const m = p.byType[mainType.code];
      const perHour = m && m.hours > 0 && m.qty > 0 ? round1(m.qty / m.hours) : null;
      return { ...p, days: _days.size, qty: round2(p.qty), hours: round2(p.hours), perHour };
    })
    .sort((a, b) => b.qty - a.qty || b.hours - a.hours || a.name.localeCompare(b.name, "ru"));
  const blocks: BlockTotal[] = Array.from(blockMap.values())
    .map(({ _days, _people, ...b }) => ({ ...b, days: _days.size, people: _people.size, qty: round2(b.qty), hours: round2(b.hours) }))
    .sort((a, b) => compareBlocks(a.block, b.block));
  const days: DayTotal[] = Array.from(dayMap.values())
    .map(({ _people, ...d }) => ({ ...d, people: _people.size, qty: round2(d.qty), hours: round2(d.hours) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const mt = typeMap.get(mainType.code);
  const main = mt
    ? { workType: mt.workType, label: mt.label, unit: mt.unit, qty: round2(mt.qty), hours: round2(mt.hours), perHour: mt.hours > 0 && mt.qty > 0 ? round1(mt.qty / mt.hours) : null, people: mt._people.size, days: mt._days.size }
    : null;
  return { area, entries: list.length, types, people, blocks, days, main, personDays: pdAll.size };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Изменение к прошлому периоду в процентах; null — сравнивать не с чем. */
export function deltaPercent(now: number, before: number): number | null {
  if (!before) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

// --- Оплата труда -----------------------------------------------------------------

export interface PayTypeColumn {
  workType: string;
  label: string;
  basis: WorkBasis;
  unit: string;
  /** Выработка всех за месяц по этому виду (штуки или часы — по basis). */
  total: number;
  budget: number;
  /** Есть ли у кого-то выработка: колонку без неё в листе не показываем. */
  used: boolean;
}

export interface PayPersonRow {
  key: string;
  employeeId: string;
  name: string;
  /** По видам: выработка, доля (0–1) и заработано. */
  cells: Record<string, { done: number; share: number; earned: number }>;
  total: number;
}

export interface AreaPay {
  area: WorkArea;
  columns: PayTypeColumn[];
  rows: PayPersonRow[];
  budgetTotal: number;
  earnedTotal: number;
  /** Бюджет есть, а выработки нет — деньги никому не распределены. */
  unspent: { workType: string; label: string; amount: number }[];
}

/**
 * Расчёт как в листе книги: по каждому виду работ доля человека = его выработка ÷ выработка всех, заработано = доля ×
 * бюджет месяца. Вид без бюджета даёт ноль, бюджет без выработки остаётся нераспределённым (показывается отдельно).
 */
export function computeAreaPay(area: WorkArea, entries: WorkEntry[], budgets: WorkBudget[], names: Map<string, Pick<Employee, "fullName">>): AreaPay {
  const list = entries.filter((e) => e.area === area);
  const budgetOf = (code: string) => budgets.find((b) => b.area === area && b.workType === code)?.amount ?? 0;
  const columns: PayTypeColumn[] = WORK_TYPES[area]
    .filter((t) => t.code !== "other")
    .map((t) => {
      const total = list.filter((e) => e.workType === t.code).reduce((s, e) => s + (t.basis === "qty" ? e.qty : e.hours), 0);
      return { workType: t.code, label: t.label, basis: t.basis, unit: t.unit, total: round2(total), budget: budgetOf(t.code), used: total > 0 };
    });
  const people = new Map<string, PayPersonRow>();
  for (const e of list) {
    const col = columns.find((c) => c.workType === e.workType);
    if (!col) continue;
    const pk = personKey(e);
    let row = people.get(pk);
    if (!row) {
      row = { key: pk, employeeId: e.employeeId, name: displayName(e, names), cells: {}, total: 0 };
      people.set(pk, row);
    }
    const cell = (row.cells[col.workType] ??= { done: 0, share: 0, earned: 0 });
    cell.done += col.basis === "qty" ? e.qty : e.hours;
  }
  for (const row of people.values()) {
    let total = 0;
    for (const col of columns) {
      const cell = row.cells[col.workType];
      if (!cell) continue;
      cell.done = round2(cell.done);
      cell.share = col.total > 0 ? cell.done / col.total : 0;
      // Не округляем по ячейкам: сумма долей обязана давать ровно бюджет, как в листе книги.
      cell.earned = cell.share * col.budget;
      total += cell.earned;
    }
    row.total = Math.round(total * 100) / 100;
  }
  const rows = Array.from(people.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ru"));
  const budgetTotal = columns.reduce((s, c) => s + c.budget, 0);
  const earnedTotal = Math.round(rows.reduce((s, r) => s + columns.reduce((x, c) => x + (r.cells[c.workType]?.earned ?? 0), 0), 0) * 100) / 100;
  const unspent = columns.filter((c) => c.budget > 0 && c.total === 0).map((c) => ({ workType: c.workType, label: c.label, amount: c.budget }));
  return { area, columns, rows, budgetTotal, earnedTotal, unspent };
}

/** Бюджет из формы: число ≥ 0, пусто — ноль. */
export function cleanBudgetAmount(raw: unknown): number | null {
  const n = num(raw);
  if (Number.isNaN(n) || n < 0 || n > 1e9) return null;
  return Math.round(n);
}

/** Бригада на день: кто записан на участке в последний день с записями до `date` — с их блоком и видом работ. */
export function lastCrew(area: WorkArea, entries: WorkEntry[], date: string): { date: string; rows: Pick<WorkEntry, "employeeId" | "block" | "part" | "workType">[] } | null {
  const before = entries.filter((e) => e.area === area && e.date < date && e.employeeId);
  if (!before.length) return null;
  const last = before.reduce((m, e) => (e.date > m ? e.date : m), "");
  const seen = new Set<string>();
  const rows = before
    .filter((e) => e.date === last)
    .filter((e) => {
      const k = `${e.employeeId}|${e.block}|${e.part}|${e.workType}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((e) => ({ employeeId: e.employeeId, block: e.block, part: e.part, workType: e.workType }));
  return { date: last, rows };
}

/** Сотрудники участка — кто работал на нём последние `days` дней: их форма показывает первыми. */
export function recentPeople(area: WorkArea, entries: WorkEntry[], date: string, days = 45): string[] {
  const since = shiftDay(date, -days);
  const last = new Map<string, string>();
  for (const e of entries) {
    if (e.area !== area || !e.employeeId || e.date < since || e.date > date) continue;
    if ((last.get(e.employeeId) ?? "") < e.date) last.set(e.employeeId, e.date);
  }
  return Array.from(last.entries())
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([id]) => id);
}
