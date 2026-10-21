import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Заявки бота и ИИ-помощника, которые повторяют заявку человека (21.10.2026, владелец: «мне говорят, что ты дублируешь
 * заявки после менеджеров»). За N дней: каждая заявка с меткой бота/помощника и рядом — живые заявки того же клиента
 * (по телефону или карточке), оформленные ЧЕЛОВЕКОМ за 48 ч до неё или после неё: позиции, суммы, оплата, счета Kaspi,
 * что совпало. Ничего не меняет.
 *
 *   npx tsx scripts/diag-dup-orders.ts [дней]
 */
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listKaspiInvoices } from "../src/lib/repo/kaspiInvoices";
import { isAssistantOrder, isBotOrder } from "../src/lib/sellerChannel";
import { phoneKey } from "../src/lib/leads";
import { orderCode } from "../src/lib/paymentStage";
import { ORDER_STATUSES } from "../src/lib/constants";

const WINDOW_H = 48;

async function main() {
  const days = Number(process.argv[2]) || 7;
  const since = Date.now() - days * 86400000;
  const [orders, invoices] = await Promise.all([listOrdersWithItems(), listKaspiInvoices().catch(() => [])]);
  const machine = (o: { managerEmail: string; notes?: string | null }) => isBotOrder(o) || isAssistantOrder(o);
  const items = (o: (typeof orders)[number]) => o.items.map((i) => `${i.variety || i.flowerType} ${i.grade} ×${i.quantity}`).join(", ");
  const kind = (o: (typeof orders)[number]) => o.items.map((i) => `${i.flowerType}|${i.variety}|${i.grade}`).sort().join(";");
  const inv = (id: string) =>
    invoices
      .filter((k) => k.orderId === id)
      .map((k) => `${k.status} ${Math.round(k.amount)}`)
      .join(", ");
  const bots = orders.filter((o) => machine(o) && Date.parse(o.createdAt || "") >= since).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  console.log(`Заявок бота/помощника за ${days} дн.: ${bots.length}`);
  let dups = 0;
  for (const b of bots) {
    const key = phoneKey(b.clientPhone);
    const t = Date.parse(b.createdAt);
    const near = orders.filter(
      (o) =>
        o.orderId !== b.orderId &&
        !machine(o) &&
        ((key && phoneKey(o.clientPhone) === key) || (b.clientId && o.clientId === b.clientId)) &&
        Math.abs(Date.parse(o.createdAt || "") - t) < WINDOW_H * 3600000
    );
    if (near.length === 0) continue;
    dups++;
    const same = near.filter((o) => kind(o) === kind(b));
    console.log(`\n=== №${orderCode(b.orderId)} ${b.createdAt.slice(0, 16)} · ${b.clientName} …${key.slice(-4)} · ${b.status}${b.status === ORDER_STATUSES.CANCELLED ? " (отменена)" : ""}`);
    console.log(`  бот/помощник (${b.managerEmail}): ${items(b)} · ${Math.round(b.totalAmount)} ₸ · оплачено ${Math.round(b.paidAmount || 0)} · счета: ${inv(b.orderId) || "—"}`);
    console.log(`  заметка: ${(b.notes || "").slice(0, 160)}`);
    for (const o of near) {
      const when = Date.parse(o.createdAt) < t ? "ДО" : "ПОСЛЕ";
      console.log(
        `  ${when} человек №${orderCode(o.orderId)} ${o.createdAt.slice(0, 16)} (${o.managerEmail}) ${o.status}: ${items(o)} · ${Math.round(o.totalAmount)} ₸ · оплачено ${Math.round(o.paidAmount || 0)} · счета: ${inv(o.orderId) || "—"}${same.includes(o) ? " · ТЕ ЖЕ ПОЗИЦИИ" : ""}`
      );
    }
  }
  console.log(`\nС заявкой человека рядом (±${WINDOW_H} ч): ${dups} из ${bots.length}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
