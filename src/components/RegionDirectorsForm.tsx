"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setRegionDirectorAction } from "@/app/region/actions";
import { unwrap } from "@/lib/actionResult";

export interface RegionDirectorRow {
  store: string;
  city: string;
  /** Почта директора; пусто — не назначен. */
  director: string;
  weekday: number;
  female: boolean;
  /** Менеджеры города без флага директора (ведут склад). */
  managers: string[];
}

const DAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

/**
 * «Настройки → Регионы» (17.11.2026): кто директор города и в какой день уходит фура. Директор — сотрудник с ролью
 * «Менеджер»; после назначения у него в меню появляется раздел города (остатки, фура, отгрузка, списание, оплаты и
 * долги), а заказ на фуру и форма заявки открываются на день фуры. Сохраняется по городу отдельно.
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
  const [saved, setSaved] = useState(false);
  const dirty = email !== row.director || weekday !== row.weekday || (!!email && female !== row.female);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      unwrap(await setRegionDirectorAction({ store: row.store, email, weekday, female }));
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-line-hairline rounded-lg p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
        <span className="font-medium">{row.city}</span>
        {row.managers.length > 0 && <span className="text-xs text-ink-muted">менеджер города: {row.managers.join(", ")}</span>}
        <Link href={`/region/${row.store}`} className="ml-auto text-xs text-accent hover:underline">
          открыть раздел города
        </Link>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] gap-3 items-end">
        <label className="text-sm">
          <span className="label">Директор</span>
          <select
            className="input"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSaved(false);
            }}
          >
            <option value="">— не назначен —</option>
            {managers.map((m) => (
              <option key={m.email} value={m.email}>
                {m.name || m.email}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="label">Фура уходит</span>
          <select
            className="input"
            value={weekday}
            onChange={(e) => {
              setWeekday(Number(e.target.value));
              setSaved(false);
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
          {busy ? "Сохраняю…" : "Сохранить"}
        </button>
      </div>
      {email && (
        <label className="flex items-center gap-2 text-sm text-ink-secondary mt-3">
          <input
            type="checkbox"
            checked={female}
            onChange={(e) => {
              setFemale(e.target.checked);
              setSaved(false);
            }}
          />
          Директор — женщина (ИИ-помощник её номера пишет «оформила», а не «оформил»)
        </label>
      )}
      {error && <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2 mt-3">{error}</div>}
      {saved && <div className="text-sm text-[#12733a] bg-status-good/10 rounded-lg px-3 py-2 mt-3">Сохранено. Раздел города появится у директора в меню в течение минуты.</div>}
    </div>
  );
}
