"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { unwrapValue } from "@/lib/actionResult";
import SaveBar from "@/components/SaveBar";
import { FARM_LABELS } from "@/lib/constants";
import { EMPLOYMENTS } from "@/lib/payroll/types";
import { advanceHalf, computePayslip, sumRows, type Adjustment, type PayslipRow, type PayslipTotals } from "@/lib/payroll/payslip";
import { TIMESHEET_STATUS_LABELS } from "@/lib/payroll/timesheet";
import type { PayslipMonth } from "@/lib/payroll/payslipData";

/**
 * Расчётная ведомость за месяц — как лист «Расчётная ведомость» в книге бухгалтера: подразделение за подразделением,
 * строка на человека, итог по подразделению, по компании и отдельно ТД/ГПХ. Табель и ставки — из базы, ручные поля
 * (больничный, отпускные, удержание KPI, аванс, займ, цветы, перебивка «Оклада») правит бухгалтер прямо в строке, и
 * строка пересчитывается на месте тем же `computePayslip`, что и сервер.
 */

type Values = Omit<Adjustment, "month" | "employeeId">;
type Field = Exclude<keyof Values, "note">;

const FIELD_LABELS: Record<Field, string> = {
  salaryOverride: "Оклада",
  sick: "Больничный",
  vacation: "Отпускные",
  kpiDeduction: "Удерж. KPI",
  advance: "Аванс",
  loan: "Займ",
  flowers: "Цветы",
};

