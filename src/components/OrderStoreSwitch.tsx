"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setOrderStoreAction } from "@/app/orders/actions";
import { unwrap } from "@/lib/actionResult";
import { REGION_STORES } from "@/lib/officeStore";

const regionLabels = Object.fromEntries(REGION_STORES.map((r) => [r.code, r.label]));
const LABELS: Record<string, string> = { "": "Основной склад", office: "Офис", ...regionLabels };
const ACTION: Record<string, string> = {
  "": "на основной склад",
  office: "отгрузить из офиса",
  ...Object.fromEntries(REGION_STORES.map((r) => [r.code, `отгрузить со склада ${r.genitive}`])),
};

/**
 * Склад заявки и перевод на другой склад (основной ⇄ «Офис» ⇄ склад города, `officeStore.ts`), пока ничего не отгружено.
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
    <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 items-baseline min-w-0">
      <div className="text-[13px] leading-5 text-ink-muted">Склад</div>
      <div className="flex flex-wrap items-baseline gap-x-3 min-w-0">
        <span className="text-[14px] leading-5 font-medium">{LABELS[store] ?? store}</span>
        {targets.map((t) => (
          <button key={t.code} type="button" className="text-xs text-accent hover:underline" disabled={busy} onClick={() => move(t.code)}>
            {busy ? "Меняю…" : ACTION[t.code] ?? t.label}
          </button>
        ))}
      </div>
      {error && <div className="col-span-2 text-xs text-status-critical mt-1">{error}</div>}
    </div>
  );
}
