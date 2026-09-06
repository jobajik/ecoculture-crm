"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createShipmentAction } from "@/app/warehouse/actions";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import type { Batch, OrderWithItems } from "@/lib/types";

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
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px]">
            <label className="label">Партия (сначала предлагаются самые старые — по сроку хранения)</label>
            <select className="input" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              {item.availableBatches.map((b) => (
                <option key={b.batchId} value={b.batchId}>
                  {b.batchId} · сбор {new Date(b.harvestDate).toLocaleDateString("ru-RU")} · остаток {b.quantityRemaining}
                </option>
              ))}
            </select>
          </div>
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
      )}

      {error && <div className="text-sm text-status-critical mt-2">{error}</div>}
      {success && <div className="text-sm text-status-good mt-2">Отгружено ✓</div>}
    </div>
  );
}
