import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { listUsers } from "@/lib/repo/users";
import { getPlansForPeriod } from "@/lib/repo/plans";
import { ROLES, isValidPeriod, periodOf } from "@/lib/constants";
import SectionTabs from "@/components/SectionTabs";
import PeriodPicker from "@/components/PeriodPicker";
import ManagerPlansForm, { type ManagerPlanEntry } from "@/components/ManagerPlansForm";
import { plansTabsFor } from "./tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PlansPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.SALES_HEAD && role !== ROLES.ADMIN) redirect("/");

  const period =
    searchParams.period && isValidPeriod(searchParams.period)
      ? searchParams.period
      : periodOf(new Date());

  const [users, plans] = await Promise.all([listUsers(), getPlansForPeriod(period)]);

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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Планы</h1>
        <p className="text-sm text-ink-secondary">
          План продаж по менеджерам на месяц, отдельно по каждому цветку. План менеджера — это
          сумма его цветков; отдельным числом он не вводится. Отсюда план попадает в раздел
          «Продажи»: рейтинг показывает выполнение, а бонус считается от фактически оплаченного.
        </p>
      </div>

      <SectionTabs tabs={plansTabsFor(role)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker period={period} />
        <p className="text-sm text-ink-muted">
          Менеджеров в списке: {managers.length}
        </p>
      </div>

      {/* key по месяцу: при переключении форма пересоздаётся с нуля,
          чтобы цифры прошлого месяца не остались в полях. */}
      <ManagerPlansForm key={period} period={period} initial={initial} />
    </div>
  );
}
