import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Привести уже записанные телефоны к одному виду «+77015552030» (`lib/phone.ts`).
 * Владелец, 01.10.2026: «чтобы была одна форма». Клиенты (телефон, Kaspi №1 и
 * №2), лиды и заявки (телефон доставки).
 *
 * Меняется только то, что после правки — полный номер +7 и 10 цифр; «нет»,
 * иностранный, неполный номер остаются как были (и печатаются — их видно).
 * Без `--yes` только показ. С ним — сначала копия всей таблицы, потом запись
 * пачками.
 *
 *   npx tsx scripts/fix-phones.ts          — показать
 *   npx tsx scripts/fix-phones.ts --yes    — исправить
 */
import { commitAtomic, prefetchTables, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../src/lib/sheets";
import { createBackup } from "../src/lib/backup";
import { formatPhone, phoneComplete } from "../src/lib/phone";

const TARGETS: { tab: string; columns: string[] }[] = [
  { tab: SHEET_TABS.CLIENTS, columns: ["Phone", "KaspiPay1", "KaspiPay2"] },
  { tab: SHEET_TABS.LEADS, columns: ["Phone"] },
  { tab: SHEET_TABS.ORDERS, columns: ["ClientPhone"] },
];

async function main() {
  const apply = process.argv.includes("--yes");
  await prefetchTables(TARGETS.map((t) => t.tab));
  const ops: WriteOp[] = [];
  for (const { tab, columns } of TARGETS) {
    const table = await readTable(tab, { fresh: true });
    let fixed = 0;
    let already = 0;
    const odd: string[] = [];
    const samples: string[] = [];
    table.rows.forEach((row, i) => {
      const rec = rowToRecord(tab, row);
      const changes: Record<string, string> = {};
      for (const col of columns) {
        const was = String(rec[col] ?? "");
        if (!was.trim()) continue;
        const now = formatPhone(was);
        if (phoneComplete(was)) already += 1;
        else if (phoneComplete(now)) {
          changes[col] = now;
          if (samples.length < 6) samples.push(`«${was}» → ${now}`);
        } else if (odd.length < 15) odd.push(`${col}: «${was}»`);
        else odd.push("");
      }
      if (Object.keys(changes).length > 0) {
        fixed += Object.keys(changes).length;
        ops.push({ kind: "update", tab, rowNumber: table.rowNumbers[i], changes });
      }
    });
    console.log(`\n=== ${tab}: исправить ${fixed}, уже в нужном виде ${already}, не номер +7 (оставляю) ${odd.length} ===`);
    for (const s of samples) console.log(`  ${s}`);
    if (odd.length) console.log(`  оставляю как есть, например: ${odd.filter(Boolean).slice(0, 15).join(" · ")}`);
  }
  if (!apply) {
    console.log(`\nВсего правок строк: ${ops.length}. Ничего не тронуто: это показ. Для записи — с ключом --yes.`);
    return;
  }
  if (ops.length === 0) {
    console.log("\nИсправлять нечего.");
    return;
  }
  console.log("\nДелаю копию всей таблицы…");
  const backup = await createBackup(new Date(), (m) => console.log(`  ${m}`));
  console.log(`Копия готова: «${backup.title}» — ${backup.rows} строк`);
  for (let i = 0; i < ops.length; i += 400) {
    await commitAtomic(ops.slice(i, i + 400));
    console.log(`  записано ${Math.min(i + 400, ops.length)} из ${ops.length}`);
  }
  console.log("Готово.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
