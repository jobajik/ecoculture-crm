/*
 * Регионы — что настроено по каждому городу (24.11.2026, владелец завёл менеджеров Астаны и Караганды и купил инстанс
 * Green API: «теперь сделай все настройки»). Ничего не меняет; ключи, почты и полные номера не печатает.
 *
 * По городу: кто посажен (роль, активен ли, есть ли номер WhatsApp в карточке, род для ИИ, день фуры, видит ли деньги
 * города), подключён ли его номер WhatsApp к CRM (ключи, состояние у Green API сейчас, режим помощника, сколько
 * переписки; адрес уведомлений — `diag-line-hook.ts <код>`), есть ли у города карточка розницы (без неё заказ «в магазины» не подать), адрес
 * самовывоза, что лежит на складе города, сколько клиентов в городе и чьи они, заказы на фуру.
 *
 * Запуск: npx tsx scripts/diag-region-setup.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { getInstanceState } from "../src/lib/greenApi";
import { listUsers } from "../src/lib/repo/users";
import { listClients } from "../src/lib/repo/clients";
import { listBatches } from "../src/lib/repo/batches";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listWaMessages } from "../src/lib/repo/talks";
import { listWaLines, managerLineConfig } from "../src/lib/repo/waLines";
import { managerProfiles } from "../src/lib/repo/regionStore";
import { REGION_STORES, inStore, regionStoreForCity } from "../src/lib/officeStore";
import { regionSeat, retailCardsOf, truckKindOf } from "../src/lib/regionTruck";
import { pickupPointFor } from "../src/lib/pickupPoints";
import { ORDER_STATUSES } from "../src/lib/constants";

const DAYS = ["", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
const tail = (p: string | null | undefined) => {
  const d = String(p ?? "").replace(/\D/g, "");
  return d ? `…${d.slice(-4)}` : "нет";
};

async function main() {
  const [users, clients, batches, orders, lines, msgs, profiles] = await Promise.all([
    listUsers(),
    listClients(),
    listBatches(),
    listOrdersWithItems(),
    listWaLines({ fresh: true }),
    listWaMessages({ lines: "all" }),
    managerProfiles(true),
  ]);
  const userOf = (email: string) => users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  console.log(`Номеров менеджеров в CRM всего: ${lines.length} (${lines.map((l) => `${userOf(l.managerEmail)?.name?.split(/\s+/)[0] || "?"}${l.tokenEnc ? "" : " — без ключей"}`).join(", ") || "нет"})`);

  for (const info of REGION_STORES) {
    const seat = regionSeat(profiles, info.code);
    console.log(`\n================ ${info.label} ================`);
    console.log(`Фура: ${DAYS[seat.truckWeekday] || "?"} · самовывоз: ${pickupPointFor(info.label)?.address ?? "АДРЕСА НЕТ"}`);
    const people = [...seat.directors.map((e) => ({ e, main: true })), ...seat.managers.map((e) => ({ e, main: false }))];
    if (people.length === 0) console.log("Менеджер города: НЕ НАЗНАЧЕН");
    for (const { e, main } of people) {
      const u = userOf(e);
      const p = profiles[Object.keys(profiles).find((k) => k.toLowerCase() === e.toLowerCase()) ?? ""];
      console.log(
        `\nМенеджер: ${u?.name || "НЕТ В СОТРУДНИКАХ"} · роль ${u?.role || "-"} · ${u ? (u.active ? "активен" : "ОТКЛЮЧЁН") : ""} · ${main ? "главный (видит оплаты и долги города)" : "без оплат и долгов города"}` +
          ` · WhatsApp в карточке: ${tail(u?.phone)} · род для ИИ: ${p?.female ? "женский" : "мужской"} · напористый: ${p?.closer ? "да" : "нет"}`
      );
      const line = lines.find((l) => l.managerEmail.toLowerCase() === e.toLowerCase());
      if (!line) {
        console.log("  Номер WhatsApp в CRM: НЕ ЗАВЕДЁН (нет строки в «WhatsApp менеджеров»)");
      } else {
        const cfg = managerLineConfig(line);
        let now = "нет ключей";
        if (cfg) {
          try {
            now = await getInstanceState(cfg);
          } catch (err) {
            now = `не ответил: ${err instanceof Error ? err.message : err}`;
          }
        }
        const lm = msgs.filter((m) => m.line === line.code);
        const week = lm.filter((m) => Date.parse(m.at) >= Date.now() - 7 * 86400000);
        console.log(`  Номер WhatsApp в CRM: ключи ${line.tokenEnc ? "есть" : "НЕТ"} · включён ${line.active} · у Green API сейчас: ${now} · номер ${tail(line.phone)} · помощник: ${line.assistant} · код линии ${line.code}`);
        console.log(`  Переписка: всего ${lm.length} сообщ., за 7 дн. ${week.length} (входящих ${week.filter((m) => m.direction === "in").length}), чатов ${new Set(lm.map((m) => m.phone)).size}`);
      }
      const own = clients.filter((c) => (c.managerEmail || "").toLowerCase() === e.toLowerCase() && !c.retail);
      console.log(`  Клиентов на менеджере: ${own.length} (из них в ${info.label}: ${own.filter((c) => regionStoreForCity(c.city) === info.code).length})`);
    }
    const cityClients = clients.filter((c) => !c.retail && c.active && regionStoreForCity(c.city) === info.code);
    const byManager = new Map<string, number>();
    for (const c of cityClients) byManager.set(c.managerEmail || "", (byManager.get(c.managerEmail || "") ?? 0) + 1);
    console.log(`\nКлиентов города в базе: ${cityClients.length} — ${Array.from(byManager.entries()).sort((a, b) => b[1] - a[1]).map(([e, n]) => `${userOf(e)?.name?.split(/\s+/)[0] || (e ? "?" : "ничьи")}: ${n}`).join(", ") || "нет"}`);
    const cards = retailCardsOf(clients, info.code);
    console.log(`Карточка розницы города (для заказа «в магазины»): ${cards.length ? cards.map((c) => c.name).join(", ") : "НЕТ"}`);
    const stock = inStore(batches, info.code).filter((b) => b.quantityRemaining > 0);
    console.log(`Склад города: ${stock.reduce((s, b) => s + b.quantityRemaining, 0)} шт., позиций ${new Set(stock.map((b) => `${b.flowerType}|${b.variety}|${b.grade}`)).size}`);
    const cardIds = new Set(cards.map((c) => c.clientId));
    const trucks = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && truckKindOf(o, info.code, cardIds) && (o.deliveryDate || "") >= new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10));
    console.log(`Заказы на фуру за 10 дн. и вперёд: ${trucks.length}${trucks.length ? ` — ${trucks.map((o) => `${o.deliveryDate} ${o.status} ${o.items.reduce((s, i) => s + i.quantity, 0)} шт.`).join("; ")}` : ""}`);
    const open = orders.filter((o) => o.store === info.code && !o.kind && !o.retail && o.status !== ORDER_STATUSES.CANCELLED && o.status !== ORDER_STATUSES.SHIPPED);
    console.log(`Открытые заявки клиентам со склада города: ${open.length}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
