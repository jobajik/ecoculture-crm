"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { unwrapValue } from "@/lib/actionResult";
import { importLogId, logForSheet, parseCuttingsSheet, parseCyclesSheet, parseHarvestSheet, parseWasteSheet, type CycleDraft, type ImportLogRow, type LogKind } from "@/lib/greenhouse/production";

/**
 * Загрузка книги агронома (.xlsx) целиком: «Учёт цветка» → срезка, «Черенкование», «Учёт отбракованного…» → брак,
 * «Данные по датам» → даты циклов. Файл разбирается в браузере (`xlsxLite`), сервер присылает номера уже загруженных
 * строк, и на сайт уходят только новые — кусками по 3 000 (предел размера запроса). Повторная загрузка того же файла
 * ничего не дублирует: номер строки — хэш её содержимого. Даты циклов дописываются, а у существующих заполняются
 * только пустые даты — правки на сайте файл не затирает.
 */

type SheetPlan = { sheetName: string; log: LogKind; rows: ImportLogRow[]; fresh: ImportLogRow[]; skipped: { line: number; why: string }[] };
type Preview = { sheets: SheetPlan[]; cycles: { sheetName: string; rows: CycleDraft[]; skipped: { line: number; why: string }[] } | null };

const LABEL: Record<LogKind, string> = { harvest: "Срезка", cuttings: "Черенкование", waste: "Брак" };
const CHUNK = 3000;

