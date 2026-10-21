import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Убрать выдачу сотруднику, записанную дважды (21.10.2026, владелец со снимком: «Бабаян Слава» за 19.10 — две
 * одинаковые строки «Altaj Высшая 10 шт. по 630», «удали одну»). Ищет выдачи за день по слову из фамилии, среди
 * ОДИНАКОВЫХ (человек, партия, стебли, цена, вид) оставляет самую раннюю, остальные удаляет, а их стебли возвращает
 * в партию — одним атомарным запросом на каждую. В интерфейсе удаления выдачи нет.
 *
 *   npx tsx scripts/takeout-delete.ts <ГГГГ-ММ-ДД> <слово из фамилии | @файл со словом> [--id=TK-…] [--yes]
 *
 * Без --yes только показ. С --yes — сначала копия всей таблицы, потом удаление и запись в журнал действий.
 */
import { readFileSync } from "node:fs";
import { commitAtomic, readTable, rowToRecord, SHEET_TABS } from "../src/lib/sheets";
import { sheetNumber } from "../src/lib/sheetCell";
import { toIsoDate } from "../src/lib/sheetDate";
import { staffKey } from "../src/lib/staffTakeout";
import { createBackup } from "../src/lib/backup";
import { logMoney } from "../src/lib/repo/moneyLog";
import { MONEY_LOG_ACTIONS } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";

async function main() {
  const [day, rawWord] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  // «@файл» — слово из файла: русские буквы в .bat портятся кодировкой консоли.
  const word = rawWord?.startsWith("@") ? readFileSync(rawWord.slice(1), "utf8").replace(/^\uFEFF/, "").trim() : rawWord;
  const apply = process.argv.includes("--yes");
  if (!day || !word) throw new Error("нужны день (ГГГГ-ММ-ДД) и слово из фамилии");
  const t = await readTable(SHEET_TABS.STAFF_TAKEOUTS, { fresh: true });
  const rows = t.rows
    .map((r, i) => ({ rec: rowToRecord(SHEET_TABS.STAFF_TAKEOUTS, r), rowNumber: t.rowNumbers[i] }))
    .filter((x) => (toIsoDate(x.rec.Date) || x.rec.Date) === day && staffKey(x.rec.StaffName).includes(staffKey(word)));
  console.log(`Выдачи за ${day} по «${word}»: ${rows.length}`);
  for (const x of rows)
    console.log(`  ${x.rec.TakeoutID} · ${x.rec.CreatedAt} · ${x.rec.StaffName} · ${x.rec.Variety} ${x.rec.Grade} · ${x.rec.Quantity} шт. × ${x.rec.UnitPrice} · партия ${x.rec.BatchID}`);
  const groups = new Map<string, typeof rows>();
  for (const x of rows) {
    const k = [staffKey(x.rec.StaffName), x.rec.BatchID, sheetNumber(x.rec.Quantity), sheetNumber(x.rec.UnitPrice), (x.rec.Kind || "").trim()].join("|");
    groups.set(k, [...(groups.get(k) ?? []), x]);
  }
  // --id=TK-… — удалить именно эту выдачу (одинаковые строки бывают из разных партий: второй раз внесли позже).
  const onlyId = process.argv.find((a) => a.startsWith("--id="))?.slice(5);
  const extra = onlyId
    ? rows.filter((x) => x.rec.TakeoutID === onlyId)
    : Array.from(groups.values()).flatMap((g) => g.sort((a, b) => (a.rec.CreatedAt < b.rec.CreatedAt ? -1 : 1)).slice(1));
  if (!extra.length) return console.log("Одинаковых строк нет — удалять нечего.");
  console.log(`Удалить${onlyId ? "" : " (повторы, остаётся самая ранняя)"}: ${extra.map((x) => x.rec.TakeoutID).join(", ")}`);
  if (!apply) return console.log("Только показ. Удалить: --yes");

  const backup = await createBackup(new Date(), (m) => console.log(`  копия: ${m}`));
  console.log(`Копия таблицы: ${backup.url ?? JSON.stringify(backup).slice(0, 200)}`);
  // Снизу вверх: удаление строки сдвигает те, что ниже.
  for (const x of extra.sort((a, b) => b.rowNumber - a.rowNumber)) {
    const qty = sheetNumber(x.rec.Quantity);
    const b = await readTable(SHEET_TABS.BATCHES, { fresh: true });
    const i = b.rows.findIndex((r) => rowToRecord(SHEET_TABS.BATCHES, r).BatchID === x.rec.BatchID);
    const ops: Parameters<typeof commitAtomic>[0] = [];
    let back = "партия не найдена — стебли не возвращены";
    if (i >= 0) {
      const rec = rowToRecord(SHEET_TABS.BATCHES, b.rows[i]);
      const remaining = sheetNumber(rec.QuantityRemaining);
      const total = sheetNumber(rec.QuantityIn);
      const next = total > 0 ? Math.min(total, remaining + qty) : remaining + qty;
      ops.push({ kind: "update", tab: SHEET_TABS.BATCHES, rowNumber: b.rowNumbers[i], changes: { QuantityRemaining: next } });
      back = `в партию ${x.rec.BatchID}: было ${remaining}, стало ${next}`;
    }
    ops.push({ kind: "delete", tab: SHEET_TABS.STAFF_TAKEOUTS, rowNumbers: [x.rowNumber] });
    await commitAtomic(ops);
    console.log(`Удалена ${x.rec.TakeoutID}; ${back}`);
    await logMoney({
      actorEmail: OWNER,
      orderId: "",
      action: MONEY_LOG_ACTIONS.BATCH_FIXED,
      details: `удалена выдача сотруднику, записанная дважды: ${x.rec.StaffName}, ${day}, ${x.rec.Variety} ${x.rec.Grade} ${qty} шт. по ${x.rec.UnitPrice} · ${back}`,
      amountBefore: 0,
      amountAfter: 0,
    });
  }
  console.log("Готово.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
