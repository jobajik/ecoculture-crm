import OrderForm from "@/components/OrderForm";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { getCurrentPrices } from "@/lib/repo/prices";
import { listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { buildClientStats } from "@/lib/clientStats";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { FLOWER_TYPE_LABELS, ORDER_STATUSES, formatGrade, retailLabel } from "@/lib/constants";
import { PRICE_KINDS, priceMapForClient } from "@/lib/priceList";
import {
  canOrderForShop,
  isOwnShop,
  isRetailRole,
  retailTerritoryFor,
  shopDeliveries,
} from "@/lib/retail";

export const dynamic = "force-dynamic";

export default async function NewOrderPage({
  searchParams,
}: {
  /** Кому и на какой день — приходит из списка «Заявка на день» по магазинам. */
  searchParams?: { client?: string; date?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const retail = isRetailRole(role);

  // У розницы свой прайс: цветок в наш магазин передаётся по внутренней цене,
  // и подставлять сюда клиентскую было бы прямой ошибкой в цифрах.
  const [varieties, prices, clients, orders, users] = await Promise.all([
    listVarietiesByType(),
    getCurrentPrices(undefined, retail ? PRICE_KINDS.RETAIL : PRICE_KINDS.CLIENT),
    listClients(),
    listOrdersWithItems(),
    listUsers(),
  ]);

  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const myEmail = session?.user?.email?.toLowerCase() ?? "";
  const territory = retailTerritoryFor(role);

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

  // У магазинов своя статистика: из клиентской они вычищены целиком, и без
  // этого у точки, куда возят каждый день, стояло бы «ещё не возили».
  const shopStat = retail
    ? shopDeliveries(orders, ORDER_STATUSES.CANCELLED)
    : new Map<string, { orders: number; daysSinceLast: number }>();

  // Отключённые карточки в выбор не идут: снятая галочка означает «больше не
  // работаем», но историю заказов такого клиента она не трогает.
  //
  // Менеджеру розницы видны ТОЛЬКО магазины его направления, обычному
  // менеджеру — только клиенты: наши точки не клиенты, и смешивать их в одном
  // подборщике значит однажды выписать магазину счёт.
  const options = clients
    .filter((c) => c.active)
    .filter((c) => (retail ? canOrderForShop(role, c) : !isOwnShop(c)))
    .map((c) => ({
      clientId: c.clientId,
      name: c.name,
      city: c.city,
      shopName: c.shopName,
      phone: c.phone,
      managerName: nameByEmail.get(c.managerEmail) ?? c.managerEmail,
      mine: c.managerEmail === myEmail,
      orders: (retail ? shopStat.get(c.clientId)?.orders : statByClient.get(c.clientId)?.orders) ?? 0,
      daysSinceLast:
        (retail
          ? shopStat.get(c.clientId)?.daysSinceLast
          : statByClient.get(c.clientId)?.daysSinceLast) ?? -1,
    }));

  // Пришли из списка «Заявка на день»: магазин и дата уже выбраны — подставляем
  // их, чтобы человек сразу вводил количество. Чужой или несуществующий клиент
  // молча игнорируется: подборщик открывается как обычно (грабли 1.11 — то, что
  // пришло из адреса, проверяется по тому же списку, что и всё остальное).
  const preselected = searchParams?.client
    ? options.find((c) => c.clientId === searchParams.client) ?? null
    : null;
  const preselectedDate =
    searchParams?.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date) ? searchParams.date : "";

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">
        {retail ? `Новая заявка — ${retailLabel(territory)}` : "Новая заявка"}
      </h1>
      {retail && (
        <p className="text-sm text-ink-secondary mb-4">
          Заявка в наш магазин: выберите точку из списка и укажите количество. Оплату по ней никто
          не ждёт — как только вы подтвердите заявку, склад сможет собирать. Цены подставляются из
          внутреннего прайса.
        </p>
      )}
      <OrderForm
        varieties={varieties}
        prices={priceMapForClient(prices)}
        initialClient={preselected}
        initialDeliveryDate={preselectedDate}
        shopsOnly={retail}
        clients={options}
      />
    </div>
  );
}
