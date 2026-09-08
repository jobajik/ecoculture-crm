"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { FLOWER_TYPE_LABELS_PLURAL, farmLabel, formatGrade, getFarmFor } from "@/lib/constants";
import type { StockVarietyCard } from "@/lib/stock";
import { groupByGrade, type GradeCard, type GradeVarietyRow } from "@/lib/stockByGrade";
import type { StorageStatus } from "@/lib/shelfLife";
import MoreToggle, { COLLAPSED_LIST_SIZE } from "./MoreToggle";

/**
 * «Подробно по позициям» — блок по каждому цветку, строка по каждой РОСТОВКЕ
 * (длина у розы, категория у хризантемы и эустомы), сорта раскрываются по клику.
 *
 * Разрез именно такой, потому что так устроена торговля: клиент просит
 * шестидесятку или первую категорию, а каким кустом она выросла — вопрос
 * второй. Раньше наверху стоял сорт, и чтобы ответить «сколько всего
 * шестидесятки», приходилось складывать её по восемнадцати сортам вручную.
 *
 * Плоскую таблицу «ростовка × сорт» показывать нельзя: на настоящем складе это
 * под сотню строк. Поэтому цветок ушёл в заголовок блока, ростовка стала
 * строкой, а сорта спрятались внутрь.
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
const gradeWord = (n: number) => plural(n, "ростовка", "ростовки", "ростовок");

const fmt = (n: number) => n.toLocaleString("ru-RU");

/** Плашка «сколько дней лежит»: один вид на телефоне и на компьютере. */
function ageChipClass(status: StorageStatus): string {
  return clsx(
    "rounded-full px-2 py-0.5 text-xs font-medium tabular-nums whitespace-nowrap",
    STATUS_CHIP[status],
    STATUS_TEXT[status]
  );
}

