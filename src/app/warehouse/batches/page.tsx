import { listBatches } from "@/lib/repo/batches";
import { getSettings } from "@/lib/repo/settings";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import BatchesList from "@/components/BatchesList";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { farmLabel, getFarmFor } from "@/lib/constants";

import SectionTabs from "@/components/SectionTabs";
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
      <h1 className="text-xl font-semibold mb-1">
        Партии на складе{farm ? ` · ${farmLabel(farm)}` : ""}
      </h1>
      <p className="text-ink-secondary mb-3">
        Срок хранения считается от даты сбора. Партии ближе к концу срока показаны жёлтым, просроченные — красным.
      </p>

      <div className="mb-4">
        <SectionTabs tabs={WAREHOUSE_TABS} />
      </div>
      <BatchesList infos={infos} />
    </div>
  );
}
