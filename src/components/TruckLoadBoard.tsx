"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { loadTruckAction } from "@/app/warehouse/truck-actions";
import { unwrapValue } from "@/lib/actionResult";
import { REST_OPTIONS, type RestCode } from "@/lib/truckLoad";
import { storeInto } from "@/lib/officeStore";
import Pill from "./Pill";

export interface LoadRow {
  itemId: string;
  orderId: string;
  /** Короткий номер заказа. */
  code: string;
  /** Позиция заказа «в наши магазины» (а не на склад города). */
  shop: boolean;
  flower: string;
  name: string;
  /** Ключ остатка: «цветок|сорт|длина». */
  key: string;
  /** Сколько просил город. */
  asked: number;
  shipped: number;
  /** Сколько осталось отгрузить. */
  left: number;
}

export interface LoadGroup {
  key: string;
  store: string;
  city: string;
  day: string;
  /** «понедельник, 23.11» */
  dayLabel: string;
  /** День фуры уже прошёл. */
  late: boolean;
  /** «Салтанат · заказы № A1B2C, D3E4F» */
  byLine: string;
  comments: string[];
  rows: LoadRow[];
  /** Позиций другого производства в этих же заказах (их грузит другой склад). */
  otherFarm: number;
}

export interface StockPosition {
  key: string;
  flowerType: string;
  flower: string;
  variety: string;
  grade: string;
  gradeLabel: string;
  qty: number;
}

interface ExtraRow {
  id: number;
  key: string;
  qty: string;
  note: string;
}

const nf = (n: number) => n.toLocaleString("ru-RU");
const digits = (v: string) => v.replace(/[^\d]/g, "").slice(0, 6);

/**
 * «Фуры в регионы» — экран зав. складом (22.11.2026, правила — `truckLoad.ts`). Заказы города на день фуры одной таблицей:
 * сколько просили, сколько лежит на складе, сколько гружу. Чего нет — выбрать причину (позиция закроется, город увидит),
 * замену или свой цветок — добавить строкой. Одна кнопка отгружает всё в город; цветок ляжет на склад города, когда
 * менеджер города подтвердит приёмку.
 */
