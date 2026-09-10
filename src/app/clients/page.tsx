import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listClients } from "@/lib/repo/clients";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { buildClientStats } from "@/lib/clientStats";
import { FLOWER_TYPE_LABELS, ROLES, formatGrade } from "@/lib/constants";
import ClientsBoard from "@/components/ClientsBoard";
import { isRetailRole } from "@/lib/retail";
import { clients as clientsWord, orders as ordersWord } from "@/lib/plural";

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
  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));

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
      <h1 className="text-xl font-semibold mb-1">Клиенты</h1>
      <p className="text-sm text-ink-secondary mb-4">
        {t.clients === 0
          ? "База пока пуста. Клиент заводится при оформлении заявки — или здесь, заранее."
          : `${clientsWord(t.clients)} · ${ordersWord(t.orders)} · ${money(t.revenue)} выручки`}
      </p>

      {t.clients > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Tile
            title="Средний чек"
            value={money(t.avgCheck)}
            hint="Выручка, делённая на число заявок"
          />
          <Tile
            title="В среднем с клиента"
            value={money(t.revenuePerClient)}
            hint="Сколько приносит одна карточка базы"
          />
          <Tile
            title="Молчат больше месяца"
            value={String(t.sleepingClients)}
            hint={t.sleepingClients > 0 ? "Повод позвонить, а не ждать" : "Все на связи"}
            warn={t.sleepingClients > 0}
          />
          <Tile
            title="Три крупнейших клиента"
            value={`${Math.round(t.top3Share)} %`}
            hint="Какая доля выручки держится на трёх точках"
            warn={t.top3Share > 50}
          />
        </div>
      )}

      {stats.ordersWithoutClient > 0 && (
        <div className="card mb-6 text-sm text-[#8a5a00]">
          Без карточки клиента: {ordersWord(stats.ordersWithoutClient)}. Они оформлены до появления
          базы и в разрезах ниже не считаются.
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
