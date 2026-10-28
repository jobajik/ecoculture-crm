"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import clsx from "clsx";
import { EMPLOYMENT_LABELS, type Employee, type EmployeeDraft, type RateDraft } from "@/lib/payroll/types";
import { formatDay } from "@/lib/formatDate";
import { FARM_LABELS } from "@/lib/constants";
import EmployeeForm, { EMPTY_EMPLOYEE } from "./EmployeeForm";
import StaffingImportForm from "./StaffingImportForm";

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
  farm,
  rows,
  departments,
  today,
  canEdit,
  canRate,
  seesMoney,
  save,
  importStaffing,
}: {
  /** Компания страницы — штат только её (владелец: по компаниям раздельно); сюда приходят уже её строки. */
  farm: string;
  rows: EmployeeRow[];
  departments: { deptId: string; name: string; active: boolean; farm: string }[];
  today: string;
  actorEmail: string;
  canEdit: boolean;
  canRate: boolean;
  seesMoney: boolean;
  save: (draft: EmployeeDraft, firstRate: RateDraft | null) => Promise<unknown>;
  importStaffing: (matrix: string[][], from: string, farm: string, dry: boolean) => Promise<unknown>;
}) {
  const [importing, setImporting] = useState(false);
  const [dept, setDept] = useState<string>("");
  const [q, setQ] = useState("");
  const shownDepartments = departments;
  const [showFired, setShowFired] = useState(false);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState("");
  // Список по подразделениям — свёрнутыми группами (28.10.2026, владелец: «чтобы вкладку сотрудника можно было
  // разворачивать по подразделениям»). Выбранное подразделение или поиск — плоский список: человек уже сузил его сам.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const inFarm = rows;
  const working = inFarm.filter((r) => r.working);
  const td = working.filter((r) => r.employee.employment === "td").length;
  const fund = working.reduce((s, r) => s + (r.total ?? 0), 0);
  const noRate = working.filter((r) => !r.hasRate).length;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return inFarm
      .filter((r) => (showFired ? true : r.working))
      .filter((r) => (dept ? r.employee.deptId === dept : true))
      .filter((r) => (needle ? `${r.employee.fullName} ${r.employee.position}`.toLowerCase().includes(needle) : true))
      .sort((a, b) => a.departmentName.localeCompare(b.departmentName, "ru") || a.employee.fullName.localeCompare(b.employee.fullName, "ru"));
  }, [inFarm, dept, q, showFired]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.working) m.set(r.employee.deptId, (m.get(r.employee.deptId) ?? 0) + 1);
    return m;
  }, [rows]);

  const grouped = !dept && !q.trim();
  const groups = useMemo(() => {
    if (!grouped) return [];
    const byDept = new Map<string, EmployeeRow[]>();
    for (const r of list) byDept.set(r.employee.deptId, [...(byDept.get(r.employee.deptId) ?? []), r]);
    return shownDepartments
      .filter((d) => byDept.has(d.deptId))
      .map((d) => ({ d, rows: byDept.get(d.deptId)! }))
      .concat([...byDept.keys()].filter((id) => !shownDepartments.some((d) => d.deptId === id)).map((id) => ({ d: { deptId: id, name: byDept.get(id)![0].departmentName, active: true, farm: "" }, rows: byDept.get(id)! })));
  }, [grouped, list, shownDepartments]);
  const allGroupsOpen = groups.length > 0 && groups.every((g) => openGroups[g.d.deptId]);

  const pill = (active: boolean) =>
    clsx(
      "h-9 px-4 rounded-full text-sm whitespace-nowrap transition-colors",
      active ? "bg-ink-primary text-white" : "border border-line-hairline bg-surface text-ink-secondary hover:bg-surface-plane"
    );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="В штате" value={String(working.length)} sub={`ТД ${td} · ГПХ ${working.length - td}`} />
        <Tile label="Подразделений" value={String(shownDepartments.filter((d) => d.active).length)} />
        {seesMoney ? (
          <Tile label="Фонд ИТОГО в месяц" value={money(fund)} sub="по действующим ставкам" />
        ) : (
          <Tile label="Уволенных в списке" value={String(inFarm.length - working.length)} />
        )}
        <Tile label="Без ставки" value={String(noRate)} sub={noRate ? "поставит бухгалтер" : "все ставки на месте"} tone={noRate ? "warn" : "default"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2 overflow-x-auto scroll-x-hidden -mx-1 px-1 py-0.5">
          <button type="button" className={pill(dept === "")} onClick={() => setDept("")}>
            Все · {working.length}
          </button>
          {shownDepartments.map((d) => (
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
            <button type="button" className="btn-secondary" onClick={() => { setImporting((v) => !v); setDone(""); }}>
              Загрузить файлом
            </button>
          )}
          {canEdit && (
            <button type="button" className="btn-primary" onClick={() => { setOpen(true); setDone(""); }}>
              + Сотрудник
            </button>
          )}
        </div>
      </div>

      {done && <p className="text-sm bg-status-good/10 text-status-good rounded-lg px-3 py-2">{done}</p>}

      {importing && <StaffingImportForm today={today} defaultFarm={farm} importStaffing={importStaffing} onClose={() => setImporting(false)} />}

      {open && (
        <EmployeeForm
          initial={{ ...EMPTY_EMPLOYEE, deptId: dept, hiredAt: today }}
          departments={shownDepartments}
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

      {grouped && groups.length > 1 && (
        <div className="flex justify-end">
          <button type="button" className="text-sm text-section-payroll hover:underline" onClick={() => setOpenGroups(Object.fromEntries(groups.map((g) => [g.d.deptId, !allGroupsOpen])))}>
            {allGroupsOpen ? "Свернуть все" : "Развернуть все"}
          </button>
        </div>
      )}
      {grouped && groups.length > 1 ? (
        groups.map((g) => {
          const isOpen = !!openGroups[g.d.deptId];
          const fund = g.rows.filter((r) => r.working).reduce((s, r) => s + (r.total ?? 0), 0);
          const noRateHere = g.rows.filter((r) => r.working && !r.hasRate).length;
          return (
            <section key={g.d.deptId} className="card !p-0 overflow-hidden">
              <button
                type="button"
                className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-surface-plane/60"
                onClick={() => setOpenGroups((o) => ({ ...o, [g.d.deptId]: !isOpen }))}
                aria-expanded={isOpen}
              >
                <span className={clsx("text-ink-muted transition-transform", isOpen && "rotate-90")}>▸</span>
                <span className="font-display font-bold">{g.d.name}</span>
                {g.d.farm && <span className="text-xs text-ink-muted">{FARM_LABELS[g.d.farm] ?? g.d.farm}</span>}
                {noRateHere > 0 && <span className="text-xs text-[#8a5a00]">без ставки {noRateHere}</span>}
                <span className="ml-auto flex items-center gap-4 text-sm tabular-nums text-ink-secondary">
                  <span>{g.rows.filter((r) => r.working).length} чел.</span>
                  {seesMoney && fund > 0 && (
                    <span>
                      ИТОГО <b className="text-ink-primary">{money(fund)}</b>
                    </span>
                  )}
                </span>
              </button>
              {isOpen && <div className="border-t border-line-hairline table-scroll table-cards">{renderTable(g.rows, seesMoney, false)}</div>}
            </section>
          );
        })
      ) : (
        <div className="card !p-0 table-scroll table-cards">{renderTable(list, seesMoney, true, rows.length === 0)}</div>
      )}
    </div>
  );
}

function renderTable(list: EmployeeRow[], seesMoney: boolean, showDept: boolean, nobody = false) {
  return (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
              <th className="px-4 py-2.5 font-medium">ФИО</th>
              {showDept && <th className="px-3 py-2.5 font-medium">Подразделение</th>}
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
                  {nobody ? "Сотрудников пока нет — заведите первого или загрузите штатную расстановку." : "Никого не нашлось."}
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
                {showDept && <td data-label="Подразделение" className="px-3 py-2.5 text-ink-secondary">{r.departmentName}</td>}
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
