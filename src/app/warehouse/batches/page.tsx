import { listBatches } from "@/lib/repo/batches";
import { getSettings } from "@/lib/repo/settings";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import BatchesList from "@/components/BatchesList";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { farmLabel, getFarmFor } from "@/lib/constants";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { likelyDuplicates } from "@/lib/batchFix";

import PageHeader from "@/components/PageHeader";
import { WAREHOUSE_TABS } from "../tabs";

export const dynamic = "force-dynamic";

export default async function BatchesPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const farm = role === "warehouse" ? session?.user?.farm ?? null : null;
  // Исправить ошибочную приёмку — зав. складом своего цветка и админ (`batchFix.ts`).
  const canFix = role === "admin" || (role === "warehouse" && Boolean(farm));

  const [batches, settings, varieties] = await Promise.all([
    listBatches(),
    getSettings(),
    canFix ? listVarietiesByType() : Promise.resolve({} as Record<string, string[]>),
  ]);
  const own = batches.filter((b) => !farm || getFarmFor(b.flowerType) === farm);
  const duplicates = [...likelyDuplicates(own)];
  const infos = batches
    // Офисные партии — в разделе «Офис» (`officeStore.ts`).
    .filter((b) => !b.store)
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
      <BatchesList infos={infos} fix={canFix ? { varieties } : null} duplicates={duplicates} />
    </div>
  );
}
