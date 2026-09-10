"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { setPaymentAction, setPaymentByFarmAction } from "@/app/finance/actions";
import type { FarmPayment } from "@/lib/orderMoney";
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
 * Смешанная заявка — отдельный случай. Розу и эустому продаёт Rose Farm,
 * хризантему — Есентай Агро Хим, счёта два, и деньги приходят двумя переводами
 * в разные дни. Тогда панель показывает поле на каждую компанию: с одной общей
 * суммой «одно ТОО получило, второе нет» выглядело как обычная недоплата.
 */
export default function PaymentPanel({
  orderId,
  totalAmount,
  paidAmount,
  farms = [],
  onDone,
}: {
  orderId: string;
  totalAmount: number;
  paidAmount: number;
  /**
   * Счёт по компаниям. Две строки — заявка смешанная, и оплата вносится по
   * каждой отдельно. Одна или ноль — обычная заявка, работает как раньше.
   */
  farms?: FarmPayment[];
  onDone?: () => void;
}) {
  if (farms.length > 1) {
    return (
      <SplitPayment orderId={orderId} totalAmount={totalAmount} farms={farms} onDone={onDone} />
    );
  }
  return (
    <WholePayment
      orderId={orderId}
      totalAmount={totalAmount}
      paidAmount={paidAmount}
      onDone={onDone}
    />
  );
}

function WholePayment({
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
        <MethodSelect value={method} onChange={setMethod} />
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

/**
 * Смешанная заявка: розу и эустому продаёт Rose Farm, хризантему — Есентай.
 * Счёта два, клиент платит двумя переводами, и приходят они в разные дни.
 *
 * Поэтому здесь поле на КАЖДУЮ компанию: бухгалтеру нужно показать, что одно
 * ТОО деньги получило, а второе ещё нет. С одной общей суммой это выглядело
 * ровно как недоплата — а разговор с клиентом в этих двух случаях разный.
 *
 * Общая сумма не вводится, а складывается из частей: два поля, отвечающие за
 * одно и то же число, рано или поздно разъезжаются, и потом не понять, какое
 * из них правда.
 */
function SplitPayment({
  orderId,
  totalAmount,
  farms,
  onDone,
}: {
  orderId: string;
  totalAmount: number;
  farms: FarmPayment[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(farms.map((f) => [f.farm, f.paidAmount]))
  );
  const [method, setMethod] = useState<string>(PAYMENT_METHODS[0]);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const entered = farms.reduce((s, f) => s + (values[f.farm] ?? 0), 0);
  const paidNow = farms.reduce((s, f) => s + f.paidAmount, 0);

  function save(next: Record<string, number>) {
    setError(null);
    startTransition(async () => {
      try {
        await setPaymentByFarmAction(orderId, next, method);
        router.refresh();
        onDone?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
      }
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-secondary">
        В заявке цветок обоих производств — счёта два, и клиент платит двумя переводами.
        Отметьте каждый отдельно.
      </p>

      <div className="grid sm:grid-cols-2 gap-3">
        {farms.map((f) => {
          const left = Math.max(0, f.amount - (values[f.farm] ?? 0));
          return (
            <div key={f.farm} className="rounded-xl border border-line-hairline p-3 space-y-2">
              <div className="text-sm font-medium">{f.farmLabel}</div>
              <div className="text-xs text-ink-muted">Счёт {money(f.amount)}</div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm">
                  <span className="block text-ink-secondary mb-1">Получено, ₸</span>
                  <input
                    className="input !w-36 text-right tabular-nums"
                    inputMode="decimal"
                    value={values[f.farm] ? (values[f.farm] as number).toLocaleString("ru-RU") : ""}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [f.farm]: parseNumber(e.target.value) }))
                    }
                  />
                </label>
                {left > 1 && (
                  <button
                    type="button"
                    onClick={() => setValues((v) => ({ ...v, [f.farm]: f.amount }))}
                    className="btn-secondary !py-1.5 text-xs"
                  >
                    Оплачено целиком
                  </button>
                )}
              </div>
              <div
                className={clsx(
                  "text-xs",
                  left <= 1 ? "text-status-good" : (values[f.farm] ?? 0) > 0 ? "text-[#8a5a00]" : "text-ink-muted"
                )}
              >
                {left <= 1 ? "оплачено" : `остаток ${money(left)}`}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <MethodSelect value={method} onChange={setMethod} />
        <button
          onClick={() => save(values)}
          disabled={pending}
          className="btn-primary disabled:opacity-50"
        >
          {pending ? "Сохраняю…" : "Записать"}
        </button>
        {paidNow > 0 && (
          <button
            onClick={() => save(Object.fromEntries(farms.map((f) => [f.farm, 0])))}
            disabled={pending}
            className="btn-secondary disabled:opacity-50 !text-status-critical"
          >
            Снять оплату
          </button>
        )}
      </div>

      <p className="text-xs text-ink-muted">
        Всего по заявке {money(totalAmount)} · будет записано {money(entered)}
        {entered < totalAmount - 1 && ` · остаток ${money(totalAmount - entered)}`}
        {entered > totalAmount + 1 &&
          ` · переплата ${money(entered - totalAmount)} — её придётся вернуть или зачесть`}
        . Это суммы, полученные ВСЕГО по каждой компании, а не очередной платёж.
      </p>

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

function MethodSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-sm">
      <span className="block text-ink-secondary mb-1">Способ</span>
      <select className="input !w-auto" value={value} onChange={(e) => onChange(e.target.value)}>
        {PAYMENT_METHODS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </label>
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
