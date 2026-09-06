"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { createOrder, type NewOrderInput, updateOrderStatus } from "@/lib/repo/orders";
import type { OrderStatus } from "@/lib/constants";

export async function createOrderAction(input: Omit<NewOrderInput, "managerEmail">) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  if (session.user.role !== "manager" && session.user.role !== "admin") {
    throw new Error("Недостаточно прав: заявки создают менеджеры");
  }
  if (!input.items || input.items.length === 0) {
    throw new Error("Добавьте хотя бы одну позицию в заявку");
  }

  const orderId = await createOrder({ ...input, managerEmail: session.user.email });
  revalidatePath("/orders");
  return orderId;
}

export async function updateOrderStatusAction(orderId: string, status: OrderStatus) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");

  await updateOrderStatus(orderId, status);
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}
