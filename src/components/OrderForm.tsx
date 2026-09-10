"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createOrderAction } from "@/app/orders/actions";
import ClientPicker, { type ClientOption } from "./ClientPicker";
import OrderItemsEditor, { emptyItem, type DraftItem } from "./OrderItemsEditor";

export default function OrderForm({
  varieties,
  prices = {},
  clients = [],
  initialClient = null,
  initialDeliveryDate = "",
}: {
  varieties: Record<string, string[]>;
  /** Действующий прайс: «цветок|сорт|градация» → цена. */
  prices?: Record<string, number>;
  /** Клиентская база: заявка заводится только на клиента из неё. */
  clients?: ClientOption[];
  /**
   * Кому и на какой день — если человек пришёл сюда из списка, где это уже
   * выбрано. Так менеджер розницы жмёт «оформить» напротив магазина и сразу
   * вводит количество, а не выбирает заново то, на что уже нажал.
   */
  initialClient?: ClientOption | null;
  initialDeliveryDate?: string;
}) {
  const router = useRouter();
  const [client, setClient] = useState<ClientOption | null>(initialClient);
  const [clientPhone, setClientPhone] = useState(initialClient?.phone ?? "");
  const [deliveryDate, setDeliveryDate] = useState(initialDeliveryDate);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([emptyItem(varieties, prices)]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!client) return setError("Выберите клиента из базы или заведите нового");
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
        clientId: client.clientId,
        // Имя записывается снимком: точка может переименоваться, а в старой
        // заявке должно остаться то, что было написано тогда.
        clientName: client.name,
        clientPhone: (clientPhone || client.phone).trim(),
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
        <div className="sm:col-span-2">
          <label className="label">Клиент *</label>
          <ClientPicker clients={clients} value={client} onChange={setClient} />
        </div>
        <div>
          <label className="label">Телефон для этой доставки</label>
          <input
            className="input"
            placeholder={client?.phone || "Если отличается от карточки"}
            value={clientPhone}
            onChange={(e) => setClientPhone(e.target.value)}
          />
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

      <OrderItemsEditor
        varieties={varieties}
        prices={prices}
        items={items}
        onChange={setItems}
      />

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>
      )}

      <button type="submit" disabled={submitting} className="btn-primary">
        {submitting ? "Сохранение…" : "Создать заявку"}
      </button>
    </form>
  );
}
