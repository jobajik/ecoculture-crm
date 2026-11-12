import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Позицию заявки отдали другим цветком с другого склада — записать как было (12.11.2026, №QTFOS «Мария»: в заявке
 * хризантема Есентая Altaj Третья 50 шт., а отдали хризантему Rose Farm из офиса; владелец подтвердил). Обычная
 * отгрузка этого не умеет: склад заявки — основной, а партия офисная, и цветок в позиции другой. Одной атомарной
 * записью (грабли 1.16): в позиции — новый цветок и «отгружено», остаток партий, строки журнала отгрузок, статус заявки.
 * Сорт, градация, количество и цена позиции не меняются; партии — того же сорта и градации на названном складе, от
 * старых срезок к свежим. ВАЖНО: со сменой цветка меняется компания счёта (`invoiceByFarm`) — это решение владельца.
 * Без --yes — показ; с --yes — сначала копия таблицы (--no-backup — без неё, если копию только что сняли).
 *
 *   npx tsx scripts/ship-item-as.ts <json> [--yes] [--no-backup]
 *   json: { "itemId": "ORD-…-I1", "flowerType": "chrysanthemum_rf", "store": "office", "note": "почему" }
 */
import { readFileSync } from "node:fs";
import { commitAtomic, forgetReads, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../src/lib/sheets";
import { sheetNumber } from "../src/lib/sheetCell";
import { toIsoDate } from "../src/lib/sheetDate";
import { createBackup } from "../src/lib/backup";
import { generateId } from "../src/lib/id";
import { statusAfterShipping } from "../src/lib/shipRules";
import { FARM_LABELS, FLOWER_TYPE_LABELS, getFarmFor } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";

const farmName = (flowerType: string) => {
  const farm = getFarmFor(flowerType as never);
  return farm ? FARM_LABELS[farm] ?? farm : "?";
};

async function rows(tab: string) {
  const t = await readTable(tab, { fresh: true });
  return t.rows.map((r, i) => ({ rec: rowToRecord(tab, r), rowNumber: t.rowNumbers[i] }));
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const yes = process.argv.includes("--yes");
  if (!file) throw new Error("Укажите файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { itemId: string; flowerType?: string; store?: string; note?: string };
  forgetReads();
  const [items, batches, orders] = await Promise.all([rows(SHEET_TABS.ORDER_ITEMS), rows(SHEET_TABS.BATCHES), rows(SHEET_TABS.ORDERS)]);
  const item = items.find((i) => i.rec.ItemID === spec.itemId);
  if (!item) throw new Error("Позиция не найдена");
  const order = orders.find((o) => o.rec.OrderID === item.rec.OrderID);
  if (!order) throw new Error("Заявка позиции не найдена");
  if (order.rec.Status === "cancelled") throw new Error("Заявка отменена");
  const flower = (spec.flowerType || item.rec.FlowerType).trim();
  if (!(flower in FLOWER_TYPE_LABELS)) throw new Error(`Нет такого цветка: ${flower}`);
  const store = (spec.store || "").trim();
  const need = sheetNumber(item.rec.Quantity) - sheetNumber(item.rec.ShippedQuantity);
  console.log(`Заявка ${order.rec.OrderID} «${order.rec.ClientName}» · статус ${order.rec.Status} · склад заявки ${order.rec.Store || "основной"}`);
  console.log(`Позиция ${item.rec.ItemID}: ${item.rec.FlowerType} · ${item.rec.Variety} · ${item.rec.Grade} · заказано ${item.rec.Quantity}, отгружено ${item.rec.ShippedQuantity}, цена ${item.rec.UnitPrice}`);
  if (!(need > 0)) throw new Error("Позиция уже отгружена целиком");
  if (flower !== item.rec.FlowerType) {
    console.log(`Цветок: ${item.rec.FlowerType} → ${flower}; счёт за позицию (${need * sheetNumber(item.rec.UnitPrice)} ₸ за ${need} шт.) переходит: ${farmName(item.rec.FlowerType)} → ${farmName(flower)}`);
  }
  const pool = batches
    .filter((b) => b.rec.FlowerType === flower && b.rec.Variety === item.rec.Variety && b.rec.Grade === item.rec.Grade && (b.rec.Store || "") === store && sheetNumber(b.rec.QuantityRemaining) > 0)
    .sort((a, b) => (toIsoDate(a.rec.HarvestDate) < toIsoDate(b.rec.HarvestDate) ? -1 : 1));
  const parts: { batch: (typeof batches)[number]; quantity: number }[] = [];
  let left = need;
  for (const b of pool) {
    if (left <= 0) break;
    const q = Math.min(left, sheetNumber(b.rec.QuantityRemaining));
    parts.push({ batch: b, quantity: q });
    left -= q;
  }
  if (left > 0) throw new Error(`На складе «${store || "основной"}» не хватает: нужно ${need}, есть ${need - left} (${flower} · ${item.rec.Variety} · ${item.rec.Grade})`);
  for (const p of parts) console.log(`  с партии ${p.batch.rec.BatchID} (срезка ${toIsoDate(p.batch.rec.HarvestDate)}, ${p.batch.rec.Store || "основной"}): ${p.quantity} шт., остаток ${sheetNumber(p.batch.rec.QuantityRemaining)} → ${sheetNumber(p.batch.rec.QuantityRemaining) - p.quantity}`);

  const itemsNow = items
    .filter((i) => i.rec.OrderID === order.rec.OrderID)
    .map((i) => ({ quantity: sheetNumber(i.rec.Quantity), shippedQuantity: i === item ? sheetNumber(i.rec.Quantity) : sheetNumber(i.rec.ShippedQuantity) }));
  const status = statusAfterShipping(order.rec.Status, itemsNow);
  console.log(`Статус заявки: ${order.rec.Status} → ${status}`);

  const at = new Date().toISOString();
  const ops: WriteOp[] = [
    { kind: "update", tab: SHEET_TABS.ORDER_ITEMS, rowNumber: item.rowNumber, changes: { FlowerType: flower, ShippedQuantity: sheetNumber(item.rec.Quantity) } },
    ...parts.map((p): WriteOp => ({ kind: "update", tab: SHEET_TABS.BATCHES, rowNumber: p.batch.rowNumber, changes: { QuantityRemaining: sheetNumber(p.batch.rec.QuantityRemaining) - p.quantity } })),
    {
      kind: "append",
      tab: SHEET_TABS.SHIPMENTS,
      records: parts.map((p) => ({ ShipmentID: generateId("SHIP"), CreatedAt: at, OrderID: order.rec.OrderID, ItemID: item.rec.ItemID, BatchID: p.batch.rec.BatchID, Quantity: p.quantity, WarehouseEmail: OWNER, Notes: spec.note || "" })),
    },
  ];
  if (status !== order.rec.Status) ops.push({ kind: "update", tab: SHEET_TABS.ORDERS, rowNumber: order.rowNumber, changes: { Status: status } });

  if (!yes) return console.log("\nТолько показ. Записать — с --yes.");
  if (!process.argv.includes("--no-backup")) {
    const backup = await createBackup();
    console.log(`Копия таблицы: ${backup.title}`);
  }
  await commitAtomic(ops);
  console.log(`Записано: ${ops.length} изменений одной записью.`);
}

main().catch((e) => {
  console.error("Не получилось:", e instanceof Error ? e.message : e);
  process.exit(1);
});
