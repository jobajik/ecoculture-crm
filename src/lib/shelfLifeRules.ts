import { FLOWER_TYPE_LABELS } from "./constants";

/**
 * Сроки хранения: сколько дней цветок считается годным и с какой доли срока
 * партия помечается жёлтым.
 *
 * Числа маленькие, а последствия большие: срок хранения красит весь склад,
 * считает «запаса хватит на N дней» в аналитике и решает, что показать
 * просроченным. Ноль или пустое значение обнулили бы эту логику молча —
 * поэтому границы проверяются, и проверяются здесь, чистой функцией.
 *
 * Верхние границы намеренно щедрые (год хранения — явная опечатка, а 60 дней
 * для хризантемы в холодильнике — нет): задача не угадать правильный срок за
 * владельца, а не дать вписать ноль или «7 лет».
 */
export const MIN_SHELF_LIFE_DAYS = 1;
export const MAX_SHELF_LIFE_DAYS = 120;
export const MIN_WARNING_PERCENT = 10;
export const MAX_WARNING_PERCENT = 100;

export interface ShelfLifeDraft {
  /** Тип цветка → дней. Только те, что показывает форма. */
  days: Record<string, number>;
  /** Доля срока в процентах, после которой партия жёлтая. */
  warningPercent: number;
}

/** Почему сохранить нельзя. Пустая строка — можно. */
export function shelfLifeRefusal(draft: ShelfLifeDraft): string {
  for (const [flowerType, days] of Object.entries(draft.days)) {
    const label = FLOWER_TYPE_LABELS[flowerType] ?? flowerType;
    if (!Number.isFinite(days) || !Number.isInteger(days)) {
      return `Срок хранения «${label}» — целое число дней.`;
    }
    if (days < MIN_SHELF_LIFE_DAYS) {
      // Ноль — самый вероятный ввод, и он тише всего ломает: весь склад этого
      // цветка мгновенно становится просроченным.
      return `Срок хранения «${label}» не может быть меньше ${MIN_SHELF_LIFE_DAYS} дня — иначе весь этот цветок сразу станет просроченным.`;
    }
    if (days > MAX_SHELF_LIFE_DAYS) {
      return `Срок хранения «${label}» больше ${MAX_SHELF_LIFE_DAYS} дней — похоже на опечатку.`;
    }
  }

  const p = draft.warningPercent;
  if (!Number.isFinite(p) || !Number.isInteger(p)) {
    return "Порог предупреждения — целое число процентов.";
  }
  if (p < MIN_WARNING_PERCENT || p > MAX_WARNING_PERCENT) {
    return `Порог предупреждения — от ${MIN_WARNING_PERCENT} до ${MAX_WARNING_PERCENT} процентов.`;
  }

  return "";
}

/** В какие ключи вкладки `Settings` это ложится. */
export function shelfLifeValues(draft: ShelfLifeDraft): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [flowerType, days] of Object.entries(draft.days)) {
    values[`ShelfLifeDays_${flowerType}`] = String(days);
  }
  values["WarningThresholdPercent"] = String(draft.warningPercent);
  return values;
}
