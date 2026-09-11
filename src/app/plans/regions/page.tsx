import { Fragment } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listClients } from "@/lib/repo/clients";
import { listShipmentPlans } from "@/lib/repo/shipmentPlans";
import {
  FLOWER_TYPES,
  FLOWER_TYPE_LABELS_PLURAL,
  ORDER_STATUSES,
  isValidPeriod,
  periodLabel,
  periodOf,
  weeksOfMonth,
} from "@/lib/constants";
import { formatDay } from "@/lib/formatDate";
import {
  buildDirectionFact,
  canSeeRegionSales,
  countsAsWholesale,
  ordersMissingDirection,
} from "@/lib/direction";
import SectionTabs from "@/components/SectionTabs";
import PeriodPicker from "@/components/PeriodPicker";
import { plansTabsFor } from "../tabs";
import DirectionFixRow from "@/components/DirectionFixRow";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Оптовые отгрузки по регионам — рабочее место РОПа.
 *
 * Одна страница отвечает на три его вопроса подряд, в том порядке, в каком он
 * их задаёт:
 *
 * 1. «Делаем ли план?» — таблица «план против факта» по направлениям;
 * 2. «Что именно уехало?» — список заявок периода;
 * 3. «Что нужно сделать?» — кнопка «Заявка в регион» и список заявок, которые
 *    похожи на региональные, но направления не несут.
 *
 * Почему факт считается по ДАТЕ ДОСТАВКИ, а не по дате оформления, написано в
 * `buildDirectionFact()`: план называется планом ОТГРУЗОК на неделю, и заявка
 * относится к той неделе, когда цветок уедет.
 *
 * Алматы в списке направлений нет — так решил владелец. Поэтому сумма по
 * направлениям меньше общих продаж, и на странице об этом сказано прямо: иначе
 * первая же сверка с аналитикой выглядит как расхождение в данных.
 */
