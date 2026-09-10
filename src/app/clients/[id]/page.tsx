import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getClientById, listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { buildClientStats } from "@/lib/clientStats";
import { FLOWER_TYPE_LABELS, ROLES, formatGrade } from "@/lib/constants";
import { formatDay } from "@/lib/formatDate";
import OrderStatusBadge from "@/components/OrderStatusBadge";
import ClientCard from "@/components/ClientCard";

export const dynamic = "force-dynamic";

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.MANAGER && role !== ROLES.SALES_HEAD && role !== ROLES.ADMIN) {
    redirect("/?error=forbidden");
  }

  const client = await getClientById(params.id);
  if (!client) notFound();

  const [clients, orders, users] = await Promise.all([
    listClients(),
    listOrdersWithItems(),
    listUsers(),
  ]);
  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));

  const stats = buildClientStats({
    clients,
    orders,
    nameByEmail,
    positionLabel: (flowerType, grade) =>
      `${FLOWER_TYPE_LABELS[flowerType] ?? flowerType} ${formatGrade(grade)}`,
  });
  const row = stats.rows.find((r) => r.client.clientId === client.clientId);

  // История заказов клиента — свежие сверху: смотрят обычно последние.
  const myOrders = orders
    .filter((o) => o.clientId === client.clientId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const email = session?.user?.email?.toLowerCase() ?? "";
  const canEdit =
    role === ROLES.ADMIN || role === ROLES.SALES_HEAD || client.managerEmail === email;

  return (
    <div className="max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h1 className="text-xl font-semibold">{client.name}</h1>
        <Link href="/clients" className="text-sm text-ink-secondary hover:underline">
          ← Ко всем клиентам
        </Link>
      </div>
      <p className="text-sm text-ink-muted mb-6">
        {[client.city, client.shopName, client.clientType].filter(Boolean).join(" · ") || "—"}
        {row && !row.neverOrdered && ` · первый заказ ${formatDay(row.firstOrderDate)}`}
      </p>

      {row && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Tile title="Заявок" value={String(row.orders)} hint="Кроме отменённых" />
          <Tile title="Выручка" value={money(row.revenue)} hint="По счетам, а не по деньгам" />
          <Tile title="Средний чек" value={row.orders > 0 ? money(row.avgCheck) : "—"} hint={
            row.orders > 0 ? `в среднем ${Math.round(row.avgStems)} стеблей` : "заказов не было"
          } />
          <Tile
            title={row.debt > 0 ? "Должен" : "Оплачено"}
            value={row.debt > 0 ? money(row.debt) : money(row.paid)}
            hint={row.debt > 0 ? "Не закрыто по счетам" : "Долгов нет"}
            warn={row.debt > 0}
          />
        </div>
      )}

      {row?.sleeping && (
        <div className="card mb-6 text-sm text-[#8a5a00]">
          Последний заказ был {formatDay(row.lastOrderDate)} — больше месяца назад. Повод позвонить.
        </div>
      )}

      <div className="mb-6">
        <ClientCard
          clientId={client.clientId}
          canEdit={canEdit}
          managerName={nameByEmail.get(client.managerEmail) ?? client.managerEmail}
          values={{
            name: client.name,
            city: client.city,
            shopName: client.shopName,
            clientType: client.clientType,
            contactPerson: client.contactPerson,
            phone: client.phone,
            messenger: client.messenger,
            address: client.address,
            paymentTerms: client.paymentTerms,
            paymentMethod: client.paymentMethod,
            kaspiPay1: client.kaspiPay1,
            kaspiPay2: client.kaspiPay2,
            source: client.source,
            note: client.note,
          }}
        />
      </div>

      <h2 className="font-medium mb-2">История заказов</h2>
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-secondary border-b border-line-hairline">
              <th className="px-4 py-3 font-medium">Заявка</th>
              <th className="px-4 py-3 font-medium">Оформлена</th>
              <th className="px-4 py-3 font-medium">Доставка</th>
              <th className="px-4 py-3 font-medium">Позиции</th>
              <th className="px-4 py-3 font-medium text-right">Сумма</th>
              <th className="px-4 py-3 font-medium">Статус</th>
            </tr>
          </thead>
          <tbody>
            {myOrders.map((o) => (
              <tr key={o.orderId} className="border-b border-line-hairline last:border-0 hover:bg-surface-plane">
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <Link href={`/orders/${o.orderId}`} className="font-medium hover:underline">
                    {o.orderId}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">
                  {formatDay(o.createdAt)}
                </td>
                <td className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">
                  {formatDay(o.deliveryDate)}
                </td>
                <td className="px-4 py-2.5 text-ink-secondary">
                  {o.items
                    .map((i) => `${i.variety} ${formatGrade(i.grade)} — ${i.quantity}`)
                    .join(", ")}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {money(o.totalAmount)}
                </td>
                <td className="px-4 py-2.5">
                  <OrderStatusBadge status={o.status} />
                </td>
              </tr>
            ))}
            {myOrders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-muted">
                  Заказов пока не было
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({
  title,
  value,
  hint,
  warn,
}: {
  title: string;
  value: string;
  hint: string;
  warn?: boolean;
}) {
  return (
    <div className="card">
      <div className="text-sm text-ink-secondary">{title}</div>
      <div className={`text-2xl font-semibold mt-1 ${warn ? "text-[#8a5a00]" : ""}`}>{value}</div>
      <div className="text-xs text-ink-muted mt-1">{hint}</div>
    </div>
  );
}
