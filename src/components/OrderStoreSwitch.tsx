"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setOrderStoreAction } from "@/app/orders/actions";
import { unwrap } from "@/lib/actionResult";

const LABELS: Record<string, string> = { "": "Основной склад", office: "Офис", astana: "Астана" };
const ACTION: Record<string, string> = { "": "на основной склад", office: "отгрузить из офиса", astana: "отгрузить со склада Астаны" };

/**
 * Склад заявки и перевод на другой склад (основной ⇄ «Офис» ⇄ «Астана», `officeStore.ts`), пока ничего не отгружено.
 * Куда можно — решает сервер (`storeChangeRefusal`) и присылает списком `targets`.
 */
export default function OrderStoreSwitch({
  orderId,
  store,
  targets,
}: {
  orderId: string;
  store: string;
  targets: { code: string; label: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function move(to: string) {
    setBusy(true);
    setError(null);
    try {
      unwrap(await setOrderStoreAction(orderId, to));
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
        <span className="font-medium">{LABELS[store] ?? store}</span>
        {targets.map((t) => (
          <button key={t.code} type="button" className="text-sm text-series-1 hover:underline" disabled={busy} onClick={() => move(t.code)}>
            {busy ? "Меняю…" : ACTION[t.code] ?? t.label}
          </button>
        ))}
      </div>
      {error && <div className="text-xs text-status-critical mt-1">{error}</div>}
    </div>
  );
}
