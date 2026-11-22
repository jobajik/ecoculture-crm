import { getSalesSnapshot } from "@/lib/salesAnalytics";
import SalesDashboard from "@/components/SalesDashboard";
import PageHeader from "@/components/PageHeader";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { salesTabsFor } from "../tabs";
import { redirect } from "next/navigation";
import { cityHomeIfClosed } from "@/lib/repo/cityScopeGate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SalesPlanPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const session = await getServerSession(authOptions);
  // Менеджеру, посаженному в город, эта страница закрыта: цифры всей компании — не его (`cityScope.ts`).
  const cityHome = cityHomeIfClosed(session?.user);
  if (cityHome) redirect(cityHome);
  const role = session?.user?.role;
  const snapshot = await getSalesSnapshot(searchParams.period);

  return (
    <div>
      <PageHeader
        area="sales"
        title="План и факт"
        tabs={salesTabsFor(role)}
      />

      <SalesDashboard initial={snapshot} />
    </div>
  );
}
