"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveManagerPlansAction } from "@/app/plans/actions";
import { periodLabel } from "@/lib/constants";
import NumberCell from "./NumberCell";

export interface ManagerPlanEntry {
  email: string;
  name: string;
  targetAmount: number;
  targetStems: number;
}

/**
 * План продаж по менеджерам на месяц. Отправляем только те строки, которые
 * человек действительно изменил: незачем переписывать чужие планы, к которым
 * он не прикасался, и незачем гонять лишние запросы в Google.
 */
export default function ManagerPlansForm({
  period,
  initial,
}: {
  period: string;
  initial: ManagerPlanEntry[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ManagerPlanEntry[]>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // initial приходит с сервера. Когда меняется месяц, страница перерисовывается
  // с новыми данными — сбрасываем правки, иначе цифры прошлого месяца
  // «переедут» в новый.
  const [seenPeriod, setSeenPeriod] = useState(period);
  if (seenPeriod !== period) {
    setSeenPeriod(period);
    setRows(initial);
    setSaved(null);
    setError(null);
  }

  const changed = useMemo(
    () =>
      rows.filter((row, i) => {
        const was = initial[i];
        return !was || was.targetAmount !== row.targetAmount || was.targetStems !== row.targetStems;
      }),
    [rows, initial]
  );

  const totals = useMemo(
    () => ({
      amount: rows.reduce((s, r) => s + r.targetAmount, 0),
      stems: rows.reduce((s, r) => s + r.targetStems, 0),
    }),
    [rows]
  );

  function update(index: number, patch: Partial<ManagerPlanEntry>) {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setSaved(null);
  }

  async function handleSave() {
    if (changed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await saveManagerPlansAction(
        period,
        changed.map((row) => ({
          period,
          managerEmail: row.email,
          targetAmount: row.targetAmount,
          targetStems: row.targetStems,
        }))
      );
      setSaved(`Сохранено планов: ${changed.length}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="card text-sm text-ink-secondary">
        В системе пока нет ни одного активного менеджера. Менеджеры заводятся на вкладке{" "}
        <b>Users</b> Google-таблицы — как только там появится строка с ролью <code>manager</code>,
        она появится и здесь.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Менеджер</th>
              <th className="px-4 py-3 font-medium w-48">План продаж</th>
              <th className="px-4 py-3 font-medium w-48">План стеблей</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.email} className="border-b border-line-hairline last:border-0">
                <td className="px-4 py-2">
                  <div className="font-medium">{row.name || row.email}</div>
                  <div className="text-xs text-ink-muted">{row.email}</div>
                </td>
                <td className="px-4 py-2">
                  <NumberCell
                    value={row.targetAmount}
                    onChange={(v) => update(i, { targetAmount: v })}
                    disabled={saving}
                    suffix="₸"
                    ariaLabel={`План продаж, ${row.name || row.email}`}
                  />
                </td>
                <td className="px-4 py-2">
                  <NumberCell
                    value={row.targetStems}
                    onChange={(v) => update(i, { targetStems: v })}
                    disabled={saving}
                    suffix="шт"
                    ariaLabel={`План стеблей, ${row.name || row.email}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-surface-plane">
              <td className="px-4 py-3 font-medium">Итого по отделу</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {totals.amount.toLocaleString("ru-RU")} ₸
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                {totals.stems.toLocaleString("ru-RU")} шт
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {saved && (
        <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">{saved}</div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || changed.length === 0}
          className="btn-primary disabled:opacity-50"
        >
          {saving ? "Сохраняю…" : `Сохранить план на ${periodLabel(period)}`}
        </button>
        <span className="text-sm text-ink-muted">
          {changed.length === 0 ? "Изменений нет" : `Изменено строк: ${changed.length}`}
        </span>
      </div>
    </div>
  );
}
