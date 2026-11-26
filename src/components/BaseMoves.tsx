"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { unwrapValue } from "@/lib/actionResult";
import { assignAction, confirmMovesAction, declineMovesAction } from "@/app/clients/base/actions";

export interface BaseMoveRow {
  key: string;
  name: string;
  /** Город, состояние, деньги — одной строкой под именем. */
  sub: string;
  from: string;
  /** Кому предлагаем (в режиме «переносы») и почему. */
  to?: string;
  why?: string;
}

const PAGE = 40;

/**
 * Список людей с галочками и действием над выбранными («Клиенты → База», администратор и РОП):
 * `moves` — переносы на подтверждение (кому и почему — посчитал сервер), `assign` — раздать: выбрать менеджера самому.
 * Сервер по ключам пересчитывает всё заново и делает только то, что всё ещё в силе.
 */
export default function BaseMoves({ mode, rows, takers }: { mode: "moves" | "assign"; rows: BaseMoveRow[]; takers?: { email: string; name: string }[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(mode === "moves" ? rows.map((r) => r.key) : []));
  const [shown, setShown] = useState(PAGE);
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const keys = useMemo(() => rows.filter((r) => picked.has(r.key)).map((r) => r.key), [rows, picked]);

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  async function run(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      setPicked(new Set());
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Не удалось" });
    } finally {
      setBusy(false);
    }
  }

  if (rows.length === 0) return <p className="px-4 py-6 text-sm text-ink-muted">{mode === "moves" ? "Расхождений нет: каждый записан за тем, с кем работает." : "Раздавать некого."}</p>;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line-hairline">
        <button type="button" className="btn-ghost text-sm" disabled={busy} onClick={() => setPicked(new Set(picked.size === rows.length ? [] : rows.map((r) => r.key)))}>
          {picked.size === rows.length ? "Снять все" : `Выбрать все (${rows.length})`}
        </button>
        {mode === "moves" ? (
          <>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || keys.length === 0}
              onClick={() =>
                run(async () => {
                  const r = unwrapValue(await confirmMovesAction(keys));
                  return `Перенесено: ${r.moved}${r.skipped ? ` · уже неактуально: ${r.skipped}` : ""}`;
                })
              }
            >
              Подтвердить выбранные ({keys.length})
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || keys.length === 0}
              onClick={() =>
                run(async () => {
                  const r = unwrapValue(await declineMovesAction(keys));
                  return `Оставлено как записано: ${r.declined}. Эти переносы больше не предлагаются.`;
                })
              }
            >
              Оставить как записано
            </button>
          </>
        ) : (
          <>
            <select className="input !w-auto" value={to} disabled={busy} onChange={(e) => setTo(e.target.value)}>
              <option value="">Кому записать…</option>
              {(takers ?? []).map((t) => (
                <option key={t.email} value={t.email}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || keys.length === 0 || !to}
              onClick={() =>
                run(async () => {
                  const r = unwrapValue(await assignAction(keys, to));
                  return `Записано за ${(takers ?? []).find((t) => t.email === to)?.name ?? "менеджером"}: ${r.moved}`;
                })
              }
            >
              Записать выбранных ({keys.length})
            </button>
          </>
        )}
        {msg && <span className={msg.ok ? "text-sm text-status-good" : "text-sm text-status-critical"}>{msg.text}</span>}
      </div>
      <ul className="divide-y divide-line-hairline/70">
        {rows.slice(0, shown).map((r) => (
          <li key={r.key}>
            <label className="flex items-start gap-3 px-4 py-2.5 cursor-pointer text-sm">
              <input type="checkbox" className="mt-1 h-4 w-4 flex-none" checked={picked.has(r.key)} disabled={busy} onChange={() => toggle(r.key)} />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{r.name}</span>
                <span className="block text-ink-secondary text-[13px]">{r.sub}</span>
              </span>
              <span className="flex-none text-right text-[13px]">
                <span className="text-ink-secondary">{r.from}</span>
                {r.to && (
                  <>
                    {" → "}
                    <span className="font-medium">{r.to}</span>
                    <span className="block text-ink-muted">{r.why}</span>
                  </>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {rows.length > shown && (
        <div className="px-4 py-3 border-t border-line-hairline">
          <button type="button" className="btn-ghost text-sm" onClick={() => setShown(shown + PAGE)}>
            Показать ещё ({rows.length - shown})
          </button>
        </div>
      )}
    </div>
  );
}
