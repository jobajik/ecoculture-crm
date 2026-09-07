import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { farmLabel, getFarmFor } from "@/lib/constants";
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
  const farm = role === "warehouse" ? session?.user?.farm ?? null : null;

  const orders = farm
    ? all
        .map((order) => {
          const items = order.items.filter((i) => getFarmFor(i.flowerType) === farm);
          return {
            ...order,
            items,
            totalAmount: items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0),
          };
        })
        .filter((order) => order.items.length > 0)
    : all;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold">Заявки</h1>
        {(role === "manager" || role === "admin") && (
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
      {!farm && <div className="mb-4" />}
      <OrdersTable orders={orders} />
    </div>
  );
}
