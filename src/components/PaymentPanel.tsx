"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  addPaymentAction,
  removePaymentAction,
  setInvoiceSentAction,
  setPaymentAction,
  setPaymentByFarmAction,
  setRealizationAction,
} from "@/app/finance/actions";
import type { FinancePayment } from "@/lib/finance";
import { paymentHistory, type Realization } from "@/lib/payments";
import { formatMoment } from "@/lib/formatDate";
import type { FarmPayment } from "@/lib/orderMoney";
import { MIXED_PAYMENT_METHOD, PAYMENT_METHODS } from "@/lib/constants";
import { parseNumber } from "./NumberCell";
import { unwrap } from "@/lib/actionResult";
import KaspiInvoiceBlock from "./KaspiInvoiceBlock";

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
  invoiceSentAt = "",
  payments = [],
  realizations = [],
  defaultMethod = "",
  status = "",
  consignment = false,
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
  /** Когда счёт отправили клиенту. Пусто — не отправляли. */
  invoiceSentAt?: string;
  /** Платежи по заявке, по строке на поступление. */
  payments?: FinancePayment[];
  /** Реализации 1С по цветкам: сумма и номер документа у каждой. */
  realizations?: Realization[];
  /** Как клиент собирался платить — указал менеджер в заявке. */
  defaultMethod?: string;
  status?: string;
  /** Заявка на реализацию (пожарка): платят за проданное, остаток — не долг. */
  consignment?: boolean;
  onDone?: () => void;
}) {
  // Владелец: «с подвязкой Kaspi Pay переосмысли форму — тупо нажать кнопку,
  // чтобы отправился счёт, и трекерить оплату; ненужное скрой». Поэтому сверху
  // итог и Kaspi-счёт, ниже платежи, а ручной ввод, номер 1С и исправление итога
  // свёрнуты. Если Kaspi здесь делать нечего (касса не подключена, всё оплачено),
  // ручной ввод раскрывается сам — иначе главное действие оказалось бы спрятано.
  const [kaspi, setKaspi] = useState<"loading" | "action" | "none">("loading");
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const onKaspiState = useCallback((s: "action" | "none") => setKaspi(s), []);
  const left = totalAmount - paidAmount;
  const manualIsOpen = manualOpen ?? (kaspi === "none" && left > 1);

  return (
    <div className="space-y-4">
      <PaymentSummary
        orderId={orderId}
        totalAmount={totalAmount}
        paidAmount={paidAmount}
        invoiceSentAt={invoiceSentAt}
        consignment={consignment}
      />
      <KaspiInvoiceBlock orderId={orderId} onState={onKaspiState} />
      <PaymentsList
        orderId={orderId}
        totalAmount={totalAmount}
        paidAmount={paidAmount}
        payments={payments}
        farms={farms}
        status={status}
      />
      <details
        className="group rounded-xl border border-line-hairline"
        open={manualIsOpen}
        onToggle={(e) => {
          const open = (e.currentTarget as HTMLDetailsElement).open;
          if (open !== manualIsOpen) setManualOpen(open);
        }}
      >
        <summary className="px-3 py-2.5 text-sm cursor-pointer select-none flex items-center gap-2 list-none [&::-webkit-details-marker]:hidden">
          <span className="font-medium">Внести платёж вручную</span>
          <span className="hidden sm:inline text-xs text-ink-muted">наличные, перевод, Kaspi не через счёт</span>
          <span className="ml-auto text-ink-muted transition-transform group-open:rotate-90">›</span>
        </summary>
        <div className="px-3 pb-3">
          <AddPayment
            orderId={orderId}
            totalAmount={totalAmount}
            paidAmount={paidAmount}
            farms={farms}
            defaultMethod={defaultMethod}
          />
        </div>
      </details>
      <RealizationRow orderId={orderId} realizations={realizations} />
      {/* Прежний способ — «получено всего» одним числом — остался для
          исправлений: вернули переплату, сняли ошибочную оплату, старая заявка
          без журнала. Он свёрнут: в обычной работе вносят платёж, а не итог. */}
      <details className="group rounded-xl border border-line-hairline">
        <summary className="px-3 py-2.5 text-sm cursor-pointer select-none flex items-center gap-2 list-none [&::-webkit-details-marker]:hidden text-ink-secondary">
          Исправить итог вручную
          <span className="ml-auto text-ink-muted transition-transform group-open:rotate-90">›</span>
        </summary>
        <div className="px-3 pb-3">
          <p className="text-xs text-ink-muted mb-3">
            Итог одним числом, а не очередной платёж. Только для исправлений.
          </p>
          {farms.length > 1 ? (
            <SplitPayment orderId={orderId} totalAmount={totalAmount} farms={farms} onDone={onDone} />
          ) : (
            <WholePayment
              orderId={orderId}
              totalAmount={totalAmount}
              paidAmount={paidAmount}
              onDone={onDone}
            />
          )}
        </div>
      </details>
    </div>
  );
}

