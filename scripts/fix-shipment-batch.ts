import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Отгрузка записана не с той партии — переставить её на правильную (12.11.2026, зав. складом Rose Farm: «№6JOZ0 эустома
 * Alissa White Стандарт 70 поменять на Alissa 1 Pure White»; «№QTFOS хризантема 50 шт. — склад отгрузки с основного на
 * офис»). Заявка уже отгружена и оплачена, поэтому она не «возвращается и отгружается заново» (статус и деньги не
 * трогаются), а правится ровно то, что было записано неверно, одной атомарной записью (грабли 1.16):
 *   остаток старой партии + количество, остаток новой − количество, в строке отгрузки — новая партия и пометка,
 *   в позиции заявки — новый сорт (если менялся сорт). Количество, цена, сумма и оплата не меняются.
 * Новая партия — того же цветка и той же градации; сорт другой только если он назван (`variety`), склад другой только
 * если назван (`store`: "" — основной, "office"). Берётся самая старая срезка, где хватает остатка, либо `batchId`.
 * Без --yes — только показ. С --yes — сначала копия таблицы.
 *
 *   npx tsx scripts/fix-shipment-batch.ts <json> [--yes]
 *   json: [{ "shipmentId": "SHIP-…", "variety": "…", "store": "office", "batchId": "…", "note": "почему" }]
 */
