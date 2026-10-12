/*
 * Заявки, у которых в журнале платежей денег больше, чем в итоге заявки, и разница складывается из
 * отдельных платежей, — их запись итога потерялась (два Kaspi-счёта оплачены в одну секунду, №YKLQQ).
 *
 *   npx tsx scripts/fix-lost-payments.ts                 — только показ, ничего не меняет
 *   npx tsx scripts/fix-lost-payments.ts --yes YKLQQ …   — копия таблицы, затем исправить ЭТИ заявки
 *
 * Исправляются только названные номера: разницу «журнал больше итога» даёт и законное «вернули переплату».
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listPayments } from "../src/lib/repo/payments";
import { lostPaymentFix } from "../src/lib/payments";
import { invoiceByFarm } from "../src/lib/orderMoney";
import { orderCode } from "../src/lib/paymentStage";
import { repairLostPayments } from "../src/lib/paymentWrite";
import { createBackup } from "../src/lib/backup";
import { ORDER_STATUSES, PAID_FIELD_BY_FARM } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

async function main() {
  const yes = process.argv.includes("--yes");
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((a) => a.toUpperCase());
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.PAYMENTS]);
  const [orders, payments] = await Promise.all([listOrdersWithItems(), listPayments()]);
  const found: { code: string; orderId: string }[] = [];
  for (const o of orders) {
    if (o.status === ORDER_STATUSES.CANCELLED) continue;
    const ledger = payments.filter((p) => p.orderId === o.orderId);
    if (ledger.length === 0) continue;
    const farms = invoiceByFarm(o.items).map((f) => f.farm);
    const paidByFarm: Record<string, number> = {};
    for (const f of farms) {
      const field = PAID_FIELD_BY_FARM[f];
      if (field) paidByFarm[f] = Number((o as unknown as Record<string, number>)[field]) || 0;
    }
    const fix = lostPaymentFix({ farms, paidAmount: o.paidAmount, paidByFarm, ledger, now: new Date(), recentOnly: false });
    if (!fix) continue;
    const code = orderCode(o.orderId);
    found.push({ code, orderId: o.orderId });
    console.log(
      `№${code} · ${o.clientName} · ${o.createdAt.slice(0, 10)} · сумма ${money(o.totalAmount)} · в итоге ${money(o.paidAmount)} · ` +
        `в журнале ${money(ledger.reduce((s, p) => s + p.amount, 0))} → станет ${money(fix.paidAmount)} (+${money(fix.added)})`
    );
  }
  console.log(`\nНайдено заявок: ${found.length}`);
  if (!yes) return console.log("Только показ. Исправить: --yes <номера>");
  const todo = found.filter((f) => wanted.includes(f.code) || wanted.includes(f.orderId.toUpperCase()));
  if (todo.length === 0) return console.log("Названных номеров среди найденных нет — ничего не меняю.");
  const backup = await createBackup(new Date(), (m) => console.log(`  копия: ${m}`));
  console.log(`Копия таблицы: ${backup.url}`);
  for (const t of todo) {
    const after = await repairLostPayments(t.orderId, OWNER, false);
    console.log(`№${t.code}: ${after === null ? "не изменилось" : `итог теперь ${money(after)}`}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
