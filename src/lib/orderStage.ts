import { isRegionOrder } from "./orderKind";
import { isReadyToShip, missingForShip, shipsOnCredit, type ShipGateOrder } from "./orderReady";

/**
 * ЭТАП заявки — одно слово на всех экранах и «чей сейчас ход».
 *
 * Аудит сентября: статус у заявки почти всегда «Новая» (210 отгружены, 40
 * новые, «Готова к отгрузке» не ставилась ни разу, «В работе» — один раз), а
 * готовность жила отдельно и называлась на разных экранах пятью разными словами:
 * «✓✓ можно собирать», «Готова к сборке — в долг», «Можно отгружать», «Готовы к
 * сборке», «Ждёт подтверждения менеджера». Человек угадывал, что значит слово и
 * от кого теперь зависит заявка, — отсюда звонки «а что с заявкой?».
 *
 * Этап НЕ хранится: он считается из фактов, которые и так лежат в заявке
 * (статус отгрузки, подтверждение, деньги, условия клиента, дата доставки).
 * Третье поле об одном и том же разъехалось бы с первыми двумя — то же решение,
 * что у стадии оплаты и у флага «оплачено».
 *
 * Отдельно от этапа — ОПОЗДАНИЕ: доставка прошла, а заявка не отгружена
 * целиком. По живой базе таких было 28 из 41 открытой, и нигде в программе это
 * не было видно.
 */

export type StageKey = "cancelled" | "shipped" | "partly" | "ready" | "wait_confirm" | "wait_money";
export type StageTone = "muted" | "wait" | "ready" | "done";

export interface OrderStage {
  key: StageKey;
  /** Слово для бейджа — одно и то же во всех списках. */
  label: string;
  tone: StageTone;
  /** Кто должен сделать следующий шаг; пусто — никто, заявка закрыта. */
  actor: string;
  /** Следующий шаг словами — для страницы заявки. */
  next: string;
  /** Сколько дней назад прошла доставка, если заявка не отгружена; иначе 0. */
  lateDays: number;
  /** Осталось отгрузить, стеблей. */
  remaining: number;
}

export interface StageOrder extends ShipGateOrder {
  status: string;
  deliveryDate: string;
  retail?: string;
  kind?: string;
  items: { quantity: number; shippedQuantity: number }[];
}

export const STAGE_LABELS: Record<StageKey, string> = {
  wait_confirm: "Ждёт подтверждения",
  wait_money: "Ждёт оплаты",
  ready: "Готова к отгрузке",
  partly: "Частично отгружена",
  shipped: "Отгружена",
  cancelled: "Отменена",
};

/** Порядок в фильтре — по ходу жизни заявки. */
export const STAGE_ORDER: StageKey[] = ["wait_confirm", "wait_money", "ready", "partly", "shipped", "cancelled"];

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from.slice(0, 10)}T00:00:00`).getTime();
  const b = new Date(`${to.slice(0, 10)}T00:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function whoConfirms(order: StageOrder): string {
  if (isRegionOrder(order)) return "автор заявки";
  if ((order.retail || "").trim()) return "менеджер розницы";
  return "менеджер";
}

export function orderStage(order: StageOrder, today: string): OrderStage {
  const remaining = order.items.reduce((s, i) => s + Math.max(0, i.quantity - i.shippedQuantity), 0);
  const shippedAny = order.items.some((i) => i.shippedQuantity > 0);
  const base = { remaining, lateDays: 0 };

  if (order.status === "cancelled") {
    return { ...base, key: "cancelled", label: STAGE_LABELS.cancelled, tone: "muted", actor: "", next: "" };
  }
  if (order.status === "shipped" || (order.items.length > 0 && remaining === 0)) {
    return { ...base, key: "shipped", label: STAGE_LABELS.shipped, tone: "done", actor: "", next: "" };
  }

  const late = order.deliveryDate ? daysBetween(order.deliveryDate, today) : 0;
  const lateDays = late > 0 ? late : 0;

  // Готовность спрашивается у той же функции, что открывает отгрузку на
  // сервере, — двух формулировок одного правила быть не должно.
  if (!isReadyToShip({ ...order, status: "new" })) {
    const missing = missingForShip(order);
    if (!order.managerConfirmed) {
      const who = whoConfirms(order);
      return {
        ...base,
        lateDays,
        key: "wait_confirm",
        label: STAGE_LABELS.wait_confirm,
        tone: "wait",
        actor: who,
        next: `Подтвердить заявку — ${who}`,
      };
    }
    const rest = missing.find((m) => m.startsWith("остатка"));
    return {
      ...base,
      lateDays,
      key: "wait_money",
      label: rest ? "Ждёт остатка оплаты" : STAGE_LABELS.wait_money,
      tone: "wait",
      actor: "бухгалтер",
      next: `Дождаться ${rest ?? "оплаты"} от клиента и провести её — бухгалтер`,
    };
  }

  const credit = shipsOnCredit(order);
  if (shippedAny) {
    return {
      ...base,
      lateDays,
      key: "partly",
      label: STAGE_LABELS.partly,
      tone: "ready",
      actor: "склад",
      next: `Отгрузить остаток ${remaining.toLocaleString("ru-RU")} шт. — склад`,
    };
  }
  return {
    ...base,
    lateDays,
    key: "ready",
    label: credit ? "Готова · в долг" : STAGE_LABELS.ready,
    tone: "ready",
    actor: "склад",
    next: "Собрать и отгрузить — склад",
  };
}

/** Сортировка очередей: сначала опоздавшие (давние выше), потом по дню доставки. */
export function byUrgency<T extends { deliveryDate: string }>(stageOf: (o: T) => OrderStage) {
  return (a: T, b: T): number => {
    const la = stageOf(a).lateDays;
    const lb = stageOf(b).lateDays;
    if (la !== lb) return lb - la;
    const da = a.deliveryDate || "9999";
    const db = b.deliveryDate || "9999";
    return da < db ? -1 : da > db ? 1 : 0;
  };
}

/** «просрочена 3 дн.» — для метки рядом с этапом. */
export function lateLabel(days: number): string {
  if (days <= 0) return "";
  return days === 1 ? "доставка была вчера" : `доставка прошла ${days} дн. назад`;
}
