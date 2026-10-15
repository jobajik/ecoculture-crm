"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { applyDecisionAction, applyDecisionsAction, analyzeDecisionsAction } from "@/app/clients/leads/decide/actions";
import { analyzeLeadTalkAction } from "@/app/clients/leads/talk-actions";
import { unwrap, unwrapValue } from "@/lib/actionResult";
import { DECISION_GROUP_LABELS, waLinkWithText, type DecisionGroup, type DecisionRow } from "@/lib/leadDecisions";
import { formatDay } from "@/lib/formatDate";
import { minutesWords } from "@/lib/whatsapp";
import Section from "./Section";
import LeadStageBadge from "./LeadStageBadge";

export type BoardRow = DecisionRow & { managerName: string; canWork: boolean };
type Choice = "sell" | "follow_up" | "lost";

const GROUPS: { key: DecisionGroup; tone: "good" | "warn" | "bad" | "neutral"; icon: "trophy" | "clock" | "alert" | "message"; hint: string }[] = [
  { key: "sell", tone: "good", icon: "trophy", hint: "интерес есть — написать сегодня с предложением или передать менеджеру" },
  { key: "follow_up", tone: "warn", icon: "clock", hint: "думает или молчит — написать в назначенный день" },
  { key: "lost", tone: "bad", icon: "alert", hint: "закрыть отказом с причиной" },
  { key: "none", tone: "neutral", icon: "message", hint: "ИИ ещё не читал переписку" },
];
const DAY_CHOICES = [1, 3, 7, 14, 30];
const CHOICE_LABEL: Record<Choice, string> = { sell: "Продать", follow_up: "Позже", lost: "Отказ" };

function ago(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, (now - t) / 60000) : null;
}

