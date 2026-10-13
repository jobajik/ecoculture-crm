/*
 * Снять деньги, внесённые ПРЯМО на заявки-перемещения точки «Пожарка» (их выручка уже идёт отчётом за день,
 * иначе она посчитана дважды). То же, что кнопка «снять» на странице точки, но для владельца без входа на сайт.
 *
 *   npx tsx scripts/point-clear-money.ts                  — только показ
 *   npx tsx scripts/point-clear-money.ts --yes ZYXCL …    — копия таблицы, затем снять с ЭТИХ заявок
 *
 * 13.10.2026, владелец: «да, убрать (с копией)» — ZYXCL, HLLY6, BLING, VDTGZ (~5,0 млн ₸).
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listOrdersWithItems, clearOrdersPaid } from "../src/lib/repo/orders";
import { pointMoneyClearRefusal, pointOrdersWithMoney } from "../src/lib/point";
import { orderCode } from "../src/lib/paymentStage";
import { createBackup } from "../src/lib/backup";
import { logMoney } from "../src/lib/repo/moneyLog";
import { MONEY_LOG_ACTIONS, ROLES } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

async function main() {
  const yes = process.argv.includes("--yes");
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((a) => a.toUpperCase());
  const orders = await listOrdersWithItems();
  const withMoney = pointOrdersWithMoney(orders);
  for (const o of withMoney) {
    console.log(`№${orderCode(o.orderId)} · ${o.clientName} · доставка ${(o.deliveryDate || o.createdAt).slice(0, 10)} · внесено ${money(o.paidAmount)} (${o.paidAt.slice(0, 10)})`);
  }
  console.log(`\nПеремещений с деньгами: ${withMoney.length}, на ${money(withMoney.reduce((s, o) => s + o.paidAmount, 0))}`);
  if (!yes) return console.log("Только показ. Снять: --yes <номера>");
  const chosen = withMoney.filter((o) => wanted.includes(orderCode(o.orderId)) || wanted.includes(o.orderId.toUpperCase()));
  const missing = wanted.filter((w) => !chosen.some((o) => orderCode(o.orderId) === w || o.orderId.toUpperCase() === w));
  if (missing.length) console.log(`Нет среди перемещений с деньгами: ${missing.join(", ")} — их не трогаю.`);
  if (chosen.length === 0) return console.log("Снимать нечего.");
  const ids = chosen.map((o) => o.orderId);
  const refusal = pointMoneyClearRefusal(ROLES.ADMIN, ids, orders);
  if (refusal) throw new Error(refusal);
  const backup = await createBackup(new Date(), (m) => console.log(`  копия: ${m}`));
  console.log(`Копия таблицы: ${backup.url}`);
  const total = chosen.reduce((s, o) => s + o.paidAmount, 0);
  const touched = await clearOrdersPaid(ids, OWNER);
  await logMoney({
    actorEmail: OWNER,
    orderId: ids.length === 1 ? ids[0] : "",
    action: MONEY_LOG_ACTIONS.PAYMENT_REMOVED,
    details:
      "Пожарка: сняты деньги, внесённые на перемещения (выручка — отчётом за день): " +
      chosen.map((o) => `№${orderCode(o.orderId)} ${money(o.paidAmount)}`).join("; "),
    amountBefore: total,
    amountAfter: 0,
  });
  console.log(`Снято с ${touched} заявок: ${money(total)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
