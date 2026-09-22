"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createShipmentAction } from "@/app/warehouse/actions";
import clsx from "clsx";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import type { Batch, OrderWithItems } from "@/lib/types";
import { unwrap } from "@/lib/actionResult";

/** Русское склонение дней: 1 день, 2 дня, 5 дней. */
function dayWord(n: number) {
  const t = Math.abs(n) % 100;
  const o = t % 10;
  if (t > 10 && t < 20) return "дней";
  if (o > 1 && o < 5) return "дня";
  if (o === 1) return "день";
  return "дней";
}

/** Сколько дней прошло с даты срезки. */
function daysSince(date: string): number {
  const from = new Date(date);
  if (Number.isNaN(from.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - from.getTime()) / 86_400_000));
}

interface ItemWithBatches {
  itemId: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  shippedQuantity: number;
  availableBatches: Batch[];
}

export default function ShipmentForm({
  order,
  itemsWithBatches,
}: {
  order: OrderWithItems;
  itemsWithBatches: ItemWithBatches[];
}) {
  const router = useRouter();
  const remainingItems = itemsWithBatches.filter((i) => i.shippedQuantity < i.quantity);

  return (
    <div className="space-y-4">
      {remainingItems.length === 0 && (
        <div className="card text-ink-secondary">Всё отгружено.</div>
      )}
      {remainingItems.map((item) => (
        <ItemShipRow key={item.itemId} orderId={order.orderId} item={item} onDone={() => router.refresh()} />
      ))}
    </div>
  );
}

