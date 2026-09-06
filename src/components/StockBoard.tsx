"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { FARM_ORDER, FLOWER_TYPE_LABELS, FLOWER_TYPES_BY_FARM, farmLabel, formatGrade } from "@/lib/constants";
import type { StockGradeRow, StockSnapshot, StockVarietyCard } from "@/lib/stock";
import type { StorageStatus } from "@/lib/shelfLife";

const REFRESH_MS = 45_000;

/** Порядок секций на витрине. */
const FLOWER_TYPE_ORDER = ["rose", "chrysanthemum", "eustoma"];

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

const STATUS_RING: Record<StorageStatus, string> = {
  ok: "border-line-hairline",
  warning: "border-status-warning/50",
  critical: "border-status-critical/50",
  depleted: "border-line-hairline",
};

function dayWord(days: number) {
  const n = Math.abs(days) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return "дней";
  if (n1 > 1 && n1 < 5) return "дня";
  if (n1 === 1) return "день";
  return "дней";
}

function relativeTime(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return "только что";
  if (seconds < 60) return `${seconds} сек. назад`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин. назад`;
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export default function StockBoard({ initial }: { initial: StockSnapshot }) {
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
      const data = (await res.json()) as StockSnapshot;
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка обновления");
    } finally {
      setLoading(false);
      setTick(Date.now());
    }
  }, []);

  // Автообновление + обновление при возврате на вкладку.
  useEffect(() => {
    const interval = setInterval(refresh, REFRESH_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  // Отдельный таймер, чтобы надпись «обновлено N назад» шла сама.
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  const visibleVarieties = useMemo(() => {
    const query = search.trim().toLowerCase();
    return snapshot.varieties.filter(
      (v) => !query || v.variety.toLowerCase().includes(query)
    );
  }, [snapshot.varieties, search]);

  /** Раскладываем карточки по типам цветка — каждый тип показывается своей секцией. */
  const byType = useMemo(() => {
    const map = new Map<string, StockVarietyCard[]>();
    for (const card of visibleVarieties) {
      const list = map.get(card.flowerType) ?? [];
      list.push(card);
      map.set(card.flowerType, list);
    }
    return map;
  }, [visibleVarieties]);

  const atRisk = snapshot.warningStems + snapshot.criticalStems;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Остатки на складе
            <span className="relative flex h-2 w-2" title="Обновляется автоматически">
              <span className="absolute inline-flex h-full w-full rounded-full bg-status-good opacity-60 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-status-good" />
            </span>
          </h2>
          <p className="text-sm text-ink-muted">
            {loading ? "Обновляю…" : `Обновлено ${relativeTime(snapshot.generatedAt, tick)}`}
            {error && <span className="text-status-critical"> · {error}</span>}
          </p>
        </div>
        <button onClick={refresh} disabled={loading} className="btn-secondary !py-1.5">
          ↻ Обновить
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile
          label="Всего на складе"
          value={snapshot.totalStems.toLocaleString("ru-RU")}
          unit="шт"
          sub={`${snapshot.varietyCount} сортов · ${snapshot.totalBatches} партий`}
        />
        <Tile
          label="Средний возраст"
          value={snapshot.avgAgeDays.toFixed(1)}
          unit={dayWord(Math.round(snapshot.avgAgeDays))}
          sub="взвешенный по количеству"
        />
        <Tile
          label="Требует внимания"
          value={snapshot.warningStems.toLocaleString("ru-RU")}
          unit="шт"
          sub="подходит к концу срока"
          tone={snapshot.warningStems > 0 ? "warning" : "ok"}
        />
        <Tile
          label="Просрочено"
          value={snapshot.criticalStems.toLocaleString("ru-RU")}
          unit="шт"
          sub="срок хранения вышел"
          tone={snapshot.criticalStems > 0 ? "critical" : "ok"}
        />
      </div>

      {snapshot.urgent.length > 0 && (
        <div className="card border-status-warning/40">
          <h3 className="font-medium mb-1">Продать в первую очередь</h3>
          <p className="text-xs text-ink-muted mb-3">
            {atRisk.toLocaleString("ru-RU")} шт. в партиях, которые дольше всего лежат на складе
          </p>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
            {snapshot.urgent.map((row) => (
              <div key={row.batchId} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">
                  <span className="text-ink-muted">{FLOWER_TYPE_LABELS[row.flowerType]}</span>{" "}
                  <b>{row.variety}</b>{" "}
                  <span className="text-ink-secondary">{formatGrade(row.grade)}</span>
                </span>
                <span className="flex items-baseline gap-3 shrink-0 tabular-nums">
                  <span className="text-ink-secondary">{row.quantity.toLocaleString("ru-RU")} шт.</span>
                  <span className={clsx("font-medium", STATUS_TEXT[row.status])}>
                    {row.daysInStorage} / {row.maxDays} дн.
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input !w-auto flex-1 min-w-[200px] !py-1.5"
          placeholder="Поиск по сорту"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {snapshot.byFarm.length > 1 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {FARM_ORDER.filter((f) => snapshot.byFarm.some((x) => x.farm === f)).map((f) => {
            const row = snapshot.byFarm.find((x) => x.farm === f)!;
            return (
              <div key={f} className="card !p-4 flex items-baseline justify-between">
                <div>
                  <div className="font-medium">{farmLabel(f)}</div>
                  <div className="text-xs text-ink-muted">
                    {FLOWER_TYPES_BY_FARM[f]?.map((t) => FLOWER_TYPE_LABELS[t]).join(" · ")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-semibold tabular-nums">
                    {row.quantity.toLocaleString("ru-RU")}
                  </div>
                  <div className="text-xs text-ink-muted">шт. · {row.batches} партий</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {snapshot.totalStems === 0 ? (
        <div className="card text-center py-10">
          <div className="text-2xl mb-2">📦</div>
          <p className="font-medium">На складе пока пусто</p>
          <p className="text-sm text-ink-secondary mt-1">
            Как только зав. складом оформит приёмку с производства, остатки появятся здесь.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {FLOWER_TYPE_ORDER.filter((type) => byType.get(type)?.length).map((type) => {
            const cards = byType.get(type) ?? [];
            const typeTotal = cards.reduce((sum, c) => sum + c.totalQuantity, 0);
            const farmOfType = cards[0]?.farm;
            return (
              <div key={type}>
                <div className="flex items-baseline justify-between gap-3 mb-2 pb-2 border-b border-line-hairline">
                  <h3 className="font-semibold">
                    {FLOWER_TYPE_LABELS[type] ?? type}
                    {farmOfType && (
                      <span className="text-ink-muted font-normal text-sm"> · {farmLabel(farmOfType)}</span>
                    )}
                  </h3>
                  <span className="text-sm text-ink-secondary tabular-nums">
                    {typeTotal.toLocaleString("ru-RU")} шт. · {cards.length}{" "}
                    {cards.length === 1 ? "сорт" : cards.length < 5 ? "сорта" : "сортов"}
                  </span>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {cards.map((card) => (
                    <VarietyCard key={card.key} card={card} />
                  ))}
                </div>
              </div>
            );
          })}

          {visibleVarieties.length === 0 && (
            <div className="card text-center py-8">
              <p className="font-medium">Ничего не найдено</p>
              <p className="text-sm text-ink-secondary mt-1">Попробуйте изменить строку поиска.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  unit,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  tone?: "default" | "ok" | "warning" | "critical";
}) {
  const toneClass =
    tone === "warning"
      ? "text-[#8a5a00]"
      : tone === "critical"
      ? "text-status-critical"
      : tone === "ok"
      ? "text-ink-primary"
      : "text-ink-primary";

  return (
    <div className="card !p-4">
      <div className="text-xs text-ink-secondary mb-1">{label}</div>
      <div className={clsx("text-2xl font-semibold tabular-nums", toneClass)}>
        {value}
        {unit && <span className="text-sm font-normal text-ink-muted ml-1">{unit}</span>}
      </div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}

function VarietyCard({ card }: { card: StockVarietyCard }) {
  return (
    <div className={clsx("card !p-4 border", STATUS_RING[card.status])}>
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="font-medium truncate">{card.variety}</div>
          <div className="text-xs text-ink-muted">{FLOWER_TYPE_LABELS[card.flowerType]}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-semibold tabular-nums">{card.totalQuantity.toLocaleString("ru-RU")}</div>
          <div className="text-xs text-ink-muted">шт.</div>
        </div>
      </div>

      <div className="space-y-2.5">
        {card.grades.map((g) => (
          <GradeRow key={g.grade} row={g} />
        ))}
      </div>
    </div>
  );
}

function GradeRow({ row }: { row: StockGradeRow }) {
  const fill = row.maxDays > 0 ? Math.min(100, (row.oldestDays / row.maxDays) * 100) : 0;
  const spread = row.oldestDays !== row.newestDays;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink-primary">{formatGrade(row.grade)}</span>
        <span className="flex items-baseline gap-2 tabular-nums">
          <span className="font-medium">{row.quantity.toLocaleString("ru-RU")}</span>
          <span className={clsx("text-xs", STATUS_TEXT[row.status])}>
            {spread ? `${row.newestDays}–${row.oldestDays}` : row.oldestDays} {dayWord(row.oldestDays)}
          </span>
        </span>
      </div>
      <div
        className="mt-1 h-1.5 rounded-full bg-surface-plane overflow-hidden"
        title={`Самая старая партия: ${row.oldestDays} из ${row.maxDays} дней срока хранения`}
      >
        <div
          className={clsx("h-full rounded-full transition-all", STATUS_BAR[row.status])}
          style={{ width: `${Math.max(4, fill)}%` }}
        />
      </div>
    </div>
  );
}
