"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setRegionIncomeAction } from "@/app/orders/actions";

/**
 * Сколько денег пришло по этому городу. Вписывает бухгалтер.
 *
 * Обычная панель оплаты здесь не годится, и не по мелочи: она считает долг как
 * «счёт минус внесено», а счёта у городской заявки нет — цены в позициях тоже.
 * На нулевом счёте она показала бы переплату при любой сумме и тянула бы
 * заявку в список звонков, где ей делать нечего.
 *
 * Поэтому отдельная панель с одним полем и без слова «долг». Владелец описал
 * порядок так: РОП двигает объём, «сумму по поступлениям подтверждает потом
 * Юлия» — то есть цифра приходит позже и живёт сама по себе.
 */
export default function RegionIncomePanel({
  orderId,
  direction,
  stems,
  income,
  canEdit,
}: {
  orderId: string;
  direction: string;
  /** Сколько стеблей ушло в город — чтобы сумму было с чем соотнести. */
  stems: number;
  income: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(income > 0 ? String(Math.round(income)) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

  async function save() {
    setError(null);
    setSaved(false);
    const amount = Number(value.replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(amount) || amount < 0) {
      setError("Укажите сумму числом");
      return;
    }
    setSaving(true);
    try {
      await setRegionIncomeAction(orderId, amount);
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="font-medium">Поступления по городу {direction}</h2>
        <span className="text-sm text-ink-muted">ушло {nf(stems)} шт.</span>
      </div>
      <p className="text-sm text-ink-secondary mb-3">
        Счёта по этой заявке нет: в неё заводят объём, а не продажу клиенту. Сюда вписывается то,
        что по городу реально поступило.
      </p>

      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="label">Поступило, ₸</span>
            <input
              className="input !w-auto"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d.,\s]/g, ""))}
              placeholder="0"
            />
          </label>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary disabled:opacity-50"
          >
            {saving ? "Сохраняю…" : "Сохранить"}
          </button>
          {saved && <span className="text-sm text-status-good">Сохранено</span>}
          {error && <span className="text-sm text-status-critical">{error}</span>}
        </div>
      ) : (
        <div className="text-lg font-semibold tabular-nums">
          {income > 0 ? `${nf(income)} ₸` : "сумма ещё не подтверждена"}
        </div>
      )}
    </div>
  );
}
