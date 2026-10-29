"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { unwrap } from "@/lib/actionResult";
import { ghHref } from "@/lib/greenhouse/farm";
import { monthLabel, shiftMonth } from "@/lib/payroll/timesheet";
import { AREA_DEPT_LABELS, WORK_AREAS, WORK_TYPES, computeAreaPay, type WorkArea, type WorkBudget, type WorkEntry } from "@/lib/payroll/work";
import { THEAD_ROW, TH, TR } from "@/lib/tableStyle";

type SlimEntry = Pick<WorkEntry, "area" | "employeeId" | "name" | "workType" | "qty" | "hours">;
type SlimBudget = { area: WorkArea; workType: string; amount: number; note: string };

const money = (v: number) => (Number.isFinite(v) ? Math.round(v).toLocaleString("ru-RU") : "—");
const num = (v: number, d = 0) => (Number.isFinite(v) ? v.toLocaleString("ru-RU", { maximumFractionDigits: d }) : "—");

/**
 * Лист оплаты труда — один на все четыре участка, как в книге: над каждым отделом бюджеты по видам работ (поля
 * бухгалтера), ниже строки по людям: выработка, доля и заработано по каждому виду, ИТОГО. Бюджет меняется — лист
 * пересчитывается на месте тем же `computeAreaPay`, что и на сервере. «Печать» — весь лист, без меню и полей.
 */
