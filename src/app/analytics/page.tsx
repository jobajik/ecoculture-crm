import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAnalyticsByFarm } from "@/lib/analytics";
import Hint from "@/components/Hint";
import AnalyticsReport from "@/components/AnalyticsReport";
import FlowerSummary from "@/components/FlowerSummary";
import PageHeader from "@/components/PageHeader";
import { analyticsTabsFor } from "./tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Аналитика — отчёт одной таблицей, колонки по производствам.
 *
 * Вид выбрал владелец после того, как раскладка плитками не прижилась: цифр
 * было много, половина пустая, и понять, от чего считается процент, было
 * нельзя. Здесь всё сведено в один лист: строки — показатели с пояснением,
 * колонки — Rose Farm, Есентай Агро Хим и хозяйство целиком.
 *
 * Данные читаются из таблицы один раз и прогоняются через расчёт трижды с
 * разными фильтрами (`getAnalyticsByFarm`) — иначе три колонки означали бы
 * тройное чтение Google Sheets.
 *
 * Зав. складом видит одну колонку — своё производство; фильтр берётся из
 * сессии, подменить его адресом в браузере нельзя.
 */
export default async function AnalyticsPage() {
  const session = await getServerSession(authOptions);
  const ownFarm = session?.user?.role === "warehouse" ? session?.user?.farm ?? null : null;
  const { all, byFarm } = await getAnalyticsByFarm(ownFarm);

  const extra =
    all.headline.length > 0 || all.attention.length > 0 ? (
      <div className="grid gap-5 lg:grid-cols-2 items-start">
        {all.headline.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-2">Коротко</div>
            <ul className="space-y-2 text-sm text-ink-secondary">
              {all.headline.map((line, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full bg-section-analytics flex-none" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {all.attention.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted mb-2">На что смотреть</div>
            <div className="grid gap-2">
              {all.attention.map((a, i) => (
                <div
                  key={i}
                  className={
                    a.level === "critical"
                      ? "rounded-xl px-3 py-2.5 border-l-4 border-l-status-critical bg-status-critical/[0.05]"
                      : a.level === "warning"
                        ? "rounded-xl px-3 py-2.5 border-l-4 border-l-status-warning bg-status-warning/[0.06]"
                        : "rounded-xl px-3 py-2.5 border-l-4 border-l-status-good bg-status-good/[0.04]"
                  }
                >
                  <div className="font-semibold text-sm">{a.title}</div>
                  <div className="text-sm text-ink-secondary mt-0.5">{a.detail}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    ) : null;

  return (
    <div>
      {/* У администратора рядом с отчётом живёт календарь: остальным ролям
          вкладок не показываем, одна вкладка в ряду выглядит как недоделка. */}
      <PageHeader
        area="analytics"
        title="Аналитика"
        tabs={analyticsTabsFor(session?.user?.role)}
        actions={
          <span className="text-xs text-ink-muted">
            Последние {all.days} дней · {all.periodLabel}
            <Hint>
              Стрелка под цифрой — сравнение с предыдущими {all.days} днями ({all.prevLabel}).
              Заявки и клиенты по производствам не складываются в итог: смешанная заявка
              считается у обоих. Обновлено {new Date(all.generatedAt).toLocaleString("ru-RU")}.
            </Hint>
          </span>
        }
      />

      {/* «По цветку» стоит ПЕРВОЙ вкладкой — так решил владелец: это самая понятная
          таблица во всей аналитике. Остальное — вкладки разделов отчёта. */}
      <AnalyticsReport
        all={all}
        byFarm={byFarm}
        onlyFarm={ownFarm}
        flowerSummary={all.byFlower.length > 0 ? <FlowerSummary rows={all.byFlower} days={all.days} bare /> : undefined}
        extra={extra}
      />
    </div>
  );
}
