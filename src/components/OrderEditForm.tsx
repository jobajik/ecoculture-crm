"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { updateOrderAction } from "@/app/orders/actions";
import OrderItemsEditor, { type DraftItem } from "./OrderItemsEditor";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";

/**
 * Правка уже оформленной заявки.
 *
 * Форма одна на все три вида заявок — клиентскую, магазинную и городскую, — и
 * это сознательно, в отличие от форм СОЗДАНИЯ, которых три. При создании люди
 * отвечают на разные вопросы: «кому продаём», «в какой магазин», «в какой
 * город», и общая форма с половиной скрытых полей там обрастала бы условиями.
 * А правят все трое одно и то же: день доставки и строки позиций. Контрагент
 * при правке не меняется вовсе (другой клиент — это другая заявка), поэтому
 * самое непохожее из всей формы просто отсутствует.
 *
 * Позиции могут быть заперты — например, бухгалтер уже провёл деньги. Тогда
 * они показаны как есть, с объяснением, а дату доставки и комментарий поправить
 * всё равно можно: это не деньги. Прятать форму целиком было бы неправильно —
 * человек пришёл сюда дописать дату, а получил бы «нельзя» без причины.
 */
export default function OrderEditForm({
  orderId,
  varieties,
  prices,
  stock,
  initialDeliveryDate,
  initialPhone,
  initialNotes,
  initialItems,
  showContacts,
  showPrice,
  itemsLockReason,
  wasConfirmed,
  clientLabel,
  clientHint,
  dateLabel,
  counterpartyLabel,
}: {
  orderId: string;
  varieties: Record<string, string[]>;
  prices: Record<string, number>;
  stock?: Record<string, number>;
  initialDeliveryDate: string;
  initialPhone: string;
  initialNotes: string;
  initialItems: DraftItem[];
  /** Телефон и комментарий есть только у клиентской заявки. */
  showContacts: boolean;
  /** У городской заявки цены нет по замыслу. */
  showPrice: boolean;
  /** Пусто — позиции править можно; иначе здесь причина, почему нельзя. */
  itemsLockReason: string;
  /** Стоит ли зелёная галочка: если да, правка позиций её снимет. */
  wasConfirmed: boolean;
  /** Кому заявка — показывается справкой, менять нельзя. */
  clientLabel: string;
  /** Почему контрагента не меняют — словами этой заявки. */
  clientHint: string;
  /** «Дата доставки» у клиента, «Дата отгрузки» у города — как в форме создания. */
  dateLabel: string;
  /** Заголовок поля контрагента: «Кому» / «Куда». */
  counterpartyLabel: string;
}) {
  const router = useRouter();
  const [deliveryDate, setDeliveryDate] = useState(initialDeliveryDate);
  const [phone, setPhone] = useState(initialPhone);
  const [notes, setNotes] = useState(initialNotes);
  const [items, setItems] = useState<DraftItem[]>(initialItems);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editableItems = !itemsLockReason;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (editableItems) {
      if (items.length === 0) return setError("В заявке должна остаться хотя бы одна позиция");
      for (const it of items) {
        if (!it.variety.trim()) return setError("У каждой позиции должен быть выбран сорт");
        if (!it.grade) return setError("Выберите длину (для роз) или категорию (для хризантем)");
        if (!it.quantity || Number(it.quantity) <= 0) {
          return setError("Укажите количество для каждой позиции");
        }
        if (showPrice && Number(it.unitPrice) < 0) return setError("Цена не может быть отрицательной");
      }
    }

    setSaving(true);
    try {
      await updateOrderAction(orderId, {
        deliveryDate,
        ...(showContacts ? { clientPhone: phone, notes } : {}),
        ...(editableItems
          ? {
              items: items.map((it) => ({
                itemId: it.itemId ?? "",
                flowerType: it.flowerType,
                variety: it.variety.trim(),
                grade: it.grade,
                quantity: Number(it.quantity),
                unitPrice: Number(it.unitPrice) || 0,
              })),
            }
          : {}),
      });
      router.push(`/orders/${orderId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
      <div className="card grid sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <div className="label">{counterpartyLabel}</div>
          <div className="font-medium">{clientLabel}</div>
          <p className="text-xs text-ink-muted mt-1">{clientHint}</p>
        </div>
        <div>
          <label className="label">{dateLabel}</label>
          <input
            type="date"
            className="input"
            value={deliveryDate}
            onChange={(e) => setDeliveryDate(e.target.value)}
          />
          {!initialDeliveryDate && (
            <span className="block text-xs text-[#8a5a00] mt-1">
              Сейчас даты нет — без неё заявка не попадёт в лист сборки склада.
            </span>
          )}
        </div>
        {showContacts && (
          <>
            <div>
              <label className="label">Телефон для этой доставки</label>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Комментарий</label>
              <textarea
                className="input"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </>
        )}
      </div>

      {editableItems ? (
        <>
          <OrderItemsEditor
            varieties={varieties}
            prices={prices}
            items={items}
            onChange={setItems}
            stock={stock}
            showPrice={showPrice}
          />
          {wasConfirmed && (
            <div className="text-sm text-ink-secondary bg-status-warning/10 rounded-lg px-3 py-2">
              Заявка подтверждена вашей зелёной галочкой. Если вы измените позиции, галочка
              снимется: склад собирает по подтверждённому составу, и согласиться с новым нужно
              заново.
            </div>
          )}
        </>
      ) : (
        <div className="card">
          <h2 className="font-medium mb-1">Позиции заявки</h2>
          <p className="text-sm text-[#8a5a00] mb-3">{itemsLockReason}</p>
          <div className="space-y-1 text-sm">
            {items.map((it, i) => (
              <div key={it.itemId ?? i} className="flex justify-between gap-3">
                <span>
                  {FLOWER_TYPE_LABELS[it.flowerType]} {it.variety} · {formatGrade(it.grade)}
                </span>
                <span className="tabular-nums text-ink-secondary">
                  {Number(it.quantity).toLocaleString("ru-RU")} шт.
                  {showPrice && ` · ${Number(it.unitPrice).toLocaleString("ru-RU")} ₸`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} className="btn-primary disabled:opacity-50">
          {saving ? "Сохраняю…" : "Сохранить изменения"}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/orders/${orderId}`)}
          className="btn-secondary"
        >
          Отмена
        </button>
      </div>
    </form>
  );
}
