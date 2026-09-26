"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { recordCallAction } from "@/app/clients/leads/calls/actions";
import { unwrapValue } from "@/lib/actionResult";
import {
  CALL_OUTCOMES,
  MAX_NO_ANSWER,
  NOT_INTERESTED_REASONS,
  defaultDateFor,
  outcomeLabel,
  type CallOutcome,
  type OutcomeGroup,
  type QueueItem,
} from "@/lib/calls";
import { whatsappLink } from "@/lib/leads";
import { formatDay, formatMoment } from "@/lib/formatDate";
import Icon from "./Icon";

const GROUP_STYLE: Record<OutcomeGroup, string> = {
  interest: "border-status-good/40 bg-status-good/10 text-status-good",
  later: "border-section-leads/30 bg-section-leads-soft text-section-leads",
  refused: "border-status-critical/30 bg-status-critical/5 text-status-critical",
  notours: "border-line-strong bg-surface-sunk text-ink-secondary",
  none: "border-status-warning/50 bg-status-warning/10 text-[#8a5a00]",
};

function prettyPhone(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length === 11) return `+${d[0]} ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7, 9)} ${d.slice(9)}`;
  return phone;
}
function telHref(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  if (d.length === 11) return `tel:+7${d.slice(1)}`;
  if (d.length === 10) return `tel:+7${d}`;
  return `tel:${phone}`;
}

/**
 * Экран обзвона для менеджера: один клиент, большая кнопка звонка и итог
 * одним нажатием. После записи сразу открывается следующий — очередь живёт
 * здесь, без перезагрузки страницы: каждое перечитывание — это чтение всей
 * базы из Google, а лимит у компании один (грабли 1.17).
 */
