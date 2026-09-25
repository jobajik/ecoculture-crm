import { listBatches } from "@/lib/repo/batches";
import { getSettings } from "@/lib/repo/settings";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import BatchesList from "@/components/BatchesList";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { farmLabel, getFarmFor } from "@/lib/constants";

import PageHeader from "@/components/PageHeader";
import { WAREHOUSE_TABS } from "../tabs";

export const dynamic = "force-dynamic";

export default async function BatchesPage() {
  const session = await getServerSession(authOptions);
  const farm = session?.user?.role === "warehouse" ? session.user.farm ?? null : null;

  const [batches, settings] = await Promise.all([listBatches(), getSettings()]);
  const infos = batches
    .filter((b) => !farm || getFarmFor(b.flowerType) === farm)
    .map((b) => computeBatchStorageInfo(b, settings));

  return (
    <div>
      <PageHeader
        area="stock"
        title={`Партии на складе${farm ? ` · ${farmLabel(farm)}` : ""}`}
        icon="list"
        tabs={WAREHOUSE_TABS}
      />
      <BatchesList infos={infos} />
    </div>
  );
}
