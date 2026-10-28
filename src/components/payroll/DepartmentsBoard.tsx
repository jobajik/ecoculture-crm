"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { unwrapValue } from "@/lib/actionResult";
import { cleanDeptId } from "@/lib/payroll/access";
import { FARM_LABELS, FARM_ORDER } from "@/lib/constants";
import type { Department, DepartmentDraft } from "@/lib/payroll/types";

const EMPTY: DepartmentDraft = { deptId: "", farm: "", name: "", order: 0, workWeek: 5, overtime: false, overtimeRate: 1, note: "", active: true };

/**
 * Подразделения и их правила расчёта: норма (5/6-дневка) и сверхурочные с коэффициентом. В таблице эти правила были
 * спрятаны в формулах по названию вкладки — и однажды сторожам посчитались сверхурочные из-за чужого заголовка.
 */
export default function DepartmentsBoard({
  farm,
  departments,
  headcount,
  heads,
  canEdit,
  save,
}: {
  /** Компания страницы: новое подразделение заводится в неё (владелец: по компаниям раздельно). */
  farm: string;
  departments: Department[];
  headcount: Record<string, number>;
  /** Имена начальников по коду подразделения (из Users). */
  heads: Record<string, string[]>;
  canEdit: boolean;
  save: (draft: DepartmentDraft) => Promise<unknown>;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DepartmentDraft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  function edit(d: Department) {
    setDraft({ ...d });
    setEditing(d.deptId);
    setOpen(true);
    setError("");
    setDone("");
  }
  function startNew() {
    setDraft({ ...EMPTY, farm, order: departments.length + 1 });
    setEditing(null);
    setOpen(true);
    setError("");
    setDone("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const result = unwrapValue(await save(draft)) as { created: boolean; deptId: string };
      setDone(result.created ? `Подразделение заведено: ${draft.name}.` : `Сохранено: ${draft.name}.`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<DepartmentDraft>) => setDraft({ ...draft, ...patch });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-secondary">
          Норма часов берётся из баланса рабочего времени по пятидневке или шестидневке; сверхурочные считаются только там, где включены.
        </p>
        {canEdit && (
          <button type="button" className="btn-primary" onClick={startNew}>
            + Подразделение
          </button>
        )}
      </div>

      {done && <p className="text-sm bg-status-good/10 text-status-good rounded-lg px-3 py-2">{done}</p>}

      {open && (
        <form onSubmit={submit} className="card space-y-3">
          <div className="font-medium">{editing ? `Изменить: ${draft.name}` : "Новое подразделение"}</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Название *</label>
              <input
                className="input"
                value={draft.name}
                placeholder="Сортировка и упаковка"
                onChange={(e) => set({ name: e.target.value, deptId: editing ? draft.deptId : draft.deptId })}
              />
            </div>
            <div>
              <label className="label">Код латиницей *</label>
              <input
                className="input"
                value={draft.deptId}
                disabled={!!editing}
                placeholder="sorting"
                onChange={(e) => set({ deptId: cleanDeptId(e.target.value) })}
              />
              <p className="text-xs text-ink-muted mt-1">{editing ? "Код менять нельзя: он записан в карточках сотрудников." : "Короткий, без пробелов: teplitsa, security."}</p>
            </div>
            <div>
              <label className="label">Компания (ТОО) *</label>
              <select className="input" value={draft.farm} onChange={(e) => set({ farm: e.target.value })}>
                <option value="">— выберите —</option>
                {FARM_ORDER.map((f) => (
                  <option key={f} value={f}>
                    {FARM_LABELS[f]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-ink-muted mt-1">Зарплата считается по каждой компании отдельно.</p>
            </div>
            <div>
              <label className="label">Рабочая неделя</label>
              <select className="input" value={draft.workWeek} onChange={(e) => set({ workWeek: Number(e.target.value) })}>
                <option value={5}>Пятидневка</option>
                <option value={6}>Шестидневка</option>
              </select>
            </div>
            <div>
              <label className="label">Порядок в списках</label>
              <input className="input" inputMode="numeric" value={draft.order || ""} onChange={(e) => set({ order: Number(e.target.value) || 0 })} />
            </div>
            <div>
              <label className="label">Сверхурочные</label>
              <label className="flex items-center gap-2 text-sm min-h-[44px] sm:min-h-[38px]">
                <input type="checkbox" checked={draft.overtime} onChange={(e) => set({ overtime: e.target.checked })} /> считать часы сверх нормы
              </label>
            </div>
            <div>
              <label className="label">Коэффициент сверхурочных</label>
              <input
                className="input"
                inputMode="decimal"
                disabled={!draft.overtime}
                value={draft.overtime ? draft.overtimeRate : ""}
                onChange={(e) => set({ overtimeRate: Number(e.target.value.replace(",", ".")) || 0 })}
              />
              <p className="text-xs text-ink-muted mt-1">1 — по часовой ставке, 0,5 — половина (так у Сборки ГП в таблице).</p>
            </div>
            <div className="sm:col-span-2">
              <label className="label">Заметка</label>
              <input className="input" value={draft.note} onChange={(e) => set({ note: e.target.value })} />
            </div>
            {editing && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} /> действующее (снятое не предлагается в карточках)
              </label>
            )}
          </div>
          {error && <p className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Сохраняю…" : "Сохранить"}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={busy}>
              Отмена
            </button>
          </div>
        </form>
      )}

      <div className="card !p-0 table-scroll table-cards">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
              <th className="px-4 py-2.5 font-medium">Подразделение</th>
              <th className="px-3 py-2.5 font-medium">Компания</th>
              <th className="px-3 py-2.5 font-medium">Код</th>
              <th className="px-3 py-2.5 font-medium text-right">В штате</th>
              <th className="px-3 py-2.5 font-medium">Неделя</th>
              <th className="px-3 py-2.5 font-medium">Сверхурочные</th>
              <th className="px-3 py-2.5 font-medium">Начальник</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {departments.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-muted">
                  Подразделений пока нет.
                </td>
              </tr>
            )}
            {departments.map((d) => (
              <tr key={d.deptId} className={clsx("border-b border-line-hairline last:border-0", !d.active && "text-ink-muted")}>
                <td data-label="Подразделение" className="px-4 py-2.5 font-medium">
                  {d.name}
                  {!d.active && <span className="text-xs"> · снято</span>}
                </td>
                <td data-label="Компания" className="px-3 py-2.5 text-ink-secondary">
                  {FARM_LABELS[d.farm] ?? <span className="text-[#8a5a00]">не указана</span>}
                </td>
                <td data-label="Код" className="px-3 py-2.5 font-mono text-xs text-ink-secondary">{d.deptId}</td>
                <td data-label="В штате" className="px-3 py-2.5 text-right tabular-nums">{headcount[d.deptId] ?? 0}</td>
                <td data-label="Неделя" className="px-3 py-2.5">{d.workWeek === 6 ? "шестидневка" : "пятидневка"}</td>
                <td data-label="Сверхурочные" className="px-3 py-2.5">{d.overtime ? `да · ×${d.overtimeRate}` : "нет"}</td>
                <td data-label="Начальник" className="px-3 py-2.5 text-ink-secondary">
                  {heads[d.deptId]?.length ? heads[d.deptId].join(", ") : <span className="text-[#8a5a00]">не назначен</span>}
                </td>
                <td className="px-3 py-2.5 text-right">
                  {canEdit && (
                    <button type="button" className="text-section-payroll hover:underline" onClick={() => edit(d)}>
                      изменить
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
