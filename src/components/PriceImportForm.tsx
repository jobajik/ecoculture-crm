"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importPricesAction, parsePriceFileAction } from "@/app/prices/actions";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import { BASE_VARIETY_LABEL } from "@/lib/priceList";
import type { PriceParseResult } from "@/lib/excel";
import MoreToggle from "./MoreToggle";

/** Сколько строк предпросмотра видно без разворота. */
const VISIBLE_ROWS = 12;

/**
 * Загрузка прайса файлом. Как у агронома с прогнозом: сначала показываем, что
 * распозналось, и только по кнопке записываем.
 *
 * Отличие одно, но важное: в предпросмотре стоит «было → стало». Прайс — это
 * деньги, и разница между 250 и 25 замечается только тогда, когда старая цена
 * стоит рядом.
 */
export default function PriceImportForm() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<PriceParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ updated: number; created: number } | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function handleFile(file: File) {
    setError(null);
    setDone(null);
    setResult(null);
    setExpanded(false);
    setFileName(file.name);
    setParsing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      setResult(await parsePriceFileAction(formData));
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
      setDone(await importPricesAction(result.rows.filter((r) => !r.error)));
      setResult(null);
      setFileName(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить прайс");
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

  const rows = result?.rows ?? [];
  const shown = expanded ? rows : rows.slice(0, VISIBLE_ROWS);

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Загрузка прайса из Excel</h2>
          <p className="text-sm text-ink-secondary mt-0.5">
            Лист на цветок, строки — сорта, колонки — длина или категория. Файл выгружается{" "}
            <b>уже с действующими ценами</b>: правьте только то, что меняется. Пустая ячейка —
            «цену не трогаем», ноль — «цены нет». Дата изменения запомнится сама.
          </p>
        </div>
        <a href="/api/prices/template" className="btn-secondary !py-1.5">
          ↓ Скачать текущий прайс
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
          Прайс обновлён: записано цен <b>{done.updated + done.created}</b>. Дата изменения —
          сегодня, история сохранена ниже.
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
            <span className="text-status-good font-medium">Изменений: {result.validCount}</span>
            {result.errorCount > 0 && (
              <span className="text-status-critical font-medium">
                С ошибками: {result.errorCount}
              </span>
            )}
            <span className="text-ink-muted">Без изменений: {result.sameCount}</span>
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-ink-secondary">
              В файле нет ни одной новой цены — всё совпадает с тем, что уже стоит в прайсе.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto border border-line-hairline rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ink-secondary border-b border-line-hairline bg-surface-plane">
                      <th className="px-3 py-2 font-medium">Цветок</th>
                      <th className="px-3 py-2 font-medium">Сорт</th>
                      <th className="px-3 py-2 font-medium">Длина / категория</th>
                      <th className="px-3 py-2 font-medium text-right">Было</th>
                      <th className="px-3 py-2 font-medium text-right">Станет</th>
                      <th className="px-3 py-2 font-medium text-right">Разница</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row, i) => {
                      const diff =
                        row.wasPrice !== null && row.wasPrice > 0
                          ? ((row.price - row.wasPrice) / row.wasPrice) * 100
                          : null;
                      return (
                        <tr
                          key={`${row.sheet}-${row.rowNumber}-${row.grade}-${i}`}
                          className="border-b border-line-hairline last:border-0"
                        >
                          <td className="px-3 py-2">
                            {FLOWER_TYPE_LABELS[row.flowerType] ?? row.sheet}
                          </td>
                          <td className="px-3 py-2">{row.variety || BASE_VARIETY_LABEL}</td>
                          <td className="px-3 py-2">{formatGrade(row.grade)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-ink-muted">
                            {row.wasPrice === null
                              ? "—"
                              : row.wasPrice.toLocaleString("ru-RU")}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">
                            {row.error ? "—" : row.price.toLocaleString("ru-RU")}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {row.error ? (
                              <span className="text-status-critical">⛔ {row.error}</span>
                            ) : diff === null ? (
                              <span className="text-ink-muted">новая</span>
                            ) : (
                              <span
                                className={
                                  diff > 0
                                    ? "text-status-good"
                                    : diff < 0
                                    ? "text-status-critical"
                                    : "text-ink-muted"
                                }
                              >
                                {diff > 0 ? "+" : ""}
                                {diff.toFixed(1).replace(".", ",")} %
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <MoreToggle
                expanded={expanded}
                hidden={rows.length - shown.length}
                onToggle={() => setExpanded((v) => !v)}
                what="строк"
              />
            </>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleImport}
              disabled={importing || result.validCount === 0}
              className="btn-primary disabled:opacity-50"
            >
              {importing ? "Записываю…" : `Записать ${result.validCount} цен в прайс`}
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
