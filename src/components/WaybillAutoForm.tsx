"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setWaybillAutoAction } from "@/app/orders/waybill-actions";
import { unwrapValue } from "@/lib/actionResult";

/** Включить или выключить накладную клиенту после отгрузки (`waybill.ts`). Образец открывается в соседней вкладке. */
export default function WaybillAutoForm({ on, since, lastRun }: { on: boolean; since: string; lastRun: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = (next: boolean) => {
    setError(null);
    start(async () => {
      try {
        unwrapValue(await setWaybillAutoAction(next));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не получилось сохранить");
      }
    });
  };

  return (
    <div className="space-y-3 text-sm">
      <p>
        Сейчас:{" "}
        {on ? <span className="font-medium text-status-good">включено</span> : <span className="font-medium text-ink-secondary">выключено</span>}
        {on && since ? <span className="text-ink-secondary"> · по отгрузкам с {since}</span> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={on ? "btn-secondary" : "btn-primary"} disabled={pending} onClick={() => toggle(!on)}>
          {pending ? "Сохраняю…" : on ? "Выключить" : "Включить"}
        </button>
        <a className="btn-ghost" href="/api/waybill/sample/obrazec.jpg" target="_blank" rel="noreferrer">
          Посмотреть образец
        </a>
      </div>
      <p className="text-xs text-ink-muted">Последняя отправка: {lastRun || "ещё не было"}</p>
      {error && <p className="text-status-critical">{error}</p>}
    </div>
  );
}
