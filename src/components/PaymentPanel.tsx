"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { setPaymentAction } from "@/app/finance/actions";
import { PAYMENT_METHODS } from "@/lib/constants";
import { parseNumber } from "./NumberCell";

export function money(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₸`;
}

/**
 * Внесение оплаты по заявке.
 *
 * Оплата бывает частичной, поэтому вводится СУММА, а не галочка. Но самый
 * частый случай — «заплатили всё», и ради него отдельная кнопка: заставлять
 * бухгалтера вбивать 812 400 руками там, где она просто подтверждает счёт,
 * значит добавить ей работы и шанс на опечатку.
 *
 * Поле подставляет остаток долга: обычно вносят именно его.
 */
export default function PaymentPanel({
  orderId,
  totalAmount,
  paidAmount,
  onDone,
}: {
  orderId: string;
  totalAmount: number;
  paidAmount: number;
  onDone?: () => void;
}) {
  const router = useRouter();
  const debt = Math.max(0, totalAmount - paidAmount);
  const [value, setValue] = useState<number>(paidAmount + debt);
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(amount: number) {
    setError(null);
    startTransition(async () => {
      try {
        await setPaymentAction(orderId, amount, method);
        router.refresh();
        onDone?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-ink-secondary mb-1">Получено всего, ₸</span>
          <input
            className="input !w-40 text-right tabular-nums"
            inputMode="decimal"
            value={value ? value.toLocaleString("ru-RU") : ""}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setValue(parseNumber(e.target.value))}
          />
        </label>
        <label className="text-sm">
          <span className="block text-ink-secondary mb-1">Способ</span>
          <select className="input !w-auto" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => save(value)} disabled={pending} className="btn-primary disabled:opacity-50">
          {pending ? "Сохраняю…" : "Записать"}
        </button>
        {debt > 0 && (
          <button
            onClick={() => save(totalAmount)}
            disabled={pending}
            className="btn-secondary disabled:opacity-50"
          >
            Оплачено целиком
          </button>
        )}
        {/* Переплата появляется после пересчёта по рекламации: денег пришло
            больше, чем стоит заявка. Кнопка закрывает вопрос одним нажатием —
            иначе бухгалтер считает разницу в уме и вбивает её руками. */}
        {paidAmount > totalAmount + 1 && (
          <button
            onClick={() => save(totalAmount)}
            disabled={pending}
            className="btn-secondary disabled:opacity-50"
            title="Записать, что лишние деньги вернули клиенту"
          >
            Вернули переплату {money(paidAmount - totalAmount)}
          </button>
        )}
        {paidAmount > 0 && (
          <button
            onClick={() => save(0)}
            disabled={pending}
            className="btn-secondary disabled:opacity-50 !text-status-critical"
          >
            Снять оплату
          </button>
        )}
      </div>

      <p className="text-xs text-ink-muted">
        Это сумма, полученная по заявке ВСЕГО, а не очередной платёж. Счёт{" "}
        {money(totalAmount)}
        {paidAmount > 0 && ` · уже внесено ${money(paidAmount)}`}
        {debt > 0 && ` · остаток ${money(debt)}`}
        {paidAmount > totalAmount + 1 &&
          ` · переплата ${money(paidAmount - totalAmount)} — её придётся вернуть или зачесть`}
        . Галочку «оплачено целиком» система поставит сама, когда сумма догонит счёт.
      </p>

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

/** Как выглядит оплата в строке таблицы: сумма, полоска и подпись. */
export function PaymentState({
  totalAmount,
  paidAmount,
  compact,
}: {
  totalAmount: number;
  paidAmount: number;
  compact?: boolean;
}) {
  const paid = paidAmount >= totalAmount - 1 && paidAmount > 0;
  const partial = paidAmount > 0 && !paid;
  const percent = totalAmount > 0 ? Math.min(100, (paidAmount / totalAmount) * 100) : 0;
  const overpaid = Math.max(0, paidAmount - totalAmount);

  return (
    <div className={clsx("min-w-[9rem] whitespace-nowrap", compact && "text-sm")}>
      <div
        className={clsx(
          "tabular-nums font-medium",
          paid ? "text-status-good" : partial ? "text-[#8a5a00]" : "text-ink-muted"
        )}
      >
        {paidAmount > 0 ? money(paidAmount) : "—"}
      </div>
      {partial && (
        <>
          <div className="h-1 rounded-full bg-surface-plane overflow-hidden my-1">
            <div className="h-full rounded-full bg-[#8a5a00]" style={{ width: `${percent}%` }} />
          </div>
          <div className="text-[11px] text-ink-muted whitespace-nowrap">
            {Math.round(percent)} % · ещё {money(totalAmount - paidAmount)}
          </div>
        </>
      )}
      {paid && overpaid > 0 && (
        <div className="text-[11px] text-status-critical">переплата {money(overpaid)}</div>
      )}
    </div>
  );
}
