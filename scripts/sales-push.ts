/*
 * Поставить или снять «Распродаём в первую очередь» (`src/lib/salesPush.ts`, настройка `SalesPush`): бот предлагает
 * позицию первой и считает цену от объёма, дожим подмешивает её, менеджеры видят строку на главной и в утренней сводке.
 *
 *   npx tsx scripts/sales-push.ts <json> [--yes]     json: [{"flowerType":"chrysanthemum","grade":"Четвёртая","bulkFrom":1000,"bulkPrice":160}]
 *   npx tsx scripts/sales-push.ts --clear [--yes]   — снять распродажу
 *
 * Без --yes — показ. 13.10.2026, владелец: «усиленно распродай 4 категорию хризантемы»; от 1 000 шт. — 160 ₸.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync } from "node:fs";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { saveSettings } from "../src/lib/repo/settings";
import { parsePush, pushLineText, pushLines, SALES_PUSH_SETTING } from "../src/lib/salesPush";
import { listBatches } from "../src/lib/repo/batches";
import { getSettings } from "../src/lib/repo/settings";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { priceFor } from "../src/lib/priceList";
import { stockMap } from "../src/lib/botKnowledge";
import { inStore } from "../src/lib/officeStore";

async function main() {
  const yes = process.argv.includes("--yes");
  const clear = process.argv.includes("--clear");
  const before = parsePush((await settingsMap(true))[SALES_PUSH_SETTING]);
  console.log(`Сейчас: ${before.length ? JSON.stringify(before) : "распродажи нет"}`);
  const items = clear ? [] : parsePush(readFileSync(process.argv[2], "utf8").replace(/^﻿/, ""));
  if (!clear && items.length === 0) throw new Error("В файле нет ни одной позиции (нужны flowerType и grade)");
  const [batches, settings, prices] = await Promise.all([listBatches(), getSettings(), getCurrentPrices()]);
  const live = Array.from(stockMap(inStore(batches, ""), settings, new Date()).values());
  for (const l of pushLines(items, live, (f, v, g) => priceFor(prices, f, v, g))) console.log(`Станет: ${pushLineText(l)}`);
  if (clear) console.log("Станет: распродажи нет");
  if (!yes) return console.log("Только показ. Записать: --yes");
  await saveSettings({ [SALES_PUSH_SETTING]: items.length ? JSON.stringify(items) : "" });
  console.log("Записано.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
