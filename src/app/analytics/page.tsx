import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAnalyticsSummary } from "@/lib/analytics";
import { farmLabel } from "@/lib/constants";
import AnalyticsBoard from "@/components/AnalyticsBoard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions);
  // Зав. складом видит аналитику только по своему производству.
  const farm = session?.user?.role === "warehouse" ? session.user.farm ?? null : null;
  const summary = await getAnalyticsSummary(farm);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Аналитика</h1>
          <p className="text-sm text-ink-secondary">
            Последние {summary.days} дней ({summary.periodLabel}) против предыдущих {summary.days} (
            {summary.prevLabel}).
            {farm && ` Только ваше производство — ${farmLabel(farm)}.`}
          </p>
        </div>
        <span className="text-xs text-ink-muted">
          Обновлено {new Date(summary.generatedAt).toLocaleString("ru-RU")}
        </span>
      </div>

      <AnalyticsBoard summary={summary} />
    </div>
  );
}
