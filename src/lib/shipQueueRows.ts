import { FLOWER_TYPE_LABELS, formatGrade } from "./constants";
import { formatDay } from "./formatDate";
import { canShipUnpaid, creditNote, isReadyToShip } from "./orderReady";
import { byUrgency, orderStage, type OrderStage } from "./orderStage";
import { orderCode } from "./paymentStage";
import { deliveryGroup, nextDayKey, type DeliveryGroupKey } from "./shipQueue";
import type { BatchStorageInfo } from "./shelfLife";
import type { OrderWithItems } from "./types";

/**
 * Строки очереди отгрузки для браузера (новый вид, 19.10.2026): одна карточка с вкладками «Можно отгружать / Ждут /
 * Срок хранения», фильтрами по дню доставки и страницами. Сервер считает этап и готовность теми же функциями, что
 * и раньше (`orderStage`, `isReadyToShip`), а браузеру уходят только готовые к показу значения.
 */
export interface QueueRow {
  orderId: string;
  code: string;
  client: string;
  phone: string;
  delivery: string;
  group: DeliveryGroupKey;
  lines: string[];
  stage: OrderStage;
  credit: string;
  unpaidShip: boolean;
  /** Склад офиса может подтвердить заявку прямо из очереди. */
  canConfirm: boolean;
  /** Для поиска: клиент, номер, сорта. */
  search: string;
}

export interface QueueAlert {
  id: string;
  label: string;
  qty: number;
  days: number;
  maxDays: number;
  critical: boolean;
}

function deliveryLabel(day: string, today: string): string {
  if (!day) return "без даты";
  if (day === today) return "сегодня";
  if (day === nextDayKey(today)) return "завтра";
  return formatDay(day);
}

export function buildQueue(
  orders: OrderWithItems[],
  today: string,
  canConfirm: (o: OrderWithItems) => boolean = () => false
): { ready: QueueRow[]; waiting: QueueRow[] } {
  const stageOf = (o: OrderWithItems) => orderStage(o, today);
  const pending = orders
    .filter((o) => {
      const k = stageOf(o).key;
      return k !== "shipped" && k !== "cancelled";
    })
    .sort(byUrgency(stageOf));
  const row = (o: OrderWithItems): QueueRow => ({
    orderId: o.orderId,
    code: orderCode(o.orderId),
    client: o.clientName || "—",
    phone: o.clientPhone || "",
    delivery: deliveryLabel(String(o.deliveryDate || "").slice(0, 10), today),
    group: deliveryGroup(o.deliveryDate, today),
    lines: o.items.map((i) => `${i.variety} ${i.shippedQuantity}/${i.quantity}`),
    stage: stageOf(o),
    credit: creditNote(o),
    unpaidShip: canShipUnpaid(o),
    canConfirm: !o.managerConfirmed && canConfirm(o),
    search: [o.clientName, orderCode(o.orderId), ...o.items.map((i) => `${FLOWER_TYPE_LABELS[i.flowerType] ?? ""} ${i.variety}`)]
      .join(" ")
      .toLowerCase(),
  });
  return {
    ready: pending.filter((o) => isReadyToShip(o)).map(row),
    waiting: pending.filter((o) => !isReadyToShip(o)).map(row),
  };
}

export function queueAlerts(infos: BatchStorageInfo[]): QueueAlert[] {
  return infos
    .filter((s) => s.status === "warning" || s.status === "critical")
    .sort((a, b) => b.percentUsed - a.percentUsed)
    .map((a) => ({
      id: a.batch.batchId,
      label: `${FLOWER_TYPE_LABELS[a.batch.flowerType] ?? ""} ${a.batch.variety} · ${formatGrade(a.batch.grade)}`.trim(),
      qty: a.batch.quantityRemaining,
      days: a.daysInStorage,
      maxDays: a.maxDays,
      critical: a.status === "critical",
    }));
}
