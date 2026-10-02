"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setManagerConfirmedAction } from "@/app/finance/actions";
import { unwrap } from "@/lib/actionResult";

/** «Подтвердить» прямо в очереди — склад офиса подтверждает офисную заявку, не открывая её. */
export default function ConfirmOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className="btn-secondary !py-1"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            unwrap(await setManagerConfirmedAction(orderId, true));
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Не удалось подтвердить");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Подтверждаю…" : "Подтвердить"}
      </button>
      {error && <span className="text-xs text-status-critical">{error}</span>}
    </span>
  );
}
