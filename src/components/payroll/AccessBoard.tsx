"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { unwrap } from "@/lib/actionResult";
import { ROLE_LABELS } from "@/lib/constants";
import { PAYROLL_ROLE_LABELS } from "@/lib/payroll/access";

export interface AccessRow {
  email: string;
  name: string;
  /** Роль CRM. */
  role: string;
  payrollRole: string;
  departments: string[];
}

/**
 * Кому что можно в «Зарплате»: строка на сотрудника CRM, роль модуля списком, у начальника — подразделения
 * галочками. Администратор CRM видит всё и так — его строка только показывает это.
 */
export default function AccessBoard({
  rows,
  departments,
  save,
}: {
  rows: AccessRow[];
  departments: { deptId: string; name: string }[];
  save: (draft: { email: string; payrollRole: string; departments: string[] }) => Promise<unknown>;
}) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, { payrollRole: string; departments: string[] }>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<Record<string, string>>({});
  const [done, setDone] = useState("");

  const current = (r: AccessRow) => edits[r.email] ?? { payrollRole: r.payrollRole, departments: r.departments };
  const dirty = (r: AccessRow) => {
    const c = current(r);
    return c.payrollRole !== r.payrollRole || c.departments.join(",") !== r.departments.join(",");
  };

  async function submit(r: AccessRow) {
    const c = current(r);
    setBusy(r.email);
    setError({ ...error, [r.email]: "" });
    setDone("");
    try {
      unwrap(await save({ email: r.email, payrollRole: c.payrollRole, departments: c.departments }));
      const next = { ...edits };
      delete next[r.email];
      setEdits(next);
      setDone(`Сохранено: ${r.name || r.email}.`);
      router.refresh();
    } catch (err) {
      setError({ ...error, [r.email]: err instanceof Error ? err.message : "Не удалось сохранить" });
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-secondary">
        Роль в модуле даётся людям, которые уже входят в CRM. Кому CRM не нужна (бригадир, кадровик), того заводят в «Настройках → Сотрудники» с ролью «Только
        зарплата», а здесь назначают, что ему можно. Право начинает действовать при следующем открытии страницы.
      </p>
      {done && <p className="text-sm bg-status-good/10 text-status-good rounded-lg px-3 py-2">{done}</p>}
      <div className="card !p-0 table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
              <th className="px-4 py-2.5 font-medium">Сотрудник</th>
              <th className="px-3 py-2.5 font-medium">Роль в CRM</th>
              <th className="px-3 py-2.5 font-medium">Роль в зарплате</th>
              <th className="px-3 py-2.5 font-medium">Подразделения</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = current(r);
              const isAdmin = r.role === "admin";
              return (
                <tr key={r.email} className="border-b border-line-hairline last:border-0 align-top">
                  <td data-label="Сотрудник" className="px-4 py-2.5">
                    <div className="font-medium">{r.name || r.email}</div>
                    <div className="text-xs text-ink-muted">{r.email}</div>
                  </td>
                  <td data-label="Роль в CRM" className="px-3 py-2.5 text-ink-secondary">{ROLE_LABELS[r.role] ?? r.role}</td>
                  <td data-label="Роль в зарплате" className="px-3 py-2.5">
                    {isAdmin ? (
                      <span className="text-ink-secondary">всё — администратор</span>
                    ) : (
                      <select
                        className="input !w-auto"
                        value={c.payrollRole}
                        onChange={(e) => setEdits({ ...edits, [r.email]: { ...c, payrollRole: e.target.value } })}
                      >
                        <option value="">— нет доступа —</option>
                        {Object.entries(PAYROLL_ROLE_LABELS).map(([code, label]) => (
                          <option key={code} value={code}>
                            {label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td data-label="Подразделения" className="px-3 py-2.5">
                    {!isAdmin && c.payrollRole === "head" ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        {departments.map((d) => {
                          const on = c.departments.includes(d.deptId);
                          return (
                            <label key={d.deptId} className={clsx("flex items-center gap-1.5 text-sm whitespace-nowrap", on ? "text-ink-primary" : "text-ink-secondary")}>
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={(e) =>
                                  setEdits({
                                    ...edits,
                                    [r.email]: {
                                      ...c,
                                      departments: e.target.checked ? [...c.departments, d.deptId] : c.departments.filter((x) => x !== d.deptId),
                                    },
                                  })
                                }
                              />
                              {d.name}
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-ink-muted">{isAdmin || c.payrollRole ? "все" : "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {!isAdmin && (
                      <button
                        type="button"
                        className={clsx("text-sm", dirty(r) ? "text-section-payroll font-medium hover:underline" : "text-ink-muted")}
                        disabled={!dirty(r) || busy === r.email}
                        onClick={() => submit(r)}
                      >
                        {busy === r.email ? "…" : dirty(r) ? "сохранить" : "сохранено"}
                      </button>
                    )}
                    {error[r.email] && <div className="text-xs text-status-critical max-w-[220px] whitespace-normal">{error[r.email]}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
