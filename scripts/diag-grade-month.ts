/*
 * Сколько продали одной категории (по умолчанию хризантема «Третья») за месяц,
 * по менеджерам. Только чтение. Продажи — как везде: по дню оформления, без
 * отменённых, наших магазинов и опта на город; «Пожарка» — отдельной строкой.
 *
 * Запуск: npx tsx scripts/diag-grade-month.ts [2026-09] [Третья] [chrysanthemum]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listUsers } from "../src/lib/repo/users";
import { ORDER_STATUSES } from "../src/lib/constants";
import { isConsignment, isNotASale } from "../src/lib/orderKind";
import { localDayKey } from "../src/lib/timezone";

const month = process.argv[2] || "2026-09";
const grade = process.argv[3] || "Третья";
const flower = process.argv[4] || "chrysanthemum";
const n = (v: number) => Math.round(v).toLocaleString("ru-RU");

async function main() {
  const [orders, users] = await Promise.all([listOrdersWithItems(), listUsers()]);
  const name = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const rows = new Map<string, { stems: number; amount: number; orders: Set<string>; allFlower: number }>();
  for (const o of orders) {
    if (o.status === ORDER_STATUSES.CANCELLED || !o.createdAt) continue;
    if (localDayKey(new Date(o.createdAt)).slice(0, 7) !== month) continue;
    const point = isConsignment(o);
    if (!point && isNotASale(o)) continue;
    const key = point ? "Пожарка (на точку)" : name.get((o.managerEmail || "").toLowerCase()) || o.managerEmail || "—";
    for (const it of o.items) {
      if (it.flowerType !== flower) continue;
      const r = rows.get(key) ?? { stems: 0, amount: 0, orders: new Set<string>(), allFlower: 0 };
      r.allFlower += it.quantity;
      if (it.grade === grade) {
        r.stems += it.quantity;
        r.amount += it.quantity * it.unitPrice;
        r.orders.add(o.orderId);
      }
      rows.set(key, r);
    }
  }
  const list = Array.from(rows.entries()).sort((a, b) => b[1].stems - a[1].stems);
  const tot = list.reduce((s, [, r]) => ({ stems: s.stems + r.stems, amount: s.amount + r.amount, all: s.all + r.allFlower }), { stems: 0, amount: 0, all: 0 });
  console.log(`${flower} «${grade}», ${month}`);
  console.log("Кто | шт. | сумма | ср. цена | заявок | доля в его цветке");
  for (const [k, r] of list) {
    console.log(`${k} | ${n(r.stems)} | ${n(r.amount)} | ${r.stems ? n(r.amount / r.stems) : "-"} | ${r.orders.size} | ${r.allFlower ? Math.round((r.stems / r.allFlower) * 100) : 0}%`);
  }
  console.log(`ИТОГО | ${n(tot.stems)} | ${n(tot.amount)} | ${tot.stems ? n(tot.amount / tot.stems) : "-"} | | ${tot.all ? Math.round((tot.stems / tot.all) * 100) : 0}%`);
  const grades = new Map<string, number>();
  for (const o of orders) {
    if (o.status === ORDER_STATUSES.CANCELLED || !o.createdAt || localDayKey(new Date(o.createdAt)).slice(0, 7) !== month || (isNotASale(o) && !isConsignment(o))) continue;
    for (const it of o.items) if (it.flowerType === flower) grades.set(it.grade, (grades.get(it.grade) ?? 0) + it.quantity);
  }
  console.log("Для сравнения, все категории этого цветка за месяц, шт.: " + Array.from(grades.entries()).map(([g, q]) => `${g} ${n(q)}`).join("; "));
}

main().catch((err) => {
  console.error("ОШИБКА:", err instanceof Error ? err.message : err);
  process.exit(1);
});
