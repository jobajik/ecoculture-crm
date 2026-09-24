/*
 * Диагностика денег: как на самом деле лежат оплаты, платежи и долги в живой
 * базе — чтобы «Оплаты → Аналитика» строилась по настоящим данным.
 * НИЧЕГО НЕ МЕНЯЕТ. Телефонов не печатает — только счётчики, суммы и названия.
 *
 * Запуск: npx tsx scripts/diag-finance.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listUsers } from "../src/lib/repo/users";
import { listPayments } from "../src/lib/repo/payments";
import { listClients } from "../src/lib/repo/clients";
import { ORDER_STATUSES, MONEY_EPSILON, getFarmFor } from "../src/lib/constants";
import { hasNoClientInvoice, isConsignment, isRegionOrder } from "../src/lib/orderKind";
import { isRetailOrder } from "../src/lib/retail";
import { localDayKey } from "../src/lib/timezone";

const n = (v: number) => Math.round(v).toLocaleString("ru-RU");
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)} %` : "—");
const h = (t: string) => console.log(`\n===== ${t} =====`);
const day = (s: string) => (s || "").slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

function sumBy(xs: [string, number][], sort: "key" | "value" = "value"): string {
  const m = new Map<string, number>();
  for (const [k, v] of xs) m.set(k || "(пусто)", (m.get(k || "(пусто)") ?? 0) + v);
  const list = [...m.entries()];
  list.sort(sort === "key" ? (a, b) => (a[0] < b[0] ? -1 : 1) : (a, b) => b[1] - a[1]);
  return list.map(([k, v]) => `${k}: ${n(v)}`).join(" · ");
}
function quantiles(xs: number[]): string {
  if (xs.length === 0) return "—";
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `n=${s.length}, мин ${s[0]}, медиана ${q(0.5)}, 75 % ${q(0.75)}, 90 % ${q(0.9)}, макс ${s[s.length - 1]}`;
}

async function main() {
  const [orders, users, payments, clients] = await Promise.all([
    listOrdersWithItems(),
    listUsers(),
    listPayments(),
    listClients(),
  ]);
  const today = localDayKey();
  const name = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const who = (email: string) => name.get((email || "").toLowerCase()) ?? (email || "(пусто)");
  const orderById = new Map(orders.map((o) => [o.orderId, o]));
  const termsById = new Map(clients.map((c) => [c.clientId, c.paymentTerms]));
  const amountOf = (o: (typeof orders)[number]) => o.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

  const live = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED);
  const sales = live.filter((o) => !hasNoClientInvoice(o));
  const regions = live.filter(isRegionOrder);

  h("Заявки со счётом");
  console.log(`заявок всего ${orders.length}; живых продаж ${sales.length}; из них реализация ${sales.filter(isConsignment).length}; опт на город ${regions.length}; розница ${live.filter(isRetailOrder).length}`);
  console.log(`счёт по месяцам оформления: ${sumBy(sales.map((o) => [day(o.createdAt).slice(0, 7), amountOf(o)]), "key")}`);
  console.log(`получено (PaidAmount, не больше счёта) по месяцам оформления: ${sumBy(sales.map((o) => [day(o.createdAt).slice(0, 7), Math.min(o.paidAmount, amountOf(o))]), "key")}`);
  const billed = sales.reduce((s, o) => s + amountOf(o), 0);
  const got = sales.reduce((s, o) => s + Math.min(o.paidAmount, amountOf(o)), 0);
  console.log(`итого счёт ${n(billed)}, получено ${n(got)} (${pct(got, billed)}), переплата ${n(sales.reduce((s, o) => s + Math.max(0, o.paidAmount - amountOf(o)), 0))}`);
  console.log(`оплачено целиком ${sales.filter((o) => amountOf(o) - o.paidAmount <= MONEY_EPSILON).length}, частично ${sales.filter((o) => o.paidAmount > 0 && amountOf(o) - o.paidAmount > MONEY_EPSILON).length}, ничего ${sales.filter((o) => o.paidAmount <= 0 && amountOf(o) > 0).length}, нулевой счёт ${sales.filter((o) => amountOf(o) <= 0).length}`);
  console.log(`по компаниям (счёт): ${sumBy(sales.flatMap((o) => o.items.map((i) => [getFarmFor(i.flowerType) ?? "?", i.quantity * i.unitPrice] as [string, number])))}`);
  console.log(`PaidRoseFarm ${n(sales.reduce((s, o) => s + o.paidRoseFarm, 0))}, PaidEsentai ${n(sales.reduce((s, o) => s + o.paidEsentai, 0))}`);
  console.log(`вид оплаты в заявке: ${sumBy(sales.map((o) => [o.paymentMethod, 1]))}`);

  h("Журнал платежей (Payments)");
  console.log(`строк ${payments.length}, сумма ${n(payments.reduce((s, p) => s + p.amount, 0))}, с минусом ${payments.filter((p) => p.amount < 0).length}`);
  console.log(`по дню поступления: ${sumBy(payments.map((p) => [p.date, p.amount]), "key")}`);
  console.log(`по способу: ${sumBy(payments.map((p) => [p.method, p.amount]))}`);
  console.log(`по компании: ${sumBy(payments.map((p) => [p.farm, p.amount]))}`);
  console.log(`кто вносил: ${sumBy(payments.map((p) => [who(p.accountantEmail), 1]))}`);
  console.log(`внесено позже поступления, дней: ${quantiles(payments.filter((p) => p.date && p.createdAt).map((p) => daysBetween(p.date, day(p.createdAt))))}`);
  const orphan = payments.filter((p) => !orderById.has(p.orderId));
  console.log(`без заявки: ${orphan.length} на ${n(orphan.reduce((s, p) => s + p.amount, 0))}`);
  const toCancelled = payments.filter((p) => orderById.get(p.orderId)?.status === ORDER_STATUSES.CANCELLED);
  console.log(`по отменённым заявкам: ${toCancelled.length} на ${n(toCancelled.reduce((s, p) => s + p.amount, 0))}`);
  const toRegion = payments.filter((p) => isRegionOrder(orderById.get(p.orderId)));
  console.log(`по опту на город: ${toRegion.length} на ${n(toRegion.reduce((s, p) => s + p.amount, 0))}`);

  h("Итог заявки против журнала");
  const paidByOrder = new Map<string, number>();
  for (const p of payments) paidByOrder.set(p.orderId, (paidByOrder.get(p.orderId) ?? 0) + p.amount);
  const withMoney = sales.filter((o) => o.paidAmount > 0);
  const noJournal = withMoney.filter((o) => !paidByOrder.has(o.orderId));
  const mismatch = withMoney.filter((o) => paidByOrder.has(o.orderId) && Math.abs((paidByOrder.get(o.orderId) ?? 0) - o.paidAmount) > MONEY_EPSILON);
  console.log(`заявок с деньгами ${withMoney.length}; без единой строки журнала ${noJournal.length} на ${n(noJournal.reduce((s, o) => s + o.paidAmount, 0))}; журнал ≠ итог ${mismatch.length} (разница ${n(mismatch.reduce((s, o) => s + o.paidAmount - (paidByOrder.get(o.orderId) ?? 0), 0))})`);
  console.log(`PaidAt у заявок без журнала по дням: ${sumBy(noJournal.map((o) => [day(o.paidAt), o.paidAmount]), "key")}`);
  console.log(`без PaidAt: ${noJournal.filter((o) => !day(o.paidAt)).length}`);

  h("Сколько ждём денег");
  const firstPay = new Map<string, string>();
  const lastPay = new Map<string, string>();
  for (const p of payments) {
    if (!p.date) continue;
    if (!firstPay.has(p.orderId) || p.date < firstPay.get(p.orderId)!) firstPay.set(p.orderId, p.date);
    if (!lastPay.has(p.orderId) || p.date > lastPay.get(p.orderId)!) lastPay.set(p.orderId, p.date);
  }
  const fullPaid = sales.filter((o) => amountOf(o) > 0 && amountOf(o) - o.paidAmount <= MONEY_EPSILON);
  const payDay = (o: (typeof sales)[number]) => lastPay.get(o.orderId) ?? day(o.paidAt);
  console.log(`от оформления до полной оплаты, дней: ${quantiles(fullPaid.filter((o) => payDay(o)).map((o) => daysBetween(day(o.createdAt), payDay(o))))}`);
  console.log(`от доставки до полной оплаты, дней: ${quantiles(fullPaid.filter((o) => payDay(o) && o.deliveryDate).map((o) => daysBetween(o.deliveryDate, payDay(o))))}`);
  console.log(`оплачено ДО доставки (предоплата): ${fullPaid.filter((o) => payDay(o) && o.deliveryDate && payDay(o) < o.deliveryDate).length} из ${fullPaid.length}`);
  console.log(`от оформления до ПЕРВОГО платежа, дней: ${quantiles(sales.filter((o) => firstPay.has(o.orderId)).map((o) => daysBetween(day(o.createdAt), firstPay.get(o.orderId)!)))}`);

  h("Долг сейчас");
  const debtors = sales.filter((o) => !isConsignment(o) && amountOf(o) - o.paidAmount > MONEY_EPSILON);
  const debt = (o: (typeof sales)[number]) => amountOf(o) - o.paidAmount;
  const age = (o: (typeof sales)[number]) => daysBetween(o.deliveryDate || day(o.createdAt), today);
  console.log(`заявок ${debtors.length}, сумма ${n(debtors.reduce((s, o) => s + debt(o), 0))}`);
  const bucket = (d: number) => (d < 0 ? "доставка впереди" : d <= 3 ? "0–3" : d <= 7 ? "4–7" : d <= 14 ? "8–14" : d <= 30 ? "15–30" : "30+");
  console.log(`по возрасту (от доставки): ${sumBy(debtors.map((o) => [bucket(age(o)), debt(o)]), "key")}`);
  console.log(`по менеджерам: ${sumBy(debtors.map((o) => [who(o.managerEmail), debt(o)]))}`);
  console.log(`по условиям клиента: ${sumBy(debtors.map((o) => [termsById.get(o.clientId) ?? "(нет карточки)", debt(o)]))}`);
  console.log(`по компаниям: ${sumBy(debtors.flatMap((o) => {
    const amt = amountOf(o);
    return o.items.map((i) => [getFarmFor(i.flowerType) ?? "?", amt > 0 ? (i.quantity * i.unitPrice / amt) * debt(o) : 0] as [string, number]);
  }))}`);
  const byClient = new Map<string, number>();
  for (const o of debtors) byClient.set(o.clientName, (byClient.get(o.clientName) ?? 0) + debt(o));
  console.log(`топ-10 должников: ${[...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${n(v)}`).join(" · ")}`);
  console.log(`с частичной оплатой: ${debtors.filter((o) => o.paidAmount > 0).length}`);
  console.log(`отгружено целиком, но не оплачено: ${debtors.filter((o) => o.status === ORDER_STATUSES.SHIPPED).length} на ${n(debtors.filter((o) => o.status === ORDER_STATUSES.SHIPPED).reduce((s, o) => s + debt(o), 0))}`);

  h("Реализация (пожарка)");
  const cons = sales.filter(isConsignment);
  console.log(`заявок ${cons.length}, счёт ${n(cons.reduce((s, o) => s + amountOf(o), 0))}, получено ${n(cons.reduce((s, o) => s + Math.min(o.paidAmount, amountOf(o)), 0))}`);

  h("Опт на город — поступления");
  console.log(`заявок ${regions.length}, вписано поступлений ${n(regions.reduce((s, o) => s + o.paidAmount, 0))}, по направлениям: ${sumBy(regions.map((o) => [o.direction, o.paidAmount]))}`);

  h("Работа бухгалтера");
  console.log(`отметка «счёт отправлен»: ${sales.filter((o) => o.invoiceSentAt).length} из ${sales.length}; заметка «почему не ушёл»: ${sales.filter((o) => o.invoiceNote).length}`);
  console.log(`от оформления до отправки счёта, дней: ${quantiles(sales.filter((o) => o.invoiceSentAt).map((o) => daysBetween(day(o.createdAt), day(o.invoiceSentAt))))}`);
  const promised = sales.filter((o) => o.promisedAt);
  console.log(`обещания: ${promised.length}; выполнены (оплачено целиком) ${promised.filter((o) => amountOf(o) - o.paidAmount <= MONEY_EPSILON).length}; сорваны (срок прошёл, долг есть) ${promised.filter((o) => o.promisedAt < today && amountOf(o) - o.paidAmount > MONEY_EPSILON).length}`);
  console.log(`заметки по взысканию: ${sales.filter((o) => o.collectionNote).length}`);
  console.log(`номер 1С: ${sales.filter((o) => o.realization1c).length} из ${sales.length}`);
}

main().catch((e) => {
  console.error("ОШИБКА:", e instanceof Error ? e.message : e);
  process.exit(1);
});
