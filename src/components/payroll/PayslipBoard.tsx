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
        <div className="flex items-center gap-2 ml-auto">
          <input className="input !w-56" placeholder="Поиск по ФИО" value={q} onChange={(e) => setQ(e.target.value)} />
          {canEdit && (
            <button type="button" className="btn !py-1.5 text-sm" onClick={advanceAll} disabled={saving} title="Половина ИТОГО целыми сотнями — тем, у кого аванс ещё не вписан">
              Аванс 50 %
            </button>
          )}
          <button type="button" className="btn !py-1.5 text-sm" onClick={() => window.print()}>
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
              <th className="px-4 py-2 text-left font-medium w-10">№</th>
              <th className="px-2 py-2 text-left font-medium">Сотрудник</th>
              <th className="px-2 py-2 text-left font-medium hidden md:table-cell">Должность</th>
              <th className="px-2 py-2 text-right font-medium">Часы</th>
              <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">Оклад (1С)</th>
              <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">Начислено</th>
              <th className="px-2 py-2 text-right font-medium hidden sm:table-cell">Удержано</th>
              <th className="px-4 py-2 text-right font-medium">К выплате</th>
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
            <tbody key={d.department.deptId} className="print:break-inside-avoid">
              <tr className="bg-surface-plane/40 border-t border-line-hairline">
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
                      <td className="px-4 py-2 text-ink-muted tabular-nums">{i + 1}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-medium truncate">{row.fullName}</span>
                          {row.warnings.length > 0 && (
                            <span className="no-print text-[#8a5a00] text-xs shrink-0" title={row.warnings.join("; ")}>
                              ⚠
                            </span>
                          )}
                        </div>
                        <div className="md:hidden text-xs text-ink-muted truncate">{row.position}</div>
                      </td>
                      <td className="px-2 py-2 text-ink-secondary hidden md:table-cell truncate max-w-[14rem]">
                        {row.position}
                        <span className="text-ink-muted"> · {row.employment === EMPLOYMENTS.GPH ? "ГПХ" : "ТД"}</span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-secondary whitespace-nowrap">
                        <HoursCell r={row} />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">{row.hourly ? <span className="text-ink-muted">почас.</span> : row.salary1c ? money(row.salary1c) : <span className="text-ink-muted">—</span>}</td>
                      <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">{money(row.accrued)}</td>
                      <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell text-ink-secondary">{held ? money(held) : "—"}</td>
                      <td className={clsx("px-4 py-2 text-right tabular-nums font-semibold whitespace-nowrap", row.toPay < 0 && "text-red-700")}>{money(row.toPay)}</td>
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
                  <td className="px-2 py-1.5 text-xs" colSpan={2}>
                    Итого · {d.department.name}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-xs">{hours(d.totals.factHours)} ч</td>
                  <td className="hidden sm:table-cell" />
                  <td className="px-2 py-1.5 text-right tabular-nums text-xs hidden sm:table-cell">{money(d.totals.accrued)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-xs hidden sm:table-cell">{money(d.totals.advance + d.totals.loan + d.totals.flowers)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums text-xs font-medium text-ink-primary">{money(d.totals.toPay)}</td>
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
      <td className="px-2 py-2" colSpan={2}>
        {label} <span className="font-normal text-ink-muted">· {t.people} чел.</span>
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{hours(t.factHours)} ч</td>
      <td className="hidden sm:table-cell" />
      <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">{money(t.accrued)}</td>
      <td className="px-2 py-2 text-right tabular-nums hidden sm:table-cell">{money(t.advance + t.loan + t.flowers)}</td>
      <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{money(t.toPay)}</td>
    </tr>
  );
}

