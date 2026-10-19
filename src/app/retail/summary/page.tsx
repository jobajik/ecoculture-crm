import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { FLOWER_TYPE_LABELS, ORDER_STATUSES, formatGrade } from "@/lib/constants";
import { buildRetailSummary, retailShortLabel, territoriesFor } from "@/lib/retail";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import RetailSummaryTabs, {
  type RetailSummaryShop,
  type RetailSummaryTerritory,
  type RetailSummaryVariety,
} from "@/components/RetailSummaryTabs";
import { retailTabsFor } from "../tabs";

export const dynamic = "force-dynamic";

/** Сколько дней назад считаем. Столько же, сколько в аналитике хозяйства. */
const DAYS = 30;

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * Сколько цветка ушло в собственную розницу за 30 дней.
 *
 * Это НЕ выручка, и на странице так и написано. Выручка появится, когда магазин
 * продаст букет покупателю; здесь — объём перемещения, посчитанный по
 * внутреннему прайсу. Смешать одно с другим значило бы посчитать один и тот же
 * цветок дважды, поэтому эти цифры и живут отдельно от «Продаж» и «Аналитики».
 */
export default async function RetailSummaryPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const territories = territoriesFor(role);
  if (territories.length === 0) redirect("/?error=forbidden");

  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (DAYS - 1));

  const [clients, orders] = await Promise.all([listClients(), listOrdersWithItems()]);

  const summary = buildRetailSummary({
    shops: clients.map((c) => ({
      clientId: c.clientId,
      name: c.name,
      city: c.city,
      retail: c.retail,
    })),
    orders: orders.map((o) => ({
      orderId: o.orderId,
      clientId: o.clientId,
      clientName: o.clientName,
      createdAt: o.createdAt,
      status: o.status,
      retail: o.retail,
      items: o.items,
    })),
    from: dayKey(from),
    to: dayKey(to),
    territories,
    cancelledStatus: ORDER_STATUSES.CANCELLED,
  });

  const t = summary.totals;
  const shops: RetailSummaryShop[] = summary.byShop.map((row) => ({
    key: row.clientId || row.name,
    name: row.name,
    city: row.city || "",
    orders: row.orders,
    stems: row.stems,
    amount: row.amount,
    share: t.stems > 0 ? `${Math.round((row.stems / t.stems) * 100)} %` : "—",
  }));
  const varieties: RetailSummaryVariety[] = summary.byVariety.map((row) => ({
    key: `${row.flowerType}|${row.variety}|${row.grade}`,
    flower: FLOWER_TYPE_LABELS[row.flowerType] ?? row.flowerType,
    variety: row.variety,
    grade: formatGrade(row.grade),
    stems: row.stems,
    amount: row.amount,
  }));
  const byTerritory: RetailSummaryTerritory[] = summary.byTerritory.map((row) => ({
    key: row.territory,
    label: row.label,
    orders: row.orders,
    stems: row.stems,
    amount: row.amount,
  }));

  // Новый вид (19.10.2026): цифры плитками, разрезы — одна карточка с вкладками и страницами.
  return (
    <div>
      <PageHeader
        area="retail"
        title={`Сводка${territories.length === 1 ? ` — ${retailShortLabel(territories[0])}` : ""}`}
        subtitle={`За последние ${DAYS} дней, по дате оформления`}
        icon="chart"
        tabs={retailTabsFor(role)}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="order" label="Заявок" value={String(t.orders)} hint="кроме отменённых" />
        <KpiTile icon="store" label="Магазинов" value={String(t.shops)} hint="получали цветок" />
        <KpiTile icon="leaf" label="Стеблей" value={t.stems.toLocaleString("ru-RU")} hint={`за ${DAYS} дней`} />
        <KpiTile icon="tag" label="По внутренней цене" value={money(t.amount)} hint="это не выручка" />
      </div>

      {t.orders === 0 ? (
        <div className="card text-sm text-ink-secondary">Заявок в магазины не было.</div>
      ) : (
        <RetailSummaryTabs shops={shops} varieties={varieties} territories={byTerritory} />
      )}
    </div>
  );
}
