"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { createOrderAction } from "@/app/orders/actions";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import type { FlowerType } from "@/lib/constants";
import type { AssortmentGroup } from "@/lib/retail";

export interface RetailShopOption {
  clientId: string;
  name: string;
  /** Адрес доставки — по нему точку и узнают. */
  address: string;
  city: string;
  /** Дней с последней доставки; -1 — ещё не возили. */
  daysSinceLast: number;
  orders: number;
}

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

/**
 * Заявка в наш магазин — два шага и ничего лишнего.
 *
 * Обычная форма заявки спрашивает клиента, телефон для этой доставки,
 * комментарий и цену каждой позиции. Для розницы всё это лишнее и вредное:
 * контрагент — один из шести наших магазинов, телефон точки записан в её
 * карточке, а цену задаёт внутренний прайс, и менеджеру её править незачем —
 * это не переговоры с клиентом, а перемещение внутри компании.
 *
 * Поэтому здесь ровно два шага: выбрать магазин и проставить количество
 * напротив позиций ассортимента. Ассортимент — то, что реально можно дать: что
 * лежит на складе и что заведено во внутреннем прайсе (`buildAssortment`).
 *
 * Количество вводится ПРЯМО В СПИСКЕ, а не через «добавить позицию»: у точки
 * их две-пять, и каждая — это выбор сорта, длины и числа тремя отдельными
 * действиями. Здесь всё видно сразу, и заявка набирается за один проход.
 */
