import ExcelJS from "exceljs";
import { avgPrice, CHANNEL_LABELS, monthTitle, type Money, type MonthReport } from "./monthReport";
import { FARM_LABELS, FLOWER_TYPE_LABELS } from "./constants";

// «Итоги месяца» в Excel — те же цифры, что на странице `/analytics/month`. Средние и доли — формулами, чтобы
// таблица пересчитывалась, если владелец поправит число руками.

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
}

function put(ws: ExcelJS.Worksheet, row: number, values: (string | number | { formula: string } | null)[], opts: { total?: boolean; fmt?: (string | undefined)[] } = {}) {
  values.forEach((v, i) => {
    const cell = ws.getCell(row, i + 1);
    cell.value = v as ExcelJS.CellValue;
    cell.font = opts.total ? { ...FONT, bold: true } : FONT;
    if (opts.total) cell.fill = TOT;
    const f = opts.fmt?.[i] ?? (typeof v === "number" || (v && typeof v === "object") ? NUM : undefined);
    if (f) cell.numFmt = f;
  });
}

/** Таблица «название · шт. · ₸ · средняя (формула) · доля (формула)» с итогом. Возвращает следующую свободную строку. */
function moneyTable(ws: ExcelJS.Worksheet, start: number, title: string, first: string, rows: { name: string; m: Money }[], total = true): number {
  ws.getCell(start, 1).value = title;
  ws.getCell(start, 1).font = { ...FONT, bold: true };
  header(ws, start + 1, [first, "Шт.", "Сумма, ₸", "Средняя, ₸/шт", "Доля шт."]);
  const a = start + 2;
  const b = a + rows.length - 1;
  const totRow = b + 1;
  rows.forEach((r, i) => {
    const row = a + i;
    put(ws, row, [r.name, r.m.qty, Math.round(r.m.sum), { formula: `IFERROR(C${row}/B${row},0)` }, total ? { formula: `IFERROR(B${row}/B$${totRow},0)` } : null], {
      fmt: [undefined, NUM, NUM, NUM, PCT],
    });
  });
  if (total && rows.length) {
    put(ws, totRow, ["Итого", { formula: `SUM(B${a}:B${b})` }, { formula: `SUM(C${a}:C${b})` }, { formula: `IFERROR(C${totRow}/B${totRow},0)` }, { formula: `IFERROR(B${totRow}/B${totRow},0)` }], {
      total: true,
      fmt: [undefined, NUM, NUM, NUM, PCT],
    });
    return totRow + 2;
  }
  return b + 2;
}

