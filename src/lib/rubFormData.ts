import { FLOWER_TYPE_LABELS, formatGrade, getFarmFor } from "./constants";
import { directionForCity } from "./direction";
import { formatDay } from "./formatDate";
import { RUB_DIRECTION } from "./rubShipment";
import type { Batch, Client } from "./types";

/**
 * Списки для форм отгрузки в РФ — новой (`RubShipmentForm`) и правки (`RfShipmentEditForm`): один и тот же отбор
 * клиентов и партий, чтобы форма правки не предлагала то, что новая отгрузка не примет.
 */

/** Покупатели из базы: действующие, не наши магазины; клиенты из РФ — первыми. `keepId` — уже записанный клиент. */
export function rubFormClients(clients: Client[], keepId = ""): { clientId: string; name: string; city: string; rf: boolean }[] {
  return clients
    .filter((c) => (c.active && !(c.retail || "").trim()) || (keepId !== "" && c.clientId === keepId))
    .map((c) => ({ clientId: c.clientId, name: c.name, city: c.city || "", rf: directionForCity(c.city) === RUB_DIRECTION }))
    .sort((a, b) => Number(b.rf) - Number(a.rf) || a.name.localeCompare(b.name, "ru"));
}

/** Партии основного склада с остатком; у зав. складом — только её цветок (грабли 1.1-ter). */
export function rubFormBatches(batches: Batch[], farm: string): { batchId: string; title: string; cut: string; quantityRemaining: number }[] {
  return batches
    .filter((b) => b.quantityRemaining > 0 && !(b.store || "").trim() && (!farm || getFarmFor(b.flowerType) === farm))
    .sort(
      (a, b) =>
        a.flowerType.localeCompare(b.flowerType) ||
        a.variety.localeCompare(b.variety) ||
        a.grade.localeCompare(b.grade) ||
        (a.harvestDate || a.receivedAt).localeCompare(b.harvestDate || b.receivedAt)
    )
    .map((b) => ({
      batchId: b.batchId,
      title: `${FLOWER_TYPE_LABELS[b.flowerType]} ${b.variety} · ${formatGrade(b.grade)}`,
      cut: formatDay(b.harvestDate || b.receivedAt),
      quantityRemaining: b.quantityRemaining,
    }));
}
