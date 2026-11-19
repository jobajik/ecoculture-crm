"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resendWaybillAction, sendWaybillAction } from "@/app/orders/waybill-actions";
import { unwrapValue } from "@/lib/actionResult";

export interface WaybillView {
  waybillId: string;
  number: string;
  /** «19.11, 14:05» */
  when: string;
  stems: number;
  amountText: string;
  /** sent | failed | skipped | sending */
  status: string;
  statusText: string;
  note: string;
  /** Куда ушла: «…5566 · с номера менеджера». */
  sentTo: string;
  url: string;
}

/**
 * Накладные клиенту на странице заявки (19.11.2026, `waybill.ts`): что ушло клиенту в WhatsApp после отгрузки, чем
 * кончилась отправка, и кнопки — отправить то, что отгружено без накладной, или повторить.
 */
export default function OrderWaybills({
  orderId,
  waybills,
  pendingStems,
  canSend,
  autoOn,
}: {
  orderId: string;
  waybills: WaybillView[];
  /** Сколько стеблей отгружено и ещё не вошло ни в одну накладную. */
  pendingStems: number;
  canSend: boolean;
  autoOn: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setMsg(null);
    try {
      setMsg({ ok: true, text: unwrapValue((await fn()) as { text: string } | undefined).text });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Не получилось отправить" });
    } finally {
      setBusy("");
      router.refresh();
    }
  }

  const tone = (status: string) => (status === "sent" ? "text-status-good" : status === "failed" ? "text-status-critical" : "text-ink-secondary");

  return (
    <div className="space-y-3 text-sm">
      {waybills.length > 0 && (
        <ul className="divide-y divide-line-hairline rounded-lg border border-line-hairline">
          {waybills.map((w) => (
            <li key={w.waybillId} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5">
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium whitespace-nowrap">№ {w.number}</span>
                  <span className="text-ink-secondary whitespace-nowrap">{w.when}</span>
                  <span className="tabular-nums whitespace-nowrap">
                    {w.stems.toLocaleString("ru-RU")} шт. · {w.amountText}
                  </span>
                </div>
                <div className={`mt-0.5 ${tone(w.status)}`}>
                  {w.statusText}
                  {w.sentTo ? <span className="text-ink-secondary"> · {w.sentTo}</span> : null}
                  {w.note ? <span className="text-ink-secondary"> · {w.note}</span> : null}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <a className="btn-ghost" href={w.url} target="_blank" rel="noreferrer">
                  Открыть
                </a>
                {canSend && w.status !== "sending" && (
                  <button
                    type="button"
                    className={w.status === "sent" ? "btn-ghost" : "btn-secondary"}
                    disabled={busy !== ""}
                    onClick={() => {
                      if (w.status === "sent" && !window.confirm(`Накладная № ${w.number} уже отправлена клиенту. Отправить ещё раз?`)) return;
                      void run(w.waybillId, () => resendWaybillAction(w.waybillId));
                    }}
                  >
                    {busy === w.waybillId ? "Отправляю…" : w.status === "sent" ? "Ещё раз" : "Отправить"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {pendingStems > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-ink-secondary">
            Отгружено без накладной: <span className="font-medium text-ink tabular-nums">{pendingStems.toLocaleString("ru-RU")} шт.</span>
            {autoOn ? " — уйдёт клиенту сама, когда склад закончит отгрузку." : ""}
          </span>
          {canSend && (
            <button type="button" className="btn-secondary" disabled={busy !== ""} onClick={() => void run("new", () => sendWaybillAction(orderId))}>
              {busy === "new" ? "Отправляю…" : "Отправить накладную клиенту"}
            </button>
          )}
        </div>
      )}

      {waybills.length === 0 && pendingStems === 0 && <p className="text-ink-muted">Накладная уходит клиенту в WhatsApp после отгрузки.</p>}

      {msg && <p className={msg.ok ? "text-status-good" : "text-status-critical"}>{msg.text}</p>}
    </div>
  );
}
