import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAnalyticsSummary } from "@/lib/analytics";
import { FLOWER_TYPE_LABELS, farmLabel } from "@/lib/constants";
import StatTile from "@/components/StatTile";
import StorageStatusBadge from "@/components/StorageStatusBadge";
import StockByVarietyChart from "@/components/charts/StockByVarietyChart";
import StorageHistogramChart from "@/components/charts/StorageHistogramChart";
import SalesByWeekCharts from "@/components/charts/SalesByWeekCharts";
import SalesByManagerChart from "@/components/charts/SalesByManagerChart";
import SalesByVarietyChart from "@/components/charts/SalesByVarietyChart";
import PriceDynamicsChart from "@/components/charts/PriceDynamicsChart";
import WriteoffsChart from "@/components/charts/WriteoffsChart";
import type { StorageStatus } from "@/lib/shelfLife";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions);
  // Зав. складом видит аналитику только по своему производству.
  const farm = session?.user?.role === "warehouse" ? session.user.farm ?? null : null;
  const summary = await getAnalyticsSummary(farm);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Аналитика</h1>
          {farm && (
            <p className="text-sm text-ink-secondary">Только ваше производство — {farmLabel(farm)}</p>
          )}
        </div>
        <span className="text-xs text-ink-muted">
          Обновлено {new Date(summary.generatedAt).toLocaleString("ru-RU")}
        </span>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label="Заявок оформлено"
          value={summary.sales.totalOrders.toString()}
          sub="без учёта отменённых"
        />
        <StatTile
          label="Выручка (по заявкам)"
          value={`${Math.round(summary.sales.totalRevenue).toLocaleString("ru-RU")} ₸`}
        />
        <StatTile
          label="Среднее время в хранении"
          value={`${summary.storage.avgDaysInStorage.toFixed(1)} дн.`}
          sub={`${summary.storage.activeBatchCount} активных партий`}
        />
        <StatTile
          label="Списано от принятого"
          value={`${summary.writeoffs.percentOfReceived.toFixed(1)}%`}
          sub={`${summary.writeoffs.totalWriteoffQuantity} шт. списано`}
          tone={summary.writeoffs.percentOfReceived > 10 ? "critical" : summary.writeoffs.percentOfReceived > 5 ? "warning" : "good"}
        />
      </div>

      {summary.storage.alerts.length > 0 && (
        <div className="card">
          <h3 className="font-medium mb-3">Партии, требующие внимания по сроку хранения</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-secondary border-b border-line-hairline">
                  <th className="px-3 py-2 font-medium">Партия</th>
                  <th className="px-3 py-2 font-medium">Сорт</th>
                  <th className="px-3 py-2 font-medium">В хранении</th>
                  <th className="px-3 py-2 font-medium">Остаток</th>
                  <th className="px-3 py-2 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody>
                {summary.storage.alerts.slice(0, 10).map((a) => (
                  <tr key={a.batchId} className="border-b border-line-hairline last:border-0">
                    <td className="px-3 py-2 font-medium">{a.batchId}</td>
                    <td className="px-3 py-2">
                      {FLOWER_TYPE_LABELS[a.flowerType] ?? a.flowerType} {a.variety}
                    </td>
                    <td className="px-3 py-2 text-ink-secondary">
                      {a.daysInStorage} из {a.maxDays} дн.
                    </td>
                    <td className="px-3 py-2">{a.quantityRemaining} шт.</td>
                    <td className="px-3 py-2">
                      <StorageStatusBadge status={a.status as StorageStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <StockByVarietyChart data={summary.stockByVariety} />
        <StorageHistogramChart data={summary.storage.histogram} />
      </div>

      <SalesByWeekCharts data={summary.sales.byWeek} />

      <div className="grid md:grid-cols-2 gap-4">
        <SalesByManagerChart data={summary.sales.byManager} />
        <SalesByVarietyChart data={summary.sales.byVariety} />
      </div>

      <PriceDynamicsChart data={summary.priceDynamics} />

      <WriteoffsChart data={summary.writeoffs} />
    </div>
  );
}