/**
 * Итог оплаты одной строкой с полоской — первое, что видит бухгалтер, — и
 * отметка «счёт отправлен» маленькой ссылкой рядом. Kaspi-счёт ставит эту
 * отметку сам; руками её ставят для счетов, отправленных мимо программы.
 */
function PaymentSummary({
  orderId,
  totalAmount,
  paidAmount,
  invoiceSentAt,
  consignment,
}: {
  orderId: string;
  totalAmount: number;
  paidAmount: number;
  invoiceSentAt: string;
  consignment: boolean;
}) {
  const left = totalAmount - paidAmount;
  const paid = left <= 1 && paidAmount > 0;
  const percent = totalAmount > 0 ? Math.min(100, Math.max(0, (paidAmount / totalAmount) * 100)) : 0;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-lg font-semibold tabular-nums">
          {paid ? (
            <span className="text-status-good">Оплачено {money(paidAmount)}</span>
          ) : left > 1 ? (
            <>
              {consignment ? "Не оплачено" : "К оплате"} {money(left)}
            </>
          ) : (
            money(totalAmount)
          )}
        </span>
        <span className="text-sm text-ink-secondary tabular-nums">
          счёт {money(totalAmount)}
          {paidAmount > 0 && !paid && ` · получено ${money(paidAmount)}`}
          {left < -1 && ` · переплата ${money(-left)}`}
        </span>
        <InvoiceMark orderId={orderId} invoiceSentAt={invoiceSentAt} hide={paid} />
      </div>
      {totalAmount > 0 && (
        <div className="h-1.5 rounded-full bg-surface-sunk overflow-hidden">
          <div
            className={clsx("h-full rounded-full", paid ? "bg-status-good" : "bg-[#8a5a00]")}
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
      {consignment && (
        <p className="text-xs text-ink-secondary">Реализация: остаток — непроданный цветок, а не долг.</p>
      )}
    </div>
  );
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return key || "—";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Номера реализаций в 1С — по одному на цветок. Бухгалтер: «менеджер заполняет
 * заявку на розу и эустому — выходит общая сумма в Rose Farm, а надо две суммы
 * реализации, как в 1С». Компания одна, документов в 1С два, и у каждого своя
 * сумма: она стоит рядом с полем, чтобы номер вписывали к нужной сумме.
 */
function RealizationRow({ orderId, realizations }: { orderId: string; realizations: Realization[] }) {
  const router = useRouter();
  const initial = Object.fromEntries(realizations.map((r) => [r.flowerType, r.number]));
  const [draft, setDraft] = useState<Record<string, string>>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = realizations.some((r) => (draft[r.flowerType] ?? "").trim() !== r.number.trim());
  const several = realizations.length > 1;

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        unwrap(await setRealizationAction(orderId, draft));
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
      }
    });
  }

  if (realizations.length === 0) return null;
  const filled = realizations.filter((r) => r.number.trim());

  return (
    <details className="group rounded-xl border border-line-hairline">
      <summary className="px-3 py-2.5 text-sm cursor-pointer select-none flex items-center gap-2 list-none [&::-webkit-details-marker]:hidden">
        <span className="font-medium">Номер 1С</span>
        <span className={clsx("text-xs", filled.length ? "text-ink-secondary" : "text-ink-muted")}>
          {filled.length === 0
            ? "не вписан"
            : filled.map((r) => (several ? `${r.label}: ${r.number}` : r.number)).join(" · ")}
          {filled.length > 0 && filled.length < realizations.length && ` · ещё ${realizations.length - filled.length} не вписан`}
        </span>
        <span className="ml-auto text-ink-muted transition-transform group-open:rotate-90">›</span>
      </summary>
    <div className="px-3 pb-3 space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        {realizations.map((r) => (
          <label key={r.flowerType} className="text-sm">
            <span className="block text-ink-secondary mb-1">
              {several ? (
                <>
                  № 1С · {r.label} <span className="tabular-nums text-ink-primary">{money(r.amount)}</span>
                </>
              ) : (
                "№ реализации в 1С"
              )}
            </span>
            <input
              className="input !w-44"
              value={draft[r.flowerType] ?? ""}
              placeholder="например, РН-000123"
              maxLength={40}
              onChange={(e) => {
                setDraft((d) => ({ ...d, [r.flowerType]: e.target.value }));
                setSaved(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && changed) save();
              }}
            />
          </label>
        ))}
        {changed && (
          <button onClick={save} disabled={pending} className="btn-secondary disabled:opacity-50">
            {pending ? "Сохраняю…" : several ? "Сохранить номера" : "Сохранить номер"}
          </button>
        )}
        {saved && !changed && <span className="text-sm text-status-good">сохранено</span>}
      </div>
      {error && <div className="text-sm text-status-critical">{error}</div>}
    </div>
    </details>
  );
}

