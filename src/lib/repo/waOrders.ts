import { appendRow, readTable, rowToRecord, SHEET_TABS, updateWhere } from "../sheets";
import { generateId } from "../id";
import { toIsoDate, toIsoDateTime } from "../sheetDate";
import { DRAFT_STATUSES, type WaOrderDraft, type WaOrderItem } from "../waOrder";

/**
 * Черновики заявок из WhatsApp (вкладка `WaOrderDrafts`). Правила — `src/lib/waOrder.ts`.
 * Чтение в try/catch: пока вкладки нет (`npm run setup-sheet`), блок просто пуст.
 */

function items(json: string): WaOrderItem[] {
  try {
    const arr = JSON.parse(json || "[]");
    return Array.isArray(arr)
      ? arr
          .map((x) => ({
            flowerType: String(x?.flowerType || ""),
            variety: String(x?.variety || ""),
            grade: String(x?.grade || ""),
            quantity: Math.round(Number(x?.quantity) || 0),
          }))
          .filter((x) => x.flowerType && x.quantity > 0)
      : [];
  } catch {
    return [];
  }
}

export async function listWaOrderDrafts(options: { fresh?: boolean } = {}): Promise<WaOrderDraft[]> {
  try {
    const t = await readTable(SHEET_TABS.WA_ORDER_DRAFTS, options);
    return t.rows
      .map((row) => rowToRecord(SHEET_TABS.WA_ORDER_DRAFTS, row))
      .map((r) => ({
        draftId: r.DraftID || "",
        createdAt: toIsoDateTime(r.CreatedAt) || r.CreatedAt || "",
        phone: String(r.Phone || "").replace(/\D/g, ""),
        senderName: r.SenderName || "",
        messageId: r.MessageID || "",
        text: r.Text || "",
        items: items(r.ItemsJSON),
        deliveryDate: toIsoDate(r.DeliveryDate),
        note: r.Note || "",
        status: r.Status || DRAFT_STATUSES.NEW,
        orderId: r.OrderID || "",
        handledByEmail: (r.HandledByEmail || "").toLowerCase(),
        handledAt: toIsoDateTime(r.HandledAt) || "",
      }))
      .filter((d) => d.draftId)
      // Green API иногда повторяет уведомление — один заказ, один черновик.
      .filter((d, i, all) => !d.messageId || all.findIndex((x) => x.messageId === d.messageId) === i);
  } catch {
    return [];
  }
}

export async function appendWaOrderDraft(
  input: Pick<WaOrderDraft, "phone" | "senderName" | "messageId" | "text" | "items" | "deliveryDate" | "note">
): Promise<string> {
  const id = generateId("WAO");
  await appendRow(SHEET_TABS.WA_ORDER_DRAFTS, {
    DraftID: id,
    CreatedAt: new Date().toISOString(),
    Phone: input.phone,
    SenderName: input.senderName.slice(0, 80),
    MessageID: input.messageId,
    Text: input.text.slice(0, 1500),
    ItemsJSON: JSON.stringify(input.items),
    DeliveryDate: input.deliveryDate,
    Note: input.note,
    Status: DRAFT_STATUSES.NEW,
    OrderID: "",
    HandledByEmail: "",
    HandledAt: "",
  });
  return id;
}

/** Черновик разобран: оформлен в заявку или скрыт. Только из «нового» — второй раз не трогаем. */
export async function closeWaOrderDraft(draftId: string, status: "done" | "dismissed", email: string, orderId = ""): Promise<boolean> {
  const n = await updateWhere(
    SHEET_TABS.WA_ORDER_DRAFTS,
    (r) => r.DraftID === draftId && (r.Status || DRAFT_STATUSES.NEW) === DRAFT_STATUSES.NEW,
    () => ({ Status: status, OrderID: orderId, HandledByEmail: email, HandledAt: new Date().toISOString() })
  );
  return Boolean(n);
}
