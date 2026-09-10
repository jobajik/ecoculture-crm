"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { createOrderAction } from "@/app/orders/actions";
import OrderItemsEditor, { emptyItem, type DraftItem } from "./OrderItemsEditor";

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

/**
 * Заявка в наш магазин — два шага и ничего лишнего.
 *
 * Первый: выбрать одну из наших точек. Второй: позиции — ровно те же, что у
 * оптовых менеджеров (`OrderItemsEditor`), один компонент на обе формы.
 *
 * Здесь была своя таблица всего ассортимента с полем количества в каждой
 * строке. Идея была хорошая — «выбирай из того, что есть», — но пока склад и
 * внутренний прайс не заполнены, она разворачивалась в двести строк с
 * прочерками. Владелец увидел это первым. Общий блок позиций работает при
 * любом состоянии данных, а остаток склада показывается подсказкой прямо у
 * поля количества — там, где он и нужен.
 *
 * Чего в этой форме нет и не будет: клиента (контрагент — наш магазин),
 * телефона доставки (он в карточке точки) и комментария. Цена подставляется из
 * ВНУТРЕННЕГО прайса: это перемещение внутри компании, а не переговоры.
 */
export default function RetailOrderForm({
  shops,
  varieties,
  prices,
  stock,
  initialShopId = "",
  initialDeliveryDate = "",
}: {
  shops: RetailShopOption[];
  varieties: Record<string, string[]>;
  /** Внутренний прайс: «цветок|сорт|градация» → цена. */
  prices: Record<string, number>;
  /** Остаток склада той же формы ключа — подсказка у количества. */
  stock: Record<string, number>;
  initialShopId?: string;
  initialDeliveryDate?: string;
}) {
  const router = useRouter();

  const [shopId, setShopId] = useState(initialShopId);
  const [deliveryDate, setDeliveryDate] = useState(initialDeliveryDate);
  const [items, setItems] = useState<DraftItem[]>([emptyItem(varieties, prices)]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shop = shops.find((s) => s.clientId === shopId) ?? null;

  function shopHint(s: RetailShopOption): string {
    if (s.orders === 0) return "ещё не возили";
    // Ноль — это и «привезли сегодня», и «заявка на завтра уже оформлена»: для
    // менеджера это один и тот же сигнал «второй раз не отправляй».
    if (s.daysSinceLast <= 0) return "заявка уже есть";
    if (s.daysSinceLast === 1) return "возили вчера";
    return `возили ${s.daysSinceLast} дн. назад`;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!shop) return setError("Выберите магазин");
    if (!deliveryDate) return setError("Укажите дату доставки");
    if (items.length === 0) return setError("Добавьте хотя бы одну позицию");
    for (const it of items) {
      if (!it.variety.trim()) return setError("У каждой позиции должен быть выбран сорт");
      if (!it.grade) return setError("Выберите длину (для роз) или категорию (для хризантем)");
      if (!it.quantity || Number(it.quantity) <= 0) {
        return setError("Укажите количество для каждой позиции");
      }
    }

    setSubmitting(true);
    try {
      const orderId = await createOrderAction({
        clientId: shop.clientId,
        // Имя записывается снимком: точку могут переименовать, а в старой
        // заявке должно остаться то, что было написано тогда.
        clientName: shop.name,
        clientPhone: "",
        deliveryDate,
        items: items.map((it) => ({
          flowerType: it.flowerType,
          variety: it.variety.trim(),
          grade: it.grade,
          quantity: Number(it.quantity),
          // Цены во внутреннем прайсе может ещё не быть — заявка от этого не
          // должна не отправляться: стебли важнее суммы, а сумму РОП добавит.
          unitPrice: Number(it.unitPrice) || 0,
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
            : "Выберите точку — дальше добавите позиции."}
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

  // --- Шаг 2: позиции ------------------------------------------------------
  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-6">
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

      <OrderItemsEditor
        varieties={varieties}
        prices={prices}
        items={items}
        onChange={setItems}
        stock={stock}
      />

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
          Сумма посчитана по внутреннему прайсу — это не выручка. Оплату по заявке никто не ждёт:
          подтвердите её, и склад сможет собирать.
        </p>
      </div>
    </form>
  );
}
