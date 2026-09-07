"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importForecastAction, parseForecastFileAction } from "@/app/forecast/actions";
import { FLOWER_TYPE_LABELS, formatGrade, periodLabel } from "@/lib/constants";
import type { ForecastParseResult, ParsedForecastRow } from "@/lib/excel";

/**
 * Загрузка прогноза срезки файлом. Сначала показываем, что распозналось, и
 * только по кнопке записываем: неверно понятый файл, молча ушедший в таблицу, —
 * худший вид ошибки, потому что о нём узнают через месяц.
 */
export default function ForecastImportForm({ period }: { period: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ForecastParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ updated: number; created: number; totalStems: number } | null>(
    null
  );

  async function handleFile(file: File) {
    setError(null);
    setDone(null);
    setResult(null);
    setFileName(file.name);
    setParsing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      setResult(await parseForecastFileAction(formData));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось прочитать файл");
    } finally {
      setParsing(false);
    }
  }

  async function handleImport() {
    if (!result) return;
    setError(null);
    setImporting(true);
    try {
      const summary = await importForecastAction(
        period,
        result.rows.filter((r) => !r.error)
      );
      setDone(summary);
      setResult(null);
      setFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить прогноз");
    } finally {
      setImporting(false);
    }
  }

  function reset() {
    setResult(null);
    setFileName(null);
    setError(null);
    setDone(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Загрузка из Excel</h2>
          <p className="text-sm text-ink-secondary mt-0.5">
            Файл загрузится в выбранный месяц — <b className="capitalize">{periodLabel(period)}</b>.
            Позиции, которых в файле нет, останутся как были.
          </p>
        </div>
        <a href={`/api/forecast/template?period=${period}`} className="btn-secondary !py-1.5">
          ↓ Скачать шаблон
        </a>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx"
        className="block w-full text-sm text-ink-secondary file:mr-3 file:rounded-lg file:border file:border-line-hairline file:bg-surface-plane file:px-4 file:py-2 file:text-sm file:font-medium file:text-ink-primary hover:file:bg-line-hairline"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {fileName && !parsing && <p className="text-xs text-ink-muted">Файл: {fileName}</p>}
      {parsing && <p className="text-sm text-ink-secondary">Читаю файл…</p>}

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {done && (
        <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">
          Записано позиций: <b>{done.updated + done.created}</b> (обновлено {done.updated}, добавлено{" "}
          {done.created}), всего {done.totalStems.toLocaleString("ru-RU")} шт.
        </div>
      )}

      {result?.fatalError && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {result.fatalError}
        </div>
      )}

      {result && !result.fatalError && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <span className="text-status-good font-medium">
              Готово к загрузке: {result.validCount}
            </span>
            {result.errorCount > 0 && (
              <span className="text-status-critical font-medium">
                С ошибками: {result.errorCount}
              </span>
            )}
          </div>

          <div className="overflow-x-auto border border-line-hairline rounded-lg max-h-96">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline bg-surface-plane">
                  <th className="px-3 py-2 font-medium">Строка</th>
                  <th className="px-3 py-2 font-medium">Тип / сорт</th>
                  <th className="px-3 py-2 font-medium">Длина / категория</th>
                  <th className="px-3 py-2 font-medium">Кол-во</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <PreviewRow key={row.rowNumber} row={row} />
                ))}
                {result.rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-ink-muted">
                      В файле не нашлось ни одной строки с данными
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {result.errorCount > 0 && (
            <p className="text-xs text-ink-muted">
              Строки с ошибками загружены не будут — исправьте их в файле и загрузите снова либо
              введите вручную в таблице ниже.
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleImport}
              disabled={importing || result.validCount === 0}
              className="btn-primary disabled:opacity-50"
            >
              {importing ? "Загрузка…" : `Записать ${result.validCount} позиций в прогноз`}
            </button>
            <button onClick={reset} className="btn-secondary" disabled={importing}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewRow({ row }: { row: ParsedForecastRow }) {
  return (
    <>
      <tr className="border-b border-line-hairline last:border-0">
        <td className="px-3 py-2 text-ink-muted">{row.rowNumber}</td>
        <td className="px-3 py-2">
          {FLOWER_TYPE_LABELS[row.flowerType]} {row.variety}
        </td>
        <td className="px-3 py-2">{row.grade ? formatGrade(row.grade) : "—"}</td>
        <td className="px-3 py-2 tabular-nums">{row.stems.toLocaleString("ru-RU")}</td>
      </tr>
      {row.error && (
        <tr className="border-b border-line-hairline last:border-0">
          <td colSpan={4} className="px-3 pb-2 text-xs text-status-critical">
            ⛔ {row.error}
          </td>
        </tr>
      )}
    </>
  );
}
