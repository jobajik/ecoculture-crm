import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { listUsers } from "@/lib/repo/users";
import { getPlansForPeriod } from "@/lib/repo/plans";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { getSalesSnapshot } from "@/lib/salesAnalytics";
import { ROLES } from "@/lib/constants";
import { paceOf } from "@/lib/planOverview";
import { localDayKey } from "@/lib/timezone";
import PageHeader from "@/components/PageHeader";
import PeriodPicker from "@/components/PeriodPicker";
import ManagerPlansForm, { type ManagerPlanEntry } from "@/components/ManagerPlansForm";
import { plansTabsFor } from "../tabs";
import { monthFrom, prefetchPlanTabs } from "../data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * «Планы → Продажи»: план менеджерам на месяц по цветкам — и рядом ФАКТ.
 *
 * Раньше здесь были только поля ввода, а выполнение жило в «Продажах → План и
 * факт»: РОП ставил план в одном разделе и шёл проверять его в другой. Теперь в
 * каждой строке рядом с планом стоит продано за месяц и полоска выполнения с
 * отметкой темпа (`PlanProgress`). Факт считается той же функцией, что рейтинг и
 * «План и факт» (`getSalesSnapshot`) — два разных числа об одном и том же в двух
 * разделах читались бы как ошибка.
 */
export default async function PlansSalesPage({ searchParams }: { searchParams: { period?: string } }) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.SALES_HEAD && role !== ROLES.ADMIN) redirect("/");

  const period = monthFrom(searchParams.period);

  await prefetchPlanTabs();
  const [users, plans, orders] = await Promise.all([listUsers(), getPlansForPeriod(period), listOrdersWithItems()]);
  const sales = await getSalesSnapshot(period, new Date(), { orders, users, plans });

  const managers = users
    .filter((u) => u.active && u.role === ROLES.MANAGER)
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, "ru"));

  const initial: ManagerPlanEntry[] = managers.map((m) => {
    const plan = plans.get(m.email);
    return {
      email: m.email,
      name: m.name,
      byFlower: plan?.byFlower ?? {},
      legacyAmount: plan?.legacy.targetAmount ?? 0,
      legacyStems: plan?.legacy.targetStems ?? 0,
      splitByFlower: plan?.splitByFlower ?? false,
    };
  });

  const fact: Record<string, Record<string, { amount: number; stems: number }>> = {};
  for (const row of sales.managers) fact[row.managerEmail] = row.byFlower;
  const pace = paceOf(period, localDayKey()).pacePercent;

  return (
    <div className="space-y-5">
      <PageHeader area="plans" title="Планы продаж" icon="chart" tabs={plansTabsFor(role, period)} />

      <PeriodPicker period={period} />

      {/* key по месяцу: при переключении форма пересоздаётся с нуля,
          чтобы цифры прошлого месяца не остались в полях. */}
      <ManagerPlansForm key={period} period={period} initial={initial} fact={fact} pace={pace} />
    </div>
  );
}
