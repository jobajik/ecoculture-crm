import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Списания за месяц по производству — по категориям и сортам (10.11.2026, владелец: «аналитику по списанному цветку за
 * октябрь по Есентай Агро Хим по категориям, срочно»). Списания (вкладка Writeoffs) привязаны к партии — цветок, сорт,
 * категория и дата срезки берутся из неё. Печатает сводку и пишет Excel. Ничего не меняет.
 *
 *   npx tsx scripts/diag-writeoffs-month.ts <ГГГГ-ММ> <esentai|rose_farm> [файл.xlsx]
 */
import ExcelJS from "exceljs";
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listWriteoffs } from "../src/lib/repo/writeoffs";
import { listBatches } from "../src/lib/repo/batches";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { priceFor } from "../src/lib/priceList";
import { compareGrades, FARM_LABELS, FLOWER_TYPE_LABELS, getFarmFor } from "../src/lib/constants";
import { localDayKey } from "../src/lib/timezone";

const n = (v: number) => Math.round(v).toLocaleString("ru-RU");

async function main() {
  const [month, farm, out] = process.argv.slice(2);
  if (!/^\d{4}-\d{2}$/.test(month || "") || !farm) throw new Error("Укажите месяц ГГГГ-ММ и производство");
  await prefetchTables([SHEET_TABS.WRITEOFFS, SHEET_TABS.BATCHES, SHEET_TABS.PRICE_HISTORY]);
  const [writeoffs, batches, prices] = await Promise.all([listWriteoffs(), listBatches(), getCurrentPrices()]);
  const batchOf = new Map(batches.map((b) => [b.batchId, b]));
  const rows = writeoffs
    .map((w) => ({ w, b: batchOf.get(w.batchId) }))
    .filter(({ w, b }) => b && getFarmFor(b.flowerType) === farm && localDayKey(new Date(w.createdAt)).startsWith(month) && w.quantity > 0);
  const total = rows.reduce((s, r) => s + r.w.quantity, 0);
  console.log(`${FARM_LABELS[farm] ?? farm}, списания за ${month}: записей ${rows.length}, стеблей ${n(total)}`);

  const agg = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, { stems: number; records: number; value: number }>();
    for (const r of rows) {
      const k = key(r);
      const e = m.get(k) ?? { stems: 0, records: 0, value: 0 };
      e.stems += r.w.quantity;
      e.records += 1;
      e.value += r.w.quantity * priceFor(prices, r.b!.flowerType, r.b!.variety, r.b!.grade);
      m.set(k, e);
    }
    return m;
  };
  const byGrade = agg((r) => r.b!.grade);
  console.log("\nПо категориям (стеблей · доля · по текущему прайсу):");
  for (const [g, e] of Array.from(byGrade).sort((a, b) => compareGrades(farm === "esentai" ? "chrysanthemum" : "rose", a[0], b[0]))) console.log(`  ${g.padEnd(12)} ${n(e.stems).padStart(8)} · ${Math.round((100 * e.stems) / total)} % · ${n(e.value)} ₸`);
  const byVar = agg((r) => `${r.b!.variety} · ${r.b!.grade}`);
  console.log("\nПо сортам и категориям:");
  for (const [k, e] of Array.from(byVar).sort((a, b) => b[1].stems - a[1].stems)) console.log(`  ${k.padEnd(28)} ${n(e.stems).padStart(8)}`);
  const byReason = agg((r) => r.w.reason || "без причины");
  console.log("\nПо причинам:");
  for (const [k, e] of Array.from(byReason).sort((a, b) => b[1].stems - a[1].stems)) console.log(`  ${k.padEnd(40)} ${n(e.stems).padStart(8)} · ${Math.round((100 * e.stems) / total)} %`);
  const byDay = agg((r) => localDayKey(new Date(r.w.createdAt)));
  console.log("\nПо дням:");
  for (const [k, e] of Array.from(byDay).sort()) console.log(`  ${k} ${n(e.stems).padStart(8)}`);
  const byAge = agg((r) => {
    const age = Math.round((Date.parse(localDayKey(new Date(r.w.createdAt))) - Date.parse(r.b!.harvestDate || r.b!.receivedAt)) / 86400000);
    return age <= 7 ? "до 7 дней от срезки" : age <= 14 ? "8–14 дней" : age <= 21 ? "15–21 день" : "старше 21 дня";
  });
  console.log("\nПо возрасту партии на момент списания:");
  for (const [k, e] of Array.from(byAge).sort((a, b) => b[1].stems - a[1].stems)) console.log(`  ${k.padEnd(22)} ${n(e.stems).padStart(8)} · ${Math.round((100 * e.stems) / total)} %`);

  if (out) {
    const wb = new ExcelJS.Workbook();
    const sheet = (name: string, head: string[], data: (string | number)[][], widths: number[]) => {
      const ws = wb.addWorksheet(name);
      ws.columns = head.map((h, i) => ({ header: h, key: `c${i}`, width: widths[i] ?? 14 }));
      ws.getRow(1).font = { bold: true };
      for (const r of data) ws.addRow(r);
      for (let i = 0; i < head.length; i++) if (typeof data[0]?.[i] === "number") ws.getColumn(i + 1).numFmt = "#,##0";
      return ws;
    };
    sheet("По категориям", ["Категория", "Стеблей", "Доля", "По прайсу, ₸", "Записей"], Array.from(byGrade).sort((a, b) => compareGrades(farm === "esentai" ? "chrysanthemum" : "rose", a[0], b[0])).map(([g, e]) => [g, e.stems, Math.round((100 * e.stems) / total) / 100, Math.round(e.value), e.records]), [16, 12, 8, 16, 10]).getColumn(3).numFmt = "0 %";
    sheet("По сортам", ["Сорт · категория", "Стеблей", "По прайсу, ₸"], Array.from(byVar).sort((a, b) => b[1].stems - a[1].stems).map(([k, e]) => [k, e.stems, Math.round(e.value)]), [32, 12, 16]);
    sheet("По причинам", ["Причина", "Стеблей", "Доля"], Array.from(byReason).sort((a, b) => b[1].stems - a[1].stems).map(([k, e]) => [k, e.stems, Math.round((100 * e.stems) / total) / 100]), [44, 12, 8]).getColumn(3).numFmt = "0 %";
    sheet("По дням", ["День", "Стеблей"], Array.from(byDay).sort().map(([k, e]) => [k, e.stems]), [14, 12]);
    sheet("По возрасту", ["Возраст партии", "Стеблей", "Доля"], Array.from(byAge).map(([k, e]) => [k, e.stems, Math.round((100 * e.stems) / total) / 100]), [24, 12, 8]).getColumn(3).numFmt = "0 %";
    sheet(
      "Все записи",
      ["Дата", "Партия", "Цветок", "Сорт", "Категория", "Срезка", "Стеблей", "Причина", "Кто"],
      rows.sort((a, b) => (a.w.createdAt < b.w.createdAt ? -1 : 1)).map(({ w, b }) => [localDayKey(new Date(w.createdAt)), w.batchId, FLOWER_TYPE_LABELS[b!.flowerType] ?? b!.flowerType, b!.variety, b!.grade, b!.harvestDate || "", w.quantity, w.reason, w.warehouseEmail]),
      [12, 22, 14, 14, 12, 12, 10, 40, 28]
    );
    await wb.xlsx.writeFile(out);
    console.log(`\nExcel: ${out}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
