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
 * Позицию можно указать без номера — `"match": { "variety": "Altaj", "grade": "Вторая" }` (должна
 * найтись ровно одна); `"priceFromList": true` — цена по действующему прайсу для новой градации;
 * `"add": [ { "flowerType": "eustoma", "variety": "…", "grade": "…", "quantity": 60 } ]` — новые позиции
 * (без `unitPrice` цена из прайса). Номер заявки можно дать коротким кодом («IIU0D»).
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
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { priceFor } from "../src/lib/priceList";
import { localDayKey } from "../src/lib/timezone";

const OWNER = "y.sadakbayev@gmail.com";
const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

type Patch = {
  itemId?: string;
  match?: { variety: string; grade: string; flowerType?: string };
  quantity?: number;
  variety?: string;
  grade?: string;
  unitPrice?: number;
  priceFromList?: boolean;
};
type Add = { flowerType: string; variety: string; grade: string; quantity: number; unitPrice?: number };

const norm = (s: string) => s.toUpperCase().replace(/I/g, "1").replace(/O/g, "0");

/** Заявка по полному номеру или по короткому коду (I и 1, O и 0 не различаем — их путают на снимках). */
async function findOrder(id: string) {
  const exact = await getOrderById(id);
  if (exact) return exact;
  const code = norm(id.split("-").pop() || id);
  const hits = (await listOrdersWithItems()).filter((o) => norm(o.orderId).endsWith(code));
  return hits.length === 1 ? hits[0] : null;
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const apply = process.argv.includes("--yes");
  if (!file) throw new Error("Укажите файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as { reason?: string; orders: { orderId: string; items?: Patch[]; add?: Add[] }[] };
  const prices = await getCurrentPrices(localDayKey());
  const reason = (spec.reason || "правка по факту склада").trim();

  for (const o of spec.orders) {
    const order = await findOrder(o.orderId);
    console.log(`\n${o.orderId}`);
    if (!order) {
      console.log("  заявки нет — пропускаю");
      continue;
    }
    console.log(`  ${order.orderId} · ${order.clientName} · ${money(order.totalAmount)} · получено ${money(order.paidAmount)} · ${order.status}`);
    for (const i of order.items) console.log(`    было: ${i.itemId} · ${i.flowerType} | ${i.variety} | ${i.grade} | ${i.quantity} × ${i.unitPrice} | отгр ${i.shippedQuantity}`);
    const refusal = editItemsRefusal(order, "admin", OWNER);
    if (refusal) {
      console.log(`  нельзя: ${refusal}`);
      continue;
    }
    const byId = new Map<string, Patch>();
    let bad = "";
    for (const p of o.items ?? []) {
      let id = p.itemId || "";
      if (!id && p.match) {
        const m = p.match;
        const hits = order.items.filter(
          (i) => i.variety.toLowerCase() === m.variety.toLowerCase() && i.grade === m.grade && (!m.flowerType || i.flowerType === m.flowerType),
        );
        if (hits.length !== 1) bad = `позиция «${m.variety} ${m.grade}» найдена ${hits.length} раз`;
        else id = hits[0].itemId;
      }
      if (!id || !order.items.some((i) => i.itemId === id)) bad ||= `нет позиции ${id || JSON.stringify(p.match)}`;
      else byId.set(id, p);
    }
    if (bad) {
      console.log(`  ${bad} — пропускаю заявку`);
      continue;
    }
    const listPrice = (flowerType: string, variety: string, grade: string) => priceFor(prices, flowerType, variety, grade);
    const next = order.items.map((i) => {
      const p = byId.get(i.itemId);
      const variety = (p?.variety ?? i.variety).trim();
      const grade = gradeForVariety(i.flowerType, variety, (p?.grade ?? i.grade).trim());
      const fromList = p?.priceFromList ? listPrice(i.flowerType, variety, grade) : 0;
      return {
        itemId: i.itemId,
        flowerType: i.flowerType,
        variety,
        grade,
        quantity: Math.round(p?.quantity ?? i.quantity),
        unitPrice: p?.unitPrice ?? (fromList > 0 ? fromList : i.unitPrice),
      };
    });
    for (const a of o.add ?? []) {
      const grade = gradeForVariety(a.flowerType, a.variety.trim(), a.grade.trim());
      const unitPrice = a.unitPrice ?? listPrice(a.flowerType, a.variety.trim(), grade);
      if (!(unitPrice > 0)) {
        bad = `нет цены в прайсе для «${a.variety} ${grade}» — укажите unitPrice`;
        break;
      }
      next.push({ itemId: "", flowerType: a.flowerType as typeof next[number]["flowerType"], variety: a.variety.trim(), grade, quantity: Math.round(a.quantity), unitPrice });
    }
    if (bad) {
      console.log(`  ${bad} — пропускаю заявку`);
      continue;
    }
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
