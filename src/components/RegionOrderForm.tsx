"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createRegionOrderAction } from "@/app/orders/actions";
import {
  FLOWER_TYPES,
  FLOWER_TYPE_LABELS,
  formatGrade,
  getGradesFor,
  type FlowerType,
} from "@/lib/constants";

interface DraftRow {
  flowerType: FlowerType;
  variety: string;
  grade: string;
  quantity: string;
}

function emptyRow(varieties: Record<string, string[]>): DraftRow {
  return {
    flowerType: FLOWER_TYPES.ROSE,
    variety: varieties.rose?.[0] ?? "",
    grade: getGradesFor(FLOWER_TYPES.ROSE)[0] ?? "",
    quantity: "",
  };
}

/**
 * Оптовый объём на город — заявка без клиента.
 *
 * Владелец описал её так: «просто типа выставляешь количество, сорт и выбираешь
 * регион, без клиентов и прочее». Поэтому здесь ровно три вещи: город, день
 * отгрузки и строки «сорт — длина — количество».
 *
 * Чего в форме НЕТ и не будет:
 *
 * - **клиента.** Это не продажа конкретной точке, а объём в город;
 * - **цены.** «Только количество» — сумму по поступлениям вписывает потом
 *   бухгалтер, и она не равна «цена × количество», потому что цены не было;
 * - **телефона и комментария.** Возить некому и звонить некому.
 *
 * Первую версию я сделал поверх клиентской формы, добавив к ней поле
 * «направление», — и это было неправильно. Отдельная форма нужна именно
 * потому, что форма с половиной скрытых полей обрастает условиями и ломается
 * то у одних, то у других.
 */
export default function RegionOrderForm({
  directions,
  varieties,
  initialDirection = "",
  initialDate = "",
}: {
  /** Закрытый список направлений — тот же, что в плане отгрузок. */
  directions: string[];
  varieties: Record<string, string[]>;
  initialDirection?: string;
  initialDate?: string;
}) {
  const router = useRouter();

  const [direction, setDirection] = useState(initialDirection);
  const [deliveryDate, setDeliveryDate] = useState(initialDate);
  const [rows, setRows] = useState<DraftRow[]>([emptyRow(varieties)]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalStems = rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0);

  function update(idx: number, patch: Partial<DraftRow>) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, ...patch };
        // Сменили цветок — сорт и градация от прежнего больше не подходят.
        if (patch.flowerType && patch.flowerType !== r.flowerType) {
          next.variety = varieties[patch.flowerType]?.[0] ?? "";
          next.grade = getGradesFor(patch.flowerType)[0] ?? "";
        }
        return next;
      })
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!direction) return setError("Выберите регион");
    if (!deliveryDate) return setError("Укажите дату отгрузки");
    const items = rows
      .filter((r) => Number(r.quantity) > 0)
      .map((r) => ({
        flowerType: r.flowerType,
        variety: r.variety.trim(),
        grade: r.grade,
        quantity: Number(r.quantity),
      }));
    if (items.length === 0) return setError("Укажите количество хотя бы по одной позиции");

    setSubmitting(true);
    try {
      const orderId = await createRegionOrderAction({ direction, deliveryDate, items });
      router.push(`/orders/${orderId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать заявку");
      setSubmitting(false);
    }
  }

  // --- Шаг 1: регион -------------------------------------------------------
  if (!direction) {
    return (
      <div className="max-w-3xl">
        <h2 className="font-medium mb-1">В какой регион?</h2>
        <p className="text-sm text-ink-secondary mb-3">
          Выберите город — дальше проставите количество.
        </p>
        <div className="grid sm:grid-cols-3 gap-3">
          {directions.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className="card text-left hover:border-accent transition-colors font-medium"
            >
              {d}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // --- Шаг 2: количество ---------------------------------------------------
  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-6">
      <div className="card flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">Регион</div>
          <div className="font-medium text-lg">{direction}</div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="label">Дата отгрузки</span>
            <input
              type="date"
              className="input !w-auto"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => setDirection("")}
            className="btn-secondary !py-1.5 text-sm"
          >
            Другой регион
          </button>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Сколько отгружаем</h2>
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, emptyRow(varieties)])}
            className="btn-secondary !py-1.5 text-sm"
          >
            + Добавить позицию
          </button>
        </div>

        <div className="space-y-3">
          {rows.map((row, idx) => (
            <div key={idx} className="grid sm:grid-cols-[1fr_1.4fr_1fr_0.8fr_auto] gap-2 items-end">
              <label className="text-sm">
                <span className="label">Цветок</span>
                <select
                  className="input"
                  value={row.flowerType}
                  onChange={(e) => update(idx, { flowerType: e.target.value as FlowerType })}
                >
                  {Object.values(FLOWER_TYPES).map((t) => (
                    <option key={t} value={t}>
                      {FLOWER_TYPE_LABELS[t] ?? t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="label">Сорт</span>
                <select
                  className="input"
                  value={row.variety}
                  onChange={(e) => update(idx, { variety: e.target.value })}
                >
                  {(varieties[row.flowerType] ?? []).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="label">Длина / категория</span>
                <select
                  className="input"
                  value={row.grade}
                  onChange={(e) => update(idx, { grade: e.target.value })}
                >
                  {getGradesFor(row.flowerType).map((g) => (
                    <option key={g} value={g}>
                      {formatGrade(g)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="label">Кол-во, шт</span>
                <input
                  className="input"
                  inputMode="numeric"
                  value={row.quantity}
                  onChange={(e) =>
                    update(idx, { quantity: e.target.value.replace(/[^\d]/g, "") })
                  }
                  placeholder="0"
                />
              </label>
              <button
                type="button"
                onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                disabled={rows.length === 1}
                className="btn-secondary !py-2 text-sm disabled:opacity-30"
                aria-label="Убрать позицию"
                title="Убрать позицию"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div className="text-right mt-4 font-medium">
          Всего: {totalStems.toLocaleString("ru-RU")} шт.
        </div>
      </div>

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div>
        <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-50">
          {submitting ? "Отправляю…" : "Отправить заявку"}
        </button>
        <p className="text-xs text-ink-muted mt-2">
          Цены здесь нет намеренно: это объём на город, а не продажа клиенту. Сумму поступлений
          вписывает бухгалтер позже, прямо на заявке.
        </p>
      </div>
    </form>
  );
}
