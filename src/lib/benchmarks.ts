/**
 * Ориентиры хозяйства для аналитики.
 *
 * Лежат отдельным файлом, а не в `analytics.ts`, по двум причинам. Первая —
 * это бизнес-решение владельца: «списание больше семи процентов — плохо»
 * придумано не программой, и менять такое надо в одном понятном месте.
 * Вторая — техническая: `analytics.ts` тянет за собой доступ к Google-таблице,
 * и если бы страница (браузер) импортировала пороги оттуда, в сборку клиента
 * уехала бы вся библиотека googleapis.
 */

export type Tone = "good" | "warning" | "critical" | "neutral";

export interface Benchmark {
  /** До этого значения включительно — хорошо. */
  good: number;
  /** До этого — терпимо, дальше — плохо. */
  warn: number;
}

export const BENCHMARKS = {
  /** Списание от принятого, %. Меньше — лучше. */
  writeoffPercent: { good: 3, warn: 7 },
  /** Собираемость: оплачено от оформленного, %. Больше — лучше. */
  collectPercent: { good: 90, warn: 70 },
  /** Скидка к прайсу, %. Меньше — лучше. */
  discountPercent: { good: 5, warn: 15 },
  /** Доля просроченного на складе, %. Меньше — лучше. */
  expiredPercent: { good: 0, warn: 2 },
  /**
   * Запас в долях срока хранения: 1,0 — «остатка ровно на весь срок».
   * Больше единицы значит, что часть цветка гарантированно не успеет уйти.
   */
  coverRatio: { good: 0.7, warn: 1 },
  /** Доля трёх крупнейших клиентов в выручке, %. Меньше — устойчивее. */
  topClientsPercent: { good: 40, warn: 60 },
  /**
   * Выполнение по отгрузке: сколько из заказанного реально уехало по заявкам,
   * у которых дата доставки уже прошла. Больше — лучше.
   */
  fillRatePercent: { good: 95, warn: 80 },
} satisfies Record<string, Benchmark>;

/** Метрика, где меньше — лучше (списание, скидка, просрочка). */
export function toneLowerBetter(value: number, b: Benchmark): Tone {
  if (value <= b.good) return "good";
  if (value <= b.warn) return "warning";
  return "critical";
}

/** Метрика, где больше — лучше (собираемость). */
export function toneHigherBetter(value: number, b: Benchmark): Tone {
  if (value >= b.good) return "good";
  if (value >= b.warn) return "warning";
  return "critical";
}
