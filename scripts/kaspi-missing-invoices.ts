import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Оплаченные счета Kaspi, которые есть в ApiPay, а в нашей таблице их НЕТ (11.11.2026, №WQ67P: счёт выставили 09.11,
 * строка в KaspiInvoices не записалась, клиент оплатил, уведомление пришло «о неизвестном счёте» — заявка два дня висела
 * неоплаченной, пока бухгалтер не внесла платёж руками). `kaspi-reconcile.ts` такие не видит: он идёт по НАШИМ строкам.
 * Этот скрипт идёт от ApiPay: листает его счета за N дней и печатает оплаченные, которых у нас нет, — с заявкой и тем,
 * оплачена ли она в CRM. С --yes проводит их так же, как уведомление (`applyApiPayInvoice`), но ТОЛЬКО если часть этой
 * компании в заявке ещё не оплачена — иначе платёж задвоился бы с внесённым вручную. Телефоны — последние 4 цифры.
 *
 *   npx tsx scripts/kaspi-missing-invoices.ts [дней=7] [esentai|rose_farm|all] [--yes]
 */
import { apiPayConfig, apiPayGet, configuredFarms, type ApiPayInvoice } from "../src/lib/apipay";
import { listKaspiInvoices } from "../src/lib/repo/kaspiInvoices";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { applyApiPayInvoice } from "../src/lib/kaspiSync";
import { isPaidKaspiStatus } from "../src/lib/kaspiInvoice";
import { invoiceByFarm, paidByFarm } from "../src/lib/orderMoney";
import { orderCode } from "../src/lib/paymentStage";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Row = ApiPayInvoice & { created_at?: string };

function rowsOf(body: unknown): Row[] {
  const b = body as Record<string, unknown> | unknown[] | null;
  if (Array.isArray(b)) return b as Row[];
  if (!b) return [];
  const d = (b as Record<string, unknown>).data;
  if (Array.isArray(d)) return d as Row[];
  const dd = (d as Record<string, unknown> | undefined)?.data ?? (b as Record<string, unknown>).invoices ?? (d as Record<string, unknown> | undefined)?.invoices;
  return Array.isArray(dd) ? (dd as Row[]) : [];
}

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes("--yes");
  const rest = args.filter((a) => a !== "--yes");
  const days = Number(rest[0]) || 7;
  const farms = !rest[1] || rest[1] === "all" ? configuredFarms() : [rest[1]];
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [ours, orders] = await Promise.all([listKaspiInvoices({ fresh: true }), listOrdersWithItems()]);
  const known = new Set(ours.map((i) => String(i.invoiceId)));
  const byId = new Map(orders.map((o) => [o.orderId, o]));
  let missing = 0;
  let posted = 0;

  for (const farm of farms) {
    const cfg = apiPayConfig(farm);
    if (!cfg) {
      console.log(`${farm}: касса не подключена`);
      continue;
    }
    let seen = 0;
    let paid = 0;
    for (let page = 1; page <= 40; page++) {
      const body = await apiPayGet(cfg, `/invoices?per_page=100&page=${page}`);
      const rows = rowsOf(body);
      if (page === 1) console.log(`${farm}: поля счёта в ApiPay — ${rows[0] ? Object.keys(rows[0]).join(", ") : "ответ пуст: " + JSON.stringify(body).slice(0, 300)}`);
      if (!rows.length) break;
      let older = 0;
      for (const inv of rows) {
        const created = String(inv.created_at || inv.paid_at || "");
        if (created && created < since) {
          older++;
          continue;
        }
        seen++;
        if (inv.is_sandbox || !isPaidKaspiStatus(String(inv.status || ""))) continue;
        paid++;
        if (known.has(String(inv.id))) continue;
        missing++;
        const [orderId] = String(inv.external_order_id || "").split(":");
        const order = byId.get(orderId);
        const bill = order ? invoiceByFarm(order.items) : [];
        const need = bill.find((x) => x.farm === farm)?.amount ?? 0;
        const got = order ? paidByFarm(order, bill).find((x) => x.farm === farm)?.amount ?? 0 : 0;
        const state = !order ? "заявка не найдена" : order.status === "cancelled" ? "заявка ОТМЕНЕНА" : got >= need - 0.5 ? `в CRM уже оплачено (${got} из ${need})` : `в CRM НЕ ОПЛАЧЕНО: ${got} из ${need}`;
        console.log(`НЕТ У НАС: счёт №${inv.id} · ${farm} · ${inv.amount} ₸ · оплачен ${inv.paid_at || "?"} · …${String(inv.client_phone || "").slice(-4)} · ${order ? "№" + orderCode(order.orderId) + " " + order.clientName : String(inv.external_order_id || "без заявки")} · ${state}`);
        if (yes && order && order.status !== "cancelled" && got < need - 0.5) {
          const res = await applyApiPayInvoice(inv);
          console.log(`   → проведён: ${res}`);
          if (res === "paid") posted++;
          await sleep(1500);
        }
      }
      if (older === rows.length) break;
      await sleep(400);
    }
    console.log(`${farm}: счетов за ${days} дн. в ApiPay — ${seen}, оплачено — ${paid}`);
  }
  console.log(`\nОплаченных счетов без записи в CRM: ${missing}${yes ? `, проведено: ${posted}` : " (только показ)"}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
