/*
 * Удалить заявку совсем — как кнопка ✕ администратора в списке заявок (`deleteOrderAction`), но без входа на сайт:
 * вместе с позициями, платежами и рекламациями, отгруженное — вернуть на склад («return») или оставить («keep»).
 *
 *   npx tsx scripts/delete-order-admin.ts <json {"code":"BHIYX","reason":"…","stock":"return"|"keep"}> [--yes]
 *
 * Без --yes — только показ. Перед удалением — копия всей таблицы. Открытый Kaspi-счёт не даёт удалить.
 * 13.10.2026: BHIYX (Сакура Алматы) — клиент отказался, цветы вернули на склад.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readFileSync } from "node:fs";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listShipments } from "../src/lib/repo/shipments";
import { listClaims } from "../src/lib/repo/claims";
import { listPayments } from "../src/lib/repo/payments";
import { listKaspiInvoices } from "../src/lib/repo/kaspiInvoices";
import { OPEN_STATUSES as KASPI_OPEN_STATUSES } from "../src/lib/kaspiInvoice";
import { adminDeleteRefusal, adminDeleteSummary, describeAdminDeletion, describeDeletedOrder } from "../src/lib/orderDelete";
import { deleteOrderFully } from "../src/lib/repo/orderDelete";
import { logMoney } from "../src/lib/repo/moneyLog";
import { createBackup } from "../src/lib/backup";
import { orderCode } from "../src/lib/paymentStage";
import { MONEY_LOG_ACTIONS, ROLES } from "../src/lib/constants";

const OWNER = "y.sadakbayev@gmail.com";
const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("нужен файл JSON {code, reason, stock}");
  const spec = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { code: string; reason: string; stock?: "return" | "keep" };
  const yes = process.argv.includes("--yes");
  const code = String(spec.code || "").toUpperCase();
  const orders = await listOrdersWithItems();
  const order = orders.find((o) => orderCode(o.orderId) === code || o.orderId.toUpperCase() === code);
  if (!order) throw new Error(`Заявка ${code} не найдена`);
  const [shipments, claims, payments, kaspi] = await Promise.all([
    listShipments(),
    listClaims(),
    listPayments({ fresh: true }),
    listKaspiInvoices({ fresh: true }),
  ]);
  const stock: "return" | "keep" | "" = spec.stock === "return" || spec.stock === "keep" ? spec.stock : "";
  const input = {
    role: ROLES.ADMIN,
    order,
    shipments: shipments.filter((s) => s.orderId === order.orderId),
    payments: payments.filter((p) => p.orderId === order.orderId).length,
    claims: claims.filter((c) => c.orderId === order.orderId).length,
    openKaspi: kaspi.filter((k) => k.orderId === order.orderId && KASPI_OPEN_STATUSES.includes(k.status)).length,
    stock,
  };
  const summary = adminDeleteSummary(input);
  console.log(`№${code} · ${order.clientName} · ${money(order.totalAmount)} · статус ${order.status} · оплачено ${money(order.paidAmount)}`);
  console.log(`отгружено ${summary.shippedStems} шт. · платежей ${summary.payments} · рекламаций ${summary.claims} · открытых Kaspi-счетов ${input.openKaspi}`);
  console.log(`склад: ${stock === "return" ? `вернуть ${summary.stockReturn.map((r) => `${r.batchId} ${r.quantity}`).join(", ")}` : stock === "keep" ? "не трогать" : "—"}`);
  const reason = String(spec.reason || "").trim();
  if (!reason) throw new Error("Нужна причина");
  const refusal = adminDeleteRefusal(input);
  if (refusal) return console.log(`Нельзя: ${refusal}`);
  if (!yes) return console.log("Только показ. Удалить: --yes");
  const backup = await createBackup(new Date(), (m) => console.log(`  копия: ${m}`));
  console.log(`Копия таблицы: ${backup.url}`);
  const done = await deleteOrderFully(order.orderId, summary.shippedStems > 0 ? stock : "");
  const extra = describeAdminDeletion(summary, stock, stock === "return" ? done.returned : undefined);
  await logMoney({
    actorEmail: OWNER,
    orderId: order.orderId,
    action: MONEY_LOG_ACTIONS.ORDER_DELETED,
    details: `${describeDeletedOrder({
      orderId: order.orderId,
      clientName: order.clientName,
      managerEmail: order.managerEmail,
      totalAmount: order.totalAmount,
      items: order.items,
      reason,
    })}${extra ? ` · ${extra}` : ""}`,
    amountBefore: order.totalAmount,
    amountAfter: 0,
  });
  console.log(`Удалено: заявка ${done.orders}, позиций ${done.items}, платежей ${done.payments}, рекламаций ${done.claims}, строк отгрузок ${done.shipments}, на склад вернулось ${done.returned} шт.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
