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
  isKnownDirection,
  isValidPeriod,
  isValidWeekCode,
  monthOfWeek,
  weeksOfMonth,
  periodShift,
} from "@/lib/constants";
import { getShipmentPlansForMonth } from "@/lib/repo/shipmentPlans";
import { parseShipmentPlanWorkbook, type ShipmentPlanParseResult } from "@/lib/excel";

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
  // Здесь period — код недели («2026-09-W1»), а не месяц: план ведётся понедельно.
  if (!isValidWeekCode(period)) throw new Error("Неверная неделя");

  const cleaned: ShipmentPlanInput[] = rows.map((row) => {
    const direction = (row.direction || "").trim();
    const flowerType = (row.flowerType || "").trim();
    if (!isKnownDirection(direction)) {
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
  revalidatePath("/plans/balance");
  return result;
}

/**
 * Сохранение плана отгрузок ЗА ВЕСЬ МЕСЯЦ одним действием.
 *
 * Раньше сохранялась одна неделя: в сетке «направления × недели» человек правит
 * сразу весь месяц, и пять отдельных сохранений означали бы пять записей в
 * таблицу и пять шансов остановиться на середине.
 */
export async function saveShipmentPlansMonthAction(month: string, rows: ShipmentPlanInput[]) {
  const email = await requireSalesHead();
  if (!isValidPeriod(month)) throw new Error("Неверный месяц");

  const cleaned: ShipmentPlanInput[] = rows.map((row) => {
    const week = (row.period || "").trim();
    if (!isValidWeekCode(week)) throw new Error(`Неверная неделя: ${week || "(пусто)"}`);
    if (monthOfWeek(week) !== month) {
      throw new Error(`Неделя ${week} не из месяца ${month}`);
    }
    const direction = (row.direction || "").trim();
    const flowerType = (row.flowerType || "").trim();
    if (!isKnownDirection(direction)) {
      throw new Error(`Неизвестное направление: ${direction || "(пусто)"}`);
    }
    if (!FLOWER_TYPE_LABELS[flowerType]) {
      throw new Error(`Неизвестный тип цветка: ${flowerType || "(пусто)"}`);
    }
    const what = `${direction} · ${FLOWER_TYPE_LABELS[flowerType]}`;
    return {
      period: week,
      direction,
      flowerType,
      targetStems: cleanStems(row.targetStems, what),
      targetAmount: cleanAmount(row.targetAmount, what),
    };
  });

  const result = await saveShipmentPlans(cleaned, email);

  revalidatePath("/plans/shipments");
  revalidatePath("/plans/balance");
  return result;
}

/**
 * План прошлого месяца, разложенный на недели текущего.
 *
 * Недель в месяце бывает пять, а бывает четыре, поэтому переносим ПО НОМЕРУ
 * недели: первая в первую, вторая во вторую. Если в прошлом месяце недель было
 * больше, лишняя просто не переносится — придумывать ей место было бы враньём.
 * Ничего не записывает: цифры подставляются в форму, и человек их видит до
 * сохранения.
 */
export async function copyPreviousShipmentPlanAction(
  month: string
): Promise<{ cells: { week: string; direction: string; flowerType: string; stems: number }[]; fromMonth: string }> {
  await requireSalesHead();
  if (!isValidPeriod(month)) throw new Error("Неверный месяц");

  const fromMonth = periodShift(month, -1);
  const previous = await getShipmentPlansForMonth(fromMonth);
  const fromWeeks = weeksOfMonth(fromMonth);
  const toWeeks = weeksOfMonth(month);

  const cells: { week: string; direction: string; flowerType: string; stems: number }[] = [];
  for (const to of toWeeks) {
    const from = fromWeeks.find((w) => w.index === to.index);
    if (!from) continue;
    for (const row of previous.values()) {
      if (row.period !== from.code) continue;
      if (row.targetStems <= 0) continue;
      cells.push({
        week: to.code,
        direction: row.direction,
        flowerType: row.flowerType,
        stems: row.targetStems,
      });
    }
  }
  return { cells, fromMonth };
}

/** Читает файл плана и возвращает разобранные строки. Ничего не записывает. */
export async function parseShipmentPlanFileAction(
  formData: FormData
): Promise<ShipmentPlanParseResult> {
  await requireSalesHead();

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return { rows: [], validCount: 0, errorCount: 0, fatalError: "Файл не получен" };
  }
  const month = String(formData.get("month") ?? "");
  if (!isValidPeriod(month)) {
    return { rows: [], validCount: 0, errorCount: 0, fatalError: "Не понял, за какой месяц файл" };
  }

  const buffer = await (file as File).arrayBuffer();
  return parseShipmentPlanWorkbook(buffer, month);
}
