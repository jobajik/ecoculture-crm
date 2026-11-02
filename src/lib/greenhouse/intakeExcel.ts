import ExcelJS from "exceljs";
import { FARM_LABELS } from "../constants";
import { INTAKE_FLOWER_LABELS, INTAKE_SPECS, byDay, byReason, byVariety, flowersIn, gradeLabel, intakeGrades, intakeStats, reasonLabel, type IntakeRow } from "./intake";

/**
 * Приёмка Rose Farm в .xlsx — те же цифры, что на странице «Аналитика»: «Сводка» (по цветку — сейчас и до этого),
 * «Длины» (цветок × длина/категория), «Сорта», «По дням», «Брак» и «Записи» (каждая строка как есть). Проценты — числами.
 */
export async function buildIntakeWorkbook(now: IntakeRow[], prev: IntakeRow[], farm: string, title: string, from: string, to: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ecoculture-CRM";
  const INT = "# ##0";
  const PCT = '0.0" %"';
  const D1 = "0.0";
  const head = (row: ExcelJS.Row) => {
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
  const flowers = flowersIn(now);

  // Сводка
  const s = wb.addWorksheet("Сводка");
  s.columns = [{ width: 34 }, ...flowers.flatMap(() => [{ width: 14 }, { width: 14 }])];
  titleRows(s, "Приёмка цветка");
  head(s.addRow(["Показатель", ...flowers.flatMap((f) => [`${INTAKE_FLOWER_LABELS[f]}: период`, "до этого"])]));
  const a = flowers.map((f) => intakeStats(now, f));
  const b = flowers.map((f) => intakeStats(prev, f));
  const lines: [string, (x: ReturnType<typeof intakeStats>) => number | null, string][] = [
    ["Принято, шт.", (x) => x.accepted, INT],
    ["Брак, шт.", (x) => x.rejected, INT],
    ["Брак от пришедшего, %", (x) => x.rejectPct, PCT],
    ["Высшая / 80+ см / стандарт, %", (x) => x.topPct, PCT],
    ["2 сорт, B, нераскрывшийся, %", (x) => x.secondPct, PCT],
    ["Средняя длина розы, см", (x) => x.avgLength, D1],
    ["Вес стебля, г", (x) => x.measures.stemG, INT],
    ["Высота бутона, см", (x) => x.measures.headCm, D1],
    ["Бутонов / цветков на стебле", (x) => x.measures.buds, D1],
    ["Дней приёмки", (x) => x.days, INT],
  ];
  for (const [label, get, fmt] of lines) {
    const row = s.addRow([label, ...flowers.flatMap((_, i) => [get(a[i]), get(b[i])])]);
    row.eachCell((c, col) => {
      if (col > 1) c.numFmt = fmt;
    });
  }

  // Длины
  const g = wb.addWorksheet("Длины и категории");
  g.columns = [{ width: 16 }, { width: 24 }, { width: 14 }, { width: 12 }];
  titleRows(g, "Длины и категории");
  head(g.addRow(["Цветок", "Длина / категория", "Принято, шт.", "Доля, %"]));
  for (const f of flowers) {
    const st = intakeStats(now, f);
    for (const x of st.byGrade) {
      const r = g.addRow([INTAKE_FLOWER_LABELS[f], gradeLabel(f, x.grade), x.qty, st.accepted ? (x.qty * 100) / st.accepted : null]);
      r.getCell(3).numFmt = INT;
      r.getCell(4).numFmt = PCT;
    }
  }

  // Сорта — с колонкой на каждую длину/категорию.
  const v = wb.addWorksheet("Сорта");
  titleRows(v, "Сорта");
  for (const f of flowers) {
    const grades = intakeGrades(f).filter((gr) => now.some((r) => r.flower === f && r.kind === "accept" && r.grade === gr));
    const extra = INTAKE_SPECS[f].measures.map((m) => `${m.label}, ${m.unit}`);
    v.addRow([INTAKE_FLOWER_LABELS[f]]).font = { bold: true, size: 12 };
    head(v.addRow(["Сорт", "Принято, шт.", "Доля, %", ...grades.map((gr) => gradeLabel(f, gr)), "Брак, шт.", "Брак, %", ...extra]));
    for (const x of byVariety(now.filter((r) => r.flower === f))) {
      const cells = grades.map((gr) => x.byGrade.find((y) => y.grade === gr)?.qty ?? null);
      const row = v.addRow([x.variety, x.accepted, x.share, ...cells, x.rejected || null, x.rejected ? x.rejectPct : null, ...INTAKE_SPECS[f].measures.map((m) => x.measures[m.key])]);
      row.getCell(2).numFmt = INT;
      row.getCell(3).numFmt = PCT;
      grades.forEach((_, i) => (row.getCell(4 + i).numFmt = INT));
      row.getCell(4 + grades.length).numFmt = INT;
      row.getCell(5 + grades.length).numFmt = PCT;
      INTAKE_SPECS[f].measures.forEach((m, i) => (row.getCell(6 + grades.length + i).numFmt = m.digits ? D1 : INT));
    }
    v.addRow([]);
  }
  v.getColumn(1).width = 24;

  // По дням
  const d = wb.addWorksheet("По дням");
  d.columns = [{ width: 12 }, ...flowers.map(() => ({ width: 14 })), { width: 12 }, { width: 12 }];
  titleRows(d, "По дням");
  head(d.addRow(["Дата", ...flowers.map((f) => `${INTAKE_FLOWER_LABELS[f]}, шт.`), "Брак, шт.", "Брак, %"]));
  for (const x of byDay(now, from, to)) {
    if (!x.accepted && !x.rejected) continue;
    const r = d.addRow([x.date.split("-").reverse().join("."), ...flowers.map((f) => x.byFlower[f] || null), x.rejected || null, x.rejected ? (x.rejected * 100) / (x.accepted + x.rejected) : null]);
    r.eachCell((c, col) => {
      if (col > 1) c.numFmt = col === flowers.length + 3 ? PCT : INT;
    });
  }

  // Брак
  const w = wb.addWorksheet("Брак");
  w.columns = [{ width: 34 }, { width: 14 }, { width: 12 }];
  titleRows(w, "Брак по причинам");
  head(w.addRow(["Причина", "Стеблей", "Доля, %"]));
  for (const x of byReason(now)) {
    const r = w.addRow([x.label, x.qty, x.share]);
    r.getCell(2).numFmt = INT;
    r.getCell(3).numFmt = PCT;
  }

  // Записи
  const z = wb.addWorksheet("Записи");
  z.columns = [{ width: 12 }, { width: 12 }, { width: 10 }, { width: 24 }, { width: 12 }, { width: 18 }, { width: 26 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 24 }];
  head(z.addRow(["Дата", "Цветок", "Блок", "Сорт", "Запись", "Длина / категория", "Причина брака", "Стеблей", "Вес стебля, г", "Бутон, см", "Бутонов", "Заметка"]));
  const KIND: Record<string, string> = { accept: "принято", reject: "брак", measure: "замер" };
  for (const r of [...now].sort((x, y) => x.date.localeCompare(y.date) || x.variety.localeCompare(y.variety))) {
    z.addRow([r.date.split("-").reverse().join("."), INTAKE_FLOWER_LABELS[r.flower], r.block, r.variety, KIND[r.kind], r.kind === "accept" ? gradeLabel(r.flower, r.grade) : "", r.kind === "reject" ? reasonLabel(r.reason) : "", r.qty || null, r.stemG || null, r.headCm || null, r.buds || null, r.note]);
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
