import ExcelJS from "exceljs";
import { FARM_LABELS } from "../constants";
import type { GreenhouseReport, ReportRow } from "./dashboard";
import { CUTTING_KINDS } from "./production";
import { SALE_CLASS_LABELS } from "./insights";

/**
 * Отчёт теплицы в .xlsx (30.10.2026, ТЗ: «экспорт в Excel и PDF»). Те же цифры, что на странице (`buildReport`):
 * листы «Сводка», «По блокам», «По сортам», «Потери», «По дням». Проценты — числами с форматом, чтобы их можно было
 * считать дальше.
 */
export async function buildGreenhouseReportWorkbook(rep: GreenhouseReport, farm: string, title: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ecoculture-CRM";
  const INT = "# ##0";
  const PCT = '0.0" %"';
  const headStyle = (row: ExcelJS.Row) => {
    row.font = { bold: true };
    row.eachCell((c) => {
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF3EC" } };
      c.border = { bottom: { style: "thin" } };
      c.alignment = { wrapText: true, vertical: "middle" };
    });
  };
  const titleRows = (ws: ExcelJS.Worksheet, name: string) => {
    ws.addRow([`${name} — ${FARM_LABELS[farm] ?? farm}`]).font = { bold: true, size: 14 };
    ws.addRow([title]).font = { color: { argb: "FF666666" } };
    ws.addRow([]);
  };

  // Сводка
  const s = wb.addWorksheet("Сводка");
  s.columns = [{ width: 42 }, { width: 16 }, { width: 16 }];
  titleRows(s, "Отчёт теплицы");
  headStyle(s.addRow(["Показатель", "За период", "Период до этого"]));
  const t = rep.totals;
  const p = rep.prev;
  const lines: [string, number | null, number | null, string][] = [
    ["Срезано, шт.", t.qty, p.qty, INT],
    [`${SALE_CLASS_LABELS.saleable}, шт.`, t.saleable, p.saleable, INT],
    [`${SALE_CLASS_LABELS.substandard}, шт.`, t.substandard, p.substandard, INT],
    [`${SALE_CLASS_LABELS.reject}, шт.`, t.reject, p.reject, INT],
    ["Товарность, %", t.saleablePct, p.saleablePct, PCT],
    ["Брак при срезке, %", t.rejectPct, p.rejectPct, PCT],
    ["Высшая и 1-я, %", t.topPct, p.topPct, PCT],
    ["Средний вес стебля, г", t.avgWeight, p.avgWeight, INT],
    ["Дней срезки", t.days, p.days, INT],
    ["В среднем за день срезки, шт.", t.perDay, p.perDay, INT],
    ["Блоков резали", t.blocks, p.blocks, INT],
    ["Брак на блоках, шт.", rep.loss.onBlocks, null, INT],
    ["Потери (брак на блоках + при срезке), %", rep.loss.lossPct, null, PCT],
    ["Отход при посадке, %", rep.loss.cullPct, null, PCT],
    ["План агронома на период, шт.", rep.plan || null, null, INT],
    ["Выполнение плана, %", rep.planPct, null, PCT],
  ];
  for (const [label, a, b, fmt] of lines) {
    const row = s.addRow([label, a, b]);
    row.getCell(2).numFmt = fmt;
    row.getCell(3).numFmt = fmt;
  }

  // По блокам и сортам — одна форма
  const table = (name: string, first: string, rows: ReportRow[], withPlan: boolean) => {
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 4, xSplit: 1 }] });
    const head = [first, "Срезано", "Товарные", "Некондиция", "Брак при срезке", "Товарность, %", "Высшая и 1-я, %", "Вес стебля, г", "Брак на блоке", "Потери, %"];
    if (withPlan) head.push("План", "Выполнение, %");
    ws.columns = head.map((_, i) => ({ width: i === 0 ? 22 : 14 }));
    titleRows(ws, name);
    headStyle(ws.addRow(head));
    for (const r of rows) {
      const vals: (string | number | null)[] = [r.label, r.qty, r.saleable, r.substandard, r.reject, r.saleablePct, r.topPct, r.avgWeight, r.waste, r.lossPct];
      if (withPlan) vals.push(r.plan ?? null, r.planPct ?? null);
      const row = ws.addRow(vals);
      [2, 3, 4, 5, 8, 9, 11].forEach((c) => (row.getCell(c).numFmt = INT));
      [6, 7, 10, 12].forEach((c) => (row.getCell(c).numFmt = PCT));
    }
  };
  table("По блокам", "Блок", rep.byBlock, false);
  table("По сортам", "Сорт", rep.byVariety, true);

  // Потери
  const l = wb.addWorksheet("Потери");
  l.columns = [{ width: 30 }, { width: 16 }, { width: 14 }, { width: 14 }];
  titleRows(l, "Потери");
  headStyle(l.addRow(["Причина", "Где", "Шт.", "Доля, %"]));
  const STAGE = { block: "на блоке", harvest: "при срезке", planting: "при посадке" } as const;
  for (const r of rep.loss.reasons) {
    const row = l.addRow([r.label, STAGE[r.stage], r.qty, r.share]);
    row.getCell(3).numFmt = INT;
    row.getCell(4).numFmt = PCT;
  }
  l.addRow([]);
  headStyle(l.addRow(["Черенкование за период", "", "Шт.", ""]));
  for (const c of rep.cuttings) l.addRow([CUTTING_KINDS.find((k) => k.code === c.kind)?.label ?? c.kind, "", c.qty]).getCell(3).numFmt = INT;

  // По дням
  const d = wb.addWorksheet("По дням", { views: [{ state: "frozen", ySplit: 4 }] });
  const dh = ["Дата", "Срезано", "Товарные", "Некондиция", "Брак при срезке", "Высшая и 1-я", "Брак на блоке", "Блоков"];
  d.columns = dh.map((_, i) => ({ width: i === 0 ? 14 : 14 }));
  titleRows(d, "Срезка по дням");
  headStyle(d.addRow(dh));
  for (const x of rep.byDay) {
    const row = d.addRow([x.date, x.qty, x.saleable, x.substandard, x.reject, x.top, x.waste, x.blocks]);
    for (let c = 2; c <= 8; c++) row.getCell(c).numFmt = INT;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
