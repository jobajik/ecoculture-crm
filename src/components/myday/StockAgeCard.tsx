"use client";

import { useState } from "react";
import clsx from "clsx";
import { FLOWER_TYPE_LABELS_PLURAL, formatGrade } from "@/lib/constants";
import type { AgeBucketFlower, AgeBucketRow } from "@/lib/stock";
import type { StorageStatus } from "@/lib/shelfLife";
import DayCard from "./DayCard";

/**
 * «Сколько дней лежит» в «Моём дне» (21.10.2026, владелец: «почему пропала аналитика с днями хранения? Она была крутой
 * и нужной», а на вернувшийся внизу старый блок — «это ужас, переделай дизайн и двинь наверх»). Одна карточка во всю
 * ширину сразу под плитками: четыре колонки-диапазона (1–3, 4–7, 8–13, 14+ дней), в каждой — сколько штук и доля склада,
 * полоска «в сроке / скоро / дольше срока» по штукам и цветки строками; нажатие на цветок раскрывает длины и категории.
 * Цвет — по сроку хранения ЭТОГО цветка: роза на девятый день красная, хризантема в тот же день зелёная.
 */

const DOT: Record<StorageStatus, string> = {
  ok: "bg-status-good",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
  depleted: "bg-ink-muted",
};

const num = (n: number) => Math.round(n).toLocaleString("ru-RU");

function split(bucket: AgeBucketRow) {
  let ok = 0;
  let warn = 0;
  let bad = 0;
  for (const f of bucket.flowers)
    for (const g of f.grades) {
      if (g.status === "critical") bad += g.quantity;
      else if (g.status === "warning") warn += g.quantity;
      else ok += g.quantity;
    }
  return { ok, warn, bad };
}

