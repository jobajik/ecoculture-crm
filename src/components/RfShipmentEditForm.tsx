"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cancelRfShipmentAction, updateRfShipmentAction } from "@/app/orders/actions";
import { unwrap, unwrapValue } from "@/lib/actionResult";
import { formatRub } from "@/lib/rubShipment";
import type { RubFormBatch, RubFormClient } from "@/components/RubShipmentForm";

export interface RfEditItem {
  itemId: string;
  /** Готовая подпись: «Хризантема Altaj · Вторая». */
  title: string;
  quantity: number;
  shipped: number;
  priceRub: number;
}

interface ItemDraft {
  quantity: string;
  priceRub: string;
}

interface AddRow {
  batchId: string;
  quantity: string;
  priceRub: string;
}

const num = (value: string) => Number(String(value).replace(",", ".").replace(/\s/g, ""));
const nf = (n: number) => n.toLocaleString("ru-RU");

/**
 * Правка отгрузки в РФ (16.11.2026, правила — `rfEdit.ts`). Меняются день, клиент, комментарий и цена в рублях;
 * количество — только вниз (лишнее возвращается в партии, из которых уехало); больше цветка — строкой из партии.
 * Отдельно — отмена отгрузки целиком. Всё проверяет сервер, здесь только подсказки.
 */
