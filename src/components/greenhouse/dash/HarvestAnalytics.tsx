import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import Hint from "@/components/Hint";
import GradeStackChart from "@/components/greenhouse/GradeStackChart";
import { Delta, Insights } from "@/components/greenhouse/rank";
import { num } from "@/components/greenhouse/parts";
import type { CompareRow, SeriesBy } from "@/lib/greenhouse/analyticsView";
import { changePct, changePoints, type GreenhouseReport } from "@/lib/greenhouse/dashboard";
import { QUALITY_COLORS, QUALITY_GROUPS } from "@/lib/greenhouse/views";

/**
 * «Аналитика → Срезка» (30.10.2026): за выбранный период — шесть цифр с изменением к такому же сроку перед ним, выводы
 * словами, срезка во времени по качеству и блоки и сорта одной таблицей. Нажатие на блок или сорт сужает весь экран
 * до него. Без "use client".
 */

const fmt1 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`);

function Tile({ label, value, delta, sub, hint }: { label: string; value: ReactNode; delta?: ReactNode; sub?: ReactNode; hint?: string }) {
  return (
    <div className="card !p-3.5 min-w-0">
      <div className="flex items-center gap-1 text-[11px] text-ink-muted">
        <span className="truncate">{label}</span>
        {hint && <Hint>{hint}</Hint>}
      </div>
      <div className="flex items-baseline gap-2 flex-wrap mt-0.5">
        <span className="font-display font-extrabold text-[22px] leading-tight tabular-nums">{value}</span>
        {delta}
      </div>
      {sub && <div className="text-[11px] text-ink-secondary mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

export type SortKey = "qty" | "top" | "weight" | "loss" | "change";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "qty", label: "Срезано" },
  { key: "change", label: "К прошлому" },
  { key: "top", label: "Высш. и 1-я" },
  { key: "weight", label: "Вес" },
  { key: "loss", label: "Потери" },
];

export function sortRows(rows: CompareRow[], sort: SortKey): CompareRow[] {
  const v = (r: CompareRow): number | null => (sort === "qty" ? r.qty : sort === "change" ? r.change : sort === "top" ? r.topPct : sort === "weight" ? r.avgWeight : r.lossPct);
  return [...rows].sort((a, b) => {
    const x = v(a);
    const y = v(b);
    if (x === null && y === null) return b.qty - a.qty;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x;
  });
}

function Mark({ row, k }: { row: CompareRow; k: "top" | "weight" | "loss" }) {
  if (row.best.includes(k)) return <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-[#2f8a55] align-middle" title="лучший" />;
  if (row.worst.includes(k)) return <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-[#e0a526] align-middle" title="отстаёт" />;
  return null;
}

export function CompareTable({ title, first, rows, sort, sortHref, rowHref, total }: { title: string; first: string; rows: CompareRow[]; sort: SortKey; sortHref: (s: SortKey) => string; rowHref: (r: CompareRow) => string; total: number }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.qty), 1);
  const th = (s: SortKey, label: string, cls = "") => (
    <th className={clsx("px-3 py-2 font-medium text-right whitespace-nowrap", cls)}>
      <Link href={sortHref(s)} className={clsx("hover:text-ink-primary", sort === s && "text-ink-primary underline underline-offset-4")}>
        {label}
      </Link>
    </th>
  );
  return (
    <section className="card !p-0 overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-x-3 px-4 pt-4 pb-2">
        <h3 className="font-display font-bold text-[15px]">{title}</h3>
        <span className="text-xs text-ink-muted">нажмите строку — экран сузится до неё; зелёная точка — лучший, жёлтая — отстаёт</span>
        <div className="sm:hidden flex flex-wrap gap-1.5 w-full mt-2">
          {SORTS.map((s) => (
            <Link key={s.key} href={sortHref(s.key)} className={clsx("text-[11px] px-2 py-1 rounded-full border", sort === s.key ? "bg-ink-primary text-white border-ink-primary" : "border-line-hairline")}>
              {s.label}
            </Link>
          ))}
        </div>
      </div>
      {/* Телефон: две строки на блок — имя и срезано, ниже остальные цифры одной строкой. */}
      <ul className="sm:hidden divide-y divide-line-hairline border-t border-line-hairline">
        {rows.map((r) => (
          <li key={r.key} className="px-4 py-2.5">
            <div className="flex items-baseline gap-2">
              <Link href={rowHref(r)} className="font-medium hover:underline truncate min-w-0">
                {r.label}
              </Link>
              <span className="ml-auto tabular-nums font-semibold">{num(r.qty)}</span>
              <span className="w-14 text-right">{r.change !== null ? <Delta value={r.change} unit="%" /> : <span className="text-[11px] text-ink-muted">{r.qty ? "раньше 0" : "—"}</span>}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-sunk overflow-hidden">
              <div className="h-full rounded-full bg-section-greenhouse/60" style={{ width: `${(r.qty * 100) / max}%` }} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-secondary tabular-nums">
              <span>
                высш. и 1-я {fmt1(r.topPct)}
                <Mark row={r} k="top" />
              </span>
              <span>
                {r.avgWeight ? `${r.avgWeight} г` : "вес —"}
                <Mark row={r} k="weight" />
              </span>
              <span>
                потери {fmt1(r.lossPct)}
                <Mark row={r} k="loss" />
              </span>
            </div>
          </li>
        ))}
      </ul>
      <table className="hidden sm:table w-full text-sm">
        <thead>
          <tr className="text-xs text-ink-muted border-y border-line-hairline bg-surface-plane/60">
            <th className="px-4 py-2 font-medium text-left">{first}</th>
            {th("qty", "Срезано", "w-[30%]")}
            {th("change", "К прошлому")}
            <th className="px-3 py-2 font-medium text-right">Товарность</th>
            {th("top", "Высш. и 1-я")}
            {th("weight", "Вес")}
            {th("loss", "Потери")}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane/60">
              <td className="px-4 py-2">
                <Link href={rowHref(r)} className="font-medium hover:underline">
                  {r.label}
                </Link>
              </td>
              <td data-label="Срезано" className="px-3 py-2">
                <div className="flex items-center gap-2 justify-end">
                  <span className="hidden md:block flex-1 h-2 rounded-full bg-surface-sunk overflow-hidden max-w-[10rem]">
                    <span className="block h-full rounded-full bg-section-greenhouse/60" style={{ width: `${(r.qty * 100) / max}%` }} />
                  </span>
                  <span className="tabular-nums font-medium">{num(r.qty)}</span>
                  <span className="text-[11px] text-ink-muted tabular-nums w-10 text-right">{total ? `${Math.round((r.qty * 100) / total)}%` : ""}</span>
                </div>
              </td>
              <td data-label="К прошлому" className="px-3 py-2 text-right">
                {r.change !== null ? <Delta value={r.change} unit="%" /> : <span className="text-xs text-ink-muted">{r.qty ? "раньше 0" : "—"}</span>}
              </td>
              <td data-label="Товарность" className="px-3 py-2 text-right tabular-nums">
                {fmt1(r.saleablePct)}
              </td>
              <td data-label="Высш. и 1-я" className="px-3 py-2 text-right tabular-nums">
                {fmt1(r.topPct)}
                <Mark row={r} k="top" />
              </td>
              <td data-label="Вес" className="px-3 py-2 text-right tabular-nums">
                {r.avgWeight ? `${r.avgWeight} г` : "—"}
                <Mark row={r} k="weight" />
              </td>
              <td data-label="Потери" className="px-3 py-2 text-right tabular-nums">
                {fmt1(r.lossPct)}
                <Mark row={r} k="loss" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const BY_LABEL: Record<SeriesBy, string> = { day: "по дням", week: "по неделям", month: "по месяцам" };

export default function HarvestAnalytics({
  rep,
  insights,
  series,
  seriesBy,
  blocks,
  varieties,
  sort,
  sortHref,
  blockHref,
  varietyHref,
  showBlocks,
  showVarieties,
}: {
  rep: GreenhouseReport;
  insights: string[];
  series: Record<string, number | string>[];
  seriesBy: SeriesBy;
  blocks: CompareRow[];
  varieties: CompareRow[];
  sort: SortKey;
  sortHref: (s: SortKey) => string;
  blockHref: (r: CompareRow) => string;
  varietyHref: (r: CompareRow) => string;
  showBlocks: boolean;
  showVarieties: boolean;
}) {
  const t = rep.totals;
  const p = rep.prev;
  if (!t.qty && !rep.loss.onBlocks)
    return <div className="card text-sm text-ink-secondary">За этот период срезки не было. Листните период стрелками или выберите другой.</div>;
  const groups = QUALITY_GROUPS.map((g) => g.label);
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile label="Срезано" value={num(t.qty)} delta={<Delta value={changePct(t.qty, p.qty)} unit="%" />} sub={p.qty ? `до этого ${num(p.qty)}` : "до этого срезки не было"} hint="Стрелка — к такому же сроку перед этим." />
        <Tile label="В день срезки" value={num(t.perDay)} delta={<Delta value={changePct(t.perDay ?? 0, p.perDay ?? 0)} unit="%" />} sub={`${t.days} дн. срезки · ${t.blocks} блоков`} />
        <Tile label="Товарность" value={fmt1(t.saleablePct)} delta={<Delta value={changePoints(t.saleablePct, p.saleablePct)} />} sub={`брак при срезке ${fmt1(t.rejectPct)}`} hint="Всё срезанное, кроме брака, нераскрывшегося и уценки." />
        <Tile label="Высшая и 1-я" value={fmt1(t.topPct)} delta={<Delta value={changePoints(t.topPct, p.topPct)} />} sub={`${num(Math.round(((t.topPct ?? 0) * t.qty) / 100))} шт.`} />
        <Tile label="Вес стебля" value={t.avgWeight ? `${t.avgWeight} г` : "—"} delta={t.avgWeight && p.avgWeight ? <Delta value={t.avgWeight - p.avgWeight} unit="г" /> : null} sub={p.avgWeight ? `было ${p.avgWeight} г` : undefined} />
        <Tile label="Потери" value={fmt1(rep.loss.lossPct)} sub={`${num(rep.loss.lost)} шт. на блоках и при срезке`} hint="Брак на блоках (повилика, клещ…) и категория «Брак» при срезке — от всего, что дали блоки." />
      </div>

      <section className="card !p-4 space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 className="font-display font-bold text-[15px]">Срезка {BY_LABEL[seriesBy]}</h3>
          <span className="text-xs text-ink-muted">тремя группами качества</span>
        </div>
        <Insights lines={insights} />
        <GradeStackChart data={series as never} grades={groups} colors={QUALITY_COLORS} height={240} />
        <div className="flex flex-wrap gap-x-3 text-[11px] text-ink-muted">
          {QUALITY_GROUPS.map((g) => (
            <span key={g.key}>
              <span className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: g.color }} />
              {g.label}
            </span>
          ))}
        </div>
      </section>

      {showBlocks && <CompareTable title="Блоки" first="Блок" rows={sortRows(blocks, sort)} sort={sort} sortHref={sortHref} rowHref={blockHref} total={t.qty} />}
      {showVarieties && <CompareTable title="Сорта" first="Сорт" rows={sortRows(varieties, sort)} sort={sort} sortHref={sortHref} rowHref={varietyHref} total={t.qty} />}
    </>
  );
}
