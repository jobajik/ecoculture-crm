"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { unwrap } from "@/lib/actionResult";
import { formatDay } from "@/lib/formatDate";
import { suggestBalance } from "@/lib/payroll/rules";
import type { BalanceDraft, BalanceMonth, Holiday } from "@/lib/payroll/types";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

/**
 * Баланс рабочего времени на год: норма дней и часов по 5- и 6-дневке, как во вкладке «Баланс» таблицы, плюс
 * праздники. «По календарю» подставляет подсказку (рабочие дни минус праздники); в Казахстане бывают переносы, поэтому
 * цифру подтверждает бухгалтер, а не программа.
 */
export default function BalanceBoard({
  year,
  years,
  balance,
  holidays,
  canEdit,
  saveMonth,
  addHoliday,
  removeHoliday,
}: {
  year: number;
  years: number[];
  balance: BalanceMonth[];
  holidays: Holiday[];
  canEdit: boolean;
  saveMonth: (draft: BalanceDraft) => Promise<unknown>;
  addHoliday: (date: string, name: string) => Promise<unknown>;
  removeHoliday: (date: string) => Promise<unknown>;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, BalanceDraft>>(() => {
    const out: Record<string, BalanceDraft> = {};
    for (let m = 1; m <= 12; m++) {
      const month = `${year}-${String(m).padStart(2, "0")}`;
      const b = balance.find((x) => x.month === month);
      out[month] = { month, days5: b?.days5 ?? 0, hours5: b?.hours5 ?? 0, days6: b?.days6 ?? 0, hours6: b?.hours6 ?? 0 };
    }
    return out;
  });
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<Record<string, string>>({});
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [holidayError, setHolidayError] = useState("");

  const yearHolidays = holidays.filter((h) => h.date.startsWith(`${year}-`));
  const saved = (month: string) => balance.find((b) => b.month === month);
  const dirty = (month: string) => {
    const b = saved(month);
    const r = rows[month];
    return !b || b.days5 !== r.days5 || b.hours5 !== r.hours5 || b.days6 !== r.days6 || b.hours6 !== r.hours6;
  };

  function set(month: string, patch: Partial<BalanceDraft>) {
    setRows({ ...rows, [month]: { ...rows[month], ...patch } });
  }

  async function save(month: string) {
    setBusy(month);
    setError({ ...error, [month]: "" });
    try {
      unwrap(await saveMonth(rows[month]));
      router.refresh();
    } catch (err) {
      setError({ ...error, [month]: err instanceof Error ? err.message : "Не удалось сохранить" });
    } finally {
      setBusy("");
    }
  }

  function suggest(month: string) {
    const s = suggestBalance(month, yearHolidays.map((h) => h.date));
    if (s) set(month, s);
  }

  async function addDay() {
    setHolidayError("");
    setBusy("holiday");
    try {
      unwrap(await addHoliday(newDate, newName));
      setNewDate("");
      setNewName("");
      router.refresh();
    } catch (err) {
      setHolidayError(err instanceof Error ? err.message : "Не удалось добавить");
    } finally {
      setBusy("");
    }
  }

  async function dropDay(date: string) {
    setBusy(date);
    try {
      unwrap(await removeHoliday(date));
      router.refresh();
    } catch (err) {
      setHolidayError(err instanceof Error ? err.message : "Не удалось удалить");
    } finally {
      setBusy("");
    }
  }

  const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")) || 0);
  const cell = "input !w-20 text-right tabular-nums";

  return (
    <div className="grid lg:grid-cols-[1fr_320px] gap-5 items-start">
      <div className="space-y-3">
        <div className="flex gap-2">
          {years.map((y) => (
            <Link
              key={y}
              href={`/payroll/balance?year=${y}`}
              className={clsx(
                "h-9 px-4 rounded-full text-sm inline-flex items-center",
                y === year ? "bg-ink-primary text-white" : "border border-line-hairline bg-surface text-ink-secondary hover:bg-surface-plane"
              )}
            >
              {y}
            </Link>
          ))}
        </div>
        <div className="card !p-0 table-scroll">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                <th className="px-4 py-2.5 font-medium">Месяц</th>
                <th className="px-3 py-2.5 font-medium text-right" colSpan={2}>
                  Пятидневка: дни · часы
                </th>
                <th className="px-3 py-2.5 font-medium text-right" colSpan={2}>
                  Шестидневка: дни · часы
                </th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {MONTHS.map((name, i) => {
                const month = `${year}-${String(i + 1).padStart(2, "0")}`;
                const r = rows[month];
                const isDirty = dirty(month);
                const has = !!saved(month);
                return (
                  <tr key={month} className={clsx("border-b border-line-hairline last:border-0", !has && !isDirty && "text-ink-muted")}>
                    <td className="px-4 py-2 font-medium whitespace-nowrap">
                      {name}
                      {!has && <span className="text-xs text-[#8a5a00] font-normal"> · нет нормы</span>}
                    </td>
                    {canEdit ? (
                      <>
                        <td className="px-1 py-1.5 text-right">
                          <input className={cell} inputMode="numeric" value={r.days5 || ""} onChange={(e) => set(month, { days5: num(e.target.value) })} />
                        </td>
                        <td className="px-1 py-1.5 text-right">
                          <input className={cell} inputMode="decimal" value={r.hours5 || ""} onChange={(e) => set(month, { hours5: num(e.target.value) })} />
                        </td>
                        <td className="px-1 py-1.5 text-right">
                          <input className={cell} inputMode="numeric" value={r.days6 || ""} onChange={(e) => set(month, { days6: num(e.target.value) })} />
                        </td>
                        <td className="px-1 py-1.5 text-right">
                          <input className={cell} inputMode="decimal" value={r.hours6 || ""} onChange={(e) => set(month, { hours6: num(e.target.value) })} />
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          <button type="button" className="text-xs text-ink-muted hover:text-ink-primary mr-3" onClick={() => suggest(month)}>
                            по календарю
                          </button>
                          <button
                            type="button"
                            className={clsx("text-xs", isDirty ? "text-section-payroll font-medium hover:underline" : "text-ink-muted")}
                            disabled={!isDirty || busy === month}
                            onClick={() => save(month)}
                          >
                            {busy === month ? "…" : isDirty ? "сохранить" : "сохранено"}
                          </button>
                          {error[month] && <div className="text-xs text-status-critical">{error[month]}</div>}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 py-2 text-right tabular-nums">{r.days5 || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.hours5 || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.days6 || "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.hours6 || "—"}</td>
                        <td />
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card space-y-3">
        <h3 className="font-medium">Праздники {year}</h3>
        <p className="text-xs text-ink-muted">Часы, отработанные в эти дни, оплачиваются в полуторном размере; из нормы они вычтены.</p>
        <ul className="divide-y divide-line-hairline text-sm">
          {yearHolidays.length === 0 && <li className="py-2 text-ink-muted">Пока ни одного.</li>}
          {yearHolidays.map((h) => (
            <li key={h.date} className="py-2 flex items-center gap-2">
              <span className="tabular-nums w-24">{formatDay(h.date)}</span>
              <span className="flex-1 text-ink-secondary">{h.name || "праздник"}</span>
              {canEdit && (
                <button type="button" className="text-xs text-ink-muted hover:text-status-critical" disabled={busy === h.date} onClick={() => dropDay(h.date)}>
                  убрать
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="space-y-2 pt-2 border-t border-line-hairline">
            <input className="input" type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
            <input className="input" placeholder="Название (Наурыз, День Конституции…)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            {holidayError && <p className="text-xs text-status-critical">{holidayError}</p>}
            <button type="button" className="btn-secondary w-full" disabled={!newDate || busy === "holiday"} onClick={addDay}>
              + Добавить праздник
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
