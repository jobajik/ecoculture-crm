"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { LEAD_STAGES, isClosedStage, whatsappLink, type LeadRow } from "@/lib/leads";
import { nextTouchLabel, type LeadTalkMark } from "@/lib/leadsView";
import { BOARD_STAGES } from "@/lib/leadsBulk";
import { formatDay } from "@/lib/formatDate";
import { minutesWords, prettyWaPhone } from "@/lib/whatsapp";
import Icon from "./Icon";
import { TEMPERATURE_CHIP } from "./TalkChips";
import { temperatureLabel } from "@/lib/talkAnalysis";

/**
 * Доска лидов (21.10.2026, владелец: «как в канбанах, чтобы можно было массово выделить номера, и бот их
 * отрабатывал»). Колонка — стадия, карточка — лид с галочкой; закрытые (клиент, отказ) — одной свёрнутой колонкой
 * справа. Карточку можно перетащить в другую колонку — это смена стадии, и она идёт через то же окно, что и массовая
 * (дата следующего касания, комментарий; в «Отказ» — причина). Порядок внутри колонки — как в списке: сначала те,
 * кто ждёт ответа, потом просроченные, сегодня, остальные.
 */

const COLUMN_LIMIT = 30;

export default function LeadsKanban({
  rows,
  talk,
  today,
  selected,
  onToggle,
  onToggleMany,
  onMove,
}: {
  rows: LeadRow[];
  talk: Record<string, LeadTalkMark>;
  today: string;
  selected: Set<string>;
  onToggle: (leadId: string) => void;
  onToggleMany: (leadIds: string[], on: boolean) => void;
  /** Перетащили лид (или выделенные) в колонку стадии. */
  onMove: (leadIds: string[], stage: string) => void;
}) {
  const [dragOver, setDragOver] = useState("");
  const [closedOpen, setClosedOpen] = useState(false);
  const byStage = new Map<string, LeadRow[]>();
  for (const r of rows) byStage.set(r.stage, [...(byStage.get(r.stage) ?? []), r]);
  const closed = rows.filter((r) => isClosedStage(r.stage));
  const columns = [...BOARD_STAGES.map((key) => ({ key, label: LEAD_STAGES.find((s) => s.key === key)!.short, list: byStage.get(key) ?? [] })), { key: "closed", label: "Закрытые", list: closed }];

  const dragIds = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData("text/lead-ids");
    return raw ? raw.split(",").filter(Boolean) : [];
  };

  return (
    <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1 snap-x" role="list" aria-label="Доска лидов по стадиям">
      {columns.map((c) => {
        const isClosedCol = c.key === "closed";
        const shownAll = isClosedCol ? closedOpen : true;
        const ids = c.list.map((r) => r.leadId);
        const allOn = ids.length > 0 && ids.every((id) => selected.has(id));
        return (
          <div
            key={c.key}
            role="listitem"
            className={clsx(
              "flex-none w-[232px] sm:w-[244px] snap-start rounded-lg border bg-surface-plane/60 flex flex-col max-h-[calc(100vh-240px)] min-h-[320px]",
              dragOver === c.key && !isClosedCol ? "border-section-leads ring-2 ring-section-leads/20" : "border-line-hairline",
              isClosedCol && !closedOpen && "!w-[140px]"
            )}
            onDragOver={(e) => {
              if (isClosedCol) return;
              e.preventDefault();
              if (dragOver !== c.key) setDragOver(c.key);
            }}
            onDragLeave={() => dragOver === c.key && setDragOver("")}
            onDrop={(e) => {
              if (isClosedCol) return;
              e.preventDefault();
              setDragOver("");
              const moved = dragIds(e);
              if (moved.length) onMove(moved, c.key);
            }}
          >
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-line-hairline">
              {!isClosedCol && ids.length > 0 && (
                <input
                  type="checkbox"
                  className="w-3.5 h-3.5 accent-section-leads"
                  checked={allOn}
                  onChange={(e) => onToggleMany(ids, e.target.checked)}
                  aria-label={`Выделить всех: ${c.label}`}
                  title="Выделить всю колонку"
                />
              )}
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-muted truncate">{c.label}</span>
              <span className="ml-auto text-xs tabular-nums text-ink-secondary">{c.list.length}</span>
              {isClosedCol && c.list.length > 0 && (
                <button type="button" className="text-xs text-section-leads hover:underline" onClick={() => setClosedOpen((v) => !v)}>
                  {closedOpen ? "свернуть" : "показать"}
                </button>
              )}
            </div>
            <div className="overflow-y-auto p-1.5 space-y-1.5 min-h-[60px]">
              {c.list.length === 0 && <p className="text-xs text-ink-muted text-center py-6">пусто</p>}
              {shownAll &&
                c.list.slice(0, isClosedCol ? COLUMN_LIMIT : undefined).map((r) => (
                  <LeadCard key={r.leadId} row={r} mark={talk[r.leadId]} today={today} checked={selected.has(r.leadId)} onToggle={() => onToggle(r.leadId)} selected={selected} />
                ))}
              {isClosedCol && closedOpen && c.list.length > COLUMN_LIMIT && (
                <p className="text-xs text-ink-muted text-center py-2">ещё {c.list.length - COLUMN_LIMIT} — во вкладке «Закрытые»</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** «Ждёт ответа» старше недели — не срочность, а давняя переписка (импорт чатов): серым, не красным. */
const WAITING_FRESH_MINUTES = 7 * 24 * 60;

function LeadCard({
  row: r,
  mark,
  today,
  checked,
  onToggle,
  selected,
}: {
  row: LeadRow;
  mark?: LeadTalkMark;
  today: string;
  checked: boolean;
  onToggle: () => void;
  selected: Set<string>;
}) {
  const closed = isClosedStage(r.stage);
  const wa = whatsappLink(r.phone);
  const tel = r.phone.replace(/[^\d+]/g, "");
  const phone = /^\+?\d{11}$/.test(tel) ? prettyWaPhone(tel) : r.phone;
  const next = nextTouchLabel(r, today, formatDay);
  const waiting = mark?.waitingMinutes ?? null;
  const contact = [r.city, phone].filter(Boolean).join(" · ");
  const comment = r.touches > 0 && r.lastComment ? `${formatDay(r.lastTouchAt)}: ${r.lastComment}` : "";
  const manager = (r.managerName || "").split(/\s+/)[0];
  return (
    <div
      draggable={!closed}
      onDragStart={(e) => {
        // Тянут выделенную карточку — едут все выделенные; невыделенную — только она.
        const ids = checked && selected.size > 0 ? Array.from(selected) : [r.leadId];
        e.dataTransfer.setData("text/lead-ids", ids.join(","));
        e.dataTransfer.effectAllowed = "move";
      }}
      className={clsx(
        "rounded-md border bg-surface px-2 py-1.5 transition-colors",
        checked ? "border-section-leads ring-1 ring-section-leads/30" : "border-line-hairline hover:border-ink-muted/40",
        !closed && "cursor-grab active:cursor-grabbing"
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {!closed && <input type="checkbox" className="w-3.5 h-3.5 flex-none accent-section-leads" checked={checked} onChange={onToggle} aria-label={`Выделить ${r.name}`} />}
        <Link href={`/clients/leads/${r.leadId}`} className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-5 hover:underline" title={r.name}>
          {r.name}
        </Link>
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer" title={`Написать в WhatsApp · ${phone}`} className="flex-none w-6 h-6 -my-0.5 grid place-items-center rounded text-status-good hover:bg-surface-plane">
            <Icon name="message" />
          </a>
        )}
      </div>
      <div className="flex items-center gap-1 mt-0.5 min-w-0 text-[11px] leading-4">
        {waiting !== null &&
          (waiting <= WAITING_FRESH_MINUTES ? (
            <span className="flex-none rounded bg-status-critical/10 px-1 text-status-critical font-medium" title="Последним написал клиент, ответа нет">
              ждёт {minutesWords(waiting)}
            </span>
          ) : (
            <span className="flex-none rounded bg-surface-sunk px-1 text-ink-muted" title="Последним написал клиент — давно">
              без ответа {minutesWords(waiting)}
            </span>
          ))}
        {mark && !closed && mark.temperature && <span className={clsx("flex-none rounded px-1", TEMPERATURE_CHIP[mark.temperature])}>{temperatureLabel(mark.temperature)}</span>}
        {r.origin === "ads" && <span className="flex-none rounded bg-section-leads-soft px-1 text-section-leads">{r.handedOverAt ? "реклама·передан" : "реклама"}</span>}
        <span
          className={clsx(
            "flex-none tabular-nums",
            closed ? "text-ink-muted" : r.overdue ? "text-status-critical font-semibold" : r.dueToday ? "text-[#8a5a00] font-semibold" : "text-ink-secondary"
          )}
          title="Следующее касание"
        >
          {next}
        </span>
        <span className="ml-auto min-w-0 truncate text-ink-muted" title={r.managerName || "ничей"}>
          {manager || <span className="text-[#8a5a00]">ничей</span>}
        </span>
      </div>
      <div className="mt-0.5 truncate text-[11px] leading-4 text-ink-muted" title={comment || contact}>
        {comment || contact || "касаний не было"}
      </div>
    </div>
  );
}
