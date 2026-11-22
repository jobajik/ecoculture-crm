"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { createTruckOrderAction } from "@/app/region/actions";
import { FLOWER_TYPES, formatGrade, getGradesFor, flowerPickLabel, type FlowerType } from "@/lib/constants";
import { unwrapValue } from "@/lib/actionResult";

export interface TruckCatalogRow {
  key: string;
  flowerType: string;
  flower: string;
  variety: string;
  grade: string;
  gradeLabel: string;
  /** На производстве (основной склад) сейчас. */
  main: number;
  /** На складе города сейчас. */
  city: number;
  /** Уже заказано на фуру или едет и ещё не принято. */
  coming: number;
  /** Не хватает под заявки клиентов города. */
  need: number;
}

interface CustomRow {
  flowerType: FlowerType;
  variety: string;
  grade: string;
  wholesale: string;
  retail: string;
}

const FLOWERS = Object.values(FLOWER_TYPES) as FlowerType[];
const digits = (v: string) => v.replace(/[^\d]/g, "").slice(0, 6);
const nf = (n: number) => n.toLocaleString("ru-RU");

function emptyCustom(varieties: Record<string, string[]>, flower: FlowerType = FLOWERS[0]): CustomRow {
  return { flowerType: flower, variety: varieties[flower]?.[0] ?? "", grade: getGradesFor(flower)[0] ?? "", wholesale: "", retail: "" };
}

/**
 * Заказ на фуру от города (17.11.2026; с 22.11.2026 — списком, `regionTruck.ts`). Менеджер города видит всё, что сейчас
 * лежит на производстве, рядом — сколько этой позиции в городе и сколько уже едет, и просто вписывает количество:
 * «на опт» — ляжет на склад города после приёмки, «в магазины» — в наши магазины города. Чего в списке нет (срежут к дню
 * фуры) — добавляется строкой ниже. Заказ уходит складу; склад ответит по каждой позиции: гружу, нет или замена.
 */
