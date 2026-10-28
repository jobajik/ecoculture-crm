"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { EMPLOYMENT_LABELS, type Employee, type EmployeeDraft, type RateDraft } from "@/lib/payroll/types";
import { formatDay } from "@/lib/formatDate";
import EmployeeForm, { EMPTY_EMPLOYEE } from "./EmployeeForm";

export interface EmployeeRow {
  employee: Employee;
  departmentName: string;
  working: boolean;
  /** null — суммы этому человеку не показываются или ставки ещё нет. */
  salary1c: number | null;
  total: number | null;
  hasRate: boolean;
}

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;

/**
 * Штат одним экраном: плитки-итоги, отбор по подразделению и поиск, строки — ссылками на карточку.
 * Уволенные спрятаны по умолчанию: их больше, чем кажется, а нужны они раз в год.
 */
export default function EmployeesBoard({
  rows,
  departments,
  today,
  canEdit,
  canRate,
  seesMoney,
  save,
}: {
  rows: EmployeeRow[];
  departments: { deptId: string; name: string; active: boolean }[];
  today: string;
  actorEmail: string;
  canEdit: boolean;
  canRate: boolean;
  seesMoney: boolean;
  save: (draft: EmployeeDraft, firstRate: RateDraft | null) => Promise<unknown>;
}) {
  const [dept, setDept] = useState<string>("");
  const [q, setQ] = useState("");
  const [showFired, setShowFired] = useState(false);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState("");

  const working = rows.filter((r) => r.working);
  const td = working.filter((r) => r.employee.employment === "td").length;
  const fund = working.reduce((s, r) => s + (r.total ?? 0), 0);
  const noRate = working.filter((r) => !r.hasRate).length;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => (showFired ? true : r.working))
      .filter((r) => (dept ? r.employee.deptId === dept : true))
      .filter((r) => (needle ? `${r.employee.fullName} ${r.employee.position}`.toLowerCase().includes(needle) : true))
      .sort((a, b) => a.departmentName.localeCompare(b.departmentName, "ru") || a.employee.fullName.localeCompare(b.employee.fullName, "ru"));
  }, [rows, dept, q, showFired]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.working) m.set(r.employee.deptId, (m.get(r.employee.deptId) ?? 0) + 1);
    return m;
  }, [rows]);

  const pill = (active: boolean) =>
    clsx(
      "h-9 px-4 rounded-full text-sm whitespace-nowrap transition-colors",
      active ? "bg-ink-primary text-white" : "border border-line-hairline bg-surface text-ink-secondary hover:bg-surface-plane"
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="В штате" value={String(working.length)} sub={`ТД ${td} · ГПХ ${working.length - td}`} />
        <Tile label="Подразделений" value={String(departments.filter((d) => d.active).length)} />
        {seesMoney ? (
          <Tile label="Фонд ИТОГО в месяц" value={money(fund)} sub="по действующим ставкам" />
        ) : (
          <Tile label="Уволенных в списке" value={String(rows.length - working.length)} />
        )}
        <Tile label="Без ставки" value={String(noRate)} sub={noRate ? "поставит бухгалтер" : "все ставки на месте"} tone={noRate ? "warn" : "default"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2 overflow-x-auto scroll-x-hidden -mx-1 px-1 py-0.5">
          <button type="button" className={pill(dept === "")} onClick={() => setDept("")}>
            Все · {working.length}
          </button>
          {departments.map((d) => (
            <button key={d.deptId} type="button" className={pill(dept === d.deptId)} onClick={() => setDept(dept === d.deptId ? "" : d.deptId)}>
              {d.name} · {counts.get(d.deptId) ?? 0}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <input className="input !w-56" placeholder="Поиск по ФИО, должности" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-2 text-sm text-ink-secondary whitespace-nowrap">
            <input type="checkbox" checked={showFired} onChange={(e) => setShowFired(e.target.checked)} /> уволенные
          </label>
          {canEdit && (
            <button type="button" className="btn-primary" onClick={() => { setOpen(true); setDone(""); }}>
              + Сотрудник
            </button>
          )}
        </div>
      </div>

      {done && <p className="text-sm bg-status-good/10 text-status-good rounded-lg px-3 py-2">{done}</p>}

      {open && (
        <EmployeeForm
          initial={{ ...EMPTY_EMPLOYEE, deptId: dept, hiredAt: today }}
          departments={departments}
          today={today}
          canRate={canRate}
          save={save}
          onDone={(result, draft) => {
            setOpen(false);
            setDone(result.created ? `Заведён: ${draft.fullName}.` : `Сохранено: ${draft.fullName}.`);
          }}
          onCancel={() => setOpen(false)}
        />
      )}

      <div className="card !p-0 table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
              <th className="px-4 py-2.5 font-medium">ФИО</th>
              <th className="px-3 py-2.5 font-medium">Подразделение</th>
              <th className="px-3 py-2.5 font-medium">Должность</th>
              <th className="px-3 py-2.5 font-medium">Занятость</th>
              {seesMoney && <th className="px-3 py-2.5 font-medium text-right">Оклад (1С)</th>}
              {seesMoney && <th className="px-3 py-2.5 font-medium text-right">ИТОГО</th>}
              <th className="px-3 py-2.5 font-medium">Принят</th>
              <th className="px-3 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-muted">
                  {rows.length === 0 ? "Сотрудников пока нет — заведите первого или загрузите штатную расстановку." : "Никого не нашлось."}
                </td>
              </tr>
            )}
            {list.map((r) => (
              <tr key={r.employee.employeeId} className={clsx("border-b border-line-hairline last:border-0 hover:bg-surface-plane", !r.working && "text-ink-muted")}>
                <td data-label="ФИО" className="px-4 py-2.5 font-medium">
                  <Link href={`/payroll/employees/${r.employee.employeeId}`} className="hover:underline">
                    {r.employee.fullName}
                  </Link>
                  {!r.working && <span className="text-xs text-ink-muted"> · уволен {formatDay(r.employee.firedAt)}</span>}
                </td>
                <td data-label="Подразделение" className="px-3 py-2.5 text-ink-secondary">{r.departmentName}</td>
                <td data-label="Должность" className="px-3 py-2.5">{r.employee.position}</td>
                <td data-label="Занятость" className="px-3 py-2.5">
                  <span className={clsx("badge", r.employee.employment === "td" ? "bg-section-payroll-soft text-section-payroll" : "bg-surface-plane text-ink-secondary")}>
                    {EMPLOYMENT_LABELS[r.employee.employment]}
                  </span>
                  {r.employee.payType === "hourly" && <span className="text-xs text-ink-muted"> · почасовой</span>}
                </td>
                {seesMoney && (
                  <td data-label="Оклад (1С)" className="px-3 py-2.5 text-right tabular-nums">
                    {r.salary1c !== null ? money(r.salary1c) : <span className="text-[#8a5a00]">нет ставки</span>}
                  </td>
                )}
                {seesMoney && (
                  <td data-label="ИТОГО" className="px-3 py-2.5 text-right tabular-nums font-medium">
                    {r.total !== null && r.total > 0 ? money(r.total) : "—"}
                  </td>
                )}
                <td data-label="Принят" className="px-3 py-2.5 text-ink-secondary tabular-nums">{formatDay(r.employee.hiredAt)}</td>
                <td className="px-3 py-2.5 text-right">
                  <Link href={`/payroll/employees/${r.employee.employeeId}`} className="text-section-payroll hover:underline">
                    открыть
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "warn" }) {
  return (
    <div className="card !p-4">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={clsx("font-display text-2xl font-extrabold tracking-tight mt-0.5", tone === "warn" && "text-[#8a5a00]")}>{value}</div>
      {sub && <div className="text-xs text-ink-secondary mt-0.5">{sub}</div>}
    </div>
  );
}
