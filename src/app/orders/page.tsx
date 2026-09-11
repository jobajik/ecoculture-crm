import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { ROLES, farmLabel, getFarmFor, retailLabel } from "@/lib/constants";
import { farmScopeFor, isRetailOrder, isRetailRole, retailTerritoryFor } from "@/lib/retail";
import { isRegionOrder } from "@/lib/orderKind";
import OrdersTable from "@/components/OrdersTable";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await getServerSession(authOptions);
  const all = await listOrdersWithItems();
  const role = session?.user?.role;

  // Зав. складом видит только свой цветок — и в списке заявок тоже.
  // Позиции чужого производства вырезаются, а заявки, где своего цветка нет,
  // не показываются вовсе. Сумма пересчитывается по оставшимся позициям,
  // иначе в списке висела бы чужая выручка.
  const myEmail = session?.user?.email?.toLowerCase() ?? "";

  // Розница и продажи наружу — два разных потока, и мешать их в одном списке
  // нельзя. Менеджер розницы видит только своё направление; менеджер и
  // бухгалтер розницу не видят вовсе (делать им там нечего: ни своей заявки,
  // ни денег). Склад видит всё — он собирает и то, и другое.
  const territory = retailTerritoryFor(role);
  const visible = all.filter((o) => {
    if (territory) return isRetailOrder(o) && o.retail === territory;
    // Менеджеру городская заявка не нужна: она не его и клиента в ней нет.
    // Бухгалтеру нужна — по ней она подтверждает поступления.
    if (role === ROLES.MANAGER) return !isRetailOrder(o) && !isRegionOrder(o);
    if (role === ROLES.ACCOUNTANT) return !isRetailOrder(o);
    return true;
  });

  // Резать по производству нужно у зав. складом — но НЕ её собственную заявку в
  // регион: её она составила сама, вместе с чужим цветком (`farmScopeFor`).
  const orders = visible
    .map((order) => {
      const scope = farmScopeFor({ role, farm: session?.user?.farm, order, email: myEmail });
      if (!scope) return order;
      const items = order.items.filter((i) => getFarmFor(i.flowerType) === scope);
      return {
        ...order,
        items,
        totalAmount: items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0),
      };
    })
    .filter((order) => order.items.length > 0);

  const farm = role === "warehouse" ? session?.user?.farm ?? null : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">
          {territory ? `Заявки — ${retailLabel(territory)}` : "Заявки"}
        </h1>
        {(role === "manager" || role === "admin" || isRetailRole(role)) && (
          <Link href="/orders/new" className="btn-primary">
            + Новая заявка
          </Link>
        )}
      </div>
      {farm && (
        <p className="text-sm text-ink-secondary mb-4">
          Только заявки вашего производства — {farmLabel(farm)}. Позиции другого производства скрыты.
        </p>
      )}
      {territory && (
        <p className="text-sm text-ink-secondary mb-4">
          Заявки в наши магазины вашего направления. Оплата по ним не проводится: это внутреннее
          перемещение, и отгрузку открывает ваше подтверждение.
        </p>
      )}
      {!farm && !territory && <div className="mb-4" />}
      <OrdersTable orders={orders} />
    </div>
  );
}
