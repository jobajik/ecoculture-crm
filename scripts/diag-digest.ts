/*
 * Утренняя сводка — как она выглядит на ЖИВОЙ базе. Ничего не отправляет и не
 * пишет, только печатает текст.
 *
 * Запуск: npx tsx scripts/diag-digest.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { buildMorningDigest } from "../src/lib/morningDigestRunner";

buildMorningDigest()
  .then((text) => console.log(text))
  .catch((err) => {
    console.error("ОШИБКА:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