export default function RetailOrderForm({
  shops,
  assortment,
  initialShopId = "",
  initialDeliveryDate = "",
}: {
  shops: RetailShopOption[];
  assortment: AssortmentGroup[];
  initialShopId?: string;
  initialDeliveryDate?: string;
}) {
  const router = useRouter();

  const [shopId, setShopId] = useState(initialShopId);
  const [deliveryDate, setDeliveryDate] = useState(initialDeliveryDate);
  const [flowerType, setFlowerType] = useState(assortment[0]?.flowerType ?? "rose");
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  /** Ключ позиции → количество строкой (пустая = не берём). */
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shop = shops.find((s) => s.clientId === shopId) ?? null;
  const group = assortment.find((g) => g.flowerType === flowerType) ?? assortment[0];

  /** Что набрано — по всем цветкам сразу, а не только по открытой вкладке. */
  const chosen = useMemo(() => {
    const rows = assortment.flatMap((g) => g.rows);
    return rows
      .map((row) => ({ row, quantity: Math.round(Number(amounts[row.key]) || 0) }))
      .filter((x) => x.quantity > 0);
  }, [assortment, amounts]);

  const totalStems = chosen.reduce((s, x) => s + x.quantity, 0);
  const totalAmount = chosen.reduce((s, x) => s + x.quantity * x.row.price, 0);

  const visible = useMemo(() => {
    const rows = group?.rows ?? [];
    const q = search.trim().toLowerCase();
    if (q) {
      return rows.filter((r) =>
        `${r.variety} ${formatGrade(r.grade)}`.toLowerCase().includes(q)
      );
    }
    // Без поиска показываем то, что есть на складе, плюс уже набранное.
    // Остальной ассортимент — по кнопке: иначе на розе это две сотни строк.
    if (showAll) return rows;
    const picked = new Set(chosen.map((x) => x.row.key));
    const inStock = rows.filter((r) => r.stock > 0 || picked.has(r.key));
    return inStock.length > 0 ? inStock : rows.slice(0, 20);
  }, [group, search, showAll, chosen]);

  const hiddenCount = (group?.rows.length ?? 0) - visible.length;

  function shopHint(s: RetailShopOption): string {
    if (s.orders === 0) return "ещё не возили";
    if (s.daysSinceLast <= 0) return "заявка уже есть";
    if (s.daysSinceLast === 1) return "возили вчера";
    return `возили ${s.daysSinceLast} дн. назад`;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!shop) return setError("Выберите магазин");
    if (!deliveryDate) return setError("Укажите дату доставки");
    if (chosen.length === 0) return setError("Проставьте количество хотя бы у одной позиции");

    setSubmitting(true);
    try {
      const orderId = await createOrderAction({
        clientId: shop.clientId,
        clientName: shop.name,
        clientPhone: "",
        deliveryDate,
        items: chosen.map((x) => ({
          flowerType: x.row.flowerType as FlowerType,
          variety: x.row.variety,
          grade: x.row.grade,
          quantity: x.quantity,
          unitPrice: x.row.price,
        })),
      });
      router.push(`/orders/${orderId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать заявку");
      setSubmitting(false);
    }
  }

  // --- Шаг 1: магазин ------------------------------------------------------
  if (!shop) {
    return (
      <div className="max-w-3xl">
        <h2 className="font-medium mb-1">В какой магазин?</h2>
        <p className="text-sm text-ink-secondary mb-3">
          {shops.length === 0
            ? "Магазинов в вашем направлении пока нет. Новую точку заводит руководитель отдела продаж."
            : "Выберите точку — дальше проставите количество."}
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {shops.map((s) => (
            <button
              key={s.clientId}
              type="button"
              onClick={() => setShopId(s.clientId)}
              className="card text-left hover:border-accent transition-colors"
            >
              <div className="font-medium">{s.name}</div>
              <div className="text-xs text-ink-muted mt-0.5">{s.address || s.city || "—"}</div>
              <div
                className={clsx(
                  "text-xs mt-2",
                  s.daysSinceLast === 0 && s.orders > 0 ? "text-status-good" : "text-ink-secondary"
                )}
              >
                {shopHint(s)}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // --- Шаг 2: ассортимент --------------------------------------------------
  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-4">
      <div className="card flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="label">Магазин</div>
          <div className="font-medium">{shop.name}</div>
          <div className="text-xs text-ink-muted">{shop.address || shop.city}</div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="label">Дата доставки</span>
            <input
              type="date"
              className="input !w-auto"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => setShopId("")}
            className="btn-secondary !py-1.5 text-sm"
          >
            Другой магазин
          </button>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-medium">Что везём</h2>
          <input
            className="input !w-auto !py-1.5 text-sm"
            placeholder="Найти сорт или длину"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap gap-1 border-b border-line-hairline">
          {assortment.map((g) => {
            const picked = chosen.filter((x) => x.row.flowerType === g.flowerType).length;
            return (
              <button
                key={g.flowerType}
                type="button"
                onClick={() => {
                  setFlowerType(g.flowerType);
                  setShowAll(false);
                }}
                className={clsx(
                  "px-3 py-2 text-sm -mb-px border-b-2 transition-colors whitespace-nowrap",
                  g.flowerType === flowerType
                    ? "border-accent text-ink-primary font-medium"
                    : "border-transparent text-ink-secondary hover:text-ink-primary"
                )}
              >
                {FLOWER_TYPE_LABELS[g.flowerType] ?? g.flowerType}
                {picked > 0 && <span className="ml-1 text-xs text-status-good">· {picked}</span>}
              </button>
            );
          })}
        </div>

        {group?.fallback && (
          <p className="text-xs text-ink-muted">
            По этому цветку нет ни остатка на складе, ни внутренней цены — показан весь справочник
            сортов. Цену поставит руководитель отдела продаж.
          </p>
        )}

        <div className="-mx-4 sm:mx-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line-hairline">
                <th className="px-4 py-2 font-medium">Сорт</th>
                <th className="px-4 py-2 font-medium">Длина / категория</th>
                <th className="px-4 py-2 font-medium text-right">На складе</th>
                <th className="px-4 py-2 font-medium text-right">Цена</th>
                <th className="px-4 py-2 font-medium text-right">Сколько везём</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const value = amounts[row.key] ?? "";
                const quantity = Math.round(Number(value) || 0);
                const over = quantity > row.stock && row.stock > 0;
                return (
                  <tr
                    key={row.key}
                    className={clsx(
                      "border-b border-line-hairline last:border-0",
                      quantity > 0 && "bg-accent-soft/25"
                    )}
                  >
                    <td className="px-4 py-2 font-medium">{row.variety}</td>
                    <td className="px-4 py-2 text-ink-secondary">{formatGrade(row.grade)}</td>
                    <td
                      className={clsx(
                        "px-4 py-2 text-right tabular-nums",
                        row.stock > 0 ? "text-ink-secondary" : "text-ink-muted"
                      )}
                    >
                      {row.stock > 0 ? row.stock.toLocaleString("ru-RU") : "—"}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-secondary">
                      {row.price > 0 ? money(row.price) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <input
                        className={clsx(
                          "input !w-24 text-right tabular-nums !py-1.5",
                          over && "!border-[#8a5a00]"
                        )}
                        inputMode="numeric"
                        placeholder="0"
                        value={value}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) =>
                          setAmounts((prev) => ({
                            ...prev,
                            [row.key]: e.target.value.replace(/[^\d]/g, ""),
                          }))
                        }
                      />
                      {/* Больше, чем лежит, — не запрет, а предупреждение:
                          склад ещё принимает срезку, и заявку на завтра
                          нормально ставить с запасом. */}
                      {over && (
                        <div className="text-[11px] text-[#8a5a00] mt-0.5">больше остатка</div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-ink-muted">
                    {search.trim() ? "Ничего не нашлось" : "Позиций по этому цветку нет"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {!search.trim() && hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="btn-secondary !py-1.5 text-sm"
          >
            {showAll ? "Показать только то, что на складе" : `Показать весь ассортимент (ещё ${hiddenCount})`}
          </button>
        )}
      </div>

      {chosen.length > 0 && (
        <div className="card">
          <div className="text-sm font-medium mb-2">
            В заявке {chosen.length}{" "}
            {chosen.length === 1 ? "позиция" : chosen.length < 5 ? "позиции" : "позиций"}
          </div>
          <ul className="text-sm text-ink-secondary space-y-1">
            {chosen.map((x) => (
              <li key={x.row.key} className="flex flex-wrap justify-between gap-x-3">
                <span>
                  {FLOWER_TYPE_LABELS[x.row.flowerType] ?? x.row.flowerType} · {x.row.variety}{" "}
                  {formatGrade(x.row.grade)}
                </span>
                <span className="tabular-nums">
                  {x.quantity.toLocaleString("ru-RU")} шт
                  {x.row.price > 0 && ` · ${money(x.quantity * x.row.price)}`}
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-line-hairline mt-2 pt-2 flex flex-wrap justify-between gap-x-3 text-sm font-medium">
            <span>Итого</span>
            <span className="tabular-nums">
              {totalStems.toLocaleString("ru-RU")} шт
              {totalAmount > 0 && ` · ${money(totalAmount)}`}
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-50">
        {submitting ? "Отправляю…" : "Отправить заявку"}
      </button>
      <p className="text-xs text-ink-muted">
        Сумма посчитана по внутреннему прайсу — это не выручка. Оплату по заявке никто не ждёт:
        подтвердите её, и склад сможет собирать.
      </p>
    </form>
  );
}
