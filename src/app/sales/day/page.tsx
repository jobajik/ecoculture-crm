import { getDailySalesSnapshot } from "@/lib/dailySales";
import DailySalesDashboard from "@/components/DailySalesDashboard";

import SectionTabs from "@/components/SectionTabs";
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
      <div>
        <h1 className="text-xl font-semibold">Продажи за день</h1>
        <p className="text-sm text-ink-secondary">
          Кто сколько продал, каких цветов и в какое время. Обновляется автоматически.
        </p>
      </div>

      <SectionTabs tabs={salesTabsFor(role)} />

      <DailySalesDashboard initial={snapshot} />
    </div>
  );
}
