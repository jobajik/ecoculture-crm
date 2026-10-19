import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { ORDER_STATUSES, RETAIL_ORDER, ROLES } from "@/lib/constants";
import { isRetailOrder, isRetailRole, retailShortLabel, territoriesFor } from "@/lib/retail";
import { formatDay } from "@/lib/formatDate";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
import RetailShopsTable, { type RetailShopRow } from "@/components/RetailShopsTable";
import { localDayKey } from "@/lib/timezone";
import { retailTabsFor } from "../tabs";

export const dynamic = "force-dynamic";

/** Сколько дней без доставки — повод проверить точку: забытая заявка или магазин закрылся. */
const QUIET_DAYS = 7;

/**
 * Справочник наших точек. Отвечает на два вопроса: какие магазины у меня есть и
 * когда каждому в последний раз что-то отправляли. Второе важнее: точка, куда
 * не возили неделю, — это либо забытая заявка, либо закрывшийся магазин, и
 * узнать об этом надо здесь, а не от директора магазина по телефону.
 */
export default async function RetailShopsPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const territories = territoriesFor(role);
  if (territories.length === 0) redirect("/?error=forbidden");
  // РОП магазины видит, но заявки за менеджера не оформляет — кнопки у него нет.
  const canOrder = isRetailRole(role) || role === ROLES.ADMIN;

  const [clients, orders] = await Promise.all([listClients(), listOrdersWithItems()]);

  const shops = clients
    .filter((c) => territories.includes(c.retail))
    .sort((a, b) => {
      const byTerritory = RETAIL_ORDER.indexOf(a.retail) - RETAIL_ORDER.indexOf(b.retail);
      if (byTerritory !== 0) return byTerritory;
      const byCity = (a.city || "").localeCompare(b.city || "", "ru");
      return byCity !== 0 ? byCity : a.name.localeCompare(b.name, "ru");
    });

  const retailOrders = orders.filter(
    (o) => isRetailOrder(o) && o.status !== ORDER_STATUSES.CANCELLED
  );

  const stat = new Map<string, { orders: number; stems: number; amount: number; last: string }>();
  for (const order of retailOrders) {
    if (!order.clientId) continue;
    const row = stat.get(order.clientId) ?? { orders: 0, stems: 0, amount: 0, last: "" };
    row.orders += 1;
    row.stems += order.items.reduce((s, i) => s + i.quantity, 0);
    row.amount += order.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const day = order.deliveryDate || (order.createdAt || "").slice(0, 10);
    if (day > row.last) row.last = day;
    stat.set(order.clientId, row);
  }

  // Новый вид (19.10.2026): цифры плитками, справочник — одна карточка с отбором «не возили неделю».
  const today = localDayKey();
  const dayMs = (d: string) => new Date(`${d}T00:00:00`).getTime();
  const rows: RetailShopRow[] = shops.map((shop) => {
    const row = stat.get(shop.clientId);
    const last = row?.last ?? "";
    const daysAgo = last ? Math.max(0, Math.round((dayMs(today) - dayMs(last.slice(0, 10))) / 86_400_000)) : null;
    return {
      clientId: shop.clientId,
      name: shop.name,
      city: shop.city || "",
      territory: retailShortLabel(shop.retail),
      active: shop.active,
      orders: row?.orders ?? 0,
      stems: row?.stems ?? 0,
      amount: row?.amount ?? 0,
      lastLabel: last ? formatDay(last) : "ещё не возили",
      daysAgo: daysAgo !== null && Number.isFinite(daysAgo) ? daysAgo : null,
    };
  });
  const activeRows = rows.filter((r) => r.active);
  const quiet = activeRows.filter((r) => r.daysAgo !== null && r.daysAgo >= QUIET_DAYS).length;
  const never = rows.filter((r) => r.daysAgo === null).length;
  const stems = rows.reduce((s, r) => s + r.stems, 0);

  return (
    <div>
      <PageHeader
        area="retail"
        title={`Магазины${territories.length === 1 ? ` — ${retailShortLabel(territories[0])}` : ""}`}
        icon="store"
        tabs={retailTabsFor(role)}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="store" label="Магазинов" value={String(rows.length)} hint={`работают: ${activeRows.length}`} />
        <KpiTile
          icon="alert"
          label={`Не возили ${QUIET_DAYS}+ дней`}
          value={String(quiet)}
          hint={quiet > 0 ? "забытая заявка или закрылись" : "всем возим"}
          tone={quiet > 0 ? "bad" : "good"}
        />
        <KpiTile icon="clock" label="Ещё не возили" value={String(never)} hint="ни одной заявки" tone={never > 0 ? "warn" : undefined} />
        <KpiTile icon="leaf" label="Стеблей за всё время" value={stems.toLocaleString("ru-RU")} hint="в наши магазины" />
      </div>

      <RetailShopsTable rows={rows} showTerritory={territories.length > 1} canOrder={canOrder} quietDays={QUIET_DAYS} />
    </div>
  );
}
