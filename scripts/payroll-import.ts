/*
 * Загрузка штатной расстановки из гугл-книги расчётной ведомости (скачанной как .xlsx) в справочники «Зарплаты».
 *
 * Берёт вкладки «Штатная расстановка-Розы» (ФИО, подразделение, должность, ТД/ГПХ, Оклад (1С), KPI, ИТОГО) и
 * «Баланс рабочего времени …» (нормы по месяцам и праздники). Заводит подразделения с их правилами из таблицы
 * (Сборка ГП — шестидневка и сверхурочные ×0,5, Защита растений — сверхурочные ×1), сотрудников и первую ставку
 * с указанной даты. Операторы PRIVA становятся почасовыми БЕЗ ставки — тариф в час им задаёт бухгалтер.
 *
 * Идемпотентно: сотрудник с тем же ФИО (без учёта регистра и «ё») второй раз не заводится, баланс и праздники
 * переписываются; ставки добавляются только тем, кого завёл этот запуск. Без --yes только показывает, что сделает.
 *
 * Компания: --farm rose_farm (по умолчанию) или --farm esentai — книга у каждого ТОО своя, подразделения заводятся с
 * этой компанией; у Есентая коды подразделений получают приставку es- (чтобы не слиться с Rose Farm).
 *
 * Запуск: npx tsx scripts/payroll-import.ts <файл.xlsx> --from 2024-07-01 [--farm rose_farm|esentai] [--yes]
 */
import * as dotenv from "dotenv";
import ExcelJS from "exceljs";
import { commitAtomic, readTable } from "../src/lib/sheets";
import { generateId } from "../src/lib/id";
import { listBalance, listDepartments, listEmployees, listHolidays, saveBalanceMonth, saveDepartment } from "../src/lib/repo/payroll";
import { kpiOf, nameKey } from "../src/lib/payroll/rules";
import { FARM_ORDER, SHEET_TABS } from "../src/lib/constants";

dotenv.config({ path: ".env.local" });
dotenv.config();

const DEPARTMENTS: Record<string, { deptId: string; order: number; workWeek: 5 | 6; overtime: boolean; overtimeRate: number }> = {
  теплица: { deptId: "teplitsa", order: 1, workWeek: 5, overtime: false, overtimeRate: 0 },
  "администрация теплицы": { deptId: "admin", order: 2, workWeek: 5, overtime: false, overtimeRate: 0 },
  "сборка готовой продукции": { deptId: "assembly", order: 3, workWeek: 6, overtime: true, overtimeRate: 0.5 },
  "сортировка и упаковка": { deptId: "sorting", order: 4, workWeek: 5, overtime: false, overtimeRate: 0 },
  "технический отдел": { deptId: "tech", order: 5, workWeek: 5, overtime: false, overtimeRate: 0 },
  "защита растений": { deptId: "protection", order: 6, workWeek: 5, overtime: true, overtimeRate: 1 },
  охрана: { deptId: "security", order: 7, workWeek: 5, overtime: false, overtimeRate: 0 },
};

function text(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("result" in v) return text((v as { result: ExcelJS.CellValue }).result);
    if ("richText" in v) return (v as { richText: { text: string }[] }).richText.map((r) => r.text).join("");
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return "";
  }
  return String(v);
}
function num(v: ExcelJS.CellValue): number {
  const t = text(v).replace(/\s/g, "").replace(",", ".");
  return Number(t) || 0;
}
function iso(v: ExcelJS.CellValue): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = text(v);
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : "";
}

