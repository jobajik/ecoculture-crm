"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { canEditFinance } from "@/lib/financeAccess";
import { sendDebtReminder } from "@/lib/debtReminderRunner";

/**
 * Одно напоминание о долге. Отправляет бухгалтер (и админ) — решение
 * владельца; страница зовёт по одному с паузой, как у рассылки. Правила —
 * `src/lib/debtReminder.ts`.
 */
async function sendDebtReminderActionInner(key: string) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() ?? "";
  if (!email) throw new Error("Не авторизован");
  if (!canEditFinance(session?.user?.role)) throw new Error("Напоминания отправляет бухгалтер");
  const result = await sendDebtReminder(String(key || ""), { email, role: session?.user?.role });
  revalidatePath("/finance/reminders");
  return result;
}

export async function sendDebtReminderAction(...args: Parameters<typeof sendDebtReminderActionInner>) {
  return guard(() => sendDebtReminderActionInner(...args));
}
