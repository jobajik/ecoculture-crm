import ExcelJS from "exceljs";
import { FARM_LABELS } from "../constants";
import { EMPLOYMENTS } from "./types";
import { monthLabel } from "./timesheet";
import type { PayslipMonth } from "./payslipData";
import { computeMonth } from "./payslipData";

/**
 * Ведомость в .xlsx — той же формы, что лист «Расчётная ведомость» в книге бухгалтера: подразделения подряд с итогами,
 * внизу итог по компании и строки ТД/ГПХ. Цифры — те же, что на странице (`computeMonth`).
 */
export async function buildPayslipWorkbook(data: PayslipMonth): Promise<Buffer> {
  const { depts, totals, td, gph } = computeMonth(data);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ecoculture-CRM";
  const ws = wb.addWorksheet("Расчётная ведомость", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", xSplit: 1, ySplit: 4 }],
  });
  const MONEY = '# ##0.00';
  const HEAD = [
    "ФИО",
    "Должность",
    "ТД/ГПХ",
    "Оклад (1С)",
    "ИТОГО",
    "Факт, ч",
    "Норма, ч",
    "Праздн., ч",
    "Сверхур., ч",
    "О",
    "Б",
    "К",
    "П",
    "БС",
    "Оклада",
    "Больничный",
    "Отпускные",
    "Праздничные",
    "Сверхурочные",
    "KPI",
    "Удерж. KPI",
    "Начислено",
    "Аванс",
    "Займ",
    "Цветы",
    "К выплате",
    "Дорожные",
    "Примечание",
  ];
  ws.columns = HEAD.map((h, i) => ({ width: i === 0 ? 30 : i === 1 ? 22 : i === HEAD.length - 1 ? 24 : 12 }));
  ws.addRow([`РАСЧЁТНАЯ ВЕДОМОСТЬ — ${data.farm ? FARM_LABELS[data.farm] ?? data.farm : "обе компании"}`]).font = { bold: true, size: 14 };
  ws.addRow([monthLabel(data.month)]).font = { color: { argb: "FF666666" } };
  ws.addRow([]);
  const head = ws.addRow(HEAD);
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F3EF" } };
    c.border = { bottom: { style: "thin" } };
    c.alignment = { wrapText: true, vertical: "middle" };
  });
  const moneyCols = [4, 5, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27];
  const fmt = (row: ExcelJS.Row) => moneyCols.forEach((c) => (row.getCell(c).numFmt = MONEY));
  const totalsRow = (label: string, t: ReturnType<typeof computeMonth>["totals"], bold = true) => {
    const row = ws.addRow([label, "", "", "", "", t.factHours, "", "", "", "", "", "", "", "", t.salaryPay, t.sick, t.vacation, t.holidayPay, t.overtimePay, t.kpi, "", t.accrued, t.advance, t.loan, t.flowers, t.toPay, t.travel, `${t.people} чел.`]);
    row.font = { bold };
    fmt(row);
    return row;
  };
  for (const d of depts) {
    const title = ws.addRow([d.department.name]);
    title.font = { bold: true, size: 12 };
    title.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9EDE4" } };
    for (const r of d.rows) {
      const row = ws.addRow([
        r.fullName,
        r.position,
        r.employment === EMPLOYMENTS.GPH ? "ГПХ" : "ТД",
        r.hourly ? "почас." : r.salary1c,
        r.total,
        r.factHours,
        r.personalNorm,
        r.holidayHours,
        r.overtimeHours,
        r.vacationDays || "",
        r.sickDays || "",
        r.tripDays || "",
        r.absentDays || "",
        r.unpaidDays || "",
        r.salaryPay,
        r.sick,
        r.vacation,
        r.holidayPay,
        r.overtimePay,
        r.kpi,
        r.kpiDeduction,
        r.accrued,
        r.advance,
        r.loan,
        r.flowers,
        r.toPay,
        r.travel,
        [r.note, ...r.warnings].filter(Boolean).join("; "),
      ]);
      fmt(row);
      if (r.warnings.length) row.getCell(1).font = { color: { argb: "FFB45309" } };
    }
    totalsRow(`Итого · ${d.department.name}`, d.totals);
    ws.addRow([]);
  }
  totalsRow("ВСЕГО", totals);
  totalsRow("в том числе по ТД", td, false);
  totalsRow("в том числе по ГПХ", gph, false);
  if (data.unmatchedFlowers.length) {
    ws.addRow([]);
    ws.addRow(["Цветы со склада без сотрудника:"]).font = { bold: true };
    for (const f of data.unmatchedFlowers) ws.addRow([f.name, f.why, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", f.amount]);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
