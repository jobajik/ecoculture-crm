import OrderForm from "@/components/OrderForm";
import RetailOrderForm from "@/components/RetailOrderForm";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { getCurrentPrices } from "@/lib/repo/prices";
import { listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { getStockSnapshot } from "@/lib/stock";
import { buildClientStats } from "@/lib/clientStats";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  FLOWER_TYPES,
  FLOWER_TYPE_LABELS,
  ORDER_STATUSES,
  formatGrade,
  getGradesFor,
  retailLabel,
} from "@/lib/constants";
import { PRICE_KINDS, priceFor, priceMapForClient } from "@/lib/priceList";
import {
  buildAssortment,
  canOrderForShop,
  isOwnShop,
  retailTerritoryFor,
  shopDeliveries,
  shopOrderForm,
} from "@/lib/retail";

export const dynamic = "force-dynamic";

/** Порядок вкладок цветка в ассортименте — как везде в программе. */
const FLOWER_ORDER: string[] = [
  FLOWER_TYPES.ROSE,
  FLOWER_TYPES.CHRYSANTHEMUM,
  FLOWER_TYPES.EUSTOMA,
];

export default async function NewOrderPage({
  searchParams,
}: {
  /**
   * Кому и на какой день — приходит из списка «Заявка на день» по магазинам.
   * `retail=1` означает «это заявка в наш магазин»: у менеджера розницы других
   * заявок не бывает вовсе, а администратору нужны обе формы, и выбирает он их
   * тем, откуда пришёл.
   */
  searchParams?: { client?: string; date?: string; retail?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";

  // Какую форму показывать. У розницы — всегда магазинную: клиентов у неё нет.
  // Администратор работает и с клиентами, и с магазинами, поэтому для него это
  // решает адрес: все ссылки из раздела «Розница» несут `retail=1`. Гадать по
  // выбранной карточке нельзя — прайс (клиентский или внутренний) нужно знать
  // ДО чтения данных, иначе в форму подставятся цены не того прайса.
  const retail = shopOrderForm(role, searchParams?.retail);

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

  const preselectedDate =
    searchParams?.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date) ? searchParams.date : "";

  // -------------------------------------------------------------------------
  // РОЗНИЦА — своя форма: магазин и ассортимент, больше ничего.
  //
  // Обычная форма спрашивает клиента, телефон, комментарий и цену каждой
  // позиции. Для перемещения в наш магазин это всё лишнее: контрагент — одна из
  // шести наших точек, телефон записан в её карточке, цену задаёт внутренний
  // прайс. Поэтому здесь другой компонент, а не тот же с выключенными полями:
  // форма с половиной скрытых полей рано или поздно обрастает условиями и
  // ломается то у одних, то у других.
  // -------------------------------------------------------------------------
  if (retail) {
    // Остаток склада нужен, чтобы менеджер видела, чего сколько лежит: она не
    // продаёт, а перекладывает, и заказывать 500 стеблей, когда есть 40, —
    // просто испорченная заявка. Считаем по всем производствам: у розницы нет
    // привязки к одному, она возит и розу, и хризантему.
    const stock = await getStockSnapshot();
    const stockMap: Record<string, number> = {};
    for (const card of stock.varieties) {
      for (const grade of card.grades) {
        stockMap[`${card.flowerType}|${card.variety}|${grade.grade}`] = grade.quantity;
      }
    }

    const assortment = buildAssortment({
      flowerTypes: FLOWER_ORDER,
      varieties,
      gradesFor: getGradesFor,
      stock: stockMap,
      priceFor: (flowerType, variety, grade) => priceFor(prices, flowerType, variety, grade),
    });

    const delivered = shopDeliveries(orders, ORDER_STATUSES.CANCELLED);
    const shops = clients
      .filter((c) => c.active && canOrderForShop(role, c))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((c) => ({
        clientId: c.clientId,
        name: c.name,
        address: c.address,
        city: c.city,
        orders: delivered.get(c.clientId)?.orders ?? 0,
        daysSinceLast: delivered.get(c.clientId)?.daysSinceLast ?? -1,
      }));

    // Магазин из адреса проверяется по тому же списку, что и всё остальное:
    // чужая точка молча игнорируется, и открывается обычный выбор (грабли 1.11).
    const preselectedShop = shops.some((s) => s.clientId === searchParams?.client)
      ? (searchParams?.client as string)
      : "";

    return (
      <div>
        <h1 className="text-xl font-semibold mb-1">
          Заявка в магазин{territory ? ` — ${retailLabel(territory)}` : ""}
        </h1>
        <p className="text-sm text-ink-secondary mb-4">
          Выберите магазин и проставьте количество. Это перемещение внутри компании: оплату по
          заявке никто не ждёт, а цены берутся из внутреннего прайса.
        </p>
        <RetailOrderForm
          shops={shops}
          assortment={assortment}
          initialShopId={preselectedShop}
          initialDeliveryDate={preselectedDate}
        />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Обычная заявка клиенту — как была.
  // -------------------------------------------------------------------------

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

  // Отключённые карточки в выбор не идут: снятая галочка означает «больше не
  // работаем», но историю заказов такого клиента она не трогает. Наши магазины
  // сюда не попадают вовсе — они не клиенты.
  const options = clients
    .filter((c) => c.active && !isOwnShop(c))
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
    }));

  const preselected = searchParams?.client
    ? options.find((c) => c.clientId === searchParams.client) ?? null
    : null;

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Новая заявка</h1>
      <OrderForm
        varieties={varieties}
        prices={priceMapForClient(prices)}
        initialClient={preselected}
        initialDeliveryDate={preselectedDate}
        clients={options}
      />
    </div>
  );
}
