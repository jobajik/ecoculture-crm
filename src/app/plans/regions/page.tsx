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
  weeksOfMonth,
} from "@/lib/constants";
import { formatDay } from "@/lib/formatDate";
import {
  buildDirectionFact,
  canSeeRegionSales,
  countsAsWholesale,
  ordersMissingDirection,
} from "@/lib/direction";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import RegionOrdersTable from "@/components/RegionOrdersTable";
import { orderCode } from "@/lib/paymentStage";
import Section from "@/components/Section";
import PeriodPicker from "@/components/PeriodPicker";
import Hint from "@/components/Hint";
import { plansTabsFor } from "../tabs";
import ShipmentsViewSwitch from "../ShipmentsViewSwitch";
import { monthFrom, prefetchPlanTabs } from "../data";
import DirectionFixRow from "@/components/DirectionFixRow";
import { buildRegionIncome, isRegionOrder } from "@/lib/orderKind";
import PlanProgress, { TONE_TEXT, paceTone } from "@/components/PlanProgress";
import { localDayKey } from "@/lib/timezone";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * «Планы → Отгрузки → Факт и заявки»: оптовые отгрузки по регионам.
 *
 * Раньше это была отдельная вкладка «Регионы»; теперь — второй вид вкладки
 * «Отгрузки» (переключатель `ShipmentsViewSwitch`), потому что это факт того же
 * самого плана.
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
 *
 * Вид (сентябрь, «слишком много загажено»): шесть плиток и таблица «По цветку»
 * сведены в одну карточку с полоской темпа, проценты цветков стоят прямо на
 * переключателе цветка, а список заявок свёрнут — он нужен, когда ищут
 * конкретную заявку, а не каждый раз.
 */
