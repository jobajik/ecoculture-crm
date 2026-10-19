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
import KpiTile from "@/components/KpiTile";
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

  // Цифры сверху (новый вид, 19.10.2026) — из тех же партий, что и список.
  const live = infos.filter((i) => i.batch.quantityRemaining > 0);
  const stems = (list: typeof infos) => list.reduce((s, i) => s + i.batch.quantityRemaining, 0);
  const critical = live.filter((i) => i.status === "critical");
  const warning = live.filter((i) => i.status === "warning");
  const nf = (n: number) => n.toLocaleString("ru-RU");

  return (
    <div>
      <PageHeader
        area="stock"
        title={`Партии на складе${farm ? ` · ${farmLabel(farm)}` : ""}`}
        icon="list"
        tabs={WAREHOUSE_TABS}
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="box" label="На складе" value={nf(stems(live))} hint={`шт. в ${nf(live.length)} парт.`} />
        <KpiTile
          icon="alert"
          label="Дольше срока"
          value={nf(stems(critical))}
          hint={critical.length > 0 ? `шт. в ${critical.length} парт.` : "нет"}
          tone={critical.length > 0 ? "bad" : "good"}
        />
        <KpiTile
          icon="clock"
          label="Скоро срок"
          value={nf(stems(warning))}
          hint={warning.length > 0 ? `шт. в ${warning.length} парт.` : "нет"}
          tone={warning.length > 0 ? "warn" : undefined}
        />
        <KpiTile
          icon="check"
          label="Похоже на повтор приёмки"
          value={nf(duplicates.length)}
          hint={duplicates.length > 0 ? "проверьте и исправьте" : "повторов нет"}
          tone={duplicates.length > 0 ? "warn" : "good"}
        />
      </div>
      <BatchesList infos={infos} fix={canFix ? { varieties } : null} duplicates={duplicates} />
    </div>
  );
}
