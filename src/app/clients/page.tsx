import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { buildClientStats } from "@/lib/clientStats";
import { FLOWER_TYPE_LABELS, ROLES, formatGrade } from "@/lib/constants";
import ClientsBoard from "@/components/ClientsBoard";
import KpiTile from "@/components/KpiTile";
import { isRetailRole } from "@/lib/retail";
import { clients as clientsWord, orders as ordersWord } from "@/lib/plural";
import PageHeader from "@/components/PageHeader";
import { clientsTabsFor } from "./tabs";
import { withBotName } from "@/lib/botIdentity";

export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  // Менеджеру розницы клиентская база не нужна: его рабочее место — «Розница».
  if (isRetailRole(role)) redirect("/retail");
  if (role !== ROLES.MANAGER && role !== ROLES.SALES_HEAD && role !== ROLES.ADMIN) {
    redirect("/?error=forbidden");
  }

  const [clients, orders, users] = await Promise.all([
    listClients(),
    listOrdersWithItems(),
    listUsers(),
  ]);
  const nameByEmail = withBotName(new Map(users.map((u) => [u.email, u.name || u.email])));

  const stats = buildClientStats({
    clients,
    orders,
    nameByEmail,
    positionLabel: (flowerType, grade) =>
      `${FLOWER_TYPE_LABELS[flowerType] ?? flowerType} ${formatGrade(grade)}`,
  });

  const myEmail = session?.user?.email?.toLowerCase() ?? "";
  const myName = nameByEmail.get(myEmail) ?? myEmail;

  const t = stats.totals;
  const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

  return (
    <div>
      <PageHeader
        area="clients"
        title="Клиенты"
        tabs={clientsTabsFor(undefined, role)}
        subtitle={
          t.clients === 0
            ? "Клиентов пока нет."
            : `${clientsWord(t.clients)} · ${ordersWord(t.orders)} · ${money(t.revenue)} выручки`
        }
      />

      {t.clients > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
          <KpiTile icon="wallet" label="Средний чек" value={money(t.avgCheck)} hint="по всем заявкам" />
          <KpiTile icon="client" label="В среднем с клиента" value={money(t.revenuePerClient)} hint="выручка на клиента" />
          <KpiTile
            icon="clock"
            label="Молчат больше месяца"
            value={String(t.sleepingClients)}
            hint={t.sleepingClients > 0 ? "повод позвонить" : "все на связи"}
            tone={t.sleepingClients > 0 ? "warn" : undefined}
          />
          <KpiTile
            icon="chart"
            label="Три крупнейших клиента"
            value={`${Math.round(t.top3Share)} %`}
            hint="доля выручки"
            tone={t.top3Share > 50 ? "warn" : undefined}
          />
        </div>
      )}

      {stats.ordersWithoutClient > 0 && (
        <div className="card !py-3 mb-5 text-sm text-[#8a5a00]">
          Без карточки клиента: {ordersWord(stats.ordersWithoutClient)} — в разрезах не считаются.
        </div>
      )}

      <ClientsBoard
        myManagerName={myName}
        rows={stats.rows.map((r) => ({
          clientId: r.client.clientId,
          name: r.client.name,
          city: r.client.city,
          shopName: r.client.shopName,
          clientType: r.client.clientType,
          phone: r.client.phone,
          managerName: r.managerName,
          orders: r.orders,
          revenue: r.revenue,
          debt: r.debt,
          avgCheck: r.avgCheck,
          lastOrderDate: r.lastOrderDate,
          daysSinceLast: r.daysSinceLast,
          sleeping: r.sleeping,
          neverOrdered: r.neverOrdered,
          topPosition: r.topPosition,
          active: r.client.active,
        }))}
        byManager={stats.byManager}
        byCity={stats.byCity}
        byType={stats.byType}
      />
    </div>
  );
}