export default function WorkPayBoard({
  farm,
  farmLabel,
  month,
  entries,
  names,
  budgets,
  prevBudgets,
  prevMonth,
  canEdit,
  save,
}: {
  farm: string;
  farmLabel: string;
  month: string;
  entries: SlimEntry[];
  names: Record<string, { fullName: string }>;
  budgets: SlimBudget[];
  prevBudgets: SlimBudget[];
  prevMonth: string;
  canEdit: boolean;
  save: (farm: string, month: string, area: string, input: { workType: string; amount: unknown; note: string }[]) => Promise<unknown>;
}) {
  const router = useRouter();
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const namesMap = useMemo(() => new Map(Object.entries(names)), [names]);
  const full = useMemo(() => entries.map((e) => ({ ...e, workId: "", farm, date: "", block: "", part: "", note: "", createdBy: "", createdAt: "", updatedBy: "", updatedAt: "" })) as WorkEntry[], [entries, farm]);

  const budgetValue = (area: WorkArea, code: string): string => {
    const k = `${area}|${code}`;
    if (k in edited) return edited[k];
    const b = budgets.find((x) => x.area === area && x.workType === code);
    return b && b.amount ? String(b.amount) : "";
  };
  const liveBudgets = useMemo(
    () =>
      WORK_AREAS.flatMap((area) =>
        WORK_TYPES[area].map((t) => {
          const k = `${area}|${t.code}`;
          const raw = k in edited ? edited[k] : budgets.find((x) => x.area === area && x.workType === t.code)?.amount ?? 0;
          const n = Number(String(raw).replace(/\s+/g, "").replace(",", "."));
          return { month, farm, area, workType: t.code, amount: Number.isFinite(n) ? n : 0, note: "", updatedBy: "", updatedAt: "" } as WorkBudget;
        }),
      ),
    [edited, budgets, month, farm],
  );
  const pays = useMemo(() => WORK_AREAS.map((area) => computeAreaPay(area, full, liveBudgets, namesMap)), [full, liveBudgets, namesMap]);
  const dirtyAreas = new Set(Object.keys(edited).map((k) => k.split("|")[0]));
  const grand = pays.reduce((s, p) => s + p.earnedTotal, 0);
  const grandBudget = pays.reduce((s, p) => s + p.budgetTotal, 0);

  const onSave = async (area: WorkArea) => {
    setBusy(area);
    setError("");
    setSaved("");
    try {
      const input = WORK_TYPES[area]
        .filter((t) => t.code !== "other")
        .map((t) => ({ workType: t.code, amount: budgetValue(area, t.code) || 0, note: "" }));
      unwrap(await save(farm, month, area, input));
      setEdited((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith(`${area}|`))));
      setSaved(`Бюджеты «${AREA_DEPT_LABELS[area]}» сохранены.`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось сохранить.");
    } finally {
      setBusy("");
    }
  };

  const copyPrev = (area: WorkArea) => {
    const patch: Record<string, string> = {};
    for (const t of WORK_TYPES[area]) {
      const b = prevBudgets.find((x) => x.area === area && x.workType === t.code);
      if (b && b.amount) patch[`${area}|${t.code}`] = String(b.amount);
    }
    if (!Object.keys(patch).length) return;
    setEdited((e) => ({ ...e, ...patch }));
    setSaved("");
  };

  return (
    <div className="space-y-4 payslip">
      <div className="card !p-3 sm:!p-4 flex flex-wrap items-center gap-3 no-print">
        <div className="flex items-center gap-2 text-sm">
          <Link className="btn-secondary !py-1.5 !px-3" href={ghHref("/greenhouse/analytics", farm, { view: "pay", month: shiftMonth(month, -1) })}>
            ‹
          </Link>
          <span className="font-medium min-w-[9rem] text-center">{monthLabel(month)}</span>
          <Link className="btn-secondary !py-1.5 !px-3" href={ghHref("/greenhouse/analytics", farm, { view: "pay", month: shiftMonth(month, 1) })}>
            ›
          </Link>
        </div>
        <div className="text-sm text-ink-secondary">
          Бюджет <b className="text-ink-primary tabular-nums">{money(grandBudget)} ₸</b> · распределено <b className="text-ink-primary tabular-nums">{money(grand)} ₸</b>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {saved && <span className="text-sm text-status-good">{saved}</span>}
          {error && <span className="text-sm text-[#a12b2b]">{error}</span>}
          <button type="button" className="btn-secondary !py-1.5" onClick={() => window.print()}>
            Печать
          </button>
        </div>
      </div>
      <div className="hidden print:block text-lg font-bold">
        Расчёт оплаты труда по выработке — {farmLabel}, {monthLabel(month)}
      </div>

      {pays.map((pay) => {
        const area = pay.area;
        const cols = pay.columns.filter((c) => c.used || c.budget > 0);
        const dirty = dirtyAreas.has(area);
        const hasPrev = prevBudgets.some((b) => b.area === area && b.amount);
        return (
          <div key={area} className="card !p-0">
            <div className="px-4 py-3 border-b border-line-hairline flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="font-display font-extrabold text-base">{AREA_DEPT_LABELS[area]}</div>
              <div className="text-xs text-ink-muted">
                {pay.rows.length} чел. · бюджет {money(pay.budgetTotal)} ₸ · распределено {money(pay.earnedTotal)} ₸
              </div>
              {pay.unspent.length > 0 && (
                <div className="text-xs text-[#8a5a00]">
                  Бюджет без выработки: {pay.unspent.map((u) => `${u.label} ${money(u.amount)} ₸`).join(", ")}
                </div>
              )}
              {canEdit && (
                <div className="ml-auto flex items-center gap-2 no-print">
                  {hasPrev && (
                    <button type="button" className="text-xs underline text-ink-secondary" onClick={() => copyPrev(area)}>
                      как в {monthLabel(prevMonth).toLowerCase()}
                    </button>
                  )}
                  <button type="button" className="btn-primary !py-1.5 text-sm" disabled={!dirty || busy === area} onClick={() => onSave(area)}>
                    {busy === area ? "Сохраняю…" : "Сохранить бюджеты"}
                  </button>
                </div>
              )}
            </div>
            {/* Бюджеты по видам работ */}
            <div className="px-4 py-3 border-b border-line-hairline/60 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {WORK_TYPES[area]
                .filter((t) => t.code !== "other")
                .map((t) => {
                  const col = pay.columns.find((c) => c.workType === t.code)!;
                  const v = budgetValue(area, t.code);
                  return (
                    <div key={t.code}>
                      <div className="label">
                        {t.label} <span className="text-ink-muted font-normal">· {t.basis === "qty" ? t.unit : "по часам"}</span>
                      </div>
                      {canEdit ? (
                        <input
                          type="text"
                          inputMode="numeric"
                          className={clsx("input !py-1.5 tabular-nums text-right no-print", `${area}|${t.code}` in edited && "bg-[#fff8e1]")}
                          placeholder="0"
                          value={v}
                          onChange={(e) => {
                            setEdited((x) => ({ ...x, [`${area}|${t.code}`]: e.target.value }));
                            setSaved("");
                          }}
                        />
                      ) : null}
                      <div className={clsx("text-sm tabular-nums", canEdit ? "hidden print:block" : "")}>{col.budget ? `${money(col.budget)} ₸` : "—"}</div>
                      <div className="text-xs text-ink-muted mt-0.5 tabular-nums">
                        выработка {num(col.total, t.basis === "qty" ? 0 : 1)} {t.basis === "qty" ? t.unit : "ч"}
                      </div>
                    </div>
                  );
                })}
            </div>
            {pay.rows.length === 0 ? (
              <div className="px-4 py-4 text-sm text-ink-secondary">За {monthLabel(month).toLowerCase()} по участку записей нет.</div>
            ) : (
              <table className="w-full text-sm table-cards">
                <thead>
                  <tr className={THEAD_ROW}>
                    <th className={TH}>#</th>
                    <th className={TH}>ФИО</th>
                    {cols.map((c) => (
                      <th key={c.workType} className={clsx(TH, "text-right")}>
                        {c.label}
                        <div className="text-[10px] font-normal text-ink-muted">{c.basis === "qty" ? c.unit : "ч"} · доля · ₸</div>
                      </th>
                    ))}
                    <th className={clsx(TH, "text-right")}>ИТОГО, ₸</th>
                  </tr>
                </thead>
                <tbody>
                  {pay.rows.map((r, i) => (
                    <tr key={r.key} className={TR}>
                      <td className="px-4 py-2 text-ink-muted tabular-nums">{i + 1}</td>
                      <td data-label="ФИО" className="px-4 py-2 font-medium">
                        {r.employeeId ? (
                          <Link href={`/payroll/employees/${r.employeeId}`} className="hover:underline">
                            {r.name}
                          </Link>
                        ) : (
                          <>
                            {r.name} <span className="text-xs text-[#8a5a00] no-print">без карточки</span>
                          </>
                        )}
                      </td>
                      {cols.map((c) => {
                        const cell = r.cells[c.workType];
                        return (
                          <td key={c.workType} data-label={c.label} className="px-4 py-2 text-right tabular-nums">
                            {cell ? (
                              <>
                                <div>{num(cell.done, c.basis === "qty" ? 0 : 1)}</div>
                                <div className="text-xs text-ink-muted">
                                  {num(cell.share * 100, 1)} % · <span className={clsx(cell.earned ? "text-ink-primary" : "")}>{money(cell.earned)}</span>
                                </div>
                              </>
                            ) : (
                              <span className="text-ink-muted">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td data-label="ИТОГО" className="px-4 py-2 text-right tabular-nums font-semibold">
                        {money(r.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line-hairline bg-surface-plane/60 font-medium">
                    <td className="px-4 py-2" />
                    <td className="px-4 py-2">ИТОГО</td>
                    {cols.map((c) => (
                      <td key={c.workType} className="px-4 py-2 text-right tabular-nums">
                        <div>{num(c.total, c.basis === "qty" ? 0 : 1)}</div>
                        <div className="text-xs text-ink-muted">{money(pay.rows.reduce((s, r) => s + (r.cells[c.workType]?.earned ?? 0), 0))}</div>
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right tabular-nums">{money(pay.earnedTotal)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        );
      })}
      <div className="text-xs text-ink-muted no-print">
        Как в книге: доля человека по виду работ = его выработка ÷ выработка всех за месяц; заработано = доля × бюджет. Бюджет без выработки остаётся
        нераспределённым и помечен. Имена без карточки привязываются в «Журнале».
      </div>
    </div>
  );
}
