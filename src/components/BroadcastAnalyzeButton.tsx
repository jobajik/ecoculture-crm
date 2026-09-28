"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeBroadcastAction } from "@/app/clients/broadcasts/actions";
import { unwrap } from "@/lib/actionResult";

/** «Разобрать ответы» — ИИ читает переписку ответивших. Идёт до минуты. */
export default function BroadcastAnalyzeButton({ broadcastId, label }: { broadcastId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      unwrap(await analyzeBroadcastAction(broadcastId));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось разобрать");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" className="btn-secondary" onClick={run} disabled={busy}>
        {busy ? "Разбираю… до минуты" : label}
      </button>
      {error && <span className="text-sm text-status-critical">{error}</span>}
    </div>
  );
}