export default function StockAgeCard({
  buckets,
  total,
  href,
  shelfNote,
}: {
  buckets: AgeBucketRow[];
  total: number;
  href: string;
  /** «роза 7 дн. · хризантема 18 · эустома 10» — сроки хранения из настроек. */
  shelfNote: string;
}) {
  const all = buckets.reduce(
    (acc, b) => {
      const s = split(b);
      return { ok: acc.ok + s.ok, warn: acc.warn + s.warn, bad: acc.bad + s.bad };
    },
    { ok: 0, warn: 0, bad: 0 }
  );
  // Доли — от суммы диапазонов (она и есть склад), чтобы полоса всегда была полной.
  const sum = all.ok + all.warn + all.bad || total;
  const pct = (n: number) => (sum > 0 ? Math.round((n / sum) * 100) : 0);

  return (
    <DayCard
      tone="stock"
      icon="box"
      title="Сколько дней лежит"
      hint={`от даты срезки · срок хранения: ${shelfNote}`}
      link={{ href, label: "Весь склад →" }}
    >
      {/* Весь склад одной полосой: в сроке / скоро срок / дольше срока. */}
      <div className="px-4 sm:px-5 pt-4">
        <div className="flex h-2.5 rounded-full bg-surface-sunk overflow-hidden" role="img" aria-label={`В сроке ${pct(all.ok)} %, скоро срок ${pct(all.warn)} %, дольше срока ${pct(all.bad)} %`}>
          <div className="bg-status-good h-full" style={{ width: `${pct(all.ok)}%` }} />
          <div className="bg-status-warning h-full" style={{ width: `${pct(all.warn)}%` }} />
          <div className="bg-status-critical h-full" style={{ width: `${pct(all.bad)}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-ink-secondary">
          <Legend dot="ok" label="в сроке" value={all.ok} share={pct(all.ok)} />
          <Legend dot="warning" label="скоро срок" value={all.warn} share={pct(all.warn)} />
          <Legend dot="critical" label="дольше срока" value={all.bad} share={pct(all.bad)} strong={all.bad > 0} />
        </div>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 mt-4 border-t border-line-hairline">
        {buckets.map((b, i) => (
          <BucketColumn key={b.key} bucket={b} index={i} />
        ))}
      </div>
    </DayCard>
  );
}

function Legend({ dot, label, value, share, strong }: { dot: StorageStatus; label: string; value: number; share: number; strong?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 tabular-nums", strong && "text-status-critical font-semibold")}>
      <span className={clsx("w-2 h-2 rounded-full", DOT[dot])} aria-hidden />
      {label} <strong className={strong ? "" : "text-ink-primary"}>{num(value)}</strong>
      <span className="text-ink-muted">· {share} %</span>
    </span>
  );
}

function BucketColumn({ bucket, index }: { bucket: AgeBucketRow; index: number }) {
  const { ok, warn, bad } = split(bucket);
  const q = bucket.quantity;
  const empty = q === 0;
  const w = (n: number) => (q > 0 ? `${(n / q) * 100}%` : "0%");
  const caption = bad > 0 ? `дольше срока ${num(bad)}` : warn > 0 ? `скоро срок ${num(warn)}` : "всё в сроке";
  return (
    <div
      className={clsx(
        "px-4 sm:px-5 py-4 min-w-0",
        // Разделители: телефон — столбиком, планшет — 2×2, широкий экран — 4 в ряд.
        "border-line-hairline",
        index === 1 && "border-t sm:border-t-0 sm:border-l",
        index === 2 && "border-t xl:border-t-0 xl:border-l",
        index === 3 && "border-t sm:border-l xl:border-t-0"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{bucket.label}</span>
        {!empty && <span className="text-xs text-ink-muted tabular-nums">{Math.round(bucket.share * 100)} %</span>}
      </div>
      <div className={clsx("font-display font-extrabold text-[22px] tabular-nums leading-none mt-1.5", empty && "text-ink-muted")}>
        {num(q)} <span className="text-sm font-semibold text-ink-secondary">шт.</span>
      </div>
      {empty ? (
        <p className="text-xs text-ink-muted mt-3">пусто</p>
      ) : (
        <>
          <div className="flex h-1.5 rounded-full bg-surface-sunk overflow-hidden mt-3">
            <div className="bg-status-good h-full" style={{ width: w(ok) }} />
            <div className="bg-status-warning h-full" style={{ width: w(warn) }} />
            <div className="bg-status-critical h-full" style={{ width: w(bad) }} />
          </div>
          <div className={clsx("text-xs mt-1.5 font-semibold", bad > 0 ? "text-status-critical" : warn > 0 ? "text-[#8a5a00]" : "text-status-good")}>{caption}</div>
          <div className="mt-3 space-y-0.5">
            {bucket.flowers.map((f) => (
              <FlowerLine key={f.flowerType} flower={f} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function FlowerLine({ flower }: { flower: AgeBucketFlower }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-[calc(100%+0.75rem)] flex items-center gap-2 text-sm py-1 -mx-1.5 px-1.5 rounded-md hover:bg-surface-plane transition-colors"
      >
        <span className={clsx("w-2 h-2 rounded-full flex-none", DOT[flower.status])} aria-hidden />
        <span className="flex-1 text-left truncate">{FLOWER_TYPE_LABELS_PLURAL[flower.flowerType] ?? flower.flowerType}</span>
        <span className="tabular-nums font-semibold">{num(flower.quantity)}</span>
        <span className="text-[10px] text-ink-muted w-2.5 text-center" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <ul className="pl-4 pr-4 pb-1.5 pt-0.5 space-y-0.5">
          {flower.grades.map((g) => (
            <li key={g.grade} className="flex items-center gap-2 text-[13px] text-ink-secondary">
              <span className={clsx("w-1.5 h-1.5 rounded-full flex-none", DOT[g.status])} aria-hidden />
              <span className="flex-1 truncate">{formatGrade(g.grade)}</span>
              <span className="tabular-nums text-ink-primary">{num(g.quantity)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
