/**
 * Разовый запуск резервной копии — тем же кодом, что и ночное расписание.
 * Нужен, чтобы убедиться, что копия реально создаётся: непроверенная резервная
 * копия — это не резервная копия.
 *
 * Запуск: npx tsx scripts/backup-now.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createBackup } from "../src/lib/backup";

createBackup()
  .then((r) => {
    console.log(`Копия создана: ${r.title}`);
    console.log(`Вкладок: ${r.tabs}, строк данных: ${r.rows}`);
    console.log(`Ссылка: ${r.url}`);
  })
  .catch((err) => {
    console.error("Не получилось:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