function ItemShipRow({
  orderId,
  item,
  onDone,
}: {
  orderId: string;
  item: ItemWithBatches;
  onDone: () => void;
}) {
  const remainingToShip = item.quantity - item.shippedQuantity;
  const batches = item.availableBatches;

  // Отмеченные партии и сколько из каждой. Раньше партия выбиралась одна, и
  // 310 стеблей из десяти партий отгружались десятью нажатиями — зав. складом
  // Rose Farm прислала это фотографией с экрана. Теперь отмечают сколько нужно
  // партий и отгружают одним нажатием.
  //
  // По умолчанию отмечена самая старая партия — как и раньше: чаще всего её и
  // отдают. Остальные человек отмечает сам или одной кнопкой «по порядку».
  const [picked, setPicked] = useState<Record<string, string>>(() => {
    const first = batches[0];
    if (!first) return {};
    return { [first.batchId]: String(Math.min(remainingToShip, first.quantityRemaining)) };
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Порядок частей — порядок партий на экране (сверху старые), а не порядок
  // нажатий: так журнал отгрузок читается по датам срезки.
  const parts = batches
    .filter((b) => picked[b.batchId] !== undefined)
    .map((b) => ({ batch: b, quantity: Number(picked[b.batchId]) || 0 }));
  const total = parts.reduce((s, p) => s + p.quantity, 0);
  const over = total > remainingToShip;

  function stillNeeded(except: string): number {
    const others = parts
      .filter((p) => p.batch.batchId !== except)
      .reduce((s, p) => s + p.quantity, 0);
    return Math.max(0, remainingToShip - others);
  }

  function toggle(b: Batch) {
    setError(null);
    setSuccess(null);
    setPicked((prev) => {
      const next = { ...prev };
      if (next[b.batchId] !== undefined) delete next[b.batchId];
      else next[b.batchId] = String(Math.min(b.quantityRemaining, stillNeeded(b.batchId)));
      return next;
    });
  }

  /** Отметить партии по порядку, от старой к свежей, пока не наберётся заказ. */
  function pickInOrder() {
    setError(null);
    setSuccess(null);
    const next: Record<string, string> = {};
    let need = remainingToShip;
    for (const b of batches) {
      if (need <= 0) break;
      const take = Math.min(need, b.quantityRemaining);
      next[b.batchId] = String(take);
      need -= take;
    }
    setPicked(next);
  }

  async function handleSubmit() {
    setError(null);
    setSuccess(null);
    if (parts.length === 0) return setError("Отметьте хотя бы одну партию");
    for (const p of parts) {
      if (!p.quantity || p.quantity <= 0) {
        return setError(`Укажите количество для партии от ${formatHarvest(p.batch.harvestDate)}`);
      }
      if (p.quantity > p.batch.quantityRemaining) {
        return setError(
          `В партии от ${formatHarvest(p.batch.harvestDate)} только ${p.batch.quantityRemaining} шт.`
        );
      }
    }
    if (over) return setError(`По заявке осталось отгрузить только ${remainingToShip} шт.`);

    setSubmitting(true);
    try {
      unwrap(
        await createShipmentAction({
          orderId,
          itemId: item.itemId,
          parts: parts.map((p) => ({ batchId: p.batch.batchId, quantity: p.quantity })),
        })
      );
      setSuccess(
        parts.length > 1
          ? `Отгружено ${total} шт. из ${parts.length} партий ✓`
          : `Отгружено ${total} шт. ✓`
      );
      setPicked({});
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось зарегистрировать отгрузку");
    } finally {
      setSubmitting(false);
    }
  }

  // Кнопка «по порядку» нужна, только когда одной партии заказу не хватает.
  const oneIsEnough = (batches[0]?.quantityRemaining ?? 0) >= remainingToShip;

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="font-medium min-w-0">
          {FLOWER_TYPE_LABELS[item.flowerType]} {item.variety} · {formatGrade(item.grade)}
        </div>
        <div className="text-sm text-ink-secondary shrink-0">
          Отгружено {item.shippedQuantity} из {item.quantity}
        </div>
      </div>

      {batches.length === 0 ? (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          Нет партий с остатком — сначала приёмка.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Партии выбирает человек, а не программа. Сверху — самая старая, её
              и надо отдавать первой, но заведующий складом видит холодильник и
              решает сам: свежую партию бывает нужно отгрузить вперёд старой
              (клиент берёт на дальнюю дорогу, старую обещали другому). Поэтому
              порядок — подсказка, а не запрет. */}
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-1.5">
              <span className="label !mb-0">
                Из каких партий
              </span>
              {!oneIsEnough && batches.length > 1 && (
                <button
                  type="button"
                  onClick={pickInOrder}
                  className="text-sm text-accent hover:underline"
                >
                  Отметить по порядку на {remainingToShip} шт.
                </button>
              )}
            </div>
            <div className="space-y-1.5">
              {batches.map((b, idx) => {
                const days = daysSince(b.harvestDate);
                const active = picked[b.batchId] !== undefined;
                return (
                  <label
                    key={b.batchId}
                    className={clsx(
                      "w-full rounded-lg border px-3 py-2 flex items-center gap-3 cursor-pointer transition-colors",
                      active
                        ? "border-accent bg-accent-soft"
                        : "border-line-hairline hover:bg-surface-plane"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => toggle(b)}
                      className="w-4 h-4 shrink-0 accent-accent"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block">
                        <span className="hidden sm:inline">Срезка </span>
                        {formatHarvest(b.harvestDate)}
                        {idx === 0 && batches.length > 1 && (
                          <span className="text-xs text-accent"> · самая старая</span>
                        )}
                      </span>
                      {/* Сколько лежит — вторым рядом: на телефоне в одну строку с
                          датой это не помещалось и рассыпалось по слову в строке.
                          Код партии нужен редко — только чтобы сверить с ярлыком
                          на ведре, — поэтому он мелкий и серый и не спорит глазами
                          с датой и остатком. */}
                      <span className="block text-xs text-ink-secondary truncate">
                        лежит {days} {dayWord(days)}
                        <span className="hidden sm:inline text-[11px] text-ink-muted font-mono"> · {b.batchId}</span>
                      </span>
                    </span>
                    {active && (
                      <input
                        type="number"
                        min={1}
                        max={b.quantityRemaining}
                        inputMode="numeric"
                        aria-label="Сколько из этой партии"
                        className="input !w-[4.5rem] sm:!w-20 !px-2 text-right shrink-0"
                        value={picked[b.batchId]}
                        onClick={(e) => e.preventDefault()}
                        onChange={(e) =>
                          setPicked((prev) => ({ ...prev, [b.batchId]: e.target.value }))
                        }
                      />
                    )}
                    <span className="text-right shrink-0 w-12 sm:w-14">
                      <span className="block font-semibold tabular-nums">
                        {b.quantityRemaining.toLocaleString("ru-RU")}
                      </span>
                      <span className="block text-[11px] text-ink-muted">в остатке</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleSubmit}
              disabled={submitting || parts.length === 0 || total <= 0 || over}
              className="btn-primary disabled:opacity-50"
            >
              {submitting
                ? "Отгрузка…"
                : parts.length > 1
                  ? `Отгрузить ${total} шт. из ${parts.length} партий`
                  : `Отгрузить ${total} шт.`}
            </button>
            <span className={clsx("text-sm", over ? "text-status-critical" : "text-ink-secondary")}>
              {over
                ? `Отмечено ${total}, а по заявке осталось ${remainingToShip}`
                : `Осталось по заявке ${remainingToShip} шт.`}
            </span>
          </div>
        </div>
      )}

      {error && <div className="text-sm text-status-critical mt-2">{error}</div>}
      {success && <div className="text-sm text-status-good mt-2">{success}</div>}
    </div>
  );
}

function formatHarvest(date: string): string {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString("ru-RU");
}
