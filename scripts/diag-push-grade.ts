/*
 * Сколько лежит одной категории и кто её берёт — перед тем как «усиленно распродать» (13.10.2026, владелец:
 * «распродай 4 категорию хризантемы, её много»). Только чтение.
 *
 *   npx tsx scripts/diag-push-grade.ts [Четвёртая] [chrysanthemum]
 *
 * Печатает: склад цветка по категориям (живое / дольше срока, основной / офис), эту категорию по сортам с возрастом
 * и ценой из прайса; продажи этой категории за 30 дней по неделям и кто покупал (клиенты, менеджеры); что про неё
 * сказано в указаниях боту.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listBatches } from "../src/lib/repo/batches";
import { getSettings } from "../src/lib/repo/settings";
import { getCurrentPrices } from "../src/lib/repo/prices";
import { priceFor } from "../src/lib/priceList";
import { computeBatchStorageInfo } from "../src/lib/shelfLife";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listUsers } from "../src/lib/repo/users";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { botSettingsFrom } from "../src/lib/broadcast";
import { ORDER_STATUSES, compareGrades } from "../src/lib/constants";
import { isConsignment, isNotASale } from "../src/lib/orderKind";
import { localDayKey } from "../src/lib/timezone";

const grade = process.argv[2] || "Четвёртая";
const flower = process.argv[3] || "chrysanthemum";
const n = (v: number) => Math.round(v).toLocaleString("ru-RU");

async function main() {
  await prefetchTables([SHEET_TABS.BATCHES, SHEET_TABS.SETTINGS, SHEET_TABS.PRICE_HISTORY, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.USERS]);
  const now = new Date();
  const [batches, settings, prices, orders, users, map] = await Promise.all([listBatches(), getSettings(), getCurrentPrices(), listOrdersWithItems(), listUsers(), settingsMap()]);

  console.log(`=== Склад: ${flower} по категориям (живое / дольше срока) ===`);
  const byGrade = new Map<string, { live: number; old: number; office: number }>();
  const target = new Map<string, { live: number; old: number; ages: number[]; batches: number }>();
  for (const b of batches) {
    if (b.flowerType !== flower || !(b.quantityRemaining > 0)) continue;
    const info = computeBatchStorageInfo(b, settings, now);
    const old = info.status === "critical";
    const g = byGrade.get(b.grade) ?? { live: 0, old: 0, office: 0 };
    if (old) g.old += b.quantityRemaining;
    else g.live += b.quantityRemaining;
    if (b.store) g.office += b.quantityRemaining;
    byGrade.set(b.grade, g);
    if (b.grade === grade) {
      const t = target.get(b.variety) ?? { live: 0, old: 0, ages: [], batches: 0 };
      if (old) t.old += b.quantityRemaining;
      else t.live += b.quantityRemaining;
      for (let i = 0; i < Math.min(b.quantityRemaining, 1); i++) t.ages.push(info.daysInStorage);
      t.batches++;
      target.set(b.variety, t);
    }
  }
  for (const [g, v] of Array.from(byGrade.entries()).sort((a, b) => compareGrades(flower, a[0], b[0]))) {
    console.log(`${g}: живое ${n(v.live)} · дольше срока ${n(v.old)}${v.office ? ` · из них в офисе ${n(v.office)}` : ""}`);
  }
  console.log(`\n=== «${grade}» по сортам ===`);
  console.log("сорт | живое | дольше срока | партий | дней с срезки (мин–макс) | цена в прайсе");
  for (const [v, t] of Array.from(target.entries()).sort((a, b) => b[1].live - a[1].live)) {
    const ages = t.ages.sort((a, b) => a - b);
    console.log(`${v || "—"} | ${n(t.live)} | ${n(t.old)} | ${t.batches} | ${ages[0] ?? "-"}–${ages[ages.length - 1] ?? "-"} | ${priceFor(prices, flower, v, grade) || "нет цены"}`);
  }
  const otherPrices = ["Третья", "Вторая", "Первая", "Высшая"].map((g) => `${g} ${priceFor(prices, flower, "Altaj", g) || "-"}`).join(" · ");
  console.log(`для сравнения (Altaj): ${otherPrices}`);

  console.log(`\n=== Продажи «${grade}» за 30 дней ===`);
  const from = localDayKey(new Date(now.getTime() - 30 * 86_400_000));
  const name = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const byWeek = new Map<string, number>();
  const byClient = new Map<string, { stems: number; orders: number; last: string; phone: string }>();
  const byManager = new Map<string, number>();
  let flowerAll = 0;
  let stems = 0;
  for (const o of orders) {
    if (o.status === ORDER_STATUSES.CANCELLED || !o.createdAt) continue;
    const day = localDayKey(new Date(o.createdAt));
    if (day < from) continue;
    if (isNotASale(o) && !isConsignment(o)) continue;
    let mine = 0;
    for (const it of o.items) {
      if (it.flowerType !== flower) continue;
      flowerAll += it.quantity;
      if (it.grade === grade) mine += it.quantity;
    }
    if (!mine) continue;
    stems += mine;
    const wk = day.slice(5);
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + mine);
    const c = byClient.get(o.clientName) ?? { stems: 0, orders: 0, last: "", phone: "" };
    c.stems += mine;
    c.orders++;
    c.last = c.last > day ? c.last : day;
    c.phone = c.phone || (o.clientPhone ? `…${o.clientPhone.replace(/\D/g, "").slice(-4)}` : "");
    byClient.set(o.clientName, c);
    const m = isConsignment(o) ? "Пожарка" : name.get((o.managerEmail || "").toLowerCase()) || o.managerEmail;
    byManager.set(m, (byManager.get(m) ?? 0) + mine);
  }
  console.log(`всего ${n(stems)} шт. из ${n(flowerAll)} шт. ${flower} (${flowerAll ? Math.round((stems / flowerAll) * 100) : 0}%)`);
  console.log("по дням: " + Array.from(byWeek.entries()).sort().map(([d, q]) => `${d} ${n(q)}`).join("; "));
  console.log("менеджеры: " + Array.from(byManager.entries()).sort((a, b) => b[1] - a[1]).map(([m, q]) => `${m} ${n(q)}`).join("; "));
  console.log(`клиенты (${byClient.size}):`);
  for (const [c, v] of Array.from(byClient.entries()).sort((a, b) => b[1].stems - a[1].stems).slice(0, 30)) {
    console.log(`  ${c} ${v.phone} · ${n(v.stems)} шт. · заявок ${v.orders} · последняя ${v.last}`);
  }
  const instr = botSettingsFrom(map).instructions;
  const lines = instr.split(/\n/).filter((l) => /четв|4\s*кат|4-?я/i.test(l));
  console.log(`\n=== Указания боту про «${grade}» ===\n${lines.join("\n") || "нет"}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
