import { FLOWER_TYPES, FLOWER_TYPE_LABELS_PLURAL } from "./constants";

/**
 * План продаж менеджеру — РАЗБИТЫЙ ПО ЦВЕТКУ.
 *
 * Раньше строка плана была одна на менеджера и месяц: сумма и стебли. Владелец
 * попросил разделить её по цветкам — и это не украшательство. Роза, хризантема
 * и эустома растут на разных производствах, продаются по разной цене и дают
 * разный бонус (1,5 % против 2 %). План «продать на четыре с половиной
 * миллиона» выполняется одной розой, и по нему нельзя понять, провалили
 * хризантему или нет; а провал хризантемы — это простаивающий Есентай.
 *
 * Устройство:
 *
 * - строка на месяц + менеджера + ЦВЕТОК, колонка `FlowerType` дописана
 *   ПОСЛЕДНЕЙ (грабли 1.1: таблица читается по позиции);
 * - **итог по менеджеру не хранится отдельным числом, а складывается из
 *   цветков.** Два поля об одном и том же рано или поздно разъезжаются — так
 *   же решено с оплатой по компаниям и с суммой в плане отгрузок;
 * - строки, записанные ДО разделения, лежат с пустым цветком. Они не
 *   выбрасываются: пока по менеджеру нет ни одной строки по цветку, его план —
 *   это старое число. Как только появилась хоть одна строка по цветку, старая
 *   перестаёт участвовать в счёте (и обнуляется при записи — см. `savePlans`),
 *   иначе в таблице остались бы два числа об одном и том же месяце.
 *
 * Правила живут здесь, в обычном модуле без `"use client"`: их зовёт и
 * серверная страница, и форма в браузере, и проверочный скрипт (грабли 1.8).
 */

/** Порядок цветков в плане — тот же, что везде в интерфейсе. */
export const PLAN_FLOWERS: string[] = [
  FLOWER_TYPES.ROSE,
  FLOWER_TYPES.CHRYSANTHEMUM,
  FLOWER_TYPES.EUSTOMA,
];

export function planFlowerLabel(flowerType: string): string {
  return FLOWER_TYPE_LABELS_PLURAL[flowerType] ?? flowerType;
}

/**
 * Приводит значение из таблицы к известному цветку.
 *
 * Неизвестное значение (опечатка в ячейке, старая схема) превращается в пустое,
 * то есть в «план без разбивки». Придумывать за человека цветок нельзя: строка
 * с опечаткой «roza» ушла бы в розы и тихо завысила бы им план.
 */
export function cleanPlanFlower(value: string | null | undefined): string {
  const raw = String(value ?? "").trim().toLowerCase();
  return PLAN_FLOWERS.includes(raw) ? raw : "";
}

/** Ключ ячейки «менеджер × цветок» — общий для формы и для сборки данных. */
export function planCellKey(email: string, flowerType: string): string {
  return `${String(email ?? "").trim().toLowerCase()}|${cleanPlanFlower(flowerType)}`;
}

export interface ManagerPlanInput {
  period: string;
  managerEmail: string;
  /** Пусто — строка старой схемы, план без разбивки по цветку. */
  flowerType: string;
  targetAmount: number;
  targetStems: number;
}

export interface PlanAmount {
  targetAmount: number;
  targetStems: number;
}

export interface ManagerPlanTotal extends PlanAmount {
  period: string;
  managerEmail: string;
  /** План по каждому цветку. Незаполненного цветка в наборе нет. */
  byFlower: Record<string, PlanAmount>;
  /** Есть ли хоть одна строка по цветку — от этого зависит, что считать итогом. */
  splitByFlower: boolean;
  /** Старое число «без разбивки»: показывается, пока цветки не заполнены. */
  legacy: PlanAmount;
}

function blankAmount(): PlanAmount {
  return { targetAmount: 0, targetStems: 0 };
}

/**
 * Складывает строки плана в итог по менеджерам за один месяц.
 *
 * Чужие месяцы отбрасываются здесь, а не в вызывающем коде: забыть этот фильтр
 * в одном из трёх мест, где план читают, — вопрос времени.
 */
export function aggregateManagerPlans(
  rows: ManagerPlanInput[],
  period: string
): Map<string, ManagerPlanTotal> {
  const result = new Map<string, ManagerPlanTotal>();

  const ensure = (email: string): ManagerPlanTotal => {
    let row = result.get(email);
    if (!row) {
      row = {
        period,
        managerEmail: email,
        targetAmount: 0,
        targetStems: 0,
        byFlower: {},
        splitByFlower: false,
        legacy: blankAmount(),
      };
      result.set(email, row);
    }
    return row;
  };

  for (const input of rows) {
    if ((input.period || "").trim() !== period) continue;
    const email = (input.managerEmail || "").trim().toLowerCase();
    if (!email) continue;

    const amount = Number.isFinite(input.targetAmount) ? Math.max(0, input.targetAmount) : 0;
    const stems = Number.isFinite(input.targetStems) ? Math.max(0, input.targetStems) : 0;
    const flower = cleanPlanFlower(input.flowerType);
    const row = ensure(email);

    if (!flower) {
      row.legacy.targetAmount += amount;
      row.legacy.targetStems += stems;
      continue;
    }

    // Строка по цветку есть — значит план разнесён, даже если в ней нули:
    // ноль по хризантеме это тоже решение РОПа («в этом месяце не продаём»).
    row.splitByFlower = true;
    const cell = row.byFlower[flower] ?? blankAmount();
    cell.targetAmount += amount;
    cell.targetStems += stems;
    row.byFlower[flower] = cell;
  }

  for (const row of result.values()) {
    if (row.splitByFlower) {
      row.targetAmount = PLAN_FLOWERS.reduce(
        (sum, f) => sum + (row.byFlower[f]?.targetAmount ?? 0),
        0
      );
      row.targetStems = PLAN_FLOWERS.reduce(
        (sum, f) => sum + (row.byFlower[f]?.targetStems ?? 0),
        0
      );
    } else {
      row.targetAmount = row.legacy.targetAmount;
      row.targetStems = row.legacy.targetStems;
    }
  }

  return result;
}

/** Итог отдела по каждому цветку — для строки «по цветку» в плане и в отчёте. */
export function planByFlower(plans: Iterable<ManagerPlanTotal>): Record<string, PlanAmount> {
  const totals: Record<string, PlanAmount> = {};
  for (const flower of PLAN_FLOWERS) totals[flower] = blankAmount();
  for (const plan of plans) {
    // План без разбивки в разрез по цветку не идёт: неизвестно, какому цветку
    // он принадлежит. Показать его розой значило бы соврать в отчёте.
    if (!plan.splitByFlower) continue;
    for (const flower of PLAN_FLOWERS) {
      const cell = plan.byFlower[flower];
      if (!cell) continue;
      totals[flower].targetAmount += cell.targetAmount;
      totals[flower].targetStems += cell.targetStems;
    }
  }
  return totals;
}

/** Сколько плана ещё не разнесено по цветкам — сумма старых строк. */
export function unsplitPlanAmount(plans: Iterable<ManagerPlanTotal>): number {
  let total = 0;
  for (const plan of plans) if (!plan.splitByFlower) total += plan.legacy.targetAmount;
  return total;
}
