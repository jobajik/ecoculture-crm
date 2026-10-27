import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Счета Kaspi одной компании за N дней (27.10.2026, «по Есентаю не приходят подтверждения оплаты, таких много»): по дням —
 * сколько выставлено, оплачено, истекло, отменено, ошибок (с текстом ошибки); и чем в итоге закрыта часть этой компании в
 * заявке — счётом Kaspi, руками бухгалтера или не закрыта. Ничего не меняет.
 *
 *   npx tsx scripts/diag-kaspi-farm.ts [esentai|rose_farm] [дней=14]
 */
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listKaspiInvoices } from "../src/lib/repo/kaspiInvoices";
import { listPayments } from "../src/lib/repo/payments";
import { farmPayments } from "../src/lib/orderMoney";
import { KASPI_ACTOR } from "../src/lib/kaspiSync";
import { ORDER_STATUSES } from "../src/lib/constants";

async function main() {
  const farm = process.argv[2] || "esentai";
  const days = Number(process.argv[3]) || 14;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.KASPI_INVOICES, SHEET_TABS.PAYMENTS]);
  const [orders, invoices, payments] = await Promise.all([listOrdersWithItems(), listKaspiInvoices({ fresh: true }), listPayments({ fresh: true })]);
  const inv = invoices.filter((i) => !i.sandbox && i.farm === farm && i.createdAt >= since);
  const byDay = new Map<string, Record<string, number>>();
  for (const i of inv) {
    const d = i.createdAt.slice(0, 10);
    const r = byDay.get(d) ?? {};
    r[i.status] = (r[i.status] || 0) + 1;
    byDay.set(d, r);
  }
  console.log(`Счета ${farm} за ${days} дн.: ${inv.length}`);
  for (const [d, r] of Array.from(byDay.entries()).sort()) console.log(`  ${d}: ${Object.entries(r).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  const errs = new Map<string, number>();
  for (const i of inv.filter((x) => x.status === "error")) errs.set(`${i.errorCode} ${i.errorMessage}`.trim(), (errs.get(`${i.errorCode} ${i.errorMessage}`.trim()) || 0) + 1);
  console.log("\nОшибки:");
  for (const [k, v] of errs) console.log(`  ${v} × ${k.slice(0, 160)}`);

  // Заявки, где выставлялся счёт этой компании: чем закрыта её часть.
  const ids = Array.from(new Set(inv.map((i) => i.orderId)));
  const tally = { kaspi: 0, manual: 0, mixed: 0, unpaid: 0, cancelled: 0 };
  const unpaid: string[] = [];
  const manualMethods = new Map<string, number>();
  for (const id of ids) {
    const o = orders.find((x) => x.orderId === id);
    if (!o) continue;
    if (o.status === ORDER_STATUSES.CANCELLED) {
      tally.cancelled++;
      continue;
    }
    const part = farmPayments(o).find((f) => f.farm === farm);
    const pays = payments.filter((p) => p.orderId === id && (!p.farm || p.farm === farm));
    const viaKaspi = pays.some((p) => p.accountantEmail === KASPI_ACTOR);
    const manual = pays.filter((p) => p.accountantEmail !== KASPI_ACTOR);
    for (const p of manual) manualMethods.set(`${p.method} (${p.accountantEmail})`, (manualMethods.get(`${p.method} (${p.accountantEmail})`) || 0) + 1);
    const due = part ? part.amount - part.paidAmount : 0;
    if (due > 0.5) {
      tally.unpaid++;
      const tries = inv.filter((i) => i.orderId === id).map((i) => i.status).join("/");
      unpaid.push(`  ${o.createdAt.slice(5, 10)} ${o.clientName.slice(0, 30)} · …${o.clientPhone.replace(/\D/g, "").slice(-4)} · ${o.status} · не оплачено ${Math.round(due)} ₸ · счета: ${tries}`);
    } else if (viaKaspi && manual.length) tally.mixed++;
    else if (viaKaspi) tally.kaspi++;
    else tally.manual++;
  }
  console.log(`\nЗаявок со счётом ${farm}: ${ids.length} — оплачено счётом ${tally.kaspi}, руками ${tally.manual}, и так и так ${tally.mixed}, НЕ оплачено ${tally.unpaid}, отменены ${tally.cancelled}`);
  console.log("Ручные платежи по этим заявкам:");
  for (const [k, v] of manualMethods) console.log(`  ${v} × ${k}`);
  console.log("\nНе оплачено:");
  for (const u of unpaid) console.log(u);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
