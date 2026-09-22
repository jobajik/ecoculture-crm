"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FLOWER_TYPE_LABELS, formatGrade, gradeColumnLabelFor, getGradesFor } from "@/lib/constants";
import { unwrapValue } from "@/lib/actionResult";
import Hint from "./Hint";
import {
  describeWarehouseChanges,
  moneyWarning,
  warehouseEditedRefusal,
  type WarehouseCurrentItem,
  type WarehouseEditedItem,
} from "@/lib/warehouseOrderEdit";

/**
 * «Поправить по факту склада» — форма зав. складом на странице заявки.
 *
 * Показывает ТОЛЬКО её позиции и ровно три поля на строку: ростовку,
 * количество и цену. Сорт и тип цветка стоят рядом просто текстом — это не
 * забытые поля, а сознательная граница: другой сорт — это другая
 * договорённость с клиентом, о которой склад не знает.
 *
 * Новая сумма и последствия для денег считаются прямо при вводе, до сохранения:
 * правка меняет долг клиента и бонус менеджера, и увидеть это человек должен
 * раньше, чем нажмёт кнопку.
 */
export default function WarehouseItemsEdit({
  orderId,
  items,
  otherItemsTotal,
  paidAmount,
  totalBefore,
  region,
  farm,
  save,
}: {
  orderId: string;
  /** Позиции ЭТОГО производства — их и правим. */
  items: WarehouseCurrentItem[];
  /**
   * Сумма чужих позиций. Нужна ТОЛЬКО чтобы понять, что стало с оплатой всей
   * заявки; на экран она не выводится — зав. складом не должна видеть деньги
   * чужого производства (грабли 1.1-ter).
   */
  otherItemsTotal: number;
  paidAmount: number;
  totalBefore: number;
  region: boolean;
  farm: string;
  save: (
    orderId: string,
    input: { items: WarehouseEditedItem[]; reason: string }
  ) => Promise<unknown>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WarehouseEditedItem[]>(() =>
    items.map((i) => ({
      itemId: i.itemId,
      grade: i.grade,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
    }))
  );
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const changes = useMemo(
    () => describeWarehouseChanges({ current: items, next: draft, region }),
    [items, draft, region]
  );

  // Своя часть — её и показываем. Итог всей заявки нужен только для проверки
  // оплаты и на экран не идёт.
  const mineBefore = useMemo(
    () => items.reduce((s, i) => s + i.quantity * (region ? 0 : i.unitPrice), 0),
    [items, region]
  );
  const mineAfter = useMemo(
    () =>
      draft.reduce(
        (s, i) => s + (Number(i.quantity) || 0) * (region ? 0 : Number(i.unitPrice) || 0),
        0
      ),
    [draft, region]
  );
  const totalAfter = mineAfter + otherItemsTotal;

  const warning = region ? "" : moneyWarning(paidAmount, totalBefore, totalAfter);

  function patch(itemId: string, next: Partial<WarehouseEditedItem>) {
    setDraft((prev) => prev.map((i) => (i.itemId === itemId ? { ...i, ...next } : i)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setDone("");

    // Та же функция, что и на сервере: ради быстрого ответа, а не вместо него.
    const refusal = warehouseEditedRefusal({ current: items, next: draft, farm, reason, region });
    if (refusal) {
      setError(refusal);
      return;
    }

    setBusy(true);
    try {
      const result = unwrapValue(await save(orderId, { items: draft, reason })) as {
        changes: string[];
        warning: string;
      };
      setDone(
        `Сохранено: ${result.changes.join("; ")}.${
          result.warning ? ` ${result.warning}` : ""
        }`
      );
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mb-6">
        {done && (
          <p className="text-sm bg-status-good/10 text-status-good rounded-lg px-3 py-2 mb-2">
            {done}
          </p>
        )}
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Поправить по факту склада
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="card mb-6 space-y-3">
      <div className="font-medium">
        Поправить по факту склада
        <Hint>
          Только ваши позиции: количество, ростовка, цена. Сорт и цветок не меняются, строки не
          добавляются и не удаляются.
        </Hint>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const edit = draft.find((d) => d.itemId === item.itemId);
          if (!edit) return null;
          const grades = getGradesFor(item.flowerType);
          // Старая ростовка не из нынешнего списка не должна пропасть из
          // выбора: иначе правка количества молча меняла бы и её.
          const options = grades.includes(item.grade) ? grades : [item.grade, ...grades];
          return (
            <div key={item.itemId} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
              <div className="col-span-2">
                <div className="label">Позиция</div>
                <div className="text-sm font-medium">{item.variety}</div>
                <div className="text-xs text-ink-muted">
                  {FLOWER_TYPE_LABELS[item.flowerType] ?? item.flowerType}
                  {item.shippedQuantity > 0 && ` · отгружено ${item.shippedQuantity} шт`}
                </div>
              </div>
              <div>
                <label className="label">{gradeColumnLabelFor([item.flowerType])}</label>
                <select
                  className="input"
                  value={edit.grade}
                  onChange={(e) => patch(item.itemId, { grade: e.target.value })}
                >
                  {options.map((g) => (
                    <option key={g} value={g}>
                      {formatGrade(g)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Кол-во, шт</label>
                <input
                  type="number"
                  className="input"
                  value={edit.quantity}
                  onChange={(e) => patch(item.itemId, { quantity: Number(e.target.value) })}
                />
              </div>
              {!region && (
                <div>
                  <label className="label">Цена, ₸</label>
                  <input
                    type="number"
                    className="input"
                    value={edit.unitPrice}
                    onChange={(e) => patch(item.itemId, { unitPrice: Number(e.target.value) })}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <label className="label">Почему правим *</label>
        <input
          className="input"
          value={reason}
          placeholder="В холодильнике только 640 шт. 60 см"
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      {changes.length > 0 && !region && (
        <p className="text-sm text-ink-secondary">
          По вашим позициям: {Math.round(mineBefore).toLocaleString("ru-RU")} →{" "}
          <b>{Math.round(mineAfter).toLocaleString("ru-RU")} ₸</b>
        </p>
      )}

      {warning && (
        <p className="text-sm bg-[#8a5a00]/10 text-[#8a5a00] rounded-lg px-3 py-2">{warning}</p>
      )}

      {error && (
        <p className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary disabled:opacity-50" disabled={busy}>
          {busy ? "Сохраняю…" : "Сохранить"}
        </button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
    </form>
  );
}
