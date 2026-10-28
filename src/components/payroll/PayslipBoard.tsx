"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { unwrapValue } from "@/lib/actionResult";
import SaveBar from "@/components/SaveBar";
import { FARM_LABELS } from "@/lib/constants";
import { EMPLOYMENTS } from "@/lib/payroll/types";
import { advanceHalf, computePayslip, sumRows, type Adjustment, type PayslipInput, type PayslipRow, type PayslipTotals } from "@/lib/payroll/payslip";
import { TIMESHEET_STATUS_LABELS, monthLabel } from "@/lib/payroll/timesheet";
import type { PayslipMonth } from "@/lib/payroll/payslipData";

/**
 * Расчётная ведомость за месяц — один лист, как в книге бухгалтера (28.10.2026, владелец о первых версиях: «тихий ужас,
 * информативный шум»; «аккуратное что-то»; «удобно распечатать лист со всеми подразделениями пофамильно»).
 *
 * Устройство: одна таблица на все подразделения — заголовок группы, строки пофамильно (№, сотрудник, должность, часы,
 * оклад, начислено, удержано, к выплате), итог группы, внизу «Всего» и ТД/ГПХ. Нажатие на строку раскрывает под ней
 * РАСЧЁТ: у каждой цифры формула, поля бухгалтера рядом с тем, на что влияют (`CalcPanel`); пересчёт на месте тем же
 * `computePayslip`, что и сервер. Плитки сверху и плитки-фильтр по подразделениям — только на экране; «Печать» —
 * `window.print()`: шапка страницы и меню `no-print`, лист печатается с заголовком, всеми подразделениями и подписями.
 * Замечания (табель не принят, не посчитано, цветы без сотрудника) — одной серой строкой с «подробнее», не жёлтой плашкой.
 */

type Values = Omit<Adjustment, "month" | "employeeId">;
type NumField = Exclude<keyof Values, "note">;

