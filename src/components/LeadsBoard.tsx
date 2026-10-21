"use client";

import { useEffect, useMemo, useState } from "react";
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
import Pager, { pageSlice } from "./Pager";
import LeadStageBadge from "./LeadStageBadge";
import Icon from "./Icon";
import { ScoreChip, TemperatureChip, WaitingChip } from "./TalkChips";
import LeadsKanban from "./LeadsKanban";
import LeadsBulkBar, { type BulkDialog } from "./LeadsBulkBar";

export type { LeadTalkMark } from "@/lib/leadsView";

type Who = "mine" | "free" | "all" | "handed";
type Layout = "board" | "list";
const LAYOUT_KEY = "leads-layout";


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
  const [page, setPage] = useState(0);
  // Доска или список (21.10.2026, владелец: «как в канбанах, массово выделить»). На компьютере — доска,
  // на телефоне — список; выбор помнится в браузере.
  const [layout, setLayout] = useState<Layout>("list");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(LAYOUT_KEY);
      if (saved === "board" || saved === "list") setLayout(saved);
      else if (window.innerWidth >= 1024) setLayout("board");
    } catch {
      // Хранилище недоступно — остаёмся на списке.
    }
  }, []);
  const pickLayout = (l: Layout) => {
    setLayout(l);
    try {
      window.localStorage.setItem(LAYOUT_KEY, l);
    } catch {
      // Не запомнилось — не страшно.
    }
  };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<BulkDialog | null>(null);
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const clearSelection = () => setSelected(new Set());
  const moveFromBoard = (ids: string[], stage: string) => {
    setSelected(new Set(ids));
    setDialog({ kind: "stage", stage });
  };

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
  // Страницами, а не «показать ещё» (новый вид, 19.10.2026: «одностраничный»). Любой отбор — с первой страницы.
  useEffect(() => setPage(0), [view, who, manager, stage, origin, query]);
  const shown = pageSlice(list, page);
  const stageCounts = LEAD_STAGES.map((s) => ({ ...s, count: scoped.filter((r) => r.stage === s.key).length }));
  const hasOrigins = byWho.some((r) => originOf(r) !== "other");

  const pickView = (v: LeadView) => setView(view === v && v !== "work" ? "work" : v);

  const whoOptions: { key: Who; label: string }[] = leadgen
    ? [
        { key: "mine", label: "Мои" },
        { key: "handed", label: "Передала" },
      ]
    : [
        { key: "mine", label: "Мои" },
        { key: "free", label: "Ничьи" },
        ...(canManage ? [{ key: "all" as Who, label: "Все" }] : []),
      ];

  return (
    <section className="space-y-5">
      {/* Плитки — что сделать сейчас. Нажатие — отбор, второе нажатие — обратно ко всем. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
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
                "card !p-4 sm:!p-5 text-left transition-shadow min-w-0 hover:shadow-card-hover",
                active && "!border-section-leads ring-2 ring-section-leads/20"
              )}
            >
              <div className="text-xs text-ink-muted truncate">{t.label}</div>
              <div
                className={clsx(
                  "font-display text-[22px] sm:text-[26px] font-extrabold tabular-nums leading-none mt-1.5",
                  hot && (t.tone === "critical" ? "text-status-critical" : "text-[#8a5a00]")
                )}
              >
                {t.value}
              </div>
              <div className="text-xs text-ink-secondary mt-2 truncate">{t.hint}</div>
            </button>
          );
        })}
      </div>

      <div className="card !p-0 overflow-hidden">
        {/* Чьи лиды — вкладками карточки; закрытые — справа. */}
        <div className="flex flex-wrap items-center gap-x-5 px-4 sm:px-5 border-b border-line-hairline">
          {whoOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setWho(o.key)}
              className={clsx(
                "py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
                who === o.key ? "border-section-leads text-ink-primary font-semibold" : "border-transparent text-ink-secondary hover:text-ink-primary"
              )}
            >
              {o.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3">
            <div className="hidden sm:flex rounded-lg border border-line-hairline p-0.5 text-xs" role="group" aria-label="Вид">
              {(["board", "list"] as Layout[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => pickLayout(l)}
                  aria-pressed={layout === l}
                  className={clsx("px-2.5 py-1 rounded-md", layout === l ? "bg-section-leads-soft text-section-leads font-semibold" : "text-ink-secondary hover:text-ink-primary")}
                >
                  {l === "board" ? "Доска" : "Список"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => pickView("closed")}
              className={clsx("py-3 text-sm", view === "closed" ? "font-semibold text-section-leads" : "text-ink-secondary hover:text-ink-primary")}
            >
              {view === "closed" ? "← К лидам в работе" : `Закрытые · ${count("closed")}`}
            </button>
          </div>
        </div>

        {/* Отбор одной строкой: поиск, менеджер, стадия, откуда. */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-2 px-4 py-3 border-b border-line-hairline">
          <input
            className="input lg:!w-[280px] !py-1.5"
            placeholder="Название, имя, город или телефон"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="flex flex-wrap gap-2 lg:ml-auto">
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
          </div>
        </div>

        {hiddenCallBase > 0 && (
          <p className="text-xs text-ink-muted px-4 py-2 border-b border-line-hairline bg-surface-plane/60">
            Ещё {hiddenCallBase.toLocaleString("ru-RU")} из базы обзвона ждут первого звонка —{" "}
            {canOpenCalls ? (
              <Link href="/clients/leads/calls" className="text-section-leads hover:underline">
                они во вкладке «Обзвон»
              </Link>
            ) : (
              "они во вкладке «Обзвон»"
            )}
            {" · "}
            <button type="button" className="text-section-leads hover:underline" onClick={() => setOrigin("calls")}>
              показать здесь
            </button>
          </p>
        )}

        {layout === "board" && view !== "closed" && list.length > 0 ? (
          <div className="px-3 pt-3">
            <div className="flex items-center gap-3 mb-2 text-xs text-ink-muted">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-section-leads"
                  checked={list.length > 0 && list.every((r) => selected.has(r.leadId))}
                  onChange={(e) => toggleMany(list.map((r) => r.leadId), e.target.checked)}
                />
                выделить все ({list.length})
              </label>
              <span>· карточку можно перетащить в другую стадию</span>
            </div>
            <LeadsKanban rows={list} talk={talk} today={today} selected={selected} onToggle={toggle} onToggleMany={toggleMany} onMove={moveFromBoard} />
          </div>
        ) : list.length === 0 ? (
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
                        "px-4 py-1.5 text-xs font-semibold border-b border-line-hairline bg-surface-plane/60 flex items-center gap-2",
                        i > 0 && "border-t",
                        group === "waiting" || group === "overdue" ? "text-status-critical" : group === "today" ? "text-[#8a5a00]" : "text-ink-secondary"
                      )}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden />
                      {LEAD_GROUP_LABELS[group]} · {groupCount}
                    </div>
                  )}
                  <LeadLine row={r} mark={talk[r.leadId]} today={today} last={i === shown.length - 1} checked={selected.has(r.leadId)} onToggle={() => toggle(r.leadId)} />
                </li>
              );
            })}
          </ol>
        )}
        {!(layout === "board" && view !== "closed" && list.length > 0) && <Pager total={list.length} page={page} onPage={setPage} what="лидов" />}
      </div>

      <LeadsBulkBar
        selected={Array.from(selected)}
        names={new Map(rows.map((r) => [r.leadId, r.name]))}
        canManage={canManage}
        leadgen={leadgen}
        managers={managers}
        today={today}
        dialog={dialog}
        setDialog={setDialog}
        onClear={clearSelection}
      />
    </section>
  );
}

function LeadLine({ row: r, mark, today, last, checked, onToggle }: { row: LeadRow; mark?: LeadTalkMark; today: string; last: boolean; checked: boolean; onToggle: () => void }) {
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
    <div className={clsx("flex items-start gap-3 px-4 py-3", !last && "border-b border-line-hairline/70", checked && "bg-section-leads-soft/40")}>
      {!closed && <input type="checkbox" className="mt-1 w-4 h-4 flex-none accent-section-leads" checked={checked} onChange={onToggle} aria-label={`Выделить ${r.name}`} />}
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
