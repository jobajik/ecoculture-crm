"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { ROLES } from "@/lib/constants";
import { getOrderById } from "@/lib/repo/orders";
import { getClientById } from "@/lib/repo/clients";
import { getWaybill } from "@/lib/repo/waybills";
import { saveSettings } from "@/lib/repo/settings";
import { farmScopeFor } from "@/lib/retail";
import { WAYBILL_AUTO_SETTING, WAYBILL_SINCE_SETTING, waybillSendRefusal } from "@/lib/waybill";
import { resendWaybill, sendOrderWaybill, type WaybillOutcome } from "@/lib/waybillRunner";

/**
 * Накладная клиенту — кнопки на заявке и переключатель в настройках (`waybill.ts`, `waybillRunner.ts`).
 * Отправка сообщения клиенту — действие человека, который нажал кнопку; автомат включает только администратор.
 */

async function actorFor(orderId: string) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const email = session.user.email.toLowerCase();
  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");
  const client = order.clientId ? await getClientById(order.clientId) : null;
  const refusal = waybillSendRefusal({ role: session.user.role, email, order, cardManagerEmail: client?.managerEmail });
  if (refusal) throw new Error(refusal);
  // Зав. складом отправляет накладную только на свой цветок — чужих цен она не видит и клиенту их не шлёт.
  const farm = farmScopeFor({ role: session.user.role, farm: session.user.farm, order, email });
  return { email, order, farm };
}

function outcomeText(out: WaybillOutcome): string {
  const tail = out.phone ? ` на …${out.phone.slice(-4)}` : "";
  if (out.status === "sent" && out.note === "already") return `Накладная № ${out.number} уже ушла клиенту${tail} раньше — отметка восстановлена, второй раз не отправляю`;
  if (out.status === "sent") return `Накладная № ${out.number} отправлена клиенту${tail}`;
  if (out.status === "duplicate") return `Эта отгрузка ${out.note}`;
  throw new Error(`Накладная № ${out.number} не отправлена: ${out.note || "причина неизвестна"}`);
}

async function sendWaybillActionInner(orderId: string) {
  const { email, order, farm } = await actorFor(orderId);
  const out = await sendOrderWaybill({ order, farm, byEmail: email });
  revalidatePath(`/orders/${orderId}`);
  return { text: outcomeText(out) };
}

async function resendWaybillActionInner(waybillId: string) {
  const waybill = await getWaybill(waybillId);
  if (!waybill) throw new Error("Накладная не найдена — обновите страницу");
  const { email, order, farm } = await actorFor(waybill.orderId);
  if (farm && waybill.doc?.lines.some((l) => l.farm !== farm)) throw new Error("В этой накладной не только ваш цветок — её отправит менеджер или бухгалтер");
  const out = await resendWaybill({ waybill, order, byEmail: email });
  revalidatePath(`/orders/${waybill.orderId}`);
  return { text: outcomeText(out) };
}

/** Включить или выключить автоотправку. Включение ставит точку отсчёта на «сейчас»: отгруженное раньше не уйдёт. */
async function setWaybillAutoActionInner(on: boolean) {
  const session = await getServerSession(authOptions);
  if (session?.user?.role !== ROLES.ADMIN) throw new Error("Недостаточно прав: это настройка администратора");
  await saveSettings(on ? { [WAYBILL_AUTO_SETTING]: "on", [WAYBILL_SINCE_SETTING]: new Date().toISOString() } : { [WAYBILL_AUTO_SETTING]: "off" });
  revalidatePath("/admin");
  return { on };
}

export async function sendWaybillAction(...args: Parameters<typeof sendWaybillActionInner>) {
  return guard(() => sendWaybillActionInner(...args));
}

export async function resendWaybillAction(...args: Parameters<typeof resendWaybillActionInner>) {
  return guard(() => resendWaybillActionInner(...args));
}

export async function setWaybillAutoAction(...args: Parameters<typeof setWaybillAutoActionInner>) {
  return guard(() => setWaybillAutoActionInner(...args));
}