function HoursCell({ r }: { r: PayslipRow }) {
  if (r.hourly) return <>{hours(r.factHours)} ч{r.nightHours > 0 && <span className="text-ink-muted"> · ночь {hours(r.nightHours)}</span>}</>;
  const tone = r.factHours === 0 ? "text-ink-muted" : r.factHours > r.personalNorm ? "text-[#1f5fa8]" : r.factHours < r.personalNorm ? "text-red-700" : "";
  return (
    <>
      <span className={tone}>{hours(r.factHours)}</span>
      <span className="text-ink-muted"> / {hours(r.personalNorm)} ч</span>
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
  const days = [
    ["отпуск", r.vacationDays],
    ["больничный", r.sickDays],
    ["командировка", r.tripDays],
    ["прогул", r.absentDays],
    ["без содержания", r.unpaidDays],
  ].filter(([, n]) => (n as number) > 0) as [string, number][];

  const field = (f: NumField, opts?: { placeholder?: number; wide?: boolean }) => {
    const raw = v[f];
    const text = raw === null || raw === undefined || raw === 0 ? "" : String(raw).replace(".", ",");
    if (!canEdit) {
      const shown = f === "salaryOverride" ? r.salaryPay : f === "flowers" ? r.flowers : (r as unknown as Record<string, number>)[f] ?? 0;
      return <span className="tabular-nums">{shown ? money2(shown) : "—"}</span>;
    }
    return (
      <input
        className={clsx("input !py-1 !px-2 !min-h-0 text-right text-sm", opts?.wide ? "w-[8rem]" : "w-[6.5rem]", text && "bg-amber-50")}
        inputMode="decimal"
        defaultValue={text}
        placeholder={opts?.placeholder ? Math.round(opts.placeholder).toLocaleString("ru-RU") : "0"}
        onBlur={(e) => {
          if (e.target.value !== text) onChange(f, e.target.value);
        }}
      />
    );
  };

  return (
    <div className="px-4 pb-4 pt-2 bg-surface-plane/30 text-sm">
      {r.warnings.length > 0 && <div className="mb-3 rounded-lg bg-[#fdf6e7] px-3 py-2 text-[#6b4a00]">⚠ {r.warnings.join("; ")}</div>}
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-muted mb-1.5">Начисления</div>
          <div className="text-xs text-ink-secondary mb-2 tabular-nums">
            {r.hourly ? (
              <>
                тариф день {money(input.rate?.dayRate ?? 0)} · ночь {money(input.rate?.nightRate ?? 0)}
              </>
            ) : (
              <>
                оклад (1С) {money(r.salary1c)} · ИТОГО {money(r.total)}
                {partial && ` → за ${hours(r.personalNorm)} из ${hours(r.normHours)} ч: ${money(totalForMonth)}`} · час{" "}
                {money2(perHour)}
              </>
            )}
          </div>
          <Line
            label="Оклада"
            how={
              r.salaryOverridden
                ? "вписано вручную"
                : r.hourly
                  ? `${hours(r.factHours - r.nightHours)} ч день + ${hours(r.nightHours)} ч ночь`
                  : `${hours(paidHours)} ч × ${money2(perHour)}`
            }
            value={money2(r.salaryPay)}
            control={field("salaryOverride", { placeholder: r.salaryOverridden ? undefined : r.salaryPay })}
            hint={canEdit ? "пусто — считаем сами" : undefined}
          />
          {!r.hourly && (
            <Line label="Праздничные" how={r.holidayHours > 0 ? `${hours(r.holidayHours)} ч × ${money2(perHour)} × 1,5` : "в праздники не работал"} value={money2(r.holidayPay)} />
          )}
          {!r.hourly && input.department.overtime && (
            <Line
              label="Сверхурочные"
              how={r.overtimeHours > 0 ? `${hours(r.overtimeHours)} ч × ${money2(perHour)} × ${String(input.department.overtimeRate).replace(".", ",")}` : "сверх нормы нет"}
              value={money2(r.overtimePay)}
            />
          )}
          <Line label="Больничный" how={r.sickDays ? `${r.sickDays} дн. в табеле` : ""} value="" control={field("sick")} />
          <Line label="Отпускные" how={r.vacationDays ? `${r.vacationDays} дн. в табеле` : ""} value="" control={field("vacation")} />
          {!r.hourly && (
            <Line
              label="KPI"
              how={r.total > 0 ? `${money(totalForMonth)} − ${money2(kpiBase)}${r.kpiDeduction ? ` − удерж. ${money2(r.kpiDeduction)}` : ""}` : "ИТОГО не задано"}
              value={money2(r.kpi)}
              control={field("kpiDeduction")}
              hint={canEdit ? "удержание с KPI" : undefined}
            />
          )}
          <Line label="Начислено" value={money2(r.accrued)} strong />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-muted mb-1.5">Удержания</div>
          <Line label="Аванс" value="" control={field("advance")} />
          <Line label="Займ" value="" control={field("loan")} />
          <Line
            label="Цветы в счёт зп"
            how={r.flowersOverridden ? `вписано вручную${r.flowersFromStock ? ` · со склада ${money(r.flowersFromStock)}` : ""}` : r.flowersFromStock ? "по выдачам склада" : "выдач не было"}
            value={r.flowers ? money2(r.flowers) : ""}
            control={field("flowers", { placeholder: r.flowersOverridden ? undefined : r.flowersFromStock })}
            hint={canEdit ? "пусто — по складу" : undefined}
          />
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-line-hairline pt-2">
            <span className="font-medium">К выплате</span>
            <span className={clsx("font-display font-extrabold text-xl tabular-nums", r.toPay < 0 && "text-red-700")}>{money2(r.toPay)}</span>
          </div>
          {r.travel > 0 && (
            <div className="mt-1 flex items-baseline justify-between gap-3 text-xs text-ink-secondary">
              <span>Дорожные — отдельно, {money(input.employee.travelRate)} × {r.workDays} дн.</span>
              <span className="tabular-nums">{money(r.travel)}</span>
            </div>
          )}
          <div className="mt-3 text-xs text-ink-secondary">
            Табель: {hours(r.factHours)} ч за {r.workDays} дн.
            {days.length > 0 && ` · ${days.map(([l, n]) => `${l} ${n}`).join(", ")}`}
          </div>
          <div className="mt-2">
            {canEdit ? (
              <input
                className="input !py-1 !px-2 !min-h-0 text-sm w-full"
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

function Line({ label, how, value, control, strong, hint }: { label: string; how?: string; value: string; control?: React.ReactNode; strong?: boolean; hint?: string }) {
  return (
    <div className={clsx("flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1", strong && "border-t border-line-hairline mt-1 pt-2 font-medium")}>
      <div className="min-w-0 flex-1 basis-[9rem]">
        <div className={clsx(!strong && "text-ink-primary")}>{label}</div>
        {(how || hint) && (
          <div className="text-xs text-ink-muted truncate">
            {how}
            {how && hint ? " · " : ""}
            {hint}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-auto">
        {control ?? <span className="tabular-nums">{value || "—"}</span>}
        {control && value && <span className="tabular-nums text-ink-secondary min-w-[6rem] text-right">{value}</span>}
      </div>
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
