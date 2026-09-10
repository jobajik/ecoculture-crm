import OrderForm from "@/components/OrderForm";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { getCurrentPrices } from "@/lib/repo/prices";
import { listClients } from "@/lib/repo/clients";
import { listUsers } from "@/lib/repo/users";
import { priceMapForClient } from "@/lib/priceList";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const [varieties, prices, clients, users] = await Promise.all([
    listVarietiesByType(),
    getCurrentPrices(),
    listClients(),
    listUsers(),
  ]);

  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));

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
          }))}
      />
    </div>
  );
}
