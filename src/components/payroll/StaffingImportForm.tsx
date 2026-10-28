"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { unwrapValue } from "@/lib/actionResult";
import { FARM_LABELS, FARM_ORDER } from "@/lib/constants";
import { monthFromTitle } from "@/lib/payroll/staffingImport";

type Summary = {
  newDepartments: string[];
  unknownDepartments: string[];
  newEmployees: string[];
  changedEmployees: string[];
  newRates: string[];
  unchanged: number;
  noRate: string[];
};
type Result = { title: string; skipped: { line: number; why: string }[]; plan: Summary; written?: { departments: number; employees: number; changed: number; rates: number } };

/**
 * Загрузка штатной расстановки файлом (.xlsx той же формы, что гугл-книга): файл разбирается в браузере, сервер
 * показывает, что изменит, и пишет только по кнопке. Повторная загрузка того же файла ничего не дублирует —
 * сотрудник узнаётся по ФИО, ставка пишется, только если отличается.
 */
export default function StaffingImportForm({
  today,
  defaultFarm,
  importStaffing,
  onClose,
}: {
  today: string;
  defaultFarm: string;
  importStaffing: (matrix: string[][], from: string, farm: string, dry: boolean) => Promise<unknown>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [matrix, setMatrix] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [farm, setFarm] = useState(defaultFarm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);

  async function pick(file: File) {
    setError("");
    setPreview(null);
    setDone(null);
    setFileName(file.name);
    try {
      const lite = await import("@/lib/xlsxLite");
      const sheets = /\.csv$/i.test(file.name)
        ? [{ name: file.name, matrix: lite.parseCsv(await file.text()) }]
        : await lite.readXlsxSheets(await file.arrayBuffer());
      const sheet = sheets.find((s) => /штатн/i.test(s.name)) ?? sheets.find((s) => s.matrix.some((r) => r.some((c) => /фио/i.test(c)))) ?? sheets[0];
      if (!sheet) throw new Error("В файле нет листов.");
      setMatrix(sheet.matrix);
      const title = sheet.matrix.slice(0, 15).flat().find((c) => /штатная расстановка/i.test(c)) ?? "";
      setFrom(monthFromTitle(title, `${today.slice(0, 7)}-01`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось прочитать файл");
      setMatrix(null);
    }
  }

  async function run(dry: boolean) {
    if (!matrix) return;
    setBusy(true);
    setError("");
    try {
      const r = unwrapValue(await importStaffing(matrix, from, farm, dry)) as Result;
      if (dry) setPreview(r);
      else {
        setDone(r);
        setPreview(null);
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  const list = (title: string, items: string[], tone = "") =>
    items.length ? (
      <details className="text-sm" open={items.length <= 12}>
        <summary className={`cursor-pointer font-medium ${tone}`}>
          {title}: {items.length}
        </summary>
        <ul className="mt-1 ml-4 list-disc text-ink-secondary space-y-0.5 max-h-64 overflow-y-auto">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </details>
    ) : null;

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">Загрузить штатную расстановку</div>
          <p className="text-xs text-ink-muted mt-0.5">Файл .xlsx той же формы, что ваша гугл-книга: ФИО, подразделение, должность, ТД/ГПХ, оклад, KPI, ИТОГО, дорожные. Загружать можно каждый месяц — повторы не задваиваются.</p>
        </div>
        <button type="button" className="text-sm text-ink-muted hover:text-ink-primary" onClick={onClose}>
          закрыть
        </button>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="sm:col-span-1">
          <label className="label">Файл</label>
          <input
            className="input"
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
            }}
          />
        </div>
        <div>
          <label className="label">Компания (ТОО)</label>
          <select className="input" value={farm} onChange={(e) => setFarm(e.target.value)}>
            {FARM_ORDER.map((f) => (
              <option key={f} value={f}>
                {FARM_LABELS[f]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Ставки действуют с</label>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <p className="text-xs text-ink-muted mt-1">Обычно первое число месяца штатки.</p>
        </div>
      </div>
      {error && <p className="text-sm text-status-critical">{error}</p>}
      {matrix && !preview && !done && (
        <button type="button" className="btn-primary" disabled={busy} onClick={() => run(true)}>
          {busy ? "Разбираю…" : `Проверить файл${fileName ? ` «${fileName}»` : ""}`}
        </button>
      )}
      {preview && (
        <div className="space-y-2 border-t border-line-hairline pt-3">
          {preview.title && <div className="text-sm text-ink-secondary">{preview.title}</div>}
          {list("Новые подразделения", preview.plan.newDepartments)}
          {preview.plan.unknownDepartments.length > 0 && (
            <p className="text-xs text-[#8a5a00]">Подразделения, которых программа не знает: {preview.plan.unknownDepartments.join(", ")} — заведутся как пятидневка без сверхурочных; правила поправьте в «Подразделениях».</p>
          )}
          {list("Заведём сотрудников", preview.plan.newEmployees)}
          {list("Новые ставки у существующих", preview.plan.newRates, "text-section-payroll")}
          {list("Изменим в карточках", preview.plan.changedEmployees)}
          {list("Без оклада в файле — заведём без ставки", preview.plan.noRate, "text-[#8a5a00]")}
          {list("Строки, которые пропущены", preview.skipped.map((s) => `строка ${s.line}: ${s.why}`), "text-[#8a5a00]")}
          <p className="text-sm text-ink-muted">Без изменений: {preview.plan.unchanged}.</p>
          {preview.plan.newEmployees.length + preview.plan.newRates.length + preview.plan.changedEmployees.length + preview.plan.newDepartments.length === 0 ? (
            <p className="text-sm bg-status-good/10 text-status-good rounded-lg px-3 py-2">Всё уже совпадает с базой — записывать нечего.</p>
          ) : (
            <div className="flex gap-2">
              <button type="button" className="btn-primary" disabled={busy} onClick={() => run(false)}>
                {busy ? "Записываю…" : "Записать в базу"}
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setPreview(null)}>
                Отмена
              </button>
            </div>
          )}
        </div>
      )}
      {done?.written && (
        <p className="text-sm bg-status-good/10 text-status-good rounded-lg px-3 py-2">
          Записано: подразделений {done.written.departments}, сотрудников {done.written.employees}, правок карточек {done.written.changed}, ставок {done.written.rates}.
        </p>
      )}
    </div>
  );
}
