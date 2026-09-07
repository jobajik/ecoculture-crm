"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importForecastAction, parseForecastFileAction } from "@/app/forecast/actions";
import { FLOWER_TYPE_LABELS, formatGrade, periodLabel, weekLabel } from "@/lib/constants";
import type { ForecastParseResult } from "@/lib/excel";

/**
 * Загрузка прогноза срезки файлом. Сначала показываем, что распозналось, и
 * только по кнопке записываем: неверно понятый файл, молча ушедший в таблицу, —
 * худший вид ошибки, потому что о нём узнают через месяц.
 */
export default function ForecastImportForm({ month }: { month: string }) {
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
      formData.append("month", month);
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
      const summary = await importForecastAction(result.varieties, result.mix);
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
            На каждый цветок два листа: «сорта» (строки — сорта) и «ростовка» (строки — длины, на
            весь цветок). Колонки — недели, в ячейках количество. Загружается в{" "}
            <b className="capitalize">{periodLabel(month)}</b>; позиции, которых в файле нет,
            останутся как были.
          </p>
        </div>
        <a href={`/api/forecast/template?period=${month}`} className="btn-secondary !py-1.5">
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
          {done.created}), по сортам {done.totalStems.toLocaleString("ru-RU")} шт.
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

          <PreviewTable
            title="Сорта"
            labelHeader="Сорт"
            rows={result.varieties.map((r) => ({
              key: `v-${r.sheet}-${r.rowNumber}-${r.week}`,
              sheet: r.sheet,
              rowNumber: r.rowNumber,
              week: r.week,
              flowerType: r.flowerType,
              label: r.variety,
              stems: r.stems,
              error: r.error,
            }))}
          />

          <PreviewTable
            title="Ростовка"
            labelHeader="Длина / категория"
            rows={result.mix.map((r) => ({
              key: `m-${r.sheet}-${r.rowNumber}-${r.week}`,
              sheet: r.sheet,
              rowNumber: r.rowNumber,
              week: r.week,
              flowerType: r.flowerType,
              label: r.grade ? formatGrade(r.grade) : "",
              stems: r.stems,
              error: r.error,
            }))}
          />

          {result.errorCount > 0 && (
            <p className="text-xs text-ink-muted">
              Строки с ошибками загружены не будут — исправьте их в файле и загрузите снова либо
              введите вручную в таблицах ниже.
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

interface PreviewRowData {
  key: string;
  sheet: string;
  rowNumber: number;
  week: string;
  flowerType: string;
  label: string;
  stems: number;
  error?: string;
}

function PreviewTable({
  title,
  labelHeader,
  rows,
}: {
  title: string;
  labelHeader: string;
  rows: PreviewRowData[];
}) {
  if (rows.length === 0) return null;
  const bad = rows.filter((r) => r.error).length;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-ink-muted">
          строк: {rows.length}
          {bad > 0 && <span className="text-status-critical"> · с ошибками {bad}</span>}
        </span>
      </div>
      <div className="overflow-x-auto border border-line-hairline rounded-lg max-h-72">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline bg-surface-plane">
              <th className="px-3 py-2 font-medium">Лист · строка</th>
              <th className="px-3 py-2 font-medium">Неделя</th>
              <th className="px-3 py-2 font-medium">Цветок</th>
              <th className="px-3 py-2 font-medium">{labelHeader}</th>
              <th className="px-3 py-2 font-medium">Кол-во</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PreviewRow key={row.key} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PreviewRow({ row }: { row: PreviewRowData }) {
  return (
    <>
      <tr className="border-b border-line-hairline last:border-0">
        <td className="px-3 py-2 text-ink-muted whitespace-nowrap">
          {row.sheet} · {row.rowNumber}
        </td>
        <td className="px-3 py-2 whitespace-nowrap">{row.week ? weekLabel(row.week) : "—"}</td>
        <td className="px-3 py-2">{FLOWER_TYPE_LABELS[row.flowerType] ?? row.flowerType}</td>
        <td className="px-3 py-2">{row.label || "—"}</td>
        <td className="px-3 py-2 tabular-nums">{row.stems.toLocaleString("ru-RU")}</td>
      </tr>
      {row.error && (
        <tr className="border-b border-line-hairline last:border-0">
          <td colSpan={5} className="px-3 pb-2 text-xs text-status-critical">
            ⛔ {row.error}
          </td>
        </tr>
      )}
    </>
  );
}
