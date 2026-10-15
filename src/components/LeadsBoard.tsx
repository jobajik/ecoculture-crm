"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { LEAD_STAGES, isClosedStage, whatsappLink, type LeadRow } from "@/lib/leads";
import {
  LEAD_GROUP_LABELS,
  isUntouchedCallBase,
  leadGroup,
  matchesQuery,
  matchesView,
  nextTouchLabel,
  originOf,
  sortLeadsForWork,
  type LeadOrigin,
  type LeadTalkMark,
  type LeadView,
} from "@/lib/leadsView";
import { formatDay } from "@/lib/formatDate";
import { prettyWaPhone } from "@/lib/whatsapp";
import MoreToggle from "./MoreToggle";
import LeadStageBadge from "./LeadStageBadge";
import Icon from "./Icon";
import { ScoreChip, TemperatureChip, WaitingChip } from "./TalkChips";

export type { LeadTalkMark } from "@/lib/leadsView";

type Who = "mine" | "free" | "all" | "handed";

const PAGE = 40;

/**
 * Список лидов «что делать сейчас». Сверху — четыре плитки (они же фильтр): ждут ответа
 * в WhatsApp, на сегодня, новые, все в работе. Ниже — поиск и отбор, потом лиды
 * группами по срочности (`sortLeadsForWork`). База обзвона без единого звонка сюда не
 * попадает — она во вкладке «Обзвон» (`isUntouchedCallBase`).
 */
