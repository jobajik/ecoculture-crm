import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import RegionNav from "@/components/RegionNav";
import RegionDenied from "@/components/RegionDenied";
import TruckOrdersBoard, { type TruckDay } from "@/components/TruckOrdersBoard";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import { formatDay } from "@/lib/formatDate";
import { shipDayLabel } from "@/lib/managerProfile";
import { TRUCK_STAGE_LABELS, WEEKDAY_FULL, isoWeekday } from "@/lib/regionTruck";
import { orderCode } from "@/lib/paymentStage";
import { loadRegion, loadTruckOrders } from "../../load";

export const dynamic = "force-dynamic";

/**
 * «Фура» города (17.11.2026): заказы на фуру по дням — что заказано, что склад отгрузил и чего не будет, что принято.
 * Менеджер города подаёт заказ и подтверждает приёмку; владелец, РОП и зав. складом видят то же самое по каждому городу.
 */
export default async function RegionTruckPage({ params, searchParams }: { params: { store: string }; searchParams?: { sent?: string } }) {
  const r = await loadRegion(params.store);
  if (!r.access.view) return <RegionDenied city={r.info.label} />;
  const { orders } = await loadTruckOrders(r.store, r.today);
  const nf = (n: number) => n.toLocaleString("ru-RU");
  const base = `/region/${r.store}`;

  const live = orders.filter((o) => o.stage !== "cancelled" && o.stage !== "refused");
  const next = live.filter((o) => o.deliveryDate >= r.today && (o.stage === "waiting" || o.stage === "loading"));
  const transit = live.filter((o) => o.stage === "transit");
  const shortage = live.reduce((s, o) => s + o.shortage, 0);
  const accepted = live.reduce((s, o) => s + o.accepted, 0);

  const days: TruckDay[] = [];
  for (const o of orders) {
    let day = days.find((d) => d.day === o.deliveryDate);
    if (!day) {
      day = { day: o.deliveryDate, title: `Фура ${formatDay(o.deliveryDate)}, ${WEEKDAY_FULL[isoWeekday(o.deliveryDate)]}`, cards: [] };
      days.push(day);
    }
    day.cards.push({
      orderId: o.orderId,
      code: orderCode(o.orderId),
      kindLabel: o.kind === "wholesale" ? "На опт — на склад города" : "В наши магазины",
      wholesale: o.kind === "wholesale",
      stage: o.stage,
      stageLabel: TRUCK_STAGE_LABELS[o.stage],
      byLine: `заказ: ${r.nameOf(o.managerEmail)} · ${formatDay(o.createdAt.slice(0, 10))}`,
      ordered: o.ordered,
      shipped: o.shipped,
      pending: o.pending,
      accepted: o.accepted,
      shortage: o.shortage,
      shortageNote: o.shortageNote,
      items: o.items.map((i) => ({
        itemId: i.itemId,
        name: `${FLOWER_TYPE_LABELS[i.flowerType] ?? i.flowerType} ${i.variety} · ${formatGrade(i.grade)}`,
        quantity: i.asked,
        shipped: i.shipped,
        pending: i.pending,
        accepted: i.accepted,
        // Ответ склада (`truckLoad.ts`): чего не будет и что склад добавил сам.
        missing: i.extra ? 0 : Math.max(0, i.asked - i.quantity),
        note: i.note,
        extra: i.extra,
      })),
    });
  }

  return (
    <div>
      <PageHeader
        area="stock"
        title={`Фура — ${r.info.label}`}
        subtitle={`Ближайшая фура — ${shipDayLabel(r.truckDay)}`}
        icon="truck"
        tabs={r.headerTabs}
        actions={
          r.access.order ? (
            <Link href={`${base}/truck/new`} className="btn-primary">
              + Заказ на фуру
            </Link>
          ) : undefined
        }
      />
      {r.home.all && <RegionNav store={r.store} tabs={r.tabs} current={`${base}/truck`} />}

      {searchParams?.sent === "1" && (
        <div className="mb-5 text-sm text-[#12733a] bg-status-good/10 rounded-lg px-3 py-2">Заказ отправлен. Зав. складом видит его в «Фурах в регионы» и ответит по каждой позиции: грузит, нет на складе или замена — ответ появится здесь же.</div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="list" label="Заказано на ближайшие фуры" value={nf(next.reduce((s, o) => s + o.ordered - o.shipped, 0))} hint={next.length > 0 ? `шт. · заказов: ${next.length}` : "заказов нет"} />
        <KpiTile
          icon="truck"
          label="В пути — ждёт приёмки"
          value={nf(transit.reduce((s, o) => s + o.pending, 0))}
          hint={transit.length > 0 ? `шт. · заказов: ${transit.length}` : "всё принято"}
          tone={transit.length > 0 ? "warn" : "good"}
        />
        <KpiTile icon="box" label="Принято за 4 недели" value={nf(accepted)} hint="шт. по записям приёмки" />
        <KpiTile icon="alert" label="Недостача за 4 недели" value={nf(shortage)} hint={shortage > 0 ? "шт. — причины в заказах ниже" : "нет"} tone={shortage > 0 ? "bad" : "good"} />
      </div>

      <TruckOrdersBoard store={r.store} days={days} canAccept={r.access.accept} canCancel={r.access.order} canOpen={r.home.all} />
    </div>
  );
}
