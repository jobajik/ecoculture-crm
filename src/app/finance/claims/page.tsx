import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { listClaims } from "@/lib/repo/claims";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listUsers } from "@/lib/repo/users";
import { ROLES, formatGrade } from "@/lib/constants";
import SectionTabs from "@/components/SectionTabs";
import ClaimsBoard, { type ClaimView } from "@/components/ClaimsBoard";
import { FINANCE_TABS } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ClaimsPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  // Рекламации — разговор менеджера с бухгалтером, поэтому видят их обе роли:
  // менеджеру важно знать, чем кончилось его обращение.
  if (
    ![ROLES.ACCOUNTANT, ROLES.ADMIN, ROLES.MANAGER, ROLES.SALES_HEAD].includes(role as never)
  ) {
    redirect("/");
  }
  const canDecide = role === ROLES.ACCOUNTANT || role === ROLES.ADMIN;

  const [claims, orders, users] = await Promise.all([
    listClaims(),
    listOrdersWithItems(),
    listUsers(),
  ]);

  const orderById = new Map(orders.map((o) => [o.orderId, o]));
  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));

  const views: ClaimView[] = claims
    .filter((c) => orderById.has(c.orderId))
    .map((c) => {
      const order = orderById.get(c.orderId)!;
      return {
        claimId: c.claimId,
        createdAt: c.createdAt,
        orderId: c.orderId,
        managerName: nameByEmail.get(c.managerEmail) ?? c.managerEmail,
        reason: c.reason,
        comment: c.comment,
        status: c.status,
        decidedAt: c.decidedAt,
        accountantEmail: c.accountantEmail,
        decision: c.decision,
        clientName: order.clientName || "(без названия)",
        orderTotal: order.totalAmount,
        paidAmount: order.paidAmount,
        items: order.items.map((i) => ({
          itemId: i.itemId,
          label: `${i.variety} · ${formatGrade(i.grade)}`,
          quantity: i.quantity,
          shippedQuantity: i.shippedQuantity,
          unitPrice: i.unitPrice,
        })),
      };
    });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Рекламации</h1>
        <p className="text-sm text-ink-secondary">
          Клиент пожаловался менеджеру — менеджер заводит рекламацию на своей заявке, а решение
          принимает бухгалтер. Провести рекламацию значит пересчитать заявку: количество или цена
          меняются, сумма, долг и бонус менеджера едут следом. Отгруженное количество остаётся как
          было — цветок со склада уехал.
        </p>
      </div>

      <SectionTabs tabs={FINANCE_TABS} />

      <ClaimsBoard claims={views} canDecide={canDecide} />
    </div>
  );
}
