"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { unwrapValue } from "@/lib/actionResult";
import { EMPLOYMENT_LABELS, PAY_TYPE_LABELS, type EmployeeDraft, type RateDraft } from "@/lib/payroll/types";

/**
 * Карточка сотрудника — завести или поправить. Проверяет сервер (`employeeRefusal`); форма только собирает
 * данные и показывает его ответ. При заведении бухгалтер или админ может сразу поставить первую ставку — кадровику
 * эти поля не показываются, ставку поставит Алия.
 */
export const EMPTY_EMPLOYEE: EmployeeDraft = {
  employeeId: "",
  fullName: "",
  deptId: "",
  position: "",
  employment: "td",
  payType: "month",
  hiredAt: "",
  firedAt: "",
  travelAddress: "",
  travelRate: 0,
  iin: "",
  note: "",
};

const EMPTY_RATE: RateDraft = { employeeId: "", from: "", salary1c: 0, total: 0, dayRate: 0, nightRate: 0, note: "" };

export default function EmployeeForm({
  initial,
  departments,
  today,
  canRate,
  save,
  onDone,
  onCancel,
}: {
  initial: EmployeeDraft;
  departments: { deptId: string; name: string; active: boolean }[];
  today: string;
  canRate: boolean;
  save: (draft: EmployeeDraft, firstRate: RateDraft | null) => Promise<unknown>;
  onDone: (result: { employeeId: string; created: boolean }, draft: EmployeeDraft) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<EmployeeDraft>(initial);
  const [rate, setRate] = useState<RateDraft>({ ...EMPTY_RATE, from: initial.hiredAt || today });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isNew = !initial.employeeId;
  const hourly = draft.payType === "hourly";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const wantsRate = isNew && canRate && (rate.salary1c > 0 || rate.total > 0 || rate.dayRate > 0);
      const result = unwrapValue(await save(draft, wantsRate ? { ...rate, from: rate.from || draft.hiredAt || today } : null)) as {
        employeeId: string;
        created: boolean;
      };
      onDone(result, draft);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<EmployeeDraft>) => setDraft({ ...draft, ...patch });
  const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".").replace(/\s/g, "")) || 0);

  return (
    <form onSubmit={submit} className="card space-y-4">
      <div className="font-medium">{isNew ? "Новый сотрудник" : `Карточка: ${initial.fullName}`}</div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="label">ФИО *</label>
          <input className="input" value={draft.fullName} placeholder="Фамилия Имя Отчество" onChange={(e) => set({ fullName: e.target.value })} />
        </div>
        <div>
          <label className="label">Подразделение *</label>
          <select className="input" value={draft.deptId} onChange={(e) => set({ deptId: e.target.value })}>
            <option value="">— выберите —</option>
            {departments
              .filter((d) => d.active || d.deptId === draft.deptId)
              .map((d) => (
                <option key={d.deptId} value={d.deptId}>
                  {d.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="label">Должность *</label>
          <input className="input" value={draft.position} placeholder="Цветовод" onChange={(e) => set({ position: e.target.value })} />
        </div>
        <div>
          <label className="label">Вид занятости *</label>
          <select className="input" value={draft.employment} onChange={(e) => set({ employment: e.target.value })}>
            {Object.entries(EMPLOYMENT_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Тип расчёта *</label>
          <select className="input" value={draft.payType} onChange={(e) => set({ payType: e.target.value })}>
            {Object.entries(PAY_TYPE_LABELS).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink-muted mt-1">Почасовой — операторы PRIVA: тариф в час за день и ночь, норма равна факту.</p>
        </div>
        <div>
          <label className="label">Дата приёма</label>
          <input className="input" type="date" value={draft.hiredAt} onChange={(e) => set({ hiredAt: e.target.value })} />
        </div>
        <div>
          <label className="label">Дата увольнения</label>
          <input className="input" type="date" value={draft.firedAt} onChange={(e) => set({ firedAt: e.target.value })} />
          <p className="text-xs text-ink-muted mt-1">Пусто — работает. С этой даты человек выпадает из табеля, но остаётся в прошлых месяцах.</p>
        </div>
        <div>
          <label className="label">ИИН</label>
          <input className="input" inputMode="numeric" maxLength={12} value={draft.iin} onChange={(e) => set({ iin: e.target.value.replace(/\D/g, "").slice(0, 12) })} />
          <p className="text-xs text-ink-muted mt-1">12 цифр; по нему будет связь с 1С.</p>
        </div>
        <div>
          <label className="label">Дорожные: адрес</label>
          <input className="input" value={draft.travelAddress} placeholder="Шабыт" onChange={(e) => set({ travelAddress: e.target.value })} />
        </div>
        <div>
          <label className="label">Дорожные: ставка в день, ₸</label>
          <input className="input" inputMode="numeric" value={draft.travelRate || ""} onChange={(e) => set({ travelRate: num(e.target.value) })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Заметка</label>
          <input className="input" value={draft.note} placeholder="например: KPI подписывает Данияр" onChange={(e) => set({ note: e.target.value })} />
        </div>
      </div>

      {isNew && canRate && (
        <div className="rounded-xl border border-line-hairline bg-surface-plane/60 p-4 space-y-3">
          <div className="text-sm font-medium">Ставка с первого дня {hourly ? "(тариф в час)" : ""}</div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Действует с</label>
              <input className="input" type="date" value={rate.from} onChange={(e) => setRate({ ...rate, from: e.target.value })} />
            </div>
            {hourly ? (
              <>
                <div>
                  <label className="label">День, ₸/час</label>
                  <input className="input" inputMode="decimal" value={rate.dayRate || ""} onChange={(e) => setRate({ ...rate, dayRate: num(e.target.value) })} />
                </div>
                <div>
                  <label className="label">Ночь, ₸/час</label>
                  <input className="input" inputMode="decimal" value={rate.nightRate || ""} onChange={(e) => setRate({ ...rate, nightRate: num(e.target.value) })} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="label">Оклад (1С), ₸</label>
                  <input className="input" inputMode="numeric" value={rate.salary1c || ""} onChange={(e) => setRate({ ...rate, salary1c: num(e.target.value) })} />
                </div>
                <div>
                  <label className="label">ИТОГО за месяц, ₸</label>
                  <input className="input" inputMode="numeric" value={rate.total || ""} onChange={(e) => setRate({ ...rate, total: num(e.target.value) })} />
                  <p className="text-xs text-ink-muted mt-1">
                    KPI = ИТОГО − оклад: {Math.max(0, Math.round((rate.total || 0) - (rate.salary1c || 0))).toLocaleString("ru-RU")} ₸
                  </p>
                </div>
              </>
            )}
          </div>
          <p className="text-xs text-ink-muted">Можно оставить пустым и поставить ставку позже в карточке.</p>
        </div>
      )}

      {error && <p className="text-sm text-status-critical bg-status-critical/10 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Сохраняю…" : isNew ? "Завести" : "Сохранить"}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
      </div>
    </form>
  );
}
