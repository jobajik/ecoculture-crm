import type { StockVarietyCard } from "./stock";
import type { StorageStatus } from "./shelfLife";

/**
 * Переворот остатков «сорт → длины» в «ростовка → сорта».
 *
 * Снимок склада (`getStockSnapshot`) считается по сортам: карточка сорта, внутри
 * градации. Владельцу на главной нужен обратный разрез — сначала ростовка
 * (длина у розы, категория у хризантемы и эустомы), а внутри неё сорта. Так
 * устроена и торговля: клиент просит «шестидесятку», а каким кустом она выросла,
 * выясняется уже вторым вопросом.
 *
 * Функция лежит в `lib`, а не в компоненте: её зовёт клиентский `StockDetail` и
 * проверочный скрипт, а класть общий код в файл с «use client» — это грабли 1.8.
 */

const STATUS_RANK: Record<StorageStatus, number> = {
  depleted: 0,
  ok: 1,
  warning: 2,
  critical: 3,
};

function worseStatus(a: StorageStatus, b: StorageStatus): StorageStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/** Сорт внутри ростовки. */
export interface GradeVarietyRow {
  variety: string;
  quantity: number;
  batches: number;
  oldestDays: number;
  newestDays: number;
  maxDays: number;
  status: StorageStatus;
}

/** Строка верхнего уровня: одна ростовка одного цветка. */
export interface GradeCard {
  key: string;
  flowerType: string;
  grade: string;
  totalQuantity: number;
  batches: number;
  /** Самая старая партия в этой ростовке. */
  oldestDays: number;
  /** Самая свежая — чтобы показать разброс «1–5 дней». */
  newestDays: number;
  maxDays: number;
  status: StorageStatus;
  varieties: GradeVarietyRow[];
}

/** Сначала то, что нужно продать раньше: статус, потом доля прожитого срока, потом объём. */
function urgency(a: { status: StorageStatus; oldestDays: number; maxDays: number; quantity: number },
                 b: { status: StorageStatus; oldestDays: number; maxDays: number; quantity: number }) {
  return (
    STATUS_RANK[b.status] - STATUS_RANK[a.status] ||
    b.oldestDays / Math.max(1, b.maxDays) - a.oldestDays / Math.max(1, a.maxDays) ||
    b.quantity - a.quantity
  );
}

export function groupByGrade(cards: StockVarietyCard[]): GradeCard[] {
  const map = new Map<string, GradeCard>();

  for (const card of cards) {
    for (const g of card.grades) {
      const key = `${card.flowerType}:${g.grade.trim().toLowerCase()}`;
      const found = map.get(key) ?? {
        key,
        flowerType: card.flowerType,
        grade: g.grade,
        totalQuantity: 0,
        batches: 0,
        oldestDays: g.oldestDays,
        newestDays: g.newestDays,
        maxDays: g.maxDays,
        status: "ok" as StorageStatus,
        varieties: [] as GradeVarietyRow[],
      };
      found.totalQuantity += g.quantity;
      found.batches += g.batches;
      found.oldestDays = Math.max(found.oldestDays, g.oldestDays);
      found.newestDays = Math.min(found.newestDays, g.newestDays);
      found.maxDays = Math.max(found.maxDays, g.maxDays);
      found.status = worseStatus(found.status, g.status);
      found.varieties.push({
        variety: card.variety,
        quantity: g.quantity,
        batches: g.batches,
        oldestDays: g.oldestDays,
        newestDays: g.newestDays,
        maxDays: g.maxDays,
        status: g.status,
      });
      map.set(key, found);
    }
  }

  return Array.from(map.values())
    .map((c) => ({
      ...c,
      varieties: c.varieties.sort((a, b) =>
        urgency(a, b) || a.variety.localeCompare(b.variety, "ru")
      ),
    }))
    .sort((a, b) => urgency({ ...a, quantity: a.totalQuantity }, { ...b, quantity: b.totalQuantity }));
}
