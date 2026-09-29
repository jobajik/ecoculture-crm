"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addPointWriteoffAction } from "@/app/finance/point-actions";
import { unwrapValue } from "@/lib/actionResult";
import { parseNumber } from "./NumberCell";

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

/** Списание на точке: завяло, сломалось, не продалось. */
export default function PointWriteoffForm({ today, flowers }: { today: string; flowers: { value: string; label: string }[] }) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [flowerType, setFlower] = useState(flowers[0]?.value ?? "");
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function save() {
    setMsg(null);
    start(async () => {
      try {
        const r = unwrapValue(await addPointWriteoffAction({ date, flowerType, quantity, reason }));
        setMsg({ ok: true, text: `Списано на ${money(r.amount)}` });
        setQuantity(0);
        setReason("");
        router.refresh();
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "Не сохранилось" });
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-ink-secondary mb-1">День</span>
          <input type="date" className="input !w-auto" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-ink-secondary mb-1">Цветок</span>
          <select className="input !w-auto" value={flowerType} onChange={(e) => setFlower(e.target.value)}>
            {flowers.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-ink-secondary mb-1">Стеблей</span>
          <input
            className="input !w-28 text-right tabular-nums"
            inputMode="numeric"
            value={quantity ? quantity.toLocaleString("ru-RU") : ""}
            placeholder="0"
            onFocus={(e) => e.target.select()}
            onChange={(e) => setQuantity(Math.round(parseNumber(e.target.value)))}
          />
        </label>
        <label className="text-sm flex-1 min-w-[180px]">
          <span className="block text-ink-secondary mb-1">Причина</span>
          <input className="input" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="завял, сломан, не продался…" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary" disabled={pending || quantity <= 0} onClick={save}>
          {pending ? "Сохраняю…" : "Списать"}
        </button>
        {msg && <span className={msg.ok ? "text-sm text-status-good" : "text-sm text-status-critical"}>{msg.text}</span>}
      </div>
    </div>
  );
}
