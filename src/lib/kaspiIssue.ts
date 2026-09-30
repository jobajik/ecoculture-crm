import { FARM_LABELS, MONEY_LOG_ACTIONS } from "./constants";
import { getOrderById, setOrderInvoiceSent } from "./repo/orders";
import { logMoney } from "./repo/moneyLog";
import { appendKaspiInvoice, listKaspiInvoices } from "./repo/kaspiInvoices";
import { farmPayments } from "./orderMoney";
import { isNotASale } from "./orderKind";
import { orderCode } from "./paymentStage";
import { ApiPayError, apiPayConfig, createInvoice } from "./apipay";
import { isKaspiSessionError } from "./kaspiHealth";
import { noteKaspiSessionLost } from "./kaspiHealthCheck";
import { kaspiDescription, kaspiPhone, kaspiSendRefusal } from "./kaspiInvoice";

/**
 * Выставить счёт Kaspi Pay на часть заявки одной компании. Общее для кнопки в
 * панели оплаты (`kaspi-actions.ts`) и напоминаний о долгах (`debtReminderRunner.ts`).
 * Кто вправе — проверяет вызывающий; правила счёта — `kaspiSendRefusal`.
 */
export async function issueKaspiInvoice(input: {
  orderId: string;
  farm: string;
  phone: string;
  amount: number;
  email: string;
  role: string | undefined;
}): Promise<{ invoiceId: string; status: string; sandbox: boolean }> {
  const { email, role } = input;
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
    noInvoice: isNotASale(order),
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
    if (err instanceof ApiPayError) {
      if (isKaspiSessionError(err.code)) noteKaspiSessionLost(input.farm);
      throw new Error(err.message);
    }
    throw new Error("Не удалось связаться с ApiPay — попробуйте ещё раз");
  }

  if (isKaspiSessionError(inv.error_code)) noteKaspiSessionLost(input.farm);
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
  return { invoiceId: String(inv.id), status: String(inv.status || ""), sandbox: !!inv.is_sandbox };
}

