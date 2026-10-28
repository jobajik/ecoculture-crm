"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { unwrap } from "@/lib/actionResult";
import { formatDay, formatMoment } from "@/lib/formatDate";
import { EMPLOYMENT_LABELS, PAY_TYPE_LABELS, type Employee, type EmployeeDraft, type Rate, type RateDraft } from "@/lib/payroll/types";
import EmployeeForm from "./EmployeeForm";

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const rateStr = (n: number) => `${n.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₸/ч`;

/**
 * Карточка сотрудника: данные, история ставок с датой начала и форма новой ставки. Старые ставки не правятся —
 * по ним считались прошлые месяцы; ставка с той же датой начала переписывается (опечатка в сумме).
 */
export default function EmployeeCard({
  employee,
  departmentName,
  departments,
  rates,
  today,
  canEdit,
  canRate,
  seesMoney,
  saveEmployee,
  addRate,
  deleteRate,
}: {
  employee: Employee;
  departmentName: string;
  departments: { deptId: string; name: string; active: boolean }[];
  rates: Rate[];
  today: string;
  canEdit: boolean;
  canRate: boolean;
  seesMoney: boolean;
  saveEmployee: (draft: EmployeeDraft, firstRate: RateDraft | null) => Promise<unknown>;
  addRate: (draft: RateDraft) => Promise<unknown>;
  deleteRate: (rateId: string, employeeId: string) => Promise<unknown>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [done, setDone] = useState("");
  const hourly = employee.payType === "hourly";
  const sorted = [...rates].sort((a, b) => b.from.localeCompare(a.from));
  const current = sorted.find((r) => r.from <= today) ?? null;
  const working = !employee.firedAt || employee.firedAt >= today;

  const draft: EmployeeDraft = {
    employeeId: employee.employeeId,
    fullName: employee.fullName,
    deptId: employee.deptId,
    position: employee.position,
    employment: employee.employment,
    payType: employee.payType,
    hiredAt: employee.hiredAt,
    firedAt: employee.firedAt,
    travelAddress: employee.travelAddress,
    travelRate: employee.travelRate,
    iin: employee.iin,
    note: employee.note,
  };

  return (
    <div className="space-y-4">
      {done && <p className="text-sm bg-status-good/10 text-status-good rounded-lg px-3 py-2">{done}</p>}

      {editing ? (
        <EmployeeForm
          initial={draft}
          departments={departments}
          today={today}
          canRate={false}
          save={saveEmployee}
          onDone={() => {
            setEditing(false);
            setDone("Карточка сохранена.");
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <dl className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <Row k="Подразделение" v={departmentName} />
              <Row k="Должность" v={employee.position} />
              <Row k="Вид занятости" v={EMPLOYMENT_LABELS[employee.employment]} />
              <Row k="Тип расчёта" v={PAY_TYPE_LABELS[employee.payType]} />
              <Row k="Принят" v={formatDay(employee.hiredAt, "не записано")} />
              <Row k="Уволен" v={employee.firedAt ? formatDay(employee.firedAt) : "— работает"} />
              <Row k="ИИН" v={employee.iin || "не записан"} />
              <Row k="Дорожные" v={employee.travelRate ? `${employee.travelAddress} · ${money(employee.travelRate)} в день` : "нет"} />
              {employee.note && <Row k="Заметка" v={employee.note} />}
            </dl>
            {canEdit && (
              <button type="button" className="btn-secondary" onClick={() => { setEditing(true); setDone(""); }}>
                Изменить
              </button>
            )}
          </div>
          {!working && <p className="mt-3 text-sm text-ink-muted">Уволен {formatDay(employee.firedAt)}: в новые табели не попадает, в прошлых месяцах остаётся.</p>}
        </div>
      )}

      {seesMoney && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium">Ставка</h3>
            {current ? (
              <div className="text-sm text-ink-secondary">
                сейчас:{" "}
                {hourly ? (
                  <span className="font-medium text-ink-primary">
                    день {rateStr(current.dayRate)} · ночь {rateStr(current.nightRate)}
                  </span>
                ) : (
                  <span className="font-medium text-ink-primary">
                    оклад 1С {money(current.salary1c)} · KPI {money(current.kpi)} · ИТОГО {money(current.total)}
                  </span>
                )}
              </div>
            ) : (
              <div className="text-sm text-[#8a5a00]">ставка не задана — зарплата не посчитается</div>
            )}
          </div>

          {sorted.length > 0 && (
            <div className="table-scroll table-cards -mx-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                    <th className="px-5 py-2 font-medium">Действует с</th>
                    {hourly ? (
                      <>
                        <th className="px-3 py-2 font-medium text-right">День</th>
                        <th className="px-3 py-2 font-medium text-right">Ночь</th>
                      </>
                    ) : (
                      <>
                        <th className="px-3 py-2 font-medium text-right">Оклад (1С)</th>
                        <th className="px-3 py-2 font-medium text-right">KPI</th>
                        <th className="px-3 py-2 font-medium text-right">ИТОГО</th>
                      </>
                    )}
                    <th className="px-3 py-2 font-medium">Заметка</th>
                    <th className="px-3 py-2 font-medium">Кто и когда</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.rateId} className={clsx("border-b border-line-hairline last:border-0", r === current && "bg-section-payroll-soft/40")}>
                      <td data-label="Действует с" className="px-5 py-2 tabular-nums">
                        {formatDay(r.from)}
                        {r === current && <span className="text-xs text-section-payroll"> · текущая</span>}
                      </td>
                      {hourly ? (
                        <>
                          <td data-label="День" className="px-3 py-2 text-right tabular-nums">{rateStr(r.dayRate)}</td>
                          <td data-label="Ночь" className="px-3 py-2 text-right tabular-nums">{rateStr(r.nightRate)}</td>
                        </>
                      ) : (
                        <>
                          <td data-label="Оклад (1С)" className="px-3 py-2 text-right tabular-nums">{money(r.salary1c)}</td>
                          <td data-label="KPI" className="px-3 py-2 text-right tabular-nums">{money(r.kpi)}</td>
                          <td data-label="ИТОГО" className="px-3 py-2 text-right tabular-nums font-medium">{money(r.total)}</td>
                        </>
                      )}
                      <td data-label="Заметка" className="px-3 py-2 text-ink-secondary">{r.note || "—"}</td>
                      <td data-label="Кто и когда" className="px-3 py-2 text-ink-muted text-xs">
                        {r.setBy || "импорт"} · {formatMoment(r.setAt)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canRate && sorted.length > 1 && <DeleteRate rateId={r.rateId} employeeId={employee.employeeId} run={deleteRate} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canRate && <RateForm employeeId={employee.employeeId} hourly={hourly} today={today} current={current} run={addRate} onDone={() => { setDone("Ставка записана."); router.refresh(); }} />}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-ink-muted w-32 flex-none">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}

function RateForm({
  employeeId,
  hourly,
  today,
  current,
  run,
  onDone,
}: {
  employeeId: string;
  hourly: boolean;
  today: string;
  current: Rate | null;
  run: (draft: RateDraft) => Promise<unknown>;
  onDone: () => void;
}) {
  const firstOfMonth = `${today.slice(0, 7)}-01`;
  const [draft, setDraft] = useState<RateDraft>({
    employeeId,
    from: firstOfMonth,
    salary1c: current?.salary1c ?? 0,
    total: current?.total ?? 0,
    dayRate: current?.dayRate ?? 0,
    nightRate: current?.nightRate ?? 0,
    note: "",
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".").replace(/\s/g, "")) || 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      unwrap(await run(draft));
      setOpen(false);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
        {current ? "Новая ставка с даты" : "Поставить ставку"}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-line-hairline bg-surface-plane/60 p-4 space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="label">Действует с *</label>
          <input className="input" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          <p className="text-xs text-ink-muted mt-1">Обычно первое число месяца: расчёт месяца берёт ставку на его начало.</p>
        </div>
        {hourly ? (
          <>
            <div>
              <label className="label">День, ₸/час *</label>
              <input className="input" inputMode="decimal" value={draft.dayRate || ""} onChange={(e) => setDraft({ ...draft, dayRate: num(e.target.value) })} />
            </div>
            <div>
              <label className="label">Ночь, ₸/час *</label>
              <input className="input" inputMode="decimal" value={draft.nightRate || ""} onChange={(e) => setDraft({ ...draft, nightRate: num(e.target.value) })} />
            </div>
          </>
        ) : (
          <>
            <div>
              <label className="label">Оклад (1С), ₸ *</label>
              <input className="input" inputMode="numeric" value={draft.salary1c || ""} onChange={(e) => setDraft({ ...draft, salary1c: num(e.target.value) })} />
            </div>
            <div>
              <label className="label">ИТОГО за месяц, ₸</label>
              <input className="input" inputMode="numeric" value={draft.total || ""} onChange={(e) => setDraft({ ...draft, total: num(e.target.value) })} />
              <p className="text-xs text-ink-muted mt-1">KPI = {Math.max(0, Math.round((draft.total || 0) - (draft.salary1c || 0))).toLocaleString("ru-RU")} ₸</p>
            </div>
          </>
        )}
        <div className="sm:col-span-3">
          <label className="label">Заметка</label>
          <input className="input" value={draft.note} placeholder="например: повышение с октября" onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        </div>
      </div>
      {error && <p className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Сохраняю…" : "Записать ставку"}
        </button>
        <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function DeleteRate({ rateId, employeeId, run }: { rateId: string; employeeId: string; run: (rateId: string, employeeId: string) => Promise<unknown> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function go() {
    if (!window.confirm("Удалить эту ставку? Прошлые месяцы, посчитанные по ней, изменятся при пересчёте.")) return;
    setBusy(true);
    setError("");
    try {
      unwrap(await run(rateId, employeeId));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span>
      <button type="button" className="text-xs text-ink-muted hover:text-status-critical" disabled={busy} onClick={go}>
        удалить
      </button>
      {error && <span className="block text-xs text-status-critical">{error}</span>}
    </span>
  );
}
