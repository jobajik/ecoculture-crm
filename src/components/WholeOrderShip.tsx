"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { shipWholeOrderAction } from "@/app/warehouse/actions";
import { unwrapValue } from "@/lib/actionResult";
import { formatDay } from "@/lib/formatDate";

export interface WholeShipPreviewLine {
  label: string;
  quantity: number;
  /** Срезки, из которых уйдёт позиция, — «12.09, 14.09». */
  from: string[];
}

/**
 * «Отгрузить всё» — вся заявка одним нажатием, партии программа берёт сама,
 * от старых срезок к свежим. Раскладка видна до нажатия; чего не хватает —
 * сказано прямо, и отгрузится то, что есть (остаток дозагрузят позже).
 */
export default function WholeOrderShip({
  orderId,
  total,
  lines,
  shortages,
}: {
  orderId: string;
  total: number;
  lines: WholeShipPreviewLine[];
  shortages: { label: string; missing: number }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const nf = (n: number) => n.toLocaleString("ru-RU");

  if (total === 0) return null;

  async function ship() {
    setBusy(true);
    setError(null);
    try {
      const r = unwrapValue(await shipWholeOrderAction({ orderId, expectedTotal: total }));
      setDone(`Отгружено ${nf(r.total)} шт.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось отгрузить");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3 mb-6 border-accent/30">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Вся заявка сразу</h2>
        <span className="text-xs text-ink-muted">партии — от старых срезок к свежим</span>
      </div>
      <ul className="text-sm divide-y divide-line-hairline">
        {lines.map((l) => (
          <li key={l.label} className="flex justify-between gap-3 py-1.5">
            <span>{l.label}</span>
            <span className="text-right tabular-nums">
              {nf(l.quantity)} шт.
              <span className="block text-xs text-ink-muted">срезка {l.from.map((d) => formatDay(d)).join(", ")}</span>
            </span>
          </li>
        ))}
      </ul>
      {shortages.length > 0 && (
        <div className="text-sm text-[#8a5a00] bg-status-warning/10 rounded-lg px-3 py-2">
          <div className="font-medium mb-1">Не хватает на складе — отгрузится то, что есть:</div>
          <ul className="space-y-0.5">
            {shortages.map((s) => (
              <li key={s.label} className="flex justify-between gap-3">
                <span>{s.label}</span>
                <span className="tabular-nums whitespace-nowrap">−{nf(s.missing)} шт.</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>}
      {done ? (
        <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">{done}</div>
      ) : (
        <button type="button" className="btn-primary w-full sm:w-auto" disabled={busy} onClick={ship}>
          {busy ? "Отгружаю…" : `Отгрузить всё · ${nf(total)} шт.`}
        </button>
      )}
    </div>
  );
}
