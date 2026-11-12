import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Счета Kaspi одной заявки и сколько ещё можно выставить (12.11.2026, №UYQ72: «один счёт на два разных номера, в одной
 * заявке»). Ничего не меняет и в ApiPay не ходит. Номера печатаются последними четырьмя цифрами.
 *
 *   npx tsx scripts/diag-kaspi-order.ts <короткий номер заявки>
 */
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listKaspiInvoices } from "../src/lib/repo/kaspiInvoices";
import { farmPayments } from "../src/lib/orderMoney";
import { orderCode } from "../src/lib/paymentStage";
import { apiPayConfig } from "../src/lib/apipay";
import { isOpenKaspiStatus, kaspiDueAmount, kaspiOpenAmount, kaspiSendRefusal, kaspiStatusLabel } from "../src/lib/kaspiInvoice";

const tail = (p: string) => `…${String(p || "").replace(/\D/g, "").slice(-4)}`;
const ru = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} KZT`;

async function main() {
  const code = (process.argv[2] || "").trim().toUpperCase();
  if (!code) throw new Error("Нужен короткий номер заявки");
  const orders = (await listOrdersWithItems()).filter((o) => orderCode(o.orderId) === code);
  if (orders.length === 0) return console.log(`Заявка ${code} не найдена`);
  const all = await listKaspiInvoices();
  for (const o of orders) {
    const invs = all.filter((i) => i.orderId === o.orderId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    console.log(`Заявка ${code} · статус ${o.status} · оплачено ${ru(o.paidAmount)}`);
    for (const part of farmPayments(o)) {
      const due = kaspiDueAmount(part);
      const waiting = kaspiOpenAmount(invs, part.farm);
      console.log(`  ${part.farm}: счёт ${ru(part.amount)}, оплачено ${ru(part.paidAmount)}, к оплате ${ru(due)}, касса ${apiPayConfig(part.farm) ? "подключена" : "НЕТ"}`);
      console.log(`    ждут оплаты: ${ru(waiting)} · ещё можно выставить: ${ru(Math.max(0, due - waiting))}`);
      const rest = Math.max(0, due - waiting);
      if (rest > 0) {
        const say = (phone: string, label: string) =>
          console.log(`    проба — ${label}: ${kaspiSendRefusal({ role: "accountant", farmConfigured: !!apiPayConfig(part.farm), farm: part.farm, invoiceFarms: farmPayments(o), orderStatus: o.status, noInvoice: false, phone, amount: rest, existing: invs }) || "МОЖНО"}`);
        say("87000000001", `остаток на другой номер`);
        const busy = invs.find((i) => i.farm === part.farm && isOpenKaspiStatus(i.status));
        if (busy) say(busy.phone, `остаток на тот же номер ${tail(busy.phone)}`);
      }
    }
    for (const i of invs) console.log(`  счёт №${i.invoiceId} · ${i.farm} · ${ru(i.amount)} · ${tail(i.phone)} · ${kaspiStatusLabel(i.status)} · ${i.createdAt.slice(0, 16)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
