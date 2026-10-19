"use client";

import { useState } from "react";
import clsx from "clsx";
import {
  FLOWER_TYPE_LABELS,
  FLOWER_TYPE_LABELS_PLURAL,
  FLOWER_TYPES_BY_FARM,
  farmLabel,
  formatGrade,
  gradeColumnLabelFor,
  gradeNounFor,
} from "@/lib/constants";
import { BENCHMARKS, toneHigherBetter, toneLowerBetter, type Tone } from "@/lib/benchmarks";
import type { AnalyticsSummary, Delta } from "@/lib/analytics";
import KpiTile from "./KpiTile";
import Chips from "./Chips";
import CardTabs from "./CardTabs";
import Pager, { PAGE_SIZE, pageSlice } from "./Pager";

/**
 * Аналитика в виде отчёта: одна плотная таблица вместо двух десятков плиток.
 *
 * Вид выбран владельцем. Прежняя раскладка плитками не работала по четырём
 * причинам, и все четыре здесь закрыты:
 *
 *   1) плиток было больше двадцати — теперь это строки одной таблицы, и глаз
 *      идёт сверху вниз, а не прыгает по квадратам;
 *   2) половина цифр была нулями и прочерками — пустые строки не показываются
 *      вовсе, а если пуст целый раздел, вместо него одна фраза, почему пусто;
 *   3) было непонятно, что означает цифра — у каждой строки стоит пояснение,
 *      от чего она считается;
 *   4) всё выглядело одинаково серым — цветом отмечено ровно то, у чего есть
 *      ориентир (хорошо/внимание/плохо), плюс полоска долей двух производств.
 *
 * Колонки — это два ТОО и хозяйство целиком. Разделение по компаниям видно
 * сразу, без переключения вкладок: у розы и хризантемы разная экономика, и
 * складывать их в одну цифру можно только для итога.
 */

const TONE_TEXT: Record<Tone, string> = {
  good: "text-status-good",
  warning: "text-[#8a5a00]",
  critical: "text-status-critical",
  neutral: "text-ink-primary",
};

const TONE_CELL: Record<Tone, string> = {
  good: "bg-status-good/[0.07]",
  warning: "bg-status-warning/[0.10]",
  critical: "bg-status-critical/[0.08]",
  neutral: "",
};

/** Цвет производства — только для полоски долей, больше нигде. */
const FARM_BAR: Record<string, string> = {
  rose_farm: "bg-flower-rose",
  esentai: "bg-flower-chrysanthemum",
};

// --- Форматирование ---------------------------------------------------------

const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
const dec = (n: number, d = 1) => n.toFixed(d).replace(".", ",");

