import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Какие заявки похожи на «Пожарку» и почему точка их не видит: направление, клиент,
 * розница, вид, статус, заказано и отгружено. Ничего не меняет.
 *
 *   npx tsx scripts/diag-pozharka.ts [дней назад, по умолчанию 60]
 */
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { isConsignment } from "../src/lib/orderKind";
import { orderCode } from "../src/lib/paymentStage";

async function main() {
  const daysBack = Number(process.argv[2]) || 60;
  const from = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
  const orders = (await listOrdersWithItems()).filter((o) => (o.deliveryDate || o.createdAt.slice(0, 10)) >= from);
  const like = orders.filter((o) => /пожар|базар|точк/i.test(`${o.direction ?? ""} ${o.clientName} ${o.notes ?? ""}`) || isConsignment(o));
  console.log(`заявок за ${daysBack} дн.: ${orders.length}; похожих на точку: ${like.length}; из них точка видит: ${like.filter((o) => isConsignment(o)).length}`);
  const dirs = new Map<string, number>();
  for (const o of orders) dirs.set(o.direction || "(пусто)", (dirs.get(o.direction || "(пусто)") ?? 0) + 1);
  console.log("направления:", [...dirs.entries()].map(([d, n]) => `${d}: ${n}`).join(" · "));
  for (const o of like.slice(0, 60)) {
    const ordered = o.items.reduce((s, i) => s + i.quantity, 0);
    const shipped = o.items.reduce((s, i) => s + (i.shippedQuantity || 0), 0);
    console.log(
      `№${orderCode(o.orderId)} · ${o.deliveryDate || o.createdAt.slice(0, 10)} · «${o.clientName}» · напр. «${o.direction ?? ""}» · розн. «${o.retail ?? ""}» · вид «${o.kind ?? ""}» · ${o.status} · заказано ${ordered} · отгружено ${shipped} · точка видит: ${isConsignment(o) ? "да" : "НЕТ"} · оплачено ${Math.round(o.paidAmount)} из ${Math.round(o.totalAmount)} · ${o.managerEmail}`
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
