import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { ROLES, farmLabel, retailLabel } from "@/lib/constants";
import { isRetailRole, retailTerritoryFor } from "@/lib/retail";
import { visibleOrdersFor } from "@/lib/orderVisibility";
import { newOrderLinkFor, newOrderLinksFor } from "@/lib/newOrder";
import OrdersTable from "@/components/OrdersTable";
import PageHeader from "@/components/PageHeader";
import { listUsers } from "@/lib/repo/users";
import { nameIndex } from "@/lib/personName";
import { localDayKey } from "@/lib/timezone";
import { orderPayState } from "@/lib/orderPay";
import { listClients } from "@/lib/repo/clients";
import { listWaOrderDrafts } from "@/lib/repo/waOrders";
import { draftSummary, freshDrafts, visibleDrafts } from "@/lib/waOrder";
import { formatDay, formatMoment } from "@/lib/formatDate";
import WaOrderDrafts, { type WaDraftRow } from "@/components/WaOrderDrafts";

export const dynamic = "force-dynamic";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams?: { stage?: string; manager?: string; q?: string };
}) {
  const session = await getServerSession(authOptions);
  const all = await listOrdersWithItems();
  const role = session?.user?.role;

  // Кто какие заявки видит — одно правило на список, поиск и «Мой день» (`orderVisibility.ts`).
  const myEmail = session?.user?.email?.toLowerCase() ?? "";
  const orders = visibleOrdersFor(all, { role, email: myEmail, farm: session?.user?.farm });
  const territory = retailTerritoryFor(role);

  // Имена сотрудников — чтобы в колонке «Менеджер» стояла фамилия, а не
  // почтовый адрес. Список кэшируется на минуту, лишнего чтения таблицы нет.
  const managerNames = nameIndex(await listUsers());

  const farm = role === "warehouse" ? session?.user?.farm ?? null : null;
  const newOrderLink = newOrderLinkFor(role);

  // Заказы из WhatsApp — менеджеру (свои клиенты и те, кого нет в базе) и админу.
  let draftRows: WaDraftRow[] = [];
  if (role === ROLES.ADMIN || role === ROLES.MANAGER) {
    const [drafts, clients] = await Promise.all([listWaOrderDrafts(), listClients()]);
    draftRows = visibleDrafts(freshDrafts(drafts, new Date()), clients, role, myEmail).map(({ draft, client }) => ({
      draftId: draft.draftId,
      at: formatMoment(draft.createdAt),
      who: client?.name || draft.senderName || `+${draft.phone}`,
      unknown: !client,
      managerName: client ? managerNames[(client.managerEmail || "").toLowerCase()] ?? "" : "",
      text: draft.text,
      summary: draftSummary(draft.items),
      delivery: draft.deliveryDate ? formatDay(draft.deliveryDate) : "",
    }));
  }

  return (
    <div>
      <PageHeader
        area="orders"
        title={territory ? `Заявки — ${retailLabel(territory)}` : "Заявки"}
        subtitle={farm ? `Только ${farmLabel(farm)}` : undefined}
        actions={
          /* Кому кнопка положена и куда ведёт — одной функцией (newOrder.ts).
             У РОПа её здесь не было вовсе, и он решил, что заявку на регион
             завести нельзя: возможность, о которой нельзя догадаться, ничем не
             отличается от отсутствующей. */
          <div className="flex flex-wrap gap-2">
            {/* Менеджер розницы продаёт и клиентам — мелкие заказы. */}
            {isRetailRole(role) && (
              <Link href="/orders/new?sale=1" className="btn-secondary">
                + Заявка клиенту
              </Link>
            )}
            {newOrderLink && (
              <Link href={newOrderLink.href} className="btn-primary">
                {isRetailRole(role) ? "+ Заявка магазину" : newOrderLink.label}
              </Link>
            )}
            {/* У РОПа вторая кнопка — объём на город. */}
            {newOrderLinksFor(role)
              .slice(1)
              .map((l) => (
                <Link key={l.href} href={l.href} className="btn-secondary">
                  {l.label}
                </Link>
              ))}
          </div>
        }
      />
      {draftRows.length > 0 && (
        <div className="mb-5">
          <WaOrderDrafts rows={draftRows} />
        </div>
      )}
      <OrdersTable
        orders={orders}
        managerNames={managerNames}
        today={localDayKey()}
        initialFilter={searchParams?.stage}
        initialManager={searchParams?.manager}
        initialSearch={searchParams?.q ?? ""}
        viewerRole={role ?? ""}
        viewerEmail={myEmail}
        canAdmin={role === ROLES.ADMIN}
        payStates={Object.fromEntries(orders.map((o) => [o.orderId, orderPayState(o, localDayKey())]))}
      />
    </div>
  );
}
