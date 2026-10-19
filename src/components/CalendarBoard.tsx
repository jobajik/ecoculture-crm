"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { CalendarDay, CalendarMonth } from "@/lib/calendar";
import CardTabs from "./CardTabs";
import Pager, { pageSlice } from "./Pager";

/** Что подсвечивать цветом в клетках. Одна метрика за раз — иначе рябит. */
type Heat = "sold" | "received" | "shipped" | "paid";

const HEAT_LABELS: Record<Heat, string> = {
  sold: "Продажи",
  received: "Срез",
  shipped: "Отгрузки",
  paid: "Деньги",
};

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function nf(n: number): string {
  return Math.round(n).toLocaleString("ru-RU");
}

/** «1 заявка», «2 заявки», «5 заявок» — числа в подписях должны читаться по-русски. */
function plural(n: number, one: string, few: string, many: string): string {
  const t = Math.abs(n) % 100;
  const o = t % 10;
  if (t > 10 && t < 20) return `${n} ${many}`;
  if (o === 1) return `${n} ${one}`;
  if (o > 1 && o < 5) return `${n} ${few}`;
  return `${n} ${many}`;
}

function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} млн`;
  if (abs >= 10_000) return `${Math.round(n / 1000)} тыс`;
  return nf(n);
}

/**
 * Календарь месяца: клетка на день, клик — подробности под календарём.
 *
 * Отчёт отвечает на вопрос «сколько за тридцать дней», календарь — «а что было
 * во вторник». Второй вопрос задают, когда что-то пошло не так: почему в среду
 * не отгрузили, куда делся большой срез, кто вытянул субботу. Поэтому клетка
 * показывает четыре числа дня, а клик раскрывает, из чего они сложились.
 *
 * Подсветка — по ОДНОЙ метрике за раз (переключатель сверху). Красить клетку
 * сразу по четырём значило бы не подсветить ничего.
 */
export default function CalendarBoard({ data }: { data: CalendarMonth }) {
  const [heat, setHeat] = useState<Heat>("sold");
  // По умолчанию открыт самый свежий прошедший день: чаще всего смотрят «что
  // было вчера-сегодня», а не первое число.
  const [selected, setSelected] = useState<string | null>(() => {
    const passed = data.days.filter((d) => !d.future);
    const withWork = [...passed].reverse().find((d) => d.orderCount > 0 || d.receivedStems > 0);
    return (withWork ?? passed[passed.length - 1] ?? data.days[0])?.date ?? null;
  });

  const day = useMemo(
    () => data.days.find((d) => d.date === selected) ?? null,
    [data.days, selected]
  );

  const heatValue = (d: CalendarDay) =>
    heat === "sold"
      ? d.soldMoney
      : heat === "received"
        ? d.receivedStems
        : heat === "shipped"
          ? d.shippedStems
          : d.paidMoney;

  const heatMax =
    heat === "sold"
      ? data.max.sold
      : heat === "received"
        ? data.max.received
        : heat === "shipped"
          ? data.max.shipped
          : data.max.paid;

  return (
    <div className="grid gap-5 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] items-start">
      <div className="card !p-0 overflow-hidden">
        {/* Подсветка — вкладками карточки: по какой цифре красить дни. */}
        <CardTabs
          tone="analytics"
          items={(Object.keys(HEAT_LABELS) as Heat[]).map((k) => ({ key: k, label: HEAT_LABELS[k] }))}
          value={heat}
          onChange={setHeat}
          right={<span className="text-xs text-ink-muted">нажмите на день — подробности рядом</span>}
        />
      <div className="table-scroll">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-7 border-b border-line-hairline bg-surface-plane/60">
            {WEEKDAYS.map((w, i) => (
              <div
                key={w}
                className={clsx(
                  "px-3 py-2.5 text-xs font-medium",
                  i >= 5 ? "text-ink-muted" : "text-ink-secondary"
                )}
              >
                {w}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {Array.from({ length: data.leadingBlanks }).map((_, i) => (
              <div key={`blank-${i}`} className="border-b border-r border-line-hairline bg-surface-plane/40" />
            ))}
            {data.days.map((d) => (
              <DayCell
                key={d.date}
                day={d}
                heatShare={heatMax > 0 ? heatValue(d) / heatMax : 0}
                selected={d.date === selected}
                onSelect={() => setSelected(d.date)}
              />
            ))}
          </div>
        </div>
      </div>
      </div>

      {day && <DayDetails key={day.date} day={day} />}
    </div>
  );
}

function DayCell({
  day,
  heatShare,
  selected,
  onSelect,
}: {
  day: CalendarDay;
  heatShare: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const empty =
    day.soldMoney === 0 && day.receivedStems === 0 && day.shippedStems === 0 && day.paidMoney === 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={clsx(
        "relative text-left border-b border-r border-line-hairline p-2 min-h-[104px] align-top transition-colors",
        "hover:bg-accent-soft/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        selected && "ring-2 ring-accent ring-inset",
        day.future && "bg-surface-plane/40"
      )}
    >
      {/* Подсветка отдельным слоем: так насыщенность не влияет на читаемость
          цифр — они всегда лежат поверх. */}
      {heatShare > 0 && (
        <span
          aria-hidden
          className="absolute inset-0 bg-accent"
          style={{ opacity: 0.05 + Math.min(0.28, heatShare * 0.28) }}
        />
      )}

      <span className="relative flex items-center justify-between">
        <span
          className={clsx(
            "text-sm font-medium",
            day.isToday && "inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent text-white",
            !day.isToday && day.weekday >= 6 && "text-ink-muted"
          )}
        >
          {day.day}
        </span>
        {day.orderCount > 0 && (
          <span className="text-[10px] text-ink-muted">{day.orderCount} зв.</span>
        )}
      </span>

      <span className="relative block mt-1 space-y-0.5 text-[11px] tabular-nums">
        {day.receivedStems > 0 && (
          <span className="block text-ink-secondary">
            <span className="text-ink-muted">срез</span> {nf(day.receivedStems)}
          </span>
        )}
        {day.soldMoney > 0 && (
          <span className="block font-medium text-ink-primary">
            <span className="text-ink-muted font-normal">прод.</span> {money(day.soldMoney)} ₸
          </span>
        )}
        {day.shippedStems > 0 && (
          <span className="block text-ink-secondary">
            <span className="text-ink-muted">отгр.</span> {nf(day.shippedStems)}
          </span>
        )}
        {day.paidMoney > 0 && (
          <span className="block text-status-good">
            <span className="text-ink-muted">опл.</span> {money(day.paidMoney)} ₸
          </span>
        )}
        {empty && !day.future && <span className="block text-ink-muted">—</span>}
      </span>
    </button>
  );
}

type DayTab = "orders" | "managers" | "received" | "shipped" | "payments" | "writeoffs";

function DayDetails({ day }: { day: CalendarDay }) {
  const date = new Date(`${day.date}T00:00:00`);
  const title = date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  });

  const nothing =
    day.orderCount === 0 &&
    day.receivedStems === 0 &&
    day.shippedStems === 0 &&
    day.paidMoney === 0;

  // Разрезы дня — вкладками одной карточки, а не шестью карточками друг под другом.
  const tabs: { key: DayTab; label: string }[] = [
    ...(day.orders.length > 0 ? [{ key: "orders" as DayTab, label: `Заявки (${day.orders.length})` }] : []),
    ...(day.byManager.length > 0 ? [{ key: "managers" as DayTab, label: "Кто продал" }] : []),
    ...(day.receivedByFlower.length > 0 ? [{ key: "received" as DayTab, label: "Срез" }] : []),
    ...(day.shippedByFlower.length > 0 ? [{ key: "shipped" as DayTab, label: "Отгрузки" }] : []),
    ...(day.payments.length > 0 ? [{ key: "payments" as DayTab, label: `Оплаты (${day.payments.length})` }] : []),
    ...(day.writeoffs.length > 0 ? [{ key: "writeoffs" as DayTab, label: "Списания" }] : []),
  ];
  const [tab, setTab] = useState<DayTab>(tabs[0]?.key ?? "orders");
  const shownTab = tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key;

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 sm:px-5 pt-4">
        <h2 className="font-display text-[17px] font-bold first-letter:uppercase">{title}</h2>
        {day.future && <span className="text-sm text-ink-muted">День ещё не наступил</span>}
      </div>

      <div className="grid grid-cols-2 gap-2.5 px-4 sm:px-5 py-4">
        <Tile
          label="Срезали и приняли"
          value={`${nf(day.receivedStems)} шт`}
          sub={day.receivedMoney > 0 ? `${money(day.receivedMoney)} ₸ по прайсу` : undefined}
        />
        <Tile
          label="Продали"
          value={`${money(day.soldMoney)} ₸`}
          sub={
            day.soldStems > 0
              ? `${nf(day.soldStems)} шт · ${plural(day.orderCount, "заявка", "заявки", "заявок")}`
              : undefined
          }
        />
        <Tile
          label="Отгрузили"
          value={`${nf(day.shippedStems)} шт`}
          sub={day.shipmentCount > 0 ? plural(day.shipmentCount, "отгрузка", "отгрузки", "отгрузок") : undefined}
        />
        <Tile
          label="Пришло денег"
          value={`${money(day.paidMoney)} ₸`}
          sub={day.payments.length > 0 ? plural(day.payments.length, "оплата", "оплаты", "оплат") : undefined}
          tone="good"
        />
      </div>

      {nothing || !shownTab ? (
        <div className="text-center py-10 text-sm text-ink-muted border-t border-line-hairline">
          {day.future ? "Пока пусто." : "В этот день ничего не было."}
        </div>
      ) : (
        <>
          <div className="border-t border-line-hairline">
            <CardTabs tone="analytics" items={tabs} value={shownTab} onChange={setTab} />
          </div>

          <div key={shownTab}>
          {shownTab === "orders" && (
            <PagedTable
              head={["Клиент", "Менеджер", "Сумма", "Оплата"]}
              what="заявок"
              rows={day.orders.map((o) => [
                <Link key={o.orderId} href={`/orders/${o.orderId}`} className="font-semibold hover:underline">
                  {o.clientName}
                </Link>,
                o.managerName,
                `${money(o.amount)} ₸`,
                o.paidAmount >= o.amount - 1 && o.paidAmount > 0 ? (
                  <span key="p" className="text-status-good">
                    оплачено
                  </span>
                ) : o.paidAmount > 0 ? (
                  <span key="p" className="text-[#8a5a00]">
                    {money(o.paidAmount)} из {money(o.amount)}
                  </span>
                ) : (
                  <span key="p" className="text-ink-muted">
                    ждём
                  </span>
                ),
              ])}
            />
          )}

          {shownTab === "managers" && (
            <PagedTable
              head={["Менеджер", "Заявок", "Стеблей", "Сумма"]}
              what="менеджеров"
              rows={day.byManager.map((m) => [m.label, String(m.count), nf(m.stems), `${money(m.amount)} ₸`])}
            />
          )}

          {shownTab === "received" && (
            <>
              <PagedTable
                head={["Цветок", "Партий", "Стеблей", "По прайсу"]}
                what="цветков"
                rows={day.receivedByFlower.map((f) => [f.label, String(f.count), nf(f.stems), `${money(f.amount)} ₸`])}
              />
              {day.receivedByGrade.length > 0 && (
                <>
                  <div className="px-4 sm:px-5 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted border-t border-line-hairline">
                    По ростовке и категории
                  </div>
                  <PagedTable
                    head={["Позиция", "Стеблей"]}
                    what="позиций"
                    rows={day.receivedByGrade.map((g) => [g.label, nf(g.stems)])}
                  />
                </>
              )}
            </>
          )}

          {shownTab === "shipped" && (
            <PagedTable
              head={["Цветок", "Отгрузок", "Стеблей"]}
              what="цветков"
              rows={day.shippedByFlower.map((f) => [f.label, String(f.count), nf(f.stems)])}
            />
          )}

          {shownTab === "payments" && (
            <PagedTable
              head={["Клиент", "Способ", "Сумма"]}
              what="оплат"
              rows={day.payments.map((p) => [
                <Link key={p.orderId} href={`/orders/${p.orderId}`} className="font-semibold hover:underline">
                  {p.clientName}
                </Link>,
                p.method || "—",
                `${money(p.amount)} ₸`,
              ])}
            />
          )}

          {shownTab === "writeoffs" && (
            <PagedTable
              head={["Причина", "Стеблей"]}
              what="причин"
              rows={day.writeoffs.map((w) => [w.reason, nf(w.stems)])}
            />
          )}
          </div>
        </>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good";
}) {
  return (
    <div className="rounded-xl bg-surface-plane px-3 py-2.5">
      <div className="text-xs text-ink-muted mb-1">{label}</div>
      <div
        className={clsx(
          "font-display text-lg font-extrabold tabular-nums leading-tight",
          tone === "good" ? "text-status-good" : "text-ink-primary"
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}

/** Таблица разреза дня страницами (новый вид: вместо «показать ещё N»). */
function PagedTable({ head, rows, what }: { head: string[]; rows: React.ReactNode[][]; what: string }) {
  const [page, setPage] = useState(0);
  const shown = pageSlice(rows, page);
  return (
    <>
      <div className="table-scroll">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
              {head.map((h, i) => (
                <th key={h} className={clsx("px-4 py-2.5 font-medium", i > 0 && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) => (
              <tr key={i} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane/60">
                {row.map((cell, j) => (
                  <td key={j} className={clsx("px-4 py-2.5", j > 0 && "text-right tabular-nums whitespace-nowrap")}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager total={rows.length} page={page} onPage={setPage} what={what} />
    </>
  );
}
