/*
 * Диагностика дублей: для названных заявок печатает ВСЕ заявки того же клиента
 * (по карточке, а без неё — по имени) с суммой, оплатой, отгрузкой, позициями
 * и платежами из журнала. НИЧЕГО НЕ МЕНЯЕТ.
 *
 * Зачем: владелец просит удалить заявки-дубли, а по ним числятся деньги. Прежде
 * чем удалять, надо понять, есть ли у клиента «настоящая» заявка и на какой из
 * двух записаны платежи, — иначе удаление дубля унесёт из выручки реальные
 * деньги.
 *
 * Запуск: npx tsx scripts/diag-same-client.ts ORD-1 ORD-2
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listPayments } from "../src/lib/repo/payments";

const n = (v: number) => Math.round(v).toLocaleString("ru-RU");
const norm = (s: string) => (s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

async function main() {
  const ids = process.argv.slice(2);
  const [orders, payments] = await Promise.all([listOrdersWithItems(), listPayments()]);
  for (const id of ids) {
    const o = orders.find((x) => x.orderId === id);
    console.log(`\n===== ${id} =====`);
    if (!o) {
      console.log("не найдена");
      continue;
    }
    const same = orders
      .filter((x) => (o.clientId ? x.clientId === o.clientId : norm(x.clientName) === norm(o.clientName)))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    console.log(`Клиент: ${o.clientName} (карточка ${o.clientId || "нет"}) · заявок у клиента: ${same.length}`);
    for (const x of same) {
      const shipped = x.items.reduce((s, i) => s + (i.shippedQuantity || 0), 0);
      const qty = x.items.reduce((s, i) => s + i.quantity, 0);
      const mark = x.orderId === id ? " <== названа" : "";
      console.log(
        `  ${x.orderId}${mark}\n    оформлена ${x.createdAt.slice(0, 16)} · доставка ${x.deliveryDate} · ${x.managerEmail} · статус ${x.status}`
      );
      console.log(`    ${n(x.totalAmount)} ₸ · получено ${n(x.paidAmount)} ₸ · ${qty} шт. (отгружено ${shipped}) · способ ${x.paymentMethod || "-"}`);
      console.log(`    позиции: ${x.items.map((i) => `${i.variety || i.flowerType} ${i.grade} ${i.quantity}×${i.unitPrice}`).join("; ")}`);
      const pays = payments.filter((p) => p.orderId === x.orderId);
      for (const p of pays) console.log(`    платёж ${p.date} · ${n(p.amount)} ₸ · ${p.method} · внесла ${p.accountantEmail} · ${p.createdAt.slice(0, 16)}`);
      if (pays.length === 0) console.log("    платежей в журнале нет");
    }
  }
}

main().catch((err) => {
  console.error("ОШИБКА:", err instanceof Error ? err.message : err);
  process.exit(1);
});
