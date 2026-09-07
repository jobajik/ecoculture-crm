"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { getOrderById, setOrderManagerConfirmed, setOrderPaid } from "@/lib/repo/orders";
import { PAYMENT_METHODS } from "@/lib/constants";

/** Отметить оплату может бухгалтер и администратор — больше никто. */
async function requireAccountant() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  if (session.user.role !== "accountant" && session.user.role !== "admin") {
    throw new Error("Недостаточно прав: отмечать оплату может только бухгалтер");
  }
  return session.user.email;
}

export async function setPaidAction(orderId: string, paid: boolean, paymentMethod: string) {
  const email = await requireAccountant();

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");

  if (paid && paymentMethod && !PAYMENT_METHODS.includes(paymentMethod as never)) {
    throw new Error(`Неизвестный способ оплаты: ${paymentMethod}`);
  }

  await setOrderPaid(orderId, paid, email, paid ? paymentMethod : "");

  revalidatePath("/finance");
  revalidatePath("/finance/debts");
  revalidatePath("/finance/report");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/warehouse/picklist");
  return { ok: true };
}

/**
 * Первую галочку ставит менеджер по своей заявке (администратор — по любой).
 * Бухгалтер её не ставит: это подтверждение договорённости с клиентом, а не денег.
 */
export async function setManagerConfirmedAction(orderId: string, confirmed: boolean) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");

  const role = session.user.role;
  if (role !== "manager" && role !== "admin") {
    throw new Error("Подтвердить заявку может только менеджер, который её оформил");
  }

  const order = await getOrderById(orderId);
  if (!order) throw new Error("Заявка не найдена");

  if (role === "manager" && order.managerEmail !== session.user.email.toLowerCase()) {
    throw new Error("Это заявка другого менеджера");
  }

  await setOrderManagerConfirmed(orderId, confirmed);

  revalidatePath("/finance");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/warehouse/picklist");
  return { ok: true };
}
