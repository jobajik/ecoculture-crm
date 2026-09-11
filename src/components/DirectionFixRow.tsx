"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SHIPMENT_DIRECTIONS } from "@/lib/constants";
import { setOrderDirectionAction } from "@/app/orders/actions";

/**
 * Одна строка «похоже на регион, но направление не стоит».
 *
 * Главное здесь — предложенное направление уже выбрано, и нажатие ровно одно.
 * Если бы РОПу пришлось на каждую такую заявку открывать её страницу и искать
 * поле, он бы этого не делал, а отчёт по регионам тихо недосчитывался бы —
 * то есть весь раздел работал бы неправильно ровно в тех случаях, ради которых
 * он и нужен.
 *
 * Выпадающий список рядом оставлен намеренно: подстановка идёт по городу
 * клиента и иногда промахивается — везут не всегда туда, где офис.
 */
export default function DirectionFixRow({
  orderId,
  clientName,
  deliveryDate,
  suggested,
}: {
  orderId: string;
  clientName: string;
  deliveryDate: string;
  suggested: string;
}) {
  const router = useRouter();
  const [direction, setDirection] = useState(suggested);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      await setOrderDirectionAction(orderId, direction);
      setDone(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось поставить направление");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="text-sm text-status-good">
        {clientName} — направление «{direction}» проставлено.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-ink-secondary whitespace-nowrap">{deliveryDate}</span>
      <Link href={`/orders/${orderId}`} className="font-medium hover:underline">
        {clientName}
      </Link>
      <select
        className="input !w-auto !py-1.5 text-sm"
        value={direction}
        onChange={(e) => setDirection(e.target.value)}
      >
        {SHIPMENT_DIRECTIONS.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="btn-secondary !py-1.5 text-sm disabled:opacity-50"
      >
        {saving ? "Ставлю…" : "Поставить"}
      </button>
      {error && <span className="text-status-critical">{error}</span>}
    </div>
  );
}
