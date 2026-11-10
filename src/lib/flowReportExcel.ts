import ExcelJS from "exceljs";
import { avgPrice } from "./monthReport";
import { AGE_BUCKETS, type FlowReport, type FlowRow } from "./flowReport";
import { FARM_LABELS, FLOWER_TYPE_LABELS } from "./constants";

// «Срез · продажи · списания» в Excel — те же цифры, что на странице `/analytics/flow`.

const NUM = '#,##0;-#,##0;"-"';
const PCT = '0%;-0%;"-"';
const FONT = { name: "Arial", size: 10 };
const HEAD = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
const FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E6B3F" } };
const TOT: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F1EA" } };

function sheet(wb: ExcelJS.Workbook, name: string, title: string, widths: number[]) {
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false }] });
  ws.columns = widths.map((w) => ({ width: w }));
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { name: "Arial", size: 13, bold: true };
  return ws;
}

function header(ws: ExcelJS.Worksheet, row: number, cols: string[]) {
  cols.forEach((c, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = c;
    cell.font = HEAD;
    cell.fill = FILL;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });
  ws.getRow(row).height = 30;
}

function put(ws: ExcelJS.Worksheet, row: number, values: (string | number | null)[], opts: { total?: boolean; fmt?: (string | undefined)[] } = {}) {
  values.forEach((v, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = v;
    cell.font = opts.total ? { ...FONT, bold: true } : FONT;
    if (opts.total) cell.fill = TOT;
    const f = opts.fmt?.[i] ?? (typeof v === "number" ? NUM : undefined);
    if (f) cell.numFmt = f;
  });
}

const FLOW_COLS = ["Срезано", "Срезано, прошлый период", "Продано, шт.", "Доля от срезки", "Продано, прошлый период", "Выручка, ₸", "Средняя, ₸/шт", "Средняя, прошлый период", "Отгружено", "Списано", "Списано от срезки", "Списано, прошлый период", "Выдано", "Остаток сейчас"];
const FLOW_FMT = [undefined, NUM, NUM, NUM, PCT, NUM, NUM, NUM, NUM, NUM, NUM, PCT, NUM, NUM, NUM];
const share = (a: number, b: number) => (b ? a / b : 0);
const flowValues = (r: FlowRow): (string | number | null)[] => [
  r.label,
  r.cut,
  r.prev.cut,
  r.sold.qty,
  share(r.sold.qty, r.cut),
  r.prev.sold.qty,
  Math.round(r.sold.sum),
  Math.round(avgPrice(r.sold)),
  Math.round(avgPrice(r.prev.sold)),
  r.shipped,
  r.writeoff,
  share(r.writeoff, r.cut),
  r.prev.writeoff,
  r.takeouts,
  r.remaining,
];

function flowTable(ws: ExcelJS.Worksheet, start: number, title: string, first: string, rows: FlowRow[], total?: FlowRow): number {
  ws.getCell(start, 1).value = title;
  ws.getCell(start, 1).font = { ...FONT, bold: true };
  header(ws, start + 1, [first, ...FLOW_COLS]);
  let row = start + 2;
  for (const r of rows) put(ws, row++, flowValues(r), { fmt: FLOW_FMT });
  if (total) put(ws, row++, ["Итого", ...flowValues(total).slice(1)], { total: true, fmt: FLOW_FMT });
  return row + 1;
}

