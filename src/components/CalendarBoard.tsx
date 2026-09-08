"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import type { CalendarDay, CalendarMonth } from "@/lib/calendar";
import MoreToggle from "./MoreToggle";

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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {(Object.keys(HEAT_LABELS) as Heat[]).map((k) => (
            <button
              key={k}
              onClick={() => setHeat(k)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-sm border transition-colors",
                heat === k
                  ? "bg-accent text-white border-accent"
                  : "border-line-hairline text-ink-secondary hover:bg-surface-plane"
              )}
            >
              {HEAT_LABELS[k]}
            </button>
          ))}
        </div>
        <span className="text-xs text-ink-muted">
          Цветом выделено «{HEAT_LABELS[heat].toLowerCase()}»: чем насыщеннее клетка, тем больше день
        </span>
      </div>

      <div className="card !p-0 overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-7 border-b border-line-hairline">
            {WEEKDAYS.map((w, i) => (
              <div
                key={w}
                className={clsx(
                  "px-3 py-2 text-xs font-medium",
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

      {day && <DayDetails day={day} />}
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

function DayDetails({ day }: { day: CalendarDay }) {
  const [showAllOrders, setShowAllOrders] = useState(false);
  const [showAllGrades, setShowAllGrades] = useState(false);
  const VISIBLE = 6;
  const orders = showAllOrders ? day.orders : day.orders.slice(0, VISIBLE);
  // Ростовок за большой срез набегает под двадцать строк — столько сразу не
  // читают, а карточка рядом из-за них уезжает вниз на пол-экрана.
  const grades = showAllGrades ? day.receivedByGrade : day.receivedByGrade.slice(0, VISIBLE);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-medium first-letter:uppercase">{title}</h2>
        {day.future && <span className="text-sm text-ink-muted">День ещё не наступил</span>}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Срезали и приняли" value={`${nf(day.receivedStems)} шт`} sub={
          day.receivedMoney > 0 ? `${money(day.receivedMoney)} ₸ по прайсу` : undefined
        } />
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
          sub={
            day.shipmentCount > 0
              ? plural(day.shipmentCount, "отгрузка", "отгрузки", "отгрузок")
              : undefined
          }
        />
        <Tile
          label="Пришло денег"
          value={`${money(day.paidMoney)} ₸`}
          sub={
            day.payments.length > 0
              ? plural(day.payments.length, "оплата", "оплаты", "оплат")
              : undefined
          }
          tone="good"
        />
      </div>

      {nothing ? (
        <div className="card text-center py-8 text-sm text-ink-secondary">
          {day.future
            ? "Это будущий день — здесь появятся срез, заявки и отгрузки."
            : "В этот день ничего не оформляли, не принимали и не отгружали."}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {day.byManager.length > 0 && (
            <Block title="Кто продал" hint="Заявки, оформленные в этот день">
              <Table
                head={["Менеджер", "Заявок", "Стеблей", "Сумма"]}
                rows={day.byManager.map((m) => [
                  m.label,
                  String(m.count),
                  nf(m.stems),
                  `${money(m.amount)} ₸`,
                ])}
              />
            </Block>
          )}

          {day.receivedByFlower.length > 0 && (
            <Block title="Что срезали" hint="Приёмка на склад">
              <Table
                head={["Цветок", "Партий", "Стеблей", "По прайсу"]}
                rows={day.receivedByFlower.map((f) => [
                  f.label,
                  String(f.count),
                  nf(f.stems),
                  `${money(f.amount)} ₸`,
                ])}
              />
            </Block>
          )}

          {day.orders.length > 0 && (
            <Block title="Заявки за день" hint="Кому продали и оплачено ли">
              <Table
                head={["Клиент", "Менеджер", "Сумма", "Оплата"]}
                rows={orders.map((o) => [
                  <Link key={o.orderId} href={`/orders/${o.orderId}`} className="hover:underline">
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
              <MoreToggle
                expanded={showAllOrders}
                hidden={day.orders.length - orders.length}
                onToggle={() => setShowAllOrders((v) => !v)}
                what="заявок"
                className="mt-2"
              />
            </Block>
          )}

          {day.receivedByGrade.length > 0 && (
            <Block title="Срез по ростовке и категории" hint="Что именно дало производство">
              <Table
                head={["Позиция", "Стеблей"]}
                rows={grades.map((g) => [g.label, nf(g.stems)])}
              />
              <MoreToggle
                expanded={showAllGrades}
                hidden={day.receivedByGrade.length - grades.length}
                onToggle={() => setShowAllGrades((v) => !v)}
                what="позиций"
                className="mt-2"
              />
            </Block>
          )}

          {day.shippedByFlower.length > 0 && (
            <Block title="Что отгрузили" hint="Ушло со склада в этот день">
              <Table
                head={["Цветок", "Отгрузок", "Стеблей"]}
                rows={day.shippedByFlower.map((f) => [f.label, String(f.count), nf(f.stems)])}
              />
            </Block>
          )}

          {day.payments.length > 0 && (
            <Block title="Оплаты" hint="Деньги, пришедшие в этот день">
              <Table
                head={["Клиент", "Способ", "Сумма"]}
                rows={day.payments.map((p) => [
                  <Link key={p.orderId} href={`/orders/${p.orderId}`} className="hover:underline">
                    {p.clientName}
                  </Link>,
                  p.method || "—",
                  `${money(p.amount)} ₸`,
                ])}
              />
            </Block>
          )}

          {day.writeoffs.length > 0 && (
            <Block title="Списания" hint="Что не дожило до продажи">
              <Table
                head={["Причина", "Стеблей"]}
                rows={day.writeoffs.map((w) => [w.reason, nf(w.stems)])}
              />
            </Block>
          )}
        </div>
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
    <div className="card !p-4">
      <div className="text-xs text-ink-secondary mb-1">{label}</div>
      <div
        className={clsx(
          "text-xl font-semibold tabular-nums",
          tone === "good" ? "text-status-good" : "text-ink-primary"
        )}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-ink-muted mt-1">{sub}</div>}
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
    <div className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-2">
        <h3 className="font-medium text-sm">{title}</h3>
        {hint && <span className="text-xs text-ink-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-ink-secondary border-b border-line-hairline">
            {head.map((h, i) => (
              <th key={h} className={clsx("py-1.5 font-medium", i > 0 && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line-hairline last:border-0">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={clsx("py-1.5", j > 0 && "text-right tabular-nums whitespace-nowrap")}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
