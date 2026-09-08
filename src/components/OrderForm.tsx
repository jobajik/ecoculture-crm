"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createOrderAction } from "@/app/orders/actions";
import { FLOWER_TYPE_LABELS, GRADE_LABELS, formatGrade, getGradesFor } from "@/lib/constants";
import type { FlowerType } from "@/lib/constants";
import { priceFromMap } from "@/lib/priceList";

interface DraftItem {
  flowerType: FlowerType;
  variety: string;
  grade: string;
  quantity: string;
  unitPrice: string;
}

function emptyItem(
  varieties: Record<string, string[]>,
  prices: Record<string, number>
): DraftItem {
  const variety = varieties.rose?.[0] ?? "";
  const grade = getGradesFor("rose")[0] ?? "";
  const price = priceFromMap(prices, "rose", variety, grade);
  return {
    flowerType: "rose",
    variety,
    grade,
    quantity: "",
    unitPrice: price > 0 ? String(price) : "",
  };
}

export default function OrderForm({
  varieties,
  prices = {},
}: {
  varieties: Record<string, string[]>;
  /** Действующий прайс: «цветок|сорт|градация» → цена. */
  prices?: Record<string, number>;
}) {
  const router = useRouter();
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([emptyItem(varieties, prices)]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateItem(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  /**
   * Меняется позиция — подставляем цену из прайса. Но только если менеджер ещё
   * не поставил свою: затирать введённую руками цену нельзя, иначе человек
   * поправит её, переключит длину и молча потеряет правку.
   */
  function updatePosition(idx: number, patch: Partial<DraftItem>) {
    setItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...it, ...patch };
        const wasSuggested =
          !it.unitPrice ||
          Number(it.unitPrice) === priceFromMap(prices, it.flowerType, it.variety, it.grade);
        if (wasSuggested) {
          const price = priceFromMap(prices, next.flowerType, next.variety, next.grade);
          next.unitPrice = price > 0 ? String(price) : "";
        }
        return next;
      })
    );
  }

  /** При смене типа цветка списки сортов и градаций другие — подставляем первые доступные. */
  function changeFlowerType(idx: number, flowerType: DraftItem["flowerType"]) {
    updatePosition(idx, {
      flowerType,
      grade: getGradesFor(flowerType)[0] ?? "",
      variety: varieties[flowerType]?.[0] ?? "",
    });
  }

  function addItem() {
    setItems((prev) => [...prev, emptyItem(varieties, prices)]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  const total = items.reduce((sum, it) => {
    const q = Number(it.quantity) || 0;
    const p = Number(it.unitPrice) || 0;
    return sum + q * p;
  }, 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!clientName.trim()) return setError("Укажите имя клиента");
    if (items.length === 0) return setError("Добавьте хотя бы одну позицию");
    for (const it of items) {
      if (!it.variety.trim()) return setError("У каждой позиции должен быть выбран сорт");
      if (!it.grade) return setError("Выберите длину (для роз) или категорию (для хризантем)");
      if (!it.quantity || Number(it.quantity) <= 0) return setError("Укажите количество для каждой позиции");
      if (!it.unitPrice || Number(it.unitPrice) < 0) return setError("Укажите цену для каждой позиции");
    }

    setSubmitting(true);
    try {
      const orderId = await createOrderAction({
        clientName: clientName.trim(),
        clientPhone: clientPhone.trim(),
        deliveryDate,
        notes,
        items: items.map((it) => ({
          flowerType: it.flowerType,
          variety: it.variety.trim(),
          grade: it.grade,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
        })),
      });
      router.push(`/orders/${orderId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать заявку");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
      <div className="card grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label">Клиент *</label>
          <input className="input" value={clientName} onChange={(e) => setClientName(e.target.value)} required />
        </div>
        <div>
          <label className="label">Телефон клиента</label>
          <input className="input" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />
        </div>
        <div>
          <label className="label">Дата доставки</label>
          <input
            type="date"
            className="input"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Комментарий</label>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Позиции заявки</h2>
          <button type="button" onClick={addItem} className="btn-secondary !py-1">
            + Добавить позицию
          </button>
        </div>

        <div className="space-y-3">
          {items.map((it, idx) => (
            <div key={idx} className="grid grid-cols-2 sm:grid-cols-9 gap-2 items-end border-b border-line-hairline pb-3 last:border-0">
              <div className="col-span-2 sm:col-span-2">
                <label className="label">Тип</label>
                <select
                  className="input"
                  value={it.flowerType}
                  onChange={(e) => changeFlowerType(idx, e.target.value as DraftItem["flowerType"])}
                >
                  {Object.entries(FLOWER_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-2">
                <label className="label">Сорт *</label>
                <select
                  className="input"
                  value={it.variety}
                  onChange={(e) => updatePosition(idx, { variety: e.target.value })}
                >
                  {(varieties[it.flowerType] ?? []).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-2">
                <label className="label">{GRADE_LABELS[it.flowerType]} *</label>
                <select
                  className="input"
                  value={it.grade}
                  onChange={(e) => updatePosition(idx, { grade: e.target.value })}
                >
                  {getGradesFor(it.flowerType).map((grade) => (
                    <option key={grade} value={grade}>
                      {formatGrade(grade)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Кол-во, шт *</label>
                <input
                  type="number"
                  min={1}
                  className="input"
                  value={it.quantity}
                  onChange={(e) => updateItem(idx, { quantity: e.target.value })}
                />
              </div>
              <div className="flex gap-2 col-span-2 sm:col-span-2">
                <div className="flex-1">
                  <label className="label">
                    Цена, ₸ *
                    {priceFromMap(prices, it.flowerType, it.variety, it.grade) > 0 && (
                      <span className="font-normal text-ink-muted">
                        {" "}
                        · прайс{" "}
                        {priceFromMap(prices, it.flowerType, it.variety, it.grade).toLocaleString(
                          "ru-RU"
                        )}
                      </span>
                    )}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input"
                    value={it.unitPrice}
                    onChange={(e) => updateItem(idx, { unitPrice: e.target.value })}
                  />
                </div>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeItem(idx)}
                    className="text-status-critical text-sm px-2 self-end pb-2"
                    aria-label="Удалить позицию"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="text-right mt-4 font-medium">
          Итого: {total.toLocaleString("ru-RU")} ₸
        </div>
      </div>

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>
      )}

      <button type="submit" disabled={submitting} className="btn-primary">
        {submitting ? "Сохранение…" : "Создать заявку"}
      </button>
    </form>
  );
}
