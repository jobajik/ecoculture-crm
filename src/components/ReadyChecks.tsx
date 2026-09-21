"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { setManagerConfirmedAction } from "@/app/finance/actions";
import { formatDay } from "@/lib/formatDate";
import { unwrap } from "@/lib/actionResult";

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
  invoiceSentAt = "",
  retail = "",
  kind = "",
  consignment = false,
  creditTerms = "",
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
  /** Когда счёт отправили клиенту. Пусто — не отправляли. */
  invoiceSentAt?: string;
  /** Направление собственной розницы; пусто — обычная продажа наружу. */
  retail?: string;
  /** Вид заявки: «region» — оптовый объём на город, счёта по нему нет. */
  kind?: string;
  /**
   * Заявка на реализацию (пожарка): платят за проданное, ПОСЛЕ отгрузки, —
   * поэтому собирать её можно по одной галочке менеджера (orderReady.ts).
   */
  consignment?: boolean;
  /**
   * Условия клиента, по которым цветок уезжает раньше денег («Отсрочка 7 дней»,
   * «По факту»). Пусто — отгрузка ждёт оплату. Правило — `isCreditTerms()`.
   */
  creditTerms?: string;
  canConfirm: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Счёта клиенту нет у двух видов заявок: перемещение в наш магазин и объём
  // на город. Галочка у обеих одна, но говорить о них надо разными словами —
  // иначе РОП прочитает про «наш магазин» и решит, что открыл чужую заявку.
  const isRetail = !!retail.trim();
  const isRegion = kind.trim().toLowerCase() === "region";
  const noInvoice = isRetail || isRegion;
  const credit = !noInvoice && !consignment && !paid && Boolean(creditTerms.trim());
  const ready = managerConfirmed && (noInvoice || consignment || paid || credit);
  const partial = !paid && paidAmount > 0;
  // Счёт отправлен, но денег ещё нет — промежуточная ступень между «ничего не
  // сделано» и «оплачено». Без неё серая клетка означала сразу два разных
  // положения дел, и понять по ней, пора ли напоминать клиенту, было нельзя.
  const invoiceSent = !paid && !partial && Boolean((invoiceSentAt || "").trim());
  const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

  function toggle() {
    if (!canConfirm) return;
    setError(null);
    startTransition(async () => {
      try {
        unwrap(await setManagerConfirmedAction(orderId, !managerConfirmed));
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
            {ready
              ? noInvoice
                ? "✓ Готова к сборке"
                : credit
                  ? "✓ Готова к сборке — в долг"
                  : "✓✓ Готова к сборке"
              : "Ещё не готова к сборке"}
          </h2>
          <p className="text-sm text-ink-secondary mt-0.5">
            {ready
              ? isRegion
                ? "Заявка подтверждена — склад может собирать. Это объём на город: счёта нет, поступления бухгалтер отметит отдельно."
                : isRetail
                  ? "Менеджер розницы подтвердил заявку — склад может собирать. Это наш магазин, оплата по заявке не нужна."
                  : consignment
                    ? "Менеджер подтвердил — склад может собирать. Это реализация: платят за проданное, после отгрузки."
                    : credit
                      ? `Менеджер подтвердил — склад может отгружать в долг: у клиента «${creditTerms.trim()}». Деньги бухгалтер отметит, когда придут.`
                    : "Менеджер согласовал заявку и бухгалтер подтвердил оплату — склад может собирать."
              : "Склад увидит заявку, но она будет помечена как неготовая."}
          </p>
        </div>
      </div>

      <div className={clsx("grid gap-3 mt-4", !noInvoice && "sm:grid-cols-2")}>
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
              {isRegion
                ? "РОП подтвердил объём"
                : isRetail
                  ? "Менеджер розницы подтвердил"
                  : "Менеджер подтвердил"}
            </div>
            <div className="text-xs text-ink-muted">
              {isRegion
                ? "Объём на город окончательный — склад может собирать"
                : isRetail
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

        {!noInvoice && (
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
            {paid ? "✓" : partial ? "½" : invoiceSent ? "→" : "—"}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {paid
                ? "Оплачено"
                : partial
                  ? "Оплачено частично"
                  : invoiceSent
                    ? "Счёт отправлен клиенту"
                    : "Оплачено"}
            </div>
            <div className="text-xs text-ink-muted">
              {paid
                ? `${paymentMethod || "способ не указан"}${
                    paidAt ? ` · ${formatDay(paidAt, "")}` : ""
                  }`
                : partial
                  ? `Получено ${money(paidAmount)} из ${money(totalAmount)}`
                  : invoiceSent
                    ? `Счёт у клиента с ${formatDay(invoiceSentAt, "")} — ждём деньги`
                    : consignment
                      ? "Реализация: деньги приходят по мере продаж и сборку не держат"
                      : credit
                        ? `${creditTerms.trim()}: отгрузку не держит, долг идёт бухгалтеру`
                      : "Отмечает бухгалтер в разделе «Оплаты»"}
            </div>
            {partial && (
              <div className="text-xs text-[#8a5a00] mt-0.5">
                {consignment ? "На реализации ещё" : "Остаток"} {money(totalAmount - paidAmount)}
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