export default function TruckLoadBoard({
  groups,
  stock,
  positions,
  cities,
  today,
}: {
  groups: LoadGroup[];
  /** Остаток основного склада (свой цветок): ключ → шт. */
  stock: Record<string, number>;
  positions: StockPosition[];
  cities: { code: string; label: string }[];
  today: string;
}) {
  const [flash, setFlash] = useState<string | null>(null);
  const [adhoc, setAdhoc] = useState<{ store: string; day: string } | null>(null);
  const [pickStore, setPickStore] = useState(cities[0]?.code ?? "");
  const [pickDay, setPickDay] = useState(today);

  const days = useMemo(() => {
    const out: { day: string; label: string; late: boolean; groups: LoadGroup[] }[] = [];
    for (const g of groups) {
      let d = out.find((x) => x.day === g.day);
      if (!d) {
        d = { day: g.day, label: g.dayLabel, late: g.late, groups: [] };
        out.push(d);
      }
      d.groups.push(g);
    }
    return out;
  }, [groups]);

  const adhocExisting = adhoc ? groups.find((g) => g.store === adhoc.store && g.day === adhoc.day) : null;
  const adhocCity = cities.find((c) => c.code === adhoc?.store)?.label ?? "";

  return (
    <div className="space-y-6">
      {flash && <div className="text-sm text-[#12733a] bg-status-good/10 rounded-lg px-3 py-2">{flash}</div>}

      {groups.length === 0 && !adhoc && (
        <p className="card text-sm text-ink-secondary">Заказов на фуру от городов сейчас нет. Отгрузить в город без заказа можно ниже.</p>
      )}

      {days.map((d) => (
        <section key={d.day}>
          <h2 className="text-sm font-semibold mb-2 flex flex-wrap items-center gap-2">
            Фура {d.label}
            {d.late && <Pill tone="bad">день фуры прошёл</Pill>}
          </h2>
          <div className="space-y-4">
            {d.groups.map((g) => (
              <Card key={`${g.key}:${g.rows.map((r) => `${r.itemId}-${r.left}`).join(",")}`} group={g} stock={stock} positions={positions} onDone={setFlash} />
            ))}
          </div>
        </section>
      ))}

      {adhoc && !adhocExisting && (
        <section>
          <h2 className="text-sm font-semibold mb-2">Отгрузка без заказа города</h2>
          <Card
            key={`adhoc:${adhoc.store}:${adhoc.day}`}
            group={{ key: `adhoc:${adhoc.store}:${adhoc.day}`, store: adhoc.store, city: adhocCity, day: adhoc.day, dayLabel: "", late: false, byLine: "заказа от города нет — отгрузка от склада", comments: [], rows: [], otherFarm: 0 }}
            stock={stock}
            positions={positions}
            onDone={(m) => {
              setFlash(m);
              setAdhoc(null);
            }}
            onCancel={() => setAdhoc(null)}
            startWithExtra
          />
        </section>
      )}
      {adhoc && adhocExisting && (
        <p className="text-sm text-[#8a5a00] bg-status-warning/15 rounded-lg px-3 py-2">
          На этот день в {adhocCity} уже есть заказ — добавьте свою позицию в его карточке выше («+ Добавить позицию»).
        </p>
      )}

      {!adhoc && (
        <div className="card">
          <div className="font-medium mb-1">Отгрузить в город без заказа</div>
          <p className="text-sm text-ink-secondary mb-3">Если город ничего не заказывал, а цветок едет: выберите город и день, дальше — что грузите.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="label">Город</span>
              <select className="input !w-auto" value={pickStore} onChange={(e) => setPickStore(e.target.value)}>
                {cities.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="label">День фуры</span>
              <input type="date" className="input !w-auto" value={pickDay} onChange={(e) => setPickDay(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-secondary"
              disabled={!pickStore || !pickDay}
              onClick={() => {
                setFlash(null);
                setAdhoc({ store: pickStore, day: pickDay });
              }}
            >
              Выбрать, что грузить
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Card({
  group,
  stock,
  positions,
  onDone,
  onCancel,
  startWithExtra,
}: {
  group: LoadGroup;
  stock: Record<string, number>;
  positions: StockPosition[];
  onDone: (message: string) => void;
  onCancel?: () => void;
  startWithExtra?: boolean;
}) {
  const router = useRouter();
  // По умолчанию грузим всё, что просили и что есть: строки одной позиции делят остаток по порядку.
  const [loads, setLoads] = useState<Record<string, string>>(() => {
    const leftInStock = { ...stock };
    const out: Record<string, string> = {};
    for (const r of group.rows) {
      const take = Math.max(0, Math.min(r.left, leftInStock[r.key] ?? 0));
      leftInStock[r.key] = (leftInStock[r.key] ?? 0) - take;
      out[r.itemId] = String(take);
    }
    return out;
  });
  const [rests, setRests] = useState<Record<string, RestCode>>({});
  const [extras, setExtras] = useState<ExtraRow[]>(startWithExtra ? [{ id: 1, key: "", qty: "", note: "" }] : []);
  const [note, setNote] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const posByKey = useMemo(() => new Map(positions.map((p) => [p.key, p])), [positions]);
  const flowers = useMemo(() => Array.from(new Set(positions.map((p) => p.flower))), [positions]);

  const used: Record<string, number> = {};
  for (const r of group.rows) used[r.key] = (used[r.key] ?? 0) + (Number(loads[r.itemId]) || 0);
  for (const e of extras) if (e.key) used[e.key] = (used[e.key] ?? 0) + (Number(e.qty) || 0);
  const overKeys = Object.keys(used).filter((k) => used[k] > (stock[k] ?? 0));

  const loadTotal = group.rows.reduce((s, r) => s + (Number(loads[r.itemId]) || 0), 0);
  const extraTotal = extras.reduce((s, e) => s + (e.key ? Number(e.qty) || 0 : 0), 0);
  const restOf = (r: LoadRow): RestCode => rests[r.itemId] ?? "none";
  const short = (r: LoadRow) => Math.max(0, r.left - (Number(loads[r.itemId]) || 0));
  const closes = (code: RestCode) => REST_OPTIONS.find((o) => o.code === code)?.closes === true;
  const missing = group.rows.reduce((s, r) => s + (closes(restOf(r)) ? short(r) : 0), 0);
  const later = group.rows.reduce((s, r) => s + (!closes(restOf(r)) ? short(r) : 0), 0);
  const tooMuch = group.rows.some((r) => (Number(loads[r.itemId]) || 0) > r.left);
  const nothing = loadTotal + extraTotal === 0 && missing === 0;
  const blocked = overKeys.length > 0 || tooMuch || nothing;

  function touch() {
    setConfirm(false);
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = unwrapValue(
        await loadTruckAction({
          store: group.store,
          day: group.day,
          // Строку «ничего не гружу, догружу позже» не отправляем: по ней ничего не меняется.
          lines: group.rows
            .map((r) => ({ itemId: r.itemId, load: Number(loads[r.itemId]) || 0, rest: restOf(r) as string }))
            .filter((l, i) => l.load > 0 || (closes(l.rest as RestCode) && group.rows[i].left > 0)),
          extras: extras
            .filter((e) => e.key && Number(e.qty) > 0)
            .map((e) => {
              const p = posByKey.get(e.key)!;
              return { flowerType: p.flowerType, variety: p.variety, grade: p.grade, quantity: Number(e.qty), note: e.note };
            }),
          note,
        })
      );
      onDone(
        `${res.city}: отгружено ${nf(res.total)} шт.${res.added > 0 ? ` (из них ${nf(res.added)} шт. добавлено складом)` : ""}${
          res.closedShort > 0 ? ` Не будет ${nf(res.closedShort)} шт. — город это увидит.` : ""
        } Цветок ляжет на склад города, когда менеджер города подтвердит приёмку.`
      );
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось записать отгрузку");
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 sm:px-5 py-3 border-b border-line-hairline">
        <span className="font-semibold text-[15px]">{group.city}</span>
        <span className="text-xs text-ink-muted">{group.byLine}</span>
        <Link href={`/region/${group.store}/truck`} className="ml-auto text-xs text-accent hover:underline">
          заказы города
        </Link>
      </div>

      {group.comments.length > 0 && (
        <div className="px-4 sm:px-5 py-2.5 text-sm bg-surface-plane border-b border-line-hairline">
          <span className="text-ink-muted">Комментарий города: </span>
          {group.comments.join(" · ")}
        </div>
      )}

      {group.rows.length > 0 && (
        <div>
          <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_6.5rem_17rem] gap-x-3 px-5 py-2 text-xs text-ink-muted border-b border-line-hairline">
            <span>Позиция</span>
            <span className="text-right">Просили</span>
            <span className="text-right">На складе</span>
            <span className="text-right">Гружу</span>
            <span>Остальное</span>
          </div>
          {group.rows.map((r) => {
            const have = stock[r.key] ?? 0;
            const s = short(r);
            const over = overKeys.includes(r.key) && (Number(loads[r.itemId]) || 0) > 0;
            const more = (Number(loads[r.itemId]) || 0) > r.left;
            return (
              <div key={r.itemId} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_6.5rem_17rem] gap-x-3 gap-y-2 items-center px-4 sm:px-5 py-2.5 border-b border-line-hairline text-sm">
                <div className="col-span-2 sm:col-span-1 min-w-0">
                  <div className="font-medium">
                    <span className="text-ink-muted font-normal">{r.flower}</span> {r.name}
                  </div>
                  <div className="text-xs text-ink-muted">
                    {r.shop ? "в наши магазины" : "на склад города"} · № {r.code}
                    {r.shipped > 0 && ` · уже отгружено ${nf(r.shipped)} из ${nf(r.asked)}`}
                  </div>
                </div>
                <div className="sm:text-right tabular-nums">
                  <span className="sm:hidden text-xs text-ink-muted">Просили: </span>
                  {nf(r.left)}
                </div>
                <div className={clsx("sm:text-right tabular-nums", have === 0 && "text-status-critical", have > 0 && have < r.left && "text-[#8a5a00]")}>
                  <span className="sm:hidden text-xs text-ink-muted">На складе: </span>
                  {have > 0 ? nf(have) : "нет"}
                </div>
                <label className="sm:text-right">
                  <span className="sm:hidden text-xs text-ink-muted">Гружу: </span>
                  <input
                    className={clsx("input !w-24 text-right tabular-nums", (over || more) && "!border-status-critical")}
                    inputMode="numeric"
                    aria-label={`Гружу: ${r.name}`}
                    value={loads[r.itemId] ?? ""}
                    onChange={(e) => {
                      touch();
                      setLoads((p) => ({ ...p, [r.itemId]: digits(e.target.value) }));
                    }}
                  />
                </label>
                <div className="min-w-0">
                  {s > 0 ? (
                    <label className="flex items-center gap-2">
                      <span className="text-xs text-ink-muted whitespace-nowrap">ещё {nf(s)} —</span>
                      <select
                        className="input !py-1.5 text-sm min-w-0"
                        aria-label={`Что с остальным: ${r.name}`}
                        value={restOf(r)}
                        onChange={(e) => {
                          touch();
                          setRests((p) => ({ ...p, [r.itemId]: e.target.value as RestCode }));
                        }}
                      >
                        {REST_OPTIONS.map((o) => (
                          <option key={o.code} value={o.code}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <span className="text-xs text-[#12733a]">всё, что просили</span>
                  )}
                </div>
                {(over || more) && (
                  <div className="col-span-2 sm:col-span-5 text-xs text-status-critical">
                    {more ? `Просили ${nf(r.left)} шт. — больше добавьте отдельной позицией ниже.` : `На складе ${nf(have)} шт., а по этой позиции гружу ${nf(used[r.key])}.`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {group.otherFarm > 0 && (
        <div className="px-4 sm:px-5 py-2 text-xs text-ink-muted border-b border-line-hairline">
          Ещё позиций другого производства в этих заказах: {group.otherFarm} — их грузит другой склад.
        </div>
      )}

      {extras.length > 0 && (
        <div className="px-4 sm:px-5 py-3 border-b border-line-hairline space-y-3">
          <div className="text-xs text-ink-muted">{group.rows.length > 0 ? "Добавляю от склада (замена или свой цветок)" : "Что грузите"}</div>
          {extras.map((e) => {
            const p = posByKey.get(e.key);
            const have = p ? stock[p.key] ?? 0 : 0;
            const over = !!p && overKeys.includes(p.key);
            return (
              <div key={e.id} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1.6fr)_7rem_minmax(0,1fr)_auto] gap-2 items-end">
                <label className="text-sm col-span-2 sm:col-span-1">
                  <span className="label">Позиция со склада</span>
                  <select
                    className="input"
                    value={e.key}
                    onChange={(ev) => {
                      touch();
                      setExtras((prev) => prev.map((x) => (x.id === e.id ? { ...x, key: ev.target.value } : x)));
                    }}
                  >
                    <option value="">— выберите —</option>
                    {flowers.map((f) => (
                      <optgroup key={f} label={f}>
                        {positions
                          .filter((x) => x.flower === f)
                          .map((x) => (
                            <option key={x.key} value={x.key}>
                              {x.variety} · {x.gradeLabel} — {nf(x.qty)} шт.
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="label">Гружу, шт</span>
                  <input
                    className={clsx("input text-right tabular-nums", over && "!border-status-critical")}
                    inputMode="numeric"
                    value={e.qty}
                    placeholder="0"
                    onChange={(ev) => {
                      touch();
                      setExtras((prev) => prev.map((x) => (x.id === e.id ? { ...x, qty: digits(ev.target.value) } : x)));
                    }}
                  />
                </label>
                <label className="text-sm">
                  <span className="label">Пояснение городу</span>
                  <input
                    className="input"
                    value={e.note}
                    maxLength={120}
                    placeholder="например: вместо Altaj Вторая"
                    onChange={(ev) => setExtras((prev) => prev.map((x) => (x.id === e.id ? { ...x, note: ev.target.value } : x)))}
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary !py-2 text-sm justify-self-start"
                  aria-label="Убрать позицию"
                  title="Убрать позицию"
                  onClick={() => {
                    touch();
                    setExtras((prev) => prev.filter((x) => x.id !== e.id));
                  }}
                >
                  ×
                </button>
                {over && p && (
                  <div className="col-span-2 sm:col-span-4 text-xs text-status-critical">
                    На складе {nf(have)} шт., а всего по этой позиции гружу {nf(used[p.key])}.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="px-4 sm:px-5 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary !py-1.5 text-sm"
            onClick={() => {
              touch();
              setExtras((prev) => [...prev, { id: (prev[prev.length - 1]?.id ?? 0) + 1, key: "", qty: "", note: "" }]);
            }}
          >
            + Добавить позицию
          </button>
          <span className="text-xs text-ink-muted">замена того, чего нет, или свой цветок сверх заказа</span>
        </div>

        <label className="block text-sm">
          <span className="label">Комментарий городу (необязательно)</span>
          <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="Например: розу догружу во вторник" />
        </label>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span>
            Гружу: <b className="font-semibold tabular-nums">{nf(loadTotal + extraTotal)}</b> шт.
          </span>
          {extraTotal > 0 && <span className="text-ink-secondary">из них от склада: {nf(extraTotal)}</span>}
          {missing > 0 && <span className="text-status-critical">не будет: {nf(missing)} шт.</span>}
          {later > 0 && <span className="text-[#8a5a00]">догружу позже: {nf(later)} шт.</span>}
        </div>

        {error && <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>}

        {confirm ? (
          <div className="flex flex-wrap items-center gap-2 bg-accent-soft/50 rounded-lg px-3 py-2.5">
            <span className="text-sm mr-auto">
              Отгрузить в {storeInto(group.store)} <b className="font-semibold">{nf(loadTotal + extraTotal)} шт.</b>
              {missing > 0 && <> и закрыть {nf(missing)} шт. как «не будет»</>}? Со склада это спишется сразу.
            </span>
            <button type="button" className="btn-primary disabled:opacity-50" disabled={busy} onClick={submit}>
              {busy ? "Записываю…" : "Да, отгрузить"}
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirm(false)}>
              Нет
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary disabled:opacity-50" disabled={blocked} onClick={() => setConfirm(true)}>
              {loadTotal + extraTotal > 0 ? `Отгрузить в ${storeInto(group.store)}: ${nf(loadTotal + extraTotal)} шт.` : missing > 0 ? "Ответить городу: этого нет" : `Отгрузить в ${storeInto(group.store)}`}
            </button>
            {onCancel && (
              <button type="button" className="btn-secondary" onClick={onCancel}>
                Отмена
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
