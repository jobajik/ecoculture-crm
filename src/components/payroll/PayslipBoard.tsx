"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { unwrapValue } from "@/lib/actionResult";
import SaveBar from "@/components/SaveBar";
import { FARM_LABELS } from "@/lib/constants";
import { EMPLOYMENTS } from "@/lib/payroll/types";
import { advanceHalf, computePayslip, sumRows, type Adjustment, type PayslipInput, type PayslipRow, type PayslipTotals } from "@/lib/payroll/payslip";
import { TIMESHEET_STATUS_LABELS } from "@/lib/payroll/timesheet";
import type { PayslipMonth } from "@/lib/payroll/payslipData";

/**
 * Расчётная ведомость за месяц (28.10.2026, владелец о первой версии — таблице в двадцать колонок: «тихий ужас, такого
 * информативного шума не должно быть; должно быть удобно, понятно и с расчётом»).
 *
 * Устройство: подразделение — раскрывающаяся карточка с итогом; внутри строка на человека с четырьмя числами (часы,
 * начислено, удержано, к выплате); нажатие на строку раскрывает РАСЧЁТ — откуда каждая цифра: «168 ч × 852,27 ₸ =
 * 143 181,82». Ручные поля бухгалтера (больничный, отпускные, удержание с KPI, аванс, займ, цветы, перебивка оклада)
 * живут там же, рядом с цифрой, на которую влияют. Строка пересчитывается на месте тем же `computePayslip`, что и сервер.
 */

type Values = Omit<Adjustment, "month" | "employeeId">;
type NumField = Exclude<keyof Values, "note">;