export default function RfShipmentEditForm({
  orderId,
  clients,
  batches,
  items,
  today,
  initialClientId,
  initialDate,
  initialComment,
  hadPrices,
  lockedCancel,
}: {
  orderId: string;
  clients: RubFormClient[];
  batches: RubFormBatch[];
  items: RfEditItem[];
  today: string;
  initialClientId: string;
  initialDate: string;
  initialComment: string;
  /** У отгрузки уже есть цены в рублях — тогда стереть их нельзя. */
  hadPrices: boolean;
  /** Почему отменить нельзя (вписаны поступления). Пусто — можно. */
  lockedCancel: string;
}) {
  const router = useRouter();
  const [clientId, setClientId] = useState(initialClientId);
  const [deliveryDate, setDeliveryDate] = useState(initialDate);
  const [comment, setComment] = useState(initialComment);
  const [drafts, setDrafts] = useState<Record<string, ItemDraft>>(() =>
    Object.fromEntries(items.map((i) => [i.itemId, { quantity: String(i.quantity), priceRub: i.priceRub > 0 ? String(i.priceRub) : "" }]))
  );
  const [add, setAdd] = useState<AddRow[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const byBatch = useMemo(() => new Map(batches.map((b) => [b.batchId, b])), [batches]);
  const rf = clients.filter((c) => c.rf);
  const rest = clients.filter((c) => !c.rf);

  const lines = items.map((item) => {
    const d = drafts[item.itemId];
    const quantity = d.quantity.trim() === "" ? NaN : num(d.quantity);
    const priceRub = num(d.priceRub) || 0;
    const back = Number.isFinite(quantity) ? Math.max(0, item.shipped - quantity) : 0;
    return { item, quantity, priceRub, back, over: quantity > item.quantity, removed: quantity === 0 };
  });
  const filledAdd = add.filter((r) => r.batchId && num(r.quantity) > 0);
  const stems = lines.reduce((s, l) => s + (Number.isFinite(l.quantity) ? l.quantity : 0), 0) + filledAdd.reduce((s, r) => s + num(r.quantity), 0);
  const total = lines.reduce((s, l) => s + (Number.isFinite(l.quantity) ? l.quantity : 0) * l.priceRub, 0) + filledAdd.reduce((s, r) => s + num(r.quantity) * (num(r.priceRub) || 0), 0);
  const totalBefore = items.reduce((s, i) => s + i.quantity * i.priceRub, 0);
  const backTotal = lines.reduce((s, l) => s + l.back, 0);
  const shippedTotal = items.reduce((s, i) => s + i.shipped, 0);
  const anyPrice = lines.some((l) => !l.removed && l.priceRub > 0) || filledAdd.length > 0;

  function setDraft(itemId: string, patch: Partial<ItemDraft>) {
    setDrafts((prev) => ({ ...prev, [itemId]: { ...prev[itemId], ...patch } }));
  }
  function setAddRow(idx: number, patch: Partial<AddRow>) {
    setAdd((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!deliveryDate) return setError("Укажите дату отгрузки");
    for (const l of lines) {
      if (!Number.isFinite(l.quantity) || l.quantity < 0) return setError(`${l.item.title}: укажите количество`);
      if (l.over) return setError(`${l.item.title}: было ${nf(l.item.quantity)} шт. Чтобы добавить, выберите партию в блоке «Добавить из партий»`);
      if ((hadPrices || anyPrice) && !l.removed && !(l.priceRub > 0)) return setError(`${l.item.title}: укажите цену в рублях`);
    }
    for (const r of filledAdd) {
      if (!(num(r.priceRub) > 0)) return setError(`${byBatch.get(r.batchId)?.title ?? "Партия"}: укажите цену в рублях`);
    }
    if (anyPrice && !clientId) return setError("Выберите клиента из базы");
    setSaving(true);
    try {
      unwrapValue(
        await updateRfShipmentAction(orderId, {
          deliveryDate,
          clientId,
          comment,
          items: lines.map((l) => ({ itemId: l.item.itemId, quantity: l.quantity, priceRub: l.priceRub })),
          add: filledAdd.map((r) => ({ batchId: r.batchId, quantity: num(r.quantity), priceRub: num(r.priceRub) })),
        })
      );
      router.push(`/orders/${orderId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
      setSaving(false);
    }
  }

  async function handleCancel() {
    setError("");
    if (reason.trim().length < 5) return setError("Напишите причину отмены");
    setCancelling(true);
    try {
      unwrap(await cancelRfShipmentAction(orderId, reason));
      router.push(`/orders/${orderId}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отменить");
      setCancelling(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-4xl space-y-6">
      <div className="card grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end">
        <label className="text-sm">
          <span className="label">Клиент (из базы)</span>
          <select className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {!initialClientId && <option value="">— не указан —</option>}
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
        </label>
        <label className="text-sm">
          <span className="label">Дата отгрузки</span>
          <input type="date" className="input !w-auto" value={deliveryDate} max={today} onChange={(e) => setDeliveryDate(e.target.value)} />
        </label>
      </div>

      <div className="card">
        <h2 className="font-medium">Что отгружено</h2>
        <p className="text-xs text-ink-muted mt-0.5 mb-3">
          Цену можно поправить в любую сторону. Количество — только уменьшить: лишнее вернётся в те партии, из которых уехало.
        </p>
        <div className="space-y-3">
          {lines.map((l) => (
            <div key={l.item.itemId} className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,2.2fr)_0.8fr_0.8fr_0.9fr_auto] gap-2 items-end">
              <div className="text-sm min-w-0">
                <span className="label">Позиция</span>
                <div className={`py-2 font-medium truncate ${l.removed ? "line-through text-ink-muted" : ""}`} title={l.item.title}>
                  {l.item.title}
                </div>
              </div>
              <label className="text-sm">
                <span className="label">Количество</span>
                <input
                  className={`input ${l.over ? "!border-status-critical" : ""}`}
                  inputMode="numeric"
                  value={drafts[l.item.itemId].quantity}
                  onChange={(e) => setDraft(l.item.itemId, { quantity: e.target.value })}
                  aria-label={`Количество: ${l.item.title}`}
                />
              </label>
              <label className="text-sm">
                <span className="label">Цена, ₽</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={drafts[l.item.itemId].priceRub}
                  onChange={(e) => setDraft(l.item.itemId, { priceRub: e.target.value })}
                  placeholder="₽ за шт."
                  aria-label={`Цена в рублях: ${l.item.title}`}
                />
              </label>
              <div className="text-sm">
                <span className="label">Сумма</span>
                <div className="py-2 tabular-nums font-medium">{l.quantity > 0 && l.priceRub > 0 ? formatRub(l.quantity * l.priceRub) : "—"}</div>
              </div>
              <button
                type="button"
                onClick={() => setDraft(l.item.itemId, { quantity: l.removed ? String(l.item.quantity) : "0" })}
                className="btn-ghost !py-2 text-sm"
              >
                {l.removed ? "Вернуть" : "Убрать"}
              </button>
              {(l.back > 0 || l.over) && (
                <p className={`sm:col-span-5 -mt-1 text-xs ${l.over ? "text-status-critical" : "text-ink-secondary"}`}>
                  {l.over
                    ? `Было ${nf(l.item.quantity)} шт. — больше добавляется партией ниже`
                    : l.removed
                      ? `Позиция уйдёт из отгрузки, ${nf(l.back)} шт. вернутся на склад`
                      : `Было ${nf(l.item.quantity)} шт. — ${nf(l.back)} шт. вернутся на склад`}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-medium">Добавить из партий</h2>
            <p className="text-xs text-ink-muted mt-0.5">Если уехало больше, чем записали: партия со склада, количество и цена за стебель.</p>
          </div>
          <button
            type="button"
            onClick={() => setAdd((prev) => [...prev, { batchId: "", quantity: "", priceRub: "" }])}
            className="btn-secondary !py-1.5 text-sm flex-none"
            disabled={batches.length === 0}
          >
            + Партия
          </button>
        </div>
        {batches.length === 0 && <p className="mt-3 text-sm text-ink-muted">На основном складе нет партий с остатком.</p>}
        {add.length > 0 && (
          <div className="space-y-3 mt-3">
            {add.map((row, idx) => {
              const batch = byBatch.get(row.batchId);
              const qty = num(row.quantity);
              const over = batch && qty > batch.quantityRemaining;
              return (
                <div key={idx} className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[minmax(0,2.2fr)_0.8fr_0.8fr_0.9fr_auto] gap-2 items-end">
                  <label className="text-sm min-w-0">
                    <span className="label">Партия</span>
                    <select className="input" value={row.batchId} onChange={(e) => setAddRow(idx, { batchId: e.target.value })}>
                      <option value="">— выберите —</option>
                      {batches.map((b) => (
                        <option key={b.batchId} value={b.batchId}>
                          {b.title} — срез {b.cut} — {nf(b.quantityRemaining)} шт.
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="label">Количество</span>
                    <input className={`input ${over ? "!border-status-critical" : ""}`} inputMode="numeric" value={row.quantity} onChange={(e) => setAddRow(idx, { quantity: e.target.value })} placeholder="шт." />
                  </label>
                  <label className="text-sm">
                    <span className="label">Цена, ₽</span>
                    <input className="input" inputMode="decimal" value={row.priceRub} onChange={(e) => setAddRow(idx, { priceRub: e.target.value })} placeholder="₽ за шт." />
                  </label>
                  <div className="text-sm">
                    <span className="label">Сумма</span>
                    <div className="py-2 tabular-nums font-medium">{qty > 0 && num(row.priceRub) > 0 ? formatRub(qty * num(row.priceRub)) : "—"}</div>
                  </div>
                  <button type="button" onClick={() => setAdd((prev) => prev.filter((_, i) => i !== idx))} className="btn-ghost !py-2 text-sm">
                    Убрать
                  </button>
                  {over && <p className="sm:col-span-5 -mt-1 text-xs text-status-critical">В партии {nf(batch.quantityRemaining)} шт. — отмечено больше, чем есть</p>}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 pt-4 border-t border-line-hairline flex flex-wrap items-baseline justify-between gap-3">
          <span className="text-sm text-ink-secondary">
            Итого: {nf(stems)} шт.
            {backTotal > 0 ? ` · на склад вернётся ${nf(backTotal)} шт.` : ""}
          </span>
          <span className="tabular-nums">
            {totalBefore > 0 && total !== totalBefore && <span className="text-sm text-ink-muted mr-2">было {formatRub(totalBefore)}</span>}
            <span className="font-display text-lg font-extrabold">{anyPrice || totalBefore > 0 ? formatRub(total) : "цены не указаны"}</span>
          </span>
        </div>
      </div>

      <div className="card">
        <label className="text-sm block">
          <span className="label">Комментарий (необязательно)</span>
          <input className="input" value={comment} maxLength={300} onChange={(e) => setComment(e.target.value)} placeholder="Например: машина, кто забрал" />
        </label>
      </div>

      {error && <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex flex-wrap gap-3">
        <button type="submit" className="btn-primary" disabled={saving || cancelling}>
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
        <Link href={`/orders/${orderId}`} className="btn-secondary">
          Не менять
        </Link>
      </div>

      <div className="card">
        <h2 className="font-medium">Отгрузки не было</h2>
        {lockedCancel ? (
          <p className="text-sm text-ink-secondary mt-1">{lockedCancel}</p>
        ) : !cancelOpen ? (
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-ink-secondary">
              Отмена вернёт на склад всё, что по ней списано{shippedTotal > 0 ? ` — ${nf(shippedTotal)} шт.` : ""}; заявка останется в списке отменённой.
            </p>
            <button type="button" className="btn-danger" onClick={() => setCancelOpen(true)}>
              Отменить отгрузку
            </button>
          </div>
        ) : (
          <div className="mt-2 space-y-3">
            <label className="text-sm block">
              <span className="label">Почему отменяется</span>
              <input className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Например: записали дважды, машина не пришла" />
            </label>
            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn-danger" disabled={cancelling || saving} onClick={handleCancel}>
                {cancelling ? "Отменяю…" : shippedTotal > 0 ? `Отменить и вернуть ${nf(shippedTotal)} шт. на склад` : "Отменить отгрузку"}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setCancelOpen(false)}>
                Оставить
              </button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}
