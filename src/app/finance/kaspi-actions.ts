"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { canEditFinance } from "@/lib/financeAccess";
import { FARM_LABELS, MONEY_LOG_ACTIONS } from "@/lib/constants";
import { getOrderById, setOrderInvoiceSent } from "@/lib/repo/orders";
import { getClientById } from "@/lib/repo/clients";
import { logMoney } from "@/lib/repo/moneyLog";
import { appendKaspiInvoice, findKaspiInvoice, listKaspiInvoices, updateKaspiInvoiceRow } from "@/lib/repo/kaspiInvoices";
import { farmPayments } from "@/lib/orderMoney";
import { hasNoClientInvoice } from "@/lib/orderKind";
import { orderCode } from "@/lib/paymentStage";
import { ApiPayError, apiPayConfig, cancelInvoice, createInvoice, getInvoice } from "@/lib/apipay";
import { applyApiPayInvoice } from "@/lib/kaspiSync";
import {
  isOpenKaspiStatus,
  kaspiDescription,
  kaspiDueAmount,
  kaspiPhone,
  kaspiSendRefusal,
  suggestedKaspiPhone,
} from "@/lib/kaspiInvoice";
import type { KaspiInvoice } from "@/lib/types";

/**
 * Счета Kaspi Pay через ApiPay. Выставляет ТОЛЬКО бухгалтер и админ — так
 * решил владелец; проверка здесь, на сервере (грабли 1.11).
 */
async function requireAccountant() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  if (!canEditFinance(session.user.role)) throw new Error("Счёт в Kaspi выставляет бухгалтер");
  return { email: session.user.email.toLowerCase(), role: session.user.role };
}

function refresh(orderId: string) {
  revalidatePath("/finance");
  revalidatePath("/finance/debts");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}

export interface KaspiPanelData {
  farms: { farm: string; label: string; amount: number; paidAmount: number; due: number; configured: boolean }[];
  invoices: KaspiInvoice[];
  phone: string;
  /** Откуда взят номер — чтобы бухгалтер видела, что проверять. */
  phoneSource: string;
  orderCode: string;
}

