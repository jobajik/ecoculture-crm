import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPicklist } from "@/lib/picklist";
import PicklistView from "@/components/PicklistView";
import { FARM_ORDER } from "@/lib/constants";

import SectionTabs from "@/components/SectionTabs";
import { WAREHOUSE_TABS } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

export default async function PicklistPage({
  searchParams,
}: {
  searchParams: { date?: string; farm?: string };
}) {
  const session = await getServerSession(authOptions);
  const date =
    searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)
      ? searchParams.date
      : todayKey();

  // Зав. складом печатает лист только своего производства; администратор может
  // переключаться между ними или смотреть сводно.
  const isAdmin = session?.user?.role === "admin";
  const ownFarm = session?.user?.farm ?? null;
  const requested = searchParams.farm && FARM_ORDER.includes(searchParams.farm) ? searchParams.farm : null;
  const farm = isAdmin ? requested : ownFarm;

  const picklist = await getPicklist(date, new Date(), undefined, farm);

  return (
    <div>
      <div className="mb-4">
        <SectionTabs tabs={WAREHOUSE_TABS} />
      </div>
      <PicklistView picklist={picklist} canSwitchFarm={isAdmin} />
    </div>
  );
}
