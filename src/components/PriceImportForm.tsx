"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importPricesAction, parsePriceFileAction } from "@/app/prices/actions";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import { BASE_VARIETY_LABEL } from "@/lib/priceList";
import type { PriceParseResult } from "@/lib/excel";
import MoreToggle from "./MoreToggle";
import Hint from "./Hint";
import { unwrapValue } from "@/lib/actionResult";

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
export default function PriceImportForm({ kind = "" }: { kind?: string }) {
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
      setResult(unwrapValue(await parsePriceFileAction(formData, kind)));
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
      setDone(unwrapValue(await importPricesAction(result.rows.filter((r) => !r.error), kind)));
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

  // Без файла это две кнопки в строке инструментов, а не отдельная карточка с
  // полем выбора файла: карточка занимала полэкрана, а нужна раз в месяц.
  // Предпросмотр, когда он есть, встаёт на всю ширину следующей строкой.
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 ml-auto">
        <a
          href={kind ? `/api/prices/template?kind=${kind}` : "/api/prices/template"}
          className="btn-secondary !py-1.5"
          title="Файл уже с действующими ценами: правьте только то, что меняется"
        >
          ↓ Excel
        </a>
        <button
          type="button"
          className="btn-secondary !py-1.5 disabled:opacity-50"
          disabled={parsing || importing}
          onClick={() => fileInputRef.current?.click()}
        >
          {parsing ? "Читаю файл…" : "Загрузить из Excel"}
        </button>
        <Hint>
          Скачайте файл — в нём уже действующие цены, — поправьте нужное и загрузите обратно. Лист на
          цветок, строки — сорта, колонки — длина или категория. Пустая ячейка — не менять, 0 — цены нет.
          Перед записью покажу «было → стало».
        </Hint>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      {(error || done || result) && (
      <div className="basis-full card space-y-4">
      {fileName && <p className="text-xs text-ink-muted">Файл: {fileName}</p>}

      {error && (
        <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {done && (
        <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">
          Прайс обновлён: записано цен <b>{done.updated + done.created}</b>.
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
            <p className="text-sm text-ink-secondary">Новых цен нет.</p>
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
      )}
    </>
  );
}
