import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Добавить колонки во вкладки, где сетка уже, чем заголовки (`ensureGridColumns`).
 * Безопасно запускать сколько угодно раз: только дописывает пустые колонки в конец.
 *
 *   npx tsx scripts/ensure-columns.ts
 */
import { ensureGridColumns } from "../src/lib/sheets";

ensureGridColumns()
  .then((changed) => {
    if (changed.length === 0) console.log("Колонок хватает везде.");
    for (const c of changed) console.log(`${c.tab}: было ${c.before} колонок, стало ${c.after}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
