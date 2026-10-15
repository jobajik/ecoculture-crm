import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Почему плохо продаётся (15.10.2026, владелец: «почему сейчас плохо продаётся цветок? чего не хватает?»).
 * Только чтение. По неделям (8 недель): продано штук и денег по цветку, сколько клиентов покупало, новые,
 * средний чек; приход и списания по цветку; кто из постоянных перестал брать; продажи по менеджерам и каналам;
 * склад сейчас против темпа продаж.
 *
 *   npx tsx scripts/diag-sales-trend.ts
 */
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listBatches } from "../src/lib/repo/batches";
import { listWriteoffs } from "../src/lib/repo/writeoffs";
import { listUsers } from "../src/lib/repo/users";
import { isNotASale } from "../src/lib/orderKind";
import { computeBatchStorageInfo } from "../src/lib/shelfLife";
import { getSettings } from "../src/lib/repo/settings";
import { localDayKey } from "../src/lib/timezone";

const n = (v: number) => Math.round(v).toLocaleString("ru-RU");
const FL: Record<string, string> = { rose: "роза", chrysanthemum: "хриз", eustoma: "эуст" };
const day = (iso: string) => (iso ? localDayKey(new Date(iso)) : "");

function weekStart(d: string): string {
  const x = new Date(`${d}T12:00:00`);
  const wd = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - wd);
  return x.toISOString().slice(0, 10);
}

