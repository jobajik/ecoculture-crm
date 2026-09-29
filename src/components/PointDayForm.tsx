"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePointDayAction } from "@/app/finance/point-actions";
import { unwrapValue } from "@/lib/actionResult";
import { parseNumber } from "./NumberCell";

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

/**
 * Выручка точки за день: Kaspi и наличные. Выбрали день, который уже внесён, —
 * поля заполняются тем, что там записано: повторное сохранение ПЕРЕПИСЫВАЕТ
 * день, а не добавляет второй.
 */
export default function PointDayForm({
  today,
  known,
}: {
  today: string;
  known: Record<string, { kaspi: number; cash: number; note: string }>;
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [kaspi, setKaspi] = useState(known[today]?.kaspi ?? 0);
  const [cash, setCash] = useState(known[today]?.cash ?? 0);
  const [note, setNote] = useState(known[today]?.note ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const existing = known[date];

  function pickDate(d: string) {
    setDate(d);
    setKaspi(known[d]?.kaspi ?? 0);
    setCash(known[d]?.cash ?? 0);
    setNote(known[d]?.note ?? "");
    setMsg(null);
  }

  function save() {
    setMsg(null);
    start(async () => {
      try {
        const r = unwrapValue(await savePointDayAction({ date, kaspi, cash, note }));
        setMsg({ ok: true, text: r.result === "removed" ? "День удалён" : `Сохранено: ${money(kaspi + cash)}` });
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
          <input type="date" className="input !w-auto" value={date} max={today} onChange={(e) => pickDate(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="block text-ink-secondary mb-1">На Kaspi, ₸</span>
          <input
            className="input !w-36 text-right tabular-nums"
            inputMode="decimal"
            value={kaspi ? kaspi.toLocaleString("ru-RU") : ""}
            placeholder="0"
            onFocus={(e) => e.target.select()}
            onChange={(e) => setKaspi(parseNumber(e.target.value))}
          />
        </label>
        <label className="text-sm">
          <span className="block text-ink-secondary mb-1">Наличными, ₸</span>
          <input
            className="input !w-36 text-right tabular-nums"
            inputMode="decimal"
            value={cash ? cash.toLocaleString("ru-RU") : ""}
            placeholder="0"
            onFocus={(e) => e.target.select()}
            onChange={(e) => setCash(parseNumber(e.target.value))}
          />
        </label>
        <label className="text-sm flex-1 min-w-[180px]">
          <span className="block text-ink-secondary mb-1">Заметка</span>
          <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="необязательно" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={pending || (!existing && kaspi + cash <= 0)} onClick={save}>
          {pending ? "Сохраняю…" : existing ? `Исправить день · ${money(kaspi + cash)}` : `Внести · ${money(kaspi + cash)}`}
        </button>
        {existing && <span className="text-xs text-ink-muted">этот день уже внесён — сохранение заменит его (0 и 0 — удалит)</span>}
        {msg && <span className={msg.ok ? "text-sm text-status-good" : "text-sm text-status-critical"}>{msg.text}</span>}
      </div>
    </div>
  );
}
