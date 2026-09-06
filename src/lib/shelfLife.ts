import { FLOWER_TYPE_LABELS } from "./constants";
import type { Batch, Settings } from "./types";

export type StorageStatus = "ok" | "warning" | "critical" | "depleted";

export interface BatchStorageInfo {
  batch: Batch;
  daysInStorage: number;
  maxDays: number;
  percentUsed: number; // 0..1+ (может быть >1, если просрочена)
  status: StorageStatus;
}

export function daysBetween(fromISODate: string, toDate: Date = new Date()): number {
  const from = new Date(fromISODate);
  if (Number.isNaN(from.getTime())) return 0;
  const ms = toDate.getTime() - from.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function getMaxShelfLifeDays(flowerType: string, settings: Settings): number {
  return settings.shelfLifeDays[flowerType] ?? 10;
}

export function computeBatchStorageInfo(batch: Batch, settings: Settings, now: Date = new Date()): BatchStorageInfo {
  const daysInStorage = daysBetween(batch.harvestDate, now);
  const maxDays = getMaxShelfLifeDays(batch.flowerType, settings);
  const percentUsed = maxDays > 0 ? daysInStorage / maxDays : 0;

  let status: StorageStatus = "ok";
  if (batch.quantityRemaining <= 0) {
    status = "depleted";
  } else if (percentUsed >= 1) {
    status = "critical";
  } else if (percentUsed >= settings.warningThreshold) {
    status = "warning";
  }

  return { batch, daysInStorage, maxDays, percentUsed, status };
}

export const STORAGE_STATUS_LABELS: Record<StorageStatus, string> = {
  ok: "В норме",
  warning: "Требует внимания",
  critical: "Просрочена",
  depleted: "Реализована",
};

export function flowerTypeLabel(flowerType: string): string {
  return FLOWER_TYPE_LABELS[flowerType] ?? flowerType;
}
