"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { distributeLeadsAction } from "@/app/clients/leads/calls/actions";
import { unwrapValue } from "@/lib/actionResult";
import { CALL_OUTCOMES, FAST_MARK_SECONDS, OUTCOME_GROUPS, outcomeLabel, outcomeOf, type CallReport as Report, type OutcomeGroup } from "@/lib/calls";
import { formatMoment } from "@/lib/formatDate";
import Section from "./Section";
import Hint from "./Hint";
import MoreToggle from "./MoreToggle";

const GROUP_BAR: Record<OutcomeGroup, string> = {
  interest: "bg-status-good",
  later: "bg-section-leads",
  refused: "bg-status-critical",
  notours: "bg-line-strong",
  none: "bg-status-warning",
};
const GROUP_TEXT: Record<OutcomeGroup, string> = {
  interest: "text-status-good",
  later: "text-section-leads",
  refused: "text-status-critical",
  notours: "text-ink-secondary",
  none: "text-[#8a5a00]",
};

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

/**
 * Итоги обзвона для РОПа и владельца: сколько обзвонили, чем закончилось по
 * каждому клиенту, кто как звонит и что говорили на каждом звонке.
 */
export default function CallReport({
  report,
  managers,
}: {
  report: Report;
  managers: { email: string; name: string }[];
}) {
  const r = report;
  const touchedTotal = r.called;
  const interest = r.byGroup.interest;
  const orders = r.byOutcome.find((o) => o.key === "order")?.count ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Позвонили" value={`${touchedTotal} из ${r.leads}`} sub={`${pct(touchedTotal, r.leads)} % базы · осталось ${r.untouched}`} />
        <Tile label="Дозвонились" value={String(r.reached)} sub={`${pct(r.reached, touchedTotal)} % из тех, кому звонили`} />
        <Tile label="Интерес" value={String(interest)} sub={`из них договорились о заказе: ${orders}`} tone="good" />
        <Tile label="Звонков сегодня" value={String(r.callsToday)} sub={r.unassigned > 0 ? `ничьих в обзвоне: ${r.unassigned}` : "вся база раздана"} />
      </div>

      {r.silentToday.length > 0 && (
        <p className="card !py-2.5 text-sm border-status-warning/40 bg-status-warning/10">
          Сегодня ещё не звонили: <b>{r.silentToday.join(", ")}</b>
        </p>
      )}

      <Section
        tone="leads"
        icon="chart"
        className="!mb-0"
        title={
          <>
            Чем закончилось
            <span className="normal-case tracking-normal">
              <Hint>По каждому клиенту — итог ПОСЛЕДНЕГО звонка. Кому ещё не звонили, здесь нет.</Hint>
            </span>
          </>
        }
      >
        {touchedTotal === 0 ? (
          <p className="text-sm text-ink-muted">Звонков по этому обзвону ещё не было.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex h-3 rounded-full overflow-hidden bg-surface-sunk">
              {OUTCOME_GROUPS.map((g) =>
                r.byGroup[g.key] > 0 ? (
                  <span key={g.key} className={GROUP_BAR[g.key]} style={{ width: `${(r.byGroup[g.key] / touchedTotal) * 100}%` }} title={`${g.label}: ${r.byGroup[g.key]}`} />
                ) : null
              )}
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 text-sm">
              {OUTCOME_GROUPS.map((g) => (
                <div key={g.key}>
                  <div className={clsx("font-medium", GROUP_TEXT[g.key])}>
                    {g.label} · {r.byGroup[g.key]} <span className="text-ink-muted font-normal">({pct(r.byGroup[g.key], touchedTotal)} %)</span>
                  </div>
                  <ul className="text-xs text-ink-secondary mt-0.5">
                    {r.byOutcome
                      .filter((o) => o.group === g.key && o.count > 0)
                      .map((o) => (
                        <li key={o.key}>
                          {o.label} — {o.count}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section tone="leads" icon="client" title="По менеджерам" flush className="!mb-0">
        <div className="table-cards border-t border-line-hairline">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line-hairline">
                <th className="px-4 py-2 font-medium">Менеджер</th>
                <th className="px-3 py-2 font-medium text-right">Выдано</th>
                <th className="px-3 py-2 font-medium text-right">Позвонил</th>
                <th className="px-3 py-2 font-medium text-right">Осталось</th>
                <th className="px-3 py-2 font-medium text-right">Сегодня</th>
                <th className="px-3 py-2 font-medium text-right">Дозвон</th>
                <th className="px-3 py-2 font-medium text-right">Интерес</th>
                <th className="px-3 py-2 font-medium text-right">Позже</th>
                <th className="px-3 py-2 font-medium text-right">Отказ</th>
                <th className="px-3 py-2 font-medium text-right">Не наш</th>
                <th className="px-4 py-2 font-medium text-right">
                  Быстрые
                  <Hint>Отметка итога меньше чем через {FAST_MARK_SECONDS} секунд после предыдущей — за это время позвонить нельзя. Повод посмотреть, звонит ли человек на самом деле.</Hint>
                </th>
              </tr>
            </thead>
            <tbody>
              {r.managers.map((m) => (
                <tr key={m.email} className="border-b border-line-hairline/70 last:border-0">
                  <td className="px-4 py-2 font-medium">
                    {m.name}
                    {m.lastCallAt && <span className="block text-xs text-ink-muted font-normal">последний звонок {formatMoment(m.lastCallAt)}</span>}
                  </td>
                  <td data-label="Выдано" className="px-3 py-2 text-right tabular-nums">{m.assigned}</td>
                  <td data-label="Позвонил" className="px-3 py-2 text-right tabular-nums">{m.called}</td>
                  <td data-label="Осталось" className="px-3 py-2 text-right tabular-nums">{m.untouched}</td>
                  <td data-label="Сегодня" className={clsx("px-3 py-2 text-right tabular-nums", m.open > 0 && m.callsToday === 0 && "text-status-critical")}>
                    {m.callsToday}
                  </td>
                  <td data-label="Дозвон" className="px-3 py-2 text-right tabular-nums">{m.called ? `${pct(m.reached, m.called)} %` : ""}</td>
                  <td data-label="Интерес" className="px-3 py-2 text-right tabular-nums text-status-good">
                    {m.byGroup.interest || ""}
                    {m.orders > 0 && <span className="block text-xs">заказ {m.orders}</span>}
                  </td>
                  <td data-label="Позже" className="px-3 py-2 text-right tabular-nums">{m.byGroup.later || ""}</td>
                  <td data-label="Отказ" className="px-3 py-2 text-right tabular-nums">{m.byGroup.refused || ""}</td>
                  <td data-label="Не наш" className="px-3 py-2 text-right tabular-nums text-ink-muted">{m.byGroup.notours || ""}</td>
                  <td data-label="Быстрые" className={clsx("px-4 py-2 text-right tabular-nums", m.fast > 0 && "text-[#8a5a00] font-medium")}>
                    {m.fast || ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <DistributeForm report={r} managers={managers} />

      <CallFeed report={r} managers={managers} />
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "good" }) {
  return (
    <div className="card !py-3">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={clsx("font-display text-2xl font-extrabold tabular-nums", tone === "good" && "text-status-good")}>{value}</div>
      <div className="text-xs text-ink-secondary mt-0.5">{sub}</div>
    </div>
  );
}

/** Раздать ничьих или нетронутых у одного менеджера — поровну между отмеченными. */
function DistributeForm({ report, managers }: { report: Report; managers: { email: string; name: string }[] }) {
  const router = useRouter();
  const sources = [
    ...(report.unassigned > 0 ? [{ email: "", label: `Ничьи — ${report.unassigned}` }] : []),
    ...report.managers.filter((m) => m.untouched > 0).map((m) => ({ email: m.email, label: `${m.name} — ещё не звонил ${m.untouched}` })),
  ];
  const [from, setFrom] = useState(sources[0]?.email ?? "");
  const [to, setTo] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (sources.length === 0) return null;

  async function run() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = unwrapValue(await distributeLeadsAction({ campaign: report.campaign, from, to }));
      setNote(`Раздано: ${res.moved}`);
      setTo([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось раздать");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      tone="leads"
      icon="arrow"
      className="!mb-0"
      title={
        <>
          Раздать
          <span className="normal-case tracking-normal">
            <Hint>Поровну и случайно. Перекладываются только те, кому ещё не звонили: у остальных уже есть разговор и договорённость.</Hint>
          </span>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <label className="flex flex-wrap items-center gap-2">
          <span className="text-ink-secondary">Кого:</span>
          <select className="input !w-auto !py-1" value={from} onChange={(e) => setFrom(e.target.value)}>
            {sources.map((s) => (
              <option key={s.email || "free"} value={s.email}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-ink-secondary mr-1">Кому:</span>
          {managers
            .filter((m) => m.email !== from)
            .map((m) => {
              const on = to.includes(m.email);
              return (
                <button
                  key={m.email}
                  type="button"
                  onClick={() => setTo(on ? to.filter((x) => x !== m.email) : [...to, m.email])}
                  className={clsx(
                    "rounded-full border px-3 py-1",
                    on ? "border-section-leads bg-section-leads-soft text-section-leads font-medium" : "border-line-hairline text-ink-secondary"
                  )}
                >
                  {on ? "✓ " : ""}
                  {m.name}
                </button>
              );
            })}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className="btn-primary disabled:opacity-50" disabled={busy || to.length === 0} onClick={run}>
            {busy ? "Раздаю…" : "Раздать поровну"}
          </button>
          {note && <span className="text-status-good">{note}</span>}
          {error && <span className="text-status-critical">{error}</span>}
        </div>
      </div>
    </Section>
  );
}

/** Каждый звонок: кто, кому, когда, итог и что сказали. */
function CallFeed({ report, managers }: { report: Report; managers: { email: string; name: string }[] }) {
  const [who, setWho] = useState("");
  const [outcome, setOutcome] = useState("");
  const [expanded, setExpanded] = useState(false);
  const list = useMemo(
    () => report.feed.filter((f) => (!who || f.managerEmail === who) && (!outcome || f.outcome === outcome)),
    [report.feed, who, outcome]
  );
  const filtered = !!(who || outcome);
  const shown = expanded || filtered ? list.slice(0, 300) : list.slice(0, 25);

  return (
    <Section
      tone="leads"
      icon="phone"
      flush
      className="!mb-0"
      title={`Звонки · ${report.feed.length}`}
      aside={
        <div className="flex flex-wrap gap-2">
          <select className="input !w-auto !py-1 !text-sm" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">все менеджеры</option>
            {managers.map((m) => (
              <option key={m.email} value={m.email}>
                {m.name}
              </option>
            ))}
          </select>
          <select className="input !w-auto !py-1 !text-sm" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">все итоги</option>
            {CALL_OUTCOMES.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      }
    >
      {list.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-ink-muted">Звонков нет.</p>
      ) : (
        <ol className="divide-y divide-line-hairline/70 border-t border-line-hairline">
          {shown.map((f) => {
            const g = outcomeOf(f.outcome)?.group ?? "none";
            return (
              <li key={f.touchId} className="px-5 py-2.5 text-sm space-y-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <Link href={`/clients/leads/${f.leadId}`} className="font-medium hover:underline">
                    {f.leadName}
                  </Link>
                  <span className={clsx("text-xs font-medium", GROUP_TEXT[g])}>{outcomeLabel(f.outcome)}</span>
                  <span className="text-xs text-ink-muted ml-auto tabular-nums">
                    {formatMoment(f.at)} · {f.managerName}
                    {f.fast && <span className="text-[#8a5a00]"> · быстро</span>}
                  </span>
                </div>
                {(() => {
                  // Итог уже написан меткой — в комментарии показываем только сказанное.
                  const label = outcomeLabel(f.outcome);
                  const text = label && f.comment.startsWith(label) ? f.comment.slice(label.length).replace(/^[:\s]+/, "") : f.comment;
                  return text ? <p className="text-ink-secondary break-words">{text}</p> : null;
                })()}
              </li>
            );
          })}
        </ol>
      )}
      {!filtered && <MoreToggle expanded={expanded} hidden={Math.min(list.length, 300) - shown.length} onToggle={() => setExpanded(!expanded)} what="звонков" />}
    </Section>
  );
}
