"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { checkLeadImportAction, importLeadsAction } from "@/app/clients/leads/actions";
import { collectRequests, parseLeadMatrix, pickLeadSheet, type LeadImportResult } from "@/lib/leads";
import { unwrapValue } from "@/lib/actionResult";
import MoreToggle from "./MoreToggle";
import Hint from "./Hint";

const VISIBLE = 15;
const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];

type Mode = "deal" | "file" | "none";

/**
 * Загрузка базы файлом (РОП и админ). Файл читается ЗДЕСЬ, в браузере
 * (`xlsxLite.ts`): выгрузка из прошлой CRM на 14 000 строк у сервера занимала
 * минуты. Сервер получает строки и проверяет их против живой базы. Дальше —
 * какие группы из файла грузить, как назвать обзвон и как раздать менеджерам.
 */
export default function LeadImportForm({ managers }: { managers: { email: string; name: string }[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"" | "read" | "check" | "import">("");
  const [result, setResult] = useState<LeadImportResult | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; skipped: number; perManager: Record<string, number> } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [offSegments, setOffSegments] = useState<string[]>([]);
  const now = new Date();
  const [campaign, setCampaign] = useState(`Обзвон ${MONTHS[now.getMonth()]} ${now.getFullYear()}`);
  const [mode, setMode] = useState<Mode>("deal");
  const [team, setTeam] = useState<string[]>(managers.map((m) => m.email));
  const [defaultManager, setDefaultManager] = useState("");

  async function handleFile(file: File) {
    setError(null);
    setDone(null);
    setResult(null);
    setExpanded(false);
    setBusy("read");
    try {
      const lite = await import("@/lib/xlsxLite");
      const sheets = /\.csv$/i.test(file.name)
        ? [{ name: file.name, matrix: lite.parseCsv(await file.text()) }]
        : await lite.readXlsxSheets(await file.arrayBuffer());
      const sheet = pickLeadSheet(sheets);
      if (!sheet) throw new Error("В файле нет листов");
      const local = parseLeadMatrix(sheet.matrix, { leads: [], clients: [] }, [], collectRequests(sheets, sheet.name));
      if (local.fatalError) {
        setResult(local);
        return;
      }
      setSheetName(sheets.length > 1 ? sheet.name : "");
      setBusy("check");
      const checked = unwrapValue(await checkLeadImportAction(local.rows));
      setResult(checked);
      setOffSegments((checked.segments ?? []).filter((s) => /^активн/i.test(s.name)).map((s) => s.name));
      if (checked.rows.some((r) => !r.skip && r.managerEmail) && !checked.segments?.length) setMode("file");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось прочитать файл. Нужен Excel (.xlsx) или CSV.");
    } finally {
      setBusy("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const rows = useMemo(() => result?.rows ?? [], [result]);
  const chosen = useMemo(() => rows.filter((r) => !r.skip && !offSegments.includes(r.segment)), [rows, offSegments]);
  const skipSummary = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      if (!r.skip) continue;
      const k = r.skip.replace(/,? ?(строка|оставлена строка) \d+/g, "").replace(/\s*\(.*\)/, "").trim();
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [rows]);
  const offCount = rows.filter((r) => !r.skip && offSegments.includes(r.segment)).length;
  const bought = chosen.filter((r) => r.pastOrders > 0).length;
  const shown = expanded ? rows : rows.slice(0, VISIBLE);
  const nameOf = (email: string) => managers.find((m) => m.email === email)?.name ?? email;

  async function handleImport() {
    if (!result || chosen.length === 0) return;
    if (mode === "deal" && team.length === 0) {
      setError("Отметьте хотя бы одного менеджера или выберите «никому»");
      return;
    }
    setBusy("import");
    setError(null);
    try {
      setDone(
        unwrapValue(
          await importLeadsAction(chosen, {
            campaign,
            distributeTo: mode === "deal" ? team : [],
            defaultManager: mode === "file" ? defaultManager : "",
          })
        )
      );
      setResult(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
        <a href="/api/leads/template" className="btn-secondary !py-1.5">
          ↓ Шаблон
        </a>
        <button
          type="button"
          className="btn-secondary !py-1.5 disabled:opacity-50"
          disabled={!!busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy === "read" ? "Читаю файл…" : busy === "check" ? "Сверяю с базой…" : "Загрузить базу"}
        </button>
        <Hint>
          Excel (.xlsx) или CSV. Подойдёт и выгрузка из прошлой CRM целиком — лист с клиентами найдётся сам, а
          из сделок подтянется, что человек спрашивал. Обязательны название и телефон. Кто уже есть в лидах или
          среди клиентов (тот же телефон), второй раз не заводится.
        </Hint>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
      </div>

      {(error || done || result) && (
        <div className="basis-full card space-y-4">
          {error && <p className="text-sm text-status-critical">{error}</p>}
          {done && (
            <div className="text-sm space-y-1">
              <p className="text-status-good font-medium">
                Загружено: {done.created}
                {done.skipped > 0 && <span className="text-ink-secondary font-normal"> · пропущено {done.skipped} (уже были или без телефона)</span>}
              </p>
              {Object.keys(done.perManager).length > 0 && (
                <p className="text-ink-secondary">
                  Раздано: {Object.entries(done.perManager).map(([e, n]) => `${nameOf(e)} — ${n}`).join(" · ")}
                </p>
              )}
              <p>
                <a href="/clients/leads/calls" className="text-accent hover:underline">
                  Открыть «Обзвон» →
                </a>
              </p>
            </div>
          )}
          {result?.fatalError && <p className="text-sm text-status-critical">{result.fatalError}</p>}
          {result && !result.fatalError && (
            <>
              <div className="text-sm space-y-1">
                <p>
                  {sheetName && <span className="text-ink-muted">Лист «{sheetName}» · </span>}
                  Строк в файле: <b>{rows.length}</b> · новых: <b>{result.fresh}</b>
                </p>
                {skipSummary.length > 0 && (
                  <p className="text-ink-secondary">
                    Пропустим: {skipSummary.map(([k, n]) => `${k} — ${n}`).join(" · ")}
                  </p>
                )}
              </div>

              {(result.segments ?? []).length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs text-ink-muted">Какие группы из файла грузить:</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(result.segments ?? []).map((s) => {
                      const on = !offSegments.includes(s.name);
                      return (
                        <button
                          key={s.name}
                          type="button"
                          onClick={() => setOffSegments(on ? [...offSegments, s.name] : offSegments.filter((x) => x !== s.name))}
                          className={clsx(
                            "rounded-full border px-3 py-1 text-sm",
                            on ? "border-accent bg-accent/10 font-medium" : "border-line-hairline text-ink-muted line-through"
                          )}
                        >
                          {on ? "✓ " : ""}
                          {s.name} · {s.count}
                          {s.bought && <span className="text-ink-muted font-normal"> · покупали</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block text-sm">
                  <span className="text-xs text-ink-muted">Название обзвона</span>
                  <input className="input mt-1" value={campaign} maxLength={60} onChange={(e) => setCampaign(e.target.value)} />
                </label>
                <div className="text-sm">
                  <span className="text-xs text-ink-muted">Кому отдать</span>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    <label className="flex items-center gap-1.5">
                      <input type="radio" checked={mode === "deal"} onChange={() => setMode("deal")} /> поровну случайно
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" checked={mode === "file"} onChange={() => setMode("file")} /> как в файле
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input type="radio" checked={mode === "none"} onChange={() => setMode("none")} /> никому
                    </label>
                  </div>
                </div>
              </div>

              {mode === "deal" && (
                <div className="space-y-1.5">
                  <div className="text-xs text-ink-muted">
                    Между кем делить — у каждого выйдет примерно {team.length ? Math.ceil(chosen.length / team.length) : 0}
                    {bought > 0 && team.length > 0 && `, из них бывших покупателей ~${Math.round(bought / team.length)}`}:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {managers.map((m) => {
                      const on = team.includes(m.email);
                      return (
                        <button
                          key={m.email}
                          type="button"
                          onClick={() => setTeam(on ? team.filter((x) => x !== m.email) : [...team, m.email])}
                          className={clsx(
                            "rounded-full border px-3 py-1 text-sm",
                            on ? "border-section-leads bg-section-leads-soft text-section-leads font-medium" : "border-line-hairline text-ink-secondary"
                          )}
                        >
                          {on ? "✓ " : ""}
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {mode === "file" && (
                <label className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-ink-secondary">кого в файле не узнали — отдать:</span>
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

              <div className="table-cards border border-line-hairline rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ink-secondary border-b border-line-hairline">
                      <th className="px-3 py-2 font-medium">Название</th>
                      <th className="px-3 py-2 font-medium">Телефон</th>
                      <th className="px-3 py-2 font-medium">Группа</th>
                      <th className="px-3 py-2 font-medium">Что известно</th>
                      <th className="px-3 py-2 font-medium">Итог</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => {
                      const off = !r.skip && offSegments.includes(r.segment);
                      return (
                        <tr key={r.line} className="border-b border-line-hairline/70 last:border-0 align-top">
                          <td className="px-3 py-1.5">
                            <span className="text-ink-muted text-xs mr-1">{r.line}</span>
                            {r.name || "—"}
                            {r.city && <span className="block text-xs text-ink-muted">{r.city}</span>}
                          </td>
                          <td data-label="Телефон" className="px-3 py-1.5 tabular-nums whitespace-nowrap">{r.phone}</td>
                          <td data-label="Группа" className="px-3 py-1.5">{r.segment}</td>
                          <td data-label="Что известно" className="px-3 py-1.5 text-xs text-ink-secondary max-w-[360px]">
                            <span className="line-clamp-2">{r.history}</span>
                          </td>
                          <td
                            data-label="Итог"
                            className={clsx("px-3 py-1.5", r.skip || off ? "text-ink-muted" : "text-status-good")}
                          >
                            {r.skip || (off ? "группу не грузим" : "новый")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <MoreToggle expanded={expanded} hidden={rows.length - shown.length} onToggle={() => setExpanded(!expanded)} what="строк" />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="btn-primary disabled:opacity-50"
                  disabled={!!busy || chosen.length === 0}
                  onClick={handleImport}
                >
                  {busy === "import" ? "Загружаю…" : `Загрузить ${chosen.length}`}
                </button>
                <button type="button" className="btn-secondary" onClick={() => { setResult(null); setError(null); }}>
                  Отмена
                </button>
                {offCount > 0 && <span className="text-xs text-ink-muted">не грузим по группам: {offCount}</span>}
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