function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${dec(n / 1_000_000, abs >= 10_000_000 ? 0 : 1)} млн ₸`;
  if (abs >= 10_000) return `${nf(n / 1000)} тыс ₸`;
  return `${nf(n)} ₸`;
}

type Kind = "money" | "stems" | "percent" | "price" | "days" | "daysInt" | "count";

function formatValue(value: number, kind: Kind): string {
  switch (kind) {
    case "money":
      return money(value);
    case "percent":
      return `${dec(value, value >= 10 ? 0 : 1)} %`;
    case "price":
      return `${nf(value)} ₸`;
    case "days":
      return `${dec(value)} дн.`;
    case "daysInt":
      return `${nf(value)} дн.`;
    default:
      return nf(value);
  }
}

function plural(n: number, one: string, few: string, many: string) {
  const t = Math.abs(n) % 100;
  const o = t % 10;
  if (t > 10 && t < 20) return many;
  if (o > 1 && o < 5) return few;
  if (o === 1) return one;
  return many;
}

// --- Описание строк отчёта --------------------------------------------------

interface Row {
  key: string;
  label: string;
  /** От чего считается цифра. Без этого «19 %» ничего не значит. */
  hint?: string;
  kind: Kind;
  pick: (s: AnalyticsSummary) => number | null;
  /** Значение за предыдущие 30 дней — для стрелки под цифрой. */
  prev?: (s: AnalyticsSummary) => number | null;
  /** Рост — это хорошо? У списания и долга наоборот. */
  betterUp?: boolean;
  /** Цвет по ориентиру хозяйства. */
  tone?: (value: number, s: AnalyticsSummary) => Tone;
  /** Показать полоску: какая часть итога от какого производства. */
  splitBar?: boolean;
  /** Своё оформление значения там, где обычного формата мало. */
  format?: (value: number) => string;
}

interface Section {
  title: string;
  /** Что написать, если во всём разделе нет ни одной цифры. */
  emptyText: string;
  rows: Row[];
}

const d = (delta: Delta | undefined) => delta?.prev ?? null;

const SECTIONS: Section[] = [
  {
    title: "Продажи за 30 дней",
    emptyText: "Продаж за период не было.",
    rows: [
      {
        key: "revenue",
        label: "Выручка по заявкам",
        kind: "money",
        pick: (s) => s.revenue.value,
        prev: (s) => d(s.revenue),
        splitBar: true,
      },
      {
        key: "stems",
        label: "Продано стеблей",
        kind: "stems",
        pick: (s) => s.stems.value,
        prev: (s) => d(s.stems),
        splitBar: true,
      },
      {
        key: "avgPrice",
        label: "Средняя цена стебля",
        kind: "price",
        pick: (s) => s.avgPrice.value,
        prev: (s) => d(s.avgPrice),
      },
      {
        key: "orders",
        label: "Заявок",
        hint: "колонки не складываются в итог",
        kind: "count",
        pick: (s) => s.orders.value,
        prev: (s) => d(s.orders),
      },
      {
        key: "avgCheck",
        label: "Средний чек",
        kind: "money",
        pick: (s) => s.avgCheck.value,
        prev: (s) => d(s.avgCheck),
      },
      {
        key: "clients",
        label: "Клиентов",
        kind: "count",
        pick: (s) => s.clients.value,
        prev: (s) => d(s.clients),
      },
      {
        key: "repeat",
        label: "Повторные клиенты",
        hint: "покупали и в прошлые 30 дней",
        kind: "percent",
        pick: (s) => s.repeatClientPercent,
      },
      {
        key: "lead",
        label: "От заявки до доставки",
        kind: "days",
        pick: (s) => s.avgLeadDays,
        betterUp: false,
      },
      {
        key: "fill",
        label: "Выполнено по отгрузке",
        hint: `ориентир от ${BENCHMARKS.fillRatePercent.good} %`,
        kind: "percent",
        pick: (s) => s.fillRatePercent,
        tone: (v) => toneHigherBetter(v, BENCHMARKS.fillRatePercent),
      },
    ],
  },
  {
    // Отдельный раздел, а не строчка в продажах: владелец прямо попросил
    // бенчмарк по отклонению от заданной цены. Менять цену в заявке менеджеру
    // можно — но видно, насколько и кто.
    title: "Прайс и отклонение от него",
    emptyText: "Сравнивать не с чем.",
    rows: [
      {
        key: "discount",
        label: "Отклонение от прайса",
        hint: `ориентир до ${BENCHMARKS.discountPercent.good} %`,
        kind: "percent",
        pick: (s) => s.discountPercent,
        // Отрицательная «скидка» означает, что продали дороже прайса. Показывать
        // «−1,7 %» бессмысленно: человек читает это как ошибку.
        format: (v) =>
          Math.abs(v) < 0.05
            ? "ровно по прайсу"
            : v < 0
              ? `нет, выше прайса на ${dec(Math.abs(v))} %`
              : `${dec(v)} %`,
        tone: (v) => toneLowerBetter(v, BENCHMARKS.discountPercent),
        betterUp: false,
      },
      {
        key: "discountMoney",
        label: "Разница в деньгах",
        kind: "money",
        pick: (s) => (s.listRevenue > 0 ? s.discountMoney : null),
        // Округление до тысяч легко даёт «−0 ₸», а это читается как ошибка.
        format: (v) =>
          Math.round(v) === 0
            ? "как в прайсе"
            : v < 0
              ? `+${money(Math.abs(v))} сверх прайса`
              : `−${money(v)} к прайсу`,
        betterUp: false,
      },
      {
        key: "listRevenue",
        label: "Стоило бы по прайсу",
        kind: "money",
        pick: (s) => s.listRevenue,
        splitBar: true,
      },
      {
        key: "priced",
        label: "Сравнимо с прайсом",
        hint: `доля выручки с ценой в прайсе, ориентир от ${BENCHMARKS.pricedRevenuePercent.good} %`,
        kind: "percent",
        pick: (s) => s.pricedRevenuePercent,
        tone: (v) => toneHigherBetter(v, BENCHMARKS.pricedRevenuePercent),
      },
      {
        key: "priceAge",
        label: "Прайс не меняли",
        hint: `ориентир до ${BENCHMARKS.priceListAgeDays.good} дн.`,
        kind: "daysInt",
        pick: (s) => s.priceListAgeDays,
        tone: (v) => toneLowerBetter(v, BENCHMARKS.priceListAgeDays),
        betterUp: false,
      },
    ],
  },
  {
    title: "Деньги",
    emptyText: "Оплат за период не было.",
    rows: [
      {
        key: "paid",
        label: "Оплачено за период",
        kind: "money",
        pick: (s) => s.paidRevenue,
      },
      {
        key: "collect",
        label: "Собираемость",
        hint: `ориентир от ${BENCHMARKS.collectPercent.good} %`,
        kind: "percent",
        pick: (s) => (s.revenue.value > 0 ? s.collectPercent : null),
        tone: (v) => toneHigherBetter(v, BENCHMARKS.collectPercent),
      },
      {
        key: "debt",
        label: "Долг по всей базе",
        kind: "money",
        pick: (s) => s.debtTotal,
        tone: (v) => (v > 0 ? "critical" : "good"),
        betterUp: false,
      },
    ],
  },
  {
    title: "Производство за 30 дней",
    emptyText: "Приёмки за период не было.",
    rows: [
      {
        key: "received",
        label: "Срезано и принято",
        kind: "stems",
        pick: (s) => s.receivedStems.value,
        prev: (s) => d(s.receivedStems),
        splitBar: true,
      },
      {
        key: "receivedDay",
        label: "В среднем в день",
        kind: "stems",
        pick: (s) => (s.receivedStems.value > 0 ? s.receivedStems.value / s.days : null),
      },
      {
        key: "liquidCut",
        label: "Ликвидное качество в срезке",
        kind: "percent",
        pick: (s) => s.liquidReceivedPercent,
        tone: (v) => (v >= 70 ? "good" : v >= 50 ? "warning" : "critical"),
      },
      {
        key: "topCut",
        label: "Высшая категория в срезке",
        hint: "роза от 80 см, хризантема «Высшая»",
        kind: "percent",
        pick: (s) => s.topGradePercent,
      },
      {
        key: "receivedMoney",
        label: "Вырастили на сумму",
        kind: "money",
        pick: (s) => (s.receivedMoney > 0 ? s.receivedMoney : null),
      },
      {
        key: "soldOfReceived",
        label: "Продано от срезанного",
        hint: "меньше 100 % — склад растёт",
        kind: "percent",
        pick: (s) => s.soldOfReceivedPercent,
        tone: (v) => (v >= 90 ? "good" : v >= 60 ? "warning" : "critical"),
      },
      {
        key: "plan",
        label: "Прогноз срезки на месяц",
        kind: "stems",
        pick: (s) => {
          const total = s.harvestPlan.reduce((sum, h) => sum + h.planStems, 0);
          return total > 0 ? total : null;
        },
      },
      {
        key: "planFact",
        label: "Выполнение прогноза",
        hint: "с начала месяца",
        kind: "percent",
        pick: (s) => {
          const plan = s.harvestPlan.reduce((sum, h) => sum + h.planStems, 0);
          const fact = s.harvestPlan.reduce((sum, h) => sum + h.receivedStems, 0);
          return plan > 0 ? (fact / plan) * 100 : null;
        },
        tone: (v, s) =>
          v >= s.monthProgressPercent * 0.9
            ? "good"
            : v >= s.monthProgressPercent * 0.7
              ? "warning"
              : "critical",
      },
      {
        key: "writeoff",
        label: "Списано",
        kind: "stems",
        pick: (s) => (s.writeoffStems.value > 0 ? s.writeoffStems.value : null),
        prev: (s) => d(s.writeoffStems),
        betterUp: false,
      },
      {
        key: "writeoffPct",
        label: "Списание от принятого",
        hint: `ориентир до ${BENCHMARKS.writeoffPercent.good} %`,
        kind: "percent",
        pick: (s) => s.writeoffPercent,
        tone: (v) => toneLowerBetter(v, BENCHMARKS.writeoffPercent),
        betterUp: false,
      },
      {
        key: "writeoffMoney",
        label: "Потери на списании",
        kind: "money",
        pick: (s) => (s.writeoffMoney > 0 ? s.writeoffMoney : null),
        tone: () => "critical",
        betterUp: false,
      },
    ],
  },
  {
    title: "Склад сейчас",
    emptyText: "Склад пуст.",
    rows: [
      {
        key: "stock",
        label: "Лежит стеблей",
        kind: "stems",
        pick: (s) => s.stockStems,
        splitBar: true,
      },
      {
        key: "stockMoney",
        label: "Стоимость склада",
        kind: "money",
        pick: (s) => (s.stockMoney > 0 ? s.stockMoney : null),
      },
      {
        key: "age",
        label: "Средний возраст",
        kind: "days",
        pick: (s) => (s.stockStems > 0 ? s.stockAvgAge : null),
        betterUp: false,
      },
      {
        key: "liquidStock",
        label: "Ликвид на складе",
        kind: "percent",
        pick: (s) => s.liquidStockPercent,
        tone: (v) => (v >= 70 ? "good" : v >= 50 ? "warning" : "critical"),
      },
      {
        key: "cover",
        label: "Запаса хватит на",
        hint: "при нынешнем темпе продаж",
        kind: "daysInt",
        pick: (s) => s.coverDays,
        betterUp: false,
      },
      {
        key: "expiring",
        label: "Скоро истечёт",
        hint: "прошло больше 70 % срока",
        kind: "stems",
        pick: (s) => (s.expiringStems > 0 ? s.expiringStems : null),
        tone: () => "warning",
        betterUp: false,
      },
      {
        key: "expired",
        label: "Просрочено",
        kind: "stems",
        pick: (s) => (s.expiredStems > 0 ? s.expiredStems : null),
        tone: () => "critical",
        betterUp: false,
      },
    ],
  },
];

// --- Ячейки -----------------------------------------------------------------

function Change({ value, prev, betterUp }: { value: number; prev: number | null; betterUp: boolean }) {
  if (prev === null || prev === 0) return null;
  const change = ((value - prev) / prev) * 100;
  if (Math.abs(change) < 0.5) {
    return <span className="text-[11px] text-ink-muted">≈ как было</span>;
  }
  const up = change > 0;
  const good = up === betterUp;
  return (
    <span
      className={clsx("text-[11px] tabular-nums", good ? TONE_TEXT.good : TONE_TEXT.critical)}
      title="К предыдущим 30 дням"
    >
      {up ? "▲" : "▼"} {dec(Math.abs(change), 0)} %
    </span>
  );
}

/** Короткие подписи вкладок для разделов отчёта — по порядку `SECTIONS`. */
const SECTION_TABS = ["Продажи", "Прайс", "Деньги", "Производство", "Склад"];

/** Подробные разрезы, которые живут внутри вкладки раздела вторым уровнем (кнопками). */
type DetailKey = "grades" | "varieties" | "clients" | "managers" | "deviation" | "received" | "writeoffs";
const DETAILS_BY_SECTION: Record<number, { key: DetailKey; label: string }[]> = {
  0: [
    { key: "grades", label: "Что продаётся" },
    { key: "varieties", label: "Сорта" },
    { key: "clients", label: "Клиенты" },
    { key: "managers", label: "Менеджеры" },
  ],
  1: [{ key: "deviation", label: "По позициям" }],
  3: [
    { key: "received", label: "Что вырастили" },
    { key: "writeoffs", label: "Из-за чего списывали" },
  ],
};

/** Строка отчёта по её ключу — для плиток наверху. */
function rowByKey(key: string): Row | undefined {
  for (const section of SECTIONS) {
    const row = section.rows.find((r) => r.key === key);
    if (row) return row;
  }
  return undefined;
}

const KPI_KEYS: { key: string; icon: "chart" | "wallet" | "leaf" | "box" }[] = [
  { key: "revenue", icon: "chart" },
  { key: "collect", icon: "wallet" },
  { key: "received", icon: "leaf" },
  { key: "stock", icon: "box" },
];

export default function AnalyticsReport({
  all,
  byFarm,
  onlyFarm,
  flowerSummary,
  extra,
}: {
  all: AnalyticsSummary;
  byFarm: { farm: string; summary: AnalyticsSummary }[];
  /** Зав. складом видит одну колонку — своё производство. */
  onlyFarm?: string | null;
  /** Таблица «По цветку» (рисует сервер) — первая вкладка отчёта. */
  flowerSummary?: React.ReactNode;
  /** «Коротко» и «На что смотреть» — вкладка «Главное». */
  extra?: React.ReactNode;
}) {
  const single = Boolean(onlyFarm);
  const columns = single
    ? [{ key: onlyFarm as string, label: farmLabel(onlyFarm as string), summary: all }]
    : [
        ...byFarm.map((f) => ({ key: f.farm, label: farmLabel(f.farm), summary: f.summary })),
        { key: "all", label: "Всё хозяйство", summary: all },
      ];

  const flowersOf = (key: string) =>
    key === "all"
      ? ["rose", "chrysanthemum", "eustoma"]
      : FLOWER_TYPES_BY_FARM[key] ?? [];

  type TabKey = "flower" | "main" | `s${number}`;
  const tabs: { key: TabKey; label: string }[] = [
    ...(flowerSummary ? [{ key: "flower" as TabKey, label: "По цветку" }] : []),
    ...(extra ? [{ key: "main" as TabKey, label: "Главное" }] : []),
    ...SECTIONS.map((section, i) => ({ key: `s${i}` as TabKey, label: SECTION_TABS[i] ?? section.title })),
  ];
  const [tab, setTab] = useState<TabKey>(tabs[0]?.key ?? "s0");
  const [detail, setDetail] = useState<DetailKey | "rows">("rows");
  const sectionIndex = tab.startsWith("s") ? Number(tab.slice(1)) : -1;
  const section = sectionIndex >= 0 ? SECTIONS[sectionIndex] : null;
  const detailItems = (DETAILS_BY_SECTION[sectionIndex] ?? []).filter((d) => hasDetail(all, d.key));
  const shownDetail = detailItems.some((d) => d.key === detail) ? detail : "rows";

  return (
    <div>
      {/* Главные четыре цифры — плитками, как на остальных страницах. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        {KPI_KEYS.map(({ key, icon }) => {
          const row = rowByKey(key);
          if (!row) return null;
          const value = row.pick(all);
          const prev = row.prev ? row.prev(all) : null;
          const tone: Tone = value !== null && row.tone ? row.tone(value, all) : "neutral";
          return (
            <KpiTile
              key={key}
              icon={icon}
              label={row.label}
              value={
                value === null ? (
                  "—"
                ) : (
                  <span className={clsx(tone !== "neutral" && TONE_TEXT[tone])}>
                    {row.format ? row.format(value) : formatValue(value, row.kind)}
                  </span>
                )
              }
              hint={
                value !== null && prev ? (
                  <>
                    <Change value={value} prev={prev} betterUp={row.betterUp !== false} />{" "}
                    <span className="text-ink-muted">к прошлым {all.days} дням</span>
                  </>
                ) : (
                  row.hint
                )
              }
            />
          );
        })}
      </div>

      <div className="card !p-0 overflow-hidden">
        <CardTabs
          tone="analytics"
          items={tabs}
          value={tab}
          onChange={(k) => {
            setTab(k);
            setDetail("rows");
          }}
        />

        {tab === "flower" && flowerSummary}
        {tab === "main" && <div className="p-4 sm:p-5">{extra}</div>}

        {section && (
          <>
            {detailItems.length > 0 && (
              <div className="px-4 sm:px-5 py-3 border-b border-line-hairline">
                <Chips
                  value={shownDetail}
                  onChange={(v) => setDetail(v as DetailKey | "rows")}
                  items={[{ value: "rows", label: "Показатели" }, ...detailItems.map((d) => ({ value: d.key, label: d.label }))]}
                />
              </div>
            )}

            {shownDetail === "rows" ? (
              <div className="table-scroll">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="border-b border-line-hairline bg-surface-plane/60 text-xs text-ink-muted">
                      <th className="text-left px-4 py-2.5 font-medium sticky left-0 bg-surface-plane z-10 min-w-[240px]">
                        Показатель
                      </th>
                      {columns.map((c) => (
                        <th
                          key={c.key}
                          className={clsx(
                            "text-right px-4 py-2.5 font-medium whitespace-nowrap",
                            c.key === "all" ? "text-ink-primary" : "text-ink-secondary"
                          )}
                        >
                          {c.key !== "all" && (
                            <span className={clsx("inline-block w-2 h-2 rounded-full mr-1.5 align-middle", FARM_BAR[c.key])} />
                          )}
                          {c.label}
                          <span className="block text-[11px] font-normal text-ink-muted">
                            {flowersOf(c.key)
                              .map((t) => FLOWER_TYPE_LABELS_PLURAL[t] ?? t)
                              .join(", ")}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <SectionRows
                      section={section}
                      // Пустые строки не показываем совсем: владелец отдельно просил
                      // убрать нули и прочерки, которые занимали место наравне с делом.
                      rows={section.rows.filter((row) =>
                        columns.some((c) => {
                          const v = row.pick(c.summary);
                          return v !== null && v !== 0;
                        })
                      )}
                      columns={columns}
                      total={all}
                      byFarm={byFarm}
                      single={single}
                      hideTitle
                    />
                  </tbody>
                </table>
              </div>
            ) : (
              <DetailView all={all} onlyFarm={onlyFarm} view={shownDetail} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SectionRows({
  section,
  rows,
  columns,
  total,
  byFarm,
  single,
  hideTitle = false,
}: {
  section: Section;
  rows: Row[];
  columns: { key: string; label: string; summary: AnalyticsSummary }[];
  total: AnalyticsSummary;
  byFarm: { farm: string; summary: AnalyticsSummary }[];
  single: boolean;
  /** Раздел открыт вкладкой — его название уже на вкладке. */
  hideTitle?: boolean;
}) {
  return (
    <>
      {!hideTitle && (
      <tr className="bg-surface-plane/70">
        <th
          colSpan={columns.length + 1}
          className="text-left px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary sticky left-0"
        >
          {section.title}
        </th>
      </tr>
      )}

      {rows.length === 0 ? (
        <tr className="border-b border-line-hairline">
          <td colSpan={columns.length + 1} className="px-4 py-12 text-center text-sm text-ink-muted">
            {section.emptyText}
          </td>
        </tr>
      ) : (
        rows.map((row) => (
          <tr key={row.key} className="border-b border-line-hairline last:border-0">
            <td className="px-4 py-2.5 sticky left-0 bg-surface z-10">
              <span className="font-semibold">{row.label}</span>
              {row.hint && (
                <span className="block text-[11px] text-ink-muted leading-snug">{row.hint}</span>
              )}
            </td>

            {columns.map((c) => {
              const value = row.pick(c.summary);
              const prev = row.prev ? row.prev(c.summary) : null;
              const tone: Tone = value !== null && row.tone ? row.tone(value, c.summary) : "neutral";
              return (
                <td
                  key={c.key}
                  className={clsx(
                    "px-4 py-2.5 text-right align-top tabular-nums whitespace-nowrap",
                    TONE_CELL[tone]
                  )}
                >
                  {value === null ? (
                    <span className="text-ink-muted">—</span>
                  ) : (
                    <>
                      <span
                        className={clsx(
                          c.key === "all" ? "font-semibold" : "font-medium",
                          tone !== "neutral" && TONE_TEXT[tone]
                        )}
                      >
                        {row.format ? row.format(value) : formatValue(value, row.kind)}
                      </span>
                      <span className="block">
                        <Change value={value} prev={prev} betterUp={row.betterUp !== false} />
                      </span>
                      {/* Полоска долей: видно, чей это объём, без отдельного графика. */}
                      {row.splitBar && !single && c.key === "all" && value > 0 && (
                        <span className="flex h-1.5 rounded-full overflow-hidden mt-1 bg-surface-plane">
                          {byFarm.map((f) => {
                            const part = row.pick(f.summary) ?? 0;
                            const width = value > 0 ? (part / value) * 100 : 0;
                            return (
                              <span
                                key={f.farm}
                                className={FARM_BAR[f.farm]}
                                style={{ width: `${width}%` }}
                                title={`${farmLabel(f.farm)}: ${Math.round(width)} %`}
                              />
                            );
                          })}
                        </span>
                      )}
                    </>
                  )}
                </td>
              );
            })}
          </tr>
        ))
      )}
    </>
  );
}

// --- Подробности ------------------------------------------------------------

/** Таблица разреза страницами (новый вид, 19.10.2026: вместо «показать ещё N»). */
function DetailTable<T>({
  rows,
  what,
  render,
  head,
}: {
  rows: T[];
  what: (n: number) => string;
  head: React.ReactNode;
  render: (row: T, index: number) => React.ReactNode;
}) {
  const [page, setPage] = useState(0);
  const shown = pageSlice(rows, page);
  return (
    <>
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">{head}</tr>
          </thead>
          <tbody>{shown.map((row, i) => render(row, page * PAGE_SIZE + i))}</tbody>
        </table>
      </div>
      <Pager total={rows.length} page={page} onPage={setPage} what={what(rows.length)} />
    </>
  );
}

/**
 * Отклонение факта от прайса одной ячейкой.
 *
 * Минус здесь означает «продали ДОРОЖЕ прайса», и это хорошо — но «−3 %» глаз
 * читает как провал. Поэтому знак не показывается, а пишется словом.
 */
function Deviation({ percent, compact }: { percent: number | null; compact?: boolean }) {
  if (percent === null) return <span className="text-ink-muted">—</span>;
  if (Math.abs(percent) < 0.05) return <span className={TONE_TEXT.good}>по прайсу</span>;
  const above = percent < 0;
  const tone = above ? "good" : toneLowerBetter(percent, BENCHMARKS.discountPercent);
  // В узкой колонке фраза переносится на три строки и таблица разъезжается,
  // поэтому там знак со стрелкой, а полное объяснение — в подсказке.
  const text = compact
    ? `${above ? "↑" : "↓"} ${dec(Math.abs(percent))} %`
    : above
      ? `выше прайса на ${dec(Math.abs(percent))} %`
      : `−${dec(percent)} %`;
  return (
    <span
      className={clsx(TONE_TEXT[tone], "whitespace-nowrap")}
      title={above ? "Продавали дороже прайса" : "Продавали дешевле прайса"}
    >
      {text}
    </span>
  );
}

/** Есть ли что показать в разрезе — пустые кнопки не рисуем. */
function hasDetail(all: AnalyticsSummary, key: DetailKey): boolean {
  switch (key) {
    case "grades":
      return all.byGrade.length > 0;
    case "received":
      return all.receivedByGrade.length > 0;
    case "deviation":
      return all.priceDeviation.length > 0;
    case "varieties":
      return all.topVarieties.length > 0;
    case "clients":
      return all.clientRows.length > 0;
    case "managers":
      return all.managers.length > 0;
    case "writeoffs":
      return all.writeoffReasons.length > 0;
  }
}

const TD = "px-4 py-2.5";
const TDN = "px-4 py-2.5 text-right tabular-nums";
const TH = "px-4 py-2.5 font-medium";
const THN = "px-4 py-2.5 font-medium text-right";
const TROW = "border-b border-line-hairline last:border-0 hover:bg-surface-plane/60";

function DetailView({
  all,
  onlyFarm,
  view,
}: {
  all: AnalyticsSummary;
  onlyFarm?: string | null;
  view: DetailKey;
}) {
  const flowers = onlyFarm
    ? FLOWER_TYPES_BY_FARM[onlyFarm] ?? []
    : ["rose", "chrysanthemum", "eustoma"];
  const gradeColumn = gradeColumnLabelFor(flowers);
  const gradeWord = (n: number) => gradeNounFor(flowers, n);
  const single = flowers.length === 1;
  const varietyWord = (n: number) => plural(n, "сорт", "сорта", "сортов");
  const clientWord = (n: number) => plural(n, "клиент", "клиента", "клиентов");
  const reasonWord = (n: number) => plural(n, "причина", "причины", "причин");
  const dayWord = (n: number) => plural(n, "день", "дня", "дней");
  const flowerName = (t: string) => FLOWER_TYPE_LABELS[t] ?? t;

  switch (view) {
    case "grades":
      return (
        <DetailTable
          key="grades"
          rows={all.byGrade}
          what={gradeWord}
          head={
            <>
              <th className={TH}>{gradeColumn}</th>
              <th className={THN}>Стеблей</th>
              <th className={THN}>Доля</th>
              <th className={THN}>Ср. цена</th>
              <th className={THN}>Выручка</th>
            </>
          }
          render={(g) => (
            <tr key={`${g.flowerType}:${g.grade}`} className={TROW}>
              <td className={TD}>
                {!single && <span className="text-ink-muted">{flowerName(g.flowerType)} </span>}
                <span className="font-semibold">{formatGrade(g.grade)}</span>
              </td>
              <td className={TDN}>{nf(g.stems)}</td>
              <td className={clsx(TDN, "text-ink-secondary")}>{dec(g.share, 0)} %</td>
              <td className={TDN}>{nf(g.avgPrice.value)} ₸</td>
              <td className={TDN}>{money(g.revenue)}</td>
            </tr>
          )}
        />
      );
    case "received":
      return (
        <DetailTable
          key="received"
          rows={all.receivedByGrade}
          what={gradeWord}
          head={
            <>
              <th className={TH}>{gradeColumn}</th>
              <th className={THN}>Принято</th>
              <th className={THN}>Доля</th>
              <th className={THN}>К прошлым {all.days}</th>
            </>
          }
          render={(r) => (
            <tr key={`${r.flowerType}:${r.grade}`} className={TROW}>
              <td className={TD}>
                {!single && <span className="text-ink-muted">{flowerName(r.flowerType)} </span>}
                <span className="font-semibold">{formatGrade(r.grade)}</span>
                {r.top && <span className={clsx("ml-2 text-[11px]", TONE_TEXT.good)}>высшая</span>}
                {!r.top && r.liquid && <span className="ml-2 text-[11px] text-ink-muted">ликвид</span>}
              </td>
              <td className={TDN}>{nf(r.stems.value)}</td>
              <td className={clsx(TDN, "text-ink-secondary")}>{dec(r.share, 0)} %</td>
              <td className="px-4 py-2.5 text-right">
                <Change value={r.stems.value} prev={r.stems.prev} betterUp />
              </td>
            </tr>
          )}
        />
      );
    case "deviation":
      return (
        <>
          <p className="px-4 sm:px-5 pt-3 text-xs text-ink-muted">ориентир — до {BENCHMARKS.discountPercent.good} % ниже прайса</p>
          <DetailTable
            key="deviation"
            rows={all.priceDeviation}
            what={gradeWord}
            head={
              <>
                <th className={TH}>{gradeColumn}</th>
                <th className={THN}>Стеблей</th>
                <th className={THN}>По прайсу</th>
                <th className={THN}>Продали</th>
                <th className={THN}>Отклонение</th>
              </>
            }
            render={(p) => (
              <tr key={p.key} className={TROW}>
                <td className={TD}>
                  {!single && <span className="text-ink-muted">{flowerName(p.flowerType)} </span>}
                  <span className="font-semibold">{formatGrade(p.grade)}</span>
                </td>
                <td className={TDN}>{nf(p.stems)}</td>
                <td className={clsx(TDN, "text-ink-secondary")}>{money(p.listRevenue)}</td>
                <td className={TDN}>{money(p.revenue)}</td>
                <td className={TDN}>
                  <Deviation percent={p.discountPercent} />
                </td>
              </tr>
            )}
          />
        </>
      );
    case "varieties":
      return (
        <DetailTable
          key="varieties"
          rows={all.topVarieties}
          what={varietyWord}
          head={
            <>
              <th className={TH}>Сорт</th>
              <th className={THN}>Стеблей</th>
              <th className={THN}>Выручка</th>
              <th className={THN}>Доля</th>
            </>
          }
          render={(v) => (
            <tr key={v.key} className={TROW}>
              <td className={TD}>
                <span className="font-semibold">{v.variety}</span>
                {!single && <span className="ml-1.5 text-xs text-ink-muted">{flowerName(v.flowerType)}</span>}
              </td>
              <td className={TDN}>{nf(v.stems)}</td>
              <td className={TDN}>{money(v.revenue.value)}</td>
              <td className={clsx(TDN, "text-ink-secondary")}>{dec(v.share, 0)} %</td>
            </tr>
          )}
        />
      );
    case "clients":
      return (
        <>
          <p className="px-4 sm:px-5 pt-3 text-xs text-ink-muted">
            Три крупнейших дают {dec(all.topClientsPercent, 0)} % выручки
          </p>
          <DetailTable
            key="clients"
            rows={all.clientRows}
            what={clientWord}
            head={
              <>
                <th className={TH}>Клиент</th>
                <th className={THN}>Заявок</th>
                <th className={THN}>Выручка</th>
                <th className={THN}>Долг</th>
              </>
            }
            render={(c) => (
              <tr key={c.clientName} className={TROW}>
                <td className={TD}>
                  <span className="font-semibold">{c.clientName}</span>
                  <span className="block text-[11px] text-ink-muted">
                    последняя заявка{" "}
                    {c.lastOrderDaysAgo === 0 ? "сегодня" : `${c.lastOrderDaysAgo} ${dayWord(c.lastOrderDaysAgo)} назад`}
                  </span>
                </td>
                <td className={TDN}>{c.orders}</td>
                <td className={TDN}>
                  {money(c.revenue)}
                  <span className="block text-[11px] text-ink-muted">{dec(c.share, 0)} %</span>
                </td>
                <td className={clsx(TDN, c.debt > 0 && TONE_TEXT.critical)}>{c.debt > 0 ? money(c.debt) : "—"}</td>
              </tr>
            )}
          />
        </>
      );
    case "managers":
      return (
        <>
          <p className="px-4 sm:px-5 pt-3 text-xs text-ink-muted">К прайсу: ↑ дороже, ↓ дешевле</p>
          <DetailTable
            key="managers"
            rows={all.managers}
            what={(n) => plural(n, "менеджер", "менеджера", "менеджеров")}
            head={
              <>
                <th className={TH}>Менеджер</th>
                <th className={THN}>Заявок</th>
                <th className={THN}>Выручка</th>
                <th className={THN}>Собрано</th>
                <th className={THN}>К прайсу</th>
              </>
            }
            render={(m) => {
              const tone: Tone =
                m.collectPercent === null ? "neutral" : toneHigherBetter(m.collectPercent, BENCHMARKS.collectPercent);
              return (
                <tr key={m.managerEmail} className={TROW}>
                  <td className={TD}>
                    <span className="font-semibold">{m.managerEmail.split("@")[0]}</span>
                    <span className="block text-[11px] text-ink-muted">средний чек {money(m.avgCheck)}</span>
                  </td>
                  <td className={TDN}>{m.orders}</td>
                  <td className={clsx(TDN, "whitespace-nowrap")}>{money(m.revenue.value)}</td>
                  <td className={clsx(TDN, TONE_TEXT[tone])}>
                    {m.collectPercent === null ? "—" : `${dec(m.collectPercent, 0)} %`}
                  </td>
                  <td className={TDN}>
                    <Deviation percent={m.discountPercent} compact />
                  </td>
                </tr>
              );
            }}
          />
        </>
      );
    case "writeoffs":
      return (
        <DetailTable
          key="writeoffs"
          rows={all.writeoffReasons}
          what={reasonWord}
          head={
            <>
              <th className={TH}>Причина</th>
              <th className={THN}>Стеблей</th>
              <th className={THN}>Доля</th>
              <th className={THN}>Деньги</th>
            </>
          }
          render={(r) => (
            <tr key={r.reason} className={TROW}>
              <td className={clsx(TD, "font-semibold")}>{r.reason}</td>
              <td className={TDN}>{nf(r.stems)}</td>
              <td className={clsx(TDN, "text-ink-secondary")}>{dec(r.share, 0)} %</td>
              <td className={clsx(TDN, TONE_TEXT.critical)}>{money(r.money)}</td>
            </tr>
          )}
        />
      );
  }
}
