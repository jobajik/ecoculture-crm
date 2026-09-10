"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { setManagerConfirmedAction } from "@/app/finance/actions";
import { formatDay } from "@/lib/formatDate";

/**
 * Две «зелёные галочки» готовности заявки к сборке.
 * Первую ставит менеджер (согласовал с клиентом), вторую — бухгалтер (увидел деньги).
 * Здесь менеджер может переключить свою; галочка оплаты только показывается.
 *
 * У заявки в НАШ магазин галочка одна. Счёт своему магазину не выставляют, и
 * вторая клетка означала бы «ждём оплату», которой не будет никогда: пустая
 * серая ячейка на каждой розничной заявке читалась бы как недоделка.
 */
export default function ReadyChecks({
  orderId,
  managerConfirmed,
  paid,
  paidAt,
  paymentMethod,
  paidAmount,
  totalAmount,
  retail = "",
  canConfirm,
}: {
  orderId: string;
  managerConfirmed: boolean;
  paid: boolean;
  paidAt: string;
  paymentMethod: string;
  /** Сколько денег получено и сколько всего по счёту — оплата бывает частичной. */
  paidAmount: number;
  totalAmount: number;
  /** Направление собственной розницы; пусто — обычная продажа наружу. */
  retail?: string;
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isRetail = !!retail.trim();
  const ready = managerConfirmed && (isRetail || paid);
  const partial = !paid && paidAmount > 0;
  const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

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
            {ready ? (isRetail ? "✓ Готова к сборке" : "✓✓ Готова к сборке") : "Ещё не готова к сборке"}
          </h2>
          <p className="text-sm text-ink-secondary mt-0.5">
            {ready
              ? isRetail
                ? "Менеджер розницы подтвердил заявку — склад может собирать. Это наш магазин, оплата по заявке не нужна."
                : "Менеджер согласовал заявку и бухгалтер подтвердил оплату — склад может собирать."
              : "Склад увидит заявку, но она будет помечена как неготовая."}
          </p>
        </div>
      </div>

      <div className={clsx("grid gap-3 mt-4", !isRetail && "sm:grid-cols-2")}>
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
            <div className="text-sm font-medium">
              {isRetail ? "Менеджер розницы подтвердил" : "Менеджер подтвердил"}
            </div>
            <div className="text-xs text-ink-muted">
              {isRetail
                ? "Заявка на магазин собрана окончательно — склад может собирать"
                : "Заявка окончательно согласована с клиентом"}
            </div>
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

        {!isRetail && (
        <div className="flex items-start gap-3 rounded-lg border border-line-hairline p-3">
          <span
            className={clsx(
              "inline-flex items-center justify-center w-7 h-7 rounded-lg shrink-0 text-base",
              paid
                ? "bg-status-good/15 text-status-good"
                : partial
                  ? "bg-[#8a5a00]/15 text-[#8a5a00]"
                  : "bg-surface-plane text-ink-muted"
            )}
          >
            {paid ? "✓" : partial ? "½" : "—"}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {paid ? "Оплачено" : partial ? "Оплачено частично" : "Оплачено"}
            </div>
            <div className="text-xs text-ink-muted">
              {paid
                ? `${paymentMethod || "способ не указан"}${
                    paidAt ? ` · ${formatDay(paidAt, "")}` : ""
                  }`
                : partial
                  ? `Получено ${money(paidAmount)} из ${money(totalAmount)}`
                  : "Отмечает бухгалтер в разделе «Оплаты»"}
            </div>
            {partial && (
              <div className="text-xs text-[#8a5a00] mt-0.5">
                Остаток {money(totalAmount - paidAmount)}
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {error && <div className="text-sm text-status-critical mt-3">{error}</div>}
    </div>
  );
}