const money = (n: number) => (n ? Math.round(n).toLocaleString("ru-RU") : "—");
const moneyExact = (n: number) => (n ? (Math.round(n * 100) / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) : "—");
const hours = (n: number) => (n ? String(Math.round(n * 100) / 100).replace(".", ",") : "—");

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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const depts = useMemo(
    () =>
      data.depts.map((d) => {
        const rows = d.inputs
          .map((i) => computePayslip({ ...i, adjustment: values[i.employee.employeeId] ?? i.adjustment }))
          .sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
        return { ...d, rows, totals: sumRows(rows) };
      }),
    [data, values],
  );
  const all = depts.flatMap((d) => d.rows);
  const totals = sumRows(all);
  const td = sumRows(all.filter((r) => r.employment === EMPLOYMENTS.TD));
  const gph = sumRows(all.filter((r) => r.employment === EMPLOYMENTS.GPH));
  const dirty = Object.keys(values).filter((id) => JSON.stringify(values[id]) !== JSON.stringify(base[id]));
  const warnings = all.filter((r) => r.warnings.length);
  const notApproved = depts.filter((d) => d.timesheetStatus !== "approved" && d.inputs.length);

  const setField = (id: string, field: keyof Values, raw: string) => {
    setValues((v) => {
      const cur = v[id] ?? { ...EMPTY };
      let next: number | null | string;
      if (field === "note") next = raw;
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
  };

  const onSave = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const r = unwrapValue(await save(data.month, dirty.map((id) => ({ employeeId: id, values: values[id] }))));
      const res = r as { changed: number; added: number };
      setMessage(`Сохранено: ${res.changed + res.added}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не сохранилось");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Человек" value={String(totals.people)} />
        <Tile label="Начислено" value={money(totals.accrued)} />
        <Tile label="KPI" value={money(totals.kpi)} />
        <Tile label="Удержано" value={money(totals.advance + totals.loan + totals.flowers)} hint="аванс, займ, цветы" />
        <Tile label="К выплате" value={money(totals.toPay)} strong />
        <Tile label="Дорожные" value={money(totals.travel)} hint="отдельной ведомостью" />
      </div>

      {(notApproved.length > 0 || warnings.length > 0 || data.unmatchedFlowers.length > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 space-y-1">
          {notApproved.length > 0 && (
            <div>
              Табель ещё не принят: {notApproved.map((d) => `${d.department.name} (${TIMESHEET_STATUS_LABELS[d.timesheetStatus]})`).join(", ")}. Цифры по ним
              предварительные.
            </div>
          )}
          {warnings.length > 0 && <div>Не посчитано до конца у {warnings.length} чел. — отмечены ⚠ в строке.</div>}
          {data.unmatchedFlowers.length > 0 && (
            <div>
              Цветы со склада без сотрудника: {data.unmatchedFlowers.map((f) => `${f.name} — ${money(f.amount)} (${f.why})`).join("; ")}.
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className="btn !py-1.5" onClick={advanceAll} disabled={saving}>
            Аванс 50 % всем, у кого пусто
          </button>
          <span className="text-ink-tertiary">Поля в строках правятся сразу; пустое «Оклада» и «Цветы» — считаем сами.</span>
          {message && <span className="text-emerald-700">{message}</span>}
          {error && <span className="text-red-700">{error}</span>}
        </div>
      )}

      {depts.map((d) => (
        <section key={d.department.deptId} className="card !p-0 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-line-hairline">
            <h2 className="font-display font-bold text-base">{d.department.name}</h2>
            <span className="text-xs text-ink-tertiary">{FARM_LABELS[d.department.farm] ?? ""}</span>
            <span className={clsx("rounded-full px-2.5 py-0.5 text-xs font-medium", d.timesheetStatus === "approved" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800")}>
              табель: {TIMESHEET_STATUS_LABELS[d.timesheetStatus]}
            </span>
            <span className="ml-auto text-sm tabular-nums text-ink-secondary">
              {d.rows.length} чел. · к выплате <b className="text-ink-primary">{money(d.totals.toPay)}</b>
            </span>
          </div>
          {d.rows.length === 0 ? (
            <div className="px-4 py-3 text-sm text-ink-tertiary">Нет сотрудников за месяц.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead className="bg-surface-sunk text-xs text-ink-secondary">
                  <tr>
                    <Th left sticky>ФИО</Th>
                    <Th>ТД/ГПХ</Th>
                    <Th>Оклад 1С</Th>
                    <Th>ИТОГО</Th>
                    <Th>Факт / норма, ч</Th>
                    <Th>О·Б·К·П·БС</Th>
                    <Th>Оклада</Th>
                    <Th>Больн.</Th>
                    <Th>Отпуск.</Th>
                    <Th>Праздн.</Th>
                    {d.department.overtime && <Th>Сверхур.</Th>}
                    <Th>KPI</Th>
                    <Th>Удерж. KPI</Th>
                    <Th>Начислено</Th>
                    <Th>Аванс</Th>
                    <Th>Займ</Th>
                    <Th>Цветы</Th>
                    <Th>Дорожные</Th>
                    <Th left>Заметка</Th>
                    <Th strong stickyRight>К выплате</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <Row key={r.employeeId} r={r} v={values[r.employeeId] ?? EMPTY} canEdit={canEdit} overtime={d.department.overtime} onChange={setField} />
                  ))}
                </tbody>
                <tfoot className="bg-surface-sunk font-medium">
                  <TotalsRow label={`Итого · ${d.department.name}`} t={d.totals} overtime={d.department.overtime} />
                </tfoot>
              </table>
            </div>
          )}
        </section>
      ))}

      {depts.length > 1 && (
        <section className="card !p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-line-hairline font-display font-bold">Итого по {data.farm ? FARM_LABELS[data.farm] ?? "компании" : "всем"}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead className="bg-surface-sunk text-xs text-ink-secondary">
                <tr>
                  <Th left>Кто</Th>
                  <Th>Чел.</Th>
                  <Th>Оклада</Th>
                  <Th>Больн.</Th>
                  <Th>Отпуск.</Th>
                  <Th>Праздн.</Th>
                  <Th>Сверхур.</Th>
                  <Th>KPI</Th>
                  <Th>Начислено</Th>
                  <Th>Аванс</Th>
                  <Th>Займ</Th>
                  <Th>Цветы</Th>
                  <Th strong>К выплате</Th>
                  <Th>Дорожные</Th>
                </tr>
              </thead>
              <tbody>
                {depts.map((d) => (
                  <SummaryRow key={d.department.deptId} label={d.department.name} t={d.totals} />
                ))}
                <SummaryRow label="В том числе по ТД" t={td} muted />
                <SummaryRow label="В том числе по ГПХ" t={gph} muted />
              </tbody>
              <tfoot className="bg-surface-sunk font-bold">
                <SummaryRow label="Всего" t={totals} />
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {canEdit && <SaveBar count={dirty.length} what="строк" saving={saving} onSave={onSave} onReset={() => setValues(base)} />}
    </div>
  );
}

const EMPTY: Values = { salaryOverride: null, sick: 0, vacation: 0, kpiDeduction: 0, advance: 0, loan: 0, flowers: null, note: "" };

function num(raw: string): number {
  const n = Number(raw.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function Tile({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={clsx("card !p-3", strong && "ring-1 ring-[#8c4a1f]/40")}>
      <div className="text-xs text-ink-secondary">{label}</div>
      <div className="font-display font-extrabold text-xl tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-ink-tertiary">{hint}</div>}
    </div>
  );
}

function Th({ children, left, strong, sticky, stickyRight }: { children: React.ReactNode; left?: boolean; strong?: boolean; sticky?: boolean; stickyRight?: boolean }) {
  return (
    <th
      className={clsx(
        "px-2 py-2 font-medium",
        left ? "text-left" : "text-right",
        strong && "text-ink-primary",
        sticky && "sticky left-0 bg-surface-sunk z-10",
        stickyRight && "sticky right-0 bg-surface-sunk z-10 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]",
      )}
    >
      {children}
    </th>
  );
}

function Td({ children, left, strong, muted, className }: { children: React.ReactNode; left?: boolean; strong?: boolean; muted?: boolean; className?: string }) {
  return (
    <td className={clsx("px-2 py-1.5 tabular-nums", left ? "text-left" : "text-right", strong && "font-semibold", muted && "text-ink-tertiary", className)}>
      {children}
    </td>
  );
}

function Row({
  r,
  v,
  canEdit,
  overtime,
  onChange,
}: {
  r: PayslipRow;
  v: Values;
  canEdit: boolean;
  overtime: boolean;
  onChange: (id: string, field: keyof Values, raw: string) => void;
}) {
  const edit = (field: Field, placeholder?: number, w = "w-[6.5rem]") => {
    const raw = v[field];
    const text = raw === null || raw === undefined || raw === 0 ? "" : String(raw).replace(".", ",");
    if (!canEdit) return moneyExact(field === "salaryOverride" ? r.salaryPay : field === "flowers" ? r.flowers : (r as unknown as Record<string, number>)[field] ?? 0);
    return (
      <input
        className={clsx("input !py-1 !px-2 !min-h-0 text-right text-sm", w, text && "bg-amber-50")}
        inputMode="decimal"
        defaultValue={text}
        placeholder={placeholder ? moneyExact(placeholder) : ""}
        title={FIELD_LABELS[field]}
        onBlur={(e) => {
          if (e.target.value !== text) onChange(r.employeeId, field, e.target.value);
        }}
      />
    );
  };
  const days = [r.vacationDays, r.sickDays, r.tripDays, r.absentDays, r.unpaidDays];
  return (
    <tr className="border-t border-line-hairline hover:bg-surface-sunk/60">
      <Td left className="sticky left-0 bg-surface z-10 max-w-[14rem]">
        <div className="flex items-center gap-1.5">
          {r.warnings.length > 0 && (
            <span className="text-amber-600" title={r.warnings.join("; ")}>
              ⚠
            </span>
          )}
          <div className="min-w-0">
            <div className="truncate font-medium" title={r.fullName}>
              {r.fullName}
            </div>
            <div className="truncate text-[11px] text-ink-tertiary" title={r.position}>
              {r.position}
            </div>
          </div>
        </div>
      </Td>
      <Td muted>{r.employment === EMPLOYMENTS.GPH ? "ГПХ" : "ТД"}</Td>
      <Td>{r.hourly ? <span className="text-ink-tertiary">почас.</span> : money(r.salary1c)}</Td>
      <Td>{money(r.total)}</Td>
      <Td>
        <span className={clsx(r.factHours > r.personalNorm && "text-sky-700", r.factHours < r.personalNorm && r.factHours > 0 && "text-red-700")}>{hours(r.factHours)}</span>
        <span className="text-ink-tertiary"> / {hours(r.personalNorm)}</span>
        {r.holidayHours > 0 && <span className="text-amber-700" title="часы в праздники">{` · пр. ${hours(r.holidayHours)}`}</span>}
      </Td>
      <Td muted>{days.some(Boolean) ? days.map((n) => n || "·").join(" ") : "—"}</Td>
      <Td className={clsx(r.salaryOverridden && "text-amber-800")}>{edit("salaryOverride", r.salaryOverridden ? undefined : r.salaryPay)}</Td>
      <Td>{edit("sick")}</Td>
      <Td>{edit("vacation")}</Td>
      <Td>{moneyExact(r.holidayPay)}</Td>
      {overtime && (
        <Td>
          {moneyExact(r.overtimePay)}
          {r.overtimeHours > 0 && <span className="text-ink-tertiary text-xs">{` · ${hours(r.overtimeHours)} ч`}</span>}
        </Td>
      )}
      <Td>{moneyExact(r.kpi)}</Td>
      <Td>{edit("kpiDeduction", undefined, "w-[5.5rem]")}</Td>
      <Td>{moneyExact(r.accrued)}</Td>
      <Td>{edit("advance")}</Td>
      <Td>{edit("loan", undefined, "w-[5.5rem]")}</Td>
      <Td className={clsx(r.flowersOverridden && "text-amber-800")}>
        {edit("flowers", r.flowersOverridden ? undefined : r.flowersFromStock, "w-[5.5rem]")}
      </Td>
      <Td muted>{money(r.travel)}</Td>
      <Td left>
        {canEdit ? (
          <input
            className="input !py-1 !px-2 !min-h-0 text-sm w-[12rem]"
            defaultValue={v.note}
            placeholder="заметка"
            onBlur={(e) => {
              if (e.target.value !== v.note) onChange(r.employeeId, "note", e.target.value);
            }}
          />
        ) : (
          <span className="text-ink-tertiary">{r.note}</span>
        )}
      </Td>
      <Td strong className={clsx("sticky right-0 bg-surface z-10 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]", r.toPay < 0 && "text-red-700")}>
        {moneyExact(r.toPay)}
      </Td>
    </tr>
  );
}

function TotalsRow({ label, t, overtime }: { label: string; t: PayslipTotals; overtime: boolean }) {
  return (
    <tr className="border-t border-line-hairline">
      <Td left className="sticky left-0 bg-surface-sunk z-10">
        {label}
      </Td>
      <Td muted>{t.people}</Td>
      <Td>{""}</Td>
      <Td>{""}</Td>
      <Td muted>{hours(t.factHours)}</Td>
      <Td>{""}</Td>
      <Td>{money(t.salaryPay)}</Td>
      <Td>{money(t.sick)}</Td>
      <Td>{money(t.vacation)}</Td>
      <Td>{money(t.holidayPay)}</Td>
      {overtime && <Td>{money(t.overtimePay)}</Td>}
      <Td>{money(t.kpi)}</Td>
      <Td>{""}</Td>
      <Td>{money(t.accrued)}</Td>
      <Td>{money(t.advance)}</Td>
      <Td>{money(t.loan)}</Td>
      <Td>{money(t.flowers)}</Td>
      <Td muted>{money(t.travel)}</Td>
      <Td>{""}</Td>
      <Td strong className="sticky right-0 bg-surface-sunk z-10 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]">
        {money(t.toPay)}
      </Td>
    </tr>
  );
}

function SummaryRow({ label, t, muted }: { label: string; t: PayslipTotals; muted?: boolean }) {
  return (
    <tr className={clsx("border-t border-line-hairline", muted && "text-ink-secondary")}>
      <Td left>{label}</Td>
      <Td>{t.people}</Td>
      <Td>{money(t.salaryPay)}</Td>
      <Td>{money(t.sick)}</Td>
      <Td>{money(t.vacation)}</Td>
      <Td>{money(t.holidayPay)}</Td>
      <Td>{money(t.overtimePay)}</Td>
      <Td>{money(t.kpi)}</Td>
      <Td>{money(t.accrued)}</Td>
      <Td>{money(t.advance)}</Td>
      <Td>{money(t.loan)}</Td>
      <Td>{money(t.flowers)}</Td>
      <Td strong>{money(t.toPay)}</Td>
      <Td>{money(t.travel)}</Td>
    </tr>
  );
}
