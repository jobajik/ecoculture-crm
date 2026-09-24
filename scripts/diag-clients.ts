/*
 * Диагностика клиентской базы: какие цифры по клиентам вообще можно честно
 * посчитать на живых данных. НИЧЕГО НЕ МЕНЯЕТ. Телефонов и адресов не печатает —
 * только счётчики, суммы и названия точек.
 *
 * Запуск: npx tsx scripts/diag-clients.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listUsers } from "../src/lib/repo/users";
import { listClients } from "../src/lib/repo/clients";
import { ORDER_STATUSES } from "../src/lib/constants";
import { hasNoClientInvoice, isConsignment, isRegionOrder } from "../src/lib/orderKind";
import { isOwnShop, isRetailOrder } from "../src/lib/retail";

const n = (v: number) => Math.round(v).toLocaleString("ru-RU");
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "—");
const h = (t: string) => console.log(`\n===== ${t} =====`);
const day = (s: string) => (s || "").slice(0, 10);

function tally(xs: string[]): string {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x || "(пусто)", (m.get(x || "(пусто)") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(" · ");
}

async function main() {
  const [orders, clients, users] = await Promise.all([listOrdersWithItems(), listClients(), listUsers()]);
  const name = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const real = clients.filter((c) => !isOwnShop(c));

  h("Карточки");
  console.log(`всего ${clients.length}, наших магазинов ${clients.length - real.length}, клиентов ${real.length}, неактивных ${real.filter((c) => !c.active).length}`);
  console.log(`по менеджерам: ${tally(real.map((c) => name.get(c.managerEmail.toLowerCase()) ?? c.managerEmail))}`);
  console.log(`по городам: ${tally(real.map((c) => c.city.trim()))}`);
  console.log(`тип точки: ${tally(real.map((c) => c.clientType))}`);
  console.log(`источник: ${tally(real.map((c) => c.source))}`);
  console.log(`условия оплаты: ${tally(real.map((c) => c.paymentTerms))}`);
  console.log(`чем платит: ${tally(real.map((c) => c.paymentMethod))}`);
  console.log(`заведены по дням: ${tally(real.map((c) => day(c.createdAt)))}`);

  const live = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED);
  const sales = live.filter((o) => !hasNoClientInvoice(o));
  h("Заявки");
  console.log(`всего ${orders.length}, отменено ${orders.length - live.length}, продаж клиентам ${sales.length}, розница ${live.filter(isRetailOrder).length}, опт на город ${live.filter(isRegionOrder).length}, реализация ${sales.filter(isConsignment).length}`);
  const dates = sales.map((o) => day(o.createdAt)).filter(Boolean).sort();
  console.log(`первая ${dates[0]}, последняя ${dates[dates.length - 1]}`);
  console.log(`по дням оформления: ${tally(dates)}`);
  console.log(`без карточки клиента: ${sales.filter((o) => !o.clientId).length}`);
  console.log(`с направлением: ${tally(sales.map((o) => o.direction))}`);

  const amount = (o: (typeof sales)[number]) => o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const stems = (o: (typeof sales)[number]) => o.items.reduce((s, i) => s + i.quantity, 0);
  const byClient = new Map<string, typeof sales>();
  for (const o of sales) if (o.clientId) byClient.set(o.clientId, [...(byClient.get(o.clientId) ?? []), o]);

  h("Клиенты по заявкам");
  const counts = real.map((c) => (byClient.get(c.clientId) ?? []).length);
  console.log(`0 заявок: ${counts.filter((x) => x === 0).length}, 1: ${counts.filter((x) => x === 1).length}, 2: ${counts.filter((x) => x === 2).length}, 3–5: ${counts.filter((x) => x >= 3 && x <= 5).length}, 6+: ${counts.filter((x) => x >= 6).length}`);
  const total = sales.reduce((s, o) => s + amount(o), 0);
  const rev = real
    .map((c) => ({ c, r: (byClient.get(c.clientId) ?? []).reduce((s, o) => s + amount(o), 0), k: (byClient.get(c.clientId) ?? []).length }))
    .sort((a, b) => b.r - a.r);
  console.log(`выручка ${n(total)} ₸; топ-10:`);
  for (const x of rev.slice(0, 10)) console.log(`  ${x.c.name} (${x.c.city}) — ${n(x.r)} ₸, заявок ${x.k}, ${pct(x.r, total)}`);
  const cum = (k: number) => pct(rev.slice(0, k).reduce((s, x) => s + x.r, 0), total);
  console.log(`доля топ-3 ${cum(3)}, топ-5 ${cum(5)}, топ-10 ${cum(10)}, топ-20 ${cum(20)}`);

  h("Менеджеры (по заявкам)");
  const mgr = new Map<string, { o: number; r: number; c: Set<string>; p: number; s: number }>();
  for (const o of sales) {
    const k = name.get(o.managerEmail.toLowerCase()) ?? o.managerEmail;
    const m = mgr.get(k) ?? { o: 0, r: 0, c: new Set<string>(), p: 0, s: 0 };
    m.o++;
    m.r += amount(o);
    m.s += stems(o);
    m.p += Math.min(o.paidAmount, amount(o));
    if (o.clientId) m.c.add(o.clientId);
    mgr.set(k, m);
  }
  for (const [k, m] of [...mgr.entries()].sort((a, b) => b[1].r - a[1].r)) {
    console.log(`  ${k}: заявок ${m.o}, клиентов ${m.c.size}, выручка ${n(m.r)} ₸, стеблей ${n(m.s)}, оплачено ${pct(m.p, m.r)}, чек ${n(m.r / m.o)}`);
  }

  h("Города (по клиенту заявки)");
  const cityOf = new Map(real.map((c) => [c.clientId, c.city.trim()]));
  const city = new Map<string, { o: number; r: number; c: Set<string> }>();
  for (const o of sales) {
    const k = cityOf.get(o.clientId) ?? "(без карточки)";
    const m = city.get(k) ?? { o: 0, r: 0, c: new Set<string>() };
    m.o++;
    m.r += amount(o);
    if (o.clientId) m.c.add(o.clientId);
    city.set(k, m);
  }
  for (const [k, m] of [...city.entries()].sort((a, b) => b[1].r - a[1].r)) console.log(`  ${k}: заявок ${m.o}, клиентов ${m.c.size}, выручка ${n(m.r)} ₸`);

  h("Что берут");
  const fl = new Map<string, number>();
  for (const o of sales) for (const i of o.items) fl.set(i.flowerType, (fl.get(i.flowerType) ?? 0) + i.quantity * i.unitPrice);
  console.log([...fl.entries()].map(([k, v]) => `${k}: ${n(v)} ₸ (${pct(v, total)})`).join(" · "));
  const mixed = real.filter((c) => new Set((byClient.get(c.clientId) ?? []).flatMap((o) => o.items.map((i) => i.flowerType))).size > 1).length;
  console.log(`клиентов, берущих больше одного цветка: ${mixed}`);

  h("Повторность");
  const gaps: number[] = [];
  for (const list of byClient.values()) {
    const ds = [...new Set(list.map((o) => day(o.createdAt)))].sort();
    for (let i = 1; i < ds.length; i++) gaps.push((new Date(ds[i]).getTime() - new Date(ds[i - 1]).getTime()) / 86400000);
  }
  gaps.sort((a, b) => a - b);
  console.log(`интервалов между заказами: ${gaps.length}, медиана ${gaps.length ? gaps[Math.floor(gaps.length / 2)] : "—"} дн.`);
  const debt = sales.filter((o) => !isConsignment(o)).reduce((s, o) => s + Math.max(0, amount(o) - o.paidAmount), 0);
  console.log(`долг всего ${n(debt)} ₸`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
