import { getDailySalesSnapshot } from "@/lib/dailySales";
import DailySalesDashboard from "@/components/DailySalesDashboard";

import PageHeader from "@/components/PageHeader";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { salesTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DailySalesPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const snapshot = await getDailySalesSnapshot(searchParams.date);

  return (
    <div className="space-y-5">
      <PageHeader area="sales" title="Продажи за день" icon="calendar" tabs={salesTabsFor(role)} />

      <DailySalesDashboard initial={snapshot} />
    </div>
  );
}
