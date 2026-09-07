"use server";

import { getServerSession } from "next-auth";
import { revalidatePath } from "next/cache";
import { authOptions } from "@/lib/auth";
import { savePlans, type PlanRow } from "@/lib/repo/plans";
import {
  saveShipmentPlans,
  type ShipmentPlanInput,
} from "@/lib/repo/shipmentPlans";
import {
  FLOWER_TYPE_LABELS,
  SHIPMENT_DIRECTIONS,
  isValidPeriod,
} from "@/lib/constants";

/**
 * Планы ставит руководитель отдела продаж (и администратор). Проверка здесь,
 * на сервере, а не только в интерфейсе: скрыть кнопку — не то же самое, что
 * запретить действие.
 */
async function requireSalesHead(): Promise<string> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) throw new Error("Не авторизован");
  const role = session.user.role;
  if (role !== "sales_head" && role !== "admin") {
    throw new Error("Недостаточно прав: планы ставит руководитель отдела продаж");
  }
  return session.user.email.toLowerCase();
}

/** Отсекаем мусор: отрицательные, дробные и невозможно большие числа. */
function cleanStems(value: unknown, what: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) throw new Error(`${what}: количество не может быть отрицательным`);
  if (num > 100_000_000) throw new Error(`${what}: слишком большое количество`);
  return Math.round(num);
}

function cleanAmount(value: unknown, what: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) throw new Error(`${what}: сумма не может быть отрицательной`);
  if (num > 1_000_000_000_000) throw new Error(`${what}: слишком большая сумма`);
  return Math.round(num);
}

export async function saveManagerPlansAction(period: string, rows: PlanRow[]) {
  await requireSalesHead();
  if (!isValidPeriod(period)) throw new Error("Неверный месяц");

  const cleaned: PlanRow[] = rows.map((row) => {
    const email = (row.managerEmail || "").trim().toLowerCase();
    if (!email) throw new Error("У строки плана не указан менеджер");
    return {
      period,
      managerEmail: email,
      targetAmount: cleanAmount(row.targetAmount, email),
      targetStems: cleanStems(row.targetStems, email),
    };
  });

  const result = await savePlans(cleaned);

  revalidatePath("/plans");
  revalidatePath("/sales");
  revalidatePath("/sales/plan");
  return result;
}

export async function saveShipmentPlansAction(period: string, rows: ShipmentPlanInput[]) {
  const email = await requireSalesHead();
  if (!isValidPeriod(period)) throw new Error("Неверный месяц");

  const cleaned: ShipmentPlanInput[] = rows.map((row) => {
    const direction = (row.direction || "").trim();
    const flowerType = (row.flowerType || "").trim();
    if (!SHIPMENT_DIRECTIONS.includes(direction as never)) {
      throw new Error(`Неизвестное направление: ${direction || "(пусто)"}`);
    }
    if (!FLOWER_TYPE_LABELS[flowerType]) {
      throw new Error(`Неизвестный тип цветка: ${flowerType || "(пусто)"}`);
    }
    const what = `${direction} · ${FLOWER_TYPE_LABELS[flowerType]}`;
    return {
      period,
      direction,
      flowerType,
      targetStems: cleanStems(row.targetStems, what),
      targetAmount: cleanAmount(row.targetAmount, what),
    };
  });

  const result = await saveShipmentPlans(cleaned, email);

  revalidatePath("/plans/shipments");
  return result;
}