export async function flowReportWorkbook(r: FlowReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ecoculture CRM";
  const period = `${r.from} — ${r.to}`;
  const scope = `${r.farm ? FARM_LABELS[r.farm] ?? r.farm : "всё хозяйство"}${r.flower ? ` · ${FLOWER_TYPE_LABELS[r.flower] ?? r.flower}` : ""}`;
  const widths = [34, 11, 12, 11, 10, 12, 13, 11, 12, 11, 11, 11, 12, 10, 12];

  // --- Сводка ---
  const ws = sheet(wb, "Сводка", `Срез · продажи · списания — ${period} · ${scope}`, widths);
  ws.getCell("A2").value = `Прошлый период для сравнения: ${r.prevFrom} — ${r.prevTo}`;
  ws.getCell("A2").font = { ...FONT, color: { argb: "FF6B7280" } };
  let row = 4;
  row = flowTable(ws, row, "По компаниям", "Компания", r.byFarm, r.total);
  row = flowTable(ws, row, "По цветку", "Цветок", r.byFlower, r.total);
  ws.getCell(row, 1).value = "Остаток склада";
  ws.getCell(row, 1).font = { ...FONT, bold: true };
  header(ws, row + 1, ["", "На начало", "На конец", "Сейчас", "Склад Астаны", "В офис перемещено", "В регион отгружено"]);
  put(ws, row + 2, ["Основной и офисный склады", r.balance.start, r.balance.end, r.balance.now, r.balance.region, r.toOffice, r.toRegion]);
  row += 4;
  if (r.insights.length) {
    ws.getCell(row, 1).value = "Главное за период";
    ws.getCell(row, 1).font = { ...FONT, bold: true };
    for (const x of r.insights) {
      row++;
      ws.getCell(row, 1).value = x.text;
      ws.getCell(row, 1).font = FONT;
    }
  }

  // --- Категории и сорта ---
  const wg = sheet(wb, "Категории", `По категориям — ${period} · ${scope}`, widths);
  flowTable(wg, 3, "По категориям", "Цветок · категория", r.byGrade, r.total);
  const wv = sheet(wb, "Сорта", `По сортам — ${period} · ${scope}`, widths);
  flowTable(wv, 3, "По сортам", "Цветок · сорт", r.byVariety);

  // --- Динамика ---
  const wt = sheet(wb, r.timeline.unit === "day" ? "По дням" : "По неделям", `Динамика — ${period}`, [14, 12, 12, 14, 12, 12]);
  header(wt, 3, [r.timeline.unit === "day" ? "День" : "Неделя с", "По", "Срезано", "Продано по заявкам", "Отгружено", "Списано"]);
  row = 4;
  for (const p of r.timeline.points) put(wt, row++, [p.from, p.to, p.cut, p.sold, p.shipped, p.writeoff]);
  put(wt, row, ["Итого", "", r.total.cut, r.total.sold.qty, r.total.shipped, r.total.writeoff], { total: true });

  // --- Продажи и списания ---
  const wsl = sheet(wb, "Каналы и списания", `Каналы продаж и списания — ${period} · ${scope}`, [34, 11, 12, 14, 13, 10]);
  ws.getCell(3, 1);
  wsl.getCell(3, 1).value = "Продажи по каналам";
  wsl.getCell(3, 1).font = { ...FONT, bold: true };
  header(wsl, 4, ["Канал", "Заявок", "Шт.", "Сумма, ₸", "Средняя, ₸/шт", "Доля шт."]);
  row = 5;
  const soldAll = r.channels.reduce((s, c) => s + c.money.qty, 0);
  for (const c of r.channels) put(wsl, row++, [c.label + (c.byList ? " (часть по прайсу)" : ""), c.orders, c.money.qty, Math.round(c.money.sum), Math.round(avgPrice(c.money)), share(c.money.qty, soldAll)], { fmt: [undefined, NUM, NUM, NUM, NUM, PCT] });
  put(wsl, row++, ["Итого", r.channels.reduce((s, c) => s + c.orders, 0), r.total.sold.qty, Math.round(r.total.sold.sum), Math.round(avgPrice(r.total.sold)), 1], { total: true, fmt: [undefined, NUM, NUM, NUM, NUM, PCT] });
  if (r.regionSold) put(wsl, row++, [`Со склада Астаны продано ещё ${r.regionSold} шт. — в итоги не входит`]);
  row += 1;
  wsl.getCell(row, 1).value = "Списания по причинам";
  wsl.getCell(row, 1).font = { ...FONT, bold: true };
  header(wsl, row + 1, ["Причина", "Шт.", "Доля"]);
  row += 2;
  for (const x of r.writeoffReasons) put(wsl, row++, [x.reason, x.qty, share(x.qty, r.total.writeoff)], { fmt: [undefined, NUM, PCT] });
  row += 1;
  wsl.getCell(row, 1).value = "Возраст при списании (дней от срезки)";
  wsl.getCell(row, 1).font = { ...FONT, bold: true };
  header(wsl, row + 1, ["Возраст", "Шт.", "Доля"]);
  row += 2;
  for (const x of r.writeoffAge) put(wsl, row++, [x.bucket, x.qty, share(x.qty, r.total.writeoff)], { fmt: [undefined, NUM, PCT] });
  row += 1;
  wsl.getCell(row, 1).value = "Кто списывал";
  wsl.getCell(row, 1).font = { ...FONT, bold: true };
  header(wsl, row + 1, ["Сотрудник", "Шт."]);
  row += 2;
  for (const x of r.writeoffPeople) put(wsl, row++, [x.name, x.qty]);

  // --- Склад и план ---
  const wst = sheet(wb, "Склад и план", `Свежесть склада на сегодня и план срезки — ${period} · ${scope}`, [34, 11, 11, 11, 11, 11, 14]);
  wst.getCell(3, 1).value = "Остаток по возрасту срезки (основной и офисный склады)";
  wst.getCell(3, 1).font = { ...FONT, bold: true };
  header(wst, 4, ["Цветок", ...AGE_BUCKETS, "Всего", "Старше недели"]);
  row = 5;
  for (const x of r.stockAge) put(wst, row++, [x.label, ...x.buckets, x.total, share(x.buckets[2] + x.buckets[3], x.total)], { fmt: [undefined, NUM, NUM, NUM, NUM, NUM, PCT] });
  row += 1;
  wst.getCell(row, 1).value = "Возраст при отгрузке за период";
  wst.getCell(row, 1).font = { ...FONT, bold: true };
  header(wst, row + 1, ["Цветок", "Отгружено", "Медиана, дней", "Старше недели, шт.", "Старше недели"]);
  row += 2;
  for (const x of r.shipAge) put(wst, row++, [x.label, x.qty, x.median === null ? null : Math.round(x.median), x.over7, share(x.over7, x.qty)], { fmt: [undefined, NUM, NUM, NUM, PCT] });
  row += 1;
  wst.getCell(row, 1).value = "План срезки агронома против факта";
  wst.getCell(row, 1).font = { ...FONT, bold: true };
  header(wst, row + 1, ["Цветок / сорт", "План", "Факт", "Выполнение"]);
  row += 2;
  for (const f of r.forecast) put(wst, row++, [f.label, f.plan, f.fact, share(f.fact, f.plan)], { total: true, fmt: [undefined, NUM, NUM, PCT] });
  for (const v of r.forecastVarieties) put(wst, row++, [v.label, Math.round(v.plan), v.fact, share(v.fact, v.plan)], { fmt: [undefined, NUM, NUM, PCT] });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
