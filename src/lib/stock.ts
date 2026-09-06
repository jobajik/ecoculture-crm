import { listBatches } from "./repo/batches";
import { getSettings } from "./repo/settings";
import { computeBatchStorageInfo, type StorageStatus } from "./shelfLife";
import { getFarmFor } from "./constants";
import type { Batch, Settings } from "./types";

// ---------------------------------------------------------------------------
// Сводка остатков «как сейчас»: сколько чего лежит на складе и сколько дней
// прошло с даты срезки. Используется на главной странице — её видят все роли.
// ---------------------------------------------------------------------------

export interface StockGradeRow {
  grade: string;
  quantity: number;
  batches: number;
  /** Возраст самой старой партии этой градации, в днях от срезки. */
  oldestDays: number;
  /** Возраст самой свежей партии — чтобы видеть разброс. */
  newestDays: number;
  maxDays: number;
  status: StorageStatus;
}

export interface StockVarietyCard {
  key: string;
  farm: string;
  flowerType: string;
  variety: string;
  totalQuantity: number;
  oldestDays: number;
  status: StorageStatus;
  grades: StockGradeRow[];
}

export interface UrgentBatchRow {
  batchId: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  daysInStorage: number;
  maxDays: number;
  status: StorageStatus;
  location: string;
}

export interface StockSnapshot {
  generatedAt: string;
  totalStems: number;
  totalBatches: number;
  varietyCount: number;
  avgAgeDays: number;
  warningStems: number;
  criticalStems: number;
  byFlowerType: { flowerType: string; quantity: number }[];
  byFarm: { farm: string; quantity: number; batches: number }[];
  varieties: StockVarietyCard[];
  urgent: UrgentBatchRow[];
}

/** Самый «тревожный» из двух статусов — им и красим карточку целиком. */
function worseStatus(a: StorageStatus, b: StorageStatus): StorageStatus {
  const rank: Record<StorageStatus, number> = { depleted: 0, ok: 1, warning: 2, critical: 3 };
  return rank[a] >= rank[b] ? a : b;
}

export async function getStockSnapshot(
  now: Date = new Date(),
  /** Для тестов: можно подставить данные вместо чтения из Google-таблицы. */
  injected?: { batches: Batch[]; settings: Settings },
  /** Ограничение по производству — зав. складом видит только свой цветок. */
  farmFilter?: string | null
): Promise<StockSnapshot> {
  const [batches, settings] = injected
    ? [injected.batches, injected.settings]
    : await Promise.all([listBatches(), getSettings()]);

  const active = batches
    .filter((b) => b.quantityRemaining > 0)
    .filter((b) => !farmFilter || getFarmFor(b.flowerType) === farmFilter)
    .map((b) => computeBatchStorageInfo(b, settings, now));

  const totalStems = active.reduce((sum, i) => sum + i.batch.quantityRemaining, 0);
  const warningStems = active
    .filter((i) => i.status === "warning")
    .reduce((sum, i) => sum + i.batch.quantityRemaining, 0);
  const criticalStems = active
    .filter((i) => i.status === "critical")
    .reduce((sum, i) => sum + i.batch.quantityRemaining, 0);

  // Средний возраст считаем взвешенным по количеству — так он честнее отражает склад.
  const weightedAge = active.reduce((sum, i) => sum + i.daysInStorage * i.batch.quantityRemaining, 0);
  const avgAgeDays = totalStems > 0 ? weightedAge / totalStems : 0;

  const byTypeMap = new Map<string, number>();
  const byFarmMap = new Map<string, { quantity: number; batches: number }>();
  const varietyMap = new Map<string, StockVarietyCard>();
  const gradeMap = new Map<string, StockGradeRow>();

  for (const info of active) {
    const b = info.batch;
    const qty = b.quantityRemaining;

    byTypeMap.set(b.flowerType, (byTypeMap.get(b.flowerType) ?? 0) + qty);

    const farm = getFarmFor(b.flowerType) ?? "";
    const farmRow = byFarmMap.get(farm) ?? { quantity: 0, batches: 0 };
    farmRow.quantity += qty;
    farmRow.batches += 1;
    byFarmMap.set(farm, farmRow);

    const varietyKey = `${b.flowerType}:${b.variety.trim().toLowerCase()}`;
    const gradeKey = `${varietyKey}:${b.grade.trim().toLowerCase()}`;

    const gradeRow = gradeMap.get(gradeKey) ?? {
      grade: b.grade,
      quantity: 0,
      batches: 0,
      oldestDays: info.daysInStorage,
      newestDays: info.daysInStorage,
      maxDays: info.maxDays,
      status: info.status,
    };
    gradeRow.quantity += qty;
    gradeRow.batches += 1;
    gradeRow.oldestDays = Math.max(gradeRow.oldestDays, info.daysInStorage);
    gradeRow.newestDays = Math.min(gradeRow.newestDays, info.daysInStorage);
    gradeRow.status = worseStatus(gradeRow.status, info.status);
    gradeMap.set(gradeKey, gradeRow);

    const card = varietyMap.get(varietyKey) ?? {
      key: varietyKey,
      farm: getFarmFor(b.flowerType) ?? "",
      flowerType: b.flowerType,
      variety: b.variety,
      totalQuantity: 0,
      oldestDays: 0,
      status: "ok" as StorageStatus,
      grades: [],
    };
    card.totalQuantity += qty;
    card.oldestDays = Math.max(card.oldestDays, info.daysInStorage);
    card.status = worseStatus(card.status, info.status);
    varietyMap.set(varietyKey, card);
  }

  // Раскладываем градации по карточкам сортов.
  for (const [gradeKey, gradeRow] of gradeMap.entries()) {
    const varietyKey = gradeKey.slice(0, gradeKey.lastIndexOf(":"));
    const card = varietyMap.get(varietyKey);
    if (card) card.grades.push(gradeRow);
  }

  const varieties = Array.from(varietyMap.values())
    .map((card) => ({
      ...card,
      // Внутри карточки сначала то, что дольше лежит — его и надо продавать первым.
      grades: card.grades.sort((a, b) => b.oldestDays - a.oldestDays || b.quantity - a.quantity),
    }))
    .sort((a, b) => b.totalQuantity - a.totalQuantity);

  const urgent: UrgentBatchRow[] = active
    .filter((i) => i.status === "warning" || i.status === "critical")
    .sort((a, b) => b.percentUsed - a.percentUsed)
    .slice(0, 12)
    .map((i) => ({
      batchId: i.batch.batchId,
      flowerType: i.batch.flowerType,
      variety: i.batch.variety,
      grade: i.batch.grade,
      quantity: i.batch.quantityRemaining,
      daysInStorage: i.daysInStorage,
      maxDays: i.maxDays,
      status: i.status,
      location: i.batch.location,
    }));

  return {
    generatedAt: now.toISOString(),
    totalStems,
    totalBatches: active.length,
    varietyCount: varieties.length,
    avgAgeDays,
    warningStems,
    criticalStems,
    byFlowerType: Array.from(byTypeMap.entries())
      .map(([flowerType, quantity]) => ({ flowerType, quantity }))
      .sort((a, b) => b.quantity - a.quantity),
    byFarm: Array.from(byFarmMap.entries())
      .map(([farm, v]) => ({ farm, quantity: v.quantity, batches: v.batches }))
      .sort((a, b) => b.quantity - a.quantity),
    varieties,
    urgent,
  };
}
