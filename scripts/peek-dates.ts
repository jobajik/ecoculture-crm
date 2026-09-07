import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();
import { readTable, rowToRecord, SHEET_TABS } from "../src/lib/sheets";
import { toIsoDate } from "../src/lib/sheetDate";

async function main() {
  const t = await readTable(SHEET_TABS.BATCHES);
  console.log("строк:", t.rows.length);
  console.log("заголовки листа:", JSON.stringify(t.headers));
  const counts = new Map<string, number>();
  t.rows.forEach((row, i) => {
    const r = rowToRecord(SHEET_TABS.BATCHES, row);
    counts.set(r.HarvestDate, (counts.get(r.HarvestDate) ?? 0) + 1);
    if (i < 8) {
      console.log(
        `  строка ${t.rowNumbers[i]}: HarvestDate=${JSON.stringify(r.HarvestDate)} -> ${JSON.stringify(
          toIsoDate(r.HarvestDate)
        )} | ${r.Variety} ${r.Grade} ${r.QuantityIn} | сырая строка: ${JSON.stringify(row.slice(0, 4))}`
      );
    }
  });
  console.log("\nразные значения HarvestDate:");
  for (const [v, n] of counts) console.log(`  ${JSON.stringify(v)} — ${n} шт`);
}
main().catch((e) => { console.error(e); process.exit(1); });
