/*
 * Клиент по хвосту номера: карточка, заявки за месяц, счета Kaspi и напоминания об оплате за неделю, память бота
 * основного номера (16.11.2026: клиентка ответила на напоминание об оплате «выставляйте счёт сегодня», а бот предложил
 * ей новый заказ). Ничего не меняет. Номера печатаются хвостом.
 *
 *   npx tsx scripts/diag-client-money.ts <последние цифры номера>
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listClients } from "../src/lib/repo/clients";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listKaspiInvoices } from "../src/lib/repo/kaspiInvoices";
import { listDebtReminders } from "../src/lib/repo/debtReminders";
import { listBotChats } from "../src/lib/repo/broadcasts";
import { listUsers } from "../src/lib/repo/users";
import { orderCode } from "../src/lib/paymentStage";
import { phoneKey } from "../src/lib/leads";

const flat = (text: string, max: number) => (text || "").replace(/\s+/g, " ").slice(0, max);
const tail = (phone: string) => `…${String(phone || "").replace(/\D/g, "").slice(-4)}`;

async function main() {
  const digits = (process.argv[2] || "").replace(/\D/g, "");
  if (digits.length < 4) throw new Error("Нужны последние цифры номера (от четырёх)");
  const [clients, orders, invoices, reminders, chats, users] = await Promise.all([listClients(), listOrdersWithItems(), listKaspiInvoices(), listDebtReminders(), listBotChats(), listUsers()]);
  const name = new Map(users.map((u) => [u.email.toLowerCase(), u.name || u.email]));
  const ends = (p: string) => String(p || "").replace(/\D/g, "").endsWith(digits);
  const cards = clients.filter((c) => ends(c.phone) || ends(c.messenger) || ends(c.kaspiPay1) || ends(c.kaspiPay2));
  console.log(`Карточек с номером …${digits}: ${cards.length}`);
  for (const c of cards) console.log(`  «${c.name}» · ${c.city} · менеджер ${name.get((c.managerEmail || "").toLowerCase()) || "—"} · оплата: ${c.paymentTerms || "—"} / ${c.paymentMethod || "—"} · ${c.active ? "активна" : "выключена"}`);
  const ids = new Set(cards.map((c) => c.clientId));
  const keys = new Set(cards.flatMap((c) => [c.phone, c.messenger, c.kaspiPay1, c.kaspiPay2]).map((p) => phoneKey(p)).filter(Boolean));
  const since = Date.now() - 30 * 86400_000;
  const mine = orders.filter((o) => (ids.has(o.clientId) || ends(o.clientPhone) || keys.has(phoneKey(o.clientPhone))) && Date.parse(o.createdAt) >= since).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  console.log(`\nЗаявки за 30 дней: ${mine.length}`);
  for (const o of mine) {
    console.log(`  №${orderCode(o.orderId)} · создана ${o.createdAt.slice(0, 16)} · ${name.get(o.managerEmail.toLowerCase()) || o.managerEmail} · ${o.status} · доставка ${o.deliveryDate} · сумма ${o.totalAmount} · оплачено ${o.paidAmount}`);
    console.log(`     ${o.items.map((i) => `${i.variety} ${i.grade} ${i.quantity}×${i.unitPrice}`).join("; ")}${o.notes ? ` · заметка: ${flat(o.notes, 160)}` : ""}`);
  }
  const orderIds = new Set(mine.map((o) => o.orderId));
  const inv = invoices.filter((i) => (orderIds.has(i.orderId) || ends(i.phone)) && Date.parse(i.createdAt) >= Date.now() - 7 * 86400_000);
  console.log(`\nСчета Kaspi за 7 дней: ${inv.length}`);
  for (const i of inv) console.log(`  ${i.createdAt.slice(0, 16)} · заявка №${orderCode(i.orderId)} · ${i.farm} · ${i.amount} · на ${tail(i.phone)} · ${i.status}${i.errorMessage ? ` · ${flat(i.errorMessage, 80)}` : ""}`);
  const rem = reminders.filter((r) => ends(r.phone) && Date.parse(r.sentAt) >= Date.now() - 7 * 86400_000);
  console.log(`\nНапоминания об оплате за 7 дней: ${rem.length}`);
  for (const r of rem) console.log(`  ${r.sentAt.slice(0, 16)} · ${r.amount} · заявки ${r.orderIds} · отправил ${r.sentByEmail || "—"}${r.error ? ` · ошибка ${flat(r.error, 80)}` : ""}`);
  const chat = chats.find((c) => ends(c.phone));
  console.log(`\nПамять бота основного номера: ${chat ? `режим ${chat.mode || "bot"}, ответов ${chat.botReplies}, записка: ${flat(chat.handoffReason, 300) || "—"}` : "нет"}`);
  for (const m of chat?.context.slice(-14) ?? []) console.log(`  ${String(m.at).slice(5, 16)} ${m.role === "client" ? "КЛИЕНТ" : "мы    "} ${flat(m.text, 220)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
