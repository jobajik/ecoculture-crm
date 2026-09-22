import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { listMoneyLog } from "@/lib/repo/moneyLog";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { ROLES } from "@/lib/constants";
import Hint from "@/components/Hint";
import SectionTabs from "@/components/SectionTabs";
import MoneyLogView, { type MoneyLogRow } from "@/components/MoneyLogView";
import { financeTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function MoneyLogPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  // Журнал открыт бухгалтеру, администратору и РОПу: он про деньги, а не про
  // личные данные, и закрывать его от того, кто отвечает за продажи, незачем.
  if (![ROLES.ACCOUNTANT, ROLES.ADMIN, ROLES.SALES_HEAD].includes(role as never)) {
    redirect("/");
  }

  const [entries, orders, users] = await Promise.all([
    listMoneyLog(),
    listOrdersWithItems(),
    listUsers(),
  ]);

  const orderById = new Map(orders.map((o) => [o.orderId, o]));
  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));

  const rows: MoneyLogRow[] = entries.map((e) => ({
    logId: e.logId,
    createdAt: e.createdAt,
    actorName: nameByEmail.get(e.actorEmail) ?? e.actorEmail,
    orderId: e.orderId,
    clientName: orderById.get(e.orderId)?.clientName ?? "",
    action: e.action,
    details: e.details,
    amountBefore: e.amountBefore,
    amountAfter: e.amountAfter,
  }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">
          Журнал действий по деньгам
          <Hint>
            Записи только добавляются, править нельзя. Последняя колонка: у оплаты — полученная
            сумма, у пересчёта — сумма заявки.
          </Hint>
        </h1>
      </div>

      <SectionTabs tabs={financeTabsFor(role)} />

      <MoneyLogView rows={rows} />
    </div>
  );
}
