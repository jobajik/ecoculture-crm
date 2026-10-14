import { listBatches } from "./batches";
import { listOrdersWithItems } from "./orders";
import { sellableBatches } from "../sellableStock";
import type { Batch } from "../types";

/**
 * Партии для продажи: остаток минус обещанное по живым заявкам (`sellableStock.ts`). Не прочитались заявки —
 * партии как есть: лучше старый остаток, чем бот без склада.
 */
export async function listSellableBatches(): Promise<Batch[]> {
  const batches = await listBatches();
  try {
    return sellableBatches(batches, await listOrdersWithItems(), new Date());
  } catch {
    return batches;
  }
}
