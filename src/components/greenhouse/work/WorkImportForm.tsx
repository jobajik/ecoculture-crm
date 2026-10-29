"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { unwrapValue } from "@/lib/actionResult";
import { AREA_LABELS, areaForSheet, importWorkId, parseWorkSheet, type ImportRow, type ImportSheetResult, type WorkArea } from "@/lib/payroll/work";

/**
 * Загрузка истории из книги «Учёт работ цветоводов» (.xlsx): файл разбирается в браузере (`xlsxLite`, как база
 * обзвона и штатная расстановка — ExcelJS на сервере читал бы минуты), листы узнаются по названию («Учёт срезки»,
 * «Учёт сортировки и упаковки», «Учёт посадки», «Учет подготовки»), сервер присылает номера уже загруженных строк, и
 * на сайт уходят только новые — кусками по 3 000, потому что запрос к серверному действию ограничен размером.
 * Повторная загрузка того же файла ничего не дублирует: номер строки — хэш её содержимого.
 */

type Preview = { sheets: (ImportSheetResult & { sheetName: string; fresh: number; already: number })[]; unknownSheets: string[]; total: number; fresh: number };

const CHUNK = 3000;

export default function WorkImportForm({
  farm,
  today,
  listIds,
  importRows,
  onClose,
}: {
  farm: string;
  today: string;
  listIds: (farm: string) => Promise<unknown>;
  importRows: (farm: string, rows: ImportRow[]) => Promise<unknown>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number; added: number } | null>(null);
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
      const ids = new Set(unwrapValue(await listIds(farm)) as string[]);
      const parsed: Preview["sheets"] = [];
      const unknownSheets: string[] = [];
      const seenAreas = new Set<WorkArea>();
      for (const s of sheets) {
        const area = areaForSheet(s.name);
        if (!area || seenAreas.has(area)) {
          if (!area && s.matrix.length > 50) unknownSheets.push(s.name);
          continue;
        }
        seenAreas.add(area);
        const r = parseWorkSheet(area, s.matrix, today);
        const fresh = r.rows.filter((row) => !ids.has(importWorkId(farm, row)));
        parsed.push({ ...r, sheetName: s.name, fresh: fresh.length, already: r.rows.length - fresh.length });
      }
      if (!parsed.length) throw new Error("В файле не нашлось листов учёта («Учёт срезки», «Учёт сортировки и упаковки», «Учёт посадки», «Учет подготовки»).");
      setPreview({ sheets: parsed, unknownSheets, total: parsed.reduce((s, p) => s + p.rows.length, 0), fresh: parsed.reduce((s, p) => s + p.fresh, 0) });
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
    const ids = new Set(unwrapValue(await listIds(farm)) as string[]);
    const rows = preview.sheets.flatMap((s) => s.rows).filter((r) => !ids.has(importWorkId(farm, r)));
    setProgress({ done: 0, total: rows.length, added: 0 });
    let added = 0;
    try {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = unwrapValue(await importRows(farm, rows.slice(i, i + CHUNK))) as { added: number; skipped: number };
        added += res.added;
        setProgress({ done: Math.min(rows.length, i + CHUNK), total: rows.length, added });
      }
      setResult(`Загружено ${added} строк.`);
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError(`${err instanceof Error ? err.message : "Не получилось."} Загружено ${added} строк — повторная загрузка файла продолжит с того места.`);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-secondary !py-1.5 cursor-pointer">
          Выбрать файл .xlsx
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        </label>
        {fileName && <span className="text-sm text-ink-secondary">{fileName}</span>}
        {busy === "read" && <span className="text-sm text-ink-muted">Читаю…</span>}
        <button type="button" className="text-sm text-ink-muted ml-auto" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <p className="text-xs text-ink-secondary">
        Книга «Учёт работ цветоводов» целиком: листы узнаются по названию, вид работ — по тому, как он написан в книге. Строки с непонятной датой или
        неизвестным видом работ пропускаются и показываются ниже. Уже загруженное не дублируется.
      </p>
      {error && <div className="text-sm text-[#a12b2b]">{error}</div>}
      {result && <div className="text-sm text-status-good">{result}</div>}
      {preview && (
        <div className="space-y-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-ink-muted text-left border-b border-line-hairline">
                <th className="py-1.5 font-medium">Лист</th>
                <th className="py-1.5 font-medium">Участок</th>
                <th className="py-1.5 font-medium text-right">Строк</th>
                <th className="py-1.5 font-medium text-right">Новых</th>
                <th className="py-1.5 font-medium text-right">Уже есть</th>
                <th className="py-1.5 font-medium text-right">Пропущено</th>
              </tr>
            </thead>
            <tbody>
              {preview.sheets.map((s) => (
                <tr key={s.sheetName} className="border-b border-line-hairline/60">
                  <td className="py-1.5">{s.sheetName}</td>
                  <td className="py-1.5 text-ink-secondary">{AREA_LABELS[s.area]}</td>
                  <td className="py-1.5 text-right tabular-nums">{s.rows.length}</td>
                  <td className="py-1.5 text-right tabular-nums font-medium">{s.fresh}</td>
                  <td className="py-1.5 text-right tabular-nums text-ink-muted">{s.already}</td>
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
          {preview.unknownSheets.length > 0 && <div className="text-xs text-ink-muted">Листы не про выработку, пропущены: {preview.unknownSheets.join(", ")}.</div>}
          {progress && (
            <div className="text-sm">
              <div className="h-2 rounded-full bg-surface-sunk overflow-hidden">
                <div className="h-full bg-section-greenhouse transition-all" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 100}%` }} />
              </div>
              <div className="text-xs text-ink-muted mt-1">
                {progress.done} из {progress.total} · записано {progress.added}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary" disabled={busy !== "" || preview.fresh === 0} onClick={run}>
              {busy === "import" ? "Загружаю…" : preview.fresh ? `Загрузить ${preview.fresh} новых строк` : "Нового в файле нет"}
            </button>
            <span className="text-xs text-ink-muted">Загрузка идёт кусками; страницу не закрывайте.</span>
          </div>
        </div>
      )}
    </div>
  );
}