async function main() {
  const [orders, batches, writeoffs, users, settings] = await Promise.all([listOrdersWithItems(), listBatches(), listWriteoffs(), listUsers(), getSettings()]);
  const today = localDayKey();
  const weeks: string[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() - i * 7);
    weeks.push(weekStart(d.toISOString().slice(0, 10)));
  }
  const sales = orders.filter((o) => o.status !== "cancelled" && !isNotASale(o) && o.createdAt);
  const firstOrder = new Map<string, string>();
  for (const o of [...sales].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const k = o.clientId || o.clientName;
    if (!firstOrder.has(k)) firstOrder.set(k, day(o.createdAt));
  }
  const bByWeek = new Map<string, Record<string, number>>();
  const batchFlower = new Map(batches.map((b) => [b.batchId, b.flowerType]));
  for (const b of batches) {
    if (!(b.quantityIn > 0)) continue;
    const w = weekStart(day(b.receivedAt) || b.harvestDate);
    const r = bByWeek.get(w) ?? {};
    r[b.flowerType] = (r[b.flowerType] ?? 0) + b.quantityIn;
    bByWeek.set(w, r);
  }
  const wByWeek = new Map<string, Record<string, number>>();
  for (const w of writeoffs) {
    const k = weekStart(day(w.createdAt));
    const f = batchFlower.get(w.batchId) ?? "?";
    const r = wByWeek.get(k) ?? {};
    r[f] = (r[f] ?? 0) + w.quantity;
    wByWeek.set(k, r);
  }
  console.log("Неделя с | заявок | клиентов (новых) | ср.чек | продано шт: роза/хриз/эуст | деньги | приход шт: роза/хриз/эуст | списано роза/хриз/эуст");
  for (const w of weeks) {
    const end = new Date(`${w}T12:00:00`);
    end.setDate(end.getDate() + 6);
    const we = end.toISOString().slice(0, 10);
    const list = sales.filter((o) => {
      const d = day(o.createdAt);
      return d >= w && d <= we;
    });
    const stems: Record<string, number> = {};
    for (const o of list) for (const i of o.items) stems[i.flowerType] = (stems[i.flowerType] ?? 0) + i.quantity;
    const money = list.reduce((s, o) => s + o.totalAmount, 0);
    const clients = new Set(list.map((o) => o.clientId || o.clientName));
    const fresh = Array.from(clients).filter((c) => {
      const f = firstOrder.get(c) || "";
      return f >= w && f <= we;
    }).length;
    const rec = bByWeek.get(w) ?? {};
    const wo = wByWeek.get(w) ?? {};
    const tri = (r: Record<string, number>) => ["rose", "chrysanthemum", "eustoma"].map((f) => n(r[f] ?? 0)).join("/");
    console.log(`${w} | ${list.length} | ${clients.size} (${fresh}) | ${n(list.length ? money / list.length : 0)} | ${tri(stems)} | ${n(money)} | ${tri(rec)} | ${tri(wo)}`);
  }

  // По менеджерам за 4 недели против 4 недель до этого.
  const d28 = new Date(`${today}T12:00:00`); d28.setDate(d28.getDate() - 28);
  const d56 = new Date(`${today}T12:00:00`); d56.setDate(d56.getDate() - 56);
  const a = d28.toISOString().slice(0, 10), b = d56.toISOString().slice(0, 10);
  const nameOf = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const per = new Map<string, { now: number; prev: number; nowN: number; prevN: number }>();
  for (const o of sales) {
    const d = day(o.createdAt);
    const k = nameOf.get(o.managerEmail.toLowerCase()) || o.managerEmail;
    const r = per.get(k) ?? { now: 0, prev: 0, nowN: 0, prevN: 0 };
    if (d >= a) { r.now += o.totalAmount; r.nowN++; } else if (d >= b) { r.prev += o.totalAmount; r.prevN++; }
    per.set(k, r);
  }
  console.log("\nМенеджеры: последние 28 дней против 28 до того (деньги, заявок)");
  for (const [k, r] of Array.from(per).sort((x, y) => y[1].now - x[1].now)) if (r.now || r.prev) console.log(`  ${k}: ${n(r.now)} (${r.nowN}) ← ${n(r.prev)} (${r.prevN})`);

  // Постоянные, которые перестали брать: 3+ заказа, последний 14+ дней назад.
  const byClient = new Map<string, { name: string; dates: string[]; money: number }>();
  for (const o of sales) {
    const k = o.clientId || o.clientName;
    const r = byClient.get(k) ?? { name: o.clientName, dates: [], money: 0 };
    r.dates.push(day(o.createdAt));
    r.money += o.totalAmount;
    byClient.set(k, r);
  }
  const lost = Array.from(byClient.values())
    .filter((c) => c.dates.length >= 3)
    .map((c) => ({ ...c, last: c.dates.sort().slice(-1)[0] }))
    .filter((c) => (Date.parse(today) - Date.parse(c.last)) / 86400000 >= 14)
    .sort((x, y) => y.money - x.money);
  console.log(`\nПостоянные (3+ заказа), не берут 14+ дней: ${lost.length}, на сумму за всё время ${n(lost.reduce((s, c) => s + c.money, 0))} ₸`);
  for (const c of lost.slice(0, 12)) console.log(`  ${c.name} · заказов ${c.dates.length} · ${n(c.money)} ₸ · последний ${c.last}`);
  const active = Array.from(byClient.values()).filter((c) => c.dates.some((d) => d >= a)).length;
  console.log(`Клиентов с заказом за 28 дней: ${active} из ${byClient.size} когда-либо покупавших`);

  // Склад против темпа.
  const now = new Date();
  const stock: Record<string, { live: number; old: number }> = {};
  for (const bt of batches) {
    if (!(bt.quantityRemaining > 0)) continue;
    const st = computeBatchStorageInfo(bt, settings, now).status;
    const r = stock[bt.flowerType] ?? { live: 0, old: 0 };
    if (st === "critical") r.old += bt.quantityRemaining; else r.live += bt.quantityRemaining;
    stock[bt.flowerType] = r;
  }
  console.log("\nСклад сейчас (живое / старше срока) и продано за 28 дней в день:");
  for (const f of ["rose", "chrysanthemum", "eustoma"]) {
    const sold = sales.filter((o) => day(o.createdAt) >= a).reduce((s, o) => s + o.items.filter((i) => i.flowerType === f).reduce((x, i) => x + i.quantity, 0), 0);
    const s = stock[f] ?? { live: 0, old: 0 };
    console.log(`  ${FL[f]}: ${n(s.live)} / ${n(s.old)} · продаём ${n(sold / 28)} в день · хватит на ${sold ? n(s.live / (sold / 28)) : "∞"} дн.`);
  }
  // Цены: средняя цена стебля по неделям для хризантемы и розы.
  console.log("\nСредняя цена стебля (₸) по 4-недельным окнам: роза / хриз");
  for (const [from, to, lbl] of [[b, a, "56–28 дн. назад"], [a, today, "последние 28 дн."]] as const) {
    const pr = (f: string) => {
      let q = 0, m = 0;
      for (const o of sales) {
        const d = day(o.createdAt);
        if (d < from || d > to) continue;
        for (const i of o.items) if (i.flowerType === f) { q += i.quantity; m += i.quantity * i.unitPrice; }
      }
      return q ? n(m / q) : "—";
    };
    console.log(`  ${lbl}: ${pr("rose")} / ${pr("chrysanthemum")}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
