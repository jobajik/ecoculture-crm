import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Клиенту вернули деньги, цветок не уезжал — отменить заявку и снять её платежи (итог, части по компаниям,
 * строки `Payments`) одним запросом, в журнал денег — «возврат клиенту». Отгруженную не трогает.
 * 15.10.2026, №O2SHR (Динара): оплачена Kaspi 03.10, деньги вернули, заявка висела новой и оплаченной.
 *
 *   npx tsx scripts/refund-cancel.ts <json {"code":"O2SHR","reason":"…"}> [--yes]
 */
import { readFileSync } from "node:fs";
import { clearOrdersPaid, listOrdersWithItems, updateOrderStatus } from "../src/lib/repo/orders";
import { listPayments } from "../src/lib/repo/payments";
import { logMoney } from "../src/lib/repo/moneyLog";
import { createBackup } from "../src/lib/backup";
import { orderCode } from "../src/lib/paymentStage";
import { MONEY_LOG_ACTIONS, ORDER_STATUSES } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) throw new Error("нужен файл JSON");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { code: string; reason: string };
  const code = String(spec.code || "").toUpperCase();
  const reason = String(spec.reason || "").trim();
  if (!reason) throw new Error("нужна причина");
  const o = (await listOrdersWithItems()).find((x) => orderCode(x.orderId) === code || x.orderId.toUpperCase() === code);
  if (!o) throw new Error(`заявка ${code} не найдена`);
  const shipped = o.items.reduce((s, i) => s + i.shippedQuantity, 0);
  const pays = (await listPayments({ fresh: true })).filter((p) => p.orderId === o.orderId);
  console.log(`№${code} · ${o.clientName} · ${money(o.totalAmount)} · оплачено ${money(o.paidAmount)} · статус ${o.status} · отгружено ${shipped} шт.`);
  for (const p of pays) console.log(`  платёж ${p.date} · ${money(p.amount)} · ${p.method}`);
  if (shipped > 0) throw new Error("по заявке есть отгрузка — так не отменяю");
  if (o.status === ORDER_STATUSES.CANCELLED && o.paidAmount === 0) return console.log("Уже отменена, денег на ней нет.");
  if (!process.argv.includes("--yes")) return console.log("Только показ. Выполнить: --yes");
  const backup = await createBackup(new Date(), () => undefined);
  console.log(`Копия таблицы: ${backup.url}`);
  await clearOrdersPaid([o.orderId], OWNER);
  await updateOrderStatus(o.orderId, ORDER_STATUSES.CANCELLED);
  await logMoney({
    actorEmail: OWNER,
    orderId: o.orderId,
    action: MONEY_LOG_ACTIONS.ORDER_CANCELLED,
    details: `Возврат клиенту ${money(o.paidAmount)} (платежи: ${pays.map((p) => `${p.date} ${money(p.amount)} ${p.method}`).join(", ") || "—"}); заявка отменена. ${reason}`,
    amountBefore: o.paidAmount,
    amountAfter: 0,
  });
  console.log("Готово: заявка отменена, платёж снят.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
