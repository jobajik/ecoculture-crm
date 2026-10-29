"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import clsx from "clsx";
import { unwrap } from "@/lib/actionResult";
import { ghHref } from "@/lib/greenhouse/farm";
import type { LogKind, LogRowDraft } from "@/lib/greenhouse/production";
import { GRADE_COLORS } from "@/lib/greenhouse/views";
import { THEAD_ROW, TH, TR } from "@/lib/tableStyle";

/**
 * Записи журнала теплицы (срезка, черенкование или брак) во вкладке «Записи»: отбор (период, цикл, блок, сорт),
 * итоги отобранного и сами записи днями — с правкой и удалением в строке. Вносятся записи не здесь, а на «Внести
 * день» (29.10.2026): у каждого дня — ссылка «открыть день».
 */

export interface LogRowView {
  id: string;
  date: string;
  cycle: number;
  block: string;
  variety: string;
  kind: string;
  qty: number;
  weightKg: number;
  part: string;
  line: string;
  note: string;
}

type Line = { key: number; variety: string; kind: string; qty: string; weightKg: string; part: string; line: string; note: string };

const TITLES: Record<LogKind, { kind: string; add: string; qty: string }> = {
  harvest: { kind: "Категория", add: "Записать срезку", qty: "Штук" },
  cuttings: { kind: "Вид записи", add: "Записать черенкование", qty: "Штук" },
  waste: { kind: "Причина", add: "Записать брак", qty: "Штук" },
};

const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
function dm(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}
const n0 = (n: number) => Math.round(n).toLocaleString("ru-RU");

