"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { localDayKey } from "@/lib/timezone";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { appendPointWriteoff, deletePointWriteoff, listPointWriteoffs, savePointDay } from "@/lib/repo/point";
import { logMoney } from "@/lib/repo/moneyLog";
import { FLOWER_TYPE_LABELS, MONEY_LOG_ACTIONS } from "@/lib/constants";
import { avgTransferPrice, canEditPoint, POINT_NAME, pointDayRefusal, pointWriteoffRefusal } from "@/lib/point";

/**
 * Точка на базаре: выручка за день и списания. Вносит бухгалтер (и админ) —
 * решение владельца; РОП только смотрит. Правила — `src/lib/point.ts`.
 */
async function who() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  return { email: session.user.email.toLowerCase(), role: session.user.role };
}

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;
const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

async function savePointDayActionInner(input: { date: string; kaspi: number; cash: number; note: string }) {
  const { email, role } = await who();
  const date = String(input.date || "");
  const kaspi = num(input.kaspi);
  const cash = num(input.cash);
  const refusal = pointDayRefusal({ role, date, today: localDayKey(), kaspi, cash });
  if (refusal) throw new Error(refusal);
  const result = await savePointDay({ date, kaspi, cash, note: String(input.note || "").trim().slice(0, 200), email });
  await logMoney({
    actorEmail: email,
    orderId: "",
    action: MONEY_LOG_ACTIONS.POINT_DAY,
    details:
      result === "removed"
        ? `${POINT_NAME}: выручка за ${date.split("-").reverse().join(".")} удалена`
        : `${POINT_NAME}: выручка за ${date.split("-").reverse().join(".")} — Kaspi ${money(kaspi)}, наличные ${money(cash)}`,
    amountBefore: 0,
    amountAfter: kaspi + cash,
  });
  revalidatePath("/finance/point");
  return { ok: true, result };
}

async function addPointWriteoffActionInner(input: { date: string; flowerType: string; quantity: number; reason: string }) {
  const { email, role } = await who();
  const date = String(input.date || "");
  const quantity = Math.round(Number(input.quantity) || 0);
  const reason = String(input.reason || "").trim().slice(0, 200);
  const refusal = pointWriteoffRefusal({ role, date, today: localDayKey(), flowerType: input.flowerType, quantity, reason });
  if (refusal) throw new Error(refusal);
  // Во что обошлось — по средней цене отвезённого этого цветка на тот день.
  const price = avgTransferPrice(await listOrdersWithItems(), input.flowerType, date);
  const amount = Math.round(quantity * price * 100) / 100;
  await appendPointWriteoff({ date, flowerType: input.flowerType, quantity, amount, reason, createdByEmail: email });
  revalidatePath("/finance/point");
  return { ok: true, amount };
}

async function removePointWriteoffActionInner(writeoffId: string) {
  const { role } = await who();
  if (!canEditPoint(role)) throw new Error("Списание на точке правит бухгалтер");
  const found = (await listPointWriteoffs({ fresh: true })).find((w) => w.writeoffId === writeoffId);
  if (!found) throw new Error("Запись не найдена — возможно, её уже удалили");
  await deletePointWriteoff(writeoffId);
  revalidatePath("/finance/point");
  return { ok: true, label: `${FLOWER_TYPE_LABELS[found.flowerType] ?? found.flowerType} ${found.quantity}` };
}

// Обёртки: отказ ВОЗВРАЩАЕТСЯ, а не бросается (грабли 1.13).
export async function savePointDayAction(...args: Parameters<typeof savePointDayActionInner>) {
  return guard(() => savePointDayActionInner(...args));
}
export async function addPointWriteoffAction(...args: Parameters<typeof addPointWriteoffActionInner>) {
  return guard(() => addPointWriteoffActionInner(...args));
}
export async function removePointWriteoffAction(...args: Parameters<typeof removePointWriteoffActionInner>) {
  return guard(() => removePointWriteoffActionInner(...args));
}
