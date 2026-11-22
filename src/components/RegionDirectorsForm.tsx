"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addCityManagerAction, setRegionDirectorAction } from "@/app/region/actions";
import { unwrap, unwrapValue } from "@/lib/actionResult";
import { storeInto } from "@/lib/officeStore";

export interface RegionDirectorRow {
  store: string;
  city: string;
  /** Почта менеджера города (главного); пусто — не назначен. */
  director: string;
  weekday: number;
  female: boolean;
  /** Остальные менеджеры, посаженные в город. */
  managers: string[];
  /** Номер WhatsApp менеджера города: подключён ли к CRM и что с помощником. Пусто — менеджера нет. */
  wa: "" | "on" | "off";
}

const DAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

/**
 * «Настройки → Регионы» (17.11.2026; 22.11.2026 — «менеджер города» вместо «директора» и заведение нового менеджера
 * одним шагом). Менеджер города — сотрудник с ролью «Менеджер», посаженный в город: продаёт клиентам только со склада
 * своего города, заказывает фуру, подтверждает приёмку, видит заявки, оплаты и долги города. Сохраняется по городу отдельно.
 */
export default function RegionDirectorsForm({ rows, managers }: { rows: RegionDirectorRow[]; managers: { email: string; name: string }[] }) {
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <CityRow key={r.store} row={r} managers={managers} />
      ))}
    </div>
  );
}

function CityRow({ row, managers }: { row: RegionDirectorRow; managers: { email: string; name: string }[] }) {
  const router = useRouter();
  const [email, setEmail] = useState(row.director);
  const [weekday, setWeekday] = useState(row.weekday);
  const [female, setFemale] = useState(row.female);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState("");
  // Новый сотрудник — отдельной маленькой формой: имя, почта Google для входа, номер WhatsApp.
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [newFemale, setNewFemale] = useState(false);
  const dirty = email !== row.director || weekday !== row.weekday || (!!email && female !== row.female);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved("");
    try {
      unwrap(await setRegionDirectorAction({ store: row.store, email, weekday, female }));
      setSaved("Сохранено. Раздел города появится у менеджера в меню в течение минуты.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    setBusy(true);
    setError(null);
    setSaved("");
    try {
      const done = unwrapValue(await addCityManagerAction({ store: row.store, name, email: newEmail, phone, weekday, female: newFemale }));
      setEmail(newEmail.trim().toLowerCase());
      setFemale(newFemale);
      setAdding(false);
      setName("");
      setNewEmail("");
      setPhone("");
      setSaved(`${done.name} — менеджер города ${done.city}. Вход — по этой почте Google. Осталось подключить номер WhatsApp.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось завести");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-line-hairline rounded-lg p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
        <span className="font-medium">{row.city}</span>
        {row.director && row.wa === "on" && <span className="badge bg-status-good/10 text-[#12733a]">WhatsApp подключён</span>}
        {row.director && row.wa === "off" && (
          <Link href="/admin?tab=wa" className="badge bg-[#fff4d6] text-[#8a5a00] hover:underline">
            WhatsApp не подключён — подключить
          </Link>
        )}
        {row.director && row.managers.length > 0 && <span className="text-xs text-ink-muted">ещё в городе: {row.managers.join(", ")}</span>}
        <Link href={`/region/${row.store}`} className="ml-auto text-xs text-accent hover:underline">
          открыть раздел города
        </Link>
      </div>
      {!row.director && row.managers.length > 0 && (
        <p className="text-sm text-ink-secondary bg-surface-plane rounded-lg px-3 py-2 mb-3">
          В городе уже работает: <b className="font-medium text-ink-primary">{row.managers.join(", ")}</b> — продаёт со склада города, заказывает и принимает фуру, но оплаты и долги
          города не видит. Чтобы видел(а) — выберите в списке ниже и сохраните.
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] gap-3 items-end">
        <label className="text-sm">
          <span className="label">Менеджер города</span>
          <select
            className="input"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSaved("");
            }}
          >
            <option value="">— не назначен —</option>
            {managers.map((m) => (
              <option key={m.email} value={m.email}>
                {m.name || m.email}
              </option>
            ))}
            {email && !managers.some((m) => m.email === email) && <option value={email}>{email}</option>}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">Фура уходит</span>
          <select
            className="input"
            value={weekday}
            onChange={(e) => {
              setWeekday(Number(e.target.value));
              setSaved("");
            }}
          >
            {DAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-primary disabled:opacity-50" disabled={busy || !dirty} onClick={save}>
          {busy && !adding ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
      {email && (
        <label className="flex items-center gap-2 text-sm text-ink-secondary mt-3">
          <input
            type="checkbox"
            checked={female}
            onChange={(e) => {
              setFemale(e.target.checked);
              setSaved("");
            }}
          />
          Менеджер — женщина (ИИ-помощник её номера пишет «оформила», а не «оформил»)
        </label>
      )}

      {!adding ? (
        <button
          type="button"
          className="text-sm text-accent hover:underline mt-3"
          onClick={() => {
            setAdding(true);
            setError(null);
          }}
        >
          + Новый сотрудник — завести и посадить в {storeInto(row.store)}
        </button>
      ) : (
        <div className="mt-3 rounded-lg bg-surface-plane p-3">
          <div className="text-sm font-medium mb-2">Новый менеджер города {row.city}</div>
          <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-3 gap-3">
            <label className="text-sm">
              <span className="label">Имя и фамилия</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Айгерим Сатпаева" />
            </label>
            <label className="text-sm">
              <span className="label">Почта Google (по ней вход)</span>
              <input className="input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="имя@gmail.com" autoComplete="off" />
            </label>
            <label className="text-sm">
              <span className="label">Номер WhatsApp</span>
              <input className="input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+7 701 000 00 00" autoComplete="off" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-secondary mt-3">
            <input type="checkbox" checked={newFemale} onChange={(e) => setNewFemale(e.target.checked)} />
            Женщина
          </label>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <button type="button" className="btn-primary disabled:opacity-50" disabled={busy || !name.trim() || !newEmail.trim()} onClick={add}>
              {busy ? "Завожу…" : "Завести и посадить в город"}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setAdding(false)}>
              Отмена
            </button>
            {row.director && <span className="text-xs text-ink-muted">Нынешний менеджер города останется сотрудником, но уже без города.</span>}
          </div>
        </div>
      )}

      {error && <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2 mt-3">{error}</div>}
      {saved && <div className="text-sm text-[#12733a] bg-status-good/10 rounded-lg px-3 py-2 mt-3">{saved}</div>}
    </div>
  );
}
