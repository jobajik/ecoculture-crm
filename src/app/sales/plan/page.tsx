import { getSalesSnapshot } from "@/lib/salesAnalytics";
import SalesDashboard from "@/components/SalesDashboard";
import SectionTabs from "@/components/SectionTabs";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { salesTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SalesPlanPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const snapshot = await getSalesSnapshot(searchParams.period);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">План и факт</h1>
        <p className="text-sm text-ink-secondary">
          Выполнение месячного плана. Продажа засчитывается по дате оформления заявки, отменённые
          не учитываются.
        </p>
      </div>

      <SectionTabs tabs={salesTabsFor(role)} />

      <SalesDashboard initial={snapshot} />
    </div>
  );
}
