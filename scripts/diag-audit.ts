/*
 * Аудит живой базы: как на самом деле идёт работа.
 *
 * Скрипт НИЧЕГО НЕ МЕНЯЕТ — только читает и печатает сводку. Нужен для
 * профессионального разбора CRM: код показывает, что программа УМЕЕТ, а
 * данные — как ею ПОЛЬЗУЮТСЯ. Где заявки зависают, какие поля никто не
 * заполняет, где данные противоречат друг другу, какими разделами не
 * пользуются вовсе. Персональных данных не печатает — только счётчики и номера
 * заявок.
 *
 * Запуск: npx tsx scripts/diag-audit.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listBatches } from "../src/lib/repo/batches";
import { listUsers } from "../src/lib/repo/users";
import { listClients, nameKey } from "../src/lib/repo/clients";
import { listShipments } from "../src/lib/repo/shipments";
import { listWriteoffs } from "../src/lib/repo/writeoffs";
import { listPayments } from "../src/lib/repo/payments";
import { listClaims } from "../src/lib/repo/claims";
import { listMoneyLog } from "../src/lib/repo/moneyLog";
import { listStaffTakeouts } from "../src/lib/repo/staffTakeouts";
import { listPlans } from "../src/lib/repo/plans";
import { listShipmentPlans } from "../src/lib/repo/shipmentPlans";
import { listHarvestForecast } from "../src/lib/repo/harvestForecast";
import { listPriceHistory } from "../src/lib/repo/priceHistory";
import { getSettings } from "../src/lib/repo/settings";
import { getMaxShelfLifeDays, daysBetween } from "../src/lib/shelfLife";
import { isRegionOrder } from "../src/lib/orderKind";
import { isRetailOrder } from "../src/lib/retail";
import { isReadyToShip, notReadyReason } from "../src/lib/orderReady";

const n = (v: number) => Math.round(v).toLocaleString("ru-RU");
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "—");
const now = new Date(Date.now() + 5 * 3600 * 1000);
const today = now.toISOString().slice(0, 10);
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString().slice(0, 10);
const day = (s: string) => (s || "").slice(0, 10);
const hours = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
function median(xs: number[]): string {
  if (xs.length === 0) return "—";
  const s = [...xs].sort((a, b) => a - b);
  const m = s[Math.floor(s.length / 2)];
  return m < 48 ? `${Math.round(m)} ч` : `${(m / 24).toFixed(1)} дн`;
}
const h = (t: string) => console.log(`\n===== ${t} =====`);

async function safe<T>(f: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await f();
  } catch (e) {
    console.log(`  (не прочиталось: ${e instanceof Error ? e.message : e})`);
    return empty;
  }
}

async function main() {
  const [orders, batches, users, clients, shipments, writeoffs] = await Promise.all([
    listOrdersWithItems(),
    listBatches(),
    listUsers(),
    listClients(),
    listShipments(),
    listWriteoffs(),
  ]);
  const [payments, claims, log, takeouts, plans, shipPlans, forecast, prices, settings] = await Promise.all([
    safe(listPayments, []),
    safe(listClaims, []),
    safe(listMoneyLog, []),
    safe(listStaffTakeouts, []),
    safe(listPlans, []),
    safe(listShipmentPlans, []),
    safe(listHarvestForecast, []),
    safe(listPriceHistory, []),
    getSettings(),
  ]);
  const roleOf = new Map(users.map((u) => [u.email.toLowerCase(), u.role]));

  console.log(`Сегодня (Алматы): ${today}`);
  h("Сотрудники");
  const byRole = new Map<string, number>();
  for (const u of users.filter((u) => u.active)) byRole.set(u.role, (byRole.get(u.role) ?? 0) + 1);
  console.log([...byRole].map(([r, c]) => `${r}: ${c}`).join(", "), `| неактивных: ${users.filter((u) => !u.active).length}`);

  h("Заявки — объём");
  const kindOf = (o: (typeof orders)[number]) => (isRegionOrder(o) ? "регион" : isRetailOrder(o) ? "розница" : "клиент");
  const live = orders.filter((o) => o.status !== "cancelled");
  console.log(`Всего: ${orders.length}, отменено: ${orders.length - live.length}`);
  const byStatus = new Map<string, number>();
  for (const o of orders) byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
  console.log("По статусу:", [...byStatus].map(([s, c]) => `${s}=${c}`).join(", "));
  const byKind = new Map<string, number>();
  for (const o of live) byKind.set(kindOf(o), (byKind.get(kindOf(o)) ?? 0) + 1);
  console.log("По виду:", [...byKind].map(([s, c]) => `${s}=${c}`).join(", "));
  const firstDay = orders.map((o) => day(o.createdAt)).filter(Boolean).sort()[0];
  console.log(`Первая заявка: ${firstDay}. За последние 7 дней: ${live.filter((o) => day(o.createdAt) >= daysAgo(7)).length}, за 30: ${live.filter((o) => day(o.createdAt) >= daysAgo(30)).length}`);
  const perDay = new Map<string, number>();
  for (const o of live) if (day(o.createdAt) >= daysAgo(14)) perDay.set(day(o.createdAt), (perDay.get(day(o.createdAt)) ?? 0) + 1);
  console.log("По дням (14 дн):", [...perDay].sort().map(([d, c]) => `${d.slice(5)}:${c}`).join(" "));

  h("Кто оформляет (30 дней, по роли автора)");
  const byAuthor = new Map<string, number>();
  for (const o of live.filter((o) => day(o.createdAt) >= daysAgo(30))) {
    const r = roleOf.get(o.managerEmail.toLowerCase()) ?? "?";
    byAuthor.set(r, (byAuthor.get(r) ?? 0) + 1);
  }
  console.log([...byAuthor].map(([r, c]) => `${r}: ${c}`).join(", "));

  h("Жизненный цикл: сколько времени между этапами (медиана, клиентские заявки)");
  const client = live.filter((o) => kindOf(o) === "клиент");
  const firstShip = new Map<string, string>();
  for (const s of shipments) {
    const prev = firstShip.get(s.orderId);
    if (!prev || s.createdAt < prev) firstShip.set(s.orderId, s.createdAt);
  }
  const conf = client.filter((o) => o.managerConfirmedAt).map((o) => hours(o.createdAt, o.managerConfirmedAt)).filter((x) => x >= 0);
  const paid = client.filter((o) => o.paidAt && o.createdAt).map((o) => hours(o.createdAt, o.paidAt)).filter((x) => x >= 0);
  const ship = client.filter((o) => firstShip.has(o.orderId)).map((o) => hours(o.createdAt, firstShip.get(o.orderId)!)).filter((x) => x >= 0);
  console.log(`оформлена → подтверждена менеджером: ${median(conf)} (из ${conf.length})`);
  console.log(`оформлена → первые деньги: ${median(paid)} (из ${paid.length})`);
  console.log(`оформлена → первая отгрузка: ${median(ship)} (из ${ship.length})`);
  const lateShip = live.filter((o) => o.deliveryDate && firstShip.has(o.orderId) && day(firstShip.get(o.orderId)!) > day(o.deliveryDate));
  const shipped = live.filter((o) => firstShip.has(o.orderId) && o.deliveryDate);
  console.log(`Отгрузка отмечена ПОЗЖЕ дня доставки: ${lateShip.length} из ${shipped.length} (${pct(lateShip.length, shipped.length)})`);

  h("Зависшие и противоречивые заявки");
  const open = live.filter((o) => o.status !== "shipped");
  const left = (o: (typeof orders)[number]) => o.items.reduce((s, i) => s + Math.max(0, i.quantity - i.shippedQuantity), 0);
  const pastOpen = open.filter((o) => o.deliveryDate && day(o.deliveryDate) < today);
  console.log(`Открытые (не отгружены, не отменены): ${open.length}`);
  console.log(`  из них доставка уже ПРОШЛА: ${pastOpen.length}, стеблей ${n(pastOpen.reduce((s, o) => s + left(o), 0))}`);
  const reasons = new Map<string, number>();
  for (const o of pastOpen) {
    const r = isReadyToShip(o) ? "готова, но не отгружена" : (notReadyReason(o) || "?").replace(/\d[\d\s]*₸/g, "N ₸");
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  for (const [r, c] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`    ${c} × ${r}`);
  const byAge = [3, 7, 14].map((d) => `${d}+ дн: ${pastOpen.filter((o) => day(o.deliveryDate) < daysAgo(d)).length}`);
  console.log(`    по давности: ${byAge.join(", ")}`);
  console.log(`  без даты доставки: ${open.filter((o) => !o.deliveryDate).length}`);
  console.log(`  не подтверждены менеджером дольше 2 дней: ${open.filter((o) => !o.managerConfirmed && day(o.createdAt) < daysAgo(2)).length}`);
  const partly = open.filter((o) => o.items.some((i) => i.shippedQuantity > 0));
  console.log(`  отгружены частично: ${partly.length}`);
  const allShippedNotClosed = open.filter((o) => o.items.length > 0 && o.items.every((i) => i.shippedQuantity >= i.quantity));
  console.log(`  ПРОТИВОРЕЧИЕ: всё отгружено, а статус не «отгружена»: ${allShippedNotClosed.length} ${allShippedNotClosed.map((o) => o.orderId).slice(0, 5).join(" ")}`);
  const shippedNotFull = live.filter((o) => o.status === "shipped" && o.items.some((i) => i.shippedQuantity < i.quantity));
  console.log(`  статус «отгружена», но отгружено меньше заказанного: ${shippedNotFull.length}`);
  const cancelledShipped = orders.filter((o) => o.status === "cancelled" && o.items.some((i) => i.shippedQuantity > 0));
  console.log(`  ПРОТИВОРЕЧИЕ: отменена, но есть отгрузка: ${cancelledShipped.length}`);
  console.log(`  без позиций: ${live.filter((o) => o.items.length === 0).length}`);
  const statusesUsed = new Set(orders.map((o) => o.status));
  console.log(`  используемые статусы: ${[...statusesUsed].join(", ")}`);

  h("Отгрузки против позиций");
  const shipSum = new Map<string, number>();
  for (const s of shipments) shipSum.set(s.itemId, (shipSum.get(s.itemId) ?? 0) + s.quantity);
  let itemMismatch = 0;
  for (const o of orders) for (const i of o.items) if (Math.abs((shipSum.get(i.itemId) ?? 0) - i.shippedQuantity) > 0) itemMismatch++;
  console.log(`Позиций, где «отгружено» не равно сумме записей отгрузок: ${itemMismatch}`);
  const orphanShip = shipments.filter((s) => !orders.some((o) => o.orderId === s.orderId)).length;
  console.log(`Отгрузок без заявки: ${orphanShip}`);

  h("Деньги");
  const money = live.filter((o) => kindOf(o) === "клиент");
  const debt = money.reduce((s, o) => s + Math.max(0, o.totalAmount - o.paidAmount), 0);
  const billed = money.reduce((s, o) => s + o.totalAmount, 0);
  console.log(`Выставлено всего: ${n(billed)} ₸, получено: ${n(money.reduce((s, o) => s + Math.min(o.paidAmount, o.totalAmount), 0))} ₸, долг: ${n(debt)} ₸`);
  const payByOrder = new Map<string, number>();
  for (const p of payments) payByOrder.set(p.orderId, (payByOrder.get(p.orderId) ?? 0) + p.amount);
  const paidNoRows = money.filter((o) => o.paidAmount > 0 && !payByOrder.has(o.orderId)).length;
  const rowsMismatch = money.filter((o) => payByOrder.has(o.orderId) && Math.abs(payByOrder.get(o.orderId)! - o.paidAmount) > 1).length;
  console.log(`Платежей в журнале: ${payments.length}. Заявок с деньгами без строк журнала: ${paidNoRows}; где журнал не сходится с итогом: ${rowsMismatch}`);
  const flagMismatch = money.filter((o) => o.paid !== (o.paidAmount >= o.totalAmount - 1 && o.totalAmount > 0)).length;
  console.log(`Флаг «оплачено» противоречит сумме: ${flagMismatch}`);
  const over = money.filter((o) => o.paidAmount > o.totalAmount + 1);
  console.log(`Переплата: ${over.length} заявок на ${n(over.reduce((s, o) => s + o.paidAmount - o.totalAmount, 0))} ₸`);
  const zeroPrice = money.filter((o) => o.items.some((i) => !(i.unitPrice > 0)));
  console.log(`Клиентских заявок с позицией без цены: ${zeroPrice.length}`);
  const noClientId = money.filter((o) => !o.clientId).length;
  console.log(`Клиентских заявок без карточки клиента: ${noClientId}`);
  console.log(`Отметка «счёт отправлен»: ${pct(money.filter((o) => o.invoiceSentAt).length, money.length)} заявок; номер 1С: ${pct(money.filter((o) => o.realization1c).length, money.length)}; обещание оплаты: ${money.filter((o) => o.promisedAt).length}; заметка о звонке: ${money.filter((o) => o.collectionNote).length}`);
  const methods = new Map<string, number>();
  for (const o of money) methods.set(o.paymentMethod || "(пусто)", (methods.get(o.paymentMethod || "(пусто)") ?? 0) + 1);
  console.log("Вид оплаты:", [...methods].map(([m, c]) => `${m}=${c}`).join(", "));

  h("Клиенты");
  const act = clients.filter((c) => c.active && !c.retail);
  console.log(`Карточек клиентов: ${act.length} (+ магазинов/городов: ${clients.filter((c) => c.retail).length})`);
  const lastOrder = new Map<string, string>();
  for (const o of money) if (o.clientId) lastOrder.set(o.clientId, [lastOrder.get(o.clientId) ?? "", day(o.createdAt)].sort()[1]);
  console.log(`Ни разу не заказывали: ${act.filter((c) => !lastOrder.has(c.clientId)).length}; молчат 30+ дней: ${act.filter((c) => lastOrder.has(c.clientId) && lastOrder.get(c.clientId)! < daysAgo(30)).length}; 14+ дней: ${act.filter((c) => lastOrder.has(c.clientId) && lastOrder.get(c.clientId)! < daysAgo(14)).length}`);
  const ordersPerClient = new Map<string, number>();
  for (const o of money) if (o.clientId) ordersPerClient.set(o.clientId, (ordersPerClient.get(o.clientId) ?? 0) + 1);
  console.log(`Повторных (2+ заявки): ${[...ordersPerClient.values()].filter((c) => c >= 2).length} из ${ordersPerClient.size}`);
  console.log(`Без телефона: ${act.filter((c) => !c.phone).length}; без условий оплаты: ${act.filter((c) => !c.paymentTerms).length}; без типа точки: ${act.filter((c) => !c.clientType).length}; без источника: ${act.filter((c) => !c.source).length}; без менеджера: ${act.filter((c) => !c.managerEmail).length}`);
  const terms = new Map<string, number>();
  for (const c of act) terms.set(c.paymentTerms || "(пусто)", (terms.get(c.paymentTerms || "(пусто)") ?? 0) + 1);
  console.log("Условия оплаты:", [...terms].map(([m, c]) => `${m}=${c}`).join(", "));
  const keys = new Map<string, number>();
  for (const c of act) keys.set(nameKey(c.name), (keys.get(nameKey(c.name)) ?? 0) + 1);
  console.log(`Похожие названия (двойники?): ${[...keys.values()].filter((c) => c > 1).length}`);

  h("Склад");
  const withStock = batches.filter((b) => b.quantityRemaining > 0);
  console.log(`Партий: ${batches.length}, с остатком: ${withStock.length}, стеблей на складе: ${n(withStock.reduce((s, b) => s + b.quantityRemaining, 0))}`);
  console.log(`ПРОТИВОРЕЧИЕ: остаток < 0: ${batches.filter((b) => b.quantityRemaining < 0).length}; остаток > принятого: ${batches.filter((b) => b.quantityRemaining > b.quantityIn).length}; без даты срезки: ${batches.filter((b) => !b.harvestDate).length}`);
  const expired = withStock.filter((b) => b.harvestDate && daysBetween(b.harvestDate, now) > getMaxShelfLifeDays(b.flowerType, settings));
  console.log(`Лежит дольше срока хранения: ${expired.length} партий, ${n(expired.reduce((s, b) => s + b.quantityRemaining, 0))} стеблей (${pct(expired.reduce((s, b) => s + b.quantityRemaining, 0), withStock.reduce((s, b) => s + b.quantityRemaining, 0))} склада)`);
  const recv30 = batches.filter((b) => day(b.receivedAt) >= daysAgo(30)).reduce((s, b) => s + b.quantityIn, 0);
  const wo30 = writeoffs.filter((w) => day(w.createdAt) >= daysAgo(30)).reduce((s, w) => s + w.quantity, 0);
  const sh30 = shipments.filter((s) => day(s.createdAt) >= daysAgo(30)).reduce((s, x) => s + x.quantity, 0);
  console.log(`30 дней: принято ${n(recv30)}, отгружено ${n(sh30)}, списано ${n(wo30)} (${pct(wo30, recv30)} от принятого)`);
  const recvDays = new Set(batches.filter((b) => day(b.receivedAt) >= daysAgo(14)).map((b) => day(b.receivedAt)));
  console.log(`Дней с приёмкой за последние 14: ${recvDays.size}`);
  const reservedOpen = open.filter((o) => o.status !== "cancelled").reduce((s, o) => s + left(o), 0);
  console.log(`Заказано и не отгружено по открытым заявкам: ${n(reservedOpen)} стеблей`);

  h("Прочие разделы — пользуются ли");
  console.log(`Рекламаций: ${claims.length}, открытых: ${claims.filter((c) => c.status === "open" || !c.status).length}`);
  const logActs = new Map<string, number>();
  for (const l of log.filter((l) => day(l.createdAt) >= daysAgo(30))) logActs.set(l.action, (logActs.get(l.action) ?? 0) + 1);
  console.log("Журнал денег, 30 дней:", [...logActs].map(([a, c]) => `${a}=${c}`).join(", "));
  console.log(`Выдач сотрудникам: ${takeouts.filter((t) => t.kind !== "company").length}, нужд компании: ${takeouts.filter((t) => t.kind === "company").length}, без цены: ${takeouts.filter((t) => !(t.unitPrice > 0)).length}`);
  const month = today.slice(0, 7);
  console.log(`Планы менеджерам на ${month}: ${plans.filter((p) => p.period.startsWith(month)).length} строк (всего ${plans.length})`);
  console.log(`План отгрузок: ${shipPlans.length} строк; прогноз срезки: ${forecast.length} строк`);
  const lastPrice = prices.map((p) => p.date).sort().pop();
  console.log(`Прайс: ${prices.length} строк, последнее изменение ${lastPrice ?? "—"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
