"use client";

import clsx from "clsx";
import {
  FLOWER_TYPE_LABELS,
  GRADE_LABELS,
  formatGrade,
  getGradesFor,
  type FlowerType,
} from "@/lib/constants";
import { priceFromMap } from "@/lib/priceList";

/**
 * Позиции заявки — один компонент на обе формы: клиентскую и магазинную.
 *
 * Раньше у розницы была своя таблица всего ассортимента с полем количества в
 * каждой строке. На бумаге это выглядело удобнее, а на деле, пока склад и
 * внутренний прайс не заполнены, разворачивалось в двести строк «Мини-микс
 * кустовые» с прочерками — владелец увидел это первым. Позиции добавляются так
 * же, как у оптовых менеджеров: выбрал цветок, сорт, длину, вписал количество.
 *
 * Держать две копии этого блока нельзя: правку в одном месте забудут в другом,
 * и формы разойдутся — это ровно те же грабли, что с проверкой готовности
 * заявки, разъехавшейся по четырём местам.
 */

export interface DraftItem {
  flowerType: FlowerType;
  variety: string;
  grade: string;
  quantity: string;
  unitPrice: string;
}

/** Пустая позиция с подставленной ценой из прайса. */
export function emptyItem(
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

/** Ключ остатка склада — тот же, что у прайса. */
export function stockKey(flowerType: string, variety: string, grade: string): string {
  return `${flowerType}|${variety}|${grade}`;
}

export default function OrderItemsEditor({
  varieties,
  prices,
  items,
  onChange,
  stock,
}: {
  varieties: Record<string, string[]>;
  /** Действующий прайс: «цветок|сорт|градация» → цена. */
  prices: Record<string, number>;
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
  /**
   * Остаток склада той же формы ключа. Показывается подписью под позицией —
   * это подсказка, а не запрет: склад ещё принимает срезку, и заявку на завтра
   * нормально ставить с запасом.
   */
  stock?: Record<string, number>;
}) {
  function updateItem(idx: number, patch: Partial<DraftItem>) {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  /**
   * Меняется позиция — подставляем цену из прайса. Но только если человек ещё
   * не поставил свою: затирать введённую руками цену нельзя, иначе он поправит
   * её, переключит длину и молча потеряет правку.
   */
  function updatePosition(idx: number, patch: Partial<DraftItem>) {
    onChange(
      items.map((it, i) => {
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
  function changeFlowerType(idx: number, flowerType: FlowerType) {
    updatePosition(idx, {
      flowerType,
      grade: getGradesFor(flowerType)[0] ?? "",
      variety: varieties[flowerType]?.[0] ?? "",
    });
  }

  const total = items.reduce(
    (sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
    0
  );

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-medium">Позиции заявки</h2>
        <button
          type="button"
          onClick={() => onChange([...items, emptyItem(varieties, prices)])}
          className="btn-secondary !py-1"
        >
          + Добавить позицию
        </button>
      </div>

      <div className="space-y-3">
        {items.map((it, idx) => {
          const onHand = stock?.[stockKey(it.flowerType, it.variety, it.grade)] ?? 0;
          const wanted = Number(it.quantity) || 0;
          return (
            <div
              key={idx}
              className="grid grid-cols-2 sm:grid-cols-9 gap-2 items-end border-b border-line-hairline pb-3 last:border-0"
            >
              <div className="col-span-2 sm:col-span-2">
                <label className="label">Тип</label>
                <select
                  className="input"
                  value={it.flowerType}
                  onChange={(e) => changeFlowerType(idx, e.target.value as FlowerType)}
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
                {/* Остаток склада — подсказка В ПОДПИСИ, а не строкой под
                    полем: строка под полем ломает выравнивание ряда, и «Кол-во»
                    уезжает выше соседних подписей. Нужен он ровно в тот момент,
                    когда вводят число, — поэтому стоит здесь, а не отдельной
                    таблицей ассортимента (её владелец забраковал: пока склад и
                    внутренний прайс пусты, она разворачивалась в двести строк
                    с прочерками). */}
                <label className="label">
                  Кол-во, шт *
                  {stock && (
                    <span
                      className={clsx(
                        "font-normal",
                        wanted > onHand && onHand > 0 ? "text-[#8a5a00]" : "text-ink-muted"
                      )}
                    >
                      {" "}
                      ·{" "}
                      {onHand > 0
                        ? `на складе ${onHand.toLocaleString("ru-RU")}`
                        : "на складе нет"}
                    </span>
                  )}
                </label>
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
                    onClick={() => onChange(items.filter((_, i) => i !== idx))}
                    className="text-status-critical text-sm px-2 self-end pb-2"
                    aria-label="Удалить позицию"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="text-right mt-4 font-medium">Итого: {total.toLocaleString("ru-RU")} ₸</div>
    </div>
  );
}