import { readFileSync } from "node:fs";
import { commitAtomic, forgetReads, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../src/lib/sheets";
import { sheetNumber } from "../src/lib/sheetCell";
import { toIsoDate } from "../src/lib/sheetDate";
import { createBackup } from "../src/lib/backup";
import { localDayKey } from "../src/lib/timezone";

interface Fix {
  shipmentId: string;
  variety?: string;
  store?: string;
  batchId?: string;
  note?: string;
}

async function rows(tab: string) {
  const t = await readTable(tab, { fresh: true });
  return t.rows.map((r, i) => ({ rec: rowToRecord(tab, r), rowNumber: t.rowNumbers[i] }));
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const yes = process.argv.includes("--yes");
  if (!file) throw new Error("Укажите файл JSON");
  const fixes = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as Fix[];
  forgetReads();
  const [ships, batches, items] = await Promise.all([rows(SHEET_TABS.SHIPMENTS), rows(SHEET_TABS.BATCHES), rows(SHEET_TABS.ORDER_ITEMS)]);
  // Остатки меняются по ходу списка: вторая правка видит то, что забрала первая.
  const left = new Map(batches.map((b) => [b.rec.BatchID, sheetNumber(b.rec.QuantityRemaining)]));
  const ops: WriteOp[] = [];
  const batchChanged = new Set<string>();
  let failed = 0;

  for (const f of fixes) {
    const fail = (why: string) => {
      failed++;
      console.log(`  ОШИБКА: ${why}`);
    };
    console.log(`\n${f.shipmentId}${f.note ? ` — ${f.note}` : ""}`);
    const found = ships.filter((s) => s.rec.ShipmentID === f.shipmentId);
    if (found.length !== 1) {
      fail(found.length ? "строк отгрузки с таким номером несколько" : "отгрузка не найдена");
      continue;
    }
    const ship = found[0];
    const qty = sheetNumber(ship.rec.Quantity);
    const from = batches.find((b) => b.rec.BatchID === ship.rec.BatchID);
    const item = items.find((i) => i.rec.ItemID === ship.rec.ItemID);
    if (!from || !item) {
      fail(!from ? "партия отгрузки не найдена" : "позиция заявки не найдена");
      continue;
    }
    if (!(qty > 0)) {
      fail("это строка возврата (количество не больше нуля)");
      continue;
    }
    const wantVariety = (f.variety ?? from.rec.Variety).trim();
    const wantStore = (f.store ?? from.rec.Store ?? "").trim();
    const fits = (b: (typeof batches)[number]) => b.rec.FlowerType === from.rec.FlowerType && b.rec.Grade === from.rec.Grade && b.rec.Variety === wantVariety && (b.rec.Store || "") === wantStore;
    const to = f.batchId
      ? batches.find((b) => b.rec.BatchID === f.batchId)
      : batches
          .filter((b) => fits(b) && b.rec.BatchID !== from.rec.BatchID && (left.get(b.rec.BatchID) ?? 0) >= qty)
          .sort((a, b) => (toIsoDate(a.rec.HarvestDate) < toIsoDate(b.rec.HarvestDate) ? -1 : 1))[0];
    console.log(`  позиция: ${item.rec.FlowerType} · ${item.rec.Variety} · ${item.rec.Grade} · заказано ${item.rec.Quantity}, отгружено ${item.rec.ShippedQuantity}`);
    console.log(`  сейчас:  ${qty} шт. с партии ${from.rec.BatchID} [${from.rec.Variety} · ${from.rec.Grade} · срезка ${toIsoDate(from.rec.HarvestDate)} · ${from.rec.Store || "основной"}], остаток ${left.get(from.rec.BatchID)}`);
    if (!to) {
      const have = batches.filter((b) => fits(b)).map((b) => `${b.rec.BatchID} остаток ${left.get(b.rec.BatchID)}`);
      fail(`нет партии «${wantVariety} · ${from.rec.Grade}» на складе «${wantStore || "основной"}» с остатком от ${qty} шт. (есть: ${have.join("; ") || "ни одной"})`);
      continue;
    }
    if (to.rec.BatchID === from.rec.BatchID) {
      fail("это та же партия");
      continue;
    }
    if (!fits(to)) {
      fail(`партия ${to.rec.BatchID} — другой цветок, градация, сорт или склад [${to.rec.FlowerType} · ${to.rec.Variety} · ${to.rec.Grade} · ${to.rec.Store || "основной"}]`);
      continue;
    }
    if ((left.get(to.rec.BatchID) ?? 0) < qty) {
      fail(`в партии ${to.rec.BatchID} осталось ${left.get(to.rec.BatchID)} — меньше ${qty}`);
      continue;
    }
    left.set(from.rec.BatchID, (left.get(from.rec.BatchID) ?? 0) + qty);
    left.set(to.rec.BatchID, (left.get(to.rec.BatchID) ?? 0) - qty);
    batchChanged.add(from.rec.BatchID).add(to.rec.BatchID);
    console.log(`  станет:  ${qty} шт. с партии ${to.rec.BatchID} [${to.rec.Variety} · ${to.rec.Grade} · срезка ${toIsoDate(to.rec.HarvestDate)} · ${to.rec.Store || "основной"}], остаток ${left.get(to.rec.BatchID)}; в ${from.rec.BatchID} вернётся ${qty} → ${left.get(from.rec.BatchID)}`);
    const stamp = `${localDayKey().slice(8, 10)}.${localDayKey().slice(5, 7)}: партия исправлена, была ${from.rec.BatchID} (${from.rec.Variety}${(from.rec.Store || "") !== wantStore ? `, ${from.rec.Store || "основной"}` : ""})${f.note ? ` — ${f.note}` : ""}`;
    ops.push({ kind: "update", tab: SHEET_TABS.SHIPMENTS, rowNumber: ship.rowNumber, changes: { BatchID: to.rec.BatchID, Notes: [ship.rec.Notes, stamp].filter(Boolean).join(" · ") } });
    if (item.rec.Variety !== to.rec.Variety) {
      console.log(`  позиция заявки: сорт «${item.rec.Variety}» → «${to.rec.Variety}» (количество и цена прежние)`);
      ops.push({ kind: "update", tab: SHEET_TABS.ORDER_ITEMS, rowNumber: item.rowNumber, changes: { Variety: to.rec.Variety } });
    }
  }
  for (const id of batchChanged) {
    const b = batches.find((x) => x.rec.BatchID === id)!;
    ops.push({ kind: "update", tab: SHEET_TABS.BATCHES, rowNumber: b.rowNumber, changes: { QuantityRemaining: left.get(id) } });
  }

  if (failed) return console.log(`\nОшибок: ${failed} — ничего не записано.`);
  if (!yes) return console.log(`\nПоказ. Записей к изменению: ${ops.length}. Чтобы записать — добавьте --yes.`);
  const backup = await createBackup();
  console.log(`\nКопия таблицы: ${JSON.stringify(backup).slice(0, 200)}`);
  await commitAtomic(ops);
  console.log(`Записано: ${ops.length} изменений одной записью.`);
}

main().catch((e) => {
  console.error("Не получилось:", e instanceof Error ? e.message : e);
  process.exit(1);
});