async function loadKaspiActionInner(orderId: string): Promise<KaspiPanelData> {
  await requireAccountant();
  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");
  const client = order.clientId ? await getClientById(order.clientId) : null;
  const candidates: [string, string][] = [
    [client?.kaspiPay1 ?? "", "Каспи Pay №1 клиента"],
    [client?.kaspiPay2 ?? "", "Каспи Pay №2 клиента"],
    [order.clientPhone, "телефон заявки"],
    [client?.phone ?? "", "телефон клиента"],
  ];
  const found = candidates.find(([p]) => kaspiPhone(p));
  const invoices = (await listKaspiInvoices())
    .filter((i) => i.orderId === orderId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return {
    farms: hasNoClientInvoice(order)
      ? []
      : farmPayments(order).map((f) => ({
          farm: f.farm,
          label: FARM_LABELS[f.farm] ?? f.farm,
          amount: f.amount,
          paidAmount: f.paidAmount,
          due: kaspiDueAmount(f),
          configured: !!apiPayConfig(f.farm),
        })),
    invoices,
    phone: found ? suggestedKaspiPhone([found[0]]) : "",
    phoneSource: found ? found[1] : "",
    orderCode: orderCode(orderId),
  };
}

async function sendKaspiInvoiceActionInner(input: { orderId: string; farm: string; phone: string; amount: number }) {
  const { email, role } = await requireAccountant();
  const order = await getOrderById(input.orderId);
  if (!order) throw new Error("Заявка не найдена");
  const existing = (await listKaspiInvoices({ fresh: true })).filter((i) => i.orderId === order.orderId);
  const cfg = apiPayConfig(input.farm);
  const phone = kaspiPhone(input.phone);
  const amount = Math.round(Number(input.amount));
  const refusal = kaspiSendRefusal({
    role,
    farmConfigured: !!cfg,
    farm: input.farm,
    invoiceFarms: farmPayments(order),
    orderStatus: order.status,
    noInvoice: hasNoClientInvoice(order),
    phone,
    amount,
    existing,
  });
  if (refusal || !cfg) throw new Error(refusal || "Касса не подключена");

  const code = orderCode(order.orderId);
  let inv;
  try {
    inv = await createInvoice(cfg, {
      phone,
      amount,
      description: kaspiDescription(input.farm, code),
      externalOrderId: `${order.orderId}:${input.farm}`,
      // Повтор нажатия с тем же номером попытки ApiPay не создаст второй раз (409).
      idempotencyKey: `${order.orderId}:${input.farm}:${existing.filter((i) => i.farm === input.farm).length + 1}`,
    });
  } catch (err) {
    if (err instanceof ApiPayError) throw new Error(err.message);
    throw new Error("Не удалось связаться с ApiPay — попробуйте ещё раз");
  }

  const now = new Date().toISOString();
  await appendKaspiInvoice({
    invoiceId: String(inv.id),
    createdAt: now,
    orderId: order.orderId,
    farm: input.farm,
    amount,
    phone,
    status: String(inv.status || "processing"),
    kaspiInvoiceId: String(inv.kaspi_invoice_id || ""),
    errorCode: String(inv.error_code || ""),
    errorMessage: String(inv.error_message || ""),
    paidAt: "",
    paymentId: "",
    createdByEmail: email,
    sandbox: !!inv.is_sandbox,
    updatedAt: now,
  });
  // Отметка «счёт отправлен» ставится сама — это и есть отправка счёта.
  if (!order.invoiceSentAt) await setOrderInvoiceSent(order.orderId, true);
  await logMoney({
    actorEmail: email,
    orderId: order.orderId,
    action: MONEY_LOG_ACTIONS.INVOICE_SENT,
    details: `Счёт Kaspi №${inv.id} на ${amount.toLocaleString("ru-RU")} ₸ · ${FARM_LABELS[input.farm] ?? input.farm} · ${phone}${inv.is_sandbox ? " · тестовый режим" : ""}`,
    amountBefore: order.paidAmount,
    amountAfter: order.paidAmount,
  });
  refresh(order.orderId);
  return { invoiceId: String(inv.id), status: String(inv.status || ""), sandbox: !!inv.is_sandbox };
}

/** Спросить ApiPay о счёте — если вебхук не дошёл. Оплата проводится так же, как по вебхуку. */
async function refreshKaspiInvoiceActionInner(invoiceId: string) {
  await requireAccountant();
  const found = await findKaspiInvoice(invoiceId);
  if (!found) throw new Error("Счёт не найден");
  const cfg = apiPayConfig(found.invoice.farm);
  if (!cfg) throw new Error("Касса этой компании не подключена");
  try {
    const inv = await getInvoice(cfg, invoiceId);
    const result = await applyApiPayInvoice(inv);
    refresh(found.invoice.orderId);
    return { status: String(inv.status || ""), result };
  } catch (err) {
    if (err instanceof ApiPayError) throw new Error(err.message);
    throw err;
  }
}

async function cancelKaspiInvoiceActionInner(invoiceId: string) {
  const { email } = await requireAccountant();
  const found = await findKaspiInvoice(invoiceId);
  if (!found) throw new Error("Счёт не найден");
  if (!isOpenKaspiStatus(found.invoice.status)) throw new Error("Этот счёт уже не ждёт оплаты — отменять нечего");
  const cfg = apiPayConfig(found.invoice.farm);
  if (!cfg) throw new Error("Касса этой компании не подключена");
  let inv;
  try {
    inv = await cancelInvoice(cfg, invoiceId);
  } catch (err) {
    if (err instanceof ApiPayError) throw new Error(err.message);
    throw err;
  }
  // В боевом режиме отмена асинхронная: статус «отменяется», окончательный — вебхуком.
  await updateKaspiInvoiceRow(found.rowNumber, {
    Status: String(inv?.status || "cancelling"),
    UpdatedAt: new Date().toISOString(),
  });
  await logMoney({
    actorEmail: email,
    orderId: found.invoice.orderId,
    action: MONEY_LOG_ACTIONS.INVOICE_SENT,
    details: `Счёт Kaspi №${invoiceId} отменён`,
    amountBefore: 0,
    amountAfter: 0,
  });
  refresh(found.invoice.orderId);
  return { ok: true };
}

// Обёртки: отказ ВОЗВРАЩАЕТСЯ, а не бросается (грабли 1.13).
export async function loadKaspiAction(...args: Parameters<typeof loadKaspiActionInner>) {
  return guard(() => loadKaspiActionInner(...args));
}
export async function sendKaspiInvoiceAction(...args: Parameters<typeof sendKaspiInvoiceActionInner>) {
  return guard(() => sendKaspiInvoiceActionInner(...args));
}
export async function refreshKaspiInvoiceAction(...args: Parameters<typeof refreshKaspiInvoiceActionInner>) {
  return guard(() => refreshKaspiInvoiceActionInner(...args));
}
export async function cancelKaspiInvoiceAction(...args: Parameters<typeof cancelKaspiInvoiceActionInner>) {
  return guard(() => cancelKaspiInvoiceActionInner(...args));
}
