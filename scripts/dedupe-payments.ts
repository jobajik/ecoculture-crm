import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Убрать задвоенные строки платежей — одинаковый PaymentID во вкладке Payments дважды (19.11.2026: заявки 2NAUT и
 * FR7VT вернули из копии вместе с платежами, а удаление платежи не убирало — они задвоились). Остаётся первая строка
 * (самая ранняя в таблице), остальные с тем же номером удаляются одной записью. Сумма «получено» в самой заявке
 * (`PaidAmount`) не меняется — она и так одна.
 *
 *   npx tsx scripts/dedupe-payments.ts PAY-… [PAY-…] [--yes]
 */
import { commitAtomic, readTable, rowToRecord, SHEET_TABS } from "../src/lib/sheets";

async function main() {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const yes = process.argv.includes("--yes");
  if (ids.length === 0) throw new Error("Укажите номера платежей (PAY-…)");
  const t = await readTable(SHEET_TABS.PAYMENTS, { fresh: true });
  const rows = t.rows.map((r, i) => ({ rec: rowToRecord(SHEET_TABS.PAYMENTS, r), rowNumber: t.rowNumbers[i] }));
  const drop: number[] = [];
  for (const id of ids) {
    const same = rows.filter((r) => r.rec.PaymentID === id).sort((a, b) => a.rowNumber - b.rowNumber);
    console.log(`${id}: строк ${same.length}${same.length ? ` (${same.map((r) => `стр. ${r.rowNumber} · ${r.rec.OrderID} · ${r.rec.Amount}`).join("; ")})` : ""}`);
    if (same.length > 1) drop.push(...same.slice(1).map((r) => r.rowNumber));
  }
  if (drop.length === 0) return console.log("Задвоений нет.");
  if (!yes) return console.log(`Показ. Удалю строк: ${drop.length}. Записать — --yes`);
  await commitAtomic([{ kind: "delete", tab: SHEET_TABS.PAYMENTS, rowNumbers: drop }]);
  console.log(`Удалено строк: ${drop.length}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
