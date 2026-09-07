"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { setManagerConfirmedAction } from "@/app/finance/actions";

/**
 * Две «зелёные галочки» готовности заявки к сборке.
 * Первую ставит менеджер (согласовал с клиентом), вторую — бухгалтер (увидел деньги).
 * Здесь менеджер может переключить свою; галочка оплаты только показывается.
 */
export default function ReadyChecks({
  orderId,
  managerConfirmed,
  paid,
  paidAt,
  paymentMethod,
  canConfirm,
}: {
  orderId: string;
  managerConfirmed: boolean;
  paid: boolean;
  paidAt: string;
  paymentMethod: string;
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ready = managerConfirmed && paid;

  function toggle() {
    if (!canConfirm) return;
    setError(null);
    startTransition(async () => {
      try {
        await setManagerConfirmedAction(orderId, !managerConfirmed);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
      }
    });
  }

  return (
    <div className={clsx("card mb-6", ready && "border-status-good/40 bg-status-good/5")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium">
            {ready ? "✓✓ Готова к сборке" : "Ещё не готова к сборке"}
          </h2>
          <p className="text-sm text-ink-secondary mt-0.5">
            {ready
              ? "Менеджер согласовал заявку и бухгалтер подтвердил оплату — склад может собирать."
              : "Склад увидит заявку, но она будет помечена как неготовая."}
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-4">
        <div className="flex items-start gap-3 rounded-lg border border-line-hairline p-3">
          <span
            className={clsx(
              "inline-flex items-center justify-center w-7 h-7 rounded-lg shrink-0 text-base",
              managerConfirmed
                ? "bg-status-good/15 text-status-good"
                : "bg-surface-plane text-ink-muted"
            )}
          >
            {managerConfirmed ? "✓" : "—"}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium">Менеджер подтвердил</div>
            <div className="text-xs text-ink-muted">Заявка окончательно согласована с клиентом</div>
            {canConfirm && (
              <button
                onClick={toggle}
                disabled={pending}
                className="btn-secondary !py-1 !px-2.5 text-xs mt-2"
              >
                {pending ? "Сохраняю…" : managerConfirmed ? "Снять подтверждение" : "Подтвердить"}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-line-hairline p-3">
          <span
            className={clsx(
              "inline-flex items-center justify-center w-7 h-7 rounded-lg shrink-0 text-base",
              paid ? "bg-status-good/15 text-status-good" : "bg-surface-plane text-ink-muted"
            )}
          >
            {paid ? "✓" : "—"}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium">Оплачено</div>
            <div className="text-xs text-ink-muted">
              {paid
                ? `${paymentMethod || "способ не указан"}${
                    paidAt ? ` · ${new Date(paidAt).toLocaleDateString("ru-RU")}` : ""
                  }`
                : "Отмечает бухгалтер в разделе «Оплаты»"}
            </div>
          </div>
        </div>
      </div>

      {error && <div className="text-sm text-status-critical mt-3">{error}</div>}
    </div>
  );
}
