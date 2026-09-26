"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { LEAD_STAGES, isClosedStage, phoneKey, type LeadRow } from "@/lib/leads";
import { formatDay } from "@/lib/formatDate";
import MoreToggle, { COLLAPSED_TABLE_SIZE } from "./MoreToggle";
import LeadStageBadge from "./LeadStageBadge";
import { ScoreChip, TemperatureChip, WaitingChip } from "./TalkChips";

type Who = "mine" | "free" | "all";
type When = "work" | "today" | "overdue" | "waiting" | "closed" | "any";

/** Что известно о переписке лида: ждёт ли ответа, «температура», оценка менеджера. */
export interface LeadTalkMark {
  waitingMinutes: number | null;
  temperature: string;
  score: number | null;
}

/**
 * Список лидов. Открывается на «В работе» и отсортирован так, чтобы менеджер
 * шёл сверху вниз: просроченные касания, потом на сегодня, потом по дате
 * (`compareLeadRows`). Воронка стадий сверху — она же фильтр.
 */
export default function LeadsBoard({
  rows,
  myEmail,
  canManage,
  managers,
  talk = {},
}: {
  rows: LeadRow[];
  myEmail: string;
  canManage: boolean;
  managers: { email: string; name: string }[];
  talk?: Record<string, LeadTalkMark>;
}) {
  const [stage, setStage] = useState<string>("");
  const [who, setWho] = useState<Who>(canManage ? "all" : "mine");
  const [manager, setManager] = useState("");
  const [when, setWhen] = useState<When>("work");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);

  const byWho = useMemo(
    () =>
      rows.filter((r) => {
        if (who === "mine" && r.managerEmail !== myEmail) return false;
        if (who === "free" && r.managerEmail) return false;
        if (canManage && manager && r.managerEmail !== manager) return false;
        return true;
      }),
    [rows, who, manager, myEmail, canManage]
  );

  const q = query.trim().toLowerCase();
  const qPhone = phoneKey(query);
  const list = byWho.filter((r) => {
    if (stage && r.stage !== stage) return false;
    if (!stage) {
      if (when === "work" && isClosedStage(r.stage)) return false;
      if (when === "today" && !(r.dueToday || r.overdue)) return false;
      if (when === "overdue" && !r.overdue) return false;
      if (when === "waiting" && talk[r.leadId]?.waitingMinutes == null) return false;
      if (when === "closed" && !isClosedStage(r.stage)) return false;
    }
    if (q) {
      const hay = `${r.name} ${r.city} ${r.contactPerson} ${r.managerName}`.toLowerCase();
      const phoneHit = qPhone && phoneKey(r.phone).includes(qPhone.slice(-7));
      if (!hay.includes(q) && !phoneHit) return false;
    }
    return true;
  });
  const filtered = !!(stage || q || when !== "work");
  const shown = expanded || filtered ? list : list.slice(0, COLLAPSED_TABLE_SIZE * 2);

  const counts = LEAD_STAGES.map((s) => ({ ...s, count: byWho.filter((r) => r.stage === s.key).length }));
  const openCount = byWho.filter((r) => !isClosedStage(r.stage)).length;
  const todayCount = byWho.filter((r) => r.dueToday || r.overdue).length;
  const overdueCount = byWho.filter((r) => r.overdue).length;
  const waitingCount = byWho.filter((r) => talk[r.leadId]?.waitingMinutes != null).length;

  return (
    <section className="space-y-3">
      {/* Воронка: сколько на каждой стадии. Нажатие — фильтр. */}
      <div className="card !p-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
          {counts.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStage(stage === s.key ? "" : s.key)}
              className={clsx(
                "rounded-lg border px-3 py-2 text-left min-w-0 transition-colors",
                stage === s.key ? "border-accent bg-accent/10" : "border-line-hairline hover:bg-surface-plane"
              )}
            >
              <div className="text-xs text-ink-secondary truncate" title={s.label}>{s.short}</div>
              <div className={clsx("text-lg font-semibold tabular-nums", s.key === "lost" && "text-ink-muted")}>{s.count}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Segment
          value={when}
          onChange={(v) => {
            setWhen(v as When);
            setStage("");
          }}
          options={[
            { key: "work", label: `В работе · ${openCount}` },
            { key: "today", label: `На сегодня · ${todayCount}` },
            { key: "overdue", label: `Просрочено · ${overdueCount}`, warn: overdueCount > 0 },
            // «Ждут ответа» — клиент написал в WhatsApp последним. Кнопка есть,
            // только когда такие лиды есть: пустой фильтр — лишний шум.
            ...(waitingCount > 0 ? [{ key: "waiting", label: `Ждут ответа · ${waitingCount}`, warn: true }] : []),
            { key: "closed", label: "Закрытые" },
          ]}
        />
        <Segment
          value={who}
          onChange={(v) => setWho(v as Who)}
          options={[
            { key: "mine", label: "Мои" },
            { key: "free", label: "Ничьи" },
            ...(canManage ? [{ key: "all", label: "Все" }] : []),
          ]}
        />
        {canManage && who === "all" && (
          <select className="input !w-auto !py-1.5" value={manager} onChange={(e) => setManager(e.target.value)}>
            <option value="">Все менеджеры</option>
            {managers.map((m) => (
              <option key={m.email} value={m.email}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        <input
          className="input !w-full sm:!w-64 sm:ml-auto !py-1.5"
          placeholder="Поиск: название, город, телефон"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="card !p-0">
        <div className="table-cards">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line-hairline">
                <th className="px-4 py-2.5 font-medium">Лид</th>
                <th className="px-3 py-2.5 font-medium">Стадия</th>
                <th className="px-3 py-2.5 font-medium">Последнее касание</th>
                <th className="px-3 py-2.5 font-medium">Следующее</th>
                <th className="px-4 py-2.5 font-medium">Менеджер</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.leadId} className="border-b border-line-hairline/70 last:border-0 align-top">
                  <td className="px-4 py-2.5 min-w-0">
                    <Link href={`/clients/leads/${r.leadId}`} className="font-medium hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-xs text-ink-muted">
                      {[r.city, r.contactPerson, r.phone].filter(Boolean).join(" · ")}
                    </div>
                    {talk[r.leadId] && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        <WaitingChip minutes={talk[r.leadId].waitingMinutes} />
                        <TemperatureChip value={talk[r.leadId].temperature} />
                        <ScoreChip score={talk[r.leadId].score} />
                      </div>
                    )}
                  </td>
                  <td data-label="Стадия" className="px-3 py-2.5 whitespace-nowrap">
                    <LeadStageBadge stage={r.stage} />
                    {r.daysInStage > 0 && !isClosedStage(r.stage) && (
                      <div className="text-xs text-ink-muted mt-0.5">{r.daysInStage} дн. на стадии</div>
                    )}
                  </td>
                  <td data-label="Последнее касание" className="px-3 py-2.5 max-w-[320px]">
                    {r.touches > 0 ? (
                      <>
                        <div className="text-xs text-ink-muted">
                          {formatDay(r.lastTouchAt)} · {r.lastChannel} · всего {r.touches}
                        </div>
                        <div className="line-clamp-2 text-ink-secondary">{r.lastComment}</div>
                      </>
                    ) : (
                      <span className="text-ink-muted">ещё не было</span>
                    )}
                  </td>
                  <td
                    data-label="Следующее"
                    className={clsx(
                      "px-3 py-2.5 whitespace-nowrap tabular-nums",
                      r.overdue ? "text-status-critical font-medium" : r.dueToday ? "text-[#8a5a00] font-medium" : "text-ink-secondary"
                    )}
                  >
                    {isClosedStage(r.stage)
                      ? r.stage === "lost"
                        ? r.lostReason || "—"
                        : "—"
                      : r.nextTouchAt
                        ? r.dueToday
                          ? "сегодня"
                          : `${formatDay(r.nextTouchAt)}${r.overdue ? " · просрочено" : ""}`
                        : "не назначено"}
                  </td>
                  <td data-label="Менеджер" className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">
                    {r.managerName || <span className="text-[#8a5a00]">ничей</span>}
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-ink-muted">
                    {rows.length === 0 ? "Лидов пока нет — добавьте первого или загрузите базу файлом." : "Под этот отбор ничего не попало."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {!filtered && list.length > COLLAPSED_TABLE_SIZE * 2 && (
        <MoreToggle expanded={expanded} hidden={list.length - COLLAPSED_TABLE_SIZE * 2} onToggle={() => setExpanded(!expanded)} what="лидов" />
      )}
    </section>
  );
}

function Segment({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { key: string; label: string; warn?: boolean }[];
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
            value === o.key ? "bg-surface shadow-sm font-medium" : "text-ink-secondary hover:text-ink-primary",
            o.warn && value !== o.key && "text-status-critical"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
