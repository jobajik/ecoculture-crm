"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { LEAD_STAGES, isClosedStage, whatsappLink, type LeadRow } from "@/lib/leads";
import { nextTouchLabel, type LeadTalkMark } from "@/lib/leadsView";
import { BOARD_STAGES } from "@/lib/leadsBulk";
import { formatDay } from "@/lib/formatDate";
import { prettyWaPhone } from "@/lib/whatsapp";
import Icon from "./Icon";
import { TemperatureChip, WaitingChip } from "./TalkChips";

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
    <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1 snap-x" role="list" aria-label="Доска лидов по стадиям">
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
              "flex-none w-[272px] sm:w-[296px] snap-start rounded-xl border bg-surface-plane/60 flex flex-col max-h-[72vh]",
              dragOver === c.key && !isClosedCol ? "border-section-leads ring-2 ring-section-leads/20" : "border-line-hairline",
              isClosedCol && !closedOpen && "w-[160px] sm:w-[180px]"
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
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-line-hairline">
              {!isClosedCol && ids.length > 0 && (
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-section-leads"
                  checked={allOn}
                  onChange={(e) => onToggleMany(ids, e.target.checked)}
                  aria-label={`Выделить всех: ${c.label}`}
                  title="Выделить всю колонку"
                />
              )}
              <span className="text-[12px] font-bold uppercase tracking-[0.06em] text-ink-muted truncate">{c.label}</span>
              <span className="ml-auto text-xs tabular-nums text-ink-secondary">{c.list.length}</span>
              {isClosedCol && c.list.length > 0 && (
                <button type="button" className="text-xs text-section-leads hover:underline" onClick={() => setClosedOpen((v) => !v)}>
                  {closedOpen ? "свернуть" : "показать"}
                </button>
              )}
            </div>
            <div className="overflow-y-auto p-2 space-y-2 min-h-[80px]">
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
        "rounded-lg border bg-surface p-2.5 shadow-sm transition-colors",
        checked ? "border-section-leads ring-1 ring-section-leads/30" : "border-line-hairline hover:border-ink-muted/40",
        !closed && "cursor-grab active:cursor-grabbing"
      )}
    >
      <div className="flex items-start gap-2">
        {!closed && <input type="checkbox" className="mt-0.5 w-4 h-4 flex-none accent-section-leads" checked={checked} onChange={onToggle} aria-label={`Выделить ${r.name}`} />}
        <div className="min-w-0 flex-1">
          <Link href={`/clients/leads/${r.leadId}`} className="font-semibold text-sm hover:underline break-words leading-tight">
            {r.name}
          </Link>
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {mark && <WaitingChip minutes={mark.waitingMinutes} />}
            {mark && !closed && <TemperatureChip value={mark.temperature} />}
            {r.origin === "ads" && <span className="rounded bg-section-leads-soft px-1 py-0.5 text-[10px] text-section-leads">реклама{r.handedOverAt ? " · передан" : ""}</span>}
          </div>
        </div>
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer" title="Написать в WhatsApp" className="flex-none w-7 h-7 grid place-items-center rounded-md text-status-good hover:bg-surface-plane">
            <Icon name="message" />
          </a>
        )}
      </div>
      <div className="text-[11px] text-ink-muted mt-1.5 truncate">{[r.city, phone].filter(Boolean).join(" · ")}</div>
      <div className="text-xs text-ink-secondary mt-1 line-clamp-2">
        {r.touches > 0 ? (
          <>
            <span className="text-ink-muted">{formatDay(r.lastTouchAt)}:</span> {r.lastComment}
          </>
        ) : (
          <span className="text-ink-muted">касаний не было</span>
        )}
      </div>
      <div className="flex items-center gap-2 mt-2 text-[11px]">
        <span className={clsx("tabular-nums", closed ? "text-ink-muted" : r.overdue ? "text-status-critical font-semibold" : r.dueToday ? "text-[#8a5a00] font-semibold" : "text-ink-secondary")}>{next}</span>
        <span className="ml-auto text-ink-muted truncate max-w-[45%]">{r.managerName || <span className="text-[#8a5a00]">ничей</span>}</span>
      </div>
    </div>
  );
}
