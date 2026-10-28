/**
 * Загрузка штатной расстановки файлом — чистые правила (28.10.2026, владелец прислал «Штатная расстановка
 * сотрудников ТОО Rose Farm, Октябрь 2026»: «надо собрать и загрузить это в базу и сделать лёгким возможность
 * добавлять»).
 *
 * Файл — лист «Штатная расстановка»: заголовок со словом «ФИО», дальше строки людей, между ними строки групп
 * («Звено сортировки — упаковки», «№ | Администрация») без номера. Колонки узнаются по заголовкам, не по позиции:
 * ФИО, Подразделение, Должность, Вид занятости (ТД/ГПХ), Оклад (1С), KPI, ИТОГО, Комментарии, Место жительства,
 * Стоимость проезда (дорожные в день).
 *
 * Файл читается в браузере (`xlsxLite`, как база лидов), на сервер уходят строки, и сервер разбирает их ЗАНОВО
 * (грабли 1.11). Сначала предпросмотр: кого заведём, у кого новая ставка, у кого поменялись должность или
 * подразделение, кого не тронем; потом одна запись.
 */
import { nameKey } from "./rules";
import { toIsoDate } from "../sheetDate";
import { PAY_TYPES, type Department, type Employee, type Rate } from "./types";

export interface StaffingRow {
  fullName: string;
  /** Название подразделения из файла, как есть. */
  departmentName: string;
  position: string;
  employment: "td" | "gph";
  salary1c: number;
  total: number;
  note: string;
  travelAddress: string;
  travelRate: number;
  /** «Оф уволен 16.03.2026» в примечании → дата увольнения (ГГГГ-ММ-ДД); иначе пусто. */
  firedAt: string;
}

export interface StaffingParse {
  title: string;
  /** «Данные на: 01.10.2026» в шапке книги Есентая — с какого дня действуют ставки; пусто, если строки нет. */
  dataDate: string;
  rows: StaffingRow[];
  /** Строки, которые не разобрались (нет ФИО или подразделения) — с номером строки файла. */
  skipped: { line: number; why: string }[];
}

/** Подразделения из гугл-книги → код и правила недели (как в `payroll-import.ts`). */
export const STAFFING_DEPARTMENTS: Record<string, { deptId: string; order: number; workWeek: 5 | 6; overtime: boolean; overtimeRate: number; payType?: "hourly" }> = {
  теплица: { deptId: "teplitsa", order: 1, workWeek: 5, overtime: false, overtimeRate: 0 },
  "администрация теплицы": { deptId: "admin", order: 2, workWeek: 5, overtime: false, overtimeRate: 0 },
  администрация: { deptId: "admin", order: 2, workWeek: 5, overtime: false, overtimeRate: 0 },
  "сборка готовой продукции": { deptId: "assembly", order: 3, workWeek: 6, overtime: true, overtimeRate: 0.5 },
  "сортировка и упаковка": { deptId: "sorting", order: 4, workWeek: 5, overtime: false, overtimeRate: 0 },
  "технический отдел": { deptId: "tech", order: 5, workWeek: 5, overtime: false, overtimeRate: 0 },
  "защита растений": { deptId: "protection", order: 6, workWeek: 5, overtime: true, overtimeRate: 1 },
  охрана: { deptId: "security", order: 7, workWeek: 5, overtime: false, overtimeRate: 0 },
  "програмное управление": { deptId: "priva", order: 8, workWeek: 5, overtime: false, overtimeRate: 0, payType: "hourly" },
  "программное управление": { deptId: "priva", order: 8, workWeek: 5, overtime: false, overtimeRate: 0, payType: "hourly" },
  // Книга Есентай Агро Хим (28.10.2026). Сверхурочных у хризантемы нет (владелец: ×0,5 — только Сборке ГП розы);
  // операторы PRIVA здесь с окладом и ИТОГО, как все, — помесячно, а не почасово.
  "ауп офис": { deptId: "aup-office", order: 1, workWeek: 5, overtime: false, overtimeRate: 0 },
  "коммерческий отдел": { deptId: "sales", order: 2, workWeek: 5, overtime: false, overtimeRate: 0 },
  "ауп производство": { deptId: "aup-farm", order: 3, workWeek: 5, overtime: false, overtimeRate: 0 },
  ауп: { deptId: "aup", order: 3, workWeek: 5, overtime: false, overtimeRate: 0 },
  "бутон и выбраковка": { deptId: "buton", order: 5, workWeek: 5, overtime: false, overtimeRate: 0 },
  срезка: { deptId: "cutting", order: 6, workWeek: 5, overtime: false, overtimeRate: 0 },
  "подготовка отделения": { deptId: "prep", order: 7, workWeek: 5, overtime: false, overtimeRate: 0 },
  "посадка и черенкование": { deptId: "planting", order: 8, workWeek: 5, overtime: false, overtimeRate: 0 },
  "склад готовой продукции": { deptId: "stock", order: 10, workWeek: 5, overtime: false, overtimeRate: 0 },
  "техническая служба": { deptId: "tech", order: 11, workWeek: 5, overtime: false, overtimeRate: 0 },
  "оператор priva": { deptId: "priva", order: 12, workWeek: 5, overtime: false, overtimeRate: 0 },
};

