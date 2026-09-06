"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createWriteoffAction } from "@/app/warehouse/actions";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import type { BatchStorageInfo } from "@/lib/shelfLife";
import StorageStatusBadge from "./StorageStatusBadge";

export default function BatchesList({ infos }: { infos: BatchStorageInfo[] }) {
  const router = useRouter();
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  const [onlyActive, setOnlyActive] = useState(true);

  const visible = useMemo(
    () => infos.filter((i) => (onlyActive ? i.batch.quantityRemaining > 0 : true)),
    [infos, onlyActive]
  );

  return (
    <div>
      <label className="flex items-center gap-2 text-sm text-ink-secondary mb-3">
        <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
        Показывать только партии с остатком
      </label>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Партия</th>
              <th className="px-4 py-3 font-medium">Тип / сорт</th>
              <th className="px-4 py-3 font-medium">Сбор</th>
              <th className="px-4 py-3 font-medium">В хранении</th>
              <th className="px-4 py-3 font-medium">Остаток</th>
              <th className="px-4 py-3 font-medium">Статус</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((info) => (
              <BatchRow
                key={info.batch.batchId}
                info={info}
                isOpen={openBatchId === info.batch.batchId}
                onToggle={() =>
                  setOpenBatchId((cur) => (cur === info.batch.batchId ? null : info.batch.batchId))
                }
                onDone={() => {
                  setOpenBatchId(null);
                  router.refresh();
                }}
              />
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-muted">
                  Партий не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BatchRow({
  info,
  isOpen,
  onToggle,
  onDone,
}: {
  info: BatchStorageInfo;
  isOpen: boolean;
  onToggle: () => void;
  onDone: () => void;
}) {
  const { batch } = info;
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("Порча / истёк срок хранения");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleWriteoff() {
    setError(null);
    const qty = Number(quantity);
    if (!qty || qty <= 0) return setError("Укажите количество");
    if (qty > batch.quantityRemaining) return setError("Больше, чем есть в остатке");

    setSubmitting(true);
    try {
      await createWriteoffAction({ batchId: batch.batchId, quantity: qty, reason });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось списать");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <tr className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
        <td className="px-4 py-3 font-medium">{batch.batchId}</td>
        <td className="px-4 py-3">
          {FLOWER_TYPE_LABELS[batch.flowerType]} {batch.variety}
          <div className="text-xs text-ink-muted">{formatGrade(batch.grade)}</div>
        </td>
        <td className="px-4 py-3 text-ink-secondary">
          {batch.harvestDate ? new Date(batch.harvestDate).toLocaleDateString("ru-RU") : "—"}
        </td>
        <td className="px-4 py-3 text-ink-secondary">
          {info.daysInStorage} из {info.maxDays} дн.
        </td>
        <td className="px-4 py-3">
          {batch.quantityRemaining} / {batch.quantityIn}
        </td>
        <td className="px-4 py-3">
          <StorageStatusBadge status={info.status} />
        </td>
        <td className="px-4 py-3 text-right">
          {batch.quantityRemaining > 0 && (
            <button onClick={onToggle} className="btn-secondary !py-1">
              {isOpen ? "Отмена" : "Списать"}
            </button>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-surface-plane">
          <td colSpan={7} className="px-4 py-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="label">Количество к списанию</label>
                <input
                  type="number"
                  min={1}
                  max={batch.quantityRemaining}
                  className="input !w-32"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="label">Причина</label>
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <button onClick={handleWriteoff} disabled={submitting} className="btn-primary">
                {submitting ? "Списание…" : "Подтвердить списание"}
              </button>
            </div>
            {error && <div className="text-sm text-status-critical mt-2">{error}</div>}
          </td>
        </tr>
      )}
    </>
  );
}
