"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importBatchesAction, parseBatchesFileAction } from "@/app/warehouse/actions";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import type { ParsedBatchRow, ParseResult } from "@/lib/excel";

export default function BatchImportForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; totalStems: number } | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setDone(null);
    setResult(null);
    setFileName(file.name);
    setParsing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const parsed = await parseBatchesFileAction(formData);
      setResult(parsed);
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
      const summary = await importBatchesAction(result.rows.filter((r) => !r.error));
      setDone(summary);
      setResult(null);
      setFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить партии");
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
          <h2 className="font-medium">Загрузка файлом</h2>
          <p className="text-sm text-ink-secondary mt-0.5">
            Excel-файл со списком партий за день. Перед записью покажу, что распозналось.
          </p>
        </div>
        <a href="/api/warehouse/template" className="btn-secondary !py-1.5">
          ↓ Скачать шаблон
        </a>
      </div>

      <div>
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
        {fileName && !parsing && (
          <p className="text-xs text-ink-muted mt-2">Файл: {fileName}</p>
        )}
        {parsing && <p className="text-sm text-ink-secondary mt-2">Читаю файл…</p>}
      </div>

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>
      )}

      {done && (
        <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">
          Загружено партий: <b>{done.created}</b>, всего {done.totalStems.toLocaleString("ru-RU")} шт.
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
            <span className="text-status-good font-medium">Готово к загрузке: {result.validCount}</span>
            {result.errorCount > 0 && (
              <span className="text-status-critical font-medium">С ошибками: {result.errorCount}</span>
            )}
          </div>

          <div className="overflow-x-auto border border-line-hairline rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline bg-surface-plane">
                  <th className="px-3 py-2 font-medium">Строка</th>
                  <th className="px-3 py-2 font-medium">Сбор</th>
                  <th className="px-3 py-2 font-medium">Тип / сорт</th>
                  <th className="px-3 py-2 font-medium">Длина / категория</th>
                  <th className="px-3 py-2 font-medium">Кол-во</th>
                  <th className="px-3 py-2 font-medium">Место</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <PreviewRow key={row.rowNumber} row={row} />
                ))}
                {result.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-ink-muted">
                      В файле не нашлось ни одной строки с данными
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {result.errorCount > 0 && (
            <p className="text-xs text-ink-muted">
              Строки с ошибками загружены не будут — исправьте их в файле и загрузите снова, либо
              добавьте вручную ниже.
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleImport}
              disabled={importing || result.validCount === 0}
              className="btn-primary disabled:opacity-50"
            >
              {importing ? "Загрузка…" : `Загрузить ${result.validCount} партий на склад`}
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

function PreviewRow({ row }: { row: ParsedBatchRow }) {
  return (
    <>
      <tr className="border-b border-line-hairline last:border-0">
        <td className="px-3 py-2 text-ink-muted">{row.rowNumber}</td>
        <td className="px-3 py-2">
          {row.harvestDate ? new Date(row.harvestDate).toLocaleDateString("ru-RU") : "—"}
        </td>
        <td className="px-3 py-2">
          {FLOWER_TYPE_LABELS[row.flowerType]} {row.variety}
        </td>
        <td className="px-3 py-2">{row.grade ? formatGrade(row.grade) : "—"}</td>
        <td className="px-3 py-2">{row.quantity || "—"}</td>
        <td className="px-3 py-2 text-ink-secondary">{row.location || "—"}</td>
      </tr>
      {row.error && (
        <tr className="border-b border-line-hairline last:border-0">
          <td colSpan={6} className="px-3 pb-2 text-xs text-status-critical">
            ⛔ {row.error}
          </td>
        </tr>
      )}
    </>
  );
}
