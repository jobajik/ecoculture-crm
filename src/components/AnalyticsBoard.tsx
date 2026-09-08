"use client";

import { useState } from "react";
import clsx from "clsx";
import { FLOWER_TYPE_LABELS, FLOWER_TYPE_LABELS_PLURAL, formatGrade } from "@/lib/constants";
import { BENCHMARKS, toneHigherBetter, toneLowerBetter, type Tone } from "@/lib/benchmarks";
import type { AnalyticsSummary, Delta } from "@/lib/analytics";
import MoreToggle, { COLLAPSED_TABLE_SIZE } from "./MoreToggle";

/**
 * Аналитика: цифры, ориентиры и одна полоска графика.
 *
 * Владелец попросил меньше картинок и больше чисел, «где-то подсвеченных». Отсюда
 * устройство страницы:
 *
 *   1) «На что смотреть» — три-пять строк, собранных из тех же цифр, что ниже.
 *      Это не отдельный расчёт, а способ не заставлять искать проблему глазами.
 *   2) Плитки: значение крупно, рядом изменение к прошлым 30 дням.
 *   3) Плитки с ориентиром: цвет означает «уложились или нет», а не красоту.
 *   4) Таблицы: цветок, ростовка, сорта, клиенты, менеджеры, списания, партии.
 *
 * Цвет здесь имеет ровно одно значение — «хорошо / внимание / плохо». Ничего
 * декоративного не красим: иначе страница перестаёт предупреждать.
 */

const TONE_TEXT: Record<Tone, string> = {
  good: "text-status-good",
  warning: "text-[#8a5a00]",
  critical: "text-status-critical",
  neutral: "text-ink-secondary",
};

const TONE_CARD: Record<Tone, string> = {
  good: "border-status-good/30 bg-status-good/[0.04]",
  warning: "border-status-warning/40 bg-status-warning/[0.06]",
  critical: "border-status-critical/40 bg-status-critical/[0.05]",
  neutral: "border-line-hairline",
};

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const num = (n: number) => Math.round(n).toLocaleString("ru-RU");
/** Проценты по-русски: запятая, а не точка. */
const pct = (n: number, digits = 1) => `${n.toFixed(digits).replace(".", ",")} %`;
const dec = (n: number, digits = 1) => n.toFixed(digits).replace(".", ",");

