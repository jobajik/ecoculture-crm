/**
 * Подсклад «Офис» (`src/lib/officeStore.ts`): кто что отгружает, склад бота по
 * часу, перемещение туда и обратно, смена склада заявки.
 *
 *   npx tsx scripts/check-office.ts
 */
import {
  batchStoreRefusal,
  botStoreFor,
  botOrderStore,
  botStoreNote,
  canChooseOrderStore,
  canMoveStock,
  canSeeOffice,
  inStore,
  moveWrites,
  normalizeStore,
  planStockMove,
  shipStoreRefusal,
  storeChangeRefusal,
  storeOfRole,
  stockStoreOfRole,
  type MoveBatchRow,
} from "../src/lib/officeStore";
import { canOpen } from "../src/lib/access";
import { getPicklist } from "../src/lib/picklist";
import { getStockSnapshot } from "../src/lib/stock";
import type { Batch } from "../src/lib/types";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${ok ? "" : `: получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`}`);
}

async function main() {
  console.log("Склад и роли");
  check("значение склада", ["office", "OFFICE ", "", "склад", null].map(normalizeStore), ["office", "office", "", "", ""]);
  check("чей склад", ["office", "warehouse", "admin", "manager"].map(storeOfRole), ["office", "", "any", null]);
  check("на главной склад видит своё, остальные — всё", ["office", "warehouse", "admin", "sales_head"].map(stockStoreOfRole), ["office", "", undefined, undefined]);
  check("перемещает РОП и админ", ["sales_head", "admin", "office", "warehouse", "manager"].map(canMoveStock), [true, true, false, false, false]);
  check("раздел «Офис» видят", ["office", "sales_head", "admin", "warehouse", "manager"].map(canSeeOffice), [true, true, true, false, false]);
  check("склад в заявке выбирают", ["manager", "sales_head", "admin", "retail_almaty", "warehouse"].map(canChooseOrderStore), [true, true, true, false, false]);
  check("адреса: склад офиса — офис и страница отгрузки, не основной склад", [
    canOpen("office", "/office"),
    canOpen("office", "/warehouse/ship/ORD-1"),
    canOpen("office", "/warehouse"),
    canOpen("office", "/warehouse/batches"),
    canOpen("sales_head", "/office"),
    canOpen("manager", "/office"),
    canOpen("warehouse", "/office"),
  ], [true, true, false, false, true, false, false]);

  console.log("\nОтгрузка");
  check("склад основной заявки отгружает", shipStoreRefusal("warehouse", ""), "");
  check("склад офисную — нет", shipStoreRefusal("warehouse", "office") !== "", true);
  check("склад офиса офисную — да", shipStoreRefusal("office", "office"), "");
  check("склад офиса основную — нет", shipStoreRefusal("office", "") !== "", true);
  check("админ — любую", [shipStoreRefusal("admin", ""), shipStoreRefusal("admin", "office")], ["", ""]);
  check("менеджер не отгружает", shipStoreRefusal("manager", "") !== "", true);
  check("партия того же склада", [batchStoreRefusal("office", "office"), batchStoreRefusal("", "")], ["", ""]);
  check("партия чужого склада — отказ", [batchStoreRefusal("", "office") !== "", batchStoreRefusal("office", "") !== ""], [true, true]);

  console.log("\nБот: склад по часу");
  check("до 12:00 — основной", botStoreFor(11, true), "");
  check("с 12:00 — офис", botStoreFor(12, true), "office");
  check("после 12, офис пуст — основной (на завтра)", botStoreFor(15, false), "");
  check("подсказка модели: после 12 — сегодня из офиса, такси", botStoreNote(true, 14).includes("такси"), true);
  check("подсказка: офис пуст после 12 — на завтра", botStoreNote(false, 14).includes("на завтра"), true);
  check("подсказка: утром — ничего", botStoreNote(false, 9), "");
  const T = "2026-10-02";
  check("заказ после 12 на сегодня — офис", botOrderStore({ almatyHour: 14, deliveryDate: T, today: T, officeHasStock: true }), "office");
  check("заказ после 12 на завтра — основной", botOrderStore({ almatyHour: 14, deliveryDate: "2026-10-03", today: T, officeHasStock: true }), "");
  check("заказ до 12 на сегодня — основной", botOrderStore({ almatyHour: 11, deliveryDate: T, today: T, officeHasStock: true }), "");
  check("после 12, офис пуст — основной", botOrderStore({ almatyHour: 14, deliveryDate: T, today: T, officeHasStock: false }), "");

  console.log("\nПеремещение");
  const row = (p: Partial<MoveBatchRow> & { batchId: string }): MoveBatchRow => ({
    rowNumber: 0,
    receivedAt: "2026-10-01T05:00:00Z",
    harvestDate: "2026-10-01",
    flowerType: "chrysanthemum",
    variety: "Altaj",
    grade: "Вторая",
    quantityRemaining: 0,
    store: "",
    sourceBatchId: "",
    ...p,
  });
  const rows = [
    row({ rowNumber: 2, batchId: "M1", harvestDate: "2026-09-29", quantityRemaining: 100 }),
    row({ rowNumber: 3, batchId: "M2", harvestDate: "2026-09-30", quantityRemaining: 300 }),
    row({ rowNumber: 4, batchId: "O1", store: "office", sourceBatchId: "M1", quantityRemaining: 20 }),
    row({ rowNumber: 5, batchId: "R1", flowerType: "rose", variety: "Jumilia", grade: "60", quantityRemaining: 500 }),
  ];
  const line = { flowerType: "chrysanthemum", variety: "Altaj", grade: "Вторая", quantity: 150 };
  const plan = planStockMove([line], inStore(rows, ""));
  check("в офис: со старых срезок", plan.byLine[0].map((b) => [b.batchId, b.quantity]), [["M1", 100], ["M2", 50]]);
  check("больше, чем на складе — ничего", planStockMove([{ ...line, quantity: 401 }], inStore(rows, "")).parts, []);
  check("офисные стебли в «основной» раскладке не участвуют", planStockMove([{ ...line, quantity: 401 }], inStore(rows, "")).errors[0], "на складе только 400 шт.");
  let n = 0;
  const w = moveWrites({ direction: "to_office", parts: plan.parts, rows, byEmail: "rop@x", newId: () => `NEW${++n}` });
  check("в офис: без ошибок", w.error, "");
  check(
    "в офис: основные убыли, офисная от M1 выросла, от M2 — новая",
    w.updates.map((u) => [u.rowNumber, u.quantityRemaining]),
    [[2, 0], [3, 250], [4, 120]]
  );
  check(
    "новая офисная партия: приход 0, срезка и источник те же",
    w.appends.map((a) => [a.BatchID, a.QuantityIn, a.QuantityRemaining, a.HarvestDate, a.Store, a.SourceBatchID]),
    [["NEW1", 0, 50, "2026-09-30", "office", "M2"]]
  );
  check("журнал: по строке на партию", w.moves.map((m) => [m.fromBatchId, m.toBatchId, m.quantity]), [["M1", "O1", 100], ["M2", "NEW1", 50]]);
  const totalBefore = rows.reduce((s, r) => s + r.quantityRemaining, 0);
  const after = new Map(rows.map((r) => [r.rowNumber, r.quantityRemaining]));
  for (const u of w.updates) after.set(u.rowNumber, u.quantityRemaining);
  const totalAfter = Array.from(after.values()).reduce((s, q) => s + q, 0) + w.appends.reduce((s, a) => s + Number(a.QuantityRemaining), 0);
  check("стеблей всего столько же — перемещение не приход", totalAfter, totalBefore);

  const back = moveWrites({ direction: "to_main", parts: [{ batchId: "O1", quantity: 15 }], rows, byEmail: "rop@x", newId: () => "X" });
  check("обратно: в ту же основную партию", back.updates.map((u) => [u.rowNumber, u.quantityRemaining]), [[2, 115], [4, 5]]);
  check("обратно больше, чем в офисе — отказ", moveWrites({ direction: "to_main", parts: [{ batchId: "O1", quantity: 21 }], rows, byEmail: "", newId: () => "X" }).error !== "", true);
  check("в офис из офисной партии — отказ", moveWrites({ direction: "to_office", parts: [{ batchId: "O1", quantity: 1 }], rows, byEmail: "", newId: () => "X" }).error !== "", true);
  check(
    "обратно без основной партии — отказ, ничего не пишем",
    moveWrites({ direction: "to_main", parts: [{ batchId: "O9", quantity: 1 }], rows: [...rows, row({ rowNumber: 9, batchId: "O9", store: "office", sourceBatchId: "GONE", quantityRemaining: 5 })], byEmail: "", newId: () => "X" }),
    { updates: [], appends: [], moves: [], error: "не нашлась основная партия, из которой пришла O9" }
  );

  console.log("\nСклад заявки");
  const order = { status: "new", kind: "", retail: "", store: "", items: [{ shippedQuantity: 0 }] };
  check("менеджер своей — можно", storeChangeRefusal({ role: "manager", isOwner: true, order, to: "office" }), "");
  check("менеджер чужой — нет", storeChangeRefusal({ role: "manager", isOwner: false, order, to: "office" }) !== "", true);
  check("склад офиса отдаёт на основной", storeChangeRefusal({ role: "office", isOwner: false, order: { ...order, store: "office" }, to: "" }), "");
  check("склад офиса не забирает себе основную", storeChangeRefusal({ role: "office", isOwner: false, order, to: "office" }) !== "", true);
  check("зав. складом — нет", storeChangeRefusal({ role: "warehouse", isOwner: false, order, to: "office" }) !== "", true);
  check("после отгрузки — нет", storeChangeRefusal({ role: "admin", isOwner: false, order: { ...order, items: [{ shippedQuantity: 5 }] }, to: "office" }) !== "", true);
  check("наш магазин и объём на город — нет", [
    storeChangeRefusal({ role: "admin", isOwner: false, order: { ...order, retail: "almaty" }, to: "office" }) !== "",
    storeChangeRefusal({ role: "admin", isOwner: false, order: { ...order, kind: "region" }, to: "office" }) !== "",
  ], [true, true]);

  console.log("\nСклад и лист сборки делят партии");
  const b = (id: string, qty: number, store = ""): Batch => ({
    batchId: id, receivedAt: "2026-10-01", harvestDate: "2026-10-01", flowerType: "rose", variety: "Jumilia", grade: "60",
    quantityIn: store ? 0 : qty, quantityRemaining: qty, location: "", receivedByEmail: "", store, sourceBatchId: store ? "B1" : "",
  });
  const settings = { shelfLifeDays: { rose: 7, chrysanthemum: 18, eustoma: 10 }, warningThreshold: 0.7 };
  const batches = [b("B1", 300), b("O1", 200, "office")];
  const now = new Date("2026-10-02T06:00:00Z");
  const all = await getStockSnapshot(now, { batches, settings: settings as never }, null);
  const main = await getStockSnapshot(now, { batches, settings: settings as never }, null, { store: "" });
  const office = await getStockSnapshot(now, { batches, settings: settings as never }, null, { store: "office" });
  check("остаток: всё / основной / офис", [all.totalStems, main.totalStems, office.totalStems], [500, 300, 200]);
  const mk = (id: string, store: string) => ({
    orderId: id, createdAt: "2026-10-02T04:00:00Z", managerEmail: "m@x", clientName: "К", clientPhone: "", deliveryDate: "2026-10-02",
    status: "new", notes: "", store, items: [{ itemId: `${id}-1`, flowerType: "rose", variety: "Jumilia", grade: "60", quantity: 10, unitPrice: 200, shippedQuantity: 0 }],
  });
  const pick = await getPicklist("2026-10-02", now, { orders: [mk("A", ""), mk("B", "office")] as never, batches, users: [] });
  check("лист сборки основного склада — без заявок офиса", JSON.stringify(pick).includes('"B"'), false);
  check("…а основная заявка в нём есть", JSON.stringify(pick).includes('"A"'), true);

  console.log(failed === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