export default function GhImportForm({
  farm,
  today,
  only,
  listIds,
  importRows,
  importCycles,
  onClose,
}: {
  farm: string;
  today: string;
  /** Загрузить только этот журнал (со страницы журнала); без него — всё, что найдётся в книге. */
  only?: LogKind;
  listIds: (log: string, farm: string) => Promise<unknown>;
  importRows: (log: string, farm: string, rows: ImportLogRow[]) => Promise<unknown>;
  importCycles: (farm: string, rows: CycleDraft[]) => Promise<unknown>;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [showSkipped, setShowSkipped] = useState("");

  async function pick(file: File) {
    setError("");
    setPreview(null);
    setResult("");
    setFileName(file.name);
    setBusy("read");
    try {
      const lite = await import("@/lib/xlsxLite");
      const sheets = await lite.readXlsxSheets(await file.arrayBuffer());
      const plans: SheetPlan[] = [];
      let cycles: Preview["cycles"] = null;
      const seen = new Set<string>();
      for (const s of sheets) {
        const log = logForSheet(s.name);
        if (!log || seen.has(log)) continue;
        if (only && log !== only) continue;
        seen.add(log);
        if (log === "cycles") {
          const r = parseCyclesSheet(s.matrix);
          cycles = { sheetName: s.name, rows: r.rows.map((c) => ({ cycle: c.cycle, block: c.block, cuttingsAt: c.cuttingsAt, plantedAt: c.plantedAt, plannedHarvestAt: c.plannedHarvestAt, note: "" })), skipped: r.skipped };
          continue;
        }
        const r = log === "harvest" ? parseHarvestSheet(s.matrix, today) : log === "cuttings" ? parseCuttingsSheet(s.matrix, today) : parseWasteSheet(s.matrix, today);
        const ids = new Set(unwrapValue(await listIds(log, farm)) as string[]);
        plans.push({ sheetName: s.name, log, rows: r.rows, fresh: r.rows.filter((row) => !ids.has(importLogId(farm, log, row))), skipped: r.skipped });
      }
      if (!plans.length && !cycles)
        throw new Error(only ? `В файле нет листа «${only === "harvest" ? "Учёт цветка" : only === "cuttings" ? "Черенкование" : "Учёт отбракованного товара"}».` : "В файле не нашлось листов книги агронома («Учёт цветка», «Черенкование», «Учёт брака», «Данные по датам»).");
      setPreview({ sheets: plans, cycles });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Файл не прочитался.");
    } finally {
      setBusy("");
    }
  }

  async function run() {
    if (!preview) return;
    setError("");
    setBusy("import");
    const done: string[] = [];
    try {
      if (preview.cycles && preview.cycles.rows.length) {
        setProgress({ label: "Даты циклов", done: 0, total: preview.cycles.rows.length });
        const r = unwrapValue(await importCycles(farm, preview.cycles.rows)) as { added: number; updated: number };
        done.push(`даты циклов: новых ${r.added}, дополнено ${r.updated}`);
      }
      for (const s of preview.sheets) {
        const ids = new Set(unwrapValue(await listIds(s.log, farm)) as string[]);
        const rows = s.rows.filter((r) => !ids.has(importLogId(farm, s.log, r)));
        let added = 0;
        setProgress({ label: LABEL[s.log], done: 0, total: rows.length });
        for (let i = 0; i < rows.length; i += CHUNK) {
          const res = unwrapValue(await importRows(s.log, farm, rows.slice(i, i + CHUNK))) as { added: number };
          added += res.added;
          setProgress({ label: LABEL[s.log], done: Math.min(rows.length, i + CHUNK), total: rows.length });
        }
        done.push(`${LABEL[s.log].toLowerCase()}: ${added} строк`);
      }
      setResult(`Загружено — ${done.join("; ")}.`);
      setPreview(null);
      setProgress(null);
      router.refresh();
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "Не получилось."}${done.length ? ` Уже загружено — ${done.join("; ")}.` : ""} Повторная загрузка файла продолжит с того места.`);
    } finally {
      setBusy("");
    }
  }

  const freshTotal = (preview?.sheets.reduce((s, p) => s + p.fresh.length, 0) ?? 0) + (preview?.cycles?.rows.length ?? 0);

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-secondary !py-1.5 cursor-pointer">
          Выбрать файл .xlsx
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        </label>
        {fileName && <span className="text-sm text-ink-secondary truncate max-w-[16rem]">{fileName}</span>}
        {busy === "read" && <span className="text-sm text-ink-muted">Читаю…</span>}
        {onClose && (
          <button type="button" className="text-sm text-ink-muted ml-auto" onClick={onClose}>
            Закрыть
          </button>
        )}
      </div>
      <p className="text-xs text-ink-secondary">
        {only
          ? "Книга агронома: возьму из неё только этот журнал. Уже загруженное не дублируется."
          : "Книга агронома целиком: срезка, черенкование, брак и даты циклов. Строки с непонятной датой или без цикла пропускаются и показываются ниже. Уже загруженное не дублируется."}
      </p>
      {error && <div className="text-sm text-[#a12b2b]">{error}</div>}
      {result && <div className="text-sm text-status-good">{result}</div>}
      {preview && (
        <div className="space-y-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-ink-muted text-left border-b border-line-hairline">
                <th className="py-1.5 font-medium">Лист</th>
                <th className="py-1.5 font-medium">Куда</th>
                <th className="py-1.5 font-medium text-right">Строк</th>
                <th className="py-1.5 font-medium text-right">Новых</th>
                <th className="py-1.5 font-medium text-right">Пропущено</th>
              </tr>
            </thead>
            <tbody>
              {preview.cycles && (
                <tr className="border-b border-line-hairline/60">
                  <td className="py-1.5">{preview.cycles.sheetName}</td>
                  <td className="py-1.5 text-ink-secondary">Даты циклов</td>
                  <td className="py-1.5 text-right tabular-nums">{preview.cycles.rows.length}</td>
                  <td className="py-1.5 text-right tabular-nums text-ink-muted">сверю</td>
                  <td className="py-1.5 text-right tabular-nums">{preview.cycles.skipped.length || "—"}</td>
                </tr>
              )}
              {preview.sheets.map((s) => (
                <tr key={s.sheetName} className="border-b border-line-hairline/60">
                  <td className="py-1.5">{s.sheetName}</td>
                  <td className="py-1.5 text-ink-secondary">{LABEL[s.log]}</td>
                  <td className="py-1.5 text-right tabular-nums">{s.rows.length.toLocaleString("ru-RU")}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">{s.fresh.length.toLocaleString("ru-RU")}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {s.skipped.length ? (
                      <button type="button" className="underline" onClick={() => setShowSkipped((v) => (v === s.sheetName ? "" : s.sheetName))}>
                        {s.skipped.length}
                      </button>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.sheets
            .filter((s) => s.sheetName === showSkipped)
            .map((s) => (
              <div key={s.sheetName} className="text-xs text-ink-secondary max-h-48 overflow-y-auto rounded-lg bg-surface-sunk p-2">
                {s.skipped.slice(0, 200).map((k) => (
                  <div key={k.line}>
                    строка {k.line}: {k.why}
                  </div>
                ))}
                {s.skipped.length > 200 && <div>… и ещё {s.skipped.length - 200}</div>}
              </div>
            ))}
          {progress && (
            <div className="text-sm">
              <div className="h-2 rounded-full bg-surface-sunk overflow-hidden">
                <div className="h-full bg-section-greenhouse transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 100}%` }} />
              </div>
              <div className="text-xs text-ink-muted mt-1">
                {progress.label}: {progress.done.toLocaleString("ru-RU")} из {progress.total.toLocaleString("ru-RU")}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary" disabled={busy !== "" || freshTotal === 0} onClick={run}>
              {busy === "import" ? "Загружаю…" : freshTotal ? "Загрузить" : "Нового в файле нет"}
            </button>
            <span className="text-xs text-ink-muted">Загрузка идёт кусками; страницу не закрывайте.</span>
          </div>
        </div>
      )}
    </div>
  );
}
