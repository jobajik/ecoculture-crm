"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createTruckOrderAction } from "@/app/region/actions";
import { FLOWER_TYPES, formatGrade, getGradesFor, flowerPickLabel, type FlowerType } from "@/lib/constants";
import { unwrapValue } from "@/lib/actionResult";

interface Row {
  flowerType: FlowerType;
  variety: string;
  grade: string;
  wholesale: string;
  retail: string;
}

const FLOWERS = Object.values(FLOWER_TYPES) as FlowerType[];

function emptyRow(varieties: Record<string, string[]>, flower: FlowerType = FLOWERS[0]): Row {
  return { flowerType: flower, variety: varieties[flower]?.[0] ?? "", grade: getGradesFor(flower)[0] ?? "", wholesale: "", retail: "" };
}

const digits = (v: string) => v.replace(/[^\d]/g, "").slice(0, 6);

/**
 * Заказ на фуру от региона (17.11.2026, `regionTruck.ts`). Директор пишет, чего и сколько прислать: «на опт» — ляжет на
 * склад города после приёмки, «в магазины» — в наши магазины города. На деле уходит двумя привычными складу заявками —
 * обе сразу подтверждены, цен директор не ставит. Под строкой — сколько этой позиции сейчас лежит в городе.
 */
export default function TruckOrderForm({
  store,
  city,
  initialDate,
  minDate,
  truckDayLabel,
  varieties,
  retailCard,
  cityStock,
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
  /** Остаток склада города: «цветок|сорт|длина» → шт. */
  cityStock: Record<string, number>;
}) {
  const router = useRouter();
  const [deliveryDate, setDeliveryDate] = useState(initialDate);
  const [rows, setRows] = useState<Row[]>([emptyRow(varieties)]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sum = (pick: (r: Row) => string) => rows.reduce((s, r) => s + (Number(pick(r)) || 0), 0);
  const wholesale = sum((r) => r.wholesale);
  const retail = sum((r) => r.retail);

  function update(idx: number, patch: Partial<Row>) {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, ...patch };
        // Сменили цветок — сорт и длина от прежнего не подходят.
        if (patch.flowerType && patch.flowerType !== r.flowerType) {
          next.variety = varieties[patch.flowerType]?.[0] ?? "";
          next.grade = getGradesFor(patch.flowerType)[0] ?? "";
        }
        return next;
      })
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!deliveryDate) return setError("Укажите день, когда уходит фура");
    const lines = rows
      .map((r) => ({ flowerType: r.flowerType, variety: r.variety.trim(), grade: r.grade, wholesale: Number(r.wholesale) || 0, retail: retailCard ? Number(r.retail) || 0 : 0 }))
      .filter((l) => l.wholesale + l.retail > 0);
    if (lines.length === 0) return setError("Укажите количество хотя бы по одной позиции");
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

  return (
    <form onSubmit={submit} className="max-w-5xl space-y-5">
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

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="font-medium">Что прислать</h2>
          <button type="button" onClick={() => setRows((prev) => [...prev, emptyRow(varieties, prev[prev.length - 1]?.flowerType)])} className="btn-secondary !py-1.5 text-sm">
            + Добавить позицию
          </button>
        </div>

        <div className="space-y-4 sm:space-y-3">
          {rows.map((row, idx) => {
            const inCity = cityStock[`${row.flowerType}|${row.variety}|${row.grade}`] ?? 0;
            return (
              <div key={idx} className="border-b border-line-hairline last:border-b-0 pb-4 sm:pb-3 last:pb-0">
                <div
                  className={
                    retailCard
                      ? "grid grid-cols-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.7fr)_auto] gap-2 items-end"
                      : "grid grid-cols-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_auto] gap-2 items-end"
                  }
                >
                  <label className="text-sm">
                    <span className="label">Цветок</span>
                    <select className="input" value={row.flowerType} onChange={(e) => update(idx, { flowerType: e.target.value as FlowerType })}>
                      {FLOWERS.map((t) => (
                        <option key={t} value={t}>
                          {flowerPickLabel(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="label">Сорт</span>
                    <select className="input" value={row.variety} onChange={(e) => update(idx, { variety: e.target.value })}>
                      {(varieties[row.flowerType] ?? []).map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="label">Длина / категория</span>
                    <select className="input" value={row.grade} onChange={(e) => update(idx, { grade: e.target.value })}>
                      {getGradesFor(row.flowerType).map((g) => (
                        <option key={g} value={g}>
                          {formatGrade(g)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="label">На опт, шт</span>
                    <input className="input" inputMode="numeric" value={row.wholesale} onChange={(e) => update(idx, { wholesale: digits(e.target.value) })} placeholder="0" />
                  </label>
                  {retailCard && (
                    <label className="text-sm">
                      <span className="label">В магазины, шт</span>
                      <input className="input" inputMode="numeric" value={row.retail} onChange={(e) => update(idx, { retail: digits(e.target.value) })} placeholder="0" />
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={rows.length === 1}
                    className="btn-secondary !py-2 text-sm disabled:opacity-30 justify-self-start sm:justify-self-auto"
                    aria-label="Убрать позицию"
                    title="Убрать позицию"
                  >
                    ×
                  </button>
                </div>
                <div className="text-xs text-ink-muted mt-1.5">{inCity > 0 ? `Сейчас в городе: ${inCity.toLocaleString("ru-RU")} шт.` : "Сейчас в городе этой позиции нет"}</div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 mt-4 text-sm">
          <span>
            На опт: <b className="font-semibold tabular-nums">{wholesale.toLocaleString("ru-RU")}</b> шт.
          </span>
          {retailCard && (
            <span>
              В магазины: <b className="font-semibold tabular-nums">{retail.toLocaleString("ru-RU")}</b> шт.
            </span>
          )}
          <span>
            Всего: <b className="font-semibold tabular-nums">{(wholesale + retail).toLocaleString("ru-RU")}</b> шт.
          </span>
        </div>
      </div>

      <label className="card block text-sm">
        <span className="label">Комментарий складу (необязательно)</span>
        <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Например: розу — только свежей срезки" />
      </label>

      <p className="text-xs text-ink-muted">
        «На опт» — цветок ляжет на склад города после того, как вы подтвердите приёмку фуры.{" "}
        {retailCard ? `«В магазины» — уйдёт заявкой на «${retailCard}».` : "Наших магазинов в этом городе в CRM нет — заказ только на опт."} Склад увидит заказ сразу и загрузит фуру.
      </p>

      {error && <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="btn-primary disabled:opacity-50">
          {busy ? "Отправляю…" : "Отправить заказ складу"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => router.push(`/region/${store}/truck`)}>
          Отмена
        </button>
      </div>
    </form>
  );
}
