/*
 * Три разовые правки по просьбе зав. склада Rose Farm (снимки 26.09, диагностика —
 * scripts/diag-razia.ts):
 *
 * 1) Заявка ORD-260914-T85ZC «Цветочник, Мамыр-1, 8 киоск», доставка 12.09 (наш
 *    магазин, цен нет): «Жумилия 50 — 60, 70 — 45, Жумилия 40 см убрать».
 *    То есть вместо 45 шт. Jumilia 50 и 45 шт. Jumilia 40 уехало 60 шт. Jumilia 50
 *    и 45 шт. Jumilia 70. Строка «Jumilia 40» становится «Jumilia 70» (45 шт.),
 *    строка «Jumilia 50» — 60 шт.; журнал отгрузок правится так, чтобы
 *    «отгружено» сходилось с ним (грабли 1.16): отгрузка Jumilia 40 перенаправлена
 *    на партию Jumilia 70 той же срезки (10.09), 15 шт. Jumilia 50 дописаны из
 *    партии 50 той же срезки тем же днём отгрузки (14.09).
 *    ОСТАТКИ ПАРТИЙ НЕ ТРОГАЮТСЯ: цветок срезки 10.09 давно ушёл, все эти партии
 *    уже на нуле. Вернуть 45 стеблей в партию 40 см значило бы показать на складе
 *    цветок, которого нет, а снять 60 со свежих партий — убрать цветок, который
 *    лежит. Живой склад от ошибки двухнедельной давности не зависит; если
 *    ростовки разошлись с холодильником, это ловит пересчёт.
 *
 * 2) Партия BATCH-260910-QLAI8 (срезка 02.09, 40 см, 420 шт., не тронута) принята
 *    как «Peach Avalanche», а на деле это «Avalanche» — меняется только сорт.
 *
 * 3) Расход на нужды компании TK-260926-28A0L «Офис(Данияр)», Мини-микс
 *    одноголовые, 90 шт.: цена стебля 320 → 120.
 *
 * Каждое изменение проверяет, что в таблице лежит ровно то, что видела
 * диагностика; иначе ничего не пишется. Всё — одним атомарным запросом.
 *
 * Запуск:  npx tsx scripts/fix-razia-0926.ts        — только показать
 *          npx tsx scripts/fix-razia-0926.ts --yes  — копия таблицы, затем запись
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { commitAtomic, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../src/lib/sheets";
import { createBackup } from "../src/lib/backup";
import { generateId } from "../src/lib/id";
import { logMoney } from "../src/lib/repo/moneyLog";
import { MONEY_LOG_ACTIONS } from "../src/lib/constants";

const APPLY = process.argv.includes("--yes");
const OWNER = "y.sadakbayev@gmail.com";
const ORDER = "ORD-260914-T85ZC";
const ITEM_50 = "ORD-260914-T85ZC-I7";
const ITEM_40 = "ORD-260914-T85ZC-I8";
const SHIP_40 = "SHIP-260914-510XE";
const SHIP_50 = "SHIP-260914-P1YB5";
const BATCH_70 = "BATCH-260910-97ONN";
const BATCH_50 = "BATCH-260910-WHK22";
const BATCH_FIX = "BATCH-260910-QLAI8";
const TAKEOUT = "TK-260926-28A0L";

type Found = { record: Record<string, string>; rowNumber: number };

async function find(tab: string, key: string, value: string): Promise<Found> {
  const table = await readTable(tab, { fresh: true });
  for (let i = 0; i < table.rows.length; i++) {
    const record = rowToRecord(tab, table.rows[i]);
    if (record[key] === value) return { record, rowNumber: table.rowNumbers[i] };
  }
  throw new Error(`${tab}: не найдено ${value}`);
}

function expect(ok: boolean, what: string) {
  if (!ok) throw new Error(`Данные не такие, как в диагностике: ${what}. Ничего не записано.`);
}

async function main() {
  const i50 = await find(SHEET_TABS.ORDER_ITEMS, "ItemID", ITEM_50);
  const i40 = await find(SHEET_TABS.ORDER_ITEMS, "ItemID", ITEM_40);
  const s40 = await find(SHEET_TABS.SHIPMENTS, "ShipmentID", SHIP_40);
  const s50 = await find(SHEET_TABS.SHIPMENTS, "ShipmentID", SHIP_50);
  const b70 = await find(SHEET_TABS.BATCHES, "BatchID", BATCH_70);
  const b50 = await find(SHEET_TABS.BATCHES, "BatchID", BATCH_50);
  const bFix = await find(SHEET_TABS.BATCHES, "BatchID", BATCH_FIX);
  const tk = await find(SHEET_TABS.STAFF_TAKEOUTS, "TakeoutID", TAKEOUT);

  const n = (v: string | undefined) => Number(v) || 0;
  expect(i50.record.OrderID === ORDER && i50.record.Variety === "Jumilia" && i50.record.Grade === "50" && n(i50.record.Quantity) === 45 && n(i50.record.ShippedQuantity) === 45, "Jumilia 50 — 45 шт.");
  expect(i40.record.OrderID === ORDER && i40.record.Variety === "Jumilia" && i40.record.Grade === "40" && n(i40.record.Quantity) === 45 && n(i40.record.ShippedQuantity) === 45, "Jumilia 40 — 45 шт.");
  expect(s40.record.ItemID === ITEM_40 && n(s40.record.Quantity) === 45, "отгрузка Jumilia 40");
  expect(s50.record.ItemID === ITEM_50 && n(s50.record.Quantity) === 45, "отгрузка Jumilia 50");
  expect(b70.record.Variety === "Jumilia" && b70.record.Grade === "70", "партия Jumilia 70 от 10.09");
  expect(b50.record.Variety === "Jumilia" && b50.record.Grade === "50", "партия Jumilia 50 от 10.09");
  expect(bFix.record.Variety === "Peach Avalanche" && bFix.record.Grade === "40", "партия Peach Avalanche 40");
  expect(tk.record.Kind === "company" && n(tk.record.Quantity) === 90 && n(tk.record.UnitPrice) === 320, "расход Офис(Данияр) 90 × 320");

  const note = "исправлено 26.09 по просьбе склада";
  const ops: WriteOp[] = [
    { kind: "update", tab: SHEET_TABS.ORDER_ITEMS, rowNumber: i50.rowNumber, changes: { Quantity: 60, ShippedQuantity: 60 } },
    { kind: "update", tab: SHEET_TABS.ORDER_ITEMS, rowNumber: i40.rowNumber, changes: { Grade: "70" } },
    {
      kind: "update",
      tab: SHEET_TABS.SHIPMENTS,
      rowNumber: s40.rowNumber,
      changes: { BatchID: BATCH_70, Notes: `${note}: было Jumilia 40 из ${s40.record.BatchID}` },
    },
    {
      kind: "append",
      tab: SHEET_TABS.SHIPMENTS,
      records: [
        {
          ShipmentID: generateId("SHIP"),
          CreatedAt: s50.record.CreatedAt,
          OrderID: ORDER,
          ItemID: ITEM_50,
          BatchID: BATCH_50,
          Quantity: 15,
          WarehouseEmail: s50.record.WarehouseEmail,
          Notes: `${note}: Jumilia 50 — 60 шт. вместо 45`,
        },
      ],
    },
    { kind: "update", tab: SHEET_TABS.BATCHES, rowNumber: bFix.rowNumber, changes: { Variety: "Avalanche" } },
    { kind: "update", tab: SHEET_TABS.STAFF_TAKEOUTS, rowNumber: tk.rowNumber, changes: { UnitPrice: 120 } },
  ];

  console.log("Будет сделано:");
  console.log(`  1) ${ORDER}: Jumilia 50 — 45 → 60 шт. (отгружено 60); Jumilia 40 (45 шт.) → Jumilia 70 (45 шт.)`);
  console.log(`     журнал: ${SHIP_40} → партия ${BATCH_70}; + 15 шт. Jumilia 50 из ${BATCH_50} за 14.09`);
  console.log(`  2) ${BATCH_FIX}: Peach Avalanche 40 → Avalanche 40 (${bFix.record.QuantityRemaining}/${bFix.record.QuantityIn} шт.)`);
  console.log(`  3) ${TAKEOUT}: 90 × 320 = 28 800 → 90 × 120 = 10 800 ₸`);
  if (!APPLY) {
    console.log("\nЭто показ. Записать: --yes");
    return;
  }

  console.log("\nДелаю копию всей таблицы — до минуты, не закрывайте окно.");
  const backup = await createBackup(new Date(), (m) => console.log(m));
  console.log(`Копия: «${backup.title}» — ${backup.url}`);

  await commitAtomic(ops);
  await logMoney({
    actorEmail: OWNER,
    orderId: ORDER,
    action: MONEY_LOG_ACTIONS.ORDER_EDITED,
    details: "Jumilia 50: 45 → 60 шт.; Jumilia 40 (45 шт.) заменена на Jumilia 70 (45 шт.) — по просьбе склада, заявка уже отгружена",
    amountBefore: 0,
    amountAfter: 0,
  });

  const after = [
    await find(SHEET_TABS.ORDER_ITEMS, "ItemID", ITEM_50),
    await find(SHEET_TABS.ORDER_ITEMS, "ItemID", ITEM_40),
  ];
  for (const a of after) console.log(`  ${a.record.ItemID}: ${a.record.Variety} ${a.record.Grade} · ${a.record.Quantity} · отгр ${a.record.ShippedQuantity}`);
  const b = await find(SHEET_TABS.BATCHES, "BatchID", BATCH_FIX);
  console.log(`  ${BATCH_FIX}: ${b.record.Variety} ${b.record.Grade}`);
  const t = await find(SHEET_TABS.STAFF_TAKEOUTS, "TakeoutID", TAKEOUT);
  console.log(`  ${TAKEOUT}: цена ${t.record.UnitPrice}`);
  console.log("ГОТОВО");
}
main().catch((e) => {
  console.error("ОШИБКА:", e.message);
  process.exit(1);
});
