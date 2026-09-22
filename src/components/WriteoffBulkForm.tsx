"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  applyWriteoffsAction,
  parseWriteoffFileAction,
  previewWriteoffsAction,
} from "@/app/warehouse/actions";
import { unwrapValue } from "@/lib/actionResult";
import { formatDay } from "@/lib/formatDate";
import {
  DEFAULT_WRITEOFF_REASON,
  positionKey,
  positionLabel,
  type StockPosition,
  type WriteoffLine,
  type WriteoffPlan,
} from "@/lib/writeoffPlan";

const REASONS = [DEFAULT_WRITEOFF_REASON, "Брак", "Сломан при сборке", "Не продан, завял"];

/**
 * Списание общим количеством — «как приёмке».
 *
 * Два входа в одно и то же: список позиций склада прямо на экране (вписал
 * количество напротив строки) и файл, выгруженный из этого же списка. Оба
 * собирают строки «позиция — сколько», дальше путь общий: «Проверить» →
 * сервер раскладывает по партиям от старых к свежим и показывает, откуда что
 * снимет → «Списать». До нажатия второй кнопки ничего не пишется.
 */
export default function WriteoffBulkForm({ positions }: { positions: StockPosition[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState(DEFAULT_WRITEOFF_REASON);
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [fileLines, setFileLines] = useState<WriteoffLine[] | null>(null);
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [plan, setPlan] = useState<{ lines: WriteoffLine[]; result: WriteoffPlan } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? positions.filter((p) => positionLabel(p).toLowerCase().includes(q)) : positions;
  }, [positions, search]);

  const manualLines: WriteoffLine[] = positions
    .filter((p) => Number(qty[positionKey(p)]) > 0)
    .map((p) => ({
      flowerType: p.flowerType,
      variety: p.variety,
      grade: p.grade,
      quantity: Number(qty[positionKey(p)]),
      reason,
    }));
  const lines = fileLines ?? manualLines;
  const linesTotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);

  async function handleFile(file: File) {
    setError(null);
    setDone(null);
    setPlan(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const parsed = unwrapValue(await parseWriteoffFileAction(fd));
      if (parsed.fatalError) {
        setError(parsed.fatalError);
        setFileLines(null);
        return;
      }
      setFileErrors(parsed.rows.filter((r) => r.error).map((r) => `Строка ${r.rowNumber}: ${r.error}`));
      setFileLines(
        parsed.rows
          .filter((r) => !r.error)
          .map((r) => ({ ...r, reason: r.reason || reason }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать файл");
    } finally {
      setBusy(false);
    }
  }

  function clearFile() {
    setFileLines(null);
    setFileErrors([]);
    setPlan(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function check() {
    setError(null);
    setDone(null);
    if (lines.length === 0) return setError("Впишите, сколько списать, хотя бы в одну строку");
    setBusy(true);
    try {
      const result = unwrapValue(await previewWriteoffsAction(lines, note));
      setPlan({ lines, result });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось проверить");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!plan) return;
    setError(null);
    setBusy(true);
    try {
      const r = unwrapValue(await applyWriteoffsAction(plan.lines, note));
      setDone(`Списано ${nf(r.total)} шт. — ${batchWord(r.batches)}.`);
      setPlan(null);
      setQty({});
      clearFile();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось списать");
    } finally {
      setBusy(false);
    }
  }

  const planOk = plan && !plan.result.errors.some(Boolean);

  return (
    <div className="space-y-6">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-medium">Файлом</h2>
            <p className="text-sm text-ink-secondary mt-0.5">
              Впишите «Списать, шт» напротив нужных строк.
            </p>
          </div>
          <a href="/api/warehouse/writeoff-template" className="btn-secondary !py-1.5">
            ↓ Шаблон
          </a>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx"
          className="block w-full text-sm text-ink-secondary file:mr-3 file:rounded-lg file:border file:border-line-hairline file:bg-surface-plane file:px-4 file:py-2 file:text-sm file:font-medium file:text-ink-primary"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        {fileLines && (
          <div className="text-sm">
            Строк из файла: <b>{fileLines.length}</b>, всего {nf(linesTotal)} шт.{" "}
            <button type="button" className="underline text-ink-secondary" onClick={clearFile}>
              убрать файл
            </button>
          </div>
        )}
        {fileErrors.length > 0 && (
          <ul className="text-sm text-status-critical space-y-0.5">
            {fileErrors.map((e) => (
              <li key={e}>{e} — эта строка не списывается</li>
            ))}
          </ul>
        )}
      </div>

      {!fileLines && (
        <div className="card !p-0">
          <div className="p-4 flex flex-wrap items-end justify-between gap-3 border-b border-line-hairline">
            <h2 className="font-medium">Вручную</h2>
            <input
              className="input !w-56"
              placeholder="Найти сорт…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="table-scroll table-cards">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-4 py-2.5 font-medium">Позиция</th>
                  <th className="px-3 py-2.5 font-medium text-right">На складе</th>
                  <th className="px-3 py-2.5 font-medium text-right">Списать, шт</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => {
                  const k = positionKey(p);
                  const v = Number(qty[k]) || 0;
                  return (
                    <tr key={k} className="border-b border-line-hairline last:border-0">
                      <td className="px-4 py-2">{positionLabel(p)}</td>
                      <td data-label="На складе" className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                        {nf(p.stock)}
                      </td>
                      <td data-label="Списать, шт" className="px-3 py-2 text-right">
                        <input
                          className={clsx("input !w-28 text-right", v > p.stock && "!border-status-critical")}
                          inputMode="numeric"
                          value={qty[k] ?? ""}
                          placeholder="—"
                          onChange={(e) => {
                            setPlan(null);
                            setQty({ ...qty, [k]: e.target.value.replace(/[^\d]/g, "") });
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-ink-muted">
                      {positions.length === 0 ? "На складе ничего нет." : "Ничего не нашлось."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="label">Причина {fileLines && "(если нет в файле)"}</span>
            <input
              className="input"
              list="writeoff-reasons"
              value={reason}
              onChange={(e) => {
                setPlan(null);
                setReason(e.target.value);
              }}
            />
            <datalist id="writeoff-reasons">
              {REASONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </label>
          <label className="text-sm">
            <span className="label">Примечание</span>
            <input
              className="input"
              value={note}
              placeholder="с 24.08 по 07.09"
              onChange={(e) => {
                setPlan(null);
                setNote(e.target.value);
              }}
            />
          </label>
        </div>

        {plan && (
          <div className="border border-line-hairline rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <tbody>
                {plan.lines.map((l, i) => (
                  <tr key={i} className="border-b border-line-hairline last:border-0 align-top">
                    <td className="px-3 py-2">{positionLabel(l)}</td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{nf(l.quantity)} шт.</td>
                    <td className="px-3 py-2 text-xs">
                      {plan.result.errors[i] ? (
                        <span className="text-status-critical">{plan.result.errors[i]}</span>
                      ) : (
                        <span className="text-ink-muted">
                          {plan.result.byLine[i]
                            .map((b) => `${nf(b.quantity)} из срезки ${formatDay(b.harvestDate)}`)
                            .join(", ")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && (
          <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>
        )}
        {done && (
          <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">{done}</div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {!planOk ? (
            <button type="button" className="btn-primary" disabled={busy || lines.length === 0} onClick={check}>
              {busy ? "Проверяю…" : `Проверить${linesTotal > 0 ? ` · ${nf(linesTotal)} шт.` : ""}`}
            </button>
          ) : (
            <>
              <button type="button" className="btn-primary" disabled={busy} onClick={apply}>
                {busy ? "Списываю…" : `Списать ${nf(plan!.result.total)} шт.`}
              </button>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setPlan(null)}>
                Поправить
              </button>
            </>
          )}
        </div>
        <p className="text-xs text-ink-muted">
          Если хоть одна строка не сходится с остатком — не спишется ничего.
        </p>
      </div>
    </div>
  );
}

/** «из 1 партии», «из 2 партий», «из 5 партий». */
function batchWord(n: number): string {
  const t = n % 100;
  return t % 10 === 1 && t !== 11 ? `из ${n} партии` : `из ${n} партий`;
}
