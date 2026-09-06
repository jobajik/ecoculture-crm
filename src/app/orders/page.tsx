import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listOrdersWithItems } from "@/lib/repo/orders";
import OrdersTable from "@/components/OrdersTable";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const session = await getServerSession(authOptions);
  const orders = await listOrdersWithItems();
  const role = session?.user?.role;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Заявки</h1>
        {(role === "manager" || role === "admin") && (
          <Link href="/orders/new" className="btn-primary">
            + Новая заявка
          </Link>
        )}
      </div>
      <OrdersTable orders={orders} />
    </div>
  );
}
