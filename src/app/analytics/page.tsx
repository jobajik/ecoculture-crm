import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAnalyticsByFarm } from "@/lib/analytics";
import { farmLabel } from "@/lib/constants";
import AnalyticsReport from "@/components/AnalyticsReport";

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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Аналитика</h1>
          <p className="text-sm text-ink-secondary">
            Последние {all.days} дней ({all.periodLabel}). Стрелка под цифрой — сравнение с
            предыдущими {all.days} ({all.prevLabel}).
            {ownFarm && ` Только ваше производство — ${farmLabel(ownFarm)}.`}
          </p>
        </div>
        <span className="text-xs text-ink-muted">
          Обновлено {new Date(all.generatedAt).toLocaleString("ru-RU")}
        </span>
      </div>

      {all.headline.length > 0 && (
        <div className="card border-l-4 border-l-accent">
          <h2 className="font-medium mb-1.5">Коротко</h2>
          <ul className="space-y-1 text-sm text-ink-secondary">
            {all.headline.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      {all.attention.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {all.attention.map((a, i) => (
            <div
              key={i}
              className={
                a.level === "critical"
                  ? "card !p-3 border-l-4 border-l-status-critical bg-status-critical/[0.05]"
                  : a.level === "warning"
                    ? "card !p-3 border-l-4 border-l-status-warning bg-status-warning/[0.06]"
                    : "card !p-3 border-l-4 border-l-status-good bg-status-good/[0.04]"
              }
            >
              <div className="font-medium text-sm">{a.title}</div>
              <div className="text-sm text-ink-secondary mt-0.5">{a.detail}</div>
            </div>
          ))}
        </div>
      )}

      <AnalyticsReport all={all} byFarm={byFarm} onlyFarm={ownFarm} />
    </div>
  );
}
