import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Фуры в регионы — как это устроено в живой базе (17.11.2026, владелец: «раз в неделю грузим фуры в регионы, куда едут
 * цветы на ритейл и опт; хотим подключить директоров Караганды, Астаны, Семея и Усть-Каменогорска»). Только чтение.
 * Печатает: объём на город и заявки в наши магазины регионов по городам и дням недели, кто их заводил, что лежит на
 * региональных складах, кто посажен в города (`ManagerProfiles`), менеджеров.
 *
 *   npx tsx scripts/diag-region-trucks.ts [дней назад = 35]
 */
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listUsers } from "../src/lib/repo/users";
import { listBatches } from "../src/lib/repo/batches";
import { listClients } from "../src/lib/repo/clients";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { isRegionOrder } from "../src/lib/orderKind";
import { isRetailOrder, isRegionShop } from "../src/lib/retail";
import { ORDER_STATUSES } from "../src/lib/constants";
import { MANAGER_PROFILES_SETTING, parseManagerProfiles, isoWeekday } from "../src/lib/managerProfile";
import { normalizeStore, storeLabel } from "../src/lib/officeStore";
import { cleanDirection } from "../src/lib/direction";

const DAYS = ["", "пн", "вт", "ср", "чт", "пт", "сб", "вс"];

async function main() {
  const days = Number(process.argv[2]) || 35;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const [orders, users, batches, clients, settings] = await Promise.all([listOrdersWithItems(), listUsers(), listBatches(), listClients(), settingsMap()]);
  const nameOf = (email: string) => {
    const u = users.find((x) => x.email.toLowerCase() === (email || "").toLowerCase());
    return u ? `${u.name} (${u.role})` : "(нет сотрудника)";
  };
  const live = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && (o.deliveryDate || "") >= since);

  console.log(`== Объём на город за ${days} дн. (с ${since})`);
  const region = live.filter((o) => isRegionOrder(o));
  const byCity = new Map<string, typeof region>();
  for (const o of region) {
    const k = cleanDirection(o.direction) || "(без направления)";
    byCity.set(k, [...(byCity.get(k) ?? []), o]);
  }
  for (const [city, list] of byCity) {
    const stems = list.reduce((s, o) => s + o.items.reduce((x, i) => x + i.quantity, 0), 0);
    const wd = new Map<string, number>();
    const who = new Map<string, number>();
    for (const o of list) {
      const d = DAYS[isoWeekday(o.deliveryDate)] ?? "?";
      wd.set(d, (wd.get(d) ?? 0) + 1);
      who.set(nameOf(o.managerEmail), (who.get(nameOf(o.managerEmail)) ?? 0) + 1);
    }
    const dates = Array.from(new Set(list.map((o) => o.deliveryDate))).sort();
    console.log(`${city}: заявок ${list.length}, стеблей ${stems}; дни: ${Array.from(wd).map(([d, n]) => `${d} ${n}`).join(", ")}; кто: ${Array.from(who).map(([n, c]) => `${n} ${c}`).join(", ")}`);
    console.log(`   даты: ${dates.join(", ")}`);
  }

  console.log(`\n== Заявки в наши магазины регионов (розница) за ${days} дн.`);
  const retail = live.filter((o) => isRetailOrder(o) && (o.retail || "").trim() === "regions");
  const byShop = new Map<string, typeof retail>();
  for (const o of retail) byShop.set(o.clientName || "(без имени)", [...(byShop.get(o.clientName || "(без имени)") ?? []), o]);
  for (const [shop, list] of byShop) {
    const stems = list.reduce((s, o) => s + o.items.reduce((x, i) => x + i.quantity, 0), 0);
    const wd = new Map<string, number>();
    const who = new Map<string, number>();
    for (const o of list) {
      const d = DAYS[isoWeekday(o.deliveryDate)] ?? "?";
      wd.set(d, (wd.get(d) ?? 0) + 1);
      who.set(nameOf(o.managerEmail), (who.get(nameOf(o.managerEmail)) ?? 0) + 1);
    }
    console.log(`${shop}: заявок ${list.length}, стеблей ${stems}; дни: ${Array.from(wd).map(([d, n]) => `${d} ${n}`).join(", ")}; кто: ${Array.from(who).map(([n, c]) => `${n} ${c}`).join(", ")}`);
  }
  if (retail.length === 0) console.log("нет");
  console.log(`Карточки розницы регионов: ${clients.filter((c) => isRegionShop(c)).map((c) => `${c.name} [${c.city}]${c.active ? "" : " выкл"}`).join("; ") || "нет"}`);

  console.log("\n== Клиентские заявки в города регионов (не объём, не наши магазины) за тот же срок");
  const cityOfClient = new Map(clients.map((c) => [c.clientId, c.city]));
  const cities = ["Астана", "Караганда", "Семей", "Усть-Каменогорск"];
  for (const city of cities) {
    const list = live.filter((o) => !isRegionOrder(o) && !isRetailOrder(o) && (cleanDirection(o.direction) === city || cleanDirection(cityOfClient.get(o.clientId || "") || "") === city));
    const sum = list.reduce((s, o) => s + o.items.reduce((x, i) => x + i.quantity * i.unitPrice, 0), 0);
    const who = new Map<string, number>();
    const stores = new Map<string, number>();
    for (const o of list) {
      who.set(nameOf(o.managerEmail), (who.get(nameOf(o.managerEmail)) ?? 0) + 1);
      stores.set(storeLabel(o.store), (stores.get(storeLabel(o.store)) ?? 0) + 1);
    }
    console.log(`${city}: заявок ${list.length}, на ${Math.round(sum)} тг; кто: ${Array.from(who).map(([n, c]) => `${n} ${c}`).join(", ") || "-"}; склад: ${Array.from(stores).map(([n, c]) => `${n} ${c}`).join(", ") || "-"}`);
  }

  console.log("\n== Региональные склады сейчас");
  const byStore = new Map<string, { stems: number; batches: number }>();
  for (const b of batches) {
    const st = normalizeStore(b.store);
    if (!st || st === "office" || b.quantityRemaining <= 0) continue;
    const r = byStore.get(st) ?? { stems: 0, batches: 0 };
    r.stems += b.quantityRemaining;
    r.batches += 1;
    byStore.set(st, r);
  }
  for (const [st, r] of byStore) console.log(`${storeLabel(st)}: ${r.stems} шт. в ${r.batches} парт.`);
  if (byStore.size === 0) console.log("пусто");

  console.log("\n== Кто посажен в города (ManagerProfiles)");
  const profiles = parseManagerProfiles(settings[MANAGER_PROFILES_SETTING]);
  for (const [email, p] of Object.entries(profiles)) console.log(`${nameOf(email)}: город «${p.city}», фура ${p.shipWeekday ? DAYS[p.shipWeekday] : "-"}, напористый ${p.closer ? "да" : "нет"}`);

  console.log("\n== Менеджеры и розница регионов (активные)");
  for (const u of users.filter((x) => x.active && (x.role === "manager" || x.role === "retail_regions"))) console.log(`${u.name} — ${u.role}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
