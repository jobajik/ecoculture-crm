/*
 * Списание общим количеством и файлом (просьба склада Есентая: «списание по
 * дате убирать надо, нельзя общее количество посадить?», «как приёмке нельзя
 * шаблон сделать?»).
 *
 * Запуск: npx tsx scripts/check-writeoff-bulk.ts
 */
import ExcelJS from "exceljs";
import { planWriteoffs, stockPositions, cleanReason } from "../src/lib/writeoffPlan";
import { buildWriteoffTemplate, parseWriteoffWorkbook } from "../src/lib/excel";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}

const B = (batchId: string, variety: string, grade: string, harvestDate: string, q: number, flowerType = "chrysanthemum") => ({
  batchId, flowerType, variety, grade, harvestDate, quantityRemaining: q,
});
const batches = [
  B("B3", "Baltica", "Первая", "2026-09-07", 500),
  B("B1", "Baltica", "Первая", "2026-08-24", 100),
  B("B2", "Baltica", "Первая", "2026-08-30", 200),
  B("B4", "Baltica", "Вторая", "2026-08-25", 50),
  B("B5", "Zembla", "Первая", "2026-09-01", 0),
  B("R1", "Freedom", "60", "2026-09-01", 300, "rose"),
];
const L = (variety: string, grade: string, quantity: number, reason = "", flowerType = "chrysanthemum") => ({
  flowerType, variety, grade, quantity, reason,
});

async function main() {
  // --- Позиции склада
  const pos = stockPositions(batches, "esentai");
  check("позиции Есентая — только хризантема, пустые не видны", pos.map((p) => `${p.variety} ${p.grade} ${p.stock}`), [
    "Baltica Первая 800",
    "Baltica Вторая 50",
  ]);

  // --- FIFO
  const p1 = planWriteoffs({ lines: [L("Baltica", "Первая", 250)], batches, farm: "esentai" });
  check("снимается с самых старых партий", p1.parts.map((p) => [p.batchId, p.quantity]), [["B1", 100], ["B2", 150]]);
  check("итог", p1.total, 250);
  check("показ по строке — дата срезки", p1.byLine[0].map((b) => b.harvestDate), ["2026-08-24", "2026-08-30"]);
  check("причина по умолчанию", p1.parts[0].reason, "Порча / истёк срок хранения");

  const p2 = planWriteoffs({ lines: [L("baltica", " первая ", 100, "Брак")], batches, farm: "esentai", note: "с 24.08 по 07.09" });
  check("регистр и пробелы не мешают", p2.parts.map((p) => p.batchId), ["B1"]);
  check("примечание дописывается к причине", p2.parts[0].reason, "Брак · с 24.08 по 07.09");

  // --- Всё или ничего
  const p3 = planWriteoffs({ lines: [L("Baltica", "Первая", 100), L("Baltica", "Вторая", 60)], batches, farm: "esentai" });
  check("больше остатка — ошибка на строке", p3.errors, ["", "на складе только 50 шт."]);
  check("и ничего не списывается", p3.parts.length, 0);

  const p4 = planWriteoffs({ lines: [L("Baltica", "Первая", 500), L("Baltica", "Первая", 400)], batches, farm: "esentai" });
  check("две строки одной позиции складываются", p4.errors[1], "вместе со строкой выше выходит 900 шт., а на складе 800");

  const p5 = planWriteoffs({ lines: [L("Baltica", "Первая", 500), L("Baltica", "Первая", 300)], batches, farm: "esentai" });
  check("две строки — ровно весь остаток", p5.parts.map((p) => [p.batchId, p.quantity]), [["B1", 100], ["B2", 200], ["B3", 500]]);

  check("чужой цветок", planWriteoffs({ lines: [L("Freedom", "60", 10, "", "rose")], batches, farm: "esentai" }).errors, ["это цветок другого производства"]);
  check("нет на складе", planWriteoffs({ lines: [L("Zembla", "Первая", 1)], batches, farm: "esentai" }).errors, ["такой позиции на складе нет"]);
  check("дробное", planWriteoffs({ lines: [L("Baltica", "Первая", 1.5)], batches, farm: "esentai" }).errors, ["количество — целое число стеблей"]);
  check("ноль", planWriteoffs({ lines: [L("Baltica", "Первая", 0)], batches, farm: "esentai" }).errors, ["укажите количество больше нуля"]);
  check("админ — любой цветок", planWriteoffs({ lines: [L("Freedom", "60", 10, "", "rose")], batches, farm: null }).total, 10);
  check("длинная причина обрезается", cleanReason("x".repeat(300)).length, 120);

  // --- Файл по кругу
  const buf = await buildWriteoffTemplate(pos, "esentai");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sh = wb.worksheets[0];
  check("в шаблоне весь склад", sh.rowCount - 1, 2);
  sh.getCell("E2").value = 300;
  sh.getCell("F2").value = "Брак";
  const filled = await wb.xlsx.writeBuffer();
  const parsed = await parseWriteoffWorkbook(filled as ArrayBuffer);
  check("пустые строки не списываются", parsed.rows.length, 1);
  check("строка разобрана", parsed.rows.map((r) => [r.flowerType, r.variety, r.grade, r.quantity, r.reason, r.error ?? ""]), [
    ["chrysanthemum", "Baltica", "Первая", 300, "Брак", ""],
  ]);
  const p6 = planWriteoffs({ lines: parsed.rows, batches, farm: "esentai" });
  check("из файла — по партиям от старых", p6.parts.map((p) => [p.batchId, p.quantity]), [["B1", 100], ["B2", 200]]);

  const bad = await parseWriteoffWorkbook(new ArrayBuffer(10));
  check("не Excel — понятная ошибка", Boolean(bad.fatalError), true);

  console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}
main();