/** Компактные деньги для плиток: 4,6 млн вместо 4 629 000. */
function shortMoney(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)} млн ₸`;
  if (abs >= 10_000) return `${Math.round(n / 1000)} тыс ₸`;
  return money(n);
}

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
const clientWord = (n: number) => plural(n, "клиент", "клиента", "клиентов");
const managerWord = (n: number) => plural(n, "менеджер", "менеджера", "менеджеров");
const reasonWord = (n: number) => plural(n, "причина", "причины", "причин");
const batchWord = (n: number) => plural(n, "партия", "партии", "партий");

/** Стрелка с процентом. Направление «хорошо/плохо» задаётся отдельно: рост цены — хорошо, рост списания — нет. */
function Change({
  delta,
  betterUp = true,
  compact = false,
}: {
  delta: Delta;
  betterUp?: boolean;
  /** В таблицах длинная надпись «не с чем сравнивать» превращается в шум. */
  compact?: boolean;
}) {
  if (delta.changePercent === null) {
    return (
      <span className="text-xs text-ink-muted" title="Сравнивать не с чем: в прошлые 30 дней здесь было пусто">
        {compact ? "—" : "нет прошлого периода"}
      </span>
    );
  }
  const up = delta.changePercent >= 0;
  const good = up === betterUp;
  const flat = Math.abs(delta.changePercent) < 0.5;
  return (
    <span
      className={clsx(
        "text-xs tabular-nums",
        flat ? "text-ink-muted" : good ? TONE_TEXT.good : TONE_TEXT.critical
      )}
      title="К предыдущим 30 дням"
    >
      {flat ? "≈" : up ? "▲" : "▼"} {Math.abs(delta.changePercent).toFixed(1)} %
    </span>
  );
}

function Tile({
  label,
  value,
  sub,
  change,
  betterUp = true,
  tone = "neutral",
  subTone,
}: {
  label: string;
  value: string;
  sub?: string;
  change?: Delta;
  betterUp?: boolean;
  /** Цвет всей плитки: применяется только там, где сама цифра хорошая или плохая. */
  tone?: Tone;
  /** Цвет одной подписи: когда тревожная не цифра, а то, что рядом с ней. */
  subTone?: Tone;
}) {
  return (
    <div className={clsx("card !p-4 border", TONE_CARD[tone])}>
      <div className="text-xs text-ink-secondary">{label}</div>
      <div
        className={clsx(
          "text-2xl font-semibold tabular-nums leading-tight mt-1",
          tone !== "neutral" && TONE_TEXT[tone]
        )}
      >
        {value}
      </div>
      <div className="mt-1 flex items-baseline gap-2 flex-wrap">
        {change && <Change delta={change} betterUp={betterUp} />}
        {sub && (
          <span className={clsx("text-xs", subTone ? TONE_TEXT[subTone] : "text-ink-muted")}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

/** Заголовок блока с пояснением: без пояснения цифра ничего не значит. */
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

/** Таблица со свёрнутым хвостом: длинные списки на этой странице обычное дело. */
function Collapsible<T>({
  rows,
  what,
  render,
  head,
  limit = COLLAPSED_TABLE_SIZE,
}: {
  rows: T[];
  /** Слово в кнопке склоняется по числу скрытых строк: «ещё 1 сорт», «ещё 5 сортов». */
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
          <MoreToggle
            expanded={open}
            hidden={hidden}
            onToggle={() => setOpen((v) => !v)}
            what={what(hidden)}
          />
        </div>
      )}
    </div>
  );
}

export default function AnalyticsBoard({ summary }: { summary: AnalyticsSummary }) {
  const s = summary;

  const collectTone = toneHigherBetter(s.collectPercent, BENCHMARKS.collectPercent);
  const writeoffTone =
    s.writeoffPercent === null
      ? "neutral"
      : toneLowerBetter(s.writeoffPercent, BENCHMARKS.writeoffPercent);
  const discountTone =
    s.discountPercent === null
      ? "neutral"
      : toneLowerBetter(s.discountPercent, BENCHMARKS.discountPercent);
  const expiredTone = toneLowerBetter(s.expiredPercent, BENCHMARKS.expiredPercent);
  const clientsTone = toneLowerBetter(s.topClientsPercent, BENCHMARKS.topClientsPercent);

  const maxWeek = Math.max(...s.weeks.map((w) => w.revenue), 1);

  return (
    <div className="space-y-7">
      {/* --- На что смотреть ------------------------------------------------ */}
      {s.attention.length > 0 && (
        <Block
          title="На что смотреть"
          hint="Собрано из цифр ниже — искать глазами не нужно"
        >
          <div className="grid gap-2 md:grid-cols-2">
            {s.attention.map((a, i) => (
              <div
                key={i}
                className={clsx(
                  "card !p-3 border-l-4 !border-l-current",
                  TONE_CARD[a.level],
                  TONE_TEXT[a.level]
                )}
              >
                <div className="font-medium text-sm">{a.title}</div>
                <div className="text-sm text-ink-secondary mt-0.5">{a.detail}</div>
              </div>
            ))}
          </div>
        </Block>
      )}

      {/* --- Продажи -------------------------------------------------------- */}
      <Block title="Продажи" hint={`${s.periodLabel} · сравнение с ${s.prevLabel}`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Tile
            label="Выручка по заявкам"
            value={shortMoney(s.revenue.value)}
            change={s.revenue}
            sub={s.revenue.prev > 0 ? `было ${shortMoney(s.revenue.prev)}` : undefined}
          />
          <Tile
            label="Продано стеблей"
            value={num(s.stems.value)}
            change={s.stems}
            sub={`${num(s.stems.value / s.days)} в день`}
          />
          <Tile
            label="Средняя цена стебля"
            value={money(s.avgPrice.value)}
            change={s.avgPrice}
            sub={s.avgPrice.prev > 0 ? `было ${money(s.avgPrice.prev)}` : undefined}
          />
          <Tile label="Заявок" value={num(s.orders.value)} change={s.orders} />
          <Tile label="Средний чек" value={shortMoney(s.avgCheck.value)} change={s.avgCheck} />
          <Tile
            label="Клиентов"
            value={num(s.clients.value)}
            change={s.clients}
            sub={`топ-3 дают ${pct(s.topClientsPercent, 0)}`}
            subTone={clientsTone}
          />
        </div>
      </Block>

      {/* --- Метрики с ориентирами ------------------------------------------ */}
      <Block
        title="Что должно быть в норме"
        hint="Цвет — сравнение с ориентиром хозяйства, не с прошлым периодом"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Собираемость"
            value={pct(s.collectPercent, 0)}
            tone={collectTone}
            sub={`ориентир от ${BENCHMARKS.collectPercent.good} % · долг всего ${shortMoney(
              s.debtTotal
            )}`}
          />
          <Tile
            label="Списание от принятого"
            value={s.writeoffPercent === null ? "—" : pct(s.writeoffPercent)}
            tone={writeoffTone}
            sub={`ориентир до ${BENCHMARKS.writeoffPercent.good} % · ${num(
              s.writeoffStems.value
            )} шт на ${shortMoney(s.writeoffMoney)}`}
          />
          <Tile
            label="Скидка к прайсу"
            value={
              s.discountPercent === null
                ? "—"
                : s.discountPercent < 0
                  ? "нет"
                  : pct(s.discountPercent)
            }
            tone={discountTone}
            sub={
              s.discountPercent === null
                ? "прайс не заполнен"
                : s.discountPercent < 0
                  ? `продаём выше прайса на ${pct(Math.abs(s.discountPercent))}`
                  : `по прайсу было бы ${shortMoney(s.listRevenue)}`
            }
          />
          <Tile
            label="Просрочено на складе"
            value={pct(s.expiredPercent)}
            tone={expiredTone}
            sub={`${num(s.expiredStems)} шт · скоро истечёт ещё ${num(s.expiringStems)}`}
          />
        </div>
      </Block>

      {/* --- Склад ----------------------------------------------------------- */}
      <Block title="Склад сейчас" hint="Запас — на сколько дней хватит при нынешнем темпе продаж">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Лежит стеблей" value={num(s.stockStems)} sub={`${shortMoney(s.stockMoney)} по прайсу`} />
          <Tile
            label="Средний возраст"
            value={`${dec(s.stockAvgAge)} ${dayWord(Math.round(s.stockAvgAge))}`}
            sub="взвешенный по количеству"
          />
          <Tile
            label="Запаса хватит на"
            value={s.coverDays === null ? "—" : `${Math.round(s.coverDays)} ${dayWord(Math.round(s.coverDays))}`}
            sub={s.coverDays === null ? "продаж за период не было" : "при темпе последних 30 дней"}
          />
          <Tile
            label="Принято за период"
            value={num(s.receivedStems.value)}
            change={s.receivedStems}
            sub={
              s.topGradePercent === null
                ? "приёмки не было"
                : `высшей категории ${pct(s.topGradePercent, 0)}`
            }
          />
        </div>
      </Block>

      {/* --- Единственный график: выручка по неделям ------------------------- */}
      <Block title="Выручка по неделям" hint="Восемь недель, столбик — неделя">
        <div className="card">
          <div className="flex items-end gap-1.5 h-28">
            {s.weeks.map((w, i) => (
              <div key={i} className="flex-1 flex flex-col justify-end h-full" title={w.label}>
                <div className="text-[10px] text-ink-muted text-center tabular-nums mb-1">
                  {w.revenue > 0 ? shortMoney(w.revenue).replace(" ₸", "") : ""}
                </div>
                <div
                  className={clsx(
                    "rounded-t w-full",
                    i === s.weeks.length - 1 ? "bg-accent" : "bg-accent/35"
                  )}
                  style={{ height: `${Math.max(2, (w.revenue / maxWeek) * 100)}%` }}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-1.5 mt-1">
            {s.weeks.map((w, i) => (
              <div key={i} className="flex-1 text-[10px] text-ink-muted text-center truncate">
                {w.label.split(" – ")[0]}
              </div>
            ))}
          </div>
        </div>
      </Block>

      {/* --- По цветку ------------------------------------------------------- */}
      <Block
        title="По цветку за 30 дней"
        hint="Красным — где запаса больше, чем срок хранения: этот цветок не успеет уйти"
      >
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-secondary border-b border-line-hairline">
                <th className="px-4 py-2 font-medium">Цветок</th>
                <th className="px-3 py-2 font-medium text-right">Принято</th>
                <th className="px-3 py-2 font-medium text-right">Продано</th>
                <th className="px-3 py-2 font-medium text-right">Списано</th>
                <th className="px-3 py-2 font-medium text-right">На складе</th>
                <th className="px-3 py-2 font-medium text-right">Запас</th>
                <th className="px-3 py-2 font-medium text-right">Ср. цена</th>
                <th className="px-3 py-2 font-medium text-right">Выручка</th>
              </tr>
            </thead>
            <tbody>
              {s.byFlower.map((f) => {
                const ratio = f.coverDays !== null ? f.coverDays / Math.max(1, f.shelfLifeDays) : null;
                const coverTone: Tone =
                  ratio === null ? "neutral" : toneLowerBetter(ratio, BENCHMARKS.coverRatio);
                return (
                  <tr key={f.flowerType} className="border-b border-line-hairline last:border-0">
                    <td className="px-4 py-2 font-medium">
                      {FLOWER_TYPE_LABELS_PLURAL[f.flowerType] ?? f.flowerType}
                      {f.topGradePercent !== null && (
                        <span className="block text-xs text-ink-muted">
                          высшая в приёмке {pct(f.topGradePercent, 0)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(f.received)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(f.sold)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {f.writeoff > 0 ? num(f.writeoff) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{num(f.stock)}</td>
                    <td className={clsx("px-3 py-2 text-right tabular-nums", TONE_TEXT[coverTone])}>
                      {f.coverDays === null ? "—" : `${Math.round(f.coverDays)} дн.`}
                      <span className="block text-[11px] text-ink-muted">
                        срок {f.shelfLifeDays} дн.
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(f.avgPrice.value)}
                      <span className="block">
                        <Change delta={f.avgPrice} compact />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {shortMoney(f.revenue)}
                      <span className="block text-[11px] text-ink-muted">
                        {pct(f.revenueShare, 0)}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {s.byFlower.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-ink-muted" colSpan={8}>
                    За период ничего не продавалось и не принималось.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Block>

      {/* --- Ростовка -------------------------------------------------------- */}
      {s.byGrade.length > 0 && (
        <Block title="Что продаётся: по ростовке" hint="Стебли, доля и средняя цена продажи">
          <Collapsible
            rows={s.byGrade}
            what={gradeWord}
            head={
              <>
                <th className="px-4 py-2 font-medium">Ростовка</th>
                <th className="px-3 py-2 font-medium text-right">Стеблей</th>
                <th className="px-3 py-2 font-medium text-right">Доля</th>
                <th className="px-3 py-2 font-medium text-right">Ср. цена</th>
                <th className="px-3 py-2 font-medium text-right">Выручка</th>
              </>
            }
            render={(g) => (
              <tr key={`${g.flowerType}:${g.grade}`} className="border-b border-line-hairline last:border-0">
                <td className="px-4 py-2">
                  <span className="text-ink-muted">
                    {FLOWER_TYPE_LABELS[g.flowerType] ?? g.flowerType}{" "}
                  </span>
                  <span className="font-medium">{formatGrade(g.grade)}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{num(g.stems)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                  {pct(g.share, 0)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {money(g.avgPrice.value)}
                  <span className="block">
                    <Change delta={g.avgPrice} compact />
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{shortMoney(g.revenue)}</td>
              </tr>
            )}
          />
        </Block>
      )}

      {/* --- Сорта и клиенты -------------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        {s.topVarieties.length > 0 && (
          <Block title="Сорта по выручке" hint="Изменение — к предыдущим 30 дням">
            <Collapsible
              rows={s.topVarieties}
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
                    <span className="block text-[11px] text-ink-muted">
                      {FLOWER_TYPE_LABELS[v.flowerType] ?? v.flowerType}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(v.stems)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {shortMoney(v.revenue.value)}
                    <span className="block">
                      <Change delta={v.revenue} compact />
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                    {pct(v.share, 0)}
                  </td>
                </tr>
              )}
            />
          </Block>
        )}

        {s.clientRows.length > 0 && (
          <Block
            title="Клиенты"
            hint={`Топ-3 дают ${pct(s.topClientsPercent, 0)} выручки (ориентир — до ${
              BENCHMARKS.topClientsPercent.good
            } %)`}
          >
            <Collapsible
              rows={s.clientRows}
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
                    {shortMoney(c.revenue)}
                    <span className="block text-[11px] text-ink-muted">{pct(c.share, 0)}</span>
                  </td>
                  <td
                    className={clsx(
                      "px-3 py-2 text-right tabular-nums",
                      c.debt > 0 && TONE_TEXT.critical
                    )}
                  >
                    {c.debt > 0 ? shortMoney(c.debt) : "—"}
                  </td>
                </tr>
              )}
            />
          </Block>
        )}
      </div>

      {/* --- Менеджеры и списания -------------------------------------------- */}
      <div className="grid gap-6 lg:grid-cols-2">
        {s.managers.length > 0 && (
          <Block title="Менеджеры" hint="Собираемость — сколько из оформленного уже оплачено">
            <Collapsible
              rows={s.managers}
              what={managerWord}
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
                const tone =
                  m.collectPercent === null
                    ? "neutral"
                    : toneHigherBetter(m.collectPercent, BENCHMARKS.collectPercent);
                return (
                  <tr key={m.managerEmail} className="border-b border-line-hairline last:border-0">
                    <td className="px-4 py-2">
                      <span className="font-medium">{m.managerEmail.split("@")[0]}</span>
                      <span className="block text-[11px] text-ink-muted">
                        средний чек {shortMoney(m.avgCheck)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.orders}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {shortMoney(m.revenue.value)}
                      <span className="block">
                        <Change delta={m.revenue} compact />
                      </span>
                    </td>
                    <td className={clsx("px-3 py-2 text-right tabular-nums", TONE_TEXT[tone])}>
                      {m.collectPercent === null ? "—" : pct(m.collectPercent, 0)}
                    </td>
                  </tr>
                );
              }}
            />
          </Block>
        )}

        <Block title="Списания" hint="Деньги — по действующему прайсу">
          {s.writeoffReasons.length === 0 ? (
            <div className="card text-sm text-ink-muted">
              За 30 дней ничего не списывали. Это либо очень хорошо, либо списания не оформляют —
              второе видно по остаткам, которые не убывают.
            </div>
          ) : (
            <Collapsible
              rows={s.writeoffReasons}
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
                  <td className="px-3 py-2 text-right tabular-nums">{num(r.stems)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-secondary">
                    {pct(r.share, 0)}
                  </td>
                  <td className={clsx("px-3 py-2 text-right tabular-nums", TONE_TEXT.critical)}>
                    {shortMoney(r.money)}
                  </td>
                </tr>
              )}
            />
          )}
        </Block>
      </div>

      {/* --- Партии на грани -------------------------------------------------- */}
      {s.alerts.length > 0 && (
        <Block
          title="Партии, которые скоро сгорят"
          hint="Сверху те, у кого срок прожит сильнее всего"
        >
          <Collapsible
            rows={s.alerts}
            what={batchWord}
            head={
              <>
                <th className="px-4 py-2 font-medium">Позиция</th>
                <th className="px-3 py-2 font-medium text-right">Лежит</th>
                <th className="px-3 py-2 font-medium text-right">Остаток</th>
                <th className="px-3 py-2 font-medium text-right">Деньги</th>
              </>
            }
            render={(a) => (
              <tr key={a.batchId} className="border-b border-line-hairline last:border-0">
                <td className="px-4 py-2">
                  <span className="font-medium">
                    {FLOWER_TYPE_LABELS[a.flowerType] ?? a.flowerType} {a.variety}
                  </span>{" "}
                  <span className="text-ink-secondary">{formatGrade(a.grade)}</span>
                  <span className="block text-[11px] text-ink-muted font-mono">{a.batchId}</span>
                </td>
                <td
                  className={clsx(
                    "px-3 py-2 text-right tabular-nums",
                    a.status === "critical" ? TONE_TEXT.critical : TONE_TEXT.warning
                  )}
                >
                  {a.daysInStorage} из {a.maxDays} дн.
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{num(a.quantityRemaining)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{shortMoney(a.money)}</td>
              </tr>
            )}
          />
        </Block>
      )}

      {/* --- Ориентиры -------------------------------------------------------- */}
      <Block title="Ориентиры" hint="По ним и красится страница. Меняются в коде одной строкой">
        <div className="card text-sm text-ink-secondary">
          <ul className="space-y-1">
            <li>
              Списание — до <b>{BENCHMARKS.writeoffPercent.good} %</b> от принятого хорошо, больше{" "}
              <b>{BENCHMARKS.writeoffPercent.warn} %</b> плохо.
            </li>
            <li>
              Собираемость — от <b>{BENCHMARKS.collectPercent.good} %</b> хорошо, ниже{" "}
              <b>{BENCHMARKS.collectPercent.warn} %</b> плохо.
            </li>
            <li>
              Скидка к прайсу — до <b>{BENCHMARKS.discountPercent.good} %</b> нормально, больше{" "}
              <b>{BENCHMARKS.discountPercent.warn} %</b> значит, что прайс не работает.
            </li>
            <li>
              Просрочка на складе — <b>ноль</b>. Всё, что выше{" "}
              <b>{BENCHMARKS.expiredPercent.warn} %</b>, это уже выброшенные деньги.
            </li>
            <li>
              Запас — не больше <b>{Math.round(BENCHMARKS.coverRatio.good * 100)} %</b> срока
              хранения. Запас длиннее срока означает, что часть цветка не успеет уйти.
            </li>
            <li>
              Три крупнейших клиента — до <b>{BENCHMARKS.topClientsPercent.good} %</b> выручки. Выше{" "}
              <b>{BENCHMARKS.topClientsPercent.warn} %</b> — уход одного клиента вырубает месяц.
            </li>
          </ul>
        </div>
      </Block>
    </div>
  );
}