export default function TruckOrderForm({
  store,
  city,
  initialDate,
  minDate,
  truckDayLabel,
  varieties,
  retailCard,
  catalog,
}: {
  store: string;
  city: string;
  initialDate: string;
  minDate: string;
  /** «понедельник, 23.11» — ближайшая фура. */
  truckDayLabel: string;
  varieties: Record<string, string[]>;
  /** Название карточки наших магазинов города; пусто — магазинов в городе нет, колонки «в магазины» нет. */
  retailCard: string;
  catalog: TruckCatalogRow[];
}) {
  const router = useRouter();
  const [deliveryDate, setDeliveryDate] = useState(initialDate);
  const [qty, setQty] = useState<Record<string, { w: string; r: string }>>({});
  const [custom, setCustom] = useState<CustomRow[]>([]);
  const [flower, setFlower] = useState("");
  const [search, setSearch] = useState("");
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const flowers = useMemo(() => Array.from(new Map(catalog.map((c) => [c.flowerType, c.flower])).entries()), [catalog]);
  const needRows = catalog.filter((c) => c.need > 0);
  const w = (key: string) => Number(qty[key]?.w) || 0;
  const r = (key: string) => (retailCard ? Number(qty[key]?.r) || 0 : 0);

  const shown = catalog.filter((c) => {
    if (flower && c.flowerType !== flower) return false;
    if (onlyFilled && w(c.key) + r(c.key) === 0) return false;
    const q = search.trim().toLowerCase();
    return !q || `${c.variety} ${c.gradeLabel} ${c.flower}`.toLowerCase().includes(q);
  });

  const wholesale = catalog.reduce((s, c) => s + w(c.key), 0) + custom.reduce((s, c) => s + (Number(c.wholesale) || 0), 0);
  const retail = catalog.reduce((s, c) => s + r(c.key), 0) + custom.reduce((s, c) => s + (retailCard ? Number(c.retail) || 0 : 0), 0);
  const positions = catalog.filter((c) => w(c.key) + r(c.key) > 0).length + custom.filter((c) => (Number(c.wholesale) || 0) + (retailCard ? Number(c.retail) || 0 : 0) > 0).length;

  function set(key: string, patch: Partial<{ w: string; r: string }>) {
    setQty((prev) => ({ ...prev, [key]: { w: prev[key]?.w ?? "", r: prev[key]?.r ?? "", ...patch } }));
  }

  function updateCustom(idx: number, patch: Partial<CustomRow>) {
    setCustom((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const next = { ...row, ...patch };
        // Сменили цветок — сорт и длина от прежнего не подходят.
        if (patch.flowerType && patch.flowerType !== row.flowerType) {
          next.variety = varieties[patch.flowerType]?.[0] ?? "";
          next.grade = getGradesFor(patch.flowerType)[0] ?? "";
        }
        return next;
      })
    );
  }

  /** Вписать то, чего не хватает под заявки клиентов (не уменьшая уже вписанное). */
  function fillNeed() {
    setQty((prev) => {
      const next = { ...prev };
      for (const c of needRows) {
        const have = Number(prev[c.key]?.w) || 0;
        if (have < c.need) next[c.key] = { w: String(c.need), r: prev[c.key]?.r ?? "" };
      }
      return next;
    });
    setOnlyFilled(false);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!deliveryDate) return setError("Укажите день, когда уходит фура");
    const lines = [
      ...catalog.map((c) => ({ flowerType: c.flowerType, variety: c.variety, grade: c.grade, wholesale: w(c.key), retail: r(c.key) })),
      ...custom.map((c) => ({ flowerType: c.flowerType as string, variety: c.variety.trim(), grade: c.grade, wholesale: Number(c.wholesale) || 0, retail: retailCard ? Number(c.retail) || 0 : 0 })),
    ].filter((l) => l.wholesale + l.retail > 0);
    if (lines.length === 0) return setError("Впишите количество хотя бы по одной позиции");
    setBusy(true);
    try {
      unwrapValue(await createTruckOrderAction({ store, deliveryDate, lines, note }));
      router.push(`/region/${store}/truck?sent=1`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить заказ");
      setBusy(false);
    }
  }

  const cols = retailCard ? "sm:grid-cols-[minmax(0,1fr)_5rem_6.5rem_6.5rem_6.5rem]" : "sm:grid-cols-[minmax(0,1fr)_5rem_6.5rem_6.5rem]";
  let lastFlower = "";

  return (
    <form onSubmit={submit} className="max-w-5xl space-y-5 pb-24 sm:pb-0">
      <div className="card flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="mr-auto">
          <div className="label">Куда</div>
          <div className="font-medium text-lg">{city}</div>
        </div>
        <label className="text-sm">
          <span className="label">День фуры</span>
          <input type="date" className="input !w-auto" value={deliveryDate} min={minDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          <span className="block text-xs text-ink-muted mt-1">ближайшая — {truckDayLabel}</span>
        </label>
      </div>

      {needRows.length > 0 && (
        <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 border-status-warning/40 bg-status-warning/10">
          <div className="text-sm mr-auto">
            <b className="font-semibold">Под заявки клиентов не хватает {nf(needRows.reduce((s, c) => s + c.need, 0))} шт.</b>{" "}
            <span className="text-ink-secondary">
              Позиций: {needRows.length}. Это то, что уже продано со склада города, но на складе и в пути этого нет.
            </span>
          </div>
          <button type="button" className="btn-secondary" onClick={fillNeed}>
            Вписать в заказ
          </button>
        </div>
      )}

      <div className="card !p-0 overflow-hidden">
        <div className="px-4 sm:px-5 py-3 border-b border-line-hairline space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-medium mr-auto">Что прислать</h2>
            <input className="input !w-44 !py-1.5 text-sm" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Найти сорт" aria-label="Найти сорт" />
          </div>
          <div className="flex gap-2 overflow-x-auto scroll-x-hidden -mx-1 px-1">
            {[["", "Все"] as [string, string], ...flowers].map(([code, label]) => (
              <button
                key={code || "all"}
                type="button"
                onClick={() => setFlower(code)}
                className={clsx(
                  "h-8 px-3 rounded-lg border text-[13px] whitespace-nowrap flex-none transition-colors",
                  flower === code ? "bg-accent-soft text-accent border-accent/25 font-medium" : "bg-surface border-line-hairline text-ink-secondary hover:text-ink-primary"
                )}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setOnlyFilled((v) => !v)}
              className={clsx(
                "h-8 px-3 rounded-lg border text-[13px] whitespace-nowrap flex-none transition-colors ml-auto",
                onlyFilled ? "bg-accent-soft text-accent border-accent/25 font-medium" : "bg-surface border-line-hairline text-ink-secondary hover:text-ink-primary"
              )}
            >
              Только выбранное{positions > 0 ? ` · ${positions}` : ""}
            </button>
          </div>
        </div>

        <div className={clsx("hidden sm:grid gap-x-3 px-5 py-2 text-xs text-ink-muted border-b border-line-hairline", cols)}>
          <span>Позиция</span>
          <span className="text-right">В городе</span>
          <span className="text-right">На производстве</span>
          <span className="text-right">На опт, шт</span>
          {retailCard && <span className="text-right">В магазины, шт</span>}
        </div>

        {shown.length === 0 && <div className="px-4 sm:px-5 py-6 text-sm text-ink-secondary">{catalog.length === 0 ? "На производстве сейчас пусто — добавьте позицию вручную ниже." : "Ничего не найдено."}</div>}

        {shown.map((c) => {
          const head = c.flower !== lastFlower;
          lastFlower = c.flower;
          const want = w(c.key) + r(c.key);
          const more = want > c.main;
          return (
            <div key={c.key}>
              {head && <div className="px-4 sm:px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted bg-surface-plane border-b border-line-hairline">{c.flower}</div>}
              <div className={clsx("grid grid-cols-2 gap-x-3 gap-y-2 items-center px-4 sm:px-5 py-2.5 border-b border-line-hairline text-sm", cols, want > 0 && "bg-accent-soft/30")}>
                <div className="col-span-2 sm:col-span-1 min-w-0">
                  <div className="font-medium">
                    {c.variety} <span className="text-ink-secondary font-normal">· {c.gradeLabel}</span>
                  </div>
                  {(c.coming > 0 || c.need > 0) && (
                    <div className="text-xs mt-0.5 flex flex-wrap gap-x-3">
                      {c.coming > 0 && <span className="text-ink-muted">уже заказано или едет: {nf(c.coming)}</span>}
                      {c.need > 0 && <span className="text-[#8a5a00]">под заявки не хватает: {nf(c.need)}</span>}
                    </div>
                  )}
                </div>
                <div className="sm:text-right tabular-nums">
                  <span className="sm:hidden text-xs text-ink-muted">В городе: </span>
                  {c.city > 0 ? nf(c.city) : <span className="text-ink-muted">нет</span>}
                </div>
                <div className="sm:text-right tabular-nums">
                  <span className="sm:hidden text-xs text-ink-muted">На производстве: </span>
                  {c.main > 0 ? nf(c.main) : <span className="text-ink-muted">нет</span>}
                </div>
                <label className="sm:text-right">
                  <span className="sm:hidden text-xs text-ink-muted">На опт: </span>
                  <input className="input !w-24 text-right tabular-nums" inputMode="numeric" aria-label={`На опт: ${c.variety} ${c.gradeLabel}`} value={qty[c.key]?.w ?? ""} placeholder="0" onChange={(e) => set(c.key, { w: digits(e.target.value) })} />
                </label>
                {retailCard && (
                  <label className="sm:text-right">
                    <span className="sm:hidden text-xs text-ink-muted">В магазины: </span>
                    <input className="input !w-24 text-right tabular-nums" inputMode="numeric" aria-label={`В магазины: ${c.variety} ${c.gradeLabel}`} value={qty[c.key]?.r ?? ""} placeholder="0" onChange={(e) => set(c.key, { r: digits(e.target.value) })} />
                  </label>
                )}
                {more && (
                  <div className={clsx("col-span-2 text-xs text-[#8a5a00]", retailCard ? "sm:col-span-5" : "sm:col-span-4")}>
                    На производстве сейчас {c.main > 0 ? `${nf(c.main)} шт.` : "этой позиции нет"} — склад отгрузит, сколько будет к дню фуры, и ответит по остальному.
                  </div>
                )}
              </div>
            </div>
          );
        })}

        <div className="px-4 sm:px-5 py-3 space-y-3">
          {custom.map((row, idx) => (
            <div key={idx} className={clsx("grid grid-cols-2 gap-2 items-end", retailCard ? "sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_6.5rem_6.5rem_auto]" : "sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_6.5rem_auto]")}>
              <label className="text-sm">
                <span className="label">Цветок</span>
                <select className="input" value={row.flowerType} onChange={(e) => updateCustom(idx, { flowerType: e.target.value as FlowerType })}>
                  {FLOWERS.map((t) => (
                    <option key={t} value={t}>
                      {flowerPickLabel(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="label">Сорт</span>
                <select className="input" value={row.variety} onChange={(e) => updateCustom(idx, { variety: e.target.value })}>
                  {(varieties[row.flowerType] ?? []).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="label">Длина / категория</span>
                <select className="input" value={row.grade} onChange={(e) => updateCustom(idx, { grade: e.target.value })}>
                  {getGradesFor(row.flowerType).map((g) => (
                    <option key={g} value={g}>
                      {formatGrade(g)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="label">На опт, шт</span>
                <input className="input text-right tabular-nums" inputMode="numeric" value={row.wholesale} onChange={(e) => updateCustom(idx, { wholesale: digits(e.target.value) })} placeholder="0" />
              </label>
              {retailCard && (
                <label className="text-sm">
                  <span className="label">В магазины, шт</span>
                  <input className="input text-right tabular-nums" inputMode="numeric" value={row.retail} onChange={(e) => updateCustom(idx, { retail: digits(e.target.value) })} placeholder="0" />
                </label>
              )}
              <button type="button" onClick={() => setCustom((prev) => prev.filter((_, i) => i !== idx))} className="btn-secondary !py-2 text-sm justify-self-start" aria-label="Убрать позицию" title="Убрать позицию">
                ×
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setCustom((prev) => [...prev, emptyCustom(varieties, prev[prev.length - 1]?.flowerType)])} className="btn-secondary !py-1.5 text-sm">
              + Позиция, которой нет в списке
            </button>
            <span className="text-xs text-ink-muted">если нужного сорта на производстве сейчас нет, но его срежут к дню фуры</span>
          </div>
        </div>
      </div>

      <label className="card block text-sm">
        <span className="label">Комментарий складу (необязательно)</span>
        <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Например: розу — только свежей срезки" />
      </label>

      <p className="text-xs text-ink-muted">
        «На опт» — цветок ляжет на склад города после того, как вы подтвердите приёмку фуры.{" "}
        {retailCard ? `«В магазины» — уйдёт заявкой на «${retailCard}».` : "Наших магазинов в этом городе в CRM нет — заказ только на опт."} Склад увидит заказ сразу и ответит по каждой позиции: гружу, нет на складе
        или замена.
      </p>

      {error && <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>}

      <div className="fixed sm:static inset-x-0 bottom-0 z-20 bg-surface sm:bg-transparent border-t sm:border-0 border-line-hairline px-4 py-3 sm:p-0 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm mr-auto sm:mr-0 sm:order-2">
          Всего: <b className="font-semibold tabular-nums">{nf(wholesale + retail)}</b> шт.
          <span className="text-ink-secondary">
            {" "}
            · позиций: {positions}
            {retailCard && retail > 0 ? ` · в магазины ${nf(retail)}` : ""}
          </span>
        </span>
        <button type="submit" disabled={busy || wholesale + retail === 0} className="btn-primary disabled:opacity-50 sm:order-1">
          {busy ? "Отправляю…" : "Отправить заказ складу"}
        </button>
        <button type="button" className="btn-secondary hidden sm:inline-flex sm:order-3" onClick={() => router.push(`/region/${store}/truck`)}>
          Отмена
        </button>
      </div>
    </form>
  );
}
