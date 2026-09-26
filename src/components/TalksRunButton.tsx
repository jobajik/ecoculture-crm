"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeStaleTalksAction } from "@/app/clients/leads/talk-actions";
import { unwrapValue } from "@/lib/actionResult";

/**
 * «Разобрать новые» у РОПа: за одно нажатие — несколько лидов (функция живёт
 * минуту), остальное — следующим нажатием или вечером само.
 */
export default function TalksRunButton({ pending }: { pending: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const r = unwrapValue(await analyzeStaleTalksAction());
      const parts = [`Разобрано: ${r.done}`];
      if (r.left > 0) parts.push(`осталось ${r.left} — нажмите ещё раз`);
      if (r.failed.length > 0) parts.push(`не вышло: ${r.failed.join("; ")}`);
      setMsg({ ok: r.failed.length === 0, text: parts.join(" · ") });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Не удалось" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn-primary" onClick={run} disabled={busy || pending === 0}>
        {busy ? "Разбираю…" : pending > 0 ? `Разобрать новые · ${pending}` : "Новых переписок нет"}
      </button>
      {msg && <span className={`text-sm ${msg.ok ? "text-status-good" : "text-status-critical"}`}>{msg.text}</span>}
    </div>
  );
}
