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
import MoreToggle, { COLLAPSED_TABLE_SIZE } from "./MoreToggle";

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
    emptyText:
      "Продаж за период не было — заявки не оформлялись. Как только менеджеры начнут вносить заявки, здесь появятся выручка, цена стебля и клиенты.",
    rows: [
      {
        key: "revenue",
        label: "Выручка по заявкам",
        hint: "Сумма всех заявок, оформленных за период. Не путать с оплаченным",
        kind: "money",
        pick: (s) => s.revenue.value,
        prev: (s) => d(s.revenue),
        splitBar: true,
      },
      {
        key: "stems",
        label: "Продано стеблей",
        hint: "Сколько штук ушло в заявки",
        kind: "stems",
        pick: (s) => s.stems.value,
        prev: (s) => d(s.stems),
        splitBar: true,
      },
      {
        key: "avgPrice",
        label: "Средняя цена стебля",
        hint: "Выручка, делённая на стебли",
        kind: "price",
        pick: (s) => s.avgPrice.value,
        prev: (s) => d(s.avgPrice),
      },
      {
        key: "orders",
        label: "Заявок",
        hint: "Без отменённых. Смешанная заявка считается у обоих производств, поэтому колонки не складываются в итог",
        kind: "count",
        pick: (s) => s.orders.value,
        prev: (s) => d(s.orders),
      },
      {
        key: "avgCheck",
        label: "Средний чек",
        hint: "Выручка на одну заявку",
        kind: "money",
        pick: (s) => s.avgCheck.value,
        prev: (s) => d(s.avgCheck),
      },
      {
        key: "clients",
        label: "Клиентов",
        hint: "Разных покупателей за период. Один клиент может брать у обоих производств",
        kind: "count",
        pick: (s) => s.clients.value,
        prev: (s) => d(s.clients),
      },
      {
        key: "repeat",
        label: "Повторные клиенты",
        hint: "Доля тех, кто покупал и в прошлые 30 дней",
        kind: "percent",
        pick: (s) => s.repeatClientPercent,
      },
      {
        key: "lead",
        label: "От заявки до доставки",
        hint: "Сколько дней в среднем проходит",
        kind: "days",
        pick: (s) => s.avgLeadDays,
        betterUp: false,
      },
      {
        key: "fill",
        label: "Выполнено по отгрузке",
        hint: `Сколько из заказанного реально уехало по заявкам с прошедшей доставкой. Ориентир — от ${BENCHMARKS.fillRatePercent.good} %`,
        kind: "percent",
        pick: (s) => s.fillRatePercent,
        tone: (v) => toneHigherBetter(v, BENCHMARKS.fillRatePercent),
      },
      {
        key: "discount",
        label: "Скидка к прайсу",
        hint: `Насколько дешевле прайса продали. Ориентир — до ${BENCHMARKS.discountPercent.good} %`,
        kind: "percent",
        pick: (s) => s.discountPercent,
        // Отрицательная «скидка» означает, что продали дороже прайса. Показывать
        // «−1,7 %» бессмысленно: человек читает это как ошибку.
        format: (v) => (v < 0 ? `нет, выше прайса на ${dec(Math.abs(v))} %` : `${dec(v)} %`),
        tone: (v) => toneLowerBetter(v, BENCHMARKS.discountPercent),
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
        hint: "Сумма заявок, по которым бухгалтер отметил оплату",
        kind: "money",
        pick: (s) => s.paidRevenue,
      },
      {
        key: "collect",
        label: "Собираемость",
        hint: `Какая доля оформленного уже оплачена. Ориентир — от ${BENCHMARKS.collectPercent.good} %`,
        kind: "percent",
        pick: (s) => (s.revenue.value > 0 ? s.collectPercent : null),
        tone: (v) => toneHigherBetter(v, BENCHMARKS.collectPercent),
      },
      {
        key: "debt",
        label: "Долг по всей базе",
        hint: "Все неоплаченные заявки, а не только за период",
        kind: "money",
        pick: (s) => s.debtTotal,
        tone: (v) => (v > 0 ? "critical" : "good"),
        betterUp: false,
      },
    ],
  },
  {
    title: "Производство за 30 дней",
    emptyText: "Приёмки за период не было — партии на склад не заводились.",
    rows: [
      {
        key: "received",
        label: "Срезано и принято",
        hint: "Сколько стеблей завели на склад за период",
        kind: "stems",
        pick: (s) => s.receivedStems.value,
        prev: (s) => d(s.receivedStems),
        splitBar: true,
      },
      {
        key: "receivedDay",
        label: "В среднем в день",
        hint: "Принятое, делённое на 30 дней",
        kind: "stems",
        pick: (s) => (s.receivedStems.value > 0 ? s.receivedStems.value / s.days : null),
      },
      {
        key: "liquidCut",
        label: "Ликвидное качество в срезке",
        hint: "Хризантема — высшая, первая, вторая; роза — первый сорт по длинам",
        kind: "percent",
        pick: (s) => s.liquidReceivedPercent,
        tone: (v) => (v >= 70 ? "good" : v >= 50 ? "warning" : "critical"),
      },
      {
        key: "topCut",
        label: "Высшая категория в срезке",
        hint: "Роза от 80 см, хризантема «Высшая», эустома «Стандарт»",
        kind: "percent",
        pick: (s) => s.topGradePercent,
      },
      {
        key: "receivedMoney",
        label: "Вырастили на сумму",
        hint: "Принятое, оценённое по действующему прайсу",
        kind: "money",
        pick: (s) => (s.receivedMoney > 0 ? s.receivedMoney : null),
      },
      {
        key: "soldOfReceived",
        label: "Продано от срезанного",
        hint: "Меньше 100 % — склад растёт, больше — распродаём накопленное",
        kind: "percent",
        pick: (s) => s.soldOfReceivedPercent,
        tone: (v) => (v >= 90 ? "good" : v >= 60 ? "warning" : "critical"),
      },
      {
        key: "plan",
        label: "Прогноз срезки на месяц",
        hint: "Сколько агроном обещал на текущий месяц",
        kind: "stems",
        pick: (s) => {
          const total = s.harvestPlan.reduce((sum, h) => sum + h.planStems, 0);
          return total > 0 ? total : null;
        },
      },
      {
        key: "planFact",
        label: "Выполнение прогноза",
        hint: "Срезано с начала месяца от обещанного",
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
        hint: "Сколько стеблей списали за период",
        kind: "stems",
        pick: (s) => (s.writeoffStems.value > 0 ? s.writeoffStems.value : null),
        prev: (s) => d(s.writeoffStems),
        betterUp: false,
      },
      {
        key: "writeoffPct",
        label: "Списание от принятого",
        hint: `Доля потерь от того, что приняли. Ориентир — до ${BENCHMARKS.writeoffPercent.good} %`,
        kind: "percent",
        pick: (s) => s.writeoffPercent,
        tone: (v) => toneLowerBetter(v, BENCHMARKS.writeoffPercent),
        betterUp: false,
      },
      {
        key: "writeoffMoney",
        label: "Потери на списании",
        hint: "Списанное по действующему прайсу",
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
        hint: "Остаток по всем партиям прямо сейчас",
        kind: "stems",
        pick: (s) => s.stockStems,
        splitBar: true,
      },
      {
        key: "stockMoney",
        label: "Стоимость склада",
        hint: "Остаток по действующему прайсу",
        kind: "money",
        pick: (s) => (s.stockMoney > 0 ? s.stockMoney : null),
      },
      {
        key: "age",
        label: "Средний возраст",
        hint: "Дней с даты срезки, взвешенно по количеству",
        kind: "days",
        pick: (s) => (s.stockStems > 0 ? s.stockAvgAge : null),
        betterUp: false,
      },
      {
        key: "liquidStock",
        label: "Ликвид на складе",
        hint: "Остальное — мини-микс, второй сорт, третья и четвёртая категории",
        kind: "percent",
        pick: (s) => s.liquidStockPercent,
        tone: (v) => (v >= 70 ? "good" : v >= 50 ? "warning" : "critical"),
      },
      {
        key: "cover",
        label: "Запаса хватит на",
        hint: "При нынешнем темпе продаж. Дольше срока хранения — часть не успеет уйти",
        kind: "daysInt",
        pick: (s) => s.coverDays,
        betterUp: false,
      },
      {
        key: "expiring",
        label: "Скоро истечёт",
        hint: "Прошло больше 70 % срока хранения",
        kind: "stems",
        pick: (s) => (s.expiringStems > 0 ? s.expiringStems : null),
        tone: () => "warning",
        betterUp: false,
      },
      {
        key: "expired",
        label: "Просрочено",
        hint: "Срок хранения уже вышел",
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

export default function AnalyticsReport({
  all,
  byFarm,
  onlyFarm,
}: {
  all: AnalyticsSummary;
  byFarm: { farm: string; summary: AnalyticsSummary }[];
  /** Зав. складом видит одну колонку — своё производство. */
  onlyFarm?: string | null;
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

  return (
    <div className="space-y-6">
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-line-hairline">
              <th className="text-left px-4 py-2.5 font-medium text-ink-secondary sticky left-0 bg-surface z-10 min-w-[240px]">
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
                    <span
                      className={clsx(
                        "inline-block w-2 h-2 rounded-full mr-1.5 align-middle",
                        FARM_BAR[c.key]
                      )}
                    />
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
            {SECTIONS.map((section) => {
              // Пустые строки не показываем совсем: владелец отдельно просил
              // убрать нули и прочерки, которые занимали место наравне с делом.
              const rows = section.rows.filter((row) =>
                columns.some((c) => {
                  const v = row.pick(c.summary);
                  return v !== null && v !== 0;
                })
              );

              return (
                <SectionRows
                  key={section.title}
                  section={section}
                  rows={rows}
                  columns={columns}
                  total={all}
                  byFarm={byFarm}
                  single={single}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <Details all={all} byFarm={byFarm} onlyFarm={onlyFarm} />
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
}: {
  section: Section;
  rows: Row[];
  columns: { key: string; label: string; summary: AnalyticsSummary }[];
  total: AnalyticsSummary;
  byFarm: { farm: string; summary: AnalyticsSummary }[];
  single: boolean;
}) {
  return (
    <>
      <tr className="bg-surface-plane/70">
        <th
          colSpan={columns.length + 1}
          className="text-left px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-secondary sticky left-0"
        >
          {section.title}
        </th>
      </tr>

      {rows.length === 0 ? (
        <tr className="border-b border-line-hairline">
          <td colSpan={columns.length + 1} className="px-4 py-3 text-sm text-ink-muted">
            {section.emptyText}
          </td>
        </tr>
      ) : (
        rows.map((row) => (
          <tr key={row.key} className="border-b border-line-hairline last:border-0">
            <td className="px-4 py-2 sticky left-0 bg-surface z-10">
              <span className="font-medium">{row.label}</span>
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
                    "px-4 py-2 text-right align-top tabular-nums whitespace-nowrap",
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

/** Таблица со свёрнутым хвостом. */
function Collapsible<T>({
  rows,
  what,
  render,
  head,
  limit = COLLAPSED_TABLE_SIZE,
}: {
  rows: T[];
  what: (hidden: number) => string;
  head: React.ReactNode;
  render: (row: T, index: number) => React.ReactNode;
  limit?: number;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, limit);
  const hidden = rows.length - shown.length;
  return (
    <div className="card !p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">{head}</tr>
          </thead>
          <tbody>{shown.map((row, i) => render(row, i))}</tbody>
        </table>
      </div>
      {(hidden > 0 || open) && (
        <div className="px-4 py-2 border-t border-line-hairline">
          <MoreToggle expanded={open} hidden={hidden} onToggle={() => setOpen((v) => !v)} what={what(hidden)} />
        </div>
      )}
    </div>
  );
}

function Details({
  all,
  byFarm,
  onlyFarm,
}: {
  all: AnalyticsSummary;
  byFarm: { farm: string; summary: AnalyticsSummary }[];
  onlyFarm?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const flowers = onlyFarm
    ? FLOWER_TYPES_BY_FARM[onlyFarm] ?? []
    : ["rose", "chrysanthemum", "eustoma"];
  const gradeColumn = gradeColumnLabelFor(flowers);
  const gradeWord = (n: number) => gradeNounFor(flowers, n);
  /** «по ростовке» / «по категориям» — чтобы подписи читались по-русски. */
  const gradePhrase =
    gradeColumn === "Категория"
      ? "категориям"
      : gradeColumn === "Ростовка"
        ? "ростовке"
        : "ростовке и категориям";
  const single = flowers.length === 1;
  const varietyWord = (n: number) => plural(n, "сорт", "сорта", "сортов");
  const clientWord = (n: number) => plural(n, "клиент", "клиента", "клиентов");
  const reasonWord = (n: number) => plural(n, "причина", "причины", "причин");
  const dayWord = (n: number) => plural(n, "день", "дня", "дней");

  const nothing =
    all.byGrade.length === 0 &&
    all.receivedByGrade.length === 0 &&
    all.topVarieties.length === 0 &&
    all.clientRows.length === 0;
  if (nothing) return null;

  const flowerName = (t: string) => FLOWER_TYPE_LABELS[t] ?? t;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-medium text-accent hover:underline"
        aria-expanded={open}
      >
        {open ? "▲ Свернуть подробности" : "▼ Показать подробности: позиции, клиенты, менеджеры"}
      </button>

      {open && (
        <div className="space-y-6 mt-3">
          {all.byFlower.length > 0 && (
            <Block title="По цветку" hint="Что пришло, что ушло и что осталось за 30 дней">
              <div className="card !p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-ink-secondary border-b border-line-hairline">
                      <th className="px-4 py-2 font-medium">Цветок</th>
                      <th className="px-3 py-2 font-medium text-right">Срезано</th>
                      <th className="px-3 py-2 font-medium text-right">Продано</th>
                      <th className="px-3 py-2 font-medium text-right">Списано</th>
                      <th className="px-3 py-2 font-medium text-right">На складе</th>
                      <th className="px-3 py-2 font-medium text-right">Запас</th>
                      <th className="px-3 py-2 font-medium text-right">Ср. цена</th>
                    </tr>
                  </thead>
                  <tbody>
                    {all.byFlower.map((f) => {
                      const ratio =
                        f.coverDays !== null ? f.coverDays / Math.max(1, f.shelfLifeDays) : null;
                      const tone: Tone =
                        ratio === null ? "neutral" : toneLowerBetter(ratio, BENCHMARKS.coverRatio);
                      return (
                        <tr key={f.flowerType} className="border-b border-line-hairline last:border-0">
                          <td className="px-4 py-2 font-medium">
                            {FLOWER_TYPE_LABELS_PLURAL[f.flowerType] ?? f.flowerType}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{nf(f.received)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{nf(f.sold)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {f.writeoff > 0 ? nf(f.writeoff) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">
                            {nf(f.stock)}
                          </td>
                          <td className={clsx("px-3 py-2 text-right tabular-nums", TONE_TEXT[tone])}>
                            {f.coverDays === null ? "—" : `${Math.round(f.coverDays)} дн.`}
                            <span className="block text-[11px] text-ink-muted">
                              срок {f.shelfLifeDays} {dayWord(f.shelfLifeDays)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {f.avgPrice.value > 0 ? `${nf(f.avgPrice.value)} ₸` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Block>
          )}

          {all.byGrade.length > 0 && (
            <Block title="Что продаётся" hint={`Разрез по ${gradePhrase}`}>
              <Collapsible
                rows={all.byGrade}
                what={gradeWord}
                head={
                  <>
                    <th className="px-4 py-2 font-medium">{gradeColumn}</th>
                    <th className="px-3 py-2 font-medium text-right">Стеблей</th>
                    <th className="px-3 py-2 font-medium text-right">Доля</th>
                    <th className="px-3 py-2 font-medium text-right">Ср. цена</th>
                    <th className="px-3 py-2 font-medium text-right">Выручка</th>
                  </>
                }
                render={(g) => (
                  <tr key={`${g.flowerType}:${g.grade}`} className="border-b border-line-hairline last:border-0">
                    <td className="px-4 py-2">
                      {!single && <span className="text-ink-muted">{flowerName(g.flowerType)} </span>}
                      <span className="font-medium">{formatGrade(g.grade)}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{nf(g.stems)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                      {dec(g.share, 0)} %
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{nf(g.avgPrice.value)} ₸</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(g.revenue)}</td>
                  </tr>
                )}
              />
            </Block>
          )}

          {all.receivedByGrade.length > 0 && (
            <Block title="Что вырастили" hint={`Приёмка в разрезе по ${gradePhrase}`}>
              <Collapsible
                rows={all.receivedByGrade}
                what={gradeWord}
                head={
                  <>
                    <th className="px-4 py-2 font-medium">{gradeColumn}</th>
                    <th className="px-3 py-2 font-medium text-right">Принято</th>
                    <th className="px-3 py-2 font-medium text-right">Доля</th>
                    <th className="px-3 py-2 font-medium text-right">К прошлым 30</th>
                  </>
                }
                render={(r) => (
                  <tr key={`${r.flowerType}:${r.grade}`} className="border-b border-line-hairline last:border-0">
                    <td className="px-4 py-2">
                      {!single && <span className="text-ink-muted">{flowerName(r.flowerType)} </span>}
                      <span className="font-medium">{formatGrade(r.grade)}</span>
                      {r.top && <span className={clsx("ml-2 text-[11px]", TONE_TEXT.good)}>высшая</span>}
                      {!r.top && r.liquid && (
                        <span className="ml-2 text-[11px] text-ink-muted">ликвид</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{nf(r.stems.value)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                      {dec(r.share, 0)} %
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Change value={r.stems.value} prev={r.stems.prev} betterUp />
                    </td>
                  </tr>
                )}
              />
            </Block>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {all.topVarieties.length > 0 && (
              <Block title="Сорта по выручке" hint="Изменение — к предыдущим 30 дням">
                <Collapsible
                  rows={all.topVarieties}
                  what={varietyWord}
                  limit={8}
                  head={
                    <>
                      <th className="px-4 py-2 font-medium">Сорт</th>
                      <th className="px-3 py-2 font-medium text-right">Стеблей</th>
                      <th className="px-3 py-2 font-medium text-right">Выручка</th>
                      <th className="px-3 py-2 font-medium text-right">Доля</th>
                    </>
                  }
                  render={(v) => (
                    <tr key={v.key} className="border-b border-line-hairline last:border-0">
                      <td className="px-4 py-2">
                        <span className="font-medium">{v.variety}</span>
                        {!single && (
                          <span className="block text-[11px] text-ink-muted">
                            {flowerName(v.flowerType)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{nf(v.stems)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(v.revenue.value)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                        {dec(v.share, 0)} %
                      </td>
                    </tr>
                  )}
                />
              </Block>
            )}

            {all.clientRows.length > 0 && (
              <Block
                title="Клиенты"
                hint={`Три крупнейших дают ${dec(all.topClientsPercent, 0)} % выручки`}
              >
                <Collapsible
                  rows={all.clientRows}
                  what={clientWord}
                  limit={8}
                  head={
                    <>
                      <th className="px-4 py-2 font-medium">Клиент</th>
                      <th className="px-3 py-2 font-medium text-right">Заявок</th>
                      <th className="px-3 py-2 font-medium text-right">Выручка</th>
                      <th className="px-3 py-2 font-medium text-right">Долг</th>
                    </>
                  }
                  render={(c) => (
                    <tr key={c.clientName} className="border-b border-line-hairline last:border-0">
                      <td className="px-4 py-2">
                        <span className="font-medium">{c.clientName}</span>
                        <span className="block text-[11px] text-ink-muted">
                          последняя заявка{" "}
                          {c.lastOrderDaysAgo === 0
                            ? "сегодня"
                            : `${c.lastOrderDaysAgo} ${dayWord(c.lastOrderDaysAgo)} назад`}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.orders}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {money(c.revenue)}
                        <span className="block text-[11px] text-ink-muted">
                          {dec(c.share, 0)} %
                        </span>
                      </td>
                      <td
                        className={clsx(
                          "px-3 py-2 text-right tabular-nums",
                          c.debt > 0 && TONE_TEXT.critical
                        )}
                      >
                        {c.debt > 0 ? money(c.debt) : "—"}
                      </td>
                    </tr>
                  )}
                />
              </Block>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {all.managers.length > 0 && (
              <Block title="Менеджеры" hint="Собрано — сколько из оформленного уже оплачено">
                <Collapsible
                  rows={all.managers}
                  what={(n) => plural(n, "менеджер", "менеджера", "менеджеров")}
                  limit={8}
                  head={
                    <>
                      <th className="px-4 py-2 font-medium">Менеджер</th>
                      <th className="px-3 py-2 font-medium text-right">Заявок</th>
                      <th className="px-3 py-2 font-medium text-right">Выручка</th>
                      <th className="px-3 py-2 font-medium text-right">Собрано</th>
                    </>
                  }
                  render={(m) => {
                    const tone: Tone =
                      m.collectPercent === null
                        ? "neutral"
                        : toneHigherBetter(m.collectPercent, BENCHMARKS.collectPercent);
                    return (
                      <tr key={m.managerEmail} className="border-b border-line-hairline last:border-0">
                        <td className="px-4 py-2">
                          <span className="font-medium">{m.managerEmail.split("@")[0]}</span>
                          <span className="block text-[11px] text-ink-muted">
                            средний чек {money(m.avgCheck)}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.orders}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(m.revenue.value)}</td>
                        <td className={clsx("px-3 py-2 text-right tabular-nums", TONE_TEXT[tone])}>
                          {m.collectPercent === null ? "—" : `${dec(m.collectPercent, 0)} %`}
                        </td>
                      </tr>
                    );
                  }}
                />
              </Block>
            )}

            {all.writeoffReasons.length > 0 && (
              <Block title="Из-за чего списывали" hint="Деньги — по действующему прайсу">
                <Collapsible
                  rows={all.writeoffReasons}
                  what={reasonWord}
                  limit={8}
                  head={
                    <>
                      <th className="px-4 py-2 font-medium">Причина</th>
                      <th className="px-3 py-2 font-medium text-right">Стеблей</th>
                      <th className="px-3 py-2 font-medium text-right">Доля</th>
                      <th className="px-3 py-2 font-medium text-right">Деньги</th>
                    </>
                  }
                  render={(r) => (
                    <tr key={r.reason} className="border-b border-line-hairline last:border-0">
                      <td className="px-4 py-2">{r.reason}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{nf(r.stems)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                        {dec(r.share, 0)} %
                      </td>
                      <td className={clsx("px-3 py-2 text-right tabular-nums", TONE_TEXT.critical)}>
                        {money(r.money)}
                      </td>
                    </tr>
                  )}
                />
              </Block>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Block({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-2">
        <h3 className="font-medium">{title}</h3>
        {hint && <span className="text-xs text-ink-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
