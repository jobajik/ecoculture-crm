import KpiTile from "@/components/KpiTile";
import ShipQueueBoard from "@/components/ShipQueueBoard";
import { buildQueue, queueAlerts } from "@/lib/shipQueueRows";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listBatches } from "@/lib/repo/batches";
import { getSettings } from "@/lib/repo/settings";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import { localDayKey } from "@/lib/timezone";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

import PageHeader from "@/components/PageHeader";
import { officeTabsFor } from "../tabs";
import { inStore, isOfficeRole } from "@/lib/officeStore";
import { confirmRefusal } from "@/lib/orderRules";

export const dynamic = "force-dynamic";

/** Очередь офиса: заявки «Склад: Офис» — в основном бот после 12:00 (`officeStore.ts`). */
export default async function OfficeShipPage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  const myEmail = session?.user?.email?.toLowerCase() ?? "";

  const [orders, batches, settings] = await Promise.all([
    listOrdersWithItems(),
    listBatches(),
    getSettings(),
  ]);

  const scoped = inStore(orders, "office").filter((o) => o.items.length > 0);

  // Новый вид (19.10.2026): цифры сверху, ниже одна карточка «Можно отгружать / Ждут / Срок хранения».
  const today = localDayKey();
  const { ready, waiting } = buildQueue(scoped, today, (o) => confirmRefusal(o, role, myEmail, true) === "");
  const lateCount = ready.filter((r) => r.stage.lateDays > 0).length;
  const todayCount = ready.filter((r) => r.group === "today").length;
  const alerts = queueAlerts(
    inStore(batches, "office")
      .filter((b) => b.quantityRemaining > 0)
      .map((b) => computeBatchStorageInfo(b, settings))
  );
  const alertStems = alerts.reduce((s, a) => s + a.qty, 0);
  const canShip = isOfficeRole(role) || role === "admin";

  return (
    <div>
      <PageHeader
        area="stock"
        title="Отгрузка из офиса"
        subtitle="Доставка — такси или inDriver за счёт клиента"
        icon="truck"
        tabs={officeTabsFor(role)}
      />

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
        alertLinks={[{ href: "/office/writeoff", label: "Списание" }]}
        shipAction={canShip ? "ship" : "open"}
        clientLink={role !== "office"}
        showPhone
        emptyReady={waiting.length > 0 ? "Готовых заявок нет" : "Заявок офиса нет"}
      />
    </div>
  );
}
