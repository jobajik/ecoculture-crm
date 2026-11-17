import PageHeader from "@/components/PageHeader";
import RegionNav from "@/components/RegionNav";
import RegionDenied from "@/components/RegionDenied";
import TruckOrderForm from "@/components/TruckOrderForm";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { listBatches } from "@/lib/repo/batches";
import { listClients } from "@/lib/repo/clients";
import { inStore } from "@/lib/officeStore";
import { retailCardsOf } from "@/lib/regionTruck";
import { shipDayLabel } from "@/lib/managerProfile";
import { loadRegion } from "../../../load";

export const dynamic = "force-dynamic";

/** Новый заказ на фуру от региона — форма директора (`TruckOrderForm`, правила — `regionTruck.ts`). */
export default async function RegionTruckNewPage({ params }: { params: { store: string } }) {
  const r = await loadRegion(params.store);
  if (!r.access.view) return <RegionDenied city={r.info.label} />;
  const base = `/region/${r.store}`;
  const header = <PageHeader area="stock" title={`Заказ на фуру — ${r.info.label}`} subtitle="Что и сколько прислать ближайшей фурой" icon="truck" tabs={r.headerTabs} />;
  if (!r.access.order) {
    return (
      <div>
        {header}
        {r.home.all && <RegionNav store={r.store} tabs={r.tabs} current={`${base}/truck/new`} />}
        <p className="card text-sm text-ink-secondary">Заказ на фуру подаёт директор региона. Назначить директора — «Настройки → Директора регионов».</p>
      </div>
    );
  }
  const [varieties, batches, clients] = await Promise.all([listVarietiesByType(), listBatches(), listClients()]);
  const cityStock: Record<string, number> = {};
  for (const b of inStore(batches, r.store)) {
    if (b.quantityRemaining <= 0) continue;
    const k = `${b.flowerType}|${b.variety}|${b.grade}`;
    cityStock[k] = (cityStock[k] ?? 0) + b.quantityRemaining;
  }
  const card = retailCardsOf(clients, r.store).find((c) => c.active);
  return (
    <div>
      {header}
      {r.home.all && <RegionNav store={r.store} tabs={r.tabs} current={`${base}/truck/new`} />}
      <TruckOrderForm
        store={r.store}
        city={r.info.label}
        initialDate={r.truckDay}
        minDate={r.today}
        truckDayLabel={shipDayLabel(r.truckDay)}
        varieties={varieties}
        retailCard={card?.name ?? ""}
        cityStock={cityStock}
      />
    </div>
  );
}
