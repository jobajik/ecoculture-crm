"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { FLOWER_TYPE_LABELS_PLURAL, farmLabel, formatGrade, getFarmFor } from "@/lib/constants";
import type { StockGradeRow, StockVarietyCard } from "@/lib/stock";
import type { StorageStatus } from "@/lib/shelfLife";
import MoreToggle, { COLLAPSED_LIST_SIZE } from "./MoreToggle";

/**
 * «Подробно по позициям» — блок по каждому цветку, строка по каждому сорту,
 * длины раскрываются по клику.
 *
 * Плоская таблица «сорт × длина» на настоящем складе даёт сотню строк, в
 * которых слово «Розы» повторяется сто раз, а Prestige — шесть. Читать это
 * невозможно. Поэтому цветок ушёл в заголовок блока, сорт стал строкой, а
 * длины спрятались внутрь сорта: на верхнем уровне остаётся два десятка строк
 * вместо сотни, и видно главное — сколько какого сорта и насколько он свежий.
 *
 * Цвет цветка (полоска слева, точка в заголовке) — только чтобы блоки не
 * сливались. Он приглушённый и намеренно далёк от зелёного/жёлтого/красного:
 * означать что-то должен ТОЛЬКО статус хранения, иначе пёстрая страница
 * перестаёт предупреждать.
 */

const FLOWER_ORDER = ["rose", "chrysanthemum", "eustoma"];

/** Классы держим строками целиком: Tailwind собирает css по тексту файлов. */
const FLOWER_ACCENT: Record<string, { bar: string; dot: string; head: string }> = {
  rose: { bar: "bg-flower-rose", dot: "bg-flower-rose", head: "bg-flower-rose/[0.05]" },
  chrysanthemum: {
    bar: "bg-flower-chrysanthemum",
    dot: "bg-flower-chrysanthemum",
    head: "bg-flower-chrysanthemum/[0.05]",
  },
  eustoma: {
    bar: "bg-flower-eustoma",
    dot: "bg-flower-eustoma",
    head: "bg-flower-eustoma/[0.05]",
  },
};

const STATUS_LABEL: Record<StorageStatus, string> = {
  ok: "в порядке",
  warning: "скоро истечёт",
  critical: "просрочено",
  depleted: "закончилось",
};

const STATUS_TEXT: Record<StorageStatus, string> = {
  ok: "text-status-good",
  warning: "text-[#8a5a00]",
  critical: "text-status-critical",
  depleted: "text-ink-muted",
};

const STATUS_BAR: Record<StorageStatus, string> = {
  ok: "bg-status-good",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
  depleted: "bg-ink-muted",
};

const STATUS_CHIP: Record<StorageStatus, string> = {
  ok: "bg-status-good/10",
  warning: "bg-status-warning/15",
  critical: "bg-status-critical/15",
  depleted: "bg-surface-plane",
};

const STATUS_ORDER: Record<StorageStatus, number> = {
  critical: 0,
  warning: 1,
  ok: 2,
  depleted: 3,
};

function plural(n: number, one: string, few: string, many: string) {
  const t = Math.abs(n) % 100;
  const o = t % 10;
  if (t > 10 && t < 20) return many;
  if (o > 1 && o < 5) return few;
  if (o === 1) return one;
  return many;
}
const dayWord = (n: number) => plural(n, "день", "дня", "дней");
const varietyWord = (n: number) => plural(n, "сорт", "сорта", "сортов");
const positionWord = (n: number) => plural(n, "позиция", "позиции", "позиций");

const fmt = (n: number) => n.toLocaleString("ru-RU");

/** Плашка «сколько дней лежит»: один вид на телефоне и на компьютере. */
function ageChipClass(status: StorageStatus): string {
  return clsx(
    "rounded-full px-2 py-0.5 text-xs font-medium tabular-nums whitespace-nowrap",
    STATUS_CHIP[status],
    STATUS_TEXT[status]
  );
}

/** Что показать про сорт одной строкой: сколько дней лежит и худший статус. */
function summarize(card: StockVarietyCard) {
  const oldest = Math.max(...card.grades.map((g) => g.oldestDays), 0);
  const newest = Math.min(...card.grades.map((g) => g.newestDays), oldest);
  const maxDays = Math.max(...card.grades.map((g) => g.maxDays), 1);
  return { oldest, newest, maxDays, fill: Math.min(100, (oldest / maxDays) * 100) };
}

