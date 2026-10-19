"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  RECOUNT_REASON,
  positionKey,
  positionLabel,
  recountLines,
  type StockPosition,
  type WriteoffLine,
  type WriteoffPlan,
} from "@/lib/writeoffPlan";
import { WRITEOFF_REASONS } from "@/lib/writeoffReasons";
import { FLOWER_TYPE_LABELS } from "@/lib/constants";
import Chips, { type ChipItem } from "./Chips";
import Pager, { pageSlice } from "./Pager";
import Hint from "./Hint";

/** Строк позиций на странице: помещается в экран рядом с итогом. */
const ROWS = 12;


/**
 * Списание общим количеством — «как приёмке».
 *
 * Два входа в одно и то же: список позиций склада прямо на экране (вписал
 * количество напротив строки) и файл, выгруженный из этого же списка. Оба
 * собирают строки «позиция — сколько», дальше путь общий: «Проверить» →
 * сервер раскладывает по партиям от старых к свежим и показывает, откуда что
 * снимет → «Списать». До нажатия второй кнопки ничего не пишется.
 */
export default function WriteoffBulkForm({
  positions,
  initialMode = "writeoff",
  store = "",
}: {
  positions: StockPosition[];
  /** Склад: пусто — основной, «office» — подсклад «Офис». */
  store?: string;
  /** «recount» — пересчёт: вписывают, сколько лежит на самом деле. */
  initialMode?: "writeoff" | "recount";
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"writeoff" | "recount">(initialMode);
  const recount = mode === "recount";
  const fileRef = useRef<HTMLInputElement>(null);
  // Итог проверки — в нижней карточке; на телефоне кнопки стоят полоской у края
  // экрана, поэтому после нажатия показываем, что получилось.
  const resultRef = useRef<HTMLDivElement>(null);
  const showResult = () =>
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
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
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return positions.filter(
      (p) =>
        (!q || positionLabel(p).toLowerCase().includes(q)) &&
        (filter === "all" ||
          (filter === "filled" ? (qty[positionKey(p)] ?? "") !== "" : p.flowerType === filter))
    );
  }, [positions, search, filter, qty]);
  useEffect(() => setPage(0), [search, filter, mode]);
  const flowerTypes = Array.from(new Set(positions.map((p) => p.flowerType)));
  const filledCount = Object.values(qty).filter((v) => v !== "" && v !== undefined).length;
  const chipItems: ChipItem[] = [
    { value: "all", label: "Все", count: positions.length },
    ...(flowerTypes.length > 1
      ? flowerTypes.map((t) => ({
          value: t,
          label: FLOWER_TYPE_LABELS[t] ?? t,
          count: positions.filter((p) => p.flowerType === t).length,
        }))
      : []),
    ...(filledCount > 0 || filter === "filled" ? [{ value: "filled", label: "Вписано", count: filledCount }] : []),
  ];

  const manualLines: WriteoffLine[] = positions
    .filter((p) => Number(qty[positionKey(p)]) > 0)
    .map((p) => ({
      flowerType: p.flowerType,
      variety: p.variety,
      grade: p.grade,
      quantity: Number(qty[positionKey(p)]),
      reason,
    }));
  // В пересчёте пустое поле — «не считали», а «0» — «не осталось ни одного».
  const recounted = recountLines(
    positions,
    Object.fromEntries(
      Object.entries(qty).map(([k, v]) => [k, v === "" || v === undefined ? undefined : Number(v)])
    ),
    RECOUNT_REASON
  );
  const lines = recount ? recounted.lines : fileLines ?? manualLines;
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
      const result = unwrapValue(await previewWriteoffsAction(lines, note, store));
      setPlan({ lines, result });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось проверить");
    } finally {
      setBusy(false);
      showResult();
    }
  }

  async function apply() {
    if (!plan) return;
    setError(null);
    setBusy(true);
    try {
      const r = unwrapValue(await applyWriteoffsAction(plan.lines, note, store));
      setDone(`Списано ${nf(r.total)} шт. — ${batchWord(r.batches)}.`);
      setPlan(null);
      setQty({});
      clearFile();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось списать");
    } finally {
      setBusy(false);
      showResult();
    }
  }

  const planOk = plan && !plan.result.errors.some(Boolean);

  function switchMode(next: "writeoff" | "recount") {
    setMode(next);
    setQty({});
    setPlan(null);
    setDone(null);
    setError(null);
    clearFile();
  }

  const tabBtn = (on: boolean) =>
    clsx(
      "py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors",
      on ? "border-section-stock text-ink-primary font-semibold" : "border-transparent text-ink-secondary hover:text-ink-primary"
    );

  // Новый вид (19.10.2026): слева — позиции склада одной карточкой с вкладками, фильтром и страницами, справа —
  // причина, раскладка по партиям и кнопка. Раньше это были четыре карточки друг под другом.
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px] items-start pb-20 sm:pb-0">
      <div className="card !p-0 overflow-hidden min-w-0">
        <div className="flex flex-wrap items-center gap-x-5 px-4 sm:px-5 border-b border-line-hairline" role="tablist">
          {(
            [
              ["writeoff", "Списать количество"],
              ["recount", "Пересчёт: сколько лежит"],
            ] as const
          ).map(([m, label]) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)} className={tabBtn(mode === m)}>
              {label}
            </button>
          ))}
          {/* Файл грузят с компьютера; на телефоне у холодильника — только список. */}
          {!recount && (
            <div className="hidden sm:flex items-center gap-2 ml-auto py-2">
              <a href={`/api/warehouse/writeoff-template${store ? `?store=${store}` : ""}`} className="btn-secondary !py-1.5">
                ↓ Шаблон
              </a>
              <label className="btn-secondary !py-1.5 cursor-pointer">
                Загрузить файл
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </label>
            </div>
          )}
        </div>

        {!recount && fileLines ? (
          <div className="px-4 sm:px-5 py-5 space-y-3 text-sm">
            <div>
              Строк из файла: <b>{fileLines.length}</b>, всего {nf(linesTotal)} шт.{" "}
              <button type="button" className="underline text-ink-secondary" onClick={clearFile}>
                убрать файл
              </button>
            </div>
            {fileErrors.length > 0 && (
              <ul className="text-status-critical space-y-0.5">
                {fileErrors.map((e) => (
                  <li key={e}>{e} — эта строка не списывается</li>
                ))}
              </ul>
            )}
            <p className="text-ink-muted">Проверьте раскладку справа и спишите.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-col xl:flex-row xl:items-center gap-3 px-4 py-3 border-b border-line-hairline">
              <Chips value={filter} onChange={setFilter} items={chipItems} />
              <div className="flex items-center gap-2 xl:ml-auto">
                {recount && (
                  <span className="text-xs text-ink-muted whitespace-nowrap">
                    фактический остаток
                    <Hint>
                      Впишите, сколько <b>фактически</b> лежит. Разницу программа спишет сама, со старых партий. Пустое
                      поле — позицию не считали.
                    </Hint>
                  </span>
                )}
                <input
                  className="input !w-auto xl:w-[220px] min-w-0 flex-1"
                  placeholder="Найти сорт…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="table-scroll table-cards">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                    <th className="px-4 py-2.5 font-medium">Позиция</th>
                    <th className="px-3 py-2.5 font-medium text-right">На складе</th>
                    <th className="px-4 py-2.5 font-medium text-right">{recount ? "Фактически, шт" : "Списать, шт"}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageSlice(visible, page, ROWS).map((p) => {
                    const k = positionKey(p);
                    const v = Number(qty[k]) || 0;
                    return (
                      <tr key={k} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                        <td className="px-4 py-2">{positionLabel(p)}</td>
                        <td data-label="На складе" className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                          {nf(p.stock)}
                        </td>
                        <td data-label={recount ? "Фактически, шт" : "Списать, шт"} className="px-4 py-2 text-right">
                          <input
                            id={`wo-${k}`}
                            className={clsx(
                              "input !w-28 text-right",
                              !recount && v > p.stock && "!border-status-critical",
                              recount && qty[k] !== undefined && qty[k] !== "" && v > p.stock && "!border-status-warning"
                            )}
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
                      <td colSpan={3} className="px-4 py-10 text-center text-ink-muted">
                        {positions.length === 0 ? "На складе ничего нет." : "Ничего не нашлось."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pager total={visible.length} page={page} onPage={setPage} size={ROWS} what="позиций" />
          </>
        )}
      </div>

      <div ref={resultRef} className="card space-y-4 scroll-mt-4 xl:sticky xl:top-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[15px] font-bold">{recount ? "Итог пересчёта" : "Итог списания"}</h2>
          <span className="text-sm text-ink-secondary tabular-nums">
            {lines.length > 0 ? `${lines.length} поз. · ${nf(linesTotal)} шт.` : "ничего не вписано"}
          </span>
        </div>
        <div className="grid gap-3">
          {!recount && (
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
                {WRITEOFF_REASONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </label>
          )}
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

        {recount && recounted.surplus.length > 0 && (
          <div className="text-sm text-[#8a5a00] bg-status-warning/10 rounded-lg px-3 py-2">
            Больше, чем в программе: {recounted.surplus.map((x) => `${x.label} +${nf(x.extra)}`).join("; ")}. Это
            непринятая срезка — оформите её приёмкой, списание по этим позициям не нужно.
          </div>
        )}
        {recount && recounted.counted > 0 && recounted.lines.length === 0 && recounted.surplus.length === 0 && (
          <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">
            Посчитанное сходится с программой — списывать нечего.
          </div>
        )}

        {plan && (
          <ul className="border border-line-hairline rounded-lg divide-y divide-line-hairline text-sm max-h-[50vh] overflow-y-auto">
            {plan.lines.map((l, i) => (
              <li key={i} className="px-3 py-2">
                <div className="flex justify-between gap-3">
                  <span className="min-w-0">{positionLabel(l)}</span>
                  <span className="tabular-nums whitespace-nowrap font-medium">{nf(l.quantity)} шт.</span>
                </div>
                <div className="text-xs mt-0.5">
                  {plan.result.errors[i] ? (
                    <span className="text-status-critical">{plan.result.errors[i]}</span>
                  ) : (
                    <span className="text-ink-muted">
                      {plan.result.byLine[i].map((b) => `${nf(b.quantity)} из срезки ${formatDay(b.harvestDate)}`).join(", ")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && <div className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</div>}
        {done && <div className="text-sm text-status-good bg-status-good/10 rounded-lg px-3 py-2">{done}</div>}

        {/* На телефоне — полоска у нижнего края, над панелью разделов (как SaveBar):
            список позиций длинный, и кнопка не должна быть за три экрана от поля. */}
        <div className="no-print fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 px-4 sm:static sm:px-0">
          <div className="flex items-center gap-3 rounded-xl border border-line-hairline bg-surface px-3 py-2.5 shadow-card-hover sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
            {!planOk ? (
              <button type="button" className="btn-primary flex-1 disabled:opacity-50" disabled={busy || lines.length === 0} onClick={check}>
                {busy ? "Проверяю…" : `Проверить${linesTotal > 0 ? ` · ${recount ? "спишется " : ""}${nf(linesTotal)} шт.` : ""}`}
              </button>
            ) : (
              <>
                <button type="button" className="btn-primary flex-1" disabled={busy} onClick={apply}>
                  {busy ? "Списываю…" : `Списать ${nf(plan!.result.total)} шт.`}
                </button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => setPlan(null)}>
                  Поправить
                </button>
              </>
            )}
          </div>
        </div>
        <p className="text-xs text-ink-muted">Если хоть одна строка не сходится с остатком — не спишется ничего.</p>
      </div>
    </div>
  );
}

/** «из 1 партии», «из 2 партий», «из 5 партий». */
function batchWord(n: number): string {
  const t = n % 100;
  return t % 10 === 1 && t !== 11 ? `из ${n} партии` : `из ${n} партий`;
}
