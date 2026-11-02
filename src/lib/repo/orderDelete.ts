import { commitAtomic, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../sheets";
import { normalizeStore, regionStoreForCity } from "../officeStore";
import { cleanOrderKind } from "../orderKind";
import { ORDER_KINDS } from "../constants";

/**
 * Удаляет заявку вместе со всем, что на ней висит, ОДНИМ атомарным запросом
 * (грабли 1.16): строка заявки, позиции, платежи, рекламации и — по выбору —
 * отгрузки. Правила «можно ли» — `adminDeleteRefusal` в `src/lib/orderDelete.ts`.
 *
 * `stock = "return"`: строки отгрузок удаляются, а стебли возвращаются в те же
 * партии (не больше, чем в партию когда-то приняли). `"keep"` (или отгрузок не
 * было): строки отгрузок остаются с пометкой — иначе партии опустели бы без
 * следа.
 */
export async function deleteOrderFully(
  orderId: string,
  stock: "return" | "keep" | "" = ""
): Promise<{ orders: number; items: number; payments: number; claims: number; shipments: number; returned: number }> {
  const [orders, items, payments, claims, shipments, batches] = await Promise.all(
    [SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.PAYMENTS, SHEET_TABS.CLAIMS, SHEET_TABS.SHIPMENTS, SHEET_TABS.BATCHES].map(
      (tab) => readTable(tab, { fresh: true }).catch(() => ({ headers: [], rows: [] as string[][], rowNumbers: [] as number[] }))
    )
  );
  const rowsOf = (table: { rows: string[][]; rowNumbers: number[] }, tab: string) =>
    table.rows
      .map((row, i) => ({ record: rowToRecord(tab, row), rowNumber: table.rowNumbers[i] }))
      .filter((r) => r.record.OrderID === orderId);

  const orderRows = rowsOf(orders, SHEET_TABS.ORDERS);
  if (orderRows.length === 0) throw new Error("Заявка не найдена — возможно, её уже удалили");
  const itemRows = rowsOf(items, SHEET_TABS.ORDER_ITEMS);
  const paymentRows = rowsOf(payments, SHEET_TABS.PAYMENTS);
  const claimRows = rowsOf(claims, SHEET_TABS.CLAIMS);
  const shipmentRows = rowsOf(shipments, SHEET_TABS.SHIPMENTS);

  const ops: WriteOp[] = [
    { kind: "delete", tab: SHEET_TABS.ORDERS, rowNumbers: orderRows.map((r) => r.rowNumber) },
    { kind: "delete", tab: SHEET_TABS.ORDER_ITEMS, rowNumbers: itemRows.map((r) => r.rowNumber) },
    { kind: "delete", tab: SHEET_TABS.PAYMENTS, rowNumbers: paymentRows.map((r) => r.rowNumber) },
    { kind: "delete", tab: SHEET_TABS.CLAIMS, rowNumbers: claimRows.map((r) => r.rowNumber) },
  ];

  let returned = 0;
  if (shipmentRows.length > 0 && stock === "return") {
    const byBatch = new Map<string, number>();
    for (const s of shipmentRows) byBatch.set(s.record.BatchID, (byBatch.get(s.record.BatchID) ?? 0) + (Number(s.record.Quantity) || 0));
    batches.rows.forEach((row, i) => {
      const b = rowToRecord(SHEET_TABS.BATCHES, row);
      const back = byBatch.get(b.BatchID) ?? 0;
      if (back <= 0) return;
      const remaining = Number(b.QuantityRemaining) || 0;
      const total = Number(b.QuantityIn) || 0;
      const next = total > 0 ? Math.min(total, remaining + back) : remaining + back;
      returned += next - remaining;
      ops.push({ kind: "update", tab: SHEET_TABS.BATCHES, rowNumber: batches.rowNumbers[i], changes: { QuantityRemaining: next } });
    });
    // «Объём на город» в регион со складом (Астана): отгруженное тогда пришло на склад региона — вернули на основной,
    // значит с регионального снимаем столько же (сколько там ещё лежит), иначе стебли задвоились бы.
    const order = orderRows[0].record;
    const region = cleanOrderKind(order.Kind) === ORDER_KINDS.REGION ? regionStoreForCity(order.Direction) : "";
    if (region) {
      batches.rows.forEach((row, i) => {
        const b = rowToRecord(SHEET_TABS.BATCHES, row);
        if (normalizeStore(b.Store) !== region) return;
        const back = byBatch.get((b.SourceBatchID || "").trim()) ?? 0;
        if (back <= 0) return;
        const remaining = Number(b.QuantityRemaining) || 0;
        const take = Math.min(remaining, back);
        if (take > 0) ops.push({ kind: "update", tab: SHEET_TABS.BATCHES, rowNumber: batches.rowNumbers[i], changes: { QuantityRemaining: remaining - take } });
      });
    }
    ops.push({ kind: "delete", tab: SHEET_TABS.SHIPMENTS, rowNumbers: shipmentRows.map((r) => r.rowNumber) });
  } else {
    for (const s of shipmentRows) {
      const note = (s.record.Notes || "").trim();
      if (note.includes("заявка удалена")) continue;
      ops.push({
        kind: "update",
        tab: SHEET_TABS.SHIPMENTS,
        rowNumber: s.rowNumber,
        changes: { Notes: note ? `${note} · заявка удалена` : "заявка удалена" },
      });
    }
  }

  await commitAtomic(ops.filter((op) => op.kind !== "delete" || op.rowNumbers.length > 0));
  return {
    orders: orderRows.length,
    items: itemRows.length,
    payments: paymentRows.length,
    claims: claimRows.length,
    shipments: shipmentRows.length,
    returned,
  };
}
