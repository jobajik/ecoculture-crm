"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendDebtReminderAction } from "@/app/finance/reminder-actions";
import { unwrapValue } from "@/lib/actionResult";
import { SEND_GAP_SECONDS } from "@/lib/debtReminder";
import Section from "./Section";

export interface ReminderRow {
  key: string;
  clientName: string;
  phone: string;
  total: string;
  orders: string[];
  kaspi: string;
  last: string;
  problem: string;
  text: string;
}

type RowState = { status: "sent" | "skipped" | "error" | "sending"; note: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Список «кому напомнить» с галочками и одной кнопкой. Отправка идёт по
 * одному с паузой 20–40 с (как у рассылки — WhatsApp банит «роботов»), пока
 * страница открыта.
 */
export default function DebtReminderList({ rows, canSend }: { rows: ReminderRow[]; canSend: boolean }) {
  const router = useRouter();
  const sendable = rows.filter((r) => !r.problem);
  const [picked, setPicked] = useState<string[]>(sendable.map((r) => r.key));
  const [state, setState] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [info, setInfo] = useState("");
  const stop = useRef(false);

  if (rows.length === 0) {
    return (
      <Section tone="good" icon="check" title="Сегодня напоминать некому">
        <p className="text-sm text-ink-secondary">У всех, кому пора платить, либо оплачено, либо уже напомнили.</p>
      </Section>
    );
  }

  const queue = sendable.filter((r) => picked.includes(r.key) && state[r.key]?.status !== "sent");

  async function run() {
    stop.current = false;
    setRunning(true);
    const list = [...queue];
    for (let i = 0; i < list.length; i++) {
      if (stop.current) break;
      const row = list[i];
      setState((s) => ({ ...s, [row.key]: { status: "sending", note: "" } }));
      setInfo(`Отправляю ${i + 1} из ${list.length}…`);
      let attempt = 0;
      for (;;) {
        try {
          const r = unwrapValue(await sendDebtReminderAction(row.key));
          if (r.status === "retry" && attempt < 3) {
            attempt++;
            setInfo(`${r.note} — через минуту`);
            await sleep(60_000);
            continue;
          }
          setState((s) => ({
            ...s,
            [row.key]: { status: r.status === "sent" ? "sent" : r.status === "retry" ? "error" : "skipped", note: r.note },
          }));
        } catch (e) {
          setState((s) => ({ ...s, [row.key]: { status: "error", note: e instanceof Error ? e.message : "ошибка" } }));
        }
        break;
      }
      if (i < list.length - 1 && !stop.current) {
        const gap = SEND_GAP_SECONDS[0] + Math.random() * (SEND_GAP_SECONDS[1] - SEND_GAP_SECONDS[0]);
        setInfo(`Следующее через ${Math.round(gap)} с — не закрывайте страницу`);
        await sleep(gap * 1000);
      }
    }
    setInfo(stop.current ? "Остановлено" : "Готово");
    setRunning(false);
    router.refresh();
  }

  const toggle = (key: string) =>
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  return (
    <Section tone="money" icon="message" title={`Кому напомнить сегодня: ${rows.length}`} flush>
      {canSend && (
        <div className="px-4 py-3 flex flex-wrap items-center gap-3 border-b border-line-hairline">
          {running ? (
            <button type="button" className="btn-secondary" onClick={() => (stop.current = true)}>
              Остановить
            </button>
          ) : (
            <button type="button" className="btn-primary" disabled={queue.length === 0} onClick={run}>
              Отправить отмеченным ({queue.length})
            </button>
          )}
          {info && <span className="text-sm text-ink-secondary">{info}</span>}
        </div>
      )}
      <ul className="divide-y divide-line-hairline">
        {rows.map((r) => {
          const st = state[r.key];
          return (
            <li key={r.key} className="px-4 py-3">
              <div className="flex items-start gap-3">
                {canSend && (
                  <input
                    type="checkbox"
                    className="mt-1 w-4 h-4"
                    disabled={!!r.problem || running || st?.status === "sent"}
                    checked={!r.problem && picked.includes(r.key)}
                    onChange={() => toggle(r.key)}
                    aria-label={`Напомнить ${r.clientName}`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{r.clientName}</span>
                    <span className="font-display font-extrabold tabular-nums">{r.total}</span>
                  </div>
                  <div className="text-xs text-ink-muted">
                    {r.phone || "нет мобильного"}
                    {r.last && ` · прошлое напоминание ${r.last}`}
                  </div>
                  <ul className="text-sm text-ink-secondary mt-1">
                    {r.orders.map((o) => (
                      <li key={o}>{o}</li>
                    ))}
                  </ul>
                  {r.kaspi && <div className="text-xs text-kaspi mt-1">{r.kaspi}</div>}
                  {r.problem && <div className="text-xs text-[#8a5a00] mt-1">{r.problem}</div>}
                  {st && (
                    <div
                      className={
                        "text-xs mt-1 " +
                        (st.status === "sent"
                          ? "text-status-good"
                          : st.status === "error"
                            ? "text-status-critical"
                            : "text-ink-muted")
                      }
                    >
                      {st.status === "sending"
                        ? "отправляю…"
                        : st.status === "sent"
                          ? `ушло${st.note ? ` · ${st.note}` : ""}`
                          : st.status === "skipped"
                            ? `пропущено: ${st.note}`
                            : `не ушло: ${st.note}`}
                    </div>
                  )}
                  <details className="mt-1">
                    <summary className="text-xs text-ink-muted cursor-pointer">текст сообщения</summary>
                    <pre className="whitespace-pre-wrap font-sans text-sm bg-surface-plane rounded-lg p-3 mt-1">{r.text}</pre>
                  </details>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