export default async function RegionSalesPage({
  searchParams,
}: {
  searchParams?: { period?: string; week?: string; flower?: string; view?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  if (!canSeeRegionSales(role)) redirect("/?error=forbidden");

  const month = monthFrom(searchParams?.period);
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

  await prefetchPlanTabs();
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
        // У городской заявки цены нет — показываем то, что подтвердил
        // бухгалтер. У обычной клиентской заявки в регион это сумма счёта.
        amount: isRegionOrder(o)
          ? o.paidAmount
          : items.reduce((s, i) => s + i.quantity * i.unitPrice, 0),
        items: items.length,
      };
    })
    .filter((o) => o.items > 0)
    .sort((a, b) => (a.deliveryDate < b.deliveryDate ? -1 : 1));

  // Поступления по городам — их подтверждает бухгалтер, и к плану в стеблях
  // они отношения не имеют: объём ставит РОП сразу, деньги приходят потом.
  const income = buildRegionIncome({
    orders,
    from,
    to,
    cancelledStatus: ORDER_STATUSES.CANCELLED,
  });
  const incomeByDirection = new Map(income.map((r) => [r.direction, r]));
  const incomeTotal = income.reduce((s, r) => s + r.income, 0);
  const waitingIncome = income.reduce((s, r) => s + r.waitingIncome, 0);

  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");
  const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)} %`);

  // Темп — какая доля выбранного отрезка уже прошла (для недели — по дням недели).
  const today = localDayKey();
  const dayNo = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000;
  const pace =
    today < from ? 0 : today > to ? 100 : ((dayNo(today) - dayNo(from) + 1) / (dayNo(to) - dayNo(from) + 1)) * 100;
  const tone = paceTone(fact.donePercent, pace);
  const notShipped = fact.orderedStems - fact.shippedStems;
  const cityOrders = income.reduce((s, r) => s + r.orders, 0);
  const flowerHref = (f: string) => {
    const params = new URLSearchParams({ period: month });
    if (f) params.set("flower", f);
    if (week) params.set("week", week.code);
    return `/plans/regions?${params.toString()}`;
  };

  const view = searchParams?.view === "orders" ? "orders" : "directions";
  const viewHref = (v: "directions" | "orders") => {
    const params = new URLSearchParams({ period: month });
    if (flower) params.set("flower", flower);
    if (week) params.set("week", week.code);
    if (v === "orders") params.set("view", "orders");
    return `/plans/regions?${params.toString()}`;
  };

  return (
    <div>
      <PageHeader
        area="plans"
        title="Отгрузки по регионам"
        icon="route"
        tabs={plansTabsFor(role, month)}
        actions={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <ShipmentsViewSwitch view="fact" month={month} />
            <PeriodPicker period={month} />
            <Link href="/orders/new?region=1" className="btn-primary">
              + Объём в регион
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile
          icon="truck"
          label="Заказано, шт"
          value={nf(fact.orderedStems)}
          hint={fact.planStems > 0 ? `${pct(fact.donePercent)} от плана ${nf(fact.planStems)}` : "плана на период нет"}
          tone={fact.planStems > 0 ? (tone === "good" ? "good" : tone === "warn" ? "warn" : tone === "critical" ? "bad" : undefined) : undefined}
        />
        <KpiTile
          icon="box"
          label="Отгружено, шт"
          value={nf(fact.shippedStems)}
          hint={notShipped > 0 ? `ещё не уехало ${nf(notShipped)}` : fact.orderedStems > 0 ? "всё уехало" : undefined}
          tone={notShipped > 0 ? "warn" : fact.orderedStems > 0 ? "good" : undefined}
        />
        <KpiTile
          icon="wallet"
          label="Поступило"
          value={`${nf(incomeTotal)} ₸`}
          hint={waitingIncome > 0 ? `ждут суммы от бухгалтера: ${waitingIncome}` : undefined}
          tone={waitingIncome > 0 ? "warn" : undefined}
        />
        <KpiTile
          icon="order"
          label="Заявок"
          value={String(fact.orders)}
          hint={cityOrders > 0 ? `из них объём на города: ${cityOrders}` : undefined}
        />
      </div>

      {missing.length > 0 && (
        <Section
          tone="warn"
          icon="alert"
          title={
            <>
              Похоже на регион, но без направления · {missing.length}
              <Hint>Без направления заявка не попадёт в план. Поставьте его здесь одним нажатием.</Hint>
            </>
          }
        >
          <div className="grid gap-2 lg:grid-cols-2">
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
        </Section>
      )}

      <div className="card !p-0 overflow-hidden">
        {/* Вкладки карточки: направления и заявки периода — ссылками, страница серверная. */}
        <div className="flex flex-wrap items-center gap-x-5 px-4 sm:px-5 border-b border-line-hairline">
          {(
            [
              ["directions", "По направлениям"],
              ["orders", `Заявки периода (${regionOrders.length})`],
            ] as const
          ).map(([key, label]) => (
            <Link
              key={key}
              href={viewHref(key)}
              className={
                "py-3 text-sm border-b-2 -mb-px whitespace-nowrap transition-colors " +
                (view === key
                  ? "border-section-plans text-ink-primary font-semibold"
                  : "border-transparent text-ink-secondary hover:text-ink-primary")
              }
            >
              {label}
            </Link>
          ))}
          <span className="ml-auto py-3 text-xs text-ink-muted">
            доставка {formatDay(from)} — {formatDay(to)}
            <Hint>
              Факт считается по дню доставки. Отменённые и заявки в наши магазины не в счёт. Алматы в плане нет,
              поэтому сумма по направлениям меньше общих продаж. Процент у цветка — сколько заказано от его плана.
              Риска на полоске — сколько периода уже прошло.
            </Hint>
          </span>
        </div>

        {/* --- Отбор: неделя и цветок, проценты цветков прямо на кнопках -------- */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-3 border-b border-line-hairline">
          <Segmented
            items={[
              { href: keep(view === "orders" ? { view } : {}), active: !week, label: "Месяц" },
              ...weeks.map((w) => ({
                href: keep(view === "orders" ? { week: w.code, view } : { week: w.code }),
                active: week?.code === w.code,
                label: w.shortLabel,
              })),
            ]}
          />
          <Segmented
            items={[
              { href: flowerHref("") + (view === "orders" ? "&view=orders" : ""), active: !flower, label: "Все", note: pct(allFlowers.donePercent) },
              ...FLOWER_ORDER.map((f) => {
                const row = allFlowers.byFlower.find((r) => r.flowerType === f);
                return {
                  href: flowerHref(f) + (view === "orders" ? "&view=orders" : ""),
                  active: flower === f,
                  label: FLOWER_TYPE_LABELS_PLURAL[f] ?? f,
                  note: row && row.planStems + row.orderedStems > 0 ? pct(row.donePercent) : "",
                };
              }),
            ]}
          />
          {fact.planStems > 0 && (
            <div className="flex items-center gap-3 min-w-[220px] flex-1 lg:max-w-sm lg:ml-auto">
              <div className="flex-1">
                <PlanProgress percent={fact.donePercent} pace={pace} />
              </div>
              <span className={`font-display font-extrabold tabular-nums ${TONE_TEXT[tone]}`}>{pct(fact.donePercent)}</span>
            </div>
          )}
        </div>

        {view === "orders" ? (
          <RegionOrdersTable
            rows={regionOrders.map((o) => ({
              orderId: o.orderId,
              code: orderCode(o.orderId),
              clientName: o.clientName,
              deliveryLabel: formatDay(o.deliveryDate),
              direction: o.direction,
              stems: o.stems,
              shipped: o.shipped,
              amount: o.amount,
            }))}
            empty={flower ? "Заявок в регионы по этому цветку за период нет." : "Заявок в регионы за этот период нет."}
          />
        ) : (
        <div className="table-scroll table-cards">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="text-left text-xs text-ink-muted border-b border-line-hairline bg-surface-plane/60">
                <th className="px-4 py-2.5 font-medium">Направление</th>
                <th className="px-4 py-2.5 font-medium text-right">План</th>
                <th className="px-4 py-2.5 font-medium text-right">Заказано</th>
                <th className="px-4 py-2.5 font-medium w-48">Выполнение</th>
                <th className="px-4 py-2.5 font-medium text-right">Отгружено</th>
                <th className="px-4 py-2.5 font-medium text-right">Поступило</th>
              </tr>
            </thead>
            <tbody>
              {fact.groups.map((group) => {
                // Пустые блоки не показываем совсем: прочерки вместо «Экспорта» только мешают читать.
                const useful = group.rows.filter((r) => r.planStems > 0 || r.orderedStems > 0 || r.orders > 0);
                if (useful.length === 0) return null;
                // Заголовок блока и его строки — в ОДНОМ tbody: вложенная таблица
                // на блок ставила колонки по своим ширинам, и числа съезжали.
                return (
                  <Fragment key={group.key}>
                    <tr>
                      <td colSpan={6} className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                        {group.label}
                      </td>
                    </tr>
                    {useful.map((r) => {
                      const inc = incomeByDirection.get(r.direction);
                      const rowTone = paceTone(r.donePercent, pace);
                      return (
                        <tr key={r.direction} className="border-t border-line-hairline/70 hover:bg-surface-plane/60">
                          <td data-label="Направление" className="px-4 py-2.5 font-semibold whitespace-nowrap">
                            {r.direction}
                            {r.orders > 0 && (
                              <span className="ml-1.5 text-xs font-normal text-ink-muted">· {r.orders} заяв.</span>
                            )}
                          </td>
                          <td data-label="План" className="px-4 py-2.5 text-right tabular-nums text-ink-secondary">
                            {r.planStems > 0 ? nf(r.planStems) : null}
                          </td>
                          <td data-label="Заказано" className="px-4 py-2.5 text-right tabular-nums font-semibold">
                            {r.orderedStems > 0 ? nf(r.orderedStems) : null}
                          </td>
                          <td data-label="Выполнение" className="px-4 py-2.5">
                            {r.donePercent === null ? (
                              r.orderedStems > 0 ? <span className="text-xs text-[#8a5a00]">без плана</span> : null
                            ) : (
                              <div className="flex items-center gap-2">
                                <div className="flex-1 min-w-[60px]">
                                  <PlanProgress percent={r.donePercent} pace={pace} size="sm" />
                                </div>
                                <span className={`w-10 text-right text-xs font-semibold tabular-nums ${TONE_TEXT[rowTone]}`}>
                                  {pct(r.donePercent)}
                                </span>
                              </div>
                            )}
                          </td>
                          <td data-label="Отгружено" className="px-4 py-2.5 text-right tabular-nums">
                            {r.shippedStems > 0 ? nf(r.shippedStems) : null}
                          </td>
                          <td data-label="Поступило" className="px-4 py-2.5 text-right tabular-nums">
                            {(inc?.income ?? 0) > 0 ? `${nf(inc!.income)} ₸` : null}
                            {(inc?.waitingIncome ?? 0) > 0 && (
                              <span className="block text-[11px] text-[#8a5a00]">ждёт суммы: {inc!.waitingIncome}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
              {fact.planStems === 0 && fact.orderedStems === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-ink-muted">
                    За этот период ни плана, ни отгрузок по регионам нет.{" "}
                    <Link href={`/plans/shipments?period=${month}`} className="text-accent hover:underline">
                      Поставить план
                    </Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </div>
  );
}

function Segmented({
  items,
}: {
  items: { href: string; active: boolean; label: string; note?: string }[];
}) {
  return (
    <div className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line-hairline bg-surface-plane p-1">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={
            "rounded-md px-3 py-1.5 text-sm whitespace-nowrap " +
            (i.active ? "bg-surface shadow-sm font-medium" : "text-ink-secondary hover:text-ink-primary")
          }
        >
          {i.label}
          {i.note ? <span className="ml-1.5 text-xs font-normal text-ink-muted tabular-nums">{i.note}</span> : null}
        </Link>
      ))}
    </div>
  );
}