export default function LeadDecisionsBoard({
  today,
  aiReady,
  toAnalyze,
  closed,
  groups,
  done,
}: {
  today: string;
  aiReady: boolean;
  toAnalyze: number;
  closed: number;
  groups: Record<DecisionGroup, BoardRow[]>;
  done: BoardRow[];
}) {
  const [view, setView] = useState<DecisionGroup | "all">("all");
  const dueToday = groups.follow_up.filter((r) => r.dueDay <= today).length;
  const tiles: { key: DecisionGroup; label: string; value: number; sub: string; tone: string }[] = [
    { key: "sell", label: "Продать сейчас", value: groups.sell.length, sub: `ждут ответа: ${groups.sell.filter((r) => r.waitingSince).length}`, tone: "text-status-good" },
    { key: "follow_up", label: "Написать позже", value: groups.follow_up.length, sub: `на сегодня: ${dueToday}`, tone: "text-[#8a5a00]" },
    { key: "lost", label: "Отказ", value: groups.lost.length, sub: "закрыть с причиной", tone: "text-status-critical" },
    { key: "none", label: "Не разобраны", value: groups.none.length, sub: `ждут ИИ: ${toAnalyze}`, tone: "text-ink-secondary" },
  ];
  const shown = GROUPS.filter((g) => view === "all" || view === g.key);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setView(view === t.key ? "all" : t.key)}
            className={clsx(
              "card text-left px-4 py-3 transition-colors",
              view === t.key ? "ring-2 ring-section-leads" : "hover:bg-surface-plane"
            )}
          >
            <div className="text-xs text-ink-muted">{t.label}</div>
            <div className={clsx("font-display font-extrabold text-2xl tabular-nums", t.tone)}>{t.value}</div>
            <div className="text-xs text-ink-muted">{t.sub}</div>
          </button>
        ))}
      </div>

      <AnalyzeBar aiReady={aiReady} pending={toAnalyze} />

      {shown.map((g) => (
        <GroupSection key={g.key} group={g} rows={groups[g.key]} today={today} />
      ))}

      {(done.length > 0 || closed > 0) && (
        <details className="card px-4 py-3">
          <summary className="cursor-pointer text-sm text-ink-secondary">
            Решение уже принято: {done.length} · закрыто раньше: {closed}
          </summary>
          <div className="mt-2 divide-y divide-line-hairline/70">
            {done.map((r) => (
              <div key={r.leadId} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/clients/leads/${r.leadId}`} className="font-medium hover:underline">
                  {r.name}
                </Link>
                <LeadStageBadge stage={r.stage} />
                <span className="text-ink-muted">следующее касание: {r.nextTouchAt ? formatDay(r.nextTouchAt) : "—"}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

/** «Разобрать новые»: по 6 лидов за запрос, пока не кончатся или не остановят. */
function AnalyzeBar({ aiReady, pending }: { aiReady: boolean; pending: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [stop, setStop] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const stopRef = useRef(false);

  async function run() {
    setBusy(true);
    setStop(false);
    stopRef.current = false;
    setMsg(null);
    let total = 0;
    const failed: string[] = [];
    try {
      for (let round = 0; round < 40; round++) {
        const r = unwrapValue(await analyzeDecisionsAction());
        total += r.done;
        failed.push(...r.failed);
        setMsg({ ok: true, text: `Разобрано: ${total}${r.left > 0 ? ` · осталось ${r.left}` : ""}` });
        router.refresh();
        if (r.left <= 0 || r.done === 0 || stopRef.current) break;
      }
      setMsg({ ok: failed.length === 0, text: `Разобрано: ${total}${failed.length ? ` · не вышло: ${failed.slice(0, 3).join("; ")}` : ""}` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Не удалось" });
    } finally {
      setBusy(false);
    }
  }

  if (!aiReady) return <p className="text-sm text-status-critical">ИИ не подключён — нужен ключ OpenAI.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn-primary" onClick={run} disabled={busy || pending === 0}>
        {busy ? "Разбираю…" : pending > 0 ? `Разобрать переписки · ${pending}` : "Все переписки разобраны"}
      </button>
      {busy && (
        <button
          type="button"
          className="btn-secondary"
          disabled={stop}
          onClick={() => {
            stopRef.current = true;
            setStop(true);
          }}
        >
          {stop ? "Остановлю после текущих" : "Остановить"}
        </button>
      )}
      {msg && <span className={clsx("text-sm", msg.ok ? "text-status-good" : "text-status-critical")}>{msg.text}</span>}
      {!busy && pending > 0 && <span className="text-xs text-ink-muted">новые и изменившиеся переписки; вечером разбираются сами</span>}
    </div>
  );
}

function GroupSection({
  group,
  rows,
  today,
}: {
  group: (typeof GROUPS)[number];
  rows: BoardRow[];
  today: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [limit, setLimit] = useState(15);
  const bulkable = group.key === "lost" || group.key === "follow_up";
  const workable = rows.filter((r) => r.canWork && r.analysisId && r.newMessages === 0);

  async function applyAll() {
    setBusy(true);
    setMsg("");
    try {
      const r = unwrapValue(await applyDecisionsAction(workable.map((w) => w.leadId)));
      setMsg(`Применено: ${r.applied}${r.skipped.length ? ` · пропущено: ${r.skipped.join("; ")}` : ""}`);
      setConfirm(false);
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Не удалось");
    } finally {
      setBusy(false);
    }
  }

  const aside =
    bulkable && workable.length > 1 ? (
      confirm ? (
        <span className="flex items-center gap-2 text-sm">
          <span className="text-ink-secondary">{group.key === "lost" ? `Закрыть отказом ${workable.length}?` : `Назначить касания ${workable.length}?`}</span>
          <button type="button" className="btn-primary !py-1" onClick={applyAll} disabled={busy}>
            {busy ? "…" : "Да"}
          </button>
          <button type="button" className="btn-secondary !py-1" onClick={() => setConfirm(false)} disabled={busy}>
            Нет
          </button>
        </span>
      ) : (
        <button type="button" className="btn-secondary !py-1 text-sm" onClick={() => setConfirm(true)}>
          Применить ко всем · {workable.length}
        </button>
      )
    ) : (
      <span className="text-sm text-ink-muted tabular-nums">{rows.length}</span>
    );

  return (
    <Section tone={group.tone} icon={group.icon} title={DECISION_GROUP_LABELS[group.key]} aside={aside} flush>
      <p className="px-4 pt-2 text-xs text-ink-muted">{group.hint}</p>
      {msg && <p className="px-4 pt-1 text-sm text-ink-secondary">{msg}</p>}
      {rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-ink-muted">Пусто.</p>
      ) : (
        <div>
          {rows.slice(0, limit).map((r, i) => (
            <DecisionCard key={r.leadId} row={r} today={today} last={i === Math.min(rows.length, limit) - 1} />
          ))}
          {rows.length > limit && (
            <button type="button" className="w-full px-4 py-2 text-sm text-section-leads hover:underline text-left" onClick={() => setLimit(limit + 30)}>
              Показать ещё {Math.min(30, rows.length - limit)} из {rows.length - limit}
            </button>
          )}
        </div>
      )}
    </Section>
  );
}

function DecisionCard({ row: r, today, last }: { row: BoardRow; today: string; last: boolean }) {
  const router = useRouter();
  const ai: Choice | null = r.group === "none" ? null : r.group;
  const [choice, setChoice] = useState<Choice | null>(ai);
  const [days, setDays] = useState<number>(() => {
    if (!r.dueDay) return 3;
    const diff = Math.round((Date.parse(`${r.dueDay}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86400000);
    return Math.max(1, diff || 1);
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const now = Date.now();
  const waiting = ago(r.waitingSince, now);
  const changed = choice !== ai || (choice === "follow_up" && r.dueDay && days !== Math.max(1, Math.round((Date.parse(`${r.dueDay}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86400000) || 1));

  async function apply() {
    if (!choice) return;
    setBusy(true);
    setMsg(null);
    try {
      const override = changed ? { decision: choice, days: choice === "follow_up" ? days : undefined } : undefined;
      const res = unwrapValue(await applyDecisionAction(r.leadId, override));
      setMsg({ ok: true, text: res.nextTouchAt ? `Записано · следующее касание ${formatDay(res.nextTouchAt)}` : "Записано · лид закрыт" });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Не удалось" });
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    setBusy(true);
    setMsg(null);
    try {
      unwrap(await analyzeLeadTalkAction(r.leadId));
      setMsg({ ok: true, text: "Разобрано" });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Не удалось" });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(r.draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const applyLabel =
    choice === "lost"
      ? `Закрыть отказом${r.lostReason ? ` · ${r.lostReason}` : ""}`
      : choice === "follow_up"
        ? `Применить · написать через ${days} дн.`
        : "Применить · касание сегодня";

  return (
    <div className={clsx("px-4 py-3 space-y-2", !last && "border-b border-line-hairline/70")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Link href={`/clients/leads/${r.leadId}`} className="font-semibold hover:underline break-words">
          {r.name}
        </Link>
        <LeadStageBadge stage={r.stage} />
        {waiting !== null && (
          <span className="rounded bg-status-critical/10 px-1.5 py-0.5 text-[11px] text-status-critical">ждёт ответа {minutesWords(waiting)}</span>
        )}
        {r.group === "follow_up" && r.dueDay && (
          <span className={clsx("rounded px-1.5 py-0.5 text-[11px]", r.dueDay <= today ? "bg-status-warning/15 text-[#8a5a00]" : "bg-surface-sunk text-ink-secondary")}>
            {r.dueDay <= today ? "написать сегодня" : `написать ${formatDay(r.dueDay)}`}
          </span>
        )}
        {r.newMessages > 0 && r.analysisId && (
          <span className="rounded bg-section-leads-soft px-1.5 py-0.5 text-[11px] text-section-leads">новых сообщений: {r.newMessages} — разобрать заново</span>
        )}
        {r.inferred && <span className="text-[11px] text-ink-muted">по старому разбору</span>}
        {r.handedOver && <span className="text-[11px] text-ink-muted">у менеджера: {r.managerName || "—"}</span>}
        {r.waLink && (
          <a href={r.waLink} target="_blank" rel="noreferrer" className="ml-auto text-sm text-status-good font-medium">
            WhatsApp ↗
          </a>
        )}
      </div>

      {r.group === "none" ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-muted">
            {r.tooShort
              ? r.messages === 0
                ? "Переписки нет."
                : "Клиент почти не писал — разбирать нечего. Напишите ему ещё раз."
              : `Переписка: ${r.messages} сообщ., последнее ${formatDay(r.lastAt)}.`}
          </span>
          {!r.tooShort && r.canWork && (
            <button type="button" className="btn-secondary !py-1 text-sm" onClick={analyze} disabled={busy}>
              {busy ? "Разбираю…" : "Разобрать"}
            </button>
          )}
        </div>
      ) : (
        <>
          {r.why && <p className="text-sm font-medium text-ink-primary">{r.why}</p>}
          {r.summary && <p className="text-sm text-ink-secondary line-clamp-3">{r.summary}</p>}
          {r.group !== "lost" && r.nextStep && (
            <p className="text-sm">
              <span className="text-ink-muted">Дальше: </span>
              {r.nextStep}
            </p>
          )}
          {r.group === "lost" && r.lostReason && (
            <p className="text-sm">
              <span className="text-ink-muted">Причина: </span>
              {r.lostReason}
            </p>
          )}
          {choice !== "lost" && r.draft && (
            <div className="rounded-lg bg-surface-plane border border-line-hairline px-3 py-2 text-sm">
              <div className="text-[11px] text-ink-muted mb-1">Сообщение клиенту — ИИ написал, можно поправить в WhatsApp</div>
              <p className="whitespace-pre-line">{r.draft}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {r.waLink && (
                  <a href={waLinkWithText(r.waLink, r.draft)} target="_blank" rel="noreferrer" className="btn-secondary !py-1 text-sm text-status-good">
                    Открыть в WhatsApp с этим текстом
                  </a>
                )}
                <button type="button" className="btn-secondary !py-1 text-sm" onClick={copy}>
                  {copied ? "Скопировано" : "Копировать"}
                </button>
              </div>
            </div>
          )}

          {r.canWork ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <div className="inline-flex rounded-lg border border-line-hairline overflow-hidden text-sm">
                {(["sell", "follow_up", "lost"] as Choice[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setChoice(c)}
                    className={clsx(
                      "px-2.5 py-1",
                      choice === c
                        ? c === "sell"
                          ? "bg-status-good/15 text-status-good font-medium"
                          : c === "lost"
                            ? "bg-status-critical/10 text-status-critical font-medium"
                            : "bg-status-warning/15 text-[#8a5a00] font-medium"
                        : "text-ink-secondary hover:bg-surface-plane"
                    )}
                  >
                    {CHOICE_LABEL[c]}
                    {c === ai ? " · ИИ" : ""}
                  </button>
                ))}
              </div>
              {choice === "follow_up" && (
                <div className="inline-flex gap-1 text-sm">
                  {DAY_CHOICES.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDays(d)}
                      className={clsx("px-2 py-1 rounded-md border", days === d ? "border-section-leads text-section-leads font-medium" : "border-line-hairline text-ink-secondary")}
                    >
                      {d} дн.
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className={clsx("!py-1 text-sm", choice === "lost" ? "btn-secondary" : "btn-primary")}
                onClick={apply}
                disabled={busy || !choice}
              >
                {busy ? "Записываю…" : applyLabel}
              </button>
              {choice === "sell" && (
                <Link href={`/clients/leads/${r.leadId}#handover`} className="text-sm text-section-leads hover:underline">
                  Передать менеджеру →
                </Link>
              )}
            </div>
          ) : (
            <p className="text-xs text-ink-muted">Лид у менеджера — решение за ним.</p>
          )}
        </>
      )}
      {msg && <p className={clsx("text-sm", msg.ok ? "text-status-good" : "text-status-critical")}>{msg.text}</p>}
    </div>
  );
}
