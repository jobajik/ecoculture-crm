import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { ORDER_STATUSES, RETAIL_ORDER, ROLES } from "@/lib/constants";
import { isRetailOrder, isRetailRole, retailShortLabel, territoriesFor } from "@/lib/retail";
import { formatDay } from "@/lib/formatDate";
import SectionTabs from "@/components/SectionTabs";
import { retailTabsFor } from "../tabs";

export const dynamic = "force-dynamic";

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

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

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h1 className="text-xl font-semibold">
          Розница{territories.length === 1 ? ` — ${retailShortLabel(territories[0])}` : ""}
        </h1>
      </div>
      <SectionTabs tabs={retailTabsFor(role)} />

      <p className="text-sm text-ink-secondary mt-4 mb-4">
        {shops.length === 0
          ? "Магазинов пока нет. Карточку заводит РОП в клиентской базе — или вы сами при оформлении заявки."
          : `${shops.length} ${shops.length === 1 ? "магазин" : "магазинов"}. Отправки считаются по всем заявкам, кроме отменённых.`}
      </p>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Магазин</th>
              <th className="px-4 py-3 font-medium">Город</th>
              {territories.length > 1 && <th className="px-4 py-3 font-medium">Направление</th>}
              <th className="px-4 py-3 font-medium text-right">Заявок</th>
              <th className="px-4 py-3 font-medium text-right">Стеблей</th>
              <th className="px-4 py-3 font-medium text-right">По внутр. цене</th>
              <th className="px-4 py-3 font-medium">Последняя доставка</th>
              {canOrder && <th className="px-4 py-3 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {shops.map((shop) => {
              const row = stat.get(shop.clientId);
              return (
                <tr
                  key={shop.clientId}
                  className="border-b border-line-hairline last:border-0 hover:bg-surface-plane"
                >
                  <td className="px-4 py-2.5">
                    <Link href={`/clients/${shop.clientId}`} className="font-medium hover:underline">
                      {shop.name}
                    </Link>
                    {!shop.active && (
                      <span className="ml-2 text-xs text-ink-muted">не работает</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-ink-secondary">{shop.city || "—"}</td>
                  {territories.length > 1 && (
                    <td className="px-4 py-2.5 text-ink-secondary">
                      {retailShortLabel(shop.retail)}
                    </td>
                  )}
                  <td className="px-4 py-2.5 text-right tabular-nums">{row?.orders ?? 0}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {row ? row.stems.toLocaleString("ru-RU") : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {row ? money(row.amount) : "—"}
                  </td>
                  <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">
                    {row?.last ? formatDay(row.last) : "ещё не возили"}
                  </td>
                  {canOrder && (
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <Link
                        href={`/orders/new?retail=1&client=${shop.clientId}`}
                        className="btn-secondary !py-1 !px-2.5 text-xs"
                      >
                        Заявка
                      </Link>
                    </td>
                  )}
                </tr>
              );
            })}
            {shops.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-ink-muted">
                  Пока пусто
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
