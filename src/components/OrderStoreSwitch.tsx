"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setOrderStoreAction } from "@/app/orders/actions";
import { unwrap } from "@/lib/actionResult";

/** Склад заявки и перевод основной ⇄ «Офис» (`officeStore.ts`), пока ничего не отгружено. */
export default function OrderStoreSwitch({
  orderId,
  store,
  editable,
}: {
  orderId: string;
  store: string;
  editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const office = store === "office";

  async function move() {
    setBusy(true);
    setError(null);
    try {
      unwrap(await setOrderStoreAction(orderId, office ? "" : "office"));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось поменять склад");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="text-xs text-ink-muted">Склад</div>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium">{office ? "Офис" : "Основной склад"}</span>
        {editable && (
          <button type="button" className="text-sm text-series-1 hover:underline" disabled={busy} onClick={move}>
            {busy ? "Меняю…" : office ? "отдать на основной склад" : "отгрузить из офиса"}
          </button>
        )}
      </div>
      {error && <div className="text-xs text-status-critical mt-1">{error}</div>}
    </div>
  );
}
