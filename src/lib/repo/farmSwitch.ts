import { commitAtomic, readTable, rowToRecord, SHEET_TABS, type WriteOp } from "../sheets";
import { sheetNumber } from "../sheetCell";
import { generateId } from "../id";
import { MONEY_LOG_ACTIONS } from "../constants";
import { planFarmSwitch, type FarmSwitchPlan } from "../farmSwitch";
import { isOpenKaspiStatus } from "../kaspiInvoice";
import { listKaspiInvoices } from "./kaspiInvoices";
import { toOrder, toOrderItem } from "./orders";

/**
 * Запись смены склада хризантемы (правила — `src/lib/farmSwitch.ts`). Всё читается СВЕЖИМ и пишется ОДНИМ атомарным
 * запросом (грабли 1.15, 1.16): цветок позиций, «получено» по компаниям, строки журнала платежей и след в журнале
 * денег. Половина перевода — позиция уже у Rose Farm, а деньги за неё числятся за Есентаем — это неверный счёт.
 */
export async function commitFarmSwitch(input: {
  orderId: string;
  itemIds: string[];
  actor: { email: string; role: string | null | undefined; farm: string | null | undefined };
}): Promise<{ plan: FarmSwitchPlan; total: number }> {
  const [orderTable, itemTable, payTable, invoices] = await Promise.all([
    readTable(SHEET_TABS.ORDERS, { fresh: true }),
    readTable(SHEET_TABS.ORDER_ITEMS, { fresh: true }),
    readTable(SHEET_TABS.PAYMENTS, { fresh: true }),
    listKaspiInvoices({ fresh: true }),
  ]);
  const orderIndex = orderTable.rows.findIndex((row) => rowToRecord(SHEET_TABS.ORDERS, row).OrderID === input.orderId);
  if (orderIndex < 0) throw new Error("Заявка не найдена");
  const head = toOrder(rowToRecord(SHEET_TABS.ORDERS, orderTable.rows[orderIndex]));
  const itemRows = itemTable.rows
    .map((row, i) => ({ record: rowToRecord(SHEET_TABS.ORDER_ITEMS, row), rowNumber: itemTable.rowNumbers[i] }))
    .filter((r) => r.record.OrderID === input.orderId);
  const payRows = payTable.rows
    .map((row, i) => ({ record: rowToRecord(SHEET_TABS.PAYMENTS, row), rowNumber: payTable.rowNumbers[i] }))
    .filter((r) => r.record.OrderID === input.orderId);

  const items = itemRows.map((r) => toOrderItem(r.record));
  const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  // Как в списке заявок: у старой заявки стоит только отметка «оплачено», без суммы — тогда получено всё.
  const paidAmount = head.paidAmount > 0 ? head.paidAmount : head.paid ? total : 0;

  const plan = planFarmSwitch({
    order: { ...head, paidAmount, items },
    itemIds: input.itemIds,
    role: input.actor.role,
    farm: input.actor.farm,
    ledger: payRows.map((r) => ({ paymentId: r.record.PaymentID, amount: sheetNumber(r.record.Amount), farm: r.record.Farm || "", flowerType: r.record.Flower || "" })),
    openInvoiceFarms: invoices.filter((k) => k.orderId === input.orderId && isOpenKaspiStatus(k.status)).map((k) => k.farm),
  });
  if (typeof plan === "string") throw new Error(plan);

  const ops: WriteOp[] = [];
  const moving = new Set(plan.itemIds);
  for (const r of itemRows) {
    if (moving.has(r.record.ItemID)) ops.push({ kind: "update", tab: SHEET_TABS.ORDER_ITEMS, rowNumber: r.rowNumber, changes: { FlowerType: plan.toFlower } });
  }
  if (plan.paid) {
    ops.push({
      kind: "update",
      tab: SHEET_TABS.ORDERS,
      rowNumber: orderTable.rowNumbers[orderIndex],
      changes: { PaidRoseFarm: plan.paid.roseFarm, PaidEsentai: plan.paid.esentai },
    });
  }
  const payById = new Map(payRows.map((r) => [r.record.PaymentID, r]));
  for (const u of plan.paymentUpdates) {
    const row = payById.get(u.paymentId);
    if (!row) continue;
    ops.push({
      kind: "update",
      tab: SHEET_TABS.PAYMENTS,
      rowNumber: row.rowNumber,
      changes: {
        ...(u.amount !== undefined ? { Amount: u.amount } : {}),
        ...(u.farm !== undefined ? { Farm: u.farm } : {}),
        ...(u.flowerType !== undefined ? { Flower: u.flowerType } : {}),
      },
    });
  }
  const splits = plan.paymentSplits.flatMap((s) => {
    const from = payById.get(s.fromPaymentId)?.record;
    if (!from) return [];
    return [
      {
        PaymentID: generateId("PAY"),
        CreatedAt: from.CreatedAt,
        OrderID: from.OrderID,
        Date: from.Date,
        Amount: s.amount,
        Farm: s.farm,
        Method: from.Method,
        AccountantEmail: from.AccountantEmail,
        Note: `${from.Note}${from.Note ? " · " : ""}часть платежа ${from.PaymentID}: склад отгрузки сменили`.slice(0, 200),
        Flower: s.flowerType,
      },
    ];
  });
  if (splits.length) ops.push({ kind: "append", tab: SHEET_TABS.PAYMENTS, records: splits });
  ops.push({
    kind: "append",
    tab: SHEET_TABS.MONEY_LOG,
    records: [
      {
        LogID: generateId("LOG"),
        CreatedAt: new Date().toISOString(),
        ActorEmail: input.actor.email,
        OrderID: input.orderId,
        Action: MONEY_LOG_ACTIONS.ORDER_EDITED,
        Details: plan.describe,
        AmountBefore: total,
        AmountAfter: total,
      },
    ],
  });
  await commitAtomic(ops);
  return { plan, total };
}
