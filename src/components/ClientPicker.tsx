"use client";

import { useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import {
  CLIENT_SOURCES,
  CLIENT_TYPES,
  KASPI_METHOD,
  PAYMENT_METHODS,
  PAYMENT_TERMS,
} from "@/lib/constants";
import { createClientAction } from "@/app/clients/actions";
import { orderForPicker } from "@/lib/clientPick";
import { days } from "@/lib/plural";

export interface ClientOption {
  clientId: string;
  name: string;
  city: string;
  shopName: string;
  phone: string;
  managerName: string;
  /** Свой ли это клиент — своих показываем первыми. */
  mine: boolean;
  /** Сколько заявок было. Ноль — карточка заведена, но ещё ничего не покупал. */
  orders: number;
  /** Дней с последнего заказа; -1 — заказов не было. */
  daysSinceLast: number;
}

/**
 * Выбор клиента при оформлении заявки.
 *
 * Раньше менеджер вписывал имя руками, и «Цветы 24», «цветы-24» и «ТОО Цветы
 * 24» превращались в трёх разных клиентов: ни средний чек, ни история заказов
 * после этого не считались. Теперь клиент выбирается из базы.
 *
 * Порядок в списке — не алфавитный, и это главное для скорости.
 * Менеджер девять раз из десяти оформляет заявку СТАРОМУ клиенту, причём
 * тому, с кем работал недавно. Поэтому сверху идут свои клиенты, у которых
 * заказ был на днях, а «Азия-Флора» из алфавита, у которой не покупали
 * полгода, уходит вниз. При поиске порядок сохраняется — найденное свежее
 * тоже стоит выше.
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
    paymentMethod: PAYMENT_METHODS[0] as string,
    kaspiPay1: "",
    kaspiPay2: "",
    source: CLIENT_SOURCES[0] as string,
    note: "",
    // Наш ли это магазин, решает не форма, а роль на сервере. Поле здесь
    // только чтобы типы сошлись: подставленное из браузера значение сервер
    // всё равно перепроверит (грабли 1.11).
    retail: "",
  });

  /**
   * Порядок: свои перед чужими, недавние перед давними, покупавшие перед
   * теми, кто ещё ничего не брал. Внутри равных — по алфавиту, чтобы список
   * не прыгал.
   */
  const ordered = useMemo(() => orderForPicker(clients), [clients]);

  const found = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ordered.slice(0, 8);
    return ordered
      .filter((c) =>
        [c.name, c.shopName, c.city, c.phone].some((f) => f.toLowerCase().includes(q))
      )
      .slice(0, 12);
  }, [ordered, search]);

  function hint(c: ClientOption): string {
    if (c.orders === 0) return "заказов ещё не было";
    if (c.daysSinceLast <= 0) return "заказ сегодня";
    if (c.daysSinceLast === 1) return "заказ вчера";
    return `заказ ${days(c.daysSinceLast)} назад`;
  }

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
          mine: true,
          orders: 0,
          daysSinceLast: -1,
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
          {select("Чем платит", "paymentMethod", PAYMENT_METHODS)}
        </div>

        {form.paymentMethod === KASPI_METHOD && (
          <KaspiFields
            pay1={form.kaspiPay1}
            pay2={form.kaspiPay2}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
          />
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          {select("Как нашли", "source", CLIENT_SOURCES)}
          {field("Заметка", "note", "Что берёт, когда звонить")}
        </div>
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
                className="w-full text-left px-3 py-2 hover:bg-surface-plane flex flex-wrap items-baseline justify-between gap-x-3"
              >
                <span>
                  <span className="font-medium">{c.name}</span>
                  <span className="block text-xs text-ink-muted">
                    {[c.city, c.shopName, c.mine ? "ваш клиент" : c.managerName]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span
                  className={clsx(
                    "text-xs whitespace-nowrap",
                    c.orders === 0 ? "text-ink-muted" : "text-ink-secondary"
                  )}
                >
                  {hint(c)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!search.trim() && clients.length > found.length && (
        <p className="text-xs text-ink-muted">
          Показаны последние, с кем работали. Начните вводить название — найдётся любой из{" "}
          {clients.length}.
        </p>
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

/**
 * Каспи-номера клиента: два поля со свободным вводом.
 *
 * Клиент платит то с личного номера, то с магазинного — поэтому их два, и оба
 * вписываются руками: список готовых вариантов здесь невозможен.
 *
 * Компанию, которая выставляет счёт, тут не выбирают: она следует из цветка в
 * заявке — роза и эустома от Rose Farm, хризантема от Есентая, — и в заявке
 * показывается сама. Раньше на этом месте стоял выбор «Каспи 1 или Каспи 2»,
 * и в смешанной заявке любой выбор был наполовину неверным.
 *
 * Поля показываются, только когда клиент платит Каспи, — иначе это две пустые
 * ячейки, которые все обходят глазами.
 */
export function KaspiFields({
  pay1,
  pay2,
  onChange,
}: {
  pay1: string;
  pay2: string;
  onChange: (patch: { kaspiPay1?: string; kaspiPay2?: string }) => void;
}) {
  return (
    <div className="rounded-xl border border-line-hairline p-3 space-y-2">
      <div className="text-sm font-medium">Kaspi Pay клиента</div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm block">
          <span className="label">Каспи Pay №1</span>
          <input
            className="input"
            placeholder="+7 ..."
            value={pay1}
            onChange={(e) => onChange({ kaspiPay1: e.target.value })}
          />
        </label>
        <label className="text-sm block">
          <span className="label">Каспи Pay №2</span>
          <input
            className="input"
            placeholder="если платит и со второго"
            value={pay2}
            onChange={(e) => onChange({ kaspiPay2: e.target.value })}
          />
        </label>
      </div>
      <p className="text-xs text-ink-muted">
        Это номера, С КОТОРЫХ приходит перевод: по ним бухгалтер узнаёт платёж. Счёт выставляет
        то ТОО, чей цветок в заявке, — это считается само, выбирать не нужно.
      </p>
    </div>
  );
}
