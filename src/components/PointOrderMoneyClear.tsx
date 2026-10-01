"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { clearPointOrderMoneyAction } from "@/app/finance/point-actions";
import { unwrap } from "@/lib/actionResult";

/**
 * Кнопка «убрать деньги с перемещения» — одна заявка или все сразу. Подтверждение
 * в той же строке, а не окном браузера: действие меняет выручку точки.
 */
export default function PointOrderMoneyClear({ orderIds, label, confirmText }: { orderIds: string[]; label: string; confirmText: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!asking) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <button type="button" className="text-xs text-ink-muted hover:text-status-critical" onClick={() => setAsking(true)}>
          {label}
        </button>
        {error && <span className="text-xs text-status-critical">{error}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2 text-xs">
      <span className="text-ink-secondary">{confirmText}</span>
      <button
        type="button"
        className="rounded-md bg-status-critical px-2 py-1 font-medium text-white disabled:opacity-50"
        disabled={pending}
        onClick={() => {
          setError(null);
          start(async () => {
            try {
              unwrap(await clearPointOrderMoneyAction(orderIds));
              setAsking(false);
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Не получилось");
              setAsking(false);
            }
          });
        }}
      >
        {pending ? "Снимаю…" : "Да, снять"}
      </button>
      <button type="button" className="text-ink-muted hover:underline" disabled={pending} onClick={() => setAsking(false)}>
        отмена
      </button>
    </span>
  );
}
