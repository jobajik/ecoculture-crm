"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { savePointDayAction } from "@/app/finance/point-actions";
import { unwrapValue } from "@/lib/actionResult";
import { parseNumber } from "./NumberCell";

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

export interface PointKnownDay {
  /** farm → Kaspi и наличные. */
  farms: Record<string, { kaspi: number; cash: number }>;
  /** Внесено одной суммой, до разделения на компании. */
  unsplit: number;
  note: string;
}

type Values = Record<string, { kaspi: number; cash: number }>;

/**
 * Выручка точки за день ПО КОМПАНИЯМ: Есентай (хризантема) и Rose Farm (роза,
 * эустома), у каждой Kaspi и наличные (бухгалтер, 02.10.2026). Выбрали день,
 * который уже внесён, — поля заполняются записанным: сохранение ПЕРЕПИСЫВАЕТ
 * день целиком, в том числе сумму, внесённую раньше одной строкой.
 */
export default function PointDayForm({
  today,
  known,
  farms,
}: {
  today: string;
  known: Record<string, PointKnownDay>;
  farms: { farm: string; label: string; hint: string }[];
}) {
  const router = useRouter();
  const valuesOf = (d: string): Values =>
    Object.fromEntries(farms.map((f) => [f.farm, { kaspi: known[d]?.farms[f.farm]?.kaspi ?? 0, cash: known[d]?.farms[f.farm]?.cash ?? 0 }]));
  const [date, setDate] = useState(today);
  const [values, setValues] = useState<Values>(valuesOf(today));
  const [note, setNote] = useState(known[today]?.note ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const existing = known[date];
  const total = Object.values(values).reduce((s, v) => s + v.kaspi + v.cash, 0);

  function pickDate(d: string) {
    setDate(d);
    setValues(valuesOf(d));
    setNote(known[d]?.note ?? "");
    setMsg(null);
  }

  function set(farm: string, field: "kaspi" | "cash", v: number) {
    setValues({ ...values, [farm]: { ...values[farm], [field]: v } });
  }

  function save() {
    setMsg(null);
    start(async () => {
      try {
        const parts = farms.map((f) => ({ farm: f.farm, ...values[f.farm] }));
        const r = unwrapValue(await savePointDayAction({ date, parts, note }));
        setMsg({ ok: true, text: r.result === "removed" ? "День удалён" : `Сохранено: ${money(r.total)}` });
        router.refresh();
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "Не сохранилось" });
      }
    });
  }

  const field = (farm: string, kind: "kaspi" | "cash", label: string) => (
    <label className="text-sm">
      <span className="block text-ink-secondary mb-1">{label}</span>
      <input
        className="input !w-36 text-right tabular-nums"
        inputMode="decimal"
        value={values[farm]?.[kind] ? values[farm][kind].toLocaleString("ru-RU") : ""}
        placeholder="0"
        onFocus={(e) => e.target.select()}
        onChange={(e) => set(farm, kind, parseNumber(e.target.value))}
      />
    </label>
  );

  return (
    <div className="space-y-3">
      <label className="text-sm inline-block">
        <span className="block text-ink-secondary mb-1">День</span>
        <input type="date" className="input !w-auto" value={date} max={today} onChange={(e) => pickDate(e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {farms.map((f) => {
          const sum = (values[f.farm]?.kaspi ?? 0) + (values[f.farm]?.cash ?? 0);
          return (
            <div key={f.farm} className="rounded-lg border border-line-hairline p-3">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <span className="font-medium">{f.label}</span>
                <span className="text-xs text-ink-muted">{f.hint}</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {field(f.farm, "kaspi", "На Kaspi, ₸")}
                {field(f.farm, "cash", "Наличными, ₸")}
              </div>
              {sum > 0 && <div className="text-xs text-ink-secondary mt-2">Итого {money(sum)}</div>}
            </div>
          );
        })}
      </div>
      <label className="text-sm block">
        <span className="block text-ink-secondary mb-1">Заметка</span>
        <input className="input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="необязательно" />
      </label>
      {existing && existing.unsplit > 0 && (
        <div className="text-sm text-[#8a5a00] bg-status-warning/10 rounded-lg px-3 py-2">
          За этот день раньше внесено одной суммой {money(existing.unsplit)} — разнесите её по компаниям: при сохранении она заменится.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={pending || (!existing && total <= 0)} onClick={save}>
          {pending ? "Сохраняю…" : existing ? `Исправить день · ${money(total)}` : `Внести · ${money(total)}`}
        </button>
        {existing && <span className="text-xs text-ink-muted">день уже внесён — сохранение заменит его (всё по нулям — удалит)</span>}
        {msg && <span className={msg.ok ? "text-sm text-status-good" : "text-sm text-status-critical"}>{msg.text}</span>}
      </div>
    </div>
  );
}