/**
 * Какими частями платил клиент. Раньше это было одно число «получено всего», и
 * второй платёж бухгалтер складывала с первым в уме.
 */
function PaymentsList({
  orderId,
  totalAmount,
  paidAmount,
  payments,
  farms,
  status,
}: {
  orderId: string;
  totalAmount: number;
  paidAmount: number;
  payments: FinancePayment[];
  farms: FarmPayment[];
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const history = paymentHistory(paidAmount, payments);
  const today = todayKey();
  const farmLabel = (farm: string) => farms.find((f) => f.farm === farm)?.farmLabel ?? farm;

  function remove(p: FinancePayment) {
    if (!window.confirm(`Удалить платёж ${money(p.amount)} за ${dayLabel(p.date)}?`)) return;
    setError(null);
    startTransition(async () => {
      try {
        unwrap(await removePaymentAction(orderId, p.paymentId));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось удалить");
      }
    });
  }

  if (history.rows.length === 0 && history.unrecorded === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">Платежи</div>
      <ul className="text-sm divide-y divide-line-hairline rounded-xl border border-line-hairline">
        {history.unrecorded !== 0 && (
          <li className="flex flex-wrap items-baseline gap-x-3 px-3 py-2 text-ink-secondary">
            <span className="tabular-nums font-medium w-28">{money(history.unrecorded)}</span>
            <span className="flex-1 min-w-0">
              {history.unrecorded > 0
                ? "внесено раньше одной суммой"
                : "исправление итога вручную"}
            </span>
          </li>
        )}
        {history.rows.map((p) => {
          const full = payments.find((x) => x.paymentId === p.paymentId)!;
          const canRemove =
            status !== "cancelled" && (status !== "shipped" || full.enteredOn === today);
          return (
            <li key={p.paymentId} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
              <span className="tabular-nums font-medium w-28">{money(p.amount)}</span>
              <span className="flex-1 min-w-0 text-ink-secondary">
                {dayLabel(p.date)} · {p.method}
                {p.farm && farms.length > 1 && ` · ${farmLabel(p.farm)}`}
              </span>
              {canRemove && (
                <button
                  onClick={() => remove(full)}
                  disabled={pending}
                  className="text-xs text-ink-muted hover:text-status-critical disabled:opacity-50"
                >
                  удалить
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * Новый платёж: сколько пришло, когда и как. Итог заявки сервер складывает
 * сам — «к предыдущей сумме вручную добавлять последующую» больше не нужно.
 *
 * Смешанная оплата — часть картой, часть наличными (просьба бухгалтера) —
 * вносится одним поступлением из нескольких строк: у каждой свой способ и своя
 * сумма, и в журнал каждая ложится отдельным платежом.
 */
function AddPayment({
  orderId,
  totalAmount,
  paidAmount,
  farms,
  defaultMethod,
}: {
  orderId: string;
  totalAmount: number;
  paidAmount: number;
  farms: FarmPayment[];
  defaultMethod: string;
}) {
  const router = useRouter();
  const split = farms.length > 1;
  // У смешанной заявки сразу выбрана компания, которой ещё недоплатили.
  const firstOwed = farms.find((f) => f.amount - f.paidAmount > 1)?.farm ?? farms[0]?.farm ?? "";
  const [farm, setFarm] = useState(split ? firstOwed : "");
  const owedFor = (f: string) => {
    const row = farms.find((x) => x.farm === f);
    return split && row ? Math.max(0, row.amount - row.paidAmount) : Math.max(0, totalAmount - paidAmount);
  };
  const mixed = defaultMethod === MIXED_PAYMENT_METHOD;
  const firstMethod = PAYMENT_METHODS.includes(defaultMethod as never) ? defaultMethod : PAYMENT_METHODS[0];
  // Менеджер написал «Смешанная» — сразу две строки: картой и наличными.
  const [lines, setLines] = useState<{ amount: number; method: string }[]>(
    mixed
      ? [
          { amount: 0, method: PAYMENT_METHODS[0] },
          { amount: 0, method: PAYMENT_METHODS[1] },
        ]
      : [{ amount: 0, method: firstMethod }]
  );
  const [date, setDate] = useState(todayKey());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const owed = owedFor(farm);
  const total = Math.round(lines.reduce((s, l) => s + (l.amount || 0), 0) * 100) / 100;
  const unusedMethod = PAYMENT_METHODS.find((m) => !lines.some((l) => l.method === m));

  function setLine(i: number, patch: Partial<{ amount: number; method: string }>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function fillRest() {
    // Остаток кладётся в последнюю строку: в первых уже стоят известные части.
    const others = lines.slice(0, -1).reduce((s, l) => s + (l.amount || 0), 0);
    const rest = Math.max(0, Math.round((owed - others) * 100) / 100);
    setLine(lines.length - 1, { amount: rest });
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        unwrap(
          await addPaymentAction({
            orderId,
            date,
            farm,
            lines: lines.filter((l) => l.amount > 0),
          })
        );
        setLines([{ amount: 0, method: firstMethod }]);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        {split && (
          <label className="text-sm">
            <span className="block text-ink-secondary mb-1">Какой компании</span>
            <select className="input !w-auto" value={farm} onChange={(e) => setFarm(e.target.value)}>
              {farms.map((f) => (
                <option key={f.farm} value={f.farm}>
                  {f.farmLabel}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="block text-ink-secondary mb-1">Когда пришли</span>
          <input
            type="date"
            className="input !w-auto"
            value={date}
            max={todayKey()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </div>

      <div className="space-y-2">
        {lines.map((line, i) => (
          <div key={i} className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              {i === 0 && <span className="block text-ink-secondary mb-1">Сумма, ₸</span>}
              <input
                className="input !w-36 text-right tabular-nums"
                inputMode="decimal"
                value={line.amount ? line.amount.toLocaleString("ru-RU") : ""}
                placeholder={
                  lines.length === 1 && owed > 0 ? Math.round(owed).toLocaleString("ru-RU") : ""
                }
                onFocus={(e) => e.target.select()}
                onChange={(e) => setLine(i, { amount: parseNumber(e.target.value) })}
              />
            </label>
            <label className="text-sm">
              {i === 0 && <span className="block text-ink-secondary mb-1">Способ</span>}
              <select
                className="input !w-auto"
                value={line.method}
                onChange={(e) => setLine(i, { method: e.target.value })}
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                className="text-xs text-ink-muted hover:text-status-critical pb-3"
              >
                убрать
              </button>
            )}
          </div>
        ))}
        {unusedMethod && (
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, { amount: 0, method: unusedMethod }])}
            className="text-sm text-accent hover:underline"
          >
            + часть другим способом
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={pending || total <= 0}
          className="btn-primary disabled:opacity-50"
        >
          {pending
            ? "Сохраняю…"
            : lines.length > 1
              ? `Внести ${money(total)}`
              : "Внести платёж"}
        </button>
        {owed > 1 && Math.abs(total - owed) > 0.5 && (
          <button type="button" onClick={fillRest} className="btn-secondary">
            {lines.length > 1 ? "Добить остаток" : `Весь остаток ${money(owed)}`}
          </button>
        )}
        {lines.length > 1 && owed > 0 && (
          <span className="text-xs text-ink-muted">
            к оплате {money(owed)}
            {total > 0 && Math.abs(total - owed) > 0.5 && ` · разница ${money(owed - total)}`}
          </span>
        )}
      </div>
      {defaultMethod && (
        <p className="text-xs text-ink-muted">Менеджер указал: {defaultMethod}</p>
      )}
      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  );
}

/**
 * Отметка «счёт отправлен клиенту» — первая ступень оплаты: «не оплачено»
 * иначе отвечало сразу на два вопроса — счёт не выставили или клиент тянет.
 * Kaspi-счёт ставит её сам, поэтому здесь она — маленькая ссылка в строке итога.
 */
function InvoiceMark({ orderId, invoiceSentAt, hide }: { orderId: string; invoiceSentAt: string; hide: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sent = Boolean((invoiceSentAt || "").trim());
  if (hide && !sent) return null;

  function toggle() {
    setError(null);
    startTransition(async () => {
      try {
        unwrap(await setInvoiceSentAction(orderId, !sent));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
      }
    });
  }

  return (
    <span className="text-xs">
      {sent ? (
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          title="Снять отметку"
          className="text-status-good hover:line-through disabled:opacity-50"
        >
          ✓ счёт отправлен {formatMoment(invoiceSentAt)}
        </button>
      ) : (
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="text-ink-muted hover:text-accent underline decoration-dotted disabled:opacity-50"
        >
          {pending ? "сохраняю…" : "отметить: счёт отправлен"}
        </button>
      )}
      {error && <span className="text-status-critical ml-2">{error}</span>}
    </span>
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
        unwrap(await setPaymentAction(orderId, amount, method));
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
        Счёт {money(totalAmount)}
        {paidAmount > 0 && ` · внесено ${money(paidAmount)}`}
        {debt > 0 && ` · остаток ${money(debt)}`}
        {paidAmount > totalAmount + 1 &&
          ` · переплата ${money(paidAmount - totalAmount)} — вернуть или зачесть`}
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
        unwrap(await setPaymentByFarmAction(orderId, next, method));
        router.refresh();
        onDone?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
      }
    });
  }

  return (
    <div className="space-y-3">
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
          ` · переплата ${money(entered - totalAmount)} — вернуть или зачесть`}
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
