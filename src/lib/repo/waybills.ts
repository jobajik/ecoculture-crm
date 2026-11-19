import { sheetNumber } from "../sheetCell";
import { commitAtomic, readTable, rowToRecord, updateWhere, SHEET_TABS } from "../sheets";
import { toIsoDateTime } from "../sheetDate";
import { generateId } from "../id";
import { parseWaybillStatus, type WaybillDoc, type WaybillRow, type WaybillStatus } from "../waybill";

/**
 * Накладные клиентам — чтение и запись вкладки `Waybills` (правила — `src/lib/waybill.ts`).
 * Строка заводится ДО отправки (статус «отправляется») и держит за собой строки журнала отгрузок: вторая накладная на
 * ту же отгрузку не соберётся, даже если отправка не удалась, — её повторяют кнопкой на заявке.
 */

function parseDoc(raw: string): WaybillDoc | null {
  try {
    const d = JSON.parse(raw || "") as WaybillDoc;
    if (!d || typeof d !== "object" || !Array.isArray(d.lines)) return null;
    return {
      number: String(d.number || ""),
      orderCode: String(d.orderCode || ""),
      date: String(d.date || ""),
      client: String(d.client || ""),
      city: String(d.city || ""),
      manager: String(d.manager || ""),
      deliveryDate: String(d.deliveryDate || ""),
      shippedBy: String(d.shippedBy || ""),
      lines: d.lines.map((l) => ({ farm: String(l.farm || ""), name: String(l.name || ""), quantity: Number(l.quantity) || 0, price: Number(l.price) || 0, amount: Number(l.amount) || 0 })),
      stems: Number(d.stems) || 0,
      amount: Number(d.amount) || 0,
      restStems: Number(d.restStems) || 0,
    };
  } catch {
    return null;
  }
}

function toWaybill(r: Record<string, string>): WaybillRow {
  const doc = parseDoc(r.Doc || "");
  return {
    waybillId: r.WaybillID || "",
    createdAt: toIsoDateTime(r.CreatedAt) || r.CreatedAt || "",
    orderId: r.OrderID || "",
    // Номер из одних цифр таблица хранит числом и может вернуть «12 345» — верим снимку.
    number: doc?.number || (r.Number || "").trim(),
    shipmentIds: (r.ShipmentIDs || "").split(",").map((x) => x.trim()).filter(Boolean),
    doc,
    stems: sheetNumber(r.Stems),
    amount: sheetNumber(r.Amount),
    phone: (r.Phone || "").replace(/\D/g, ""),
    line: (r.Line || "").trim(),
    status: parseWaybillStatus(r.Status),
    note: r.Note || "",
    messageId: r.MessageID || "",
    byEmail: (r.ByEmail || "").toLowerCase(),
    sentAt: toIsoDateTime(r.SentAt) || r.SentAt || "",
  };
}

/** Все накладные. Вкладки ещё нет (до `setup-sheet`) или сбой — пусто: страница заявки просто не покажет блок. */
export async function listWaybills(options: { fresh?: boolean } = {}): Promise<WaybillRow[]> {
  try {
    const table = await readTable(SHEET_TABS.WAYBILLS, options.fresh ? { fresh: true } : undefined);
    return table.rows.map((row) => toWaybill(rowToRecord(SHEET_TABS.WAYBILLS, row))).filter((w) => w.waybillId);
  } catch {
    return [];
  }
}

/** То же, но сбой чтения — ошибка: перед записью «нет накладных» и «не смогли прочитать» путать нельзя (грабли 1.14). */
export async function listWaybillsStrict(): Promise<WaybillRow[]> {
  const table = await readTable(SHEET_TABS.WAYBILLS, { fresh: true });
  return table.rows.map((row) => toWaybill(rowToRecord(SHEET_TABS.WAYBILLS, row))).filter((w) => w.waybillId);
}

export async function getWaybill(waybillId: string): Promise<WaybillRow | null> {
  return (await listWaybills()).find((w) => w.waybillId === waybillId) ?? null;
}

export async function createWaybill(input: { orderId: string; shipmentIds: string[]; doc: WaybillDoc; phone: string; status: WaybillStatus; note: string; byEmail: string }): Promise<WaybillRow> {
  const row: WaybillRow = {
    waybillId: generateId("WB"),
    createdAt: new Date().toISOString(),
    orderId: input.orderId,
    number: input.doc.number,
    shipmentIds: input.shipmentIds,
    doc: input.doc,
    stems: input.doc.stems,
    amount: input.doc.amount,
    phone: input.phone,
    line: "",
    status: input.status,
    note: input.note,
    messageId: "",
    byEmail: input.byEmail,
    sentAt: "",
  };
  await commitAtomic([
    {
      kind: "append",
      tab: SHEET_TABS.WAYBILLS,
      records: [
        {
          WaybillID: row.waybillId,
          CreatedAt: row.createdAt,
          OrderID: row.orderId,
          Number: row.number,
          ShipmentIDs: row.shipmentIds.join(","),
          Doc: JSON.stringify(row.doc),
          Stems: row.stems,
          Amount: row.amount,
          Phone: row.phone,
          Line: "",
          Status: row.status,
          Note: row.note,
          MessageID: "",
          ByEmail: row.byEmail,
          SentAt: "",
        },
      ],
    },
  ]);
  return row;
}

export async function updateWaybill(waybillId: string, changes: Partial<Record<"Status" | "Note" | "MessageID" | "Line" | "SentAt" | "Phone" | "ByEmail", string>>): Promise<boolean> {
  return updateWhere(
    SHEET_TABS.WAYBILLS,
    (r) => r.WaybillID === waybillId,
    () => changes
  );
}
