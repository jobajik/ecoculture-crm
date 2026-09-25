"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importLeadsAction, parseLeadFileAction } from "@/app/clients/leads/actions";
import type { LeadImportResult } from "@/lib/leads";
import { unwrapValue } from "@/lib/actionResult";
import MoreToggle from "./MoreToggle";
import Hint from "./Hint";

const VISIBLE = 15;

/**
 * Загрузка базы лидов файлом (РОП и админ). Сначала показываем, что
 * распозналось и кого пропустим как двойника, — и только по кнопке пишем.
 */
export default function LeadImportForm({ managers }: { managers: { email: string; name: string }[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<LeadImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [defaultManager, setDefaultManager] = useState("");

  async function handleFile(file: File) {
    setError(null);
    setDone(null);
    setResult(null);
    setExpanded(false);
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      setResult(unwrapValue(await parseLeadFileAction(fd)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось прочитать файл");
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!result) return;
    setImporting(true);
    setError(null);
    try {
      setDone(unwrapValue(await importLeadsAction(result.rows.filter((r) => !r.skip), defaultManager)));
      setResult(null);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    } finally {
      setImporting(false);
    }
  }

  const rows = result?.rows ?? [];
  const shown = expanded ? rows : rows.slice(0, VISIBLE);
  const unassigned = rows.filter((r) => !r.skip && !r.managerEmail).length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <a href="/api/leads/template" className="btn-secondary !py-1.5">
          ↓ Шаблон
        </a>
        <button
          type="button"
          className="btn-secondary !py-1.5 disabled:opacity-50"
          disabled={parsing || importing}
          onClick={() => inputRef.current?.click()}
        >
          {parsing ? "Читаю файл…" : "Загрузить базу"}
        </button>
        <Hint>
          Excel (.xlsx) или CSV. Первой строкой — заголовки: «Название», «Город», «Телефон», «Контактное лицо»,
          «Тип точки», «Источник», «Адрес», «Комментарий», «Менеджер». Обязательно только название. Кто уже есть
          в лидах или среди клиентов (тот же телефон), второй раз не заводится.
        </Hint>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
      </div>

      {(error || done || result) && (
        <div className="basis-full card space-y-3">
          {error && <p className="text-sm text-status-critical">{error}</p>}
          {done && (
            <p className="text-sm text-status-good">
              Загружено лидов: {done.created}
              {done.skipped > 0 && ` · пропущено: ${done.skipped} (уже были)`}
            </p>
          )}
          {result?.fatalError && <p className="text-sm text-status-critical">{result.fatalError}</p>}
          {result && !result.fatalError && (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                <span>
                  Новых: <b>{result.fresh}</b>
                </span>
                {result.skipped > 0 && <span className="text-ink-secondary">пропустим: {result.skipped}</span>}
                {unassigned > 0 && (
                  <label className="flex items-center gap-2">
                    <span className="text-ink-secondary">без менеджера ({unassigned}) отдать:</span>
                    <select className="input !w-auto !py-1" value={defaultManager} onChange={(e) => setDefaultManager(e.target.value)}>
                      <option value="">никому — возьмут сами</option>
                      {managers.map((m) => (
                        <option key={m.email} value={m.email}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <div className="table-cards border border-line-hairline rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ink-secondary border-b border-line-hairline">
                      <th className="px-3 py-2 font-medium">Название</th>
                      <th className="px-3 py-2 font-medium">Город</th>
                      <th className="px-3 py-2 font-medium">Телефон</th>
                      <th className="px-3 py-2 font-medium">Менеджер</th>
                      <th className="px-3 py-2 font-medium">Итог</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.line} className="border-b border-line-hairline/70 last:border-0">
                        <td className="px-3 py-1.5">
                          <span className="text-ink-muted text-xs mr-1">{r.line}</span>
                          {r.name || "—"}
                        </td>
                        <td data-label="Город" className="px-3 py-1.5">{r.city}</td>
                        <td data-label="Телефон" className="px-3 py-1.5 tabular-nums">{r.phone}</td>
                        <td data-label="Менеджер" className="px-3 py-1.5">
                          {r.managerEmail
                            ? managers.find((m) => m.email === r.managerEmail)?.name ?? r.managerEmail
                            : r.managerRaw
                              ? <span className="text-[#8a5a00]">«{r.managerRaw}» не нашёл</span>
                              : ""}
                        </td>
                        <td data-label="Итог" className={r.skip ? "px-3 py-1.5 text-ink-muted" : "px-3 py-1.5 text-status-good"}>
                          {r.skip || "новый"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <MoreToggle expanded={expanded} hidden={rows.length - shown.length} onToggle={() => setExpanded(!expanded)} what="строк" />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-primary disabled:opacity-50"
                  disabled={importing || result.fresh === 0}
                  onClick={handleImport}
                >
                  {importing ? "Загружаю…" : `Загрузить ${result.fresh}`}
                </button>
                <button type="button" className="btn-secondary" onClick={() => { setResult(null); setError(null); }}>
                  Отмена
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
