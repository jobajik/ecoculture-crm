import { listBatches } from "@/lib/repo/batches";
import { stockPositions } from "@/lib/writeoffPlan";
import { inStore } from "@/lib/officeStore";
import PageHeader from "@/components/PageHeader";
import RegionNav from "@/components/RegionNav";
import RegionDenied from "@/components/RegionDenied";
import WriteoffBulkForm from "@/components/WriteoffBulkForm";
import { loadRegion } from "../../load";

export const dynamic = "force-dynamic";

/** Списание и пересчёт на складе города — тем же путём, что на основном складе, но только партии этого города. */
export default async function RegionWriteoffPage({ params, searchParams }: { params: { store: string }; searchParams?: { mode?: string } }) {
  const r = await loadRegion(params.store);
  if (!r.access.view) return <RegionDenied city={r.info.label} />;
  const positions = r.access.keeper ? stockPositions(inStore(await listBatches(), r.store), null) : [];
  return (
    <div>
      <PageHeader area="stock" title={`Списание — ${r.info.label}`} subtitle="Снимается с самых старых партий позиции." icon="alert" tabs={r.headerTabs} />
      {r.home.all && <RegionNav store={r.store} tabs={r.tabs} current={`/region/${r.store}/writeoff`} />}
      {!r.access.keeper ? (
        <p className="card text-sm text-ink-secondary">Списывает тот, кто ведёт склад города, — директор региона.</p>
      ) : (
        <WriteoffBulkForm positions={positions} store={r.store} initialMode={searchParams?.mode === "recount" ? "recount" : "writeoff"} />
      )}
    </div>
  );
}