const EMPTY: Values = { salaryOverride: null, sick: 0, vacation: 0, kpiDeduction: 0, advance: 0, loan: 0, flowers: null, note: "" };

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const money2 = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₸`;
const hours = (n: number) => (Math.round(n * 100) / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
const num = (raw: string) => {
  const n = Number(raw.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

const STATUS_TONE: Record<string, string> = {
  approved: "bg-status-good/10 text-status-good",
  submitted: "bg-[#fff4d6] text-[#8a5a00]",
  returned: "bg-[#fde8e8] text-[#a12b2b]",
  "": "bg-surface-sunk text-ink-secondary",
};

export default function PayslipBoard({
  data,
  canEdit,
  save,
}: {
  data: PayslipMonth;
  canEdit: boolean;
  save: (month: string, input: { employeeId: string; values: Partial<Record<keyof Adjustment, unknown>> }[]) => Promise<unknown>;
}) {
  const router = useRouter();
  const base = useMemo(() => {
    const m: Record<string, Values> = {};
    for (const d of data.depts) for (const i of d.inputs) m[i.employee.employeeId] = { ...i.adjustment };
    return m;
  }, [data]);
  const [values, setValues] = useState<Record<string, Values>>(base);
  const [resetKey, setResetKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [dept, setDept] = useState("");
  const [q, setQ] = useState("");
  const [showNotes, setShowNotes] = useState(false);

  const depts = useMemo(
    () =>
      data.depts.map((d) => {
        const rows = d.inputs
          .map((i) => ({ input: i, row: computePayslip({ ...i, adjustment: values[i.employee.employeeId] ?? i.adjustment }) }))
          .sort((a, b) => a.row.fullName.localeCompare(b.row.fullName, "ru"));
        return { ...d, rows, totals: sumRows(rows.map((r) => r.row)) };
      }),
    [data, values],
  );
  const all = depts.flatMap((d) => d.rows.map((r) => r.row));
  const totals = sumRows(all);
  const td = sumRows(all.filter((r) => r.employment === EMPLOYMENTS.TD));
  const gph = sumRows(all.filter((r) => r.employment === EMPLOYMENTS.GPH));
  const dirty = Object.keys(values).filter((id) => JSON.stringify(values[id]) !== JSON.stringify(base[id]));
  const warnings = all.filter((r) => r.warnings.length);
  const notApproved = depts.filter((d) => d.timesheetStatus !== "approved" && d.inputs.length);
  const needle = q.trim().toLowerCase();
  const noteCount = (notApproved.length ? 1 : 0) + (warnings.length ? 1 : 0) + (data.unmatchedFlowers.length ? 1 : 0);

  const setField = (id: string, field: keyof Values, raw: string) => {
    setValues((v) => {
      const cur = v[id] ?? { ...EMPTY };
      let next: number | null | string;
      if (field === "note") next = raw.trim();
      else if (field === "salaryOverride" || field === "flowers") next = raw.trim() === "" ? null : num(raw);
      else next = num(raw);
      return { ...v, [id]: { ...cur, [field]: next } };
    });
  };

  const advanceAll = () => {
    setValues((v) => {
      const next = { ...v };
      for (const d of data.depts)
        for (const i of d.inputs) {
          const id = i.employee.employeeId;
          const cur = next[id] ?? { ...EMPTY };
          if (!cur.advance) next[id] = { ...cur, advance: advanceHalf(i.rate) };
        }
      return next;
    });
    setResetKey((k) => k + 1);
  };

  const onReset = () => {
    setValues(base);
    setResetKey((k) => k + 1);
  };

  const onSave = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const r = unwrapValue(await save(data.month, dirty.map((id) => ({ employeeId: id, values: values[id] })))) as { changed: number; added: number };
      setMessage(`Сохранено: ${r.changed + r.added}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не сохранилось");
    } finally {
      setSaving(false);
    }
  };

  const shown = depts
    .filter((d) => !dept || d.department.deptId === dept)
    .map((d) => ({ ...d, rows: needle ? d.rows.filter((r) => `${r.row.fullName} ${r.row.position}`.toLowerCase().includes(needle)) : d.rows }))
    .filter((d) => d.rows.length > 0);
  const farmLabel = data.farm ? FARM_LABELS[data.farm] ?? data.farm : "обе компании";
  const pill = (active: boolean) =>
    clsx("h-8 px-3 rounded-full text-sm whitespace-nowrap transition-colors", active ? "bg-ink-primary text-white" : "border border-line-hairline bg-surface text-ink-secondary hover:bg-surface-plane");

  return (
    <div className="space-y-4 payslip">
      {/* Шапка только для печати: на экране её заменяет шапка страницы (она no-print). */}
      <div className="hidden print:block">
        <div className="font-display font-bold text-lg">Расчётная ведомость — {farmLabel}</div>
        <div className="text-sm text-ink-secondary">{monthLabel(data.month)}</div>
      </div>

      <div className="no-print grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="К выплате" value={money(totals.toPay)} strong sub={`${totals.people} чел.`} />
        <Tile label="Начислено" value={money(totals.accrued)} sub={`в т.ч. KPI ${money(totals.kpi)}`} />
        <Tile label="Удержано" value={money(totals.advance + totals.loan + totals.flowers)} sub="аванс, займ, цветы" />
        <Tile label="Дорожные" value={money(totals.travel)} sub="отдельной ведомостью" />
      </div>

      {noteCount > 0 && (
        <div className="no-print text-sm">
          <button type="button" className="text-ink-secondary hover:text-ink-primary" onClick={() => setShowNotes((v) => !v)}>
            <span className="text-[#8a5a00]">⚠</span>{" "}
            {[
              notApproved.length ? `табель не принят: ${notApproved.length} из ${depts.length}` : "",
              warnings.length ? `не посчитано до конца: ${warnings.length} чел.` : "",
              data.unmatchedFlowers.length ? `цветы без сотрудника: ${data.unmatchedFlowers.length}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
            <span className="text-section-payroll ml-2">{showNotes ? "скрыть" : "подробнее"}</span>
          </button>
          {showNotes && (
            <div className="mt-2 card !p-3 text-xs text-ink-secondary space-y-1.5">
              {notApproved.length > 0 && <div>Табель ещё не принят: {notApproved.map((d) => d.department.name).join(", ")} — цифры по ним предварительные.</div>}
              {warnings.length > 0 && <div>Не посчитано до конца у {warnings.length} чел. — у них стоит ⚠, причина видна при раскрытии строки.</div>}
              {data.unmatchedFlowers.length > 0 && (
                <div>
                  <div className="mb-1">Цветы со склада, которые не нашли сотрудника (впишите в строке руками):</div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-4">
                    {data.unmatchedFlowers.map((f) => (
                      <div key={f.name} className="flex justify-between gap-2 tabular-nums">
                        <span className="truncate">{f.name}</span>
                        <span className="shrink-0">
                          {money(f.amount)} <span className="text-ink-muted">· {f.why}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="no-print flex flex-wrap items-center gap-2">
        <div className="flex gap-2 overflow-x-auto scroll-x-hidden -mx-1 px-1 py-0.5">
          <button type="button" className={pill(dept === "")} onClick={() => setDept("")}>
            Все · {totals.people}
          </button>
          {depts.map((d) => (
            <button key={d.department.deptId} type="button" className={pill(dept === d.department.deptId)} onClick={() => setDept(dept === d.department.deptId ? "" : d.department.deptId)}>
              {d.department.name} · {d.rows.length}
            </button>
          ))}
        </div>
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <input className="input min-w-0 flex-1 sm:flex-none sm:!w-56" placeholder="Поиск по ФИО" value={q} onChange={(e) => setQ(e.target.value)} />
          {canEdit && (
            <button type="button" className="btn !py-1.5 text-sm whitespace-nowrap" onClick={advanceAll} disabled={saving} title="Половина ИТОГО целыми сотнями — тем, у кого аванс ещё не вписан">
              Аванс 50 %
            </button>
          )}
          <button type="button" className="btn !py-1.5 text-sm whitespace-nowrap hidden sm:inline-flex" onClick={() => window.print()}>
            Печать
          </button>
          {message && <span className="text-sm text-emerald-700">{message}</span>}
          {error && <span className="text-sm text-red-700">{error}</span>}
        </div>
      </div>

      <div className="card !p-0 overflow-hidden print:shadow-none print:border-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-ink-muted bg-surface-plane/60 border-b border-line-hairline">
              <th className="px-2 sm:px-4 py-2 text-left font-medium w-10">№</th>
              <th className="px-2 py-2 text-left font-medium">Сотрудник</th>
              <th className="px-2 py-2 text-left font-medium hidden md:table-cell print-col">Должность</th>
              <th className="px-2 py-2 text-right font-medium">Часы</th>
              <th className="px-2 py-2 text-right font-medium hidden sm:table-cell print-col">Оклад (1С)</th>
              <th className="px-2 py-2 text-right font-medium hidden sm:table-cell print-col">Начислено</th>
              <th className="px-2 py-2 text-right font-medium hidden sm:table-cell print-col">Удержано</th>
              <th className="px-2 sm:px-4 py-2 text-right font-medium">К выплате</th>
            </tr>
          </thead>
          {shown.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-muted">
                  Никого не нашлось.
                </td>
              </tr>
            </tbody>
          )}
          {shown.map((d) => (
            <tbody key={d.department.deptId}>
              <tr className="group-row bg-surface-plane/40 border-t border-line-hairline">
                <td colSpan={8} className="px-4 py-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span className="font-display font-bold">{d.department.name}</span>
                    <span className="text-xs text-ink-muted">{d.rows.length} чел.</span>
                    <span className={clsx("no-print rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[d.timesheetStatus])}>табель: {TIMESHEET_STATUS_LABELS[d.timesheetStatus]}</span>
                  </div>
                </td>
              </tr>
              {d.rows.map(({ input, row }, i) => {
                const rid = row.employeeId;
                const isOpen = openRow === rid;
                const held = row.advance + row.loan + row.flowers;
                return (
                  <Fragment key={rid}>
                    <tr
                      className={clsx("border-t border-line-hairline cursor-pointer", isOpen ? "bg-surface-plane/50" : "hover:bg-surface-plane/40")}
                      onClick={() => setOpenRow(isOpen ? null : rid)}
                    >
                      <td className="px-2 sm:px-4 py-2 text-ink-muted tabular-nums">{i + 1}</td>
                      {/* Ширина ФИО ограничена долей экрана: иначе длинное имя не даёт колонке ужаться, и на телефоне таблица уезжает за край. */}
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5 min-w-0 max-w-[42vw] sm:max-w-[18rem] lg:max-w-none">
                          <span className="font-medium truncate">{row.fullName}</span>
                          {row.warnings.length > 0 && (
                            <span className="no-print text-[#8a5a00] text-xs shrink-0" title={row.warnings.join("; ")}>
                              ⚠
                            </span>
                          )}
                        </div>
                        <div className="md:hidden print-hide text-xs text-ink-muted truncate max-w-[42vw] sm:max-w-[18rem]">{row.position}</div>
                      </td>
                      <td className="px-2 py-2 text-ink-secondary hidden md:table-cell print-col truncate max-w-[14rem]">
                        {row.position}
                        <span className="text-ink-muted"> · {row.employment === EMPLOYMENTS.GPH ? "ГПХ" : "ТД"}</span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-secondary whitespace-nowrap">
                        <HoursCell r={row} />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell print-col">{row.hourly ? <span className="text-ink-muted">почас.</span> : row.salary1c ? money(row.salary1c) : <span className="text-ink-muted">—</span>}</td>
                      <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell print-col">{money(row.accrued)}</td>
                      <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell print-col text-ink-secondary">{held ? money(held) : "—"}</td>
                      <td className={clsx("px-2 sm:px-4 py-2 text-right tabular-nums font-semibold whitespace-nowrap", row.toPay < 0 && "text-red-700")}>{money(row.toPay)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="no-print">
                        <td colSpan={8} className="p-0">
                          <CalcPanel key={`${rid}-${resetKey}`} input={input} r={row} v={values[rid] ?? EMPTY} canEdit={canEdit} onChange={(f, raw) => setField(rid, f, raw)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {shown.length > 1 && (
                <tr className="border-t border-line-hairline text-ink-secondary">
                  <td />
                  <td className="px-2 py-1.5 text-xs whitespace-nowrap">Итого · {d.department.name}</td>
                  {/* Своя клетка под «Должность», а не colSpan: скрытую колонку colSpan не видит и съедал бы соседнюю «Часы». */}
                  <td className="hidden md:table-cell print-col" />
                  <td className="px-2 py-1.5 text-right tabular-nums text-xs">{hours(d.totals.factHours)} ч</td>
                  <td className="hidden sm:table-cell print-col" />
                  <td className="px-2 py-1.5 text-right tabular-nums text-xs hidden sm:table-cell print-col">{money(d.totals.accrued)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-xs hidden sm:table-cell print-col">{money(d.totals.advance + d.totals.loan + d.totals.flowers)}</td>
                  <td className="px-2 sm:px-4 py-1.5 text-right tabular-nums text-xs font-medium text-ink-primary">{money(d.totals.toPay)}</td>
                </tr>
              )}
            </tbody>
          ))}
          {!needle && !dept && (
            <tfoot className="bg-surface-plane/60 border-t-2 border-line-hairline">
              <TotalRow label={`Всего · ${farmLabel}`} t={totals} strong />
              {td.people > 0 && gph.people > 0 && <TotalRow label="в том числе по ТД" t={td} />}
              {td.people > 0 && gph.people > 0 && <TotalRow label="в том числе по ГПХ" t={gph} />}
            </tfoot>
          )}
        </table>
      </div>

      <div className="hidden print:flex justify-between text-xs text-ink-secondary pt-6">
        <span>Бухгалтер по заработной плате ______________________</span>
        <span>Руководитель ______________________</span>
        <span>«____» ____________ 20___ г.</span>
      </div>

      {canEdit && <SaveBar count={dirty.length} what="человек" saving={saving} onSave={onSave} onReset={onReset} />}
    </div>
  );
}

function TotalRow({ label, t, strong }: { label: string; t: PayslipTotals; strong?: boolean }) {
  return (
    <tr className={clsx(strong ? "font-bold" : "text-ink-secondary text-xs")}>
      <td />
      <td className="px-2 py-2">
        {label} <span className="font-normal text-ink-muted">· {t.people} чел.</span>
      </td>
      <td className="hidden md:table-cell print-col" />
      <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">{hours(t.factHours)} ч</td>
      <td className="hidden sm:table-cell print-col" />
      <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell print-col">{money(t.accrued)}</td>
      <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell print-col">{money(t.advance + t.loan + t.flowers)}</td>
      <td className="px-2 sm:px-4 py-2 text-right tabular-nums whitespace-nowrap">{money(t.toPay)}</td>
    </tr>
  );
}

function HoursCell({ r }: { r: PayslipRow }) {
  if (r.hourly) return <>{hours(r.factHours)} ч{r.nightHours > 0 && <span className="text-ink-muted"> · ночь {hours(r.nightHours)}</span>}</>;
  const tone = r.factHours === 0 ? "text-ink-muted" : r.factHours > r.personalNorm ? "text-[#1f5fa8]" : r.factHours < r.personalNorm ? "text-red-700" : "";
  return (
    <>
      <span className={tone}>{hours(r.factHours)}</span>
      <span className="text-ink-muted hidden sm:inline"> / {hours(r.personalNorm)} ч</span>
    </>
  );
}

/**
 * Расчёт одного человека — две колонки «Начисления» и «Удержания», каждая строка показывает, откуда цифра.
 * Поля ввода стоят у тех строк, которые вписывает бухгалтер; остальное считает программа.
 */
function CalcPanel({
  input,
  r,
  v,
  canEdit,
  onChange,
}: {
  input: PayslipInput;
  r: PayslipRow;
  v: Values;
  canEdit: boolean;
  onChange: (field: keyof Values, raw: string) => void;
}) {
  const perHour = r.normHours > 0 ? r.salary1c / r.normHours : 0;
  const paidHours = Math.max(0, Math.min(r.factHours, r.personalNorm) - r.holidayHours);
  const fraction = r.normHours > 0 ? r.personalNorm / r.normHours : 1;
  const totalForMonth = Math.round(r.total * fraction * 100) / 100;
  const kpiBase = r.salaryPay + r.sick + r.vacation + r.holidayPay;
  const partial = fraction < 0.999;
  const held = r.advance + r.loan + r.flowers;
  const days = [
    ["отпуск", r.vacationDays],
    ["больничный", r.sickDays],
    ["командировка", r.tripDays],
    ["прогул", r.absentDays],
    ["без содержания", r.unpaidDays],
  ].filter(([, n]) => (n as number) > 0) as [string, number][];

  // Поле бухгалтера: одна ширина везде, пустое — «—» (считаем сами / по складу), вписанное — на жёлтом.
  const field = (f: NumField, placeholder?: number) => {
    if (!canEdit) return null;
    const raw = v[f];
    const text = raw === null || raw === undefined || raw === 0 ? "" : Number(raw).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
    return (
      <input
        className={clsx(
          "h-8 w-[7.5rem] rounded-md border px-2 text-right text-sm tabular-nums outline-none transition-colors",
          text ? "border-amber-300 bg-amber-50 text-amber-900" : "border-dashed border-line-hairline bg-transparent text-ink-primary placeholder:text-ink-muted/60",
          "focus:border-section-payroll focus:bg-surface"
        )}
        inputMode="decimal"
        defaultValue={text}
        placeholder={placeholder ? Math.round(placeholder).toLocaleString("ru-RU") : "—"}
        onBlur={(e) => {
          if (e.target.value.replace(/\s/g, "") !== text.replace(/\s/g, "")) onChange(f, e.target.value);
        }}
      />
    );
  };
  const amount = (n: number, muted?: boolean) => (
    <span className={clsx("tabular-nums", n === 0 ? "text-ink-muted/60" : muted && "text-ink-secondary")}>{n === 0 ? "—" : money2(n)}</span>
  );

  return (
    <div className="px-2 pb-3 pt-1 sm:px-4">
      <div className="rounded-xl border border-line-hairline bg-surface shadow-sm">
        {/* Шапка листка: кто, ставка, табель — одной строкой, замечания чипами. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-hairline px-4 py-2.5 text-xs text-ink-secondary">
          <span className="font-medium text-ink-primary">{r.fullName}</span>
          <span>{r.position || "без должности"} · {r.employment === "gph" ? "ГПХ" : "ТД"}</span>
          {r.hourly ? (
            <span className="tabular-nums">тариф день {money(input.rate?.dayRate ?? 0)} · ночь {money(input.rate?.nightRate ?? 0)}</span>
          ) : (
            <span className="tabular-nums">
              оклад (1С) {money(r.salary1c)} · ИТОГО {money(r.total)}
              {partial ? ` → ${money(totalForMonth)} за ${hours(r.personalNorm)} из ${hours(r.normHours)} ч` : ""} · час {money2(perHour)}
            </span>
          )}
          <span className="tabular-nums">
            табель {hours(r.factHours)} ч · {r.workDays} дн.
            {days.length > 0 && ` · ${days.map(([l, n]) => `${l} ${n}`).join(", ")}`}
          </span>
          {r.warnings.map((w) => (
            <span key={w} className="rounded-full bg-[#fdf3dc] px-2 py-0.5 text-[11px] font-medium text-[#6b4a00]">⚠ {w}</span>
          ))}
        </div>

        <div className="grid md:grid-cols-2 md:divide-x divide-line-hairline">
          <div className="px-4 py-3">
            <SheetTitle>Начисления</SheetTitle>
            <SheetLine
              label="Оклада"
              how={
                r.salaryOverridden
                  ? "вписано вручную"
                  : r.hourly
                    ? `${hours(r.factHours - r.nightHours)} ч день + ${hours(r.nightHours)} ч ночь`
                    : `${hours(paidHours)} ч × ${money2(perHour)}`
              }
              control={field("salaryOverride", r.salaryOverridden ? undefined : r.salaryPay)}
              value={amount(r.salaryPay)}
            />
            {!r.hourly && (
              <SheetLine label="Праздничные" how={r.holidayHours > 0 ? `${hours(r.holidayHours)} ч × ${money2(perHour)} × 1,5` : "в праздники не работал"} value={amount(r.holidayPay)} />
            )}
            {!r.hourly && input.department.overtime && (
              <SheetLine
                label="Сверхурочные"
                how={r.overtimeHours > 0 ? `${hours(r.overtimeHours)} ч × ${money2(perHour)} × ${String(input.department.overtimeRate).replace(".", ",")}` : "сверх нормы нет"}
                value={amount(r.overtimePay)}
              />
            )}
            <SheetLine label="Больничный" how={r.sickDays ? `${r.sickDays} дн. в табеле` : "вписывает бухгалтер"} control={field("sick")} value={amount(r.sick)} />
            <SheetLine label="Отпускные" how={r.vacationDays ? `${r.vacationDays} дн. в табеле` : "вписывает бухгалтер"} control={field("vacation")} value={amount(r.vacation)} />
            {!r.hourly && (
              <SheetLine
                label="KPI"
                how={r.total > 0 ? `${money(totalForMonth)} − ${money2(kpiBase)}${r.kpiDeduction ? ` − ${money2(r.kpiDeduction)}` : ""}` : "ИТОГО не задано"}
                controlLabel="удержать с KPI"
                control={field("kpiDeduction")}
                value={amount(r.kpi)}
              />
            )}
            <SheetTotal label="Начислено" value={money2(r.accrued)} />
          </div>

          <div className="px-4 py-3">
            <SheetTitle>Удержания</SheetTitle>
            <SheetLine label="Аванс" control={field("advance")} value={amount(r.advance)} />
            <SheetLine label="Займ" control={field("loan")} value={amount(r.loan)} />
            <SheetLine
              label="Цветы в счёт зп"
              how={r.flowersOverridden ? `вписано вручную${r.flowersFromStock ? ` · со склада ${money(r.flowersFromStock)}` : ""}` : r.flowersFromStock ? "по выдачам склада" : "выдач не было"}
              control={field("flowers", r.flowersOverridden ? undefined : r.flowersFromStock)}
              value={amount(r.flowers)}
            />
            <SheetTotal label="Удержано" value={money2(held)} />
            {r.travel > 0 && (
              <div className="mt-2 flex items-baseline justify-between gap-3 text-xs text-ink-secondary">
                <span>Дорожные отдельной ведомостью · {money(input.employee.travelRate)} × {r.workDays} дн.</span>
                <span className="tabular-nums">{money(r.travel)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-b-xl border-t border-line-hairline bg-surface-plane/50 px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-sm text-ink-secondary">К выплате</span>
            <span className={clsx("font-display text-2xl font-extrabold tracking-tight tabular-nums", r.toPay < 0 && "text-red-700")}>{money2(r.toPay)}</span>
          </div>
          <div className="text-xs text-ink-muted tabular-nums">{money2(r.accrued)} − {money2(held)}</div>
          <div className="ml-auto w-full sm:w-auto sm:min-w-[20rem]">
            {canEdit ? (
              <input
                className="h-8 w-full rounded-md border border-line-hairline bg-surface px-2 text-sm outline-none placeholder:text-ink-muted/60 focus:border-section-payroll"
                defaultValue={v.note}
                placeholder="Заметка бухгалтера"
                onBlur={(e) => {
                  if (e.target.value.trim() !== v.note) onChange("note", e.target.value);
                }}
              />
            ) : (
              r.note && <div className="text-xs text-ink-secondary">Заметка: {r.note}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SheetTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">{children}</div>;
}

/**
 * Строка листка: название и «откуда цифра» слева, поле бухгалтера (если есть) и сумма — в двух колонках фиксированной
 * ширины, поэтому все суммы стоят столбиком, а поля — столбиком (28.10.2026, владелец: «очень некрасивый вид и формат»).
 */
function SheetLine({ label, how, control, controlLabel, value }: { label: string; how?: string; control?: React.ReactNode; controlLabel?: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-hairline/60 py-1.5 last:border-0 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_6.5rem]">
      {/* На телефоне строка с полем ввода складывается в две: название сверху, поле и сумма — под ним справа. */}
      <div className={clsx("min-w-0 flex-1", control && "basis-full sm:basis-auto")}>
        <div className="text-sm">{label}</div>
        {how && <div className="truncate text-xs text-ink-muted">{how}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2 sm:ml-0">
        {control && controlLabel && <span className="hidden text-[11px] text-ink-muted lg:inline">{controlLabel}</span>}
        {control}
      </div>
      <div className="w-[6.5rem] text-right text-sm sm:w-auto">{value}</div>
    </div>
  );
}

function SheetTotal({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-1 flex items-baseline justify-between gap-3 pt-2 text-sm font-medium">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Tile({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={clsx("card !p-4", strong && "ring-1 ring-section-payroll/40")}>
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="font-display text-2xl font-extrabold tracking-tight mt-0.5 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-ink-secondary mt-0.5">{sub}</div>}
    </div>
  );
}
