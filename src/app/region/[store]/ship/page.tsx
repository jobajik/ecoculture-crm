import KpiTile from "@/components/KpiTile";
import ShipQueueBoard from "@/components/ShipQueueBoard";
import PageHeader from "@/components/PageHeader";
import RegionNav from "@/components/RegionNav";
import RegionDenied from "@/components/RegionDenied";
import { buildQueue, queueAlerts } from "@/lib/shipQueueRows";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listBatches } from "@/lib/repo/batches";
import { getSettings } from "@/lib/repo/settings";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import { inStore } from "@/lib/officeStore";
import { confirmRefusal } from "@/lib/orderRules";
import { loadRegion } from "../../load";

export const dynamic = "force-dynamic";

/** Очередь города: заявки клиентам «Склад: <город>» — пока там есть товар (`officeStore.ts`). Отгружает тот, кто ведёт склад. */
export default async function RegionShipPage({ params }: { params: { store: string } }) {
  const r = await loadRegion(params.store);
  if (!r.access.view) return <RegionDenied city={r.info.label} />;
  const [orders, batches, settings] = await Promise.all([listOrdersWithItems(), listBatches(), getSettings()]);
  const scoped = inStore(orders, r.store).filter((o) => o.items.length > 0);
  const { ready, waiting } = buildQueue(scoped, r.today, (o) => confirmRefusal(o, r.role, r.email, true) === "");
  const lateCount = ready.filter((x) => x.stage.lateDays > 0).length;
  const todayCount = ready.filter((x) => x.group === "today").length;
  const alerts = queueAlerts(
    inStore(batches, r.store)
      .filter((b) => b.quantityRemaining > 0)
      .map((b) => computeBatchStorageInfo(b, settings))
  );
  const alertStems = alerts.reduce((s, a) => s + a.qty, 0);
  const base = `/region/${r.store}`;

  return (
    <div>
      <PageHeader area="stock" title={`Отгрузка клиентам — ${r.info.label}`} subtitle={`Заявки клиентам со склада ${r.info.genitive}`} icon="truck" tabs={r.headerTabs} />
      {r.home.all && <RegionNav store={r.store} tabs={r.tabs} current={`${base}/ship`} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile icon="truck" label="Можно отгружать" value={ready.length.toLocaleString("ru-RU")} hint="готовы к сборке" />
        <KpiTile
          icon="calendar"
          label="На сегодня"
          value={todayCount.toLocaleString("ru-RU")}
          hint={lateCount > 0 ? `${lateCount} опаздывают` : "опозданий нет"}
          tone={lateCount > 0 ? "bad" : undefined}
        />
        <KpiTile icon="clock" label="Ждут подтверждения или оплаты" value={waiting.length.toLocaleString("ru-RU")} hint="отгружать пока нельзя" />
        <KpiTile
          icon="alert"
          label="Срок хранения на исходе"
          value={alertStems.toLocaleString("ru-RU")}
          hint={alerts.length > 0 ? `шт. в ${alerts.length} парт.` : "всё в сроке"}
          tone={alerts.some((a) => a.critical) ? "bad" : alerts.length > 0 ? "warn" : "good"}
        />
      </div>

      <ShipQueueBoard
        ready={ready}
        waiting={waiting}
        alerts={alerts}
        alertLinks={r.access.keeper ? [{ href: `${base}/writeoff`, label: "Списание" }] : []}
        shipAction={r.access.keeper ? "ship" : "open"}
        clientLink
        showPhone
        emptyReady={waiting.length > 0 ? "Готовых заявок нет" : `Заявок со склада ${r.info.genitive} нет`}
      />
    </div>
  );
}