/** «Prestige, Avalanche и ещё 4» — чтобы строка не разбухала. */
function varietyHint(varieties: GradeVarietyRow[]): string {
  const names = varieties.map((v) => v.variety);
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
    const all = groupByGrade(varieties);
    return visible
      .map((flowerType) => {
        const cards = all
          .filter((c) => c.flowerType === flowerType)
          .filter(
            (c) =>
              !query ||
              formatGrade(c.grade).toLowerCase().includes(query) ||
              c.varieties.some((v) => v.variety.toLowerCase().includes(query))
          );
        return {
          flowerType,
          cards,
          total: cards.reduce((s, c) => s + c.totalQuantity, 0),
          varietyCount: new Set(cards.flatMap((c) => c.varieties.map((v) => v.variety))).size,
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
            — по ростовке, сверху то, что нужно продать раньше
          </span>
        </h3>
        <input
          className="input w-full sm:!w-auto sm:min-w-[220px]"
          placeholder="Поиск по ростовке или сорту"
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
              varietyCount={group.varietyCount}
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
        <span className={STATUS_TEXT.critical}>красный — просрочено</span>. Нажмите на ростовку,
        чтобы увидеть сорта.
      </p>
    </div>
  );
}

function FlowerGroup({
  flowerType,
  cards,
  total,
  varietyCount,
  worst,
  forceOpen,
}: {
  flowerType: string;
  cards: GradeCard[];
  total: number;
  varietyCount: number;
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
            {gradeWord(cards.length)} · {varietyCount} {varietyWord(varietyCount)}
            {worst !== "ok" && (
              <span className={clsx("ml-2 font-medium", STATUS_TEXT[worst])}>
                {STATUS_LABEL[worst]}
              </span>
            )}
          </div>
        </div>

        <div className="divide-y divide-line-hairline border-t border-line-hairline">
          {shown.map((card) => (
            <GradeRow key={card.key} card={card} groupTotal={total} forceOpen={forceOpen} />
          ))}
        </div>

        {(hidden > 0 || (expanded && !forceOpen)) && (
          <div className="px-4 py-2 border-t border-line-hairline">
            <MoreToggle
              expanded={expanded}
              hidden={hidden}
              onToggle={() => setExpanded((v) => !v)}
              what={gradeWord(hidden)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function GradeRow({
  card,
  groupTotal,
  forceOpen,
}: {
  card: GradeCard;
  groupTotal: number;
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Ростовку с единственным сортом раскрывать нечего: строка внутри повторила бы
  // строку снаружи. Такая строка не кликается и стрелки не показывает.
  const expandable = card.varieties.length > 1;
  const shown = expandable && (open || forceOpen);
  const fill = card.maxDays > 0 ? Math.min(100, (card.oldestDays / card.maxDays) * 100) : 0;
  const spread = card.oldestDays !== card.newestDays;
  const share = groupTotal > 0 ? Math.round((card.totalQuantity / groupTotal) * 100) : 0;

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

        {/* На телефоне названию ростовки нужна вся ширина строки, поэтому цифры
            уходят к нему в пару: количество — к названию, срок — к сортам.
            На компьютере всё возвращается в одну строку колонками. */}
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-2">
            <span className="font-medium truncate flex-1">{formatGrade(card.grade)}</span>
            <span className="sm:hidden tabular-nums font-semibold shrink-0">
              {fmt(card.totalQuantity)}
            </span>
          </span>
          <span className="flex items-baseline gap-2">
            <span className="text-xs text-ink-muted truncate flex-1">
              {varietyHint(card.varieties)}
            </span>
            <span className={clsx("sm:hidden shrink-0", ageChipClass(card.status))}>
              {spread ? `${card.newestDays}–${card.oldestDays}` : card.oldestDays}{" "}
              {dayWord(card.oldestDays)}
            </span>
          </span>
        </span>

        <span className="hidden sm:block tabular-nums font-semibold text-right w-20 shrink-0">
          {fmt(card.totalQuantity)}
        </span>

        {/* Доля ростовки в цветке: главный смысл этого разреза — какой длины
            склад состоит на самом деле. */}
        <span className="hidden md:block text-[11px] text-ink-muted tabular-nums w-10 text-right shrink-0">
          {share}%
        </span>

        <span className={clsx("hidden sm:inline-block w-24 text-center", ageChipClass(card.status))}>
          {spread ? `${card.newestDays}–${card.oldestDays}` : card.oldestDays}{" "}
          {dayWord(card.oldestDays)}
        </span>

        <span className="hidden sm:flex items-center gap-2 w-32 shrink-0">
          <span className="h-1.5 flex-1 rounded-full bg-surface-plane overflow-hidden">
            <span
              className={clsx("h-full rounded-full block", STATUS_BAR[card.status])}
              style={{ width: `${Math.max(4, fill)}%` }}
            />
          </span>
          <span className={clsx("text-[11px] tabular-nums", STATUS_TEXT[card.status])}>
            {card.oldestDays}/{card.maxDays}
          </span>
        </span>
      </button>

      {shown && (
        <div className="px-4 pb-2 pl-9">
          <table className="w-full text-sm">
            <tbody>
              {card.varieties.map((v) => {
                const vFill = v.maxDays > 0 ? Math.min(100, (v.oldestDays / v.maxDays) * 100) : 0;
                const vSpread = v.oldestDays !== v.newestDays;
                return (
                  <tr key={v.variety} className="text-ink-secondary">
                    <td className="py-1">{v.variety}</td>
                    <td className="py-1 text-right tabular-nums w-20 text-ink-primary">
                      {fmt(v.quantity)}
                    </td>
                    <td className="py-1 text-center tabular-nums w-24 text-xs whitespace-nowrap">
                      {vSpread ? `${v.newestDays}–${v.oldestDays}` : v.oldestDays}{" "}
                      {dayWord(v.oldestDays)}
                    </td>
                    <td className="py-1 w-32">
                      <span className="hidden sm:flex items-center gap-2">
                        <span className="h-1 flex-1 rounded-full bg-surface-plane overflow-hidden">
                          <span
                            className={clsx("h-full rounded-full block", STATUS_BAR[v.status])}
                            style={{ width: `${Math.max(4, vFill)}%` }}
                          />
                        </span>
                        <span className={clsx("text-[11px] tabular-nums", STATUS_TEXT[v.status])}>
                          {v.oldestDays}/{v.maxDays}
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