const EMPTY: Values = { salaryOverride: null, sick: 0, vacation: 0, kpiDeduction: 0, advance: 0, loan: 0, flowers: null, note: "" };

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const money2 = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₸`;
const hours = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
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
  const [openDepts, setOpenDepts] = useState<Record<string, boolean>>(() => (data.depts.length === 1 ? { [data.depts[0].department.deptId]: true } : {}));
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");

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

  const allOpen = depts.every((d) => openDepts[d.department.deptId]);
  const toggleAll = () => setOpenDepts(Object.fromEntries(depts.map((d) => [d.department.deptId, !allOpen])));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="К выплате" value={money(totals.toPay)} strong sub={`${totals.people} чел.`} />
        <Tile label="Начислено" value={money(totals.accrued)} sub={`в т.ч. KPI ${money(totals.kpi)}`} />
        <Tile label="Удержано" value={money(totals.advance + totals.loan + totals.flowers)} sub="аванс, займ, цветы" />
        <Tile label="Дорожные" value={money(totals.travel)} sub="отдельной ведомостью" />
      </div>

      {(notApproved.length > 0 || warnings.length > 0 || data.unmatchedFlowers.length > 0) && (
        <div className="rounded-xl border border-[#e8d5a8] bg-[#fdf6e7] px-4 py-2.5 text-sm text-[#6b4a00] space-y-1">
          {notApproved.length > 0 && (
            <div>
              Табель ещё не принят: <b>{notApproved.map((d) => d.department.name).join(", ")}</b> — цифры по ним предварительные.
            </div>
          )}
          {warnings.length > 0 && (
            <div>
              Не посчитано до конца у <b>{warnings.length} чел.</b> — у них стоит ⚠, причина в строке.
            </div>
          )}
          {data.unmatchedFlowers.length > 0 && (
            <div>
              Цветы со склада без сотрудника: {data.unmatchedFlowers.map((f) => `${f.name} — ${money(f.amount)} (${f.why})`).join("; ")}.
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input className="input !w-64" placeholder="Поиск по ФИО, должности" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="button" className="btn !py-1.5 text-sm" onClick={toggleAll}>
          {allOpen ? "Свернуть все" : "Развернуть все"}
        </button>
        {canEdit && (
          <button type="button" className="btn !py-1.5 text-sm" onClick={advanceAll} disabled={saving} title="Половина ИТОГО целыми сотнями — тем, у кого аванс ещё не вписан">
            Аванс 50 % всем
          </button>
        )}
        <span className="ml-auto text-sm">
          {message && <span className="text-emerald-700">{message}</span>}
          {error && <span className="text-red-700">{error}</span>}
        </span>
      </div>

      {depts.map((d) => {
        const id = d.department.deptId;
        const rows = needle ? d.rows.filter((r) => `${r.row.fullName} ${r.row.position}`.toLowerCase().includes(needle)) : d.rows;
        if (needle && rows.length === 0) return null;
        const open = needle ? true : !!openDepts[id];
        const warnCount = d.rows.filter((r) => r.row.warnings.length).length;
        return (
          <section key={id} className="card !p-0 overflow-hidden">
            <button
              type="button"
              className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-surface-plane/60"
              onClick={() => setOpenDepts((o) => ({ ...o, [id]: !open }))}
              aria-expanded={open}
            >
              <span className={clsx("text-ink-muted transition-transform", open && "rotate-90")}>▸</span>
              <span className="font-display font-bold text-base">{d.department.name}</span>
              <span className="text-xs text-ink-muted">{FARM_LABELS[d.department.farm] ?? ""}</span>
              <span className={clsx("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[d.timesheetStatus])}>табель: {TIMESHEET_STATUS_LABELS[d.timesheetStatus]}</span>
              {warnCount > 0 && <span className="text-xs text-[#8a5a00]">⚠ {warnCount}</span>}
              <span className="ml-auto flex items-center gap-4 text-sm tabular-nums">
                <span className="text-ink-muted hidden sm:inline">{d.rows.length} чел.</span>
                <span className="text-ink-secondary hidden md:inline">начислено {money(d.totals.accrued)}</span>
                <span>
                  к выплате <b className="font-display text-base">{money(d.totals.toPay)}</b>
                </span>
              </span>
            </button>
            {open && (
              <div className="border-t border-line-hairline">
                <div className="hidden sm:grid grid-cols-[1fr_7rem_8rem_7rem_8rem_1.5rem] gap-2 px-4 py-1.5 text-[11px] text-ink-muted bg-surface-plane/50">
                  <span>Сотрудник</span>
                  <span className="text-right">Часы</span>
                  <span className="text-right">Начислено</span>
                  <span className="text-right">Удержано</span>
                  <span className="text-right">К выплате</span>
                  <span />
                </div>
                {rows.map(({ input, row }) => {
                  const rid = row.employeeId;
                  const rowOpen = !!openRows[rid];
                  return (
                    <div key={rid} className="border-t border-line-hairline first:border-0">
                      <button
                        type="button"
                        className={clsx("w-full grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_7rem_8rem_7rem_8rem_1.5rem] gap-x-2 gap-y-0.5 items-center px-4 py-2.5 text-left text-sm", rowOpen ? "bg-surface-plane/50" : "hover:bg-surface-plane/40")}
                        onClick={() => setOpenRows((o) => ({ ...o, [rid]: !rowOpen }))}
                        aria-expanded={rowOpen}
                      >
                        <span className="min-w-0 flex items-center gap-2">
                          {row.warnings.length > 0 && (
                            <span className="text-[#8a5a00]" title={row.warnings.join("; ")}>
                              ⚠
                            </span>
                          )}
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{row.fullName}</span>
                            <span className="block truncate text-xs text-ink-muted">
                              {row.position} · {row.employment === EMPLOYMENTS.GPH ? "ГПХ" : "ТД"}
                              {row.hourly && " · почасовой"}
                            </span>
                          </span>
                        </span>
                        <span className="text-right tabular-nums sm:order-none order-last col-span-2 sm:col-span-1 text-xs sm:text-sm text-ink-secondary">
                          <HoursCell r={row} />
                        </span>
                        <span className="hidden sm:block text-right tabular-nums">{money(row.accrued)}</span>
                        <span className="hidden sm:block text-right tabular-nums text-ink-secondary">{row.advance + row.loan + row.flowers ? `− ${money(row.advance + row.loan + row.flowers)}` : "—"}</span>
                        <span className={clsx("text-right tabular-nums font-semibold", row.toPay < 0 && "text-red-700")}>{money(row.toPay)}</span>
                        <span className={clsx("hidden sm:block text-ink-muted text-center transition-transform", rowOpen && "rotate-180")}>⌄</span>
                      </button>
                      {rowOpen && (
                        <CalcPanel
                          key={`${rid}-${resetKey}`}
                          input={input}
                          r={row}
                          v={values[rid] ?? EMPTY}
                          canEdit={canEdit}
                          onChange={(f, raw) => setField(rid, f, raw)}
                        />
                      )}
                    </div>
                  );
                })}
                <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_7rem_8rem_7rem_8rem_1.5rem] gap-2 px-4 py-2.5 text-sm border-t border-line-hairline bg-surface-plane/50 font-medium tabular-nums">
                  <span>Итого · {d.rows.length} чел.</span>
                  <span className="hidden sm:block text-right text-ink-secondary">{hours(d.totals.factHours)} ч</span>
                  <span className="hidden sm:block text-right">{money(d.totals.accrued)}</span>
                  <span className="hidden sm:block text-right text-ink-secondary">− {money(d.totals.advance + d.totals.loan + d.totals.flowers)}</span>
                  <span className="text-right">{money(d.totals.toPay)}</span>
                  <span />
                </div>
              </div>
            )}
          </section>
        );
      })}

      {depts.length > 1 && !needle && (
        <section className="card !p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line-hairline font-display font-bold">Итого · {data.farm ? FARM_LABELS[data.farm] ?? "компания" : "обе компании"}</div>
          <div className="table-scroll table-cards">
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-muted bg-surface-plane/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Подразделение</th>
                  <th className="px-3 py-2 text-right font-medium">Чел.</th>
                  <th className="px-3 py-2 text-right font-medium">Оклад и часы</th>
                  <th className="px-3 py-2 text-right font-medium">KPI</th>
                  <th className="px-3 py-2 text-right font-medium">Начислено</th>
                  <th className="px-3 py-2 text-right font-medium">Удержано</th>
                  <th className="px-3 py-2 text-right font-medium">К выплате</th>
                  <th className="px-3 py-2 text-right font-medium">Дорожные</th>
                </tr>
              </thead>
              <tbody>
                {depts.map((d) => (
                  <SummaryRow key={d.department.deptId} label={d.department.name} t={d.totals} />
                ))}
                <SummaryRow label="в том числе по ТД" t={td} muted />
                <SummaryRow label="в том числе по ГПХ" t={gph} muted />
              </tbody>
              <tfoot className="font-bold bg-surface-plane/50">
                <SummaryRow label="Всего" t={totals} />
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {canEdit && <SaveBar count={dirty.length} what="человек" saving={saving} onSave={onSave} onReset={onReset} />}
    </div>
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

function SummaryRow({ label, t, muted }: { label: string; t: PayslipTotals; muted?: boolean }) {
  return (
    <tr className={clsx("border-t border-line-hairline", muted && "text-ink-secondary")}>
      <td data-label="Подразделение" className="px-4 py-2 text-left">{label}</td>
      <td data-label="Чел." className="px-3 py-2 text-right tabular-nums">{t.people}</td>
      <td data-label="Оклад и часы" className="px-3 py-2 text-right tabular-nums">{money(t.salaryPay + t.holidayPay + t.overtimePay + t.sick + t.vacation)}</td>
      <td data-label="KPI" className="px-3 py-2 text-right tabular-nums">{money(t.kpi)}</td>
      <td data-label="Начислено" className="px-3 py-2 text-right tabular-nums">{money(t.accrued)}</td>
      <td data-label="Удержано" className="px-3 py-2 text-right tabular-nums">{money(t.advance + t.loan + t.flowers)}</td>
      <td data-label="К выплате" className="px-3 py-2 text-right tabular-nums font-semibold">{money(t.toPay)}</td>
      <td data-label="Дорожные" className="px-3 py-2 text-right tabular-nums text-ink-secondary">{money(t.travel)}</td>
    </tr>
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
