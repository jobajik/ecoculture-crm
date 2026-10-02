"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/actionResult";
import { localDayKey } from "@/lib/timezone";
import { clearOrdersPaid, listOrdersWithItems } from "@/lib/repo/orders";
import { forgetReads } from "@/lib/sheets";
import { appendPointWriteoff, deletePointWriteoff, listPointWriteoffs, savePointDayByFarm } from "@/lib/repo/point";
import { logMoney } from "@/lib/repo/moneyLog";
import { FARM_LABELS, FARM_ORDER, FLOWER_TYPE_LABELS, MONEY_LOG_ACTIONS } from "@/lib/constants";
import {
  avgTransferPrice,
  canEditPoint,
  POINT_NAME,
  pointDayRefusal,
  pointMoneyClearRefusal,
  pointOrdersWithMoney,
  pointWriteoffRefusal,
} from "@/lib/point";

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

/** Выручка точки за день — по компаниям: Есентай (хризантема) и Rose Farm (роза, эустома). */
async function savePointDayActionInner(input: {
  date: string;
  parts: { farm: string; kaspi: number; cash: number }[];
  note: string;
}) {
  const { email, role } = await who();
  const date = String(input.date || "");
  const parts = FARM_ORDER.map((farm) => {
    const p = (input.parts || []).find((x) => x.farm === farm);
    return { farm, kaspi: num(p?.kaspi), cash: num(p?.cash) };
  });
  const kaspi = parts.reduce((s, p) => s + p.kaspi, 0);
  const cash = parts.reduce((s, p) => s + p.cash, 0);
  for (const p of parts) {
    const refusal = pointDayRefusal({ role, date, today: localDayKey(), kaspi: p.kaspi, cash: p.cash });
    if (refusal) throw new Error(refusal);
  }
  const result = await savePointDayByFarm({ date, parts, note: String(input.note || "").trim().slice(0, 200), email });
  const day = date.split("-").reverse().join(".");
  await logMoney({
    actorEmail: email,
    orderId: "",
    action: MONEY_LOG_ACTIONS.POINT_DAY,
    details:
      result === "removed"
        ? `${POINT_NAME}: выручка за ${day} удалена`
        : `${POINT_NAME}: выручка за ${day} — ` +
          parts
            .filter((p) => p.kaspi + p.cash > 0)
            .map((p) => `${FARM_LABELS[p.farm]}: Kaspi ${money(p.kaspi)}, наличные ${money(p.cash)}`)
            .join("; "),
    amountBefore: 0,
    amountAfter: kaspi + cash,
  });
  revalidatePath("/finance/point");
  return { ok: true, result, total: kaspi + cash };
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

/**
 * Снять деньги, внесённые прямо на перемещения (бухгалтер, 01.10: «удалить
 * оплаченные суммы из перемещения» — она вносит их заново по дням). Список
 * сервер проверяет сам по свежей базе (грабли 1.11); в журнал — одна запись.
 */
async function clearPointOrderMoneyActionInner(orderIds: string[]) {
  const { email, role } = await who();
  const ids = Array.from(new Set((orderIds || []).map(String)));
  forgetReads();
  const orders = await listOrdersWithItems();
  const refusal = pointMoneyClearRefusal(role, ids, orders);
  if (refusal) throw new Error(refusal);
  const chosen = pointOrdersWithMoney(orders).filter((o) => ids.includes(o.orderId));
  const total = chosen.reduce((s, o) => s + o.paidAmount, 0);
  await clearOrdersPaid(ids, email);
  await logMoney({
    actorEmail: email,
    orderId: ids.length === 1 ? ids[0] : "",
    action: MONEY_LOG_ACTIONS.PAYMENT_REMOVED,
    details:
      `${POINT_NAME}: сняты деньги, внесённые на перемещения (дальше — отчётом за день): ` +
      chosen.map((o) => `${o.clientName || o.orderId} ${money(o.paidAmount)}`).join("; "),
    amountBefore: total,
    amountAfter: 0,
  });
  revalidatePath("/finance/point");
  return { ok: true, count: chosen.length, total };
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
export async function clearPointOrderMoneyAction(...args: Parameters<typeof clearPointOrderMoneyActionInner>) {
  return guard(() => clearPointOrderMoneyActionInner(...args));
}
