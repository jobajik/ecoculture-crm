"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { setPromiseAction } from "@/app/finance/actions";
import type { CallRow } from "@/lib/finance";
import MoreToggle from "./MoreToggle";
import PaymentPanel, { money } from "./PaymentPanel";

/** Сколько строк видно без разворота. Больше десяти звонков за раз не делают. */
const VISIBLE = 10;

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
 */
export default function CallsBoard({ calls, canEdit }: { calls: CallRow[]; canEdit: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [onlyDue, setOnlyDue] = useState(true);

  const rows = useMemo(
    () => (onlyDue ? calls.filter((c) => c.promiseState !== "future") : calls),
    [calls, onlyDue]
  );
  const shown = expanded ? rows : rows.slice(0, VISIBLE);
  const laterCount = calls.length - calls.filter((c) => c.promiseState !== "future").length;

  if (calls.length === 0) {
    return (
      <div className="card text-center py-10">
        <div className="text-2xl mb-2">✓</div>
        <p className="font-medium">Звонить некому</p>
        <p className="text-sm text-ink-secondary mt-1">Все заявки оплачены полностью.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium">Кому звонить сегодня</h2>
        {laterCount > 0 && (
          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={onlyDue}
              onChange={(e) => setOnlyDue(e.target.checked)}
              className="w-4 h-4"
            />
            Скрыть тех, кто обещал заплатить позже ({laterCount})
          </label>
        )}
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Клиент</th>
              <th className="px-4 py-3 font-medium">Телефон</th>
              <th className="px-4 py-3 font-medium text-right">Долг</th>
              <th className="px-4 py-3 font-medium">Почему в списке</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => {
              const style = STATE_STYLE[c.promiseState] ?? STATE_STYLE.none;
              return (
                <Fragment key={c.orderId}>
                  <tr
                    className={clsx(
                      "border-b border-line-hairline hover:bg-surface-plane",
                      openId === c.orderId && "bg-accent-soft/40"
                    )}
                  >
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className={clsx("w-2 h-2 rounded-full shrink-0", style.dot)} />
                        <Link href={`/orders/${c.orderId}`} className="font-medium hover:underline">
                          {c.clientName}
                        </Link>
                      </span>
                      <span className="block text-xs text-ink-muted ml-4">
                        менеджер {c.managerName}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
                      {c.clientPhone ? (
                        <a href={`tel:${c.clientPhone.replace(/[^\d+]/g, "")}`} className="hover:underline">
                          {c.clientPhone}
                        </a>
                      ) : (
                        <span className="text-ink-muted">телефона нет</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium whitespace-nowrap">
                      {money(c.debt)}
                    </td>
                    <td className={clsx("px-4 py-2.5", style.text)}>
                      {c.why}
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
                          {openId === c.orderId ? "Закрыть" : "Записать"}
                        </button>
                      ) : (
                        <span className="text-xs text-ink-muted">просмотр</span>
                      )}
                    </td>
                  </tr>
                  {openId === c.orderId && canEdit && (
                    <tr className="border-b border-line-hairline bg-accent-soft/20">
                      <td colSpan={5} className="px-4 py-4 space-y-4">
                        <PromiseForm row={c} onDone={() => setOpenId(null)} />
                        <div className="border-t border-line-hairline pt-4">
                          <PaymentPanel
                            orderId={c.orderId}
                            totalAmount={c.amount}
                            paidAmount={c.paidAmount}
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

      <MoreToggle
        expanded={expanded}
        hidden={rows.length - shown.length}
        onToggle={() => setExpanded((v) => !v)}
        what="долгов"
      />
    </div>
  );
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
        await setPromiseAction(row.orderId, nextDate, note);
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
            placeholder="Например: обещал перевести после отгрузки в Астану"
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
