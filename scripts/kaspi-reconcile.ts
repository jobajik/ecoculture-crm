import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Сверка счетов Kaspi с ApiPay (27.10.2026, владелец: «по Есентаю не приходят подтверждения, что клиент оплатил, хотя он
 * оплатил»; в кабинете ApiPay «1 из 10 уведомлений не доставлено — таймаут соединения»). Для каждого счёта за N дней,
 * который у нас ещё ждёт оплаты (или оплачен без проведённого платежа), спрашивает ApiPay, что с ним сейчас. С --yes —
 * проводит так же, как кнопка «Обновить статус» у бухгалтера (`applyApiPayInvoice`: оплачен — платёж в заявку один раз).
 * Телефоны — последние 4 цифры.
 *
 *   npx tsx scripts/kaspi-reconcile.ts [дней=7] [esentai|rose_farm|all] [--every] [--yes]
 */
import { findKaspiInvoice, listKaspiInvoices, updateKaspiInvoiceRow } from "../src/lib/repo/kaspiInvoices";
import { listPayments } from "../src/lib/repo/payments";
import { getOrderById } from "../src/lib/repo/orders";
import { apiPayConfig, getInvoice } from "../src/lib/apipay";
import { applyApiPayInvoice } from "../src/lib/kaspiSync";
import { isOpenKaspiStatus, isPaidKaspiStatus } from "../src/lib/kaspiInvoice";
import { orderCode } from "../src/lib/paymentStage";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes("--yes");
  // --every: сверить и закрытые у нас (истёк, отменён, ошибка) — вдруг в ApiPay они оплачены.
  const every = args.includes("--every");
  const rest = args.filter((a) => a !== "--yes" && a !== "--every");
  const days = Number(rest[0]) || 7;
  const farm = rest[1] && rest[1] !== "all" ? rest[1] : "";
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const all = (await listKaspiInvoices({ fresh: true })).filter((i) => !i.sandbox && i.createdAt >= since && (!farm || i.farm === farm));
  const check = all.filter((i) => (every && !isPaidKaspiStatus(i.status)) || isOpenKaspiStatus(i.status) || i.status === "cancelling" || (isPaidKaspiStatus(i.status) && !i.paymentId));
  console.log(`Счетов за ${days} дн.${farm ? ` (${farm})` : ""}: ${all.length}; по статусам: ${Object.entries(all.reduce<Record<string, number>>((a, i) => ((a[i.status] = (a[i.status] || 0) + 1), a), {})).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log(`Проверяю в ApiPay ${check.length} (ждут оплаты или оплачены без платежа)${yes ? " — и провожу" : " — только показ"}:\n`);
  const ledger = await listPayments({ fresh: true });
  let differ = 0;
  for (const i of check) {
    const cfg = apiPayConfig(i.farm);
    const head = `№${orderCode(i.orderId)} · ${i.farm} · ${i.amount} ₸ · …${i.phone.slice(-4)} · создан ${i.createdAt.slice(5, 16)}Z · у нас «${i.status}»${i.paymentId ? "" : isPaidKaspiStatus(i.status) ? " без платежа" : ""}`;
    if (!cfg) {
      console.log(`${head} → касса не подключена`);
      continue;
    }
    try {
      const live = await getInvoice(cfg, i.invoiceId);
      const st = String(live.status || "");
      const changed = st !== i.status || (isPaidKaspiStatus(st) && !i.paymentId);
      if (changed) differ++;
      // Платёж мог уже лечь в журнал, а ссылка на него в строку счёта — нет: второй раз не проводим.
      const inLedger = ledger.filter((p) => p.orderId === i.orderId && p.note.includes(i.invoiceId));
      const order = await getOrderById(i.orderId);
      let done = "";
      if (yes && changed) {
        if (inLedger.length) {
          const found = await findKaspiInvoice(i.invoiceId);
          if (found) await updateKaspiInvoiceRow(found.rowNumber, { Status: st, PaymentID: inLedger[0].paymentId, UpdatedAt: new Date().toISOString() });
          done = " → платёж уже был в журнале, связал счёт с ним";
        } else done = ` → проведено: ${await applyApiPayInvoice(live)}`;
      }
      console.log(
        `${head} → в ApiPay «${st}»${live.paid_at ? `, оплачен ${String(live.paid_at).slice(0, 16)}` : ""}${changed ? " ← РАСХОДИТСЯ" : ""}` +
          (changed ? `\n     заявка: ${order ? `${order.status}, сумма ${order.totalAmount}, получено ${order.paidAmount}` : "не найдена"}; в журнале платежей по этому счёту: ${inLedger.length ? inLedger.map((p) => `${p.amount} ₸ ${p.date} (${p.accountantEmail})`).join(", ") : "нет"}` : "") +
          done
      );
    } catch (e) {
      console.log(`${head} → ApiPay: ${e instanceof Error ? e.message : e}`);
    }
    await sleep(400);
  }
  console.log(`\nРасходится: ${differ}${differ && !yes ? " — запустите с --yes, чтобы провести" : ""}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