export async function monthReportWorkbook(r: MonthReport): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const scope = r.farm ? FARM_LABELS[r.farm] ?? r.farm : "Всё хозяйство";
  const multi = new Set(r.grades.map((g) => g.flowerType)).size > 1;
  const gl = (label: string) => (multi ? label : label.replace(/^[^·]+· /, ""));

  // --- Сводка ---
  let ws = sheet(wb, "Сводка", `${scope} — итоги, ${monthTitle(r.month)}`, [46, 16, 18, 16, 12]);
  ws.getCell("A2").value = "Данные CRM. Продажи — по дню оформления заявки, без отменённых; регионы и магазины без цены — по прайсу на день заявки.";
  ws.getCell("A2").font = { ...FONT, italic: true, color: { argb: "FF666666" } };
  let row = moneyTable(ws, 4, "Продажи по каналам", "Канал", r.channels.map((c) => ({ name: CHANNEL_LABELS[c.channel], m: c.money })));
  ws.getCell(row, 1).value = "Склад";
  ws.getCell(row, 1).font = { ...FONT, bold: true };
  header(ws, row + 1, ["Показатель", "Шт.", "% от срезанного"]);
  const cutRow = row + 2;
  const stock: [string, number][] = [
    ["Срезано (принято на основной склад)", r.cut.total],
    ["Ушло по заявкам (все каналы)", r.sold.qty],
    ["  из них клиентам", r.clients.qty],
    ["Отгружено за месяц (журнал отгрузок)", r.shipped],
    ["Списано за месяц", r.writeoff.total],
    ["  из них из срезки этого месяца", r.writeoff.fromMonthCut],
    ["Выдано сотрудникам", r.takeouts.qty],
    ["Из срезки месяца сейчас на складе", r.leftFromCut],
  ];
  stock.forEach(([label, v], i) => {
    const rr = cutRow + i;
    put(ws, rr, [label, v, i === 0 ? null : { formula: `IFERROR(B${rr}/B$${cutRow},0)` }], { fmt: [undefined, NUM, PCT] });
  });
  row = cutRow + stock.length + 1;
  ws.getCell(row, 1).value = "Клиенты: этот месяц против прошлого";
  ws.getCell(row, 1).font = { ...FONT, bold: true };
  header(ws, row + 1, ["Показатель", "Этот месяц", "Прошлый", "Изменение"]);
  const a = row + 2;
  put(ws, a, ["Шт.", r.clients.qty, r.clientsPrev.qty, { formula: `IFERROR(B${a}/C${a}-1,0)` }], { fmt: [undefined, NUM, NUM, PCT] });
  put(ws, a + 1, ["Сумма, ₸", Math.round(r.clients.sum), Math.round(r.clientsPrev.sum), { formula: `IFERROR(B${a + 1}/C${a + 1}-1,0)` }], { fmt: [undefined, NUM, NUM, PCT] });
  put(ws, a + 2, ["Средняя цена, ₸/шт", Math.round(avgPrice(r.clients)), Math.round(avgPrice(r.clientsPrev)), { formula: `IFERROR(B${a + 2}/C${a + 2}-1,0)` }], { fmt: [undefined, NUM, NUM, PCT] });
  put(ws, a + 3, ["Заявок", r.clients.orders, r.clientsPrev.orders, { formula: `IFERROR(B${a + 3}/C${a + 3}-1,0)` }], { fmt: [undefined, NUM, NUM, PCT] });
  put(ws, a + 4, ["Клиентов (новых)", r.clients.clientCount, null, null]);
  ws.getCell(a + 4, 3).value = `новых: ${r.clients.newClients}`;
  row = a + 6;
  if (r.insights.length) {
    ws.getCell(row, 1).value = "Главное за месяц";
    ws.getCell(row, 1).font = { ...FONT, bold: true };
    r.insights.forEach((x, i) => {
      ws.getCell(row + 1 + i, 1).value = `• ${x.text}`;
      ws.getCell(row + 1 + i, 1).font = FONT;
    });
  }

  // --- Категории ---
  ws = sheet(wb, "Категории", "Категории: срезано, ушло, цена, списано", [24, 13, 13, 13, 15, 14, 15, 15, 13]);
  header(ws, 3, ["Категория", "Срезано", "Ушло (все каналы)", "Ушло от срезки", "₸ (все каналы)", "Клиентам, шт.", "Средняя клиентам", "Прошлый месяц, средняя", "Списано"]);
  r.grades.forEach((g, i) => {
    const rr = 4 + i;
    put(ws, rr, [gl(g.label), g.cut, g.sold.qty, { formula: `IFERROR(C${rr}/B${rr},0)` }, Math.round(g.sold.sum), g.clients.qty, Math.round(avgPrice(g.clients)), Math.round(g.clientsPrevAvg), g.writeoff], {
      fmt: [undefined, NUM, NUM, PCT, NUM, NUM, NUM, NUM, NUM],
    });
  });
  const gEnd = 3 + r.grades.length;
  if (r.grades.length) {
    const t = gEnd + 1;
    put(ws, t, ["Итого", { formula: `SUM(B4:B${gEnd})` }, { formula: `SUM(C4:C${gEnd})` }, { formula: `IFERROR(C${t}/B${t},0)` }, { formula: `SUM(E4:E${gEnd})` }, { formula: `SUM(F4:F${gEnd})` }, Math.round(avgPrice(r.clients)), Math.round(avgPrice(r.clientsPrev)), { formula: `SUM(I4:I${gEnd})` }], {
      total: true,
      fmt: [undefined, NUM, NUM, PCT, NUM, NUM, NUM, NUM, NUM],
    });
  }

  // --- Сорта ---
  ws = sheet(wb, "Сорта", "Сорта: срезано и продано", [30, 13, 13, 15, 15, 13]);
  header(ws, 3, ["Сорт", "Срезано", "Ушло", "₸", "Средняя, ₸/шт", "Списано"]);
  r.varieties.forEach((v, i) => {
    const rr = 4 + i;
    put(ws, rr, [`${multi ? `${FLOWER_TYPE_LABELS[v.flowerType] ?? v.flowerType} ` : ""}${v.variety}`, v.cut, v.sold.qty, Math.round(v.sold.sum), { formula: `IFERROR(D${rr}/C${rr},0)` }, v.writeoff]);
  });

  // --- Недели ---
  ws = sheet(wb, "Недели", "По неделям", [14, 14, 16, 16, 14]);
  header(ws, 3, ["Неделя", "Срезано", "Ушло по заявкам", "из них клиентам", "Списано"]);
  r.weeks.forEach((w, i) => put(ws, 4 + i, [w.label, w.cut, w.sold, w.clients, w.writeoff]));

  // --- Менеджеры, направления, клиенты ---
  ws = sheet(wb, "Менеджеры и клиенты", "Продажи клиентам: менеджеры, направления, крупнейшие клиенты", [30, 14, 16, 16, 12]);
  row = moneyTable(ws, 3, "Менеджеры", "Менеджер", r.managers.map((x) => ({ name: x.name, m: x.money })));
  row = moneyTable(ws, row, "Направления", "Направление", r.directions.map((x) => ({ name: x.name, m: x.money })));
  if (r.stores.length > 1) row = moneyTable(ws, row, "Склады отгрузки", "Склад", r.stores.map((x) => ({ name: x.name, m: x.money })));
  moneyTable(ws, row, "Крупнейшие клиенты", "Клиент", r.topClients.map((x) => ({ name: x.name, m: x.money })), false);

  // --- Цены и другие способы счёта ---
  ws = sheet(wb, "Цены и сверка", "По каким ценам продавали и другие способы счёта", [40, 14, 14, 16]);
  header(ws, 3, ["Категория", "Цена, ₸/шт", "Шт.", "Сумма, ₸"]);
  r.priceBands.forEach((b, i) => {
    const rr = 4 + i;
    put(ws, rr, [gl(b.label), b.price, b.qty, { formula: `B${rr}*C${rr}` }], { fmt: [undefined, "#,##0.##", NUM, NUM] });
  });
  row = 5 + r.priceBands.length;
  header(ws, row, ["Способ счёта", "Шт.", "Сумма, ₸", ""]);
  r.views.forEach((v, i) => put(ws, row + 1 + i, [`${v.label} (${v.detail})`, v.qty || null, Math.round(v.sum), null]));

  return Buffer.from(await wb.xlsx.writeBuffer());
}
