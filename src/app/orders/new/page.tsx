import OrderForm from "@/components/OrderForm";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { getCurrentPrices } from "@/lib/repo/prices";
import { listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { buildClientStats } from "@/lib/clientStats";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { FLOWER_TYPE_LABELS, formatGrade } from "@/lib/constants";
import { priceMapForClient } from "@/lib/priceList";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const [session, varieties, prices, clients, orders, users] = await Promise.all([
    getServerSession(authOptions),
    listVarietiesByType(),
    getCurrentPrices(),
    listClients(),
    listOrdersWithItems(),
    listUsers(),
  ]);

  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const myEmail = session?.user?.email?.toLowerCase() ?? "";

  // Подборщику нужна свежесть заказов: сверху идут те, с кем работали недавно,
  // а не первые по алфавиту. Считаем тем же расчётом, что и страница клиентов,
  // чтобы «последний заказ» в двух местах не разошёлся.
  const stats = buildClientStats({
    clients,
    orders,
    nameByEmail,
    positionLabel: (flowerType, grade) =>
      `${FLOWER_TYPE_LABELS[flowerType] ?? flowerType} ${formatGrade(grade)}`,
  });
  const statByClient = new Map(stats.rows.map((r) => [r.client.clientId, r]));

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Новая заявка</h1>
      <OrderForm
        varieties={varieties}
        prices={priceMapForClient(prices)}
        // Отключённые карточки в выбор не идут: снятая галочка означает «больше
        // не работаем», но историю заказов такого клиента она не трогает.
        clients={clients
          .filter((c) => c.active)
          .map((c) => ({
            clientId: c.clientId,
            name: c.name,
            city: c.city,
            shopName: c.shopName,
            phone: c.phone,
            managerName: nameByEmail.get(c.managerEmail) ?? c.managerEmail,
            mine: c.managerEmail === myEmail,
            orders: statByClient.get(c.clientId)?.orders ?? 0,
            daysSinceLast: statByClient.get(c.clientId)?.daysSinceLast ?? -1,
          }))}
      />
    </div>
  );
}
