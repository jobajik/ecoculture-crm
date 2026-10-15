import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Продажи по неделям в разрезах — к странице «Повестка по продажам» (15.10.2026, владелец: «можешь развернуть
 * данные»): цветы (штуки и деньги), менеджеры, новые и повторные, Алматы и регионы, средний чек, крупнейшие
 * клиенты, по дням. Те же правила, что `diag-sales-meeting.ts`. Ничего не меняет; JSON — _private/sales-weeks.json.
 *   npx tsx scripts/diag-sales-weeks.ts
 */
import { writeFileSync } from "node:fs";
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listClients } from "../src/lib/repo/clients";
import { listUsers } from "../src/lib/repo/users";
import { isNotASale } from "../src/lib/orderKind";
import { BOT_MANAGER_EMAIL } from "../src/lib/botIdentity";
import { ORDER_STATUSES } from "../src/lib/constants";
import { localDayKey } from "../src/lib/timezone";

const day = (iso: string) => (iso || "").slice(0, 10);
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const inc = (m: Record<string, number>, k: string, v: number) => (m[k] = (m[k] ?? 0) + v);

async function main() {
  const today = localDayKey();
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.USERS]);
  const [orders, clients, users] = await Promise.all([listOrdersWithItems(), listClients(), listUsers()]);
  const name = new Map(users.map((u) => [u.email.toLowerCase(), (u.name || u.email).split(/\s+/)[0]]));
  name.set(BOT_MANAGER_EMAIL, "Бот");
  const clientById = new Map(clients.map((c) => [c.clientId, c]));
  const sales = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o) && o.clientId);
  const first = new Map<string, string>();
  for (const o of [...sales].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) if (!first.has(o.clientId)) first.set(o.clientId, day(o.createdAt));

  const weeks = [];
  for (let w = 4; w >= 0; w--) {
    const from = addDays(today, -7 * w - 6);
    const to = addDays(today, -7 * w);
    const inW = sales.filter((o) => day(o.createdAt) >= from && day(o.createdAt) <= to);
    const flowerSum: Record<string, number> = {};
    const flowerStems: Record<string, number> = {};
    const mgrSum: Record<string, number> = {};
    const mgrOrders: Record<string, number> = {};
    const mgrClients: Record<string, Set<string>> = {};
    const region: Record<string, number> = {};
    const regionOrders: Record<string, number> = {};
    const byDay: Record<string, number> = {};
    const byDayOrders: Record<string, number> = {};
    const clientSum: Record<string, number> = {};
    let newSum = 0;
    let repeatSum = 0;
    let newCount = 0;
    const seen = new Set<string>();
    let paid = 0;
    for (const o of inW) {
      for (const it of o.items) {
        inc(flowerSum, it.flowerType, it.quantity * it.unitPrice);
        inc(flowerStems, it.flowerType, it.quantity);
      }
      const m = name.get(o.managerEmail.toLowerCase()) ?? o.managerEmail;
      inc(mgrSum, m, o.totalAmount);
      inc(mgrOrders, m, 1);
      (mgrClients[m] ??= new Set()).add(o.clientId);
      const city = (clientById.get(o.clientId)?.city || "").trim();
      const r = /алмат|almat/i.test(city) || !city ? "Алматы" : city;
      inc(region, r, o.totalAmount);
      inc(regionOrders, r, 1);
      inc(byDay, day(o.createdAt), o.totalAmount);
      inc(byDayOrders, day(o.createdAt), 1);
      inc(clientSum, o.clientId, o.totalAmount);
      const isNew = (first.get(o.clientId) || "") >= from;
      if (isNew) newSum += o.totalAmount;
      else repeatSum += o.totalAmount;
      if (isNew && !seen.has(o.clientId)) newCount++;
      seen.add(o.clientId);
      paid += Math.min(o.paidAmount, o.totalAmount);
    }
    const total = inW.reduce((s, o) => s + o.totalAmount, 0);
    const top = Object.entries(clientSum)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, sum]) => ({ name: clientById.get(id)?.name ?? id, city: clientById.get(id)?.city ?? "", sum, isNew: (first.get(id) || "") >= from }));
    const regions = Object.entries(region).sort((a, b) => b[1] - a[1]);
    weeks.push({
      from, to, orders: inW.length, total, paid, clients: seen.size, newCount, newSum, repeatSum,
      avgCheck: inW.length ? Math.round(total / inW.length) : 0,
      flowers: Object.keys(flowerSum).map((f) => ({ flower: f, sum: Math.round(flowerSum[f]), stems: flowerStems[f] })),
      managers: Object.keys(mgrSum).sort((a, b) => mgrSum[b] - mgrSum[a]).map((m) => ({ name: m, sum: Math.round(mgrSum[m]), orders: mgrOrders[m], clients: mgrClients[m].size })),
      regions: regions.slice(0, 8).map(([r, s]) => ({ region: r, sum: Math.round(s), orders: regionOrders[r] })),
      regionsOther: regions.slice(8).reduce((s, [, v]) => s + v, 0),
      days: Object.keys(byDay).sort().map((d) => ({ day: d, sum: Math.round(byDay[d]), orders: byDayOrders[d] })),
      top,
    });
  }
  writeFileSync("../_private/sales-weeks.json", JSON.stringify({ today, weeks }, null, 2), "utf8");
  for (const w of weeks) console.log(`${w.from}…${w.to}: ${w.orders} заявок, ${Math.round(w.total)} ₸`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});
