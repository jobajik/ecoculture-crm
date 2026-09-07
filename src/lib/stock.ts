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

/**
 * Диапазоны по времени хранения. Границы одинаковые для всех цветков — это
 * вопрос «сколько дней лежит», а не «сколько ему осталось»: владелец смотрит на
 * склад целиком. А вот цвет внутри диапазона у каждого свой, потому что роза на
 * восьмой день уже просрочена, а хризантема ещё свежая (сроки хранения — на
 * вкладке Settings). Поэтому в одном диапазоне могут стоять и зелёный, и
 * красный сорт, и это не ошибка.
 */
export const AGE_BUCKETS = [
  { key: "1-3", label: "1–3 дня", minDays: 0, maxDays: 3 },
  { key: "4-7", label: "4–7 дней", minDays: 4, maxDays: 7 },
  { key: "8-13", label: "8–13 дней", minDays: 8, maxDays: 13 },
  { key: "14+", label: "14 дней и больше", minDays: 14, maxDays: Infinity },
] as const;

export function ageBucketKeyOf(daysInStorage: number): string {
  const bucket = AGE_BUCKETS.find((b) => daysInStorage >= b.minDays && daysInStorage <= b.maxDays);
  return (bucket ?? AGE_BUCKETS[AGE_BUCKETS.length - 1]).key;
}

/** Строка внутри диапазона: сорт целиком, без длин — так просил владелец. */
export interface AgeBucketVariety {
  flowerType: string;
  variety: string;
  quantity: number;
  batches: number;
  /** Самая старая партия сорта внутри этого диапазона. */
  oldestDays: number;
  maxDays: number;
  status: StorageStatus;
}

export interface AgeBucketRow {
  key: string;
  label: string;
  minDays: number;
  /** Infinity у последнего диапазона. */
  maxDays: number;
  quantity: number;
  batches: number;
  /** Доля от всего склада, 0…1. */
  share: number;
  /** Худший статус внутри диапазона — им и подсвечивается плитка. */
  status: StorageStatus;
  varieties: AgeBucketVariety[];
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
  /** Разбивка по времени хранения: 1–3, 4–7, 8–13, 14+ дней. */
  ageBuckets: AgeBucketRow[];
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

  // --- Диапазоны по времени хранения ---------------------------------------
  // Считаем по партиям, а складываем по сортам: длины здесь не нужны, вопрос
  // стоит «сколько цветка какого сорта пролежало столько-то дней».
  const bucketMap = new Map<string, Map<string, AgeBucketVariety>>();
  for (const bucket of AGE_BUCKETS) bucketMap.set(bucket.key, new Map());

  for (const info of active) {
    const b = info.batch;
    const rows = bucketMap.get(ageBucketKeyOf(info.daysInStorage))!;
    const key = `${b.flowerType}:${b.variety.trim().toLowerCase()}`;
    const row = rows.get(key) ?? {
      flowerType: b.flowerType,
      variety: b.variety,
      quantity: 0,
      batches: 0,
      oldestDays: info.daysInStorage,
      maxDays: info.maxDays,
      status: info.status,
    };
    row.quantity += b.quantityRemaining;
    row.batches += 1;
    row.oldestDays = Math.max(row.oldestDays, info.daysInStorage);
    row.status = worseStatus(row.status, info.status);
    rows.set(key, row);
  }

  const ageBuckets: AgeBucketRow[] = AGE_BUCKETS.map((bucket) => {
    const varieties = Array.from(bucketMap.get(bucket.key)!.values()).sort(
      (a, b) => b.quantity - a.quantity || a.variety.localeCompare(b.variety, "ru")
    );
    const quantity = varieties.reduce((s, v) => s + v.quantity, 0);
    return {
      key: bucket.key,
      label: bucket.label,
      minDays: bucket.minDays,
      maxDays: bucket.maxDays,
      quantity,
      batches: varieties.reduce((s, v) => s + v.batches, 0),
      share: totalStems > 0 ? quantity / totalStems : 0,
      status: varieties.reduce<StorageStatus>((worst, v) => worseStatus(worst, v.status), "ok"),
      varieties,
    };
  });

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
    ageBuckets,
  };
}
