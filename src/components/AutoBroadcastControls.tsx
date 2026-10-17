"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { unwrap, unwrapValue } from "@/lib/actionResult";
import { planNowAction, setRuleAction, stopTodayAction } from "@/app/clients/broadcasts/auto/actions";

export interface AutoRuleRow {
  rule: string;
  label: string;
  hint: string;
  on: boolean;
}

/** Переключатели правил и две кнопки: «Собрать план сейчас» и «Остановить сегодня». */
export default function AutoBroadcastControls({ rules, canStop, canPlan }: { rules: AutoRuleRow[]; canStop: boolean; canPlan: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  async function run(name: string, fn: () => Promise<string>) {
    setBusy(name);
    setMsg(null);
    try {
      const text = await fn();
      setMsg({ ok: true, text });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Не удалось" });
    } finally {
      setBusy("");
      setConfirmStop(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="divide-y divide-line-hairline border border-line-hairline rounded-lg">
        {rules.map((r) => (
          <label key={r.rule} className="flex items-start gap-3 p-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4"
              checked={r.on}
              disabled={!!busy}
              onChange={(e) =>
                run(`rule-${r.rule}`, async () => {
                  unwrap(await setRuleAction(r.rule, e.target.checked));
                  return e.target.checked ? `«${r.label}» включено` : `«${r.label}» выключено`;
                })
              }
            />
            <span>
              <span className="font-medium">{r.label}</span>
              <span className="block text-sm text-ink-secondary">{r.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canPlan && (
          <button
            type="button"
            className="btn-secondary"
            disabled={!!busy}
            onClick={() =>
              run("plan", async () => {
                const r = unwrapValue(await planNowAction());
                return r.messages > 0 ? `План собран: ${r.messages} сообщ.` : "Сегодня слать некому";
              })
            }
          >
            {busy === "plan" ? "Собираю…" : "Собрать план сейчас"}
          </button>
        )}
        {canStop &&
          (confirmStop ? (
            <>
              <span className="text-sm">Остановить все авторассылки на сегодня?</span>
              <button
                type="button"
                className="btn-primary !bg-status-critical"
                disabled={!!busy}
                onClick={() =>
                  run("stop", async () => {
                    const n = unwrapValue(await stopTodayAction());
                    return n > 0 ? `Остановлено рассылок: ${n}` : "Сегодня останавливать нечего";
                  })
                }
              >
                {busy === "stop" ? "Останавливаю…" : "Да, остановить"}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setConfirmStop(false)}>
                Нет
              </button>
            </>
          ) : (
            <button type="button" className="btn-secondary" disabled={!!busy} onClick={() => setConfirmStop(true)}>
              Остановить сегодня
            </button>
          ))}
      </div>
      {msg && <div className={clsx("text-sm rounded-lg px-3 py-2", msg.ok ? "bg-status-good/10" : "bg-status-critical/10 text-status-critical")}>{msg.text}</div>}
    </div>
  );
}
