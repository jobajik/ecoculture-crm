"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { unwrap, unwrapValue } from "@/lib/actionResult";
import { formatDay } from "@/lib/formatDate";
import { lawHolidays, nonWorkingDays, yearNorm, KURBAN_AIT } from "@/lib/payroll/calendarKz";
import { extraDays } from "@/lib/payroll/rules";
import { HOLIDAY_KIND_LABELS, type BalanceDraft, type BalanceMonth, type Holiday } from "@/lib/payroll/types";

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];

type Diff = { date: string; ours: boolean; theirs: boolean };

/**
 * Баланс рабочего времени считает программа по календарю РК (`calendarKz.ts`): праздники по закону, Курбан-айт,
 * переносы «праздник на выходном → следующий рабочий день», 8 часов в день пятидневки и 7+5 у шестидневки.
 * Бухгалтер может перебить месяц руками (строка в PayrollBalance) — такая строка помечена и снимается одной кнопкой;
 * дополнить календарь внеплановым переносом правительства — строкой справа; и сверить с внешним календарём.
 */
export default function BalanceBoard({
  year,
  years,
  balance,
  holidays,
  canEdit,
  saveMonth,
  removeMonth,
  addHoliday,
  removeHoliday,
  checkCalendar,
}: {
  year: number;
  years: number[];
  balance: BalanceMonth[];
  holidays: Holiday[];
  canEdit: boolean;
  saveMonth: (draft: BalanceDraft) => Promise<unknown>;
  removeMonth: (month: string) => Promise<unknown>;
  addHoliday: (date: string, name: string, kind: string) => Promise<unknown>;
  removeHoliday: (date: string) => Promise<unknown>;
  checkCalendar: (year: number) => Promise<unknown>;
}) {
  const router = useRouter();
  const extra = useMemo(() => extraDays(holidays), [holidays]);
  const computed = useMemo(() => yearNorm(year, extra), [year, extra]);
  const law = useMemo(() => lawHolidays(year, extra), [year, extra]);
  const off5 = useMemo(() => nonWorkingDays(year, 5, extra), [year, extra]);
  const off6 = useMemo(() => nonWorkingDays(year, 6, extra), [year, extra]);
  const yearExtras = holidays.filter((h) => h.date.startsWith(`${year}-`));

  const [editing, setEditing] = useState<string>("");
  const [draft, setDraft] = useState<BalanceDraft | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [newDate, setNewDate] = useState("");
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<string>("off");
  const [holidayError, setHolidayError] = useState("");
  const [diff, setDiff] = useState<Diff[] | null>(null);
  const [checkNote, setCheckNote] = useState("");

  const override = (month: string) => balance.find((b) => b.month === month);

  function startEdit(month: string) {
    const o = override(month);
    const c = computed.find((m) => m.month === month)!;
    setDraft({ month, days5: o?.days5 ?? c.days5, hours5: o?.hours5 ?? c.hours5, days6: o?.days6 ?? c.days6, hours6: o?.hours6 ?? c.hours6 });
    setEditing(month);
    setError("");
  }

  async function save() {
    if (!draft) return;
    setBusy(draft.month);
    setError("");
    try {
      unwrap(await saveMonth(draft));
      setEditing("");
      setDraft(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить");
    } finally {
      setBusy("");
    }
  }

  async function drop(month: string) {
    setBusy(month);
    setError("");
    try {
      unwrap(await removeMonth(month));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось снять");
    } finally {
      setBusy("");
    }
  }

  async function addDay() {
    setHolidayError("");
    setBusy("holiday");
    try {
      unwrap(await addHoliday(newDate, newName, newKind));
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

  async function runCheck() {
    setBusy("check");
    setCheckNote("");
    setDiff(null);
    try {
      const r = unwrapValue(await checkCalendar(year)) as { ok: boolean; message?: string; diff?: Diff[] };
      if (!r.ok) setCheckNote(r.message ?? "Сверка не удалась.");
      else setDiff(r.diff ?? []);
    } catch (err) {
      setCheckNote(err instanceof Error ? err.message : "Сверка не удалась.");
    } finally {
      setBusy("");
    }
  }

  const num = (v: string) => (v === "" ? 0 : Number(v.replace(",", ".")) || 0);
  const cell = "input !w-20 text-right tabular-nums";
  const total = computed.reduce(
    (a, m) => ({ days5: a.days5 + m.days5, hours5: a.hours5 + m.hours5, days6: a.days6 + m.days6, hours6: a.hours6 + m.hours6 }),
    { days5: 0, hours5: 0, days6: 0, hours6: 0 }
  );
  const kurban = KURBAN_AIT[year];
  const transfers5 = off5.filter((d) => d.kind === "transfer");
  const transfers6 = off6.filter((d) => d.kind === "transfer");

  return (
    <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
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
          <button type="button" className="btn-secondary ml-auto" disabled={busy === "check"} onClick={runCheck}>
            {busy === "check" ? "Сверяю…" : "Сверить с isdayoff.ru"}
          </button>
        </div>
        {checkNote && <p className="text-sm text-ink-secondary bg-surface-plane rounded-lg px-3 py-2">{checkNote}</p>}
        {diff && diff.length === 0 && <p className="text-sm bg-status-good/10 text-status-good rounded-lg px-3 py-2">Сверено с isdayoff.ru: расхождений за {year} год нет.</p>}
        {diff && diff.length > 0 && (
          <div className="text-sm bg-[#fdf6e7] rounded-lg px-3 py-2 space-y-1">
            <div className="font-medium">Расхождения с isdayoff.ru (пятидневка) — {diff.length}:</div>
            {diff.map((d) => (
              <div key={d.date}>
                {formatDay(d.date)}: у нас {d.ours ? "выходной" : "рабочий"}, у них {d.theirs ? "выходной" : "рабочий"}
              </div>
            ))}
            <div className="text-xs text-ink-muted">Внешний календарь бывает неточным; если правы они — добавьте день справа как «дополнительный выходной» или «рабочий день».</div>
          </div>
        )}
        {error && <p className="text-sm text-status-critical">{error}</p>}

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
              {computed.map((c, i) => {
                const o = override(c.month);
                const isEditing = editing === c.month && draft;
                const shown = o ?? c;
                return (
                  <tr key={c.month} className="border-b border-line-hairline last:border-0">
                    <td className="px-4 py-2 font-medium whitespace-nowrap">
                      {MONTHS[i]}
                      {o && <span className="text-xs text-[#8a5a00] font-normal"> · задано вручную</span>}
                    </td>
                    {isEditing ? (
                      <>
                        <td className="px-1 py-1.5 text-right">
                          <input className={cell} inputMode="numeric" value={draft!.days5 || ""} onChange={(e) => setDraft({ ...draft!, days5: num(e.target.value) })} />
                        </td>
                        <td className="px-1 py-1.5 text-right">
                          <input className={cell} inputMode="decimal" value={draft!.hours5 || ""} onChange={(e) => setDraft({ ...draft!, hours5: num(e.target.value) })} />
                        </td>
                        <td className="px-1 py-1.5 text-right">
                          <input className={cell} inputMode="numeric" value={draft!.days6 || ""} onChange={(e) => setDraft({ ...draft!, days6: num(e.target.value) })} />
                        </td>
                        <td className="px-1 py-1.5 text-right">
                          <input className={cell} inputMode="decimal" value={draft!.hours6 || ""} onChange={(e) => setDraft({ ...draft!, hours6: num(e.target.value) })} />
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          <button type="button" className="text-xs text-section-payroll font-medium hover:underline mr-3" disabled={busy === c.month} onClick={save}>
                            сохранить
                          </button>
                          <button type="button" className="text-xs text-ink-muted hover:text-ink-primary" onClick={() => { setEditing(""); setDraft(null); }}>
                            отмена
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className={clsx("px-3 py-2 text-right tabular-nums", o && o.days5 !== c.days5 && "text-[#8a5a00]")} title={o && o.days5 !== c.days5 ? `по календарю ${c.days5}` : undefined}>
                          {shown.days5}
                        </td>
                        <td className={clsx("px-3 py-2 text-right tabular-nums", o && o.hours5 !== c.hours5 && "text-[#8a5a00]")} title={o && o.hours5 !== c.hours5 ? `по календарю ${c.hours5}` : undefined}>
                          {shown.hours5}
                        </td>
                        <td className={clsx("px-3 py-2 text-right tabular-nums", o && o.days6 !== c.days6 && "text-[#8a5a00]")} title={o && o.days6 !== c.days6 ? `по календарю ${c.days6}` : undefined}>
                          {shown.days6}
                        </td>
                        <td className={clsx("px-3 py-2 text-right tabular-nums", o && o.hours6 !== c.hours6 && "text-[#8a5a00]")} title={o && o.hours6 !== c.hours6 ? `по календарю ${c.hours6}` : undefined}>
                          {shown.hours6}
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          {canEdit && o && (
                            <button type="button" className="text-xs text-ink-muted hover:text-ink-primary mr-3" disabled={busy === c.month} onClick={() => drop(c.month)}>
                              по календарю
                            </button>
                          )}
                          {canEdit && (
                            <button type="button" className="text-xs text-ink-muted hover:text-ink-primary" onClick={() => startEdit(c.month)}>
                              исправить
                            </button>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              <tr className="bg-surface-plane/60 font-medium">
                <td className="px-4 py-2">За год по календарю</td>
                <td className="px-3 py-2 text-right tabular-nums">{total.days5}</td>
                <td className="px-3 py-2 text-right tabular-nums">{total.hours5}</td>
                <td className="px-3 py-2 text-right tabular-nums">{total.days6}</td>
                <td className="px-3 py-2 text-right tabular-nums">{total.hours6}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-muted">
          Считается по закону «О праздниках в РК» и Трудовому кодексу: праздник на выходном переносится на следующий рабочий день; пятидневка — 8 часов в день, шестидневка — 7 часов пн–пт и 5 в субботу. Жёлтым — месяцы, где бухгалтер задала норму руками и она отличается от календаря.
        </p>
      </div>

      <div className="space-y-4">
        <div className="card space-y-3">
          <h3 className="font-medium">Праздники {year}</h3>
          <ul className="divide-y divide-line-hairline text-sm">
            {law.map((h) => (
              <li key={h.date} className="py-1.5 flex items-center gap-2">
                <span className="tabular-nums w-20 shrink-0">{formatDay(h.date)}</span>
                <span className="flex-1 text-ink-secondary">{h.name}</span>
              </li>
            ))}
          </ul>
          {!kurban && !law.some((h) => /курбан/i.test(h.name)) && (
            <p className="text-xs text-[#8a5a00]">Дата Курбан-айта на {year} год программе не известна — добавьте её ниже как праздник, когда объявят.</p>
          )}
          {kurban && !kurban.confirmed && <p className="text-xs text-[#8a5a00]">Курбан-айт на {year} год — дата предварительная; когда правительство объявит, проверьте.</p>}
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-secondary">Переносы выходных: пятидневка {transfers5.length}, шестидневка {transfers6.length}</summary>
            <div className="mt-2 space-y-1 text-xs text-ink-secondary">
              {transfers5.map((d) => (
                <div key={`5${d.date}`}>
                  {formatDay(d.date)} — {d.name}
                  {!transfers6.some((x) => x.date === d.date) && " · только пятидневка"}
                </div>
              ))}
              {transfers6.filter((d) => !transfers5.some((x) => x.date === d.date)).map((d) => (
                <div key={`6${d.date}`}>
                  {formatDay(d.date)} — {d.name} · только шестидневка
                </div>
              ))}
            </div>
          </details>
        </div>

        <div className="card space-y-3">
          <h3 className="font-medium">Дополнения {year}</h3>
          <p className="text-xs text-ink-muted">Внеплановые решения правительства: дополнительный выходной, перенос, рабочая суббота. Праздники по закону добавлять не нужно — они уже учтены.</p>
          <ul className="divide-y divide-line-hairline text-sm">
            {yearExtras.length === 0 && <li className="py-2 text-ink-muted">Нет.</li>}
            {yearExtras.map((h) => (
              <li key={h.date} className="py-2 flex items-center gap-2">
                <span className="tabular-nums w-20 shrink-0">{formatDay(h.date)}</span>
                <span className="flex-1 text-ink-secondary">
                  {h.name || HOLIDAY_KIND_LABELS[h.kind]}
                  <span className="text-xs text-ink-muted"> · {HOLIDAY_KIND_LABELS[h.kind]}</span>
                </span>
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
              <select className="input" value={newKind} onChange={(e) => setNewKind(e.target.value)}>
                <option value="off">Дополнительный выходной (перенос)</option>
                <option value="work">Рабочий день (отменён выходной)</option>
                <option value="">Праздник (например, Курбан-айт)</option>
              </select>
              <input className="input" placeholder="Основание: постановление, Курбан-айт…" value={newName} onChange={(e) => setNewName(e.target.value)} />
              {holidayError && <p className="text-xs text-status-critical">{holidayError}</p>}
              <button type="button" className="btn-secondary w-full" disabled={!newDate || busy === "holiday"} onClick={addDay}>
                + Добавить
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
