"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createOrderAction } from "@/app/orders/actions";
import ClientPicker, { type ClientOption } from "./ClientPicker";
import OrderItemsEditor, { emptyItem, type DraftItem } from "./OrderItemsEditor";
import { PAYMENT_METHODS, SHIPMENT_DIRECTIONS } from "@/lib/constants";
import { directionForCity } from "@/lib/direction";
import { unwrapValue } from "@/lib/actionResult";

export default function OrderForm({
  varieties,
  prices = {},
  clients = [],
  initialClient = null,
  initialDeliveryDate = "",
  showDirection = false,
  initialDirection = "",
  stock,
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
  /**
   * Показывать ли «Направление». Видит менеджер (он и знает, куда едет цветок),
   * РОП и администратор. У розницы и склада направления не бывает вовсе — там
   * перемещение внутри компании. Разрешение всё равно проверяется на сервере
   * (грабли 1.11).
   */
  showDirection?: boolean;
  /** Направление, с которым пришли из раздела «Регионы». */
  initialDirection?: string;
  /**
   * Остаток на складе: «цветок|сорт|градация» → штук.
   *
   * Менеджер обещает клиенту то, чего может не быть в холодильнике. Раньше
   * остаток был только на главной — то есть не в ту секунду, когда он нужен:
   * человек уже выбрал сорт и длину и вводит количество. Заявка на 800 роз
   * при 240 на складе — это не отказ клиенту, а разговор с ним на день позже,
   * когда цветок уже ждут. Запретом это не делается (срез приходит каждый
   * день, и продавать вперёд нормально) — поэтому цифра, а не запрет.
   */
  stock?: Record<string, number>;
}) {
  const router = useRouter();
  const [client, setClient] = useState<ClientOption | null>(initialClient);
  const [clientPhone, setClientPhone] = useState(initialClient?.phone ?? "");
  const [deliveryDate, setDeliveryDate] = useState(initialDeliveryDate);
  const [notes, setNotes] = useState("");
  const [direction, setDirection] = useState(
    initialDirection || directionForCity(initialClient?.city)
  );
  // Менял ли человек направление руками. Пока не менял — оно едет за клиентом:
  // выбрал клиента из Караганды, направление встало само. После ручной правки
  // подстановка замолкает, иначе она затирала бы осознанный выбор (возят и не
  // туда, где офис клиента).
  const [directionTouched, setDirectionTouched] = useState(Boolean(initialDirection));
  // Как клиент будет платить. Знает это только менеджер, а бухгалтеру нужно
  // заранее — просьба Юлии: «только менеджер знает вид оплаты». Подставляется
  // из карточки клиента («чем платит») и едет за клиентом, пока не тронули.
  const methodOf = (c: ClientOption | null) =>
    PAYMENT_METHODS.includes((c?.paymentMethod ?? "") as never) ? (c?.paymentMethod as string) : "";
  const [paymentMethod, setPaymentMethod] = useState(methodOf(initialClient));
  const [methodTouched, setMethodTouched] = useState(false);
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
      const orderId = unwrapValue(await createOrderAction({
        clientId: client.clientId,
        // Имя записывается снимком: точка может переименоваться, а в старой
        // заявке должно остаться то, что было написано тогда.
        clientName: client.name,
        clientPhone: (clientPhone || client.phone).trim(),
        deliveryDate,
        notes,
        direction,
        paymentMethod,
        items: items.map((it) => ({
          flowerType: it.flowerType,
          variety: it.variety.trim(),
          grade: it.grade,
          quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice),
        })),
      }));
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
          <ClientPicker
            clients={clients}
            value={client}
            onChange={(next) => {
              setClient(next);
              if (!directionTouched) setDirection(directionForCity(next?.city));
              if (!methodTouched) setPaymentMethod(methodOf(next));
            }}
          />
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
        {showDirection && (
          <div>
            <label className="label">Направление отгрузки</label>
            <select
              className="input"
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value);
                setDirectionTouched(true);
              }}
            >
              <option value="">Алматы и округа</option>
              {SHIPMENT_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <span className="block text-xs text-ink-muted mt-1">
              {client?.city
                ? `Город клиента — ${client.city}. Подставлено по нему, можно поменять.`
                : "По этому полю заявка попадает в план отгрузок по регионам."}
            </span>
          </div>
        )}
        <div>
          <label className="label">Вид оплаты</label>
          <select
            className="input"
            value={paymentMethod}
            onChange={(e) => {
              setPaymentMethod(e.target.value);
              setMethodTouched(true);
            }}
          >
            <option value="">— не знаю —</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <span className="block text-xs text-ink-muted mt-1">
            Бухгалтер увидит это в списке оплат — до того, как придут деньги.
          </span>
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
        stock={stock}
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
