"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import {
  FLOWER_TYPE_LABELS_PLURAL,
  FLOWER_TYPES_BY_FARM,
  FARM_ORDER,
  farmLabel,
  formatGrade,
  getFarmFor,
} from "@/lib/constants";
import type { StockSnapshot, StockVarietyCard } from "@/lib/stock";
import type { StorageStatus } from "@/lib/shelfLife";

const REFRESH_MS = 45_000;

/** Порядок колонок на витрине: роза, хризантема, эустома. */
const COLUMN_ORDER = ["rose", "chrysanthemum", "eustoma"];

// Статус — это состояние, а не категория, поэтому цвет резервный и всегда
// сопровождается словами: на печати и при дальтонизме цвет не читается.
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

const STATUS_DOT: Record<StorageStatus, string> = {
  ok: "bg-status-good",
  warning: "bg-status-warning",
  critical: "bg-status-critical",
  depleted: "bg-ink-muted",
};

const STATUS_ORDER: Record<StorageStatus, number> = {
  critical: 0,
  warning: 1,
  ok: 2,
  depleted: 3,
};

/** Русское склонение: 1 день, 2 дня, 5 дней. */
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
const batchWord = (n: number) => plural(n, "партия", "партии", "партий");

/** 1.0 -> «1», 1.4 -> «1.4» — лишний ноль в тексте мешает читать. */
function neatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function relativeTime(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return "только что";
  if (seconds < 60) return `${seconds} сек. назад`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин. назад`;
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

interface DetailRow {
  key: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  oldestDays: number;
  newestDays: number;
  maxDays: number;
  status: StorageStatus;
  batches: number;
}

export default function StockBoard({
  initial,
  allowedTypes,
}: {
  initial: StockSnapshot;
  /**
   * Какие типы цветка показывать колонками. Зав. складом получает только свои —
   * пустая колонка «Розы» на её экране это тоже чужая информация и лишний шум.
   */
  allowedTypes?: string[];
}) {
  const [snapshot, setSnapshot] = useState<StockSnapshot>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stock", { cache: "no-store" });
      if (!res.ok) throw new Error("Не удалось обновить остатки");
      setSnapshot((await res.json()) as StockSnapshot);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка обновления");
    } finally {
      setLoading(false);
      setTick(Date.now());
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(refresh, REFRESH_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  /** Колонки — по одной на тип цветка, всегда все три, чтобы вид не «прыгал». */
  const columns = useMemo(() => {
    const byType = new Map<string, StockVarietyCard[]>();
    for (const card of snapshot.varieties) {
      const list = byType.get(card.flowerType) ?? [];
      list.push(card);
      byType.set(card.flowerType, list);
    }
    const visible = COLUMN_ORDER.filter((t) => !allowedTypes || allowedTypes.includes(t));
    return visible.map((type) => {
      const cards = (byType.get(type) ?? []).sort((a, b) => b.totalQuantity - a.totalQuantity);
      return {
        type,
        farm: getFarmFor(type),
        cards,
        total: cards.reduce((s, c) => s + c.totalQuantity, 0),
        batches: cards.reduce((s, c) => s + c.grades.reduce((x, g) => x + g.batches, 0), 0),
        worst: cards.reduce<StorageStatus>(
          (worst, c) => (STATUS_ORDER[c.status] < STATUS_ORDER[worst] ? c.status : worst),
          "ok"
        ),
      };
    });
  }, [snapshot.varieties, allowedTypes]);

  /** Нижний список — плоская таблица «сорт + длина», сначала самое срочное. */
  const details = useMemo(() => {
    const rows: DetailRow[] = [];
    for (const card of snapshot.varieties) {
      for (const g of card.grades) {
        rows.push({
          key: `${card.key}:${g.grade}`,
          flowerType: card.flowerType,
          variety: card.variety,
          grade: g.grade,
          quantity: g.quantity,
          oldestDays: g.oldestDays,
          newestDays: g.newestDays,
          maxDays: g.maxDays,
          status: g.status,
          batches: g.batches,
        });
      }
    }
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => !q || r.variety.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          b.oldestDays / Math.max(1, b.maxDays) - a.oldestDays / Math.max(1, a.maxDays) ||
          b.quantity - a.quantity
      );
  }, [snapshot.varieties, search]);

  const atRisk = snapshot.warningStems + snapshot.criticalStems;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Остатки на складе
          <span className="relative flex h-2 w-2" title="Обновляется автоматически">
            <span className="absolute inline-flex h-full w-full rounded-full bg-status-good opacity-60 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-status-good" />
          </span>
        </h2>
        <div className="flex items-center gap-3 text-sm text-ink-muted">
          <span>{loading ? "Обновляю…" : `Обновлено ${relativeTime(snapshot.generatedAt, tick)}`}</span>
          {error && <span className="text-status-critical">{error}</span>}
          <button onClick={refresh} disabled={loading} className="btn-secondary !py-1 !px-2.5 text-xs">
            ↻
          </button>
        </div>
      </div>

      {/* Сводка одной строкой вместо четырёх крупных плиток */}
      <div className="card !py-3 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
        <span>
          <b className="text-xl tabular-nums">{snapshot.totalStems.toLocaleString("ru-RU")}</b>
          <span className="text-ink-secondary"> шт. всего</span>
        </span>
        <span className="text-ink-secondary">
          {snapshot.varietyCount} {varietyWord(snapshot.varietyCount)} · {snapshot.totalBatches}{" "}
          {batchWord(snapshot.totalBatches)}
        </span>
        <span className="text-ink-secondary">
          средний возраст{" "}
          <b className="text-ink-primary tabular-nums">{neatNumber(snapshot.avgAgeDays)}</b>{" "}
          {dayWord(Math.round(snapshot.avgAgeDays))}
        </span>
        {snapshot.warningStems > 0 && (
          <span className={STATUS_TEXT.warning}>
            <b className="tabular-nums">{snapshot.warningStems.toLocaleString("ru-RU")}</b> шт. скоро
            истекут
          </span>
        )}
        {snapshot.criticalStems > 0 && (
          <span className={STATUS_TEXT.critical}>
            <b className="tabular-nums">{snapshot.criticalStems.toLocaleString("ru-RU")}</b> шт.
            просрочено
          </span>
        )}
        {atRisk === 0 && snapshot.totalStems > 0 && (
          <span className={STATUS_TEXT.ok}>весь цветок в сроке</span>
        )}
      </div>

      {/* Три колонки: роза · хризантема · эустома */}
      <div
        className={clsx(
          "grid gap-3",
          columns.length >= 3 ? "md:grid-cols-3" : columns.length === 2 ? "md:grid-cols-2" : ""
        )}
      >
        {columns.map((col) => (
          <div key={col.type} className="card !p-4">
            <div className="flex items-baseline justify-between gap-2 pb-2 mb-2 border-b border-line-hairline">
              <div className="min-w-0">
                <h3 className="font-semibold">{FLOWER_TYPE_LABELS_PLURAL[col.type] ?? col.type}</h3>
                <div className="text-[11px] text-ink-muted truncate">{farmLabel(col.farm)}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xl font-semibold tabular-nums leading-none">
                  {col.total.toLocaleString("ru-RU")}
                </div>
                <div className="text-[11px] text-ink-muted">шт.</div>
              </div>
            </div>

            {col.cards.length === 0 ? (
              <p className="text-sm text-ink-muted py-2">Нет на складе</p>
            ) : (
              <>
                <ul className="space-y-1.5">
                  {col.cards.map((card) => (
                    <li key={card.key} className="flex items-baseline gap-2 text-sm">
                      <span
                        className={clsx("w-2 h-2 rounded-full shrink-0", STATUS_DOT[card.status])}
                        title={STATUS_LABEL[card.status]}
                      />
                      <span className="truncate flex-1" title={card.variety}>
                        {card.variety}
                      </span>
                      <span className="tabular-nums font-medium shrink-0">
                        {card.totalQuantity.toLocaleString("ru-RU")}
                      </span>
                      <span
                        className={clsx("text-[11px] tabular-nums shrink-0 w-12 text-right", STATUS_TEXT[card.status])}
                        title={`Самая старая партия: ${card.oldestDays} дн.`}
                      >
                        {card.oldestDays} дн.
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="text-[11px] text-ink-muted mt-2 pt-2 border-t border-line-hairline">
                  {col.cards.length} {varietyWord(col.cards.length)} · {col.batches}{" "}
                  {batchWord(col.batches)}
                  {col.worst !== "ok" && (
                    <span className={clsx(" · ", STATUS_TEXT[col.worst])}>{STATUS_LABEL[col.worst]}</span>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Подробный список — сначала то, что горит */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="font-medium">
            Подробно по позициям
            <span className="text-sm font-normal text-ink-muted"> — сверху то, что нужно продать раньше</span>
          </h3>
          <input
            className="input !w-auto !py-1.5 min-w-[180px]"
            placeholder="Поиск по сорту"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line-hairline">
                <th className="px-4 py-2.5 font-medium">Цветок</th>
                <th className="px-4 py-2.5 font-medium">Сорт</th>
                <th className="px-4 py-2.5 font-medium">Длина / кат.</th>
                <th className="px-4 py-2.5 font-medium text-right">Осталось</th>
                <th className="px-4 py-2.5 font-medium text-right">Лежит</th>
                <th className="px-4 py-2.5 font-medium w-40">Срок хранения</th>
              </tr>
            </thead>
            <tbody>
              {details.map((r) => {
                const fill = r.maxDays > 0 ? Math.min(100, (r.oldestDays / r.maxDays) * 100) : 0;
                const spread = r.oldestDays !== r.newestDays;
                return (
                  <tr
                    key={r.key}
                    className={clsx(
                      "border-b border-line-hairline last:border-0 hover:bg-surface-plane",
                      r.status === "critical" && "bg-status-critical/5"
                    )}
                  >
                    <td className="px-4 py-2 text-ink-secondary whitespace-nowrap">
                      {FLOWER_TYPE_LABELS_PLURAL[r.flowerType] ?? r.flowerType}
                    </td>
                    <td className="px-4 py-2 font-medium">{r.variety}</td>
                    <td className="px-4 py-2 text-ink-secondary whitespace-nowrap">
                      {formatGrade(r.grade)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium whitespace-nowrap">
                      {r.quantity.toLocaleString("ru-RU")}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap text-ink-secondary">
                      {spread ? `${r.newestDays}–${r.oldestDays}` : r.oldestDays} {dayWord(r.oldestDays)}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-surface-plane overflow-hidden min-w-[48px]">
                          <div
                            className={clsx("h-full rounded-full", STATUS_BAR[r.status])}
                            style={{ width: `${Math.max(4, fill)}%` }}
                          />
                        </div>
                        <span
                          className={clsx("text-[11px] whitespace-nowrap tabular-nums", STATUS_TEXT[r.status])}
                        >
                          {r.oldestDays}/{r.maxDays}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {details.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">
                    {snapshot.totalStems === 0
                      ? "На складе пусто. Как только зав. складом оформит приёмку, остатки появятся здесь."
                      : "По этому сорту ничего не нашлось."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-ink-muted mt-2">
          «Лежит» — дней с даты срезки. «Срок хранения» — сколько прошло из положенного:{" "}
          <span className={STATUS_TEXT.warning}>жёлтый — скоро истечёт</span>,{" "}
          <span className={STATUS_TEXT.critical}>красный — просрочено</span>.
        </p>
      </div>

      {/* Разбивка по производствам — только когда видно оба */}
      {snapshot.byFarm.length > 1 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-secondary">
          {FARM_ORDER.filter((f) => snapshot.byFarm.some((x) => x.farm === f)).map((f) => {
            const row = snapshot.byFarm.find((x) => x.farm === f)!;
            return (
              <span key={f}>
                {farmLabel(f)}{" "}
                <b className="text-ink-primary tabular-nums">
                  {row.quantity.toLocaleString("ru-RU")}
                </b>{" "}
                шт.
                <span className="text-ink-muted">
                  {" "}
                  ({FLOWER_TYPES_BY_FARM[f]?.map((t) => FLOWER_TYPE_LABELS_PLURAL[t]).join(", ")})
                </span>
              </span>
            );
          })}
        </div>
      )}
    </section>
  );
}
