"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { unwrap } from "@/lib/actionResult";
import { formatDay } from "@/lib/formatDate";
import { decimal } from "@/lib/formatNumber";
import { payrollHref } from "@/lib/payroll/farmScope";
import { AREA_LABELS, WORK_AREAS, WORK_TYPES, monthRange, partLabel, shiftDay, type ImportRow, type WorkArea } from "@/lib/payroll/work";
import { THEAD_ROW, TH, TR } from "@/lib/tableStyle";
import WorkImportForm from "./WorkImportForm";

export interface JournalRow {
  workId: string;
  date: string;
  area: WorkArea;
  areaLabel: string;
  employeeId: string;
  name: string;
  block: string;
  part: string;
  workType: string;
  typeLabel: string;
  qty: number;
  hours: number;
  note: string;
  by: string;
}

const PAGE = 100;

/**
 * Журнал выработки: период и участок — в адресе (сервер читает только нужное), сотрудник, блок и вид — отбор на месте.
 * Правка строки — через «Ввод за день» (там сетка всего дня), здесь — только удалить лишнее.
 */
export default function WorkJournal({
  farm,
  today,
  from,
  to,
  area,
  rows,
  blocks,
  people,
  unmatched,
  links,
  canEdit,
  remove,
  listIds,
  importRows,
  linkName,
}: {
  farm: string;
  today: string;
  from: string;
  to: string;
  area: string;
  rows: JournalRow[];
  blocks: string[];
  people: { employeeId: string; fullName: string; deptName: string }[];
  unmatched: { name: string; rows: number; last: string }[];
  links: { name: string; employeeId: string }[];
  canEdit: boolean;
  remove: (farm: string, workId: string) => Promise<unknown>;
  listIds: (farm: string) => Promise<unknown>;
  importRows: (farm: string, rows: ImportRow[]) => Promise<unknown>;
  linkName: (farm: string, name: string, employeeId: string) => Promise<unknown>;
}) {
  const router = useRouter();
  const [person, setPerson] = useState("");
  const [block, setBlock] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const [pFrom, setPFrom] = useState(from);
  const [pTo, setPTo] = useState(to);

  const go = (next: { from?: string; to?: string; area?: string }) => {
    router.push(payrollHref("/payroll/work/journal", farm, { from: next.from ?? pFrom, to: next.to ?? pTo, area: (next.area ?? area) || undefined }));
  };

  const filtered = useMemo(
    () =>
      rows.filter((r) => (!person || (person.startsWith("name:") ? r.name === person.slice(5) : r.employeeId === person)) && (!block || r.block === block) && (!type || r.workType === type)),
    [rows, person, block, type],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const sumQty = filtered.reduce((s, r) => s + r.qty, 0);
  const sumHours = filtered.reduce((s, r) => s + r.hours, 0);
  const peopleInRows = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.employeeId ? r.employeeId : `name:${r.name}`, r.name);
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], "ru"));
  }, [rows]);
  const types = area ? WORK_TYPES[area as WorkArea] : WORK_AREAS.flatMap((a) => WORK_TYPES[a]).filter((t, i, all) => all.findIndex((x) => x.code === t.code) === i);

  const onRemove = async (r: JournalRow) => {
    if (!window.confirm(`Удалить запись: ${r.name}, ${formatDay(r.date)}, ${r.typeLabel}?`)) return;
    setBusy(r.workId);
    setError("");
    try {
      unwrap(await remove(farm, r.workId));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось удалить.");
    } finally {
      setBusy("");
    }
  };

  const onLink = async (name: string, employeeId: string) => {
    setBusy(`link:${name}`);
    setError("");
    try {
      unwrap(await linkName(farm, name, employeeId));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось привязать.");
    } finally {
      setBusy("");
    }
  };

  const quick = (label: string, f: string, t: string) => (
    <button type="button" className={clsx("text-xs px-2.5 py-1 rounded-full border", f === from && t === to ? "bg-ink-primary text-white border-ink-primary" : "border-line-hairline hover:bg-surface-plane")} onClick={() => go({ from: f, to: t })}>
      {label}
    </button>
  );
  const thisMonth = monthRange(today.slice(0, 7));
  const prevMonthKey = shiftDay(thisMonth.from, -1).slice(0, 7);
  const prevMonth = monthRange(prevMonthKey);

  return (
    <div className="space-y-4">
      <div className="card !p-3 sm:!p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="label">С</label>
            <input type="date" className="input !w-auto !py-1.5" value={pFrom} max={today} onChange={(e) => setPFrom(e.target.value)} onBlur={() => pFrom && pFrom !== from && go({ from: pFrom })} />
          </div>
          <div>
            <label className="label">По</label>
            <input type="date" className="input !w-auto !py-1.5" value={pTo} max={today} onChange={(e) => setPTo(e.target.value)} onBlur={() => pTo && pTo !== to && go({ to: pTo })} />
          </div>
          <div>
            <label className="label">Участок</label>
            <select className="input !w-auto !py-1.5" value={area} onChange={(e) => go({ area: e.target.value })}>
              <option value="">Все участки</option>
              {WORK_AREAS.map((a) => (
                <option key={a} value={a}>
                  {AREA_LABELS[a]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Сотрудник</label>
            <select className="input !w-auto !py-1.5 max-w-[16rem]" value={person} onChange={(e) => { setPerson(e.target.value); setPage(0); }}>
              <option value="">Все</option>
              {peopleInRows.map(([k, n]) => (
                <option key={k} value={k}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Блок</label>
            <select className="input !w-auto !py-1.5" value={block} onChange={(e) => { setBlock(e.target.value); setPage(0); }}>
              <option value="">Все</option>
              {blocks.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Вид работ</label>
            <select className="input !w-auto !py-1.5" value={type} onChange={(e) => { setType(e.target.value); setPage(0); }}>
              <option value="">Все</option>
              {types.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {quick("Сегодня", today, today)}
          {quick("7 дней", shiftDay(today, -6), today)}
          {quick("Этот месяц", thisMonth.from, thisMonth.to)}
          {quick("Прошлый месяц", prevMonth.from, prevMonth.to)}
          {quick("90 дней", shiftDay(today, -89), today)}
          <span className="text-xs text-ink-muted ml-auto">
            {filtered.length} {filtered.length === 1 ? "запись" : filtered.length < 5 ? "записи" : "записей"} · {Math.round(sumQty).toLocaleString("ru-RU")} шт · {decimal(sumHours, 1)} ч
          </span>
        </div>
      </div>

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary !py-1.5" onClick={() => setShowImport((v) => !v)}>
            {showImport ? "Скрыть загрузку" : "Загрузить историю из Excel"}
          </button>
          {unmatched.length > 0 && (
            <button type="button" className="btn-secondary !py-1.5" onClick={() => setShowNames((v) => !v)}>
              Имена без карточки: {unmatched.length}
            </button>
          )}
        </div>
      )}
      {showImport && canEdit && <WorkImportForm farm={farm} today={today} listIds={listIds} importRows={importRows} onClose={() => setShowImport(false)} />}
      {showNames && canEdit && (
        <div className="card space-y-2">
          <div className="text-sm">
            <span className="font-medium">Имена из старого учёта без карточки сотрудника.</span>{" "}
            <span className="text-ink-secondary">Привяжите к карточке — все строки с этим именем станут его, и в оплате труда он будет считаться одним человеком.</span>
          </div>
          <div className="divide-y divide-line-hairline/60">
            {unmatched.map((u) => {
              const current = links.find((l) => l.name.trim().toLowerCase() === u.name.trim().toLowerCase())?.employeeId ?? "";
              return (
                <div key={u.name} className="py-2 flex flex-wrap items-center gap-2 text-sm">
                  <div className="min-w-[14rem] flex-1">
                    <div className="font-medium">{u.name}</div>
                    <div className="text-xs text-ink-muted">
                      {u.rows} {u.rows === 1 ? "строка" : u.rows < 5 ? "строки" : "строк"} · последняя {formatDay(u.last)}
                    </div>
                  </div>
                  <select className="input !w-auto !py-1.5 max-w-[20rem]" value={current} disabled={busy === `link:${u.name}`} onChange={(e) => onLink(u.name, e.target.value)}>
                    <option value="">— выбрать карточку —</option>
                    {people.map((p) => (
                      <option key={p.employeeId} value={p.employeeId}>
                        {p.fullName} · {p.deptName}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {error && <div className="card border-[#c43c3c]/30 bg-[#fde8e8] text-sm text-[#a12b2b]">{error}</div>}

      <div className="card !p-0">
        <table className="w-full text-sm table-cards">
          <thead>
            <tr className={THEAD_ROW}>
              <th className={TH}>Дата</th>
              {!area && <th className={TH}>Участок</th>}
              <th className={TH}>Сотрудник</th>
              <th className={TH}>Блок</th>
              <th className={TH}>Вид работ</th>
              <th className={clsx(TH, "text-right")}>Кол-во</th>
              <th className={clsx(TH, "text-right")}>Часов</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-ink-secondary">
                  Записей нет. {canEdit && "Внесите день на вкладке «Ввод за день» или загрузите историю из Excel."}
                </td>
              </tr>
            )}
            {shown.map((r) => (
              <tr key={r.workId} className={TR}>
                <td data-label="Дата" className="px-4 py-2 whitespace-nowrap">
                  <Link href={payrollHref("/payroll/work", farm, { date: r.date, area: r.area })} className="hover:underline" title="Открыть день">
                    {formatDay(r.date)}
                  </Link>
                </td>
                {!area && (
                  <td data-label="Участок" className="px-4 py-2 text-ink-secondary">
                    {r.areaLabel}
                  </td>
                )}
                <td data-label="Сотрудник" className="px-4 py-2">
                  {r.name}
                  {!r.employeeId && <span className="ml-1 text-xs text-[#8a5a00]" title="Нет карточки сотрудника">без карточки</span>}
                </td>
                <td data-label="Блок" className="px-4 py-2 tabular-nums">
                  {r.block || "—"}
                  {r.part && <span className="text-ink-muted"> · {partLabel(r.part)}</span>}
                </td>
                <td data-label="Вид работ" className="px-4 py-2">
                  {r.typeLabel}
                  {r.note && r.note !== "из книги учёта" && <span className="text-xs text-ink-muted"> · {r.note}</span>}
                </td>
                <td data-label="Кол-во" className="px-4 py-2 text-right tabular-nums">
                  {r.qty ? r.qty.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) : "—"}
                </td>
                <td data-label="Часов" className="px-4 py-2 text-right tabular-nums">
                  {r.hours ? decimal(r.hours, 2) : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  {canEdit && (
                    <button type="button" className="text-xs text-ink-muted hover:text-[#a12b2b]" disabled={busy === r.workId} onClick={() => onRemove(r)}>
                      {busy === r.workId ? "…" : "удалить"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-line-hairline text-sm">
            <button type="button" className="btn-secondary !py-1" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              ‹ Раньше
            </button>
            <span className="text-ink-muted text-xs">
              стр. {page + 1} из {pages}
            </span>
            <button type="button" className="btn-secondary !py-1" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
              Дальше ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
