import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
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
import Section from "@/components/Section";
import Icon from "@/components/Icon";
import { orderCode } from "@/lib/paymentStage";
import { canSeeShop, isOwnShop, isRetailRole, retailLabel } from "@/lib/retail";

export const dynamic = "force-dynamic";

const money = (v: number) => `${Math.round(v).toLocaleString("ru-RU")} ₸`;

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (
    role !== ROLES.MANAGER &&
    role !== ROLES.SALES_HEAD &&
    role !== ROLES.ADMIN &&
    !isRetailRole(role)
  ) {
    redirect("/?error=forbidden");
  }

  const client = await getClientById(params.id);
  if (!client) notFound();

  // Карточка магазина открыта только своей рознице, РОПу и админу; менеджеру
  // розницы, наоборот, доступны ТОЛЬКО магазины его направления.
  const shop = isOwnShop(client);
  if (shop && role !== ROLES.ADMIN && role !== ROLES.SALES_HEAD && !canSeeShop(role, client)) {
    notFound();
  }
  // Менеджеру розницы из клиентов открыты только СВОИ карточки: он продаёт
  // мелким клиентам, которых сам и завёл.
  if (!shop && isRetailRole(role) && client.managerEmail !== (session?.user?.email ?? "").toLowerCase()) {
    notFound();
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
  const row = stats.rows.find((r) => r.client.clientId === client.clientId);

  // История заказов клиента — свежие сверху: смотрят обычно последние.
  const myOrders = orders
    .filter((o) => o.clientId === client.clientId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const email = session?.user?.email?.toLowerCase() ?? "";
  const canEdit =
    role === ROLES.ADMIN ||
    role === ROLES.SALES_HEAD ||
    client.managerEmail === email ||
    // Магазин ведёт вся розница своего направления, а не только тот, кто завёл
    // карточку: людей там мало, и «чужая карточка» между двумя коллегами одного
    // направления означала бы просто неисправимую опечатку.
    (shop && canSeeShop(role, client));

  return (
    <div className="max-w-4xl">
      {/* «Лицо» клиента: имя крупно, главное о нём и четыре цифры. Синий — цвет
          клиента по всему сайту (Section tone="client"). */}
      <header className="relative overflow-hidden rounded-2xl border border-section-client/15 bg-gradient-to-br from-section-client-soft via-surface to-surface shadow-card mb-5">
        <Image
          src="/logo-mark.png"
          alt=""
          aria-hidden="true"
          width={260}
          height={260}
          className="absolute -right-14 -top-20 w-64 h-64 object-contain opacity-[0.10] pointer-events-none select-none"
        />
        <div className="relative p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-section-client">
                <Icon name="client" className="w-4 h-4" />
                {shop ? `Наш магазин · ${retailLabel(client.retail)}` : "Клиент"}
              </div>
              <h1 className="font-display text-[30px] leading-tight font-extrabold tracking-tight mt-1 break-words">
                {client.name}
              </h1>
              <p className="text-sm text-ink-secondary mt-0.5">
                {[client.city, client.shopName, client.clientType].filter(Boolean).join(" · ") || "—"}
                {client.managerEmail && ` · ${nameByEmail.get(client.managerEmail) ?? client.managerEmail}`}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {client.phone && (
                  <a
                    href={`tel:${client.phone.replace(/[^\d+]/g, "")}`}
                    className="badge bg-surface border border-line-hairline text-ink-primary hover:border-section-client"
                  >
                    <Icon name="phone" className="w-3.5 h-3.5 text-section-client" />
                    {client.phone}
                  </a>
                )}
                {client.paymentMethod && (
                  <span className="badge bg-surface border border-line-hairline text-ink-secondary">
                    <Icon name="card" className="w-3.5 h-3.5" />
                    {client.paymentMethod}
                  </span>
                )}
                {client.paymentTerms && (
                  <span className="badge bg-surface border border-line-hairline text-ink-secondary">
                    <Icon name="clock" className="w-3.5 h-3.5" />
                    {client.paymentTerms}
                  </span>
                )}
                {row?.sleeping && (
                  <span className="badge bg-status-warning/15 text-[#8a5a00]">
                    молчит с {formatDay(row.lastOrderDate)}
                  </span>
                )}
              </div>
            </div>
            <Link
              href={shop ? "/retail/shops" : "/clients"}
              className="text-sm text-ink-secondary hover:underline"
            >
              {shop ? "← Все магазины" : "← Все клиенты"}
            </Link>
          </div>

          {row && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-px mt-5 rounded-xl overflow-hidden border border-line-hairline bg-line-hairline">
              <Stat title="Заявок" value={String(row.orders)} hint={row.neverOrdered ? "ещё не заказывал" : `первый ${formatDay(row.firstOrderDate)}`} />
              <Stat title="Выручка" value={money(row.revenue)} hint="по счетам" />
              <Stat
                title="Средний чек"
                value={row.orders > 0 ? money(row.avgCheck) : "—"}
                hint={row.orders > 0 ? `≈ ${Math.round(row.avgStems)} стеблей` : "заказов не было"}
              />
              <Stat
                title={row.debt > 0 ? "Должен" : "Долгов нет"}
                value={row.debt > 0 ? money(row.debt) : money(row.paid)}
                hint={row.debt > 0 ? "остаток по счетам" : "оплачено всего"}
                tone={row.debt > 0 ? "warn" : "good"}
              />
            </div>
          )}
        </div>
      </header>

      <div className="mb-5">
        <ClientCard
          clientId={client.clientId}
          canEdit={canEdit}
          canSetRetail={role === ROLES.ADMIN || role === ROLES.SALES_HEAD}
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
            retail: client.retail,
            source: client.source,
            note: client.note,
          }}
        />
      </div>

      <Section
        tone="order"
        icon="order"
        title="История заказов"
        aside={<span className="text-ink-muted">{myOrders.length}</span>}
        flush
      >
      <div className="table-scroll table-cards border-t border-line-hairline">
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
                <td data-label="Заявка" className="px-4 py-2.5 whitespace-nowrap">
                  <Link href={`/orders/${o.orderId}`} className="font-display font-bold hover:text-accent">
                    № {orderCode(o.orderId)}
                  </Link>
                </td>
                <td data-label="Оформлена" className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">
                  {formatDay(o.createdAt)}
                </td>
                <td data-label="Доставка" className="px-4 py-2.5 text-ink-secondary whitespace-nowrap">
                  {formatDay(o.deliveryDate)}
                </td>
                <td data-label="Позиции" className="px-4 py-2.5 text-ink-secondary">
                  {o.items
                    .map((i) => `${i.variety} ${formatGrade(i.grade)} — ${i.quantity}`)
                    .join(", ")}
                </td>
                <td data-label="Сумма" className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap">
                  {money(o.totalAmount)}
                </td>
                <td data-label="Статус" className="px-4 py-2.5">
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
      </Section>
    </div>
  );
}

function Stat({
  title,
  value,
  hint,
  tone,
}: {
  title: string;
  value: string;
  hint?: string;
  tone?: "warn" | "good";
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.1em] text-ink-muted">{title}</div>
      <div
        className={`font-display text-xl sm:text-2xl font-extrabold tabular-nums mt-0.5 ${
          tone === "warn" ? "text-[#8a5a00]" : tone === "good" ? "text-status-good" : ""
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-xs text-ink-muted mt-0.5">{hint}</div>}
    </div>
  );
}
