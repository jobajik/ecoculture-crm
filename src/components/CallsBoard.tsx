"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { setPromiseAction } from "@/app/finance/actions";
import type { CallRow, DebtRow } from "@/lib/finance";
import Pager, { pageSlice } from "./Pager";
import Chips from "./Chips";
import PaymentPanel, { money } from "./PaymentPanel";
import { unwrap } from "@/lib/actionResult";

const STATE_STYLE: Record<string, { dot: string; text: string }> = {
  broken: { dot: "bg-status-critical", text: "text-status-critical" },
  today: { dot: "bg-[#8a5a00]", text: "text-[#8a5a00]" },
  none: { dot: "bg-ink-muted", text: "text-ink-secondary" },
  future: { dot: "bg-status-good", text: "text-status-good" },
};

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** «2026-10-13…» → «13.10». */
function dayMonth(key: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(key) ? `${key.slice(8, 10)}.${key.slice(5, 7)}` : "";
}

/**
 * «Кому звонить сегодня».
 *
 * Таблица долгов по клиентам отвечает на вопрос «сколько нам должны», а этот
 * список — на вопрос «что мне сейчас делать». Поэтому здесь строка на заявку,
 * телефон на виду, и сверху те, кто обещал заплатить и не заплатил: обещание,
 * которое никто не проверил, — это просто вежливый отказ.
 *
 * Тот, кто обещал заплатить позже, лежит внизу и помечен зелёным — его сегодня
 * не трогают. Без этого через неделю в списке снова все, и звонить перестают.
 *
 * Вид (19.10.2026): одна карточка, вкладки «Кому звонить» / «Долг по клиентам», отборы кнопками, листание страницами.
 */