/**
 * Название блока из строки «ИТОГО АУП - ПРОИЗВОДСТВО» → «АУП производство»: аббревиатуры остаются заглавными,
 * остальное — строчными, тире и лишние пробелы убираются.
 */
function blockLabel(totalRow: string): string {
  return totalRow
    .replace(/^итого\s*/i, "")
    .replace(/\s*[-–—]\s*/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.toLowerCase()))
    .join(" ");
}

/** Дата увольнения из примечания штатки: «уволен 16.03.2026», «уволена с 01.09.2026». */
export function firedAtFromNote(note: string): string {
  const m = note.match(/уволен\D{0,12}(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (!m) return "";
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Название подразделения для карточки: первая буква заглавная, остальное — как в файле («Коммерческий отдел»). */
function deptLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function norm(s: unknown): string {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
function num(s: unknown): number {
  const t = String(s ?? "").replace(/[\s ]/g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

const HEADERS: Record<keyof Omit<StaffingRow, "employment" | "firedAt"> | "employment", RegExp> = {
  fullName: /фио/i,
  departmentName: /подразделен/i,
  position: /должност/i,
  employment: /занятост/i,
  salary1c: /оклад/i,
  total: /итого/i,
  note: /коммент|примечан/i,
  travelAddress: /место ?жительств|адрес/i,
  // У Есентая колонка дорожных называется просто «Сумма» (стоит после «Местожительство»).
  travelRate: /проезд|дорожн|^сумма$/i,
};

/** «Данные на: <дата>» в шапке книги — дата в соседней ячейке (серийное число, «01.10.2026» или ISO). */
function dataDateOf(matrix: string[][]): string {
  for (const row of matrix.slice(0, 15)) {
    const i = row.findIndex((c) => /данные на/i.test(norm(c)));
    if (i < 0) continue;
    const cell = row.slice(i + 1).map(norm).find(Boolean) ?? norm(row[i]).replace(/.*данные на:?/i, "");
    const d = toIsoDate(cell);
    if (d) return d;
  }
  return "";
}

export function parseStaffingMatrix(matrix: string[][]): StaffingParse {
  let title = "";
  let headerAt = -1;
  const col: Partial<Record<keyof typeof HEADERS, number>> = {};
  for (let i = 0; i < Math.min(matrix.length, 30); i++) {
    const row = matrix[i] ?? [];
    const joined = row.map(norm).join(" | ");
    if (!title && /штатная расстановка/i.test(joined)) title = row.map(norm).find((c) => /штатная/i.test(c)) ?? "";
    if (row.some((c) => /фио/i.test(norm(c))) && row.some((c) => /подразделен/i.test(norm(c)))) {
      headerAt = i;
      row.forEach((c, j) => {
        const text = norm(c);
        for (const [key, re] of Object.entries(HEADERS) as [keyof typeof HEADERS, RegExp][]) {
          if (col[key] === undefined && re.test(text)) col[key] = j;
        }
      });
      break;
    }
  }
  const dataDate = dataDateOf(matrix);
  if (headerAt < 0 || col.fullName === undefined || col.departmentName === undefined) {
    return { title, dataDate, rows: [], skipped: [{ line: 0, why: "Не нашёл строку заголовков со словами «ФИО» и «Подразделение»." }] };
  }
  const get = (row: string[], key: keyof typeof HEADERS) => (col[key] === undefined ? "" : row[col[key]!] ?? "");

  const rows: StaffingRow[] = [];
  const skipped: StaffingParse["skipped"] = [];
  // Блок — строки до ближайшего «ИТОГО …». В книге Есентая два разных блока носят одно подразделение «АУП»
  // («ИТОГО АУП ОФИС» и «ИТОГО АУП - ПРОИЗВОДСТВО»): если имя блока ДЛИННЕЕ подразделения его строк и начинается с него,
  // подразделением становится имя блока — иначе директор и агрономы оказались бы в одном табеле.
  let blockStart = 0;
  const closeBlock = (label: string) => {
    const block = rows.slice(blockStart);
    blockStart = rows.length;
    if (!block.length) return;
    const names = new Set(block.map((r) => r.departmentName.toLowerCase()));
    if (names.size !== 1) return;
    const dept = block[0].departmentName.toLowerCase();
    const nice = blockLabel(label);
    const low = nice.toLowerCase();
    if (low !== dept && low.startsWith(dept) && low.length > dept.length) for (const r of block) r.departmentName = nice;
  };
  for (let i = headerAt + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const fullName = norm(get(row, "fullName"));
    const departmentName = norm(get(row, "departmentName"));
    const first = norm(row[0]);
    const totalCell = row.map(norm).find((c) => /^(итого|всего)/i.test(c));
    if (totalCell && !departmentName) {
      closeBlock(totalCell);
      continue;
    }
    if (!fullName) continue;
    // Строка группы: «№ | Администрация» или «Звено сортировки» без номера и подразделения.
    if (!departmentName) {
      if (first && first !== "№" && /^\d+$/.test(first)) skipped.push({ line: i + 1, why: `${fullName}: не указано подразделение` });
      continue;
    }
    if (/^(итого|всего)/i.test(fullName)) continue;
    const employment = /гпх/i.test(get(row, "employment")) ? "gph" : "td";
    rows.push({
      fullName,
      departmentName,
      position: norm(get(row, "position")),
      employment,
      salary1c: Math.round(num(get(row, "salary1c"))),
      total: Math.round(num(get(row, "total"))),
      note: norm(get(row, "note")),
      travelAddress: norm(get(row, "travelAddress")),
      travelRate: Math.round(num(get(row, "travelRate"))),
      firedAt: firedAtFromNote(norm(get(row, "note"))),
    });
  }
  return { title, dataDate, rows, skipped };
}

export interface StaffingContext {
  departments: Department[];
  employees: Employee[];
  rates: Rate[];
  /** С какого дня действуют ставки из файла (ГГГГ-ММ-ДД, первое число месяца штатки). */
  from: string;
  farm: string;
}

export interface StaffingPlan {
  /** Подразделения, которых ещё нет: заведём с правилами по названию. */
  newDepartments: { deptId: string; name: string; farm: string; order: number; workWeek: 5 | 6; overtime: boolean; overtimeRate: number }[];
  /** Названия подразделений, которых программа не знает: код сделан из названия, правила по умолчанию. */
  unknownDepartments: string[];
  newEmployees: { row: StaffingRow; deptId: string; payType: "month" | "hourly" }[];
  /** Сотрудник есть: поменялись должность, подразделение, занятость или дорожные. */
  changedEmployees: { employee: Employee; patch: Partial<Pick<Employee, "deptId" | "position" | "employment" | "travelAddress" | "travelRate">> }[];
  /** Ставка в файле отличается от действующей — новая строка ставки с `from`. */
  newRates: { employee: Employee; salary1c: number; total: number; was: { salary1c: number; total: number } | null }[];
  unchanged: number;
  /** В файле без оклада/итого (как главный бухгалтер) — заведём без ставки. */
  noRate: string[];
}

function slug(name: string): string {
  const map: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
  return name
    .toLowerCase()
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
}

export function planStaffingImport(parse: StaffingParse, ctx: StaffingContext): StaffingPlan {
  const prefix = ctx.farm === "rose_farm" ? "" : `${ctx.farm.slice(0, 2)}-`;
  const byName = new Map(ctx.employees.map((e) => [nameKey(e.fullName), e]));
  const plan: StaffingPlan = { newDepartments: [], unknownDepartments: [], newEmployees: [], changedEmployees: [], newRates: [], unchanged: 0, noRate: [] };
  const deptByFileName = new Map<string, { deptId: string; payType: "month" | "hourly" }>();

  for (const row of parse.rows) {
    const key = row.departmentName.toLowerCase();
    if (deptByFileName.has(key)) continue;
    const known = STAFFING_DEPARTMENTS[key];
    const deptId = prefix + (known?.deptId ?? slug(row.departmentName));
    const payType = known?.payType === "hourly" ? "hourly" : "month";
    deptByFileName.set(key, { deptId, payType });
    if (ctx.departments.some((d) => d.deptId === deptId)) continue;
    if (!known) plan.unknownDepartments.push(row.departmentName);
    if (plan.newDepartments.some((d) => d.deptId === deptId)) continue;
    const label = deptLabel(row.departmentName);
    plan.newDepartments.push({
      deptId,
      name: label,
      farm: ctx.farm,
      order: known?.order ?? 90,
      workWeek: known?.workWeek ?? 5,
      overtime: known?.overtime ?? false,
      overtimeRate: known?.overtimeRate ?? 0,
    });
  }

  for (const row of parse.rows) {
    const dept = deptByFileName.get(row.departmentName.toLowerCase())!;
    const existing = byName.get(nameKey(row.fullName));
    const hasRate = row.salary1c > 0 || row.total > 0;
    if (!existing) {
      plan.newEmployees.push({ row, deptId: dept.deptId, payType: dept.payType });
      if (!hasRate) plan.noRate.push(row.fullName);
      continue;
    }
    const patch: StaffingPlan["changedEmployees"][number]["patch"] = {};
    if (existing.deptId !== dept.deptId) patch.deptId = dept.deptId;
    if (row.position && existing.position !== row.position) patch.position = row.position;
    if (existing.employment !== row.employment) patch.employment = row.employment;
    if (row.travelAddress && existing.travelAddress !== row.travelAddress) patch.travelAddress = row.travelAddress;
    if (row.travelRate > 0 && existing.travelRate !== row.travelRate) patch.travelRate = row.travelRate;
    let touched = false;
    if (Object.keys(patch).length) {
      plan.changedEmployees.push({ employee: existing, patch });
      touched = true;
    }
    if (hasRate && existing.payType === PAY_TYPES.MONTH) {
      const current = ctx.rates
        .filter((r) => r.employeeId === existing.employeeId && r.from <= ctx.from)
        .sort((a, b) => a.from.localeCompare(b.from))
        .pop();
      if (!current || current.salary1c !== row.salary1c || current.total !== row.total) {
        plan.newRates.push({ employee: existing, salary1c: row.salary1c, total: row.total, was: current ? { salary1c: current.salary1c, total: current.total } : null });
        touched = true;
      }
    }
    if (!touched) plan.unchanged += 1;
  }
  return plan;
}

/** Первое число месяца из названия файла («… Октябрь 2026») — подсказка для поля «с какого дня». */
export function monthFromTitle(title: string, fallback: string): string {
  const months = ["январ", "феврал", "март", "апрел", "ма[йя]", "июн", "июл", "август", "сентябр", "октябр", "ноябр", "декабр"];
  const m = title.match(/(январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)\D*(\d{4})/i);
  if (!m) return fallback;
  const idx = months.findIndex((re) => new RegExp(`^${re}`, "i").test(m[1]));
  if (idx < 0) return fallback;
  return `${m[2]}-${String(idx + 1).padStart(2, "0")}-01`;
}