export default function CallDesk({
  items,
  counts,
  today,
  callsToday,
}: {
  items: QueueItem[];
  counts: { due: number; fresh: number; later: number };
  today: string;
  callsToday: number;
}) {
  const router = useRouter();
  // Очередь считается из присланной сервером: минус уже записанные здесь, а
  // пропущенные — в конец. Так она не «отскакивает» назад, когда страница
  // перечитается (после «обновить» или когда своя очередь кончилась).
  const [doneIds, setDoneIds] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const queue = useMemo(() => {
    const left = items.filter((i) => !doneIds.includes(i.leadId));
    const later = skipped.map((id) => left.find((i) => i.leadId === id)).filter((i): i is QueueItem => !!i);
    return [...left.filter((i) => !skipped.includes(i.leadId)), ...later];
  }, [items, doneIds, skipped]);
  const done = doneIds.length;
  // Сервер прислал свежую очередь (своя кончилась или «обновить») — в ней уже
  // учтены записанные звонки, и счётчики тоже свежие: начинаем счёт заново.
  useEffect(() => {
    setDoneIds([]);
    setSkipped([]);
  }, [items]);
  const [comment, setComment] = useState("");
  const [open, setOpen] = useState<CallOutcome | null>(null);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState<string>(NOT_INTERESTED_REASONS[0]);
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<{ name: string; text: string; clientId?: string } | null>(null);

  const current = queue[0];
  const left = Math.max(0, counts.due + counts.fresh - done);

  function reset() {
    setComment("");
    setOpen(null);
    setDate("");
    setCity("");
    setError(null);
  }

  async function record(outcome: CallOutcome) {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      const res = unwrapValue(
        await recordCallAction(current.leadId, {
          outcome: outcome.key,
          comment,
          date: date || defaultDateFor(outcome.key, today),
          reason,
          city,
        })
      );
      setLast({
        name: current.name,
        text: `${outcome.label}${res.nextTouchAt && !res.closed ? ` · следующий звонок ${formatDay(res.nextTouchAt)}` : ""}`,
        clientId: outcome.key === "order" ? res.clientId : undefined,
      });
      const id = current.leadId;
      setDoneIds((ids) => [...ids, id]);
      reset();
      if (queue.length <= 1) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось записать");
    } finally {
      setBusy(false);
    }
  }

  function choose(o: CallOutcome) {
    const needsMore = !!o.dateDays || o.key === "not_interested" || o.key === "order";
    if (!needsMore) {
      void record(o);
      return;
    }
    setOpen(o);
    setDate(defaultDateFor(o.key, today));
  }

  function skip() {
    if (queue.length < 2) return;
    reset();
    const id = queue[0].leadId;
    setSkipped((ids) => [...ids.filter((x) => x !== id), id]);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        <span>
          Сегодня звонков: <b className="font-display">{callsToday + done}</b>
        </span>
        <span className="text-ink-secondary">
          осталось: {left}
          {counts.due > 0 && ` (перезвонить ${counts.due})`}
          {counts.later > 0 && ` · отложено на другие дни: ${counts.later}`}
        </span>
      </div>

      {last && (
        <div className="card !py-2.5 text-sm flex flex-wrap items-center gap-x-3 gap-y-1 border-status-good/30 bg-status-good/5">
          <span className="text-status-good">✓</span>
          <span>
            <b>{last.name}</b> — {last.text}
          </span>
          {last.clientId && (
            <Link href={`/orders/new?client=${encodeURIComponent(last.clientId)}`} className="ml-auto btn-primary !py-1 !min-h-0 text-sm">
              Оформить заявку →
            </Link>
          )}
        </div>
      )}

      {!current ? (
        <div className="card text-center py-10 space-y-2">
          <div className="text-3xl">☎︎</div>
          <p className="font-display text-lg font-bold">На сегодня всё</p>
          <p className="text-sm text-ink-secondary">
            {counts.later > 0 ? `Перезвоны на другие дни: ${counts.later}. Они появятся здесь в свой день.` : "Новых клиентов для обзвона нет."}
          </p>
          <button type="button" className="btn-secondary" onClick={() => router.refresh()}>
            Обновить
          </button>
        </div>
      ) : (
        <section className="card !p-0 relative overflow-hidden">
          <span className="absolute inset-y-0 left-0 w-1 bg-section-leads" aria-hidden="true" />
          <div className="pl-5 pr-4 sm:pr-5 pt-4 pb-4 space-y-4">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-xl sm:text-2xl font-extrabold leading-tight break-words">{current.name}</h2>
                <div className="flex flex-wrap gap-1.5 mt-1.5 text-xs">
                  {current.why === "due" ? (
                    <span className={clsx("badge", current.nextTouchAt && current.nextTouchAt < today ? "bg-status-critical/10 text-status-critical" : "bg-section-leads-soft text-section-leads")}>
                      {current.nextTouchAt && current.nextTouchAt < today ? `обещали перезвонить ${formatDay(current.nextTouchAt)}` : "перезвон на сегодня"}
                    </span>
                  ) : (
                    <span className="badge bg-surface-sunk text-ink-secondary">ещё не звонили</span>
                  )}
                  {current.segment && (
                    <span className={clsx("badge", current.pastOrders > 0 ? "bg-accent-soft text-accent" : "bg-surface-sunk text-ink-secondary")}>
                      {current.segment}
                      {current.pastOrders > 0 && ` · покупал ${current.pastOrders} раз`}
                    </span>
                  )}
                  {current.attempts > 0 && (
                    <span className="badge bg-status-warning/15 text-[#8a5a00]">
                      не дозвонился {current.attempts} из {MAX_NO_ANSWER}
                    </span>
                  )}
                  {current.city && <span className="badge bg-surface-sunk text-ink-secondary">{current.city}</span>}
                </div>
              </div>
              <Link href={`/clients/leads/${current.leadId}`} className="text-sm text-accent hover:underline whitespace-nowrap">
                Карточка →
              </Link>
            </div>

            <div className="flex flex-wrap gap-2">
              <a href={telHref(current.phone)} className="btn-primary !text-lg !px-5 flex items-center gap-2">
                <Icon name="phone" className="w-5 h-5" />
                <span className="tabular-nums">{prettyPhone(current.phone)}</span>
              </a>
              {whatsappLink(current.phone) && (
                <a href={whatsappLink(current.phone)} target="_blank" rel="noreferrer" className="btn-secondary">
                  WhatsApp
                </a>
              )}
            </div>
            {current.contactPerson && <p className="text-sm">Контакт: {current.contactPerson}</p>}

            {(current.history || current.note) && (
              <div className="rounded-lg bg-surface-plane px-3 py-2 text-sm space-y-1">
                <div className="text-xs text-ink-muted">Что известно</div>
                {current.history && <p className="break-words">{current.history}</p>}
                {current.note && <p className="break-words text-ink-secondary">{current.note}</p>}
              </div>
            )}

            {current.recent.length > 0 && (
              <ul className="text-sm space-y-1">
                {current.recent.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-xs text-ink-muted tabular-nums whitespace-nowrap pt-px">{formatMoment(t.at)}</span>
                    <span className="min-w-0 break-words">{t.comment || outcomeLabel(t.outcome)}</span>
                  </li>
                ))}
              </ul>
            )}

            <textarea
              className="input min-h-[60px]"
              placeholder="Что сказал клиент (необязательно)"
              value={comment}
              maxLength={1000}
              onChange={(e) => setComment(e.target.value)}
            />

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CALL_OUTCOMES.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  disabled={busy}
                  onClick={() => choose(o)}
                  className={clsx(
                    "rounded-lg border px-3 py-2.5 text-sm font-medium text-left leading-snug disabled:opacity-50 min-h-[44px]",
                    GROUP_STYLE[o.group],
                    open?.key === o.key && "ring-2 ring-offset-1 ring-current"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>

            {open && (
              <div className="rounded-lg border border-line-hairline p-3 space-y-3 text-sm">
                <div className="font-medium">{open.label}</div>
                {open.dateDays !== undefined && (
                  <label className="block">
                    <span className="text-xs text-ink-muted">Когда позвонить снова</span>
                    <input type="date" className="input mt-1 !w-auto" value={date} min={today} onChange={(e) => setDate(e.target.value)} />
                  </label>
                )}
                {open.key === "not_interested" && (
                  <div className="flex flex-wrap gap-1.5">
                    {NOT_INTERESTED_REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setReason(r)}
                        className={clsx("rounded-full border px-3 py-1", reason === r ? "border-accent bg-accent/10 font-medium" : "border-line-hairline")}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                )}
                {open.key === "order" && !current.clientId && (
                  <p className="text-ink-secondary">Заведу карточку клиента — сразу после этого можно оформить заявку.</p>
                )}
                {open.key === "order" && !current.city && !current.clientId && (
                  <label className="block">
                    <span className="text-xs text-ink-muted">Город — без него карточку клиента не завести</span>
                    <input className="input mt-1" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Алматы" />
                  </label>
                )}
                <div className="flex gap-2">
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => record(open)}>
                    {busy ? "Записываю…" : "Записать"}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setOpen(null)}>
                    Отмена
                  </button>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-status-critical">{error}</p>}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-secondary">
              {queue.length > 1 && (
                <button type="button" className="text-accent hover:underline" onClick={skip}>
                  Пропустить — позвоню позже
                </button>
              )}
              {queue.length > 1 && <span className="text-xs">дальше: {queue.slice(1, 3).map((q) => q.name).join(", ")}</span>}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