export default function CallsBoard({
  calls,
  debts,
  canEdit,
}: {
  calls: CallRow[];
  debts: DebtRow[];
  canEdit: boolean;
}) {
  const [view, setView] = useState<"calls" | "clients">("calls");
  const [openId, setOpenId] = useState<string | null>(null);
  // «Звонить сейчас» по умолчанию — все, кроме обещавших позже: их сегодня не трогают.
  const [filter, setFilter] = useState<"due" | "broken" | "today" | "none" | "future" | "all">("due");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  useEffect(() => {
    setPage(0);
    setOpenId(null);
  }, [view, filter, search]);

  const q = search.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const hit = (...vals: string[]) =>
    !q ||
    vals.some(
      (v) =>
        v.toLowerCase().includes(q) || (qDigits.length >= 3 && v.replace(/\D/g, "").includes(qDigits))
    );
  const count = (st: string) => calls.filter((c) => c.promiseState === st).length;
  const rows = useMemo(
    () =>
      calls
        .filter((c) =>
          filter === "all" ? true : filter === "due" ? c.promiseState !== "future" : c.promiseState === filter
        )
        .filter((c) => hit(c.clientName, c.clientPhone, c.managerName, c.code)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calls, filter, q]
  );
  const debtRows = debts.filter((d) => hit(d.clientName, d.clientPhone, d.managerName));
  const tabBtn = (on: boolean) =>
    clsx(
      "px-4 py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
      on ? "border-section-money text-ink-primary font-semibold" : "border-transparent text-ink-secondary hover:text-ink-primary"
    );

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex gap-1 px-2 border-b border-line-hairline overflow-x-auto scroll-x-hidden">
        <button type="button" className={tabBtn(view === "calls")} onClick={() => setView("calls")}>
          Кому звонить ({calls.filter((c) => c.promiseState !== "future").length})
        </button>
        <button type="button" className={tabBtn(view === "clients")} onClick={() => setView("clients")}>
          Долг по клиентам ({debts.length})
        </button>
      </div>

      <div className="px-4 py-3 border-b border-line-hairline flex flex-col lg:flex-row lg:items-center gap-2">
        {view === "calls" ? (
          <Chips
            className="min-w-0 flex-1"
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
            items={[
              { value: "due", label: "Звонить сейчас", count: calls.length - count("future") },
              { value: "broken", label: "Обещали и не заплатили", count: count("broken"), alarm: true },
              { value: "today", label: "Обещали на сегодня", count: count("today") },
              { value: "none", label: "Без обещания", count: count("none") },
              { value: "future", label: "Обещали позже", count: count("future") },
              { value: "all", label: "Все", count: calls.length },
            ]}
          />
        ) : (
          <div className="flex-1 text-xs text-ink-muted">Строка на клиента · сверху самые старые долги.</div>
        )}
        <input
          className="input !w-full lg:!w-60 flex-none"
          placeholder="Клиент, телефон, №"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {view === "calls" ? (
        calls.length === 0 || rows.length === 0 ? (
          <div className="text-center py-10">
            <div className="text-2xl mb-2">✓</div>
            <p className="font-medium">{calls.length === 0 ? "Звонить некому" : q ? "Ничего не нашлось" : "В этом отборе пусто"}</p>
          </div>
        ) : (
          <>
            <div className="table-scroll table-cards">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted bg-surface-plane/60 border-b border-line-hairline">
                    <th className="px-4 py-2.5 font-medium">Клиент</th>
                    <th className="px-4 py-2.5 font-medium">Телефон</th>
                    <th className="px-4 py-2.5 font-medium text-right">Долг</th>
                    <th className="px-4 py-2.5 font-medium">Почему в списке</th>
                    <th className="px-4 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {pageSlice(rows, page).map((c) => {
                    const style = STATE_STYLE[c.promiseState] ?? STATE_STYLE.none;
                    return (
                      <Fragment key={c.orderId}>
                        <tr
                          className={clsx(
                            "border-b border-line-hairline hover:bg-surface-plane",
                            openId === c.orderId && "bg-section-money-soft/30"
                          )}
                        >
                          <td data-label="Клиент" className="px-4 py-2.5">
                            <span className="flex items-center gap-2">
                              <span className={clsx("w-2 h-2 rounded-full shrink-0", style.dot)} />
                              <Link href={`/orders/${c.orderId}`} className="font-medium hover:underline">
                                {c.clientName}
                              </Link>
                            </span>
                            <span className="block text-xs text-ink-muted ml-4">
                              {c.managerName} · <span className="font-mono">{c.code}</span>
                            </span>
                          </td>
                          <td data-label="Телефон" className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                            {c.clientPhone ? (
                              <a href={`tel:${c.clientPhone.replace(/[^\d+]/g, "")}`} className="hover:underline">
                                {c.clientPhone}
                              </a>
                            ) : (
                              <span className="text-ink-muted">телефона нет</span>
                            )}
                          </td>
                          <td data-label="Долг" className="px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
                            {money(c.debt)}
                          </td>
                          <td data-label="Почему в списке" className={clsx("px-4 py-2.5", style.text)}>
                            {c.why}
                            {c.remindedAt && (
                              <span className="block text-xs text-ink-muted">
                                напомнили в WhatsApp {dayMonth(c.remindedAt)}
                              </span>
                            )}
                            {c.collectionNote && (
                              <span className="block text-xs text-ink-muted">{c.collectionNote}</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            {canEdit ? (
                              <button
                                onClick={() => setOpenId(openId === c.orderId ? null : c.orderId)}
                                className="btn-secondary !py-1 !px-2.5 text-xs"
                              >
                                {openId === c.orderId ? "Закрыть" : "Обещание / оплата"}
                              </button>
                            ) : (
                              <span className="text-xs text-ink-muted">просмотр</span>
                            )}
                          </td>
                        </tr>
                        {openId === c.orderId && canEdit && (
                          <tr className="border-b border-line-hairline bg-section-money-soft/20">
                            <td colSpan={5} className="px-4 py-4 space-y-4">
                              <PromiseForm row={c} onDone={() => setOpenId(null)} />
                              <div className="border-t border-line-hairline pt-4">
                                <PaymentPanel
                                  orderId={c.orderId}
                                  totalAmount={c.amount}
                                  paidAmount={c.paidAmount}
                                  farms={c.farms}
                                  invoiceSentAt={c.invoiceSentAt}
                                  payments={c.payments}
                                  realizations={c.realizations}
                                  defaultMethod={c.paymentMethod}
                                  status={c.status}
                                  consignment={c.consignment}
                                  onDone={() => setOpenId(null)}
                                />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager total={rows.length} page={page} onPage={setPage} what="долгов" />
          </>
        )
      ) : debtRows.length === 0 ? (
        <div className="text-center py-10">
          <div className="text-2xl mb-2">✓</div>
          <p className="font-medium">{debts.length === 0 ? "Долгов нет" : "Ничего не нашлось"}</p>
        </div>
      ) : (
        <>
          <div className="table-scroll table-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-muted bg-surface-plane/60 border-b border-line-hairline">
                  <th className="px-4 py-2.5 font-medium">Клиент</th>
                  <th className="px-4 py-2.5 font-medium">Телефон</th>
                  <th className="px-4 py-2.5 font-medium">Менеджер</th>
                  <th className="px-4 py-2.5 font-medium text-right">Заявок</th>
                  <th className="px-4 py-2.5 font-medium text-right">Сумма</th>
                  <th className="px-4 py-2.5 font-medium text-right">Возраст</th>
                </tr>
              </thead>
              <tbody>
                {pageSlice(debtRows, page).map((d) => (
                  <tr key={d.clientName} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                    <td className="px-4 py-2.5 font-medium">{d.clientName}</td>
                    <td data-label="Телефон" className="px-4 py-2.5 text-ink-secondary tabular-nums">
                      {d.clientPhone || "—"}
                    </td>
                    <td data-label="Менеджер" className="px-4 py-2.5 text-ink-secondary">{d.managerName}</td>
                    <td data-label="Заявок" className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">{d.orders}</td>
                    {/* Под суммой — сколько из неё просрочено: число с плитки «Просрочено» должно находиться здесь. */}
                    <td data-label="Сумма" className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {money(d.amount)}
                      {d.overdueAmount > 0 && d.overdueAmount < d.amount - 1 && (
                        <div className="text-xs font-normal text-status-critical">
                          из них просрочено {money(d.overdueAmount)}
                        </div>
                      )}
                    </td>
                    <td data-label="Возраст" className="px-4 py-2.5 text-right tabular-nums">
                      <span className={d.overdue ? "text-status-critical font-medium" : "text-ink-secondary"}>
                        {d.oldestDays} {dayWord(d.oldestDays)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager total={debtRows.length} page={page} onPage={setPage} what="клиентов" />
        </>
      )}
    </div>
  );
}

function dayWord(n: number): string {
  const t = Math.abs(n) % 100;
  const o = t % 10;
  if (t > 10 && t < 20) return "дней";
  if (o > 1 && o < 5) return "дня";
  if (o === 1) return "день";
  return "дней";
}

function PromiseForm({ row, onDone }: { row: CallRow; onDone: () => void }) {
  const router = useRouter();
  const [date, setDate] = useState(row.promisedAt || todayKey());
  const [note, setNote] = useState(row.collectionNote);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(nextDate: string) {
    setError(null);
    startTransition(async () => {
      try {
        unwrap(await setPromiseAction(row.orderId, nextDate, note));
        router.refresh();
        onDone();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось сохранить");
      }
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-ink-secondary mb-1">Обещал заплатить до</span>
          <input
            type="date"
            className="input !w-auto"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className="text-sm flex-1 min-w-[220px]">
          <span className="block text-ink-secondary mb-1">О чём договорились</span>
          <input
            className="input"
            placeholder="например, переведёт в пятницу"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button onClick={() => save(date)} disabled={pending} className="btn-primary disabled:opacity-50">
          {pending ? "Сохраняю…" : "Записать обещание"}
        </button>
        {row.promisedAt && (
          <button onClick={() => save("")} disabled={pending} className="btn-secondary disabled:opacity-50">
            Убрать обещание
          </button>
        )}
      </div>
      {error && <div className="text-sm text-status-critical">{error}</div>}
    </div>
  );
}
