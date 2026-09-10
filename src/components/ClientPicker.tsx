"use client";

import { useMemo, useState, useTransition } from "react";
import { CLIENT_SOURCES, CLIENT_TYPES, PAYMENT_TERMS } from "@/lib/constants";
import { createClientAction } from "@/app/clients/actions";

export interface ClientOption {
  clientId: string;
  name: string;
  city: string;
  shopName: string;
  phone: string;
  managerName: string;
}

/**
 * Выбор клиента при оформлении заявки.
 *
 * Раньше менеджер вписывал имя руками, и «Цветы 24», «цветы-24» и «ТОО Цветы
 * 24» превращались в трёх разных клиентов: ни средний чек, ни история заказов,
 * ни ответ на вопрос «сколько возим в Караганду» после этого не считались.
 * Теперь клиент выбирается из базы.
 *
 * Нового клиента заводят прямо здесь, не уходя со страницы: если для этого
 * пришлось бы бросать наполовину набранную заявку, менеджер в спешке нашёл бы
 * способ обойтись — и база снова разъехалась бы. Обязательных полей ровно два,
 * имя и город; остальное дозаполняется потом в карточке.
 */
export default function ClientPicker({
  clients,
  value,
  onChange,
}: {
  clients: ClientOption[];
  value: ClientOption | null;
  onChange: (client: ClientOption | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: "",
    city: "",
    shopName: "",
    clientType: CLIENT_TYPES[0] as string,
    contactPerson: "",
    phone: "",
    messenger: "",
    address: "",
    paymentTerms: PAYMENT_TERMS[1] as string,
    source: CLIENT_SOURCES[0] as string,
    note: "",
  });

  const found = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients.slice(0, 8);
    return clients
      .filter((c) =>
        [c.name, c.shopName, c.city, c.phone].some((f) => f.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [clients, search]);

  function save() {
    setError(null);
    if (!form.name.trim()) return setError("Укажите название клиента");
    if (!form.city.trim()) return setError("Укажите город — без него не посчитать, куда мы возим");
    startTransition(async () => {
      try {
        const created = await createClientAction({ ...form });
        onChange({
          clientId: created.clientId,
          name: form.name.trim(),
          city: form.city.trim(),
          shopName: form.shopName.trim(),
          phone: form.phone.trim(),
          managerName: "вы",
        });
        setCreating(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось завести клиента");
      }
    });
  }

  if (value) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="font-medium">{value.name}</div>
          <div className="text-xs text-ink-muted">
            {[value.city, value.shopName, value.phone].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <button type="button" onClick={() => onChange(null)} className="btn-secondary !py-1 text-sm">
          Выбрать другого
        </button>
      </div>
    );
  }

  if (creating) {
    const field = (
      label: string,
      key: keyof typeof form,
      placeholder = "",
      required = false
    ) => (
      <label className="text-sm block">
        <span className="label">
          {label}
          {required ? " *" : ""}
        </span>
        <input
          className="input"
          placeholder={placeholder}
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        />
      </label>
    );
    const select = (label: string, key: keyof typeof form, options: readonly string[]) => (
      <label className="text-sm block">
        <span className="label">{label}</span>
        <select
          className="input"
          value={form[key]}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    );

    return (
      <div className="space-y-3 border border-line-hairline rounded-xl p-3">
        <div className="grid sm:grid-cols-2 gap-3">
          {field("Название клиента", "name", "Например: ТОО «Флора Плюс»", true)}
          {field("Город", "city", "Алматы", true)}
          {field("Магазин / точка", "shopName", "Если отличается от названия")}
          {select("Тип точки", "clientType", CLIENT_TYPES)}
          {field("Контактное лицо", "contactPerson", "С кем говорим")}
          {field("Телефон", "phone", "+7 ...")}
          {field("WhatsApp / Instagram", "messenger", "@nickname или номер")}
          {field("Адрес доставки", "address", "Куда возить")}
          {select("Условия оплаты", "paymentTerms", PAYMENT_TERMS)}
          {select("Как нашли", "source", CLIENT_SOURCES)}
        </div>
        <label className="text-sm block">
          <span className="label">Заметка</span>
          <input
            className="input"
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
          <button type="button" onClick={save} disabled={pending} className="btn-primary disabled:opacity-50">
            {pending ? "Сохраняю…" : "Завести клиента"}
          </button>
          <button type="button" onClick={() => setCreating(false)} className="btn-secondary">
            Отмена
          </button>
        </div>
        <p className="text-xs text-ink-muted">
          Обязательны только название и город — остальное можно дозаполнить потом в карточке.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <input
        className="input"
        placeholder="Начните вводить название, город или телефон"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {found.length > 0 && (
        <ul className="border border-line-hairline rounded-xl divide-y divide-line-hairline overflow-hidden">
          {found.map((c) => (
            <li key={c.clientId}>
              <button
                type="button"
                onClick={() => onChange(c)}
                className="w-full text-left px-3 py-2 hover:bg-surface-plane"
              >
                <span className="font-medium">{c.name}</span>
                <span className="block text-xs text-ink-muted">
                  {[c.city, c.shopName, c.managerName].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {search.trim() && found.length === 0 && (
        <p className="text-sm text-ink-muted">Такого клиента в базе нет.</p>
      )}
      <button type="button" onClick={() => setCreating(true)} className="btn-secondary !py-1.5 text-sm">
        + Новый клиент
      </button>
    </div>
  );
}
