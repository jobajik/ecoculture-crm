import Link from "next/link";
import KpiTile from "@/components/KpiTile";
import ShipQueueBoard from "@/components/ShipQueueBoard";
import { buildQueue, queueAlerts } from "@/lib/shipQueueRows";
import { listOrdersWithItems } from "@/lib/repo/orders";
import { listBatches } from "@/lib/repo/batches";
import { getSettings } from "@/lib/repo/settings";
import { computeBatchStorageInfo } from "@/lib/shelfLife";
import { localDayKey } from "@/lib/timezone";
import { farmLabel, getFarmFor } from "@/lib/constants";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

import PageHeader from "@/components/PageHeader";
import { WAREHOUSE_TABS } from "./tabs";
import { isOffice } from "@/lib/officeStore";

export const dynamic = "force-dynamic";

export default async function WarehousePage() {
  const session = await getServerSession(authOptions);
  const farm = session?.user?.role === "warehouse" ? session.user.farm ?? null : null;

  const [orders, batches, settings] = await Promise.all([
    listOrdersWithItems(),
    listBatches(),
    getSettings(),
  ]);

  // Зав. складом видит только заявки со своим цветком и только эти позиции.
  // Заявки офиса собирает склад офиса — здесь их нет (`officeStore.ts`).
  const scoped = orders
    .filter((o) => !isOffice(o))
    .map((o) => ({
      ...o,
      items: farm ? o.items.filter((i) => getFarmFor(i.flowerType) === farm) : o.items,
    }))
    .filter((o) => o.items.length > 0);

  // В очереди — то, что ещё есть отгружать СВОИМ цветком; сначала опоздавшие, давние выше (`byUrgency`, внутри
  // `buildQueue`). Новый вид (19.10.2026): цифры сверху, ниже одна карточка с вкладками и страницами.
  const today = localDayKey();
  const { ready, waiting } = buildQueue(scoped, today);
  const lateCount = ready.filter((r) => r.stage.lateDays > 0).length;
  const todayCount = ready.filter((r) => r.group === "today").length;
  const alerts = queueAlerts(
    batches
      .filter((b) => b.quantityRemaining > 0 && !b.store)
      .filter((b) => !farm || getFarmFor(b.flowerType) === farm)
      .map((b) => computeBatchStorageInfo(b, settings))
  );
  const alertStems = alerts.reduce((s, a) => s + a.qty, 0);

  return (
    <div>
      <PageHeader
        area="stock"
        title="Очередь на отгрузку"
        subtitle={farm ? `Производство: ${farmLabel(farm)}` : undefined}
        icon="truck"
        tabs={WAREHOUSE_TABS}
        actions={
          <div className="flex gap-2">
            <Link href="/orders/new?region=1" className="btn-secondary">
              + Опт в регион
            </Link>
            <Link href="/warehouse/receive" className="btn-primary">
              + Приёмка
            </Link>
          </div>
        }
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
        alertLinks={[
          { href: "/warehouse/batches", label: "Все партии" },
          { href: "/warehouse/writeoff?mode=recount", label: "Сверить остаток" },
        ]}
        emptyReady={waiting.length > 0 ? "Готовых заявок нет" : "Отгружать нечего"}
      />
    </div>
  );
}
