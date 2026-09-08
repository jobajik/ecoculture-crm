"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createShipmentAction } from "@/app/warehouse/actions";
import clsx from "clsx";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import type { Batch, OrderWithItems } from "@/lib/types";

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
        <div className="card text-ink-secondary">Все позиции по этой заявке уже отгружены.</div>
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
  const [batchId, setBatchId] = useState(item.availableBatches[0]?.batchId ?? "");
  const [quantity, setQuantity] = useState(String(Math.min(remainingToShip, item.availableBatches[0]?.quantityRemaining ?? 0)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const selectedBatch = item.availableBatches.find((b) => b.batchId === batchId);

  async function handleSubmit() {
    setError(null);
    if (!batchId) return setError("Выберите партию");
    const qty = Number(quantity);
    if (!qty || qty <= 0) return setError("Укажите количество");
    if (selectedBatch && qty > selectedBatch.quantityRemaining) {
      return setError(`В партии доступно только ${selectedBatch.quantityRemaining} шт.`);
    }
    if (qty > remainingToShip) return setError(`По заявке осталось отгрузить только ${remainingToShip} шт.`);

    setSubmitting(true);
    try {
      await createShipmentAction({ orderId, itemId: item.itemId, batchId, quantity: qty });
      setSuccess(true);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось зарегистрировать отгрузку");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="font-medium">
          {FLOWER_TYPE_LABELS[item.flowerType]} {item.variety} · {formatGrade(item.grade)}
        </div>
        <div className="text-sm text-ink-secondary">
          Отгружено {item.shippedQuantity} из {item.quantity}
        </div>
      </div>

      {item.availableBatches.length === 0 ? (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          На складе нет партий этого сорта с остатком. Сначала оформите приёмку с производства.
        </div>
      ) : (
        <div className="space-y-3">
          {/* Партию выбирает человек, а не программа. Сверху предлагается самая
              старая — её и надо отдавать первой, — но заведующий складом видит
              холодильник и решает сам: свежую партию бывает нужно отгрузить
              вперёд старой (клиент берёт на дальнюю дорогу, старую обещали
              другому). Поэтому это подсказка, а не запрет. */}
          <div>
            <label className="label">
              Из какой партии отгружаем
              <span className="font-normal text-ink-muted"> — сверху та, что дольше лежит</span>
            </label>
            <div className="space-y-1.5">
              {item.availableBatches.map((b, idx) => {
                const days = daysSince(b.harvestDate);
                const active = b.batchId === batchId;
                return (
                  <button
                    key={b.batchId}
                    type="button"
                    onClick={() => {
                      setBatchId(b.batchId);
                      setQuantity(String(Math.min(remainingToShip, b.quantityRemaining)));
                    }}
                    className={clsx(
                      "w-full text-left rounded-lg border px-3 py-2 flex items-center gap-3 transition-colors",
                      active
                        ? "border-accent bg-accent-soft"
                        : "border-line-hairline hover:bg-surface-plane"
                    )}
                  >
                    <span
                      className={clsx(
                        "w-4 h-4 rounded-full border-2 shrink-0",
                        active ? "border-accent bg-accent" : "border-line-strong"
                      )}
                      aria-hidden
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block">
                        Срезка {new Date(b.harvestDate).toLocaleDateString("ru-RU")}
                        <span className="text-ink-secondary">
                          {" "}
                          · лежит {days} {dayWord(days)}
                        </span>
                        {idx === 0 && item.availableBatches.length > 1 && (
                          <span className="text-xs text-accent"> · самая старая</span>
                        )}
                      </span>
                      {/* Код партии нужен редко — только чтобы сверить с ярлыком
                          на ведре. Держим его мелким и серым, чтобы он не спорил
                          глазами с датой и остатком. */}
                      <span className="block text-[11px] text-ink-muted font-mono">
                        {b.batchId}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block font-semibold tabular-nums">
                        {b.quantityRemaining.toLocaleString("ru-RU")}
                      </span>
                      <span className="block text-[11px] text-ink-muted">в остатке</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Количество, шт</label>
            <input
              type="number"
              min={1}
              max={Math.min(remainingToShip, selectedBatch?.quantityRemaining ?? remainingToShip)}
              className="input !w-32"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </div>
          <button onClick={handleSubmit} disabled={submitting} className="btn-primary">
            {submitting ? "Отгрузка…" : "Отгрузить"}
          </button>
          </div>
        </div>
      )}

      {error && <div className="text-sm text-status-critical mt-2">{error}</div>}
      {success && <div className="text-sm text-status-good mt-2">Отгружено ✓</div>}
    </div>
  );
}
