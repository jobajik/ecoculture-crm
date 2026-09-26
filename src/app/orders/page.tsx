import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { ROLES, farmLabel, getFarmFor, retailLabel } from "@/lib/constants";
import {
  farmScopeFor,
  isOwnClientOrder,
  isRetailOrder,
  isRetailRole,
  retailTerritoryFor,
} from "@/lib/retail";
import { isRegionOrder } from "@/lib/orderKind";
import { newOrderLinkFor } from "@/lib/newOrder";
import OrdersTable from "@/components/OrdersTable";
import PageHeader from "@/components/PageHeader";
import { listUsers } from "@/lib/repo/users";
import { nameIndex } from "@/lib/personName";
import { localDayKey } from "@/lib/timezone";

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams?: { stage?: string };
}) {
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
    // Плюс свои клиентские заявки: менеджер розницы продаёт и мелким клиентам.
    if (territory) return (isRetailOrder(o) && o.retail === territory) || isOwnClientOrder(o, myEmail);
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
      const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
      // Полученное — пропорционально своей доле, как на странице заявки: иначе
      // «ждёт остатка оплаты» в списке называл бы сумму, которой не бывает.
      const share = order.totalAmount > 0 ? totalAmount / order.totalAmount : 0;
      return { ...order, items, totalAmount, paidAmount: order.paidAmount * share };
    })
    .filter((order) => order.items.length > 0);

  // Имена сотрудников — чтобы в колонке «Менеджер» стояла фамилия, а не
  // почтовый адрес. Список кэшируется на минуту, лишнего чтения таблицы нет.
  const managerNames = nameIndex(await listUsers());

  const farm = role === "warehouse" ? session?.user?.farm ?? null : null;
  const newOrderLink = newOrderLinkFor(role);

  return (
    <div>
      <PageHeader
        area="orders"
        title={territory ? `Заявки — ${retailLabel(territory)}` : "Заявки"}
        subtitle={farm ? `Только ${farmLabel(farm)}` : undefined}
        actions={
          /* Кому кнопка положена и куда ведёт — одной функцией (newOrder.ts).
             У РОПа её здесь не было вовсе, и он решил, что заявку на регион
             завести нельзя: возможность, о которой нельзя догадаться, ничем не
             отличается от отсутствующей. */
          <div className="flex flex-wrap gap-2">
            {/* Менеджер розницы продаёт и клиентам — мелкие заказы. */}
            {isRetailRole(role) && (
              <Link href="/orders/new?sale=1" className="btn-secondary">
                + Заявка клиенту
              </Link>
            )}
            {newOrderLink && (
              <Link href={newOrderLink.href} className="btn-primary">
                {isRetailRole(role) ? "+ Заявка магазину" : newOrderLink.label}
              </Link>
            )}
          </div>
        }
      />
      <OrdersTable
        orders={orders}
        managerNames={managerNames}
        today={localDayKey()}
        initialFilter={searchParams?.stage}
        canAdmin={role === ROLES.ADMIN}
      />
    </div>
  );
}
