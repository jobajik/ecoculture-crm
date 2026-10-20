import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Заявки, оформленные ботом основного номера на клиентов МЕНЕДЖЕРОВ, — переписать на менеджера (его продажа и
 * бонус). 20.10.2026, владелец: «все бонусы менеджеров должны сохраняться за ними, даже если бот помогает» и
 * «продажи, которые бот делает сам, — продажи бота». С этого дня так оформляет сам бот (`botSaleOwner`); скрипт
 * переносит уже оформленные. Клиент — по карточке заявки (ClientID), менеджер — действующий с ролью «менеджер».
 * Отменённые не трогаются. Без --yes — показ; с --yes — копия таблицы, запись, строка в журнале денег.
 *
 *   npx tsx scripts/bot-orders-to-managers.ts [--from ГГГГ-ММ-ДД] [--yes]
 */
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listClients } from "../src/lib/repo/clients";
import { listUsers } from "../src/lib/repo/users";
import { logMoney } from "../src/lib/repo/moneyLog";
import { createBackup } from "../src/lib/backup";
import { updateWhere, SHEET_TABS } from "../src/lib/sheets";
import { isBotEmail } from "../src/lib/botIdentity";
import { BOT_ORDER_MARK } from "../src/lib/sellerChannel";
import { orderCode } from "../src/lib/paymentStage";
import { MONEY_LOG_ACTIONS, ORDER_STATUSES, ROLES } from "../src/lib/constants";

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--yes");
  const fromIdx = args.indexOf("--from");
  const from = fromIdx >= 0 ? args[fromIdx + 1] : "";
  const [orders, clients, users] = await Promise.all([listOrdersWithItems(), listClients(), listUsers()]);
  const managers = new Map(users.filter((u) => u.active && u.role === ROLES.MANAGER).map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const cardOf = new Map(clients.map((c) => [c.clientId, c]));

  const moves = orders
    .filter((o) => isBotEmail(o.managerEmail) && o.status !== ORDER_STATUSES.CANCELLED && (!from || o.createdAt.slice(0, 10) >= from))
    .map((o) => ({ o, to: (cardOf.get(o.clientId)?.managerEmail || "").trim().toLowerCase() }))
    .filter((x) => managers.has(x.to))
    .sort((a, b) => (a.o.createdAt < b.o.createdAt ? -1 : 1));
  const stays = orders.filter((o) => isBotEmail(o.managerEmail) && o.status !== ORDER_STATUSES.CANCELLED && (!from || o.createdAt.slice(0, 10) >= from)).length - moves.length;

  console.log(`Заявки бота${from ? ` с ${from}` : ""}: переходят менеджерам ${moves.length}, остаются за ботом ${stays}.`);
  const byManager = new Map<string, { n: number; sum: number; paid: number }>();
  for (const { o, to } of moves) {
    const m = byManager.get(to) ?? { n: 0, sum: 0, paid: 0 };
    m.n++;
    m.sum += o.totalAmount;
    m.paid += Math.min(o.paidAmount, o.totalAmount);
    byManager.set(to, m);
    console.log(`  №${orderCode(o.orderId)} · ${o.createdAt.slice(0, 10)} · ${o.clientName} · ${money(o.totalAmount)} (оплачено ${money(Math.min(o.paidAmount, o.totalAmount))}) → ${managers.get(to)}`);
  }
  for (const [to, m] of byManager) console.log(`ИТОГО ${managers.get(to)}: ${m.n} заявок на ${money(m.sum)}, оплачено ${money(m.paid)}`);
  if (!apply || moves.length === 0) return console.log(apply ? "Переносить нечего." : "Только показ. Записать: --yes");

  const backup = await createBackup(new Date(), (m) => console.log(`  копия: ${m}`));
  console.log(`Копия таблицы: ${backup.url}`);
  for (const { o, to } of moves) {
    const notes = (o.notes || "").includes(BOT_ORDER_MARK) ? o.notes : [`${BOT_ORDER_MARK}.`, o.notes].filter(Boolean).join(" ");
    await updateWhere(SHEET_TABS.ORDERS, (r) => r.OrderID === o.orderId, () => ({
      ManagerEmail: to,
      Notes: [notes, "Клиент менеджера — продажа его, бот помог."].filter(Boolean).join(" "),
    }));
    await logMoney({
      actorEmail: "y.sadakbayev@gmail.com",
      orderId: o.orderId,
      action: MONEY_LOG_ACTIONS.ORDER_EDITED,
      details: `Заявка бота переписана на менеджера клиента (${managers.get(to)}): продажа и бонус его, бот помог`,
      amountBefore: o.totalAmount,
      amountAfter: o.totalAmount,
    });
  }
  console.log(`Перенесено: ${moves.length}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
