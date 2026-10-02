import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Хвосты УЖЕ удалённой заявки: висящий счёт Kaspi отменяется в ApiPay (иначе
 * клиент оплатит заявку, которой нет), строки платежей удаляются (иначе деньги
 * остаются в «поступило»). Только если заявки в таблице правда нет.
 * Без --yes — показ.
 *
 *   npx tsx scripts/cleanup-deleted-order.ts <номер заявки> [--yes]
 */
import { deleteWhere, readTable, rowToRecord, SHEET_TABS, updateWhere } from "../src/lib/sheets";
import { apiPayConfig, cancelInvoice } from "../src/lib/apipay";
import { isOpenKaspiStatus } from "../src/lib/kaspiInvoice";
import { logMoney } from "../src/lib/repo/moneyLog";
import { MONEY_LOG_ACTIONS } from "../src/lib/constants";

async function main() {
  const orderId = process.argv.slice(2).find((a) => a.startsWith("ORD-")) ?? "";
  const yes = process.argv.includes("--yes");
  if (!orderId) throw new Error("Укажите номер заявки");
  const orders = (await readTable(SHEET_TABS.ORDERS, { fresh: true })).rows.map((r) => rowToRecord(SHEET_TABS.ORDERS, r));
  if (orders.some((o) => o.OrderID === orderId)) throw new Error(`Заявка ${orderId} ещё есть — сначала её удаляют`);

  const invoices = (await readTable(SHEET_TABS.KASPI_INVOICES, { fresh: true })).rows
    .map((r) => rowToRecord(SHEET_TABS.KASPI_INVOICES, r))
    .filter((r) => r.OrderID === orderId);
  const payments = (await readTable(SHEET_TABS.PAYMENTS, { fresh: true })).rows
    .map((r) => rowToRecord(SHEET_TABS.PAYMENTS, r))
    .filter((r) => r.OrderID === orderId);
  console.log(`${orderId}: счетов Kaspi ${invoices.length}, платежей ${payments.length}`);
  for (const i of invoices) console.log(`  счёт ${i.InvoiceID} · ${i.Farm} · ${i.Amount} ₸ · ${i.Status}`);
  for (const p of payments) console.log(`  платёж ${p.PaymentID} · ${p.Amount} ₸ · ${p.Method}`);
  if (!yes) return console.log("Только показ.");

  for (const i of invoices.filter((x) => isOpenKaspiStatus(x.Status))) {
    const cfg = apiPayConfig(i.Farm);
    if (!cfg) {
      console.log(`  счёт ${i.InvoiceID}: касса ${i.Farm} не подключена — отмените в кабинете ApiPay`);
      continue;
    }
    const inv = await cancelInvoice(cfg, i.InvoiceID);
    await updateWhere(SHEET_TABS.KASPI_INVOICES, (r) => r.InvoiceID === i.InvoiceID, () => ({
      Status: String(inv?.status || "cancelling"),
      UpdatedAt: new Date().toISOString(),
    }));
    console.log(`  счёт ${i.InvoiceID}: отменён (${inv?.status || "cancelling"})`);
  }
  if (payments.length) {
    const n = await deleteWhere(SHEET_TABS.PAYMENTS, (r) => r.OrderID === orderId);
    console.log(`  платежей удалено: ${n}`);
  }
  await logMoney({
    actorEmail: "owner-request@crm",
    orderId,
    action: MONEY_LOG_ACTIONS.PAYMENT_REMOVED,
    details: `Хвосты удалённой заявки: отменено счетов Kaspi ${invoices.filter((x) => isOpenKaspiStatus(x.Status)).length}, удалено платежей ${payments.length} (${payments.map((p) => `${p.Amount} ₸`).join(", ") || "—"})`,
    amountBefore: payments.reduce((s, p) => s + (Number(p.Amount) || 0), 0),
    amountAfter: 0,
  });
  console.log("Готово.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
