"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createRubShipmentAction } from "@/app/orders/actions";
import { unwrapValue } from "@/lib/actionResult";
import { formatRub } from "@/lib/rubShipment";

export interface RubFormClient {
  clientId: string;
  name: string;
  city: string;
  /** Город клиента — направление «РФ»: такие в списке первыми. */
  rf: boolean;
}

export interface RubFormBatch {
  batchId: string;
  /** Готовая подпись: «Роза Jumilia · 60 см». */
  title: string;
  /** День срезки словами — партии одного сорта различаются им. */
  cut: string;
  quantityRemaining: number;
}

interface DraftRow {
  batchId: string;
  quantity: string;
  priceRub: string;
}

const num = (value: string) => Number(String(value).replace(",", ".").replace(/\s/g, ""));

/**
 * Отгрузка в РФ с ценами в рублях — заявка и отгрузка одним шагом (13.11.2026). Зав. складом выбирает клиента, день
 * и партии, которые реально уехали; количество и цену в рублях вписывает руками. Проверяет всё сервер
 * (`rubShipmentRefusal`) — здесь только подсказки.
 */
export default function RubShipmentForm({ clients, batches, today }: { clients: RubFormClient[]; batches: RubFormBatch[]; today: string }) {
  const router = useRouter();
  const [clientId, setClientId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(today);
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<DraftRow[]>([{ batchId: "", quantity: "", priceRub: "" }]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const byId = useMemo(() => new Map(batches.map((b) => [b.batchId, b])), [batches]);
  const rf = clients.filter((c) => c.rf);
  const rest = clients.filter((c) => !c.rf);

  function update(idx: number, patch: Partial<DraftRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  const filled = rows.filter((r) => r.batchId && num(r.quantity) > 0);
  const stems = filled.reduce((s, r) => s + num(r.quantity), 0);
  const total = filled.reduce((s, r) => s + num(r.quantity) * (num(r.priceRub) || 0), 0);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!clientId) return setError("Выберите клиента");
    if (!deliveryDate) return setError("Укажите дату отгрузки");
    if (filled.length === 0) return setError("Выберите партию и укажите количество");
    for (const r of filled) {
      const b = byId.get(r.batchId);
      if (!(num(r.priceRub) > 0)) return setError(`${b?.title ?? "Позиция"}: укажите цену в рублях`);
    }
    setSubmitting(true);
    try {
      const orderId = unwrapValue(
        await createRubShipmentAction({
          clientId,
          deliveryDate,
          note,
          lines: filled.map((r) => ({ batchId: r.batchId, quantity: num(r.quantity), priceRub: num(r.priceRub) })),
        })
      );
      router.push(`/orders/${orderId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось записать отгрузку");
      setSubmitting(false);
    }
  }

  if (batches.length === 0) {
    return <div className="card max-w-3xl text-sm text-ink-secondary">На основном складе нет партий с остатком — отгружать нечего.</div>;
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-6">
      <div className="card grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
        <label className="text-sm">
          <span className="label">Клиент (из базы)</span>
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— выберите —</option>
            {rf.length > 0 && (
              <optgroup label="Клиенты из РФ">
                {rf.map((c) => (
                  <option key={c.clientId} value={c.clientId}>
                    {c.name}
                    {c.city ? ` · ${c.city}` : ""}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={rf.length > 0 ? "Остальные клиенты" : "Клиенты"}>
              {rest.map((c) => (
                <option key={c.clientId} value={c.clientId}>
                  {c.name}
                  {c.city ? ` · ${c.city}` : ""}
                </option>
              ))}
            </optgroup>
          </select>
          <span className="mt-1 block text-xs text-ink-muted">Нет нужного покупателя — попросите менеджера или администратора завести карточку.</span>
        </label>
        <label className="text-sm">
          <span className="label">Дата отгрузки</span>
          <input type="date" className="input !w-auto" value={deliveryDate} max={today} onChange={(e) => setDeliveryDate(e.target.value)} />
        </label>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-3 gap-3">
          <div>
            <h2 className="font-medium">Что отгрузили</h2>
            <p className="text-xs text-ink-muted mt-0.5">Партии со склада, количество по факту и цена за стебель в рублях.</p>
          </div>
          <button type="button" onClick={() => setRows((prev) => [...prev, { batchId: "", quantity: "", priceRub: "" }])} className="btn-secondary !py-1.5 text-sm flex-none">
            + Партия
          </button>
        </div>

        <div className="space-y-3">
          {rows.map((row, idx) => {
            const batch = byId.get(row.batchId);
            const qty = num(row.quantity);
            const over = batch && qty > batch.quantityRemaining;
            return (
              <div key={idx} className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,2.2fr)_0.8fr_0.8fr_0.9fr_auto] gap-2 items-end">
                <label className="text-sm min-w-0">
                  <span className="label">Партия</span>
                  <select className="input" value={row.batchId} onChange={(e) => update(idx, { batchId: e.target.value })}>
                    <option value="">— выберите —</option>
                    {batches.map((b) => (
                      <option key={b.batchId} value={b.batchId}>
                        {b.title} — срез {b.cut} — {b.quantityRemaining.toLocaleString("ru-RU")} шт.
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="label">Количество</span>
                  <input className={`input ${over ? "!border-status-critical" : ""}`} inputMode="numeric" value={row.quantity} onChange={(e) => update(idx, { quantity: e.target.value })} placeholder="шт." />
                </label>
                <label className="text-sm">
                  <span className="label">Цена, ₽</span>
                  <input className="input" inputMode="decimal" value={row.priceRub} onChange={(e) => update(idx, { priceRub: e.target.value })} placeholder="₽ за шт." />
                </label>
                <div className="text-sm">
                  <span className="label">Сумма</span>
                  <div className="py-2 tabular-nums font-medium">{qty > 0 && num(row.priceRub) > 0 ? formatRub(qty * num(row.priceRub)) : "—"}</div>
                </div>
                <button type="button" onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev))} className="btn-ghost !py-2 text-sm" disabled={rows.length === 1} aria-label="Убрать строку">
                  Убрать
                </button>
                {batch && (
                  <p className={`sm:col-span-5 -mt-1 text-xs ${over ? "text-status-critical" : "text-ink-muted"}`}>
                    {batch.title} · срез {batch.cut} · в партии {batch.quantityRemaining.toLocaleString("ru-RU")} шт.
                    {over ? " — отмечено больше, чем есть" : ""}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 pt-4 border-t border-line-hairline flex flex-wrap items-baseline justify-between gap-3">
          <span className="text-sm text-ink-secondary">Итого: {stems.toLocaleString("ru-RU")} шт.</span>
          <span className="font-display text-lg font-extrabold tabular-nums">{formatRub(total)}</span>
        </div>
      </div>

      <div className="card">
        <label className="text-sm block">
          <span className="label">Комментарий (необязательно)</span>
          <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Например: машина, кто забрал" />
        </label>
        <p className="mt-3 text-xs text-ink-muted">
          После нажатия заявка появится в «Заявках» уже отгруженной, остатки партий уменьшатся. В тенговую выручку рубли не идут — сколько тенге поступило, вписывает бухгалтер на заявке.
        </p>
      </div>

      {error && <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? "Записываю…" : "Записать отгрузку"}
        </button>
      </div>
    </form>
  );
}
