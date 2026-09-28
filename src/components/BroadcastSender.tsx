"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendNextAction, setBroadcastStatusAction } from "@/app/clients/broadcasts/actions";
import { unwrap, unwrapValue } from "@/lib/actionResult";

/**
 * Пульт рассылки. Отправка идёт, пока страница открыта: страница раз в
 * 25–50 секунд просит сервер отправить следующее сообщение (паузу называет
 * сервер). Закрыли вкладку — рассылка просто ждёт; открыли снова и нажали
 * «Продолжить» — пошла дальше с того же места.
 */
export default function BroadcastSender({
  broadcastId,
  status,
  remaining,
  note,
}: {
  broadcastId: string;
  status: string;
  remaining: number;
  note: string;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(remaining);
  const [countdown, setCountdown] = useState(0);
  const [info, setInfo] = useState(note);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const runningRef = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      runningRef.current = false;
    };
  }, []);

  // Уйти со страницы посреди отправки — предупредить: дальше рассылка не пойдёт.
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  async function sleep(seconds: number) {
    for (let s = seconds; s > 0 && runningRef.current && alive.current; s--) {
      setCountdown(s);
      await new Promise((r) => setTimeout(r, 1000));
    }
    setCountdown(0);
  }

  async function loop() {
    let sinceRefresh = 0;
    while (runningRef.current && alive.current) {
      try {
        const r = unwrapValue(await sendNextAction(broadcastId));
        setLeft(Number(r.remaining) || 0);
        setInfo(String((r as { note?: string }).note || ""));
        const sentTo = (r as { sentTo?: string }).sentTo;
        if (sentTo) sinceRefresh++;
        if (r.status !== "sending") {
          runningRef.current = false;
          setRunning(false);
          router.refresh();
          return;
        }
        if (sinceRefresh >= 5) {
          sinceRefresh = 0;
          router.refresh();
        }
        await sleep(Math.max(1, Number((r as { waitSeconds?: number }).waitSeconds) || 30));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Сбой отправки — пробую ещё раз через минуту");
        await sleep(60);
        setError(null);
      }
    }
  }

  async function start() {
    setError(null);
    setBusy(true);
    try {
      if (status !== "sending") unwrap(await setBroadcastStatusAction(broadcastId, "sending"));
      runningRef.current = true;
      setRunning(true);
      void loop();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не запустилось");
    } finally {
      setBusy(false);
    }
  }

  async function pause() {
    runningRef.current = false;
    setRunning(false);
    setBusy(true);
    try {
      unwrap(await setBroadcastStatusAction(broadcastId, "paused"));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm("Остановить рассылку совсем? Оставшимся сообщения не уйдут.")) return;
    runningRef.current = false;
    setRunning(false);
    setBusy(true);
    try {
      unwrap(await setBroadcastStatusAction(broadcastId, "cancelled"));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  const finished = status === "done" || status === "cancelled";
  if (finished) return null;

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {running ? (
          <button type="button" className="btn-secondary" onClick={pause} disabled={busy}>
            Пауза
          </button>
        ) : (
          <button type="button" className="btn-primary" onClick={start} disabled={busy || left === 0}>
            {status === "draft" ? "Начать отправку" : "Продолжить отправку"}
          </button>
        )}
        <button type="button" className="text-sm text-ink-muted hover:text-status-critical" onClick={cancel} disabled={busy}>
          Остановить совсем
        </button>
        <span className="text-sm text-ink-secondary">
          Осталось: <b className="tabular-nums">{left}</b>
          {running && countdown > 0 && <> · следующее через {countdown} с</>}
        </span>
      </div>
      {running && (
        <p className="text-xs text-ink-muted">Не закрывайте эту вкладку, пока идёт отправка. Закроете — рассылка встанет на паузу до следующего открытия.</p>
      )}
      {info && <p className="text-sm text-[#8a5a00] bg-status-warning/10 rounded-lg px-3 py-2">{info}</p>}
      {error && <p className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</p>}
    </div>
  );
}
