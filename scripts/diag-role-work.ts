import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Что делали в CRM сотрудники роли за N дней — чтобы понять, какая работа встанет, если человек ушёл (11.11.2026, ушёл РОП:
 * «мне надо, чтобы CRM продолжал работать»). Ничего не меняет. Печатает: кто в роли, их заявки (клиентам / объём на город /
 * в наши магазины, по направлениям), действия в журнале денег, перемещения между складами, касания лидов, планы отгрузок;
 * и кто ещё заводил объём на город и перемещал цветок за тот же срок.
 *
 *   npx tsx scripts/diag-role-work.ts [роль=sales_head] [дней=45]
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listMoneyLog } from "../src/lib/repo/moneyLog";
import { listStockMoves } from "../src/lib/repo/stockMoves";
import { listLeadTouches } from "../src/lib/repo/leads";
import { listShipmentPlans } from "../src/lib/repo/shipmentPlans";
import { listUsers } from "../src/lib/repo/users";
import { isRegionOrder } from "../src/lib/orderKind";

const count = <T,>(list: T[], key: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of list) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k || "—"} ${n}`).join(" · ") || "—";
};

async function main() {
  const role = process.argv[2] || "sales_head";
  const days = Number(process.argv[3]) || 45;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.MONEY_LOG, SHEET_TABS.STOCK_MOVES, SHEET_TABS.LEAD_TOUCHES, SHEET_TABS.SHIPMENT_PLANS]).catch(() => undefined);
  const [users, orders, log, moves, touches, plans] = await Promise.all([
    listUsers(),
    listOrdersWithItems(),
    listMoneyLog().catch(() => []),
    listStockMoves().catch(() => []),
    listLeadTouches().catch(() => []),
    listShipmentPlans().catch(() => []),
  ]);
  const roleOf = new Map(users.map((u) => [u.email.toLowerCase(), u.role]));
  const nameOf = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const who = (e: string) => `${nameOf.get(e.toLowerCase()) ?? e} (${roleOf.get(e.toLowerCase()) ?? "нет в Users"})`;
  const mine = users.filter((u) => u.role === role);
  console.log(`Роль ${role}: ${mine.map((u) => `${u.name} <${u.email}> ${u.active === false ? "ВЫКЛЮЧЕН" : "активен"}`).join("; ") || "никого"}`);
  const emails = new Set(mine.map((u) => u.email.toLowerCase()));
  const recent = orders.filter((o) => o.createdAt >= since);
  const kind = (o: (typeof orders)[number]) => (isRegionOrder(o) ? "объём на город" : (o.retail || "").trim() ? `наш магазин (${o.retail})` : "клиенту");

  const own = recent.filter((o) => emails.has(String(o.managerEmail || "").toLowerCase()));
  console.log(`\nЗаявки на этих людях за ${days} дн.: ${own.length} — ${count(own, kind)}`);
  console.log(`  объём на город по направлениям: ${count(own.filter(isRegionOrder), (o) => o.direction)}`);
  console.log(`  клиентские по направлениям: ${count(own.filter((o) => kind(o) === "клиенту"), (o) => o.direction || "без направления")}`);
  console.log(`  последняя заявка: ${own.map((o) => o.createdAt).sort().pop() ?? "—"}`);

  const myLog = log.filter((l) => l.createdAt >= since && emails.has(String(l.actorEmail || "").toLowerCase()));
  console.log(`\nЖурнал денег, их действия: ${myLog.length} — ${count(myLog, (l) => l.action)}`);
  const myMoves = moves.filter((m) => m.createdAt >= since && emails.has(String(m.byEmail || "").toLowerCase()));
  console.log(`Перемещения между складами, их: ${myMoves.length} — ${count(myMoves, (m) => m.direction)}; стеблей ${myMoves.reduce((s, m) => s + m.quantity, 0)}`);
  const myTouches = touches.filter((t) => String(t.createdAt || "") >= since && emails.has(String(t.managerEmail || "").toLowerCase()));
  console.log(`Касания лидов, их: ${myTouches.length}`);
  const myPlans = plans.filter((p) => emails.has(String(p.updatedByEmail || "").toLowerCase()));
  console.log(`Планы отгрузок, их строк: ${myPlans.length}; периоды: ${count(myPlans, (p) => p.period)}`);

  console.log(`\nКто заводил объём на город за ${days} дн.: ${count(recent.filter(isRegionOrder), (o) => who(String(o.managerEmail || "")))}`);
  console.log(`Кто заводил заявки в наши магазины: ${count(recent.filter((o) => (o.retail || "").trim()), (o) => who(String(o.managerEmail || "")))}`);
  const allMoves = moves.filter((m) => m.createdAt >= since);
  console.log(`Кто перемещал между складами: ${count(allMoves, (m) => `${who(String(m.byEmail || ""))} ${m.direction}`)}`);
  console.log(`Кто менял заявки в журнале (order_edited, cancelled и т. п.) по ролям: ${count(log.filter((l) => l.createdAt >= since), (l) => `${roleOf.get(String(l.actorEmail || "").toLowerCase()) ?? "?"}:${l.action}`)}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