export default function LeadsBoard({
  rows,
  myEmail,
  canManage,
  leadgen = false,
  canOpenCalls = false,
  managers,
  talk = {},
  today,
}: {
  rows: LeadRow[];
  myEmail: string;
  canManage: boolean;
  /** Земфира: «Мои» (ещё у неё) и «Передала» (у менеджеров, с итогом). */
  leadgen?: boolean;
  /** Есть вкладка «Обзвон» — туда ведёт строка про базу без звонков. */
  canOpenCalls?: boolean;
  managers: { email: string; name: string }[];
  talk?: Record<string, LeadTalkMark>;
  today: string;
}) {
  const [view, setView] = useState<LeadView>("work");
  const [who, setWho] = useState<Who>(canManage ? "all" : "mine");
  const [manager, setManager] = useState("");
  const [stage, setStage] = useState("");
  const [origin, setOrigin] = useState<LeadOrigin>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const byWho = useMemo(
    () =>
      rows.filter((r) => {
        if (who === "mine" && r.managerEmail !== myEmail) return false;
        if (who === "free" && r.managerEmail) return false;
        if (who === "handed" && !(r.handedOverAt && r.handedOverBy === myEmail)) return false;
        if (canManage && manager && r.managerEmail !== manager) return false;
        return true;
      }),
    [rows, who, manager, myEmail, canManage]
  );

  // База обзвона без звонков прячется, пока её не попросили (отбор «Обзвон» или поиск).
  const showCallBase = origin === "calls" || !!query.trim();
  const scoped = useMemo(
    () =>
      byWho.filter((r) => {
        if (origin !== "all" && originOf(r) !== origin) return false;
        if (!showCallBase && isUntouchedCallBase(r)) return false;
        return true;
      }),
    [byWho, origin, showCallBase]
  );
  const hiddenCallBase = showCallBase ? 0 : byWho.filter(isUntouchedCallBase).length;

  const count = (v: LeadView) => scoped.filter((r) => matchesView(r, v, talk[r.leadId])).length;
  const tiles: { key: LeadView; label: string; hint: string; value: number; tone: "critical" | "warning" | "accent" | "plain" }[] = [
    { key: "waiting", label: "Ждут ответа", hint: "клиент написал последним", value: count("waiting"), tone: "critical" },
    {
      key: "today",
      label: "На сегодня",
      hint: (() => {
        const late = scoped.filter((r) => r.overdue && !isClosedStage(r.stage)).length;
        return late > 0 ? `из них просрочено ${late}` : "касания на сегодня";
      })(),
      value: count("today"),
      tone: "warning",
    },
    { key: "new", label: "Новые", hint: "ещё не связывались", value: count("new"), tone: "accent" },
    { key: "work", label: "Все в работе", hint: "без закрытых", value: count("work"), tone: "plain" },
  ];

  const list = useMemo(() => {
    const picked = scoped.filter((r) => matchesView(r, view, talk[r.leadId]) && (!stage || r.stage === stage) && matchesQuery(r, query));
    return sortLeadsForWork(picked, talk);
  }, [scoped, view, stage, query, talk]);
  const shown = list.slice(0, limit);
  const stageCounts = LEAD_STAGES.map((s) => ({ ...s, count: scoped.filter((r) => r.stage === s.key).length }));
  const hasOrigins = byWho.some((r) => originOf(r) !== "other");

  const pickView = (v: LeadView) => {
    setView(view === v && v !== "work" ? "work" : v);
    setLimit(PAGE);
  };

  return (
    <section className="space-y-3">
      {/* Плитки — что сделать сейчас. Нажатие — отбор, второе нажатие — обратно ко всем. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {tiles.map((t) => {
          const active = view === t.key;
          const hot = t.value > 0 && (t.tone === "critical" || t.tone === "warning");
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => pickView(t.key)}
              aria-pressed={active}
              className={clsx(
                "rounded-xl border px-3 py-2.5 text-left transition-colors min-w-0 bg-surface",
                active ? "border-accent ring-2 ring-accent/20" : "border-line-hairline hover:bg-surface-plane",
                hot && !active && (t.tone === "critical" ? "border-status-critical/40 bg-status-critical/5" : "border-status-warning/50 bg-status-warning/5")
              )}
            >
              <div className="text-xs text-ink-secondary truncate">{t.label}</div>
              <div
                className={clsx(
                  "font-display text-2xl font-extrabold tabular-nums leading-tight",
                  hot && (t.tone === "critical" ? "text-status-critical" : "text-[#8a5a00]")
                )}
              >
                {t.value}
              </div>
              <div className="text-xs text-ink-muted truncate">{t.hint}</div>
            </button>
          );
        })}
      </div>

      {/* Отбор: поиск первым — им пользуются чаще всего. */}
      <div className="card !p-3 space-y-2">
        <input
          className="input !py-2"
          placeholder="Найти: название, имя, город или телефон"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Segment
            value={who}
            onChange={(v) => {
              setWho(v as Who);
              setLimit(PAGE);
            }}
            options={
              leadgen
                ? [
                    { key: "mine", label: "Мои" },
                    { key: "handed", label: "Передала" },
                  ]
                : [
                    { key: "mine", label: "Мои" },
                    { key: "free", label: "Ничьи" },
                    ...(canManage ? [{ key: "all", label: "Все" }] : []),
                  ]
            }
          />
          {canManage && who === "all" && (
            <select className="input !w-auto flex-1 sm:flex-none !py-1.5" value={manager} onChange={(e) => setManager(e.target.value)} aria-label="Менеджер">
              <option value="">Все менеджеры</option>
              {managers.map((m) => (
                <option key={m.email} value={m.email}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <select className="input !w-auto flex-1 sm:flex-none !py-1.5" value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Стадия">
            <option value="">Все стадии</option>
            {stageCounts.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} · {s.count}
              </option>
            ))}
          </select>
          {hasOrigins && !leadgen && (
            <select className="input !w-auto flex-1 sm:flex-none !py-1.5" value={origin} onChange={(e) => setOrigin(e.target.value as LeadOrigin)} aria-label="Откуда">
              <option value="all">Откуда: все</option>
              <option value="ads">С рекламы</option>
              <option value="calls">База обзвона</option>
              <option value="other">Остальные</option>
            </select>
          )}
          <button
            type="button"
            onClick={() => pickView("closed")}
            className={clsx("text-sm sm:ml-auto", view === "closed" ? "font-medium text-accent" : "text-ink-secondary hover:text-ink-primary")}
          >
            {view === "closed" ? "← К лидам в работе" : `Закрытые · ${count("closed")}`}
          </button>
        </div>
      </div>

      {hiddenCallBase > 0 && (
        <p className="text-xs text-ink-muted px-1">
          Ещё {hiddenCallBase.toLocaleString("ru-RU")} из базы обзвона ждут первого звонка —{" "}
          {canOpenCalls ? (
            <Link href="/clients/leads/calls" className="text-accent hover:underline">
              они во вкладке «Обзвон»
            </Link>
          ) : (
            "они во вкладке «Обзвон»"
          )}
          {" · "}
          <button type="button" className="text-accent hover:underline" onClick={() => setOrigin("calls")}>
            показать здесь
          </button>
        </p>
      )}

      <div className="card !p-0 overflow-hidden">
        {list.length === 0 ? (
          <p className="px-4 py-10 text-center text-ink-muted">
            {rows.length === 0
              ? "Лидов пока нет — добавьте первого."
              : view === "waiting"
                ? "Все ответили — никто не ждёт."
                : view === "today"
                  ? "На сегодня касаний нет."
                  : "Под этот отбор ничего не попало."}
          </p>
        ) : (
          <ol>
            {shown.map((r, i) => {
              const group = leadGroup(r, talk[r.leadId]);
              const prev = i > 0 ? leadGroup(shown[i - 1], talk[shown[i - 1].leadId]) : null;
              const groupCount = group !== prev ? list.filter((x) => leadGroup(x, talk[x.leadId]) === group).length : 0;
              return (
                <li key={r.leadId}>
                  {group !== prev && (
                    <div
                      className={clsx(
                        "px-4 py-1.5 text-xs font-semibold uppercase tracking-wide border-b border-line-hairline bg-surface-plane",
                        i > 0 && "border-t",
                        group === "waiting" || group === "overdue" ? "text-status-critical" : group === "today" ? "text-[#8a5a00]" : "text-ink-secondary"
                      )}
                    >
                      {LEAD_GROUP_LABELS[group]} · {groupCount}
                    </div>
                  )}
                  <LeadLine row={r} mark={talk[r.leadId]} today={today} last={i === shown.length - 1} />
                </li>
              );
            })}
          </ol>
        )}
      </div>
      {list.length > shown.length && (
        <MoreToggle expanded={false} hidden={Math.min(list.length - shown.length, PAGE * 5)} onToggle={() => setLimit(limit + PAGE * 5)} what="лидов" />
      )}
    </section>
  );
}

function LeadLine({ row: r, mark, today, last }: { row: LeadRow; mark?: LeadTalkMark; today: string; last: boolean }) {
  const closed = isClosedStage(r.stage);
  const wa = whatsappLink(r.phone);
  const tel = r.phone.replace(/[^\d+]/g, "");
  const phone = /^\+?\d{11}$/.test(tel) ? prettyWaPhone(tel) : r.phone;
  const sub = [r.contactPerson && r.contactPerson !== r.name ? r.contactPerson : "", r.city, phone].filter(Boolean).join(" · ");
  const next = (
    <span
      className={clsx(
        "tabular-nums",
        closed ? "text-ink-muted" : r.overdue ? "text-status-critical font-medium" : r.dueToday ? "text-[#8a5a00] font-medium" : "text-ink-secondary"
      )}
    >
      {nextTouchLabel(r, today, formatDay)}
    </span>
  );
  const manager = r.managerName || <span className="text-[#8a5a00]">ничей</span>;
  return (
    <div className={clsx("flex items-start gap-3 px-4 py-3", !last && "border-b border-line-hairline/70")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/clients/leads/${r.leadId}`} className="font-semibold hover:underline break-words">
            {r.name}
          </Link>
          {r.origin === "ads" && (
            <span className="rounded bg-section-leads-soft px-1.5 py-0.5 text-[11px] text-section-leads">
              с рекламы{r.handedOverAt ? ` · передан ${formatDay(r.handedOverAt)}` : ""}
            </span>
          )}
          {mark && <WaitingChip minutes={mark.waitingMinutes} />}
          {mark && !closed && <TemperatureChip value={mark.temperature} />}
          {mark && <ScoreChip score={mark.score} />}
        </div>
        {sub && <div className="text-xs text-ink-muted mt-0.5 truncate">{sub}</div>}
        <div className="text-sm text-ink-secondary mt-1 line-clamp-2 sm:line-clamp-1">
          {r.touches > 0 ? (
            <>
              <span className="text-ink-muted">
                {formatDay(r.lastTouchAt)} · {r.lastChannel}:
              </span>{" "}
              {r.lastComment}
            </>
          ) : (
            <span className="text-ink-muted">Касаний ещё не было</span>
          )}
        </div>
        {/* Телефон: стадия, следующее касание и менеджер — строкой под лидом, а не узкой колонкой. */}
        <div className="sm:hidden mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <LeadStageBadge stage={r.stage} />
          {next}
          <span className="text-xs text-ink-muted">· {manager}</span>
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" className="ml-auto text-status-good text-sm font-medium">
              WhatsApp
            </a>
          )}
        </div>
      </div>
      <div className="hidden sm:block flex-none w-44 text-right space-y-1">
        <LeadStageBadge stage={r.stage} />
        <div className="text-sm">{next}</div>
        <div className="text-xs text-ink-muted truncate">{manager}</div>
      </div>
      {(wa || tel) && (
        <div className="flex-none hidden sm:flex flex-col gap-1">
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" title="Написать в WhatsApp" className="w-8 h-8 grid place-items-center rounded-lg border border-line-hairline text-status-good hover:bg-surface-plane">
              <Icon name="message" />
            </a>
          )}
          {tel && (
            <a href={`tel:${tel}`} title="Позвонить" className="w-8 h-8 grid place-items-center rounded-lg border border-line-hairline text-ink-secondary hover:bg-surface-plane">
              <Icon name="phone" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function Segment({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { key: string; label: string }[];
}) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line-hairline bg-surface-plane p-1" role="tablist">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
          className={clsx(
            "rounded-md px-3 py-1 text-sm whitespace-nowrap",
            value === o.key ? "bg-surface shadow-sm font-medium" : "text-ink-secondary hover:text-ink-primary"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
