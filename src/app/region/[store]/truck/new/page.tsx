import PageHeader from "@/components/PageHeader";
import RegionNav from "@/components/RegionNav";
import RegionDenied from "@/components/RegionDenied";
import TruckOrderForm, { type TruckCatalogRow } from "@/components/TruckOrderForm";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { listBatches } from "@/lib/repo/batches";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { FLOWER_TYPE_LABELS, compareGrades, formatGrade } from "@/lib/constants";
import { inStore } from "@/lib/officeStore";
import { cityShortage } from "@/lib/regionTruck";
import { stockKey } from "@/lib/truckLoad";
import { shipDayLabel } from "@/lib/managerProfile";
import { loadRegion, loadTruckOrders } from "../../../load";

export const dynamic = "force-dynamic";

/**
 * Новый заказ на фуру от города — форма менеджера города (`TruckOrderForm`, правила — `regionTruck.ts`). С 22.11.2026 —
 * списком: всё, что лежит на производстве, рядом остаток города, что уже едет и чего не хватает под заявки клиентов.
 */
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
        <p className="card text-sm text-ink-secondary">Заказ на фуру подаёт менеджер города. Посадить менеджера в город — «Настройки → Регионы».</p>
      </div>
    );
  }
  const [varieties, batches, orders, truck] = await Promise.all([listVarietiesByType(), listBatches(), listOrdersWithItems(), loadTruckOrders(r.store, r.today)]);

  const rows = new Map<string, TruckCatalogRow>();
  const rowOf = (flowerType: string, variety: string, grade: string) => {
    const key = stockKey(flowerType, variety, grade);
    let row = rows.get(key);
    if (!row) {
      row = { key, flowerType, flower: FLOWER_TYPE_LABELS[flowerType] ?? flowerType, variety: variety.trim(), grade: grade.trim(), gradeLabel: formatGrade(grade), main: 0, city: 0, coming: 0, need: 0 };
      rows.set(key, row);
    }
    return row;
  };
  for (const b of inStore(batches, "")) if (b.quantityRemaining > 0) rowOf(b.flowerType, b.variety, b.grade).main += b.quantityRemaining;
  const cityStock: Record<string, number> = {};
  for (const b of inStore(batches, r.store)) {
    if (b.quantityRemaining <= 0) continue;
    rowOf(b.flowerType, b.variety, b.grade).city += b.quantityRemaining;
    const k = stockKey(b.flowerType, b.variety, b.grade);
    cityStock[k] = (cityStock[k] ?? 0) + b.quantityRemaining;
  }
  // Что уже заказано на фуру (ждёт погрузки) или едет и не принято — только опт: он ляжет на склад города.
  const coming: Record<string, number> = {};
  for (const o of truck.orders) {
    if (o.kind !== "wholesale" || !["waiting", "loading", "transit"].includes(o.stage)) continue;
    for (const i of o.items) {
      const q = Math.max(0, i.quantity - i.shipped) + i.pending;
      if (q <= 0) continue;
      const k = stockKey(i.flowerType, i.variety, i.grade);
      coming[k] = (coming[k] ?? 0) + q;
      rowOf(i.flowerType, i.variety, i.grade).coming += q;
    }
  }
  const need = cityShortage({ store: r.store, orders, cityStock, coming });
  for (const o of orders) {
    for (const i of o.items) {
      const k = stockKey(i.flowerType, i.variety, i.grade);
      if (need[k] && !rows.has(k)) rowOf(i.flowerType, i.variety, i.grade);
    }
  }
  for (const [k, q] of Object.entries(need)) {
    const row = rows.get(k);
    if (row) row.need = q;
  }
  const ORDER = ["rose", "chrysanthemum", "chrysanthemum_rf", "eustoma"];
  const catalog = Array.from(rows.values()).sort(
    (a, b) => ORDER.indexOf(a.flowerType) - ORDER.indexOf(b.flowerType) || a.variety.localeCompare(b.variety, "ru") || compareGrades(a.flowerType, a.grade, b.grade)
  );

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
        retailCard={truck.retailCard?.name ?? ""}
        catalog={catalog}
      />
    </div>
  );
}
