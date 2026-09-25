import { getSalesSnapshot } from "@/lib/salesAnalytics";
import SalesDashboard from "@/components/SalesDashboard";
import PageHeader from "@/components/PageHeader";
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
      <PageHeader
        area="sales"
        title="План и факт"
        subtitle="Продажа засчитывается по дате оформления заявки."
        tabs={salesTabsFor(role)}
      />

      <SalesDashboard initial={snapshot} />
    </div>
  );
}
