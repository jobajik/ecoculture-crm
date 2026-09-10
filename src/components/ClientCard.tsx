"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CLIENT_SOURCES,
  CLIENT_TYPES,
  KASPI_METHOD,
  PAYMENT_METHODS,
  PAYMENT_TERMS,
} from "@/lib/constants";
import { KaspiFields } from "./ClientPicker";
import { updateClientAction } from "@/app/clients/actions";

export interface ClientCardValues {
  name: string;
  city: string;
  shopName: string;
  clientType: string;
  contactPerson: string;
  phone: string;
  messenger: string;
  address: string;
  paymentTerms: string;
  paymentMethod: string;
  kaspiPay1: string;
  kaspiPay2: string;
  source: string;
  note: string;
}

/**
 * Анкета клиента: смотреть и править.
 *
 * По умолчанию — режим просмотра: карточку открывают, чтобы посмотреть, кому
 * звонить и куда везти, а не чтобы править. Поля ввода на каждом заходе
 * провоцируют случайные изменения, которые никто не заметит.
 *
 * Правит свой менеджер, РОП и админ — кто именно, решает сервер; сюда приходит
 * готовый ответ `canEdit`.
 */
export default function ClientCard({
  clientId,
  values,
  canEdit,
  managerName,
}: {
  clientId: string;
  values: ClientCardValues;
  canEdit: boolean;
  managerName: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ClientCardValues>(values);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updateClientAction(clientId, form);
        setEditing(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
      }
    });
  }

  if (!editing) {
    const rows: [string, string][] = [
      ["Город", values.city],
      ["Магазин / точка", values.shopName],
      ["Тип точки", values.clientType],
      ["Контактное лицо", values.contactPerson],
      ["Телефон", values.phone],
      ["WhatsApp / Instagram", values.messenger],
      ["Адрес доставки", values.address],
      ["Условия оплаты", values.paymentTerms],
      ["Чем платит", values.paymentMethod],
      ["Как нашли", values.source],
      ["Менеджер", managerName],
    ];
    // Каспи-номера показываем только тем, кто действительно платит Каспи:
    // иначе это два прочерка, которые все обходят глазами.
    const kaspi: [string, string][] =
      values.paymentMethod === KASPI_METHOD
        ? [
            ["Каспи Pay №1", values.kaspiPay1],
            ["Каспи Pay №2", values.kaspiPay2],
          ]
        : [];
    return (
      <div className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-medium">Анкета</h2>
          {canEdit && (
            <button onClick={() => setEditing(true)} className="btn-secondary !py-1.5 text-sm">
              Изменить
            </button>
          )}
        </div>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="label">{label}</dt>
              <dd>
                {value || <span className="text-ink-muted">не заполнено</span>}
              </dd>
            </div>
          ))}
        </dl>
        {kaspi.length > 0 && (
          <div className="border-t border-line-hairline pt-3">
            <div className="text-sm font-medium mb-2">Kaspi Pay клиента</div>
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              {kaspi.map(([label, value]) => (
                <div key={label}>
                  <dt className="label">{label}</dt>
                  <dd>{value || <span className="text-ink-muted">не заполнено</span>}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
        {values.note && (
          <div className="border-t border-line-hairline pt-3 text-sm">
            <div className="label">Заметка</div>
            <div className="text-ink-secondary">{values.note}</div>
          </div>
        )}
      </div>
    );
  }

  const field = (label: string, key: keyof ClientCardValues, placeholder = "") => (
    <label className="text-sm block">
      <span className="label">{label}</span>
      <input
        className="input"
        placeholder={placeholder}
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </label>
  );
  const select = (label: string, key: keyof ClientCardValues, options: readonly string[]) => (
    <label className="text-sm block">
      <span className="label">{label}</span>
      <select
        className="input"
        value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      >
        <option value="">Не указано</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="card space-y-3">
      <h2 className="font-medium">Анкета</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {field("Название клиента", "name")}
        {field("Город", "city")}
        {field("Магазин / точка", "shopName")}
        {select("Тип точки", "clientType", CLIENT_TYPES)}
        {field("Контактное лицо", "contactPerson")}
        {field("Телефон", "phone")}
        {field("WhatsApp / Instagram", "messenger")}
        {field("Адрес доставки", "address")}
        {select("Условия оплаты", "paymentTerms", PAYMENT_TERMS)}
        {select("Чем платит", "paymentMethod", PAYMENT_METHODS)}
        {select("Как нашли", "source", CLIENT_SOURCES)}
      </div>

      {form.paymentMethod === KASPI_METHOD && (
        <KaspiFields
          pay1={form.kaspiPay1}
          pay2={form.kaspiPay2}
          onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        />
      )}
      <label className="text-sm block">
        <span className="label">Заметка</span>
        <textarea
          className="input"
          rows={2}
          placeholder="Что берёт, когда звонить, о чём договорились"
          value={form.note}
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
        />
      </label>
      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <button onClick={save} disabled={pending} className="btn-primary disabled:opacity-50">
          {pending ? "Сохраняю…" : "Сохранить"}
        </button>
        <button
          onClick={() => {
            setForm(values);
            setEditing(false);
          }}
          className="btn-secondary"
        >
          Отмена
        </button>
      </div>
    </div>
  );
}