/** «40 см, 50 см, 60 см» или «40 см, 50 см и ещё 4» — чтобы строка не разбухала. */
function gradeHint(grades: StockGradeRow[]): string {
  const names = grades.map((g) => formatGrade(g.grade));
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} и ещё ${names.length - 2}`;
}

export default function StockDetail({
  varieties,
  allowedTypes,
  emptyHint,
}: {
  varieties: StockVarietyCard[];
  allowedTypes?: string[];
  /** Что написать, когда склад пуст совсем. */
  emptyHint: string;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();

  const groups = useMemo(() => {
    const visible = FLOWER_ORDER.filter((t) => !allowedTypes || allowedTypes.includes(t));
    return visible
      .map((flowerType) => {
        const cards = varieties
          .filter((c) => c.flowerType === flowerType)
          .filter(
            (c) =>
              !query ||
              c.variety.toLowerCase().includes(query) ||
              c.grades.some((g) => formatGrade(g.grade).toLowerCase().includes(query))
          )
          // Сверху то, что нужно продать раньше: сначала статус, потом доля
          // прожитого срока, потом объём.
          .sort((a, b) => {
            const sa = summarize(a);
            const sb = summarize(b);
            return (
              STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
              sb.oldest / sb.maxDays - sa.oldest / sa.maxDays ||
              b.totalQuantity - a.totalQuantity
            );
          });
        return {
          flowerType,
          cards,
          total: cards.reduce((s, c) => s + c.totalQuantity, 0),
          positions: cards.reduce((s, c) => s + c.grades.length, 0),
          worst: cards.reduce<StorageStatus>(
            (worst, c) => (STATUS_ORDER[c.status] < STATUS_ORDER[worst] ? c.status : worst),
            "ok"
          ),
        };
      })
      .filter((g) => g.cards.length > 0);
  }, [varieties, allowedTypes, query]);

  const nothingFound = groups.length === 0;

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
        <h3 className="font-medium">
          Подробно по позициям
          <span className="text-sm font-normal text-ink-muted">
            {" "}
            — сверху то, что нужно продать раньше
          </span>
        </h3>
        <input
          className="input w-full sm:!w-auto sm:min-w-[220px]"
          placeholder="Поиск по сорту или длине"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {nothingFound ? (
        <div className="card text-sm text-ink-muted py-8 text-center">
          {query ? "По этому запросу ничего не нашлось." : emptyHint}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <FlowerGroup
              key={group.flowerType}
              flowerType={group.flowerType}
              cards={group.cards}
              total={group.total}
              positions={group.positions}
              worst={group.worst}
              /* При поиске разворачиваем всё: человек сузил список сам. */
              forceOpen={query.length > 0}
            />
          ))}
        </div>
      )}

      <p className="text-xs text-ink-muted mt-2">
        «Лежит» — дней с даты срезки. Полоса — сколько прошло из положенного срока:{" "}
        <span className={STATUS_TEXT.warning}>жёлтый — скоро истечёт</span>,{" "}
        <span className={STATUS_TEXT.critical}>красный — просрочено</span>. Нажмите на сорт, чтобы
        увидеть длины.
      </p>
    </div>
  );
}

function FlowerGroup({
  flowerType,
  cards,
  total,
  positions,
  worst,
  forceOpen,
}: {
  flowerType: string;
  cards: StockVarietyCard[];
  total: number;
  positions: number;
  worst: StorageStatus;
  forceOpen: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const accent = FLOWER_ACCENT[flowerType] ?? FLOWER_ACCENT.rose;

  const shown = expanded || forceOpen ? cards : cards.slice(0, COLLAPSED_LIST_SIZE);
  const hidden = cards.length - shown.length;

  return (
    <div className="card !p-0 overflow-hidden flex">
      {/* Полоска цвета цветка — единственное место, где он вообще виден. */}
      <div className={clsx("w-1 shrink-0", accent.bar)} aria-hidden />

      <div className="flex-1 min-w-0">
        <div
          className={clsx(
            "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5",
            accent.head
          )}
        >
          <div className="flex items-baseline gap-2 min-w-0">
            <span className={clsx("w-2 h-2 rounded-full shrink-0 translate-y-[-1px]", accent.dot)} />
            <h4 className="font-semibold">
              {FLOWER_TYPE_LABELS_PLURAL[flowerType] ?? flowerType}
            </h4>
            <span className="text-xs text-ink-muted truncate">
              {farmLabel(getFarmFor(flowerType))}
            </span>
          </div>
          <div className="text-sm text-ink-secondary tabular-nums">
            <b className="text-ink-primary">{fmt(total)}</b> шт · {cards.length}{" "}
            {varietyWord(cards.length)} · {positions} {positionWord(positions)}
            {worst !== "ok" && (
              <span className={clsx("ml-2 font-medium", STATUS_TEXT[worst])}>
                {STATUS_LABEL[worst]}
              </span>
            )}
          </div>
        </div>

        <div className="divide-y divide-line-hairline border-t border-line-hairline">
          {shown.map((card) => (
            <VarietyRow key={card.key} card={card} forceOpen={forceOpen} />
          ))}
        </div>

        {(hidden > 0 || (expanded && !forceOpen)) && (
          <div className="px-4 py-2 border-t border-line-hairline">
            <MoreToggle
              expanded={expanded}
              hidden={hidden}
              onToggle={() => setExpanded((v) => !v)}
              what={varietyWord(hidden)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function VarietyRow({ card, forceOpen }: { card: StockVarietyCard; forceOpen: boolean }) {
  const [open, setOpen] = useState(false);
  // У сорта с единственной длиной раскрывать нечего: строка внутри повторила бы
  // строку снаружи. Такой сорт не кликается и стрелки не показывает.
  const expandable = card.grades.length > 1;
  const shown = expandable && (open || forceOpen);
  const { oldest, newest, maxDays, fill } = summarize(card);
  const spread = oldest !== newest;

  return (
    <div>
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        disabled={!expandable}
        className={clsx(
          "w-full text-left px-4 py-2.5 sm:py-2 flex items-center gap-3 transition-colors",
          expandable ? "hover:bg-surface-plane" : "cursor-default"
        )}
        aria-expanded={expandable ? shown : undefined}
      >
        <span className="text-[10px] text-ink-muted w-2 shrink-0" aria-hidden>
          {expandable ? (shown ? "▲" : "▼") : ""}
        </span>

        {/* На телефоне названию сорта нужна вся ширина строки, поэтому цифры
            уходят к нему в пару: количество — к названию, срок — к длинам.
            На компьютере всё возвращается в одну строку колонками. */}
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-2">
            <span className="font-medium truncate flex-1">{card.variety}</span>
            <span className="sm:hidden tabular-nums font-semibold shrink-0">
              {fmt(card.totalQuantity)}
            </span>
          </span>
          <span className="flex items-baseline gap-2">
            <span className="text-xs text-ink-muted truncate flex-1">
              {gradeHint(card.grades)}
            </span>
            <span className={clsx("sm:hidden shrink-0", ageChipClass(card.status))}>
              {spread ? `${newest}–${oldest}` : oldest} {dayWord(oldest)}
            </span>
          </span>
        </span>

        <span className="hidden sm:block tabular-nums font-semibold text-right w-20 shrink-0">
          {fmt(card.totalQuantity)}
        </span>

        <span className={clsx("hidden sm:inline-block w-24 text-center", ageChipClass(card.status))}>
          {spread ? `${newest}–${oldest}` : oldest} {dayWord(oldest)}
        </span>

        <span className="hidden sm:flex items-center gap-2 w-32 shrink-0">
          <span className="h-1.5 flex-1 rounded-full bg-surface-plane overflow-hidden">
            <span
              className={clsx("h-full rounded-full block", STATUS_BAR[card.status])}
              style={{ width: `${Math.max(4, fill)}%` }}
            />
          </span>
          <span className={clsx("text-[11px] tabular-nums", STATUS_TEXT[card.status])}>
            {oldest}/{maxDays}
          </span>
        </span>
      </button>

      {shown && (
        <div className="px-4 pb-2 pl-9">
          <table className="w-full text-sm">
            <tbody>
              {card.grades.map((g) => {
                const gradeFill = g.maxDays > 0 ? Math.min(100, (g.oldestDays / g.maxDays) * 100) : 0;
                const gradeSpread = g.oldestDays !== g.newestDays;
                return (
                  <tr key={g.grade} className="text-ink-secondary">
                    <td className="py-1">{formatGrade(g.grade)}</td>
                    <td className="py-1 text-right tabular-nums w-20 text-ink-primary">
                      {fmt(g.quantity)}
                    </td>
                    <td className="py-1 text-center tabular-nums w-24 text-xs whitespace-nowrap">
                      {gradeSpread ? `${g.newestDays}–${g.oldestDays}` : g.oldestDays}{" "}
                      {dayWord(g.oldestDays)}
                    </td>
                    <td className="py-1 w-32">
                      <span className="hidden sm:flex items-center gap-2">
                        <span className="h-1 flex-1 rounded-full bg-surface-plane overflow-hidden">
                          <span
                            className={clsx("h-full rounded-full block", STATUS_BAR[g.status])}
                            style={{ width: `${Math.max(4, gradeFill)}%` }}
                          />
                        </span>
                        <span className={clsx("text-[11px] tabular-nums", STATUS_TEXT[g.status])}>
                          {g.oldestDays}/{g.maxDays}
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
