import { normalizeStore } from "./officeStore";
import type { Batch } from "./types";

/**
 * Что можно ПРОДАТЬ, а не что числится в партиях (14.10.2026, владелец: «клиент не полностью закрывает счёт, а цветок
 * всё равно отгружен — ты не отнимаешь это со склада, у тебя неверный сток, и ты этот сток ещё пытаешься продать
 * клиентам»). На тот день у ИП Алымкулова висели 5 000 и 4 800 Altaj с доставкой 2 и 8 октября: цветок у клиента,
 * а в партиях он лежал, и бот предлагал его другим.
 *
 * Правило: из остатка партий вычитается то, что уже обещано по живым заявкам и ещё не отгружено (не отменена,
 * не отгружена целиком, оформлена за последние `RESERVE_DAYS` дней) — на том же складе (основной / офис), по цветку,
 * сорту и градации, от старых срезок к свежим: так склад и отгружал бы (FIFO). Старее — брошенная заявка, ей
 * место не держим. Это для бота, каталога и дожима; сами партии не меняются — списывает их только отгрузка.
 */
export const RESERVE_DAYS = 30;

export interface ReservingOrder {
  status: string;
  createdAt: string;
  store?: string | null;
  items: { flowerType: string; variety: string; grade: string; quantity: number; shippedQuantity: number }[];
}

const keyOf = (store: string, flower: string, variety: string, grade: string) =>
  `${store}|${flower}|${variety.trim().toLowerCase()}|${grade.trim().toLowerCase()}`;

/** Сколько стеблей по каждой позиции обещано и не отгружено. Ключ — «склад|цветок|сорт|градация». */
export function reservedStems(orders: ReservingOrder[], now: Date): Map<string, number> {
  const since = now.getTime() - RESERVE_DAYS * 86_400_000;
  const out = new Map<string, number>();
  for (const o of orders) {
    if (o.status === "cancelled" || o.status === "shipped") continue;
    const created = Date.parse(o.createdAt);
    if (Number.isFinite(created) && created < since) continue;
    const store = normalizeStore(o.store);
    for (const i of o.items) {
      const rest = Math.round((Number(i.quantity) || 0) - (Number(i.shippedQuantity) || 0));
      if (rest <= 0) continue;
      const k = keyOf(store, i.flowerType, i.variety, i.grade);
      out.set(k, (out.get(k) ?? 0) + rest);
    }
  }
  return out;
}

/** Партии с остатком за вычетом обещанного (от старых срезок к свежим). Исходный список не меняется. */
export function sellableBatches<B extends Batch>(batches: B[], orders: ReservingOrder[], now: Date): B[] {
  const left = reservedStems(orders, now);
  const sorted = [...batches].sort((a, b) => (a.harvestDate || "").localeCompare(b.harvestDate || ""));
  const reduced = new Map<string, number>();
  for (const b of sorted) {
    if (!(b.quantityRemaining > 0)) continue;
    const k = keyOf(normalizeStore(b.store), b.flowerType, b.variety || "", b.grade);
    const need = left.get(k) ?? 0;
    if (need <= 0) continue;
    const take = Math.min(need, b.quantityRemaining);
    left.set(k, need - take);
    reduced.set(b.batchId, b.quantityRemaining - take);
  }
  return batches.map((b) => (reduced.has(b.batchId) ? { ...b, quantityRemaining: reduced.get(b.batchId)! } : b));
}
