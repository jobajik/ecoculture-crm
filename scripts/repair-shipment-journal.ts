/*
 * Восстановление потерянных строк журнала отгрузок.
 *
 * Аудит сентября нашёл 18 позиций, у которых «отгружено» в заявке больше, чем
 * сумма строк во вкладке Shipments, и 25 партий, где остаток меньше, чем
 * выходит по журналам. Причина — прежняя запись отгрузки четырьмя запросами:
 * остаток партии, «отгружено» и статус записывались, а строка журнала —
 * последний запрос — упиралась в лимит Google и терялась. Цветок уехал, склад
 * списал, а в отчётах по отгрузкам его нет.
 *
 * Правдой здесь считаются счётчики, а не журнал: «отгружено» по каждой такой
 * позиции ровно равно заказанному, и склад по ним физически отгружал. Скрипт
 * ДОПИСЫВАЕТ недостающие строки журнала — ничего не стирает и не меняет:
 *  - количество — разница «счётчик минус журнал» по позиции;
 *  - партия — та же позиция склада (цветок, сорт, длина), у которой остаток
 *    меньше, чем по журналам (из неё и ушли потерянные стебли), от старых к
 *    свежим; не нашлось — партия остаётся пустой, это честнее выдумки;
 *  - время — время последней настоящей отгрузки этой позиции (или заявки);
 *  - пометка «Восстановлено аудитом».
 *
 * Предохранители как у прочих починок: без `--yes` только показывает, перед
 * записью — копия всей таблицы, запись одним атомарным запросом.
 *
 * Запуск: npx tsx scripts/repair-shipment-journal.ts [--yes]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listShipments } from "../src/lib/repo/shipments";
import { listBatches } from "../src/lib/repo/batches";
import { listWriteoffs } from "../src/lib/repo/writeoffs";
import { listStaffTakeouts } from "../src/lib/repo/staffTakeouts";
import { commitAtomic, forgetReads, SHEET_TABS } from "../src/lib/sheets";
import { createBackup } from "../src/lib/backup";
import { generateId } from "../src/lib/id";

const WRITE = process.argv.includes("--yes");
const NOTE = "Восстановлено аудитом: строка журнала была потеряна при записи";

async function main() {
  forgetReads();
  const [orders, shipments, batches, writeoffs, takeouts] = await Promise.all([
    listOrdersWithItems(),
    listShipments(),
    listBatches(),
    listWriteoffs(),
    listStaffTakeouts(),
  ]);

  // Сколько стеблей ушло из партии без следа: остаток меньше, чем по журналам.
  const out = new Map<string, number>();
  const add = (id: string, q: number) => out.set(id, (out.get(id) ?? 0) + q);
  shipments.forEach((s) => add(s.batchId, s.quantity));
  writeoffs.forEach((w) => add(w.batchId, w.quantity));
  takeouts.forEach((t) => add(t.batchId, t.quantity));
  const deficit = new Map<string, number>();
  for (const b of batches) {
    const lost = b.quantityIn - (out.get(b.batchId) ?? 0) - b.quantityRemaining;
    if (lost > 0) deficit.set(b.batchId, lost);
  }

  const journalByItem = new Map<string, typeof shipments>();
  for (const s of shipments) journalByItem.set(s.itemId, [...(journalByItem.get(s.itemId) ?? []), s]);
  const lastShipOfOrder = new Map<string, string>();
  for (const s of shipments) {
    if ((lastShipOfOrder.get(s.orderId) ?? "") < s.createdAt) lastShipOfOrder.set(s.orderId, s.createdAt);
  }

  const records: Record<string, unknown>[] = [];
  let unattributed = 0;
  for (const o of orders) {
    for (const i of o.items) {
      const rows = journalByItem.get(i.itemId) ?? [];
      const missing = i.shippedQuantity - rows.reduce((s, r) => s + r.quantity, 0);
      if (missing <= 0) continue;
      const when =
        rows.map((r) => r.createdAt).sort().pop() || lastShipOfOrder.get(o.orderId) || o.createdAt;
      const candidates = batches
        .filter(
          (b) =>
            (deficit.get(b.batchId) ?? 0) > 0 &&
            b.flowerType === i.flowerType &&
            b.variety.trim().toLowerCase() === i.variety.trim().toLowerCase() &&
            b.grade === i.grade
        )
        .sort((a, b) => (a.harvestDate < b.harvestDate ? -1 : 1));
      let left = missing;
      for (const b of candidates) {
        if (left <= 0) break;
        const take = Math.min(left, deficit.get(b.batchId) ?? 0);
        if (take <= 0) continue;
        deficit.set(b.batchId, (deficit.get(b.batchId) ?? 0) - take);
        left -= take;
        records.push(row(o.orderId, i.itemId, b.batchId, take, when));
      }
      if (left > 0) {
        unattributed += left;
        records.push(row(o.orderId, i.itemId, "", left, when));
      }
      console.log(`${o.orderId} ${i.variety} ${i.grade}: дописать ${missing} шт.${left > 0 ? ` (без партии ${left})` : ""}`);
    }
  }

  const total = records.reduce((s, r) => s + Number(r.Quantity), 0);
  console.log(`\nСтрок к дописыванию: ${records.length}, стеблей: ${total}, из них без партии: ${unattributed}`);
  if (records.length === 0) return console.log("Восстанавливать нечего.");
  if (!WRITE) return console.log("Это показ. Чтобы записать — запустите с ключом --yes.");

  console.log("\nДелаю резервную копию таблицы…");
  const backup = await createBackup(new Date(), (m) => console.log(`  ${m}`));
  console.log(`Копия готова: «${backup.title}» — ${backup.rows} строк`);
  console.log(backup.url);

  await commitAtomic([{ kind: "append", tab: SHEET_TABS.SHIPMENTS, records }]);
  console.log(`Дописано строк: ${records.length}.`);
}

function row(orderId: string, itemId: string, batchId: string, quantity: number, createdAt: string) {
  return {
    ShipmentID: generateId("SHIP"),
    CreatedAt: createdAt,
    OrderID: orderId,
    ItemID: itemId,
    BatchID: batchId,
    Quantity: quantity,
    WarehouseEmail: "",
    Notes: NOTE,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
