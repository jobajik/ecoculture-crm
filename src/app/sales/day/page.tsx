import { getDailySalesSnapshot } from "@/lib/dailySales";
import DailySalesDashboard from "@/components/DailySalesDashboard";

import PageHeader from "@/components/PageHeader";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { salesTabsFor } from "../tabs";
import { redirect } from "next/navigation";
import { cityHomeIfClosed } from "@/lib/repo/cityScopeGate";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DailySalesPage({
  searchParams,
}: {
  searchParams: { date?: string };
}) {
  const session = await getServerSession(authOptions);
  // Менеджеру, посаженному в город, эта страница закрыта: цифры всей компании — не его (`cityScope.ts`).
  const cityHome = cityHomeIfClosed(session?.user);
  if (cityHome) redirect(cityHome);
  const role = session?.user?.role;
  const snapshot = await getDailySalesSnapshot(searchParams.date);

  return (
    <div>
      <PageHeader area="sales" title="Продажи за день" icon="calendar" tabs={salesTabsFor(role)} />

      <DailySalesDashboard initial={snapshot} />
    </div>
  );
}