export default function LogBoard({
  log,
  path,
  params = {},
  farm,
  today,
  from,
  to,
  cycle,
  block,
  rows,
  shownLimit,
  totalMatched,
  kinds,
  blocks,
  cycles,
  varieties,
  canEdit,
  save,
  remove,
}: {
  log: LogKind;
  path: string;
  /** Постоянные параметры адреса (вид записей). */
  params?: Record<string, string>;
  farm: string;
  today: string;
  from: string;
  to: string;
  cycle: number | null;
  block: string;
  rows: LogRowView[];
  shownLimit: number;
  totalMatched: number;
  kinds: { code: string; label: string }[];
  blocks: string[];
  cycles: number[];
  varieties: string[];
  canEdit: boolean;
  save: (log: string, farm: string, rows: LogRowDraft[]) => Promise<unknown>;
  remove: (log: string, farm: string, id: string) => Promise<unknown>;
}) {
  const router = useRouter();
  const t = TITLES[log];
  const kindLabel = (code: string) => kinds.find((k) => k.code === code)?.label ?? code;
  const [q, setQ] = useState("");
  const [kindFilter, setKindFilter] = useState("");

  // --- отбор ---
  const go = (next: { from?: string; to?: string; cycle?: number | null; block?: string }) => {
    const c = next.cycle === undefined ? cycle : next.cycle;
    const b = next.block === undefined ? block : next.block;
    router.push(ghHref(path, farm, { ...params, from: next.from ?? from, to: next.to ?? to, cycle: c ?? undefined, block: b || undefined }));
  };
  const monthStart = today.slice(0, 8) + "01";
  const prevMonthEnd = shiftDay(monthStart, -1);
  const prevMonthStart = prevMonthEnd.slice(0, 8) + "01";
  const quick = (label: string, f: string, tt: string) => (
    <button
      type="button"
      className={clsx("text-xs px-2.5 py-1 rounded-full border whitespace-nowrap", f === from && tt === to ? "bg-ink-primary text-white border-ink-primary" : "border-line-hairline hover:bg-surface-plane")}
      onClick={() => go({ from: f, to: tt })}
    >
      {label}
    </button>
  );

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return rows.filter((r) => (!k || r.variety.toLowerCase().includes(k)) && (!kindFilter || r.kind === kindFilter));
  }, [rows, q, kindFilter]);

  const [visible, setVisible] = useState(300);
  const dayTotals = useMemo(() => {
    const m = new Map<string, { qty: number; blocks: Set<string> }>();
    for (const r of shown) {
      const d = m.get(r.date) ?? { qty: 0, blocks: new Set<string>() };
      d.qty += r.qty;
      d.blocks.add(r.block);
      m.set(r.date, d);
    }
    return m;
  }, [shown]);

  const totals = useMemo(() => {
    const byKind = new Map<string, number>();
    let qty = 0;
    let kg = 0;
    let kgQty = 0;
    for (const r of shown) {
      qty += r.qty;
      byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + r.qty);
      if (r.weightKg > 0) {
        kg += r.weightKg;
        kgQty += r.qty;
      }
    }
    return { qty, byKind, avgG: kgQty ? (kg * 1000) / kgQty : null };
  }, [shown]);

  // --- правка строки ---
  const [editId, setEditId] = useState("");
  const [edit, setEdit] = useState<LogRowView | null>(null);
  const [rowBusy, setRowBusy] = useState("");
  const [rowErr, setRowErr] = useState("");
  async function saveEdit() {
    if (!edit) return;
    setRowBusy(edit.id);
    setRowErr("");
    try {
      unwrap(await save(log, farm, [{ id: edit.id, date: edit.date, cycle: edit.cycle, block: edit.block, variety: edit.variety, kind: edit.kind, qty: edit.qty, weightKg: edit.weightKg, part: edit.part, line: edit.line, note: edit.note }]));
      setEditId("");
      setEdit(null);
      router.refresh();
    } catch (err) {
      setRowErr(err instanceof Error ? err.message : "Не сохранилось.");
    } finally {
      setRowBusy("");
    }
  }
  async function del(id: string) {
    if (!window.confirm("Удалить запись?")) return;
    setRowBusy(id);
    setRowErr("");
    try {
      unwrap(await remove(log, farm, id));
      router.refresh();
    } catch (err) {
      setRowErr(err instanceof Error ? err.message : "Не удалилось.");
    } finally {
      setRowBusy("");
    }
  }

  const kindTone = (code: string) => (log === "harvest" ? GRADE_COLORS[code] : undefined);
  const listId = `gh-varieties-${log}`;

  return (
    <div className="space-y-4">
      <datalist id={listId}>
        {varieties.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>

      {/* Отбор */}
      <div className="card !p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {quick("Этот месяц", monthStart, today)}
          {quick("Прошлый месяц", prevMonthStart, prevMonthEnd)}
          {quick("30 дней", shiftDay(today, -29), today)}
          {quick("Всё время", "2000-01-01", today)}
          <span className="flex items-center gap-1 text-xs text-ink-muted ml-1">
            <input type="date" className="input !py-1 !h-8 !text-xs w-[8.5rem]" value={from === "2000-01-01" ? "" : from} max={today} onChange={(e) => e.target.value && go({ from: e.target.value })} />—
            <input type="date" className="input !py-1 !h-8 !text-xs w-[8.5rem]" value={to} max={today} onChange={(e) => e.target.value && go({ to: e.target.value })} />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input !h-9 !py-1 w-auto" value={cycle ?? ""} onChange={(e) => go({ cycle: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Все циклы</option>
            {cycles.map((c) => (
              <option key={c} value={c}>
                Цикл {c}
              </option>
            ))}
          </select>
          <select className="input !h-9 !py-1 w-auto" value={block} onChange={(e) => go({ block: e.target.value })}>
            <option value="">Все блоки</option>
            {blocks.map((b) => (
              <option key={b} value={b}>
                {/^\d+$/.test(b) ? `Блок ${b}` : b}
              </option>
            ))}
          </select>
          <select className="input !h-9 !py-1 w-auto" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="">{log === "harvest" ? "Все категории" : log === "cuttings" ? "Все виды записей" : "Все причины"}</option>
            {kinds.map((k) => (
              <option key={k.code} value={k.code}>
                {k.label}
              </option>
            ))}
          </select>
          <input className="input !h-9 !py-1 w-44" placeholder="Сорт…" value={q} onChange={(e) => setQ(e.target.value)} />
          {canEdit && (
            <Link href={ghHref("/greenhouse/day", farm, { section: log, block: block || undefined })} className="btn-primary !py-1.5 ml-auto">
              + Внести день
            </Link>
          )}
        </div>
      </div>

      {/* Итоги отобранного */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span>
          <b className="font-display text-[18px] tabular-nums">{n0(totals.qty)}</b> <span className="text-ink-muted">шт. · {shown.length} {shown.length === 1 ? "запись" : "записей"}</span>
        </span>
        {totals.avgG !== null && <span className="text-ink-secondary">средний вес {Math.round(totals.avgG)} г</span>}
        <div className="flex flex-wrap gap-1.5">
          {kinds
            .filter((k) => totals.byKind.get(k.code))
            .map((k) => (
              <span key={k.code} className="inline-flex items-center gap-1 rounded-full border border-line-hairline px-2 py-0.5 text-xs">
                {kindTone(k.code) && <span className="w-2 h-2 rounded-sm" style={{ background: kindTone(k.code) }} />}
                {k.label} <b className="tabular-nums">{n0(totals.byKind.get(k.code)!)}</b>
                {totals.qty > 0 && <span className="text-ink-muted">{Math.round((totals.byKind.get(k.code)! * 100) / totals.qty)}%</span>}
              </span>
            ))}
        </div>
      </div>
      {totalMatched > rows.length && (
        <div className="text-xs text-ink-muted">
          Показаны последние {shownLimit.toLocaleString("ru-RU")} из {totalMatched.toLocaleString("ru-RU")} — сузьте период, цикл или блок.
        </div>
      )}
      {rowErr && <div className="text-sm text-[#a12b2b]">{rowErr}</div>}

      {/* Записи */}
      <div className="card !p-0 overflow-hidden">
        {shown.length === 0 ? (
          <div className="p-6 text-sm text-ink-secondary">За выбранный отбор записей нет.</div>
        ) : (
          <table className="w-full text-sm table-cards">
            <thead>
              <tr className={THEAD_ROW}>
                <th className={TH}>Блок · цикл</th>
                <th className={TH}>Сорт</th>
                <th className={TH}>{t.kind}</th>
                <th className={clsx(TH, "text-right")}>Штук</th>
                {log === "harvest" && <th className={clsx(TH, "text-right")}>Вес</th>}
                {log === "cuttings" && <th className={TH}>Секц. / линия</th>}
                {canEdit && <th className={clsx(TH, "w-16")} />}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, visible).map((r, i, list) => {
                const dayHead =
                  i === 0 || list[i - 1].date !== r.date ? (
                    <tr key={`d-${r.date}`} className="bg-surface-plane/80 border-b border-line-hairline">
                      <td colSpan={4 + (log === "waste" ? 0 : 1) + (canEdit ? 1 : 0)} className="px-4 py-1.5 text-xs">
                        <b className="text-ink-primary">{dm(r.date)}</b>
                        <span className="text-ink-secondary">
                          {" · "}
                          {n0(dayTotals.get(r.date)?.qty ?? 0)} шт. ·{" "}
                          {Array.from(dayTotals.get(r.date)?.blocks ?? [])
                            .map((b) => (b === "—" ? "весь цикл" : /^\d+$/.test(b) ? `блок ${b}` : b))
                            .join(", ")}
                        </span>
                        {canEdit && (
                          <Link href={ghHref("/greenhouse/day", farm, { date: r.date, section: log })} className="float-right text-section-greenhouse hover:underline">
                            открыть день →
                          </Link>
                        )}
                      </td>
                    </tr>
                  ) : null;
                const row = editId === r.id && edit ? (
                  <tr key={r.id} className="border-b border-line-hairline bg-section-greenhouse-soft/40">
                    <td className="px-2 py-1.5">
                      <div className="flex gap-1">
                        <input type="date" className="input !h-8 !py-1 w-[8.5rem]" value={edit.date} max={today} onChange={(e) => setEdit({ ...edit, date: e.target.value })} />
                        <input className="input !h-8 !py-1 w-16" value={edit.block} onChange={(e) => setEdit({ ...edit, block: e.target.value })} />
                        <input className="input !h-8 !py-1 w-12" value={edit.cycle} onChange={(e) => setEdit({ ...edit, cycle: Number(e.target.value) || 0 })} />
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <input className="input !h-8 !py-1 w-full min-w-[8rem]" list={listId} value={edit.variety} onChange={(e) => setEdit({ ...edit, variety: e.target.value })} />
                    </td>
                    <td className="px-2 py-1.5">
                      <select className="input !h-8 !py-1" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>
                        {kinds.map((k) => (
                          <option key={k.code} value={k.code}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input className="input !h-8 !py-1 w-20 text-right" inputMode="numeric" value={edit.qty} onChange={(e) => setEdit({ ...edit, qty: Number(e.target.value.replace(/\s/g, "")) || 0 })} />
                    </td>
                    {log === "harvest" && (
                      <td className="px-2 py-1.5">
                        <input className="input !h-8 !py-1 w-16 text-right" inputMode="decimal" value={edit.weightKg || ""} onChange={(e) => setEdit({ ...edit, weightKg: Number(e.target.value.replace(",", ".")) || 0 })} />
                      </td>
                    )}
                    {log === "cuttings" && (
                      <td className="px-2 py-1.5">
                        <div className="flex gap-1">
                          <input className="input !h-8 !py-1 w-12" value={edit.part} onChange={(e) => setEdit({ ...edit, part: e.target.value })} />
                          <input className="input !h-8 !py-1 w-12" value={edit.line} onChange={(e) => setEdit({ ...edit, line: e.target.value })} />
                        </div>
                      </td>
                    )}
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      <button type="button" className="text-sm text-section-greenhouse font-medium mr-2" disabled={rowBusy === r.id} onClick={saveEdit}>
                        ✓
                      </button>
                      <button type="button" className="text-sm text-ink-muted" onClick={() => setEditId("")}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className={TR}>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {r.block === "—" ? "весь цикл" : /^\d+$/.test(r.block) ? `Блок ${r.block}` : r.block}
                      <span className="text-ink-muted"> · ц. {r.cycle}</span>
                    </td>
                    <td data-label="Сорт" className="px-4 py-2">
                      {r.variety}
                    </td>
                    <td data-label={t.kind} className="px-4 py-2 whitespace-nowrap">
                      {kindTone(r.kind) && <span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: kindTone(r.kind) }} />}
                      {kindLabel(r.kind)}
                    </td>
                    <td data-label="Штук" className="px-4 py-2 text-right tabular-nums font-medium">
                      {n0(r.qty)}
                    </td>
                    {log === "harvest" && (
                      <td data-label="Вес" className="px-4 py-2 text-right tabular-nums text-ink-secondary whitespace-nowrap">
                        {r.weightKg ? `${r.weightKg.toLocaleString("ru-RU")} кг` : "—"}
                        {r.weightKg > 0 && r.qty > 0 && <span className="text-[11px] text-ink-muted ml-1">{Math.round((r.weightKg * 1000) / r.qty)} г</span>}
                      </td>
                    )}
                    {log === "cuttings" && (
                      <td data-label="Секц. / линия" className="px-4 py-2 text-ink-secondary">
                        {[r.part, r.line].filter(Boolean).join(" / ") || "—"}
                      </td>
                    )}
                    {canEdit && (
                      <td className="px-4 py-2 whitespace-nowrap text-right">
                        <button
                          type="button"
                          className="text-ink-muted hover:text-ink-primary mr-2"
                          title="Изменить"
                          onClick={() => {
                            setEditId(r.id);
                            setEdit(r);
                          }}
                        >
                          ✎
                        </button>
                        <button type="button" className="text-ink-muted hover:text-[#a12b2b]" title="Удалить" disabled={rowBusy === r.id} onClick={() => del(r.id)}>
                          ✕
                        </button>
                      </td>
                    )}
                  </tr>
                );
                return (
                  <Fragment key={r.id}>
                    {dayHead}
                    {row}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {shown.length > visible && (
        <button type="button" className="btn-secondary !py-1.5" onClick={() => setVisible((v) => v + 300)}>
          Показать ещё {Math.min(300, shown.length - visible)} из {shown.length - visible}
        </button>
      )}
    </div>
  );
}

function shiftDay(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
