import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Правка позиций заявок по просьбе склада/владельца — из файла JSON (русские
 * слова из .bat портятся кодировкой). Правила — администраторские, как у
 * кнопки «Изменить» (editItemsRefusal / editedItemsRefusal): отгруженное не
 * уменьшается и не удаляется. Оплаченной заявке флаг «оплачено» и долг
 * пересчитываются от новой суммы (переплата видна бухгалтеру), подтверждение
 * менеджера НЕ снимается — правка по факту склада, как у зав. складом.
 *
 * Файл: { "reason": "…", "orders": [ { "orderId": "ORD-…", "items": [
 *          { "itemId": "ORD-…-I1", "quantity": 70, "variety": "…", "grade": "…" } ] } ] }
 *
 *   npx tsx scripts/edit-order-json.ts <файл> [--yes]
 */
import { readFileSync } from "node:fs";
import {
  getOrderById,
  recomputeOrderStatusFromItems,
  saveOrderItems,
  setOrderPaidTotals,
} from "../src/lib/repo/orders";
import { logMoney } from "../src/lib/repo/moneyLog";
import { describeItemChanges, editItemsRefusal, editedItemsRefusal } from "../src/lib/orderEdit";
import { MONEY_EPSILON, MONEY_LOG_ACTIONS, gradeForVariety } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";
const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

type Patch = { itemId: string; quantity?: number; variety?: string; grade?: string; unitPrice?: number };

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const apply = process.argv.includes("--yes");
  if (!file) throw new Error("Укажите файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { reason?: string; orders: { orderId: string; items: Patch[] }[] };
  const reason = (spec.reason || "правка по факту склада").trim();

  for (const o of spec.orders) {
    const order = await getOrderById(o.orderId);
    console.log(`\n${o.orderId}`);
    if (!order) {
      console.log("  заявки нет — пропускаю");
      continue;
    }
    console.log(`  ${order.clientName} · ${money(order.totalAmount)} · получено ${money(order.paidAmount)} · ${order.status}`);
    const refusal = editItemsRefusal(order, "admin", OWNER);
    if (refusal) {
      console.log(`  нельзя: ${refusal}`);
      continue;
    }
    const byId = new Map(o.items.map((p) => [p.itemId, p]));
    const unknown = o.items.filter((p) => !order.items.some((i) => i.itemId === p.itemId));
    if (unknown.length) {
      console.log(`  нет таких позиций: ${unknown.map((p) => p.itemId).join(", ")} — пропускаю заявку`);
      continue;
    }
    const next = order.items.map((i) => {
      const p = byId.get(i.itemId);
      const variety = (p?.variety ?? i.variety).trim();
      return {
        itemId: i.itemId,
        flowerType: i.flowerType,
        variety,
        grade: gradeForVariety(i.flowerType, variety, (p?.grade ?? i.grade).trim()),
        quantity: Math.round(p?.quantity ?? i.quantity),
        unitPrice: p?.unitPrice ?? i.unitPrice,
      };
    });
    const itemsRefusal = editedItemsRefusal({ current: order.items, next, region: false });
    if (itemsRefusal) {
      console.log(`  нельзя: ${itemsRefusal}`);
      continue;
    }
    const changes = describeItemChanges({ current: order.items, next, region: false });
    const newTotal = next.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    for (const c of changes) console.log(`  ${c}`);
    console.log(`  сумма: ${money(order.totalAmount)} → ${money(newTotal)}${order.paidAmount - newTotal > MONEY_EPSILON ? ` · переплата ${money(order.paidAmount - newTotal)}` : ""}`);
    if (!apply || changes.length === 0) continue;

    await saveOrderItems(order.orderId, next.map((i) => ({ ...i, flowerType: i.flowerType as "rose" })));
    const fresh = await getOrderById(order.orderId);
    if (fresh && order.paidAmount > MONEY_EPSILON) {
      await setOrderPaidTotals(order.orderId, {
        amount: order.paidAmount,
        totalAmount: fresh.totalAmount,
        accountantEmail: order.accountantEmail || OWNER,
        paymentMethod: "",
        byField: {},
        paidAt: order.paidAt,
      });
    }
    if (order.items.some((i) => i.shippedQuantity > 0)) await recomputeOrderStatusFromItems(order.orderId);
    await logMoney({
      actorEmail: OWNER,
      orderId: order.orderId,
      action: MONEY_LOG_ACTIONS.ORDER_EDITED,
      details: `${changes.join("; ")} · ${reason}`,
      amountBefore: order.totalAmount,
      amountAfter: fresh?.totalAmount ?? newTotal,
    });
    console.log("  записано");
  }
  if (!apply) console.log("\nЭто показ. Записать: --yes");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