async function main() {
  const [file, ...rest] = process.argv.slice(2);
  const yes = rest.includes("--yes");
  const fromIdx = rest.indexOf("--from");
  const from = fromIdx >= 0 ? rest[fromIdx + 1] : "";
  const farmIdx = rest.indexOf("--farm");
  const farm = farmIdx >= 0 ? rest[farmIdx + 1] : "rose_farm";
  if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !FARM_ORDER.includes(farm)) {
    console.log("Запуск: npx tsx scripts/payroll-import.ts <файл.xlsx> --from ГГГГ-ММ-ДД [--farm rose_farm|esentai] [--yes]");
    process.exit(1);
  }
  const deptPrefix = farm === "rose_farm" ? "" : "es-";

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const staff = wb.worksheets.find((w) => /штатная/i.test(w.name));
  const balanceWs = wb.worksheets.find((w) => /баланс/i.test(w.name));
  if (!staff) throw new Error("Вкладка «Штатная расстановка» не найдена");

  // --- Разбор штатной расстановки: заголовок «ФИО работника» ищется, колонки — по нему.
  let headerRow = 0;
  staff.eachRow((row, n) => {
    if (!headerRow && /фио/i.test(text(row.getCell(1).value))) headerRow = n;
  });
  if (!headerRow) throw new Error("Строка заголовков со словом «ФИО» не найдена");

  type Person = { fullName: string; dept: string; position: string; employment: "td" | "gph"; salary1c: number; total: number; note: string };
  const people: Person[] = [];
  const unknownDepts = new Set<string>();
  for (let n = headerRow + 1; n <= staff.rowCount; n++) {
    const row = staff.getRow(n);
    const fullName = text(row.getCell(1).value).replace(/\s+/g, " ").trim();
    if (!fullName) continue;
    const deptName = text(row.getCell(2).value).trim().toLowerCase();
    const dept = DEPARTMENTS[deptName];
    if (!dept) {
      unknownDepts.add(deptName || "(пусто)");
      continue;
    }
    const deptId = deptPrefix + dept.deptId;
    const employment = /гпх/i.test(text(row.getCell(4).value)) ? "gph" : "td";
    people.push({
      fullName,
      dept: deptId,
      position: text(row.getCell(3).value).replace(/\s+/g, " ").trim(),
      employment,
      salary1c: Math.round(num(row.getCell(5).value)),
      total: Math.round(num(row.getCell(7).value)),
      note: text(row.getCell(9).value).trim() || text(row.getCell(8).value).trim(),
    });
  }

  // --- Баланс и праздники.
  const months: { month: string; days5: number; hours5: number; days6: number; hours6: number }[] = [];
  const holidays: string[] = [];
  if (balanceWs) {
    balanceWs.eachRow((row) => {
      const m = iso(row.getCell(2).value);
      const d5 = num(row.getCell(3).value);
      if (m && d5 > 0) months.push({ month: m.slice(0, 7), days5: d5, hours5: num(row.getCell(4).value), days6: num(row.getCell(5).value), hours6: num(row.getCell(6).value) });
    });
    const headRow = balanceWs.getRow(5);
    headRow.eachCell((cell, col) => {
      if (col >= 9) {
        const d = iso(cell.value);
        if (d && !holidays.includes(d)) holidays.push(d);
      }
    });
  }

  console.log(`Компания: ${farm}. Сотрудников в файле: ${people.length} (ТД ${people.filter((p) => p.employment === "td").length}, ГПХ ${people.filter((p) => p.employment === "gph").length})`);
  if (unknownDepts.size) console.log(`Пропущены строки с подразделениями не из списка: ${Array.from(unknownDepts).join(", ")}`);
  console.log(`Месяцев баланса: ${months.length}, праздников: ${holidays.length}`);

  const [departments, employees, balance, existingHolidays] = await Promise.all([listDepartments(), listEmployees(), listBalance(), listHolidays()]);
  const known = new Set(employees.map((e) => nameKey(e.fullName)));
  const fresh = people.filter((p) => !known.has(nameKey(p.fullName)));
  const hourly = (p: Person) => /priva/i.test(p.position);
  console.log(`Новых сотрудников: ${fresh.length} (уже есть: ${people.length - fresh.length}); почасовых без ставки: ${fresh.filter(hourly).length}`);
  for (const p of fresh.slice(0, 5)) console.log(`  ${p.fullName} — ${p.dept}, ${p.position}, ${p.employment}, 1С ${p.salary1c}, ИТОГО ${p.total}`);
  if (fresh.length > 5) console.log(`  … и ещё ${fresh.length - 5}`);

  if (!yes) {
    console.log("\nБез --yes ничего не записано.");
    return;
  }
  // Чтение справочников выше глотает ошибку (вкладки могло не быть), а запись без удачного чтения завела бы всех
  // второй раз (грабли 1.14): перед записью читаем вкладку сотрудников строго — не ответила, значит не пишем.
  await readTable(SHEET_TABS.PAYROLL_EMPLOYEES, { fresh: true });

  // 1. Подразделения — только отсутствующие (правила существующих не трогаем).
  for (const [name, d] of Object.entries(DEPARTMENTS)) {
    const deptId = deptPrefix + d.deptId;
    if (departments.some((x) => x.deptId === deptId)) continue;
    const label = name.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
    await saveDepartment({ ...d, deptId, farm, name: label, note: "из штатной расстановки", active: true });
    console.log(`Подразделение заведено: ${label} (${deptId}, ${farm})`);
  }

  // 2. Сотрудники и ставки — одним пакетом.
  const now = new Date().toISOString();
  const empRecords: Record<string, unknown>[] = [];
  const rateRecords: Record<string, unknown>[] = [];
  for (const p of fresh) {
    const employeeId = generateId("EMP");
    empRecords.push({
      EmployeeID: employeeId,
      FullName: p.fullName,
      DeptID: p.dept,
      Position: p.position,
      Employment: p.employment,
      PayType: hourly(p) ? "hourly" : "month",
      HiredAt: "",
      FiredAt: "",
      TravelAddress: "",
      TravelRate: "",
      Note: p.note,
      CreatedAt: now,
      CreatedBy: "import",
      UpdatedAt: now,
      UpdatedBy: "import",
      Iin: "",
    });
    if (!hourly(p) && p.salary1c > 0) {
      rateRecords.push({
        RateID: generateId("RT"),
        EmployeeID: employeeId,
        From: from,
        Salary1C: p.salary1c,
        Kpi: kpiOf({ salary1c: p.salary1c, total: p.total }),
        Total: p.total,
        DayRate: "",
        NightRate: "",
        Note: "из штатной расстановки",
        SetBy: "import",
        SetAt: now,
      });
    }
  }
  if (empRecords.length) {
    await commitAtomic([
      { kind: "append", tab: SHEET_TABS.PAYROLL_EMPLOYEES, records: empRecords },
      ...(rateRecords.length ? [{ kind: "append" as const, tab: SHEET_TABS.PAYROLL_RATES, records: rateRecords }] : []),
    ]);
    console.log(`Записано сотрудников: ${empRecords.length}, ставок: ${rateRecords.length}`);
  }

  // 3. Баланс и праздники.
  for (const m of months) {
    const had = balance.find((b) => b.month === m.month);
    if (had && had.days5 === m.days5 && had.hours5 === m.hours5 && had.days6 === m.days6 && had.hours6 === m.hours6) continue;
    await saveBalanceMonth({ ...m, updatedBy: "import" });
  }
  const newHolidays = holidays.filter((d) => !existingHolidays.some((h) => h.date === d));
  if (newHolidays.length) {
    await commitAtomic([{ kind: "append", tab: SHEET_TABS.PAYROLL_HOLIDAYS, records: newHolidays.map((d) => ({ Date: d, Name: "" })) }]);
  }
  console.log(`Баланс: ${months.length} мес., новых праздников: ${newHolidays.length}. Готово.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