export default async function RegionSalesPage({
  searchParams,
}: {
  searchParams?: { period?: string; week?: string; flower?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  if (!canSeeRegionSales(role)) redirect("/?error=forbidden");

  const month =
    searchParams?.period && isValidPeriod(searchParams.period)
      ? searchParams.period
      : periodOf(new Date());
  const weeks = weeksOfMonth(month);
  const week = weeks.find((w) => w.code === searchParams?.week) ?? null;

  // Отрезок дат доставки: либо выбранная неделя, либо месяц целиком.
  const from = week ? week.from : weeks[0]?.from ?? `${month}-01`;
  const to = week ? week.to : weeks[weeks.length - 1]?.to ?? `${month}-31`;
  const planPeriods = week ? [week.code] : weeks.map((w) => w.code);

  // Цветок — переключатель, а не ещё три колонки. Девять направлений на три
  // цветка в одной таблице дают двадцать семь строк; так же решено и в сетке
  // плана отгрузок, где цветок тоже переключается.
  const FLOWER_ORDER: string[] = [
    FLOWER_TYPES.ROSE,
    FLOWER_TYPES.CHRYSANTHEMUM,
    FLOWER_TYPES.EUSTOMA,
  ];
  const flower = FLOWER_ORDER.includes(searchParams?.flower ?? "") ? searchParams!.flower! : "";
  // Что дотащить в адрес при переключении месяца и недели, чтобы выбранный
  // цветок не сбрасывался на каждом нажатии.
  const keep = (extra: Record<string, string>) => {
    const params = new URLSearchParams({ period: month, ...extra });
    if (flower) params.set("flower", flower);
    return `/plans/regions?${params.toString()}`;
  };

  const [orders, plans, clients] = await Promise.all([
    listOrdersWithItems(),
    listShipmentPlans(),
    listClients(),
  ]);

  const fact = buildDirectionFact({
    orders,
    plans,
    from,
    to,
    planPeriods,
    cancelledStatus: ORDER_STATUSES.CANCELLED,
    flowerType: flower,
  });
  // Сводка по цветкам всегда считается по ВСЕМ цветкам: она и нужна для того,
  // чтобы сравнить их между собой. Если считать её с тем же фильтром, при
  // выбранной розе в ней осталась бы одна строка — и сравнивать стало бы не с чем.
  const allFlowers = flower
    ? buildDirectionFact({
        orders,
        plans,
        from,
        to,
        planPeriods,
        cancelledStatus: ORDER_STATUSES.CANCELLED,
      })
    : fact;

  const cityByClient = new Map(clients.map((c) => [c.clientId, c.city]));
  const cityByOrder = new Map(
    orders.map((o) => [o.orderId, cityByClient.get(o.clientId) ?? ""])
  );
  const missing = ordersMissingDirection({
    orders,
    cityByOrder,
    from,
    to,
    cancelledStatus: ORDER_STATUSES.CANCELLED,
  });

  // Список заявок считается с тем же фильтром, что и таблицы выше. Показывать
  // под таблицей «только розы» все заявки подряд — верный способ получить
  // вопрос «почему цифры не сходятся»: сходятся, просто считают разное.
  const regionOrders = orders
    .filter((o) => countsAsWholesale(o, ORDER_STATUSES.CANCELLED))
    .filter((o) => o.direction)
    .filter((o) => o.deliveryDate >= from && o.deliveryDate <= to)
    .map((o) => {
      const items = flower ? o.items.filter((i) => i.flowerType === flower) : o.items;
      return {
        orderId: o.orderId,
        clientName: o.clientName,
        deliveryDate: o.deliveryDate,
        direction: o.direction,
        stems: items.reduce((s, i) => s + i.quantity, 0),
        shipped: items.reduce((s, i) => s + i.shippedQuantity, 0),
        amount: items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
        items: items.length,
      };
    })
    .filter((o) => o.items > 0)
    .sort((a, b) => (a.deliveryDate < b.deliveryDate ? -1 : 1));

  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)} %`);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h1 className="text-xl font-semibold">Оптовые отгрузки по регионам</h1>
        <Link href="/orders/new?direction=" className="btn-primary">
          + Заявка в регион
        </Link>
      </div>
      <p className="text-ink-secondary mb-3">
        План отгрузок против того, что реально ушло. Заявки по Алматы сюда не входят: направления
        «Алматы» нет, и это сделано намеренно.
      </p>

      <div className="mb-4">
        <SectionTabs tabs={plansTabsFor(role)} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <PeriodPicker period={month} />
        <div className="flex flex-wrap gap-2">
          <WeekPill href={keep({})} active={!week} label="Весь месяц" />
          {weeks.map((w) => (
            <WeekPill
              key={w.code}
              href={keep({ week: w.code })}
              active={week?.code === w.code}
              label={w.shortLabel}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-sm text-ink-secondary">Цветок:</span>
        <WeekPill
          href={`/plans/regions?period=${month}${week ? `&week=${week.code}` : ""}`}
          active={!flower}
          label="Все"
        />
        {FLOWER_ORDER.map((f) => {
          const params = new URLSearchParams({ period: month, flower: f });
          if (week) params.set("week", week.code);
          return (
            <WeekPill
              key={f}
              href={`/plans/regions?${params.toString()}`}
              active={flower === f}
              label={FLOWER_TYPE_LABELS_PLURAL[f] ?? f}
            />
          );
        })}
      </div>

      <p className="text-xs text-ink-muted mb-3">
        Считаются заявки с датой доставки {formatDay(from)} — {formatDay(to)}. Отменённые и заявки в
        наши магазины не в счёт.
      </p>

      <div className="grid sm:grid-cols-4 gap-3 mb-5">
        <Tile title="План" value={nf(fact.planStems)} hint="стеблей за период" />
        <Tile title="Заказано" value={nf(fact.orderedStems)} hint={`заявок: ${fact.orders}`} />
        <Tile
          title="Отгружено"
          value={nf(fact.shippedStems)}
          hint={
            fact.orderedStems > fact.shippedStems
              ? `ещё не уехало ${nf(fact.orderedStems - fact.shippedStems)}`
              : "всё уехало"
          }
          warn={fact.orderedStems > fact.shippedStems}
        />
        <Tile
          title="Выполнение"
          value={pct(fact.donePercent)}
          hint={fact.planStems > 0 ? "заказано от плана" : "план на период не поставлен"}
          warn={fact.donePercent !== null && fact.donePercent < 80}
        />
      </div>

      {missing.length > 0 && (
        <div className="card mb-5 border-[#d9b25c]">
          <h2 className="font-medium mb-1">Похоже на регион, но направление не стоит</h2>
          <p className="text-sm text-ink-secondary mb-3">
            Эти заявки завёл менеджер — у него поля направления нет. По городу клиента видно, куда
            они едут. Поставьте направление, иначе в план они не попадут.
          </p>
          <div className="space-y-2">
            {missing.map((m) => (
              <DirectionFixRow
                key={m.orderId}
                orderId={m.orderId}
                clientName={m.clientName}
                deliveryDate={formatDay(m.deliveryDate)}
                suggested={m.suggested}
              />
            ))}
          </div>
        </div>
      )}

      <h2 className="font-medium mb-2">По цветку</h2>
      <div className="card !p-0 overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-2.5 font-medium">Цветок</th>
              <th className="px-3 py-2.5 font-medium text-right">План, шт</th>
              <th className="px-3 py-2.5 font-medium text-right">Заказано</th>
              <th className="px-3 py-2.5 font-medium text-right">Отгружено</th>
              <th className="px-3 py-2.5 font-medium text-right">Выполнение</th>
              <th className="px-3 py-2.5 font-medium text-right">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {allFlowers.byFlower.map((f) => (
              <tr
                key={f.flowerType}
                className={
                  "border-b border-line-hairline last:border-0 " +
                  (flower && flower !== f.flowerType ? "opacity-45" : "")
                }
              >
                <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {FLOWER_TYPE_LABELS_PLURAL[f.flowerType] ?? f.flowerType}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">
                  {f.planStems > 0 ? nf(f.planStems) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                  {f.orderedStems > 0 ? nf(f.orderedStems) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {f.shippedStems > 0 ? nf(f.shippedStems) : "—"}
                </td>
                <td
                  className={
                    "px-3 py-2.5 text-right tabular-nums " +
                    (f.donePercent === null
                      ? "text-ink-muted"
                      : f.donePercent >= 100
                        ? "text-status-good"
                        : f.donePercent >= 80
                          ? ""
                          : "text-[#8a5a00]")
                  }
                >
                  {pct(f.donePercent)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {f.amount > 0 ? `${nf(f.amount)} ₸` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-medium mb-2">
        По направлениям
        {flower ? ` · ${FLOWER_TYPE_LABELS_PLURAL[flower] ?? flower}` : ""}
      </h2>
      <div className="card !p-0 overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-2.5 font-medium">Направление</th>
              <th className="px-3 py-2.5 font-medium text-right">План, шт</th>
              <th className="px-3 py-2.5 font-medium text-right">Заказано</th>
              <th className="px-3 py-2.5 font-medium text-right">Отгружено</th>
              <th className="px-3 py-2.5 font-medium text-right">Выполнение</th>
              <th className="px-3 py-2.5 font-medium text-right">Сумма</th>
              <th className="px-3 py-2.5 font-medium text-right">Заявок</th>
            </tr>
          </thead>
          <tbody>
            {fact.groups.map((group) => {
              // Пустые блоки не показываем совсем: у хозяйства их четыре, и
              // три строки прочерков вместо «Экспорта» только мешают читать.
              const useful = group.rows.filter(
                (r) => r.planStems > 0 || r.orderedStems > 0 || r.orders > 0
              );
              if (useful.length === 0) return null;
              // Заголовок блока и его строки идут в ОДИН И ТОТ ЖЕ tbody.
              // Сначала каждый блок был вложенной таблицей внутри ячейки — и
              // колонки «Экспорта» встали по своим ширинам, не совпав с
              // колонками «Регионов». Числа в соседних строках оказались в
              // разных местах; на скриншоте это видно сразу, в вёрстке — нет.
              return (
                <Fragment key={group.key}>
                  <tr className="bg-surface-plane/60 border-b border-line-hairline">
                    <td colSpan={7} className="px-4 py-1.5 text-xs text-ink-secondary">
                      {group.label}
                    </td>
                  </tr>
                  {useful.map((r) => (
                    <tr key={r.direction} className="border-b border-line-hairline">
                      <td className="px-4 py-2.5 font-medium whitespace-nowrap">{r.direction}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">
                        {r.planStems > 0 ? nf(r.planStems) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                        {r.orderedStems > 0 ? nf(r.orderedStems) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {r.shippedStems > 0 ? nf(r.shippedStems) : "—"}
                      </td>
                      <td
                        className={
                          "px-3 py-2.5 text-right tabular-nums " +
                          (r.donePercent === null
                            ? "text-ink-muted"
                            : r.donePercent >= 100
                              ? "text-status-good"
                              : r.donePercent >= 80
                                ? ""
                                : "text-[#8a5a00]")
                        }
                      >
                        {pct(r.donePercent)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {r.amount > 0 ? `${nf(r.amount)} ₸` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">
                        {r.orders || "—"}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {fact.planStems === 0 && fact.orderedStems === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-muted">
                  За этот период ни плана, ни отгрузок по регионам нет.{" "}
                  <Link href={`/plans/shipments?period=${month}`} className="text-accent hover:underline">
                    Поставить план
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="bg-surface-plane/60">
              <td className="px-4 py-2.5 font-medium">Всего</td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {nf(fact.planStems)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {nf(fact.orderedStems)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {nf(fact.shippedStems)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {pct(fact.donePercent)}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                {nf(fact.amount)} ₸
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums font-medium">{fact.orders}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h2 className="font-medium mb-2">
        Заявки периода
        {flower ? ` · только ${(FLOWER_TYPE_LABELS_PLURAL[flower] ?? flower).toLowerCase()}` : ""}
      </h2>
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-2.5 font-medium">Доставка</th>
              <th className="px-3 py-2.5 font-medium">Направление</th>
              <th className="px-3 py-2.5 font-medium">Клиент</th>
              <th className="px-3 py-2.5 font-medium">Заявка</th>
              <th className="px-3 py-2.5 font-medium text-right">Стеблей</th>
              <th className="px-3 py-2.5 font-medium text-right">Отгружено</th>
              <th className="px-3 py-2.5 font-medium text-right">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {regionOrders.map((o) => (
              <tr key={o.orderId} className="border-b border-line-hairline last:border-0">
                <td className="px-4 py-2.5 whitespace-nowrap text-ink-secondary">
                  {formatDay(o.deliveryDate)}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap font-medium">{o.direction}</td>
                <td className="px-3 py-2.5">{o.clientName}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <Link href={`/orders/${o.orderId}`} className="hover:underline">
                    {o.orderId}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{nf(o.stems)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-secondary">
                  {o.shipped > 0 ? nf(o.shipped) : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{nf(o.amount)} ₸</td>
              </tr>
            ))}
            {regionOrders.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-muted">
                  {flower
                    ? `Заявок в регионы по этому цветку за период нет.`
                    : "Заявок в регионы за этот период нет."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WeekPill({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={
        "px-3 py-1.5 rounded-lg text-sm border transition-colors " +
        (active
          ? "border-accent bg-accent-soft text-ink-primary font-medium"
          : "border-line-hairline text-ink-secondary hover:text-ink-primary")
      }
    >
      {label}
    </Link>
  );
}

function Tile({
  title,
  value,
  hint,
  warn,
}: {
  title: string;
  value: string;
  hint: string;
  warn?: boolean;
}) {
  return (
    <div className="card">
      <div className="text-sm text-ink-secondary">{title}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      <div className={`text-xs mt-1 ${warn ? "text-[#8a5a00]" : "text-ink-muted"}`}>{hint}</div>
    </div>
  );
}
