"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { unwrap } from "@/lib/actionResult";
import type { CycleDraft } from "@/lib/greenhouse/production";

/**
 * Даты блока в цикле: черенкование, посадка, план срезки. Пустой план — сайт сам ждёт срезку через 76 дней после
 * посадки (как в книге). Правят агроном и ответственные (`editsLogs`).
 */
export default function CycleDatesForm({
  farm,
  cycle,
  block,
  initial,
  save,
}: {
  farm: string;
  cycle: number;
  block: string;
  initial: { cuttingsAt: string; plantedAt: string; plannedHarvestAt: string; note: string };
  save: (farm: string, draft: CycleDraft) => Promise<unknown>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open)
    return (
      <button type="button" className="text-sm underline" onClick={() => setOpen(true)}>
        Изменить даты
      </button>
    );
  async function submit() {
    setBusy(true);
    setError("");
    try {
      unwrap(await save(farm, { cycle, block, ...v }));
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не сохранилось.");
    } finally {
      setBusy(false);
    }
  }
  const field = (key: keyof typeof v, label: string) => (
    <label className="block text-xs text-ink-muted">
      {label}
      <input type="date" className="input mt-1 w-full" value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} />
    </label>
  );
  return (
    <div className="card !p-4 space-y-3 w-full">
      <div className="grid sm:grid-cols-3 gap-3">
        {field("cuttingsAt", "Черенкование")}
        {field("plantedAt", "Посадка")}
        {field("plannedHarvestAt", "План срезки")}
      </div>
      <label className="block text-xs text-ink-muted">
        Заметка
        <input className="input mt-1 w-full" value={v.note} maxLength={200} onChange={(e) => setV({ ...v, note: e.target.value })} />
      </label>
      {error && <div className="text-sm text-[#a12b2b]">{error}</div>}
      <div className="flex gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={submit}>
          {busy ? "Сохраняю…" : "Сохранить"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
    </div>
  );
}
