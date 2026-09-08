import Link from "next/link";
import clsx from "clsx";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAnalyticsSummary } from "@/lib/analytics";
import { FARM_ORDER, FLOWER_TYPES_BY_FARM, FLOWER_TYPE_LABELS_PLURAL, farmLabel } from "@/lib/constants";
import AnalyticsBoard from "@/components/AnalyticsBoard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Аналитика с разделением по производствам.
 *
 * Хозяйство — это два ТОО с разной экономикой: Rose Farm (роза и эустома) и
 * Есентай Агро Хим (хризантема). Складывать их в одну цифру можно, но управлять
 * так нельзя: у розы срок хранения семь дней и другая цена, у хризантемы —
 * восемнадцать. Поэтому наверху стоят вкладки, а сам расчёт просто получает
 * `farmFilter` — тот же самый, что уже используется для зав. складом.
 *
 * Зав. складом вкладок не видит: у него производство одно, и подменить его
 * адресом в строке браузера нельзя — фильтр берётся из сессии, а не из ссылки.
 */
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: { farm?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  const ownFarm = role === "warehouse" ? session?.user?.farm ?? null : null;

  const asked = searchParams?.farm;
  const selected = ownFarm ?? (asked && FARM_ORDER.includes(asked) ? asked : null);
  const summary = await getAnalyticsSummary(selected);

  const tabs = [
    { farm: null as string | null, label: "Всё хозяйство" },
    ...FARM_ORDER.map((f) => ({ farm: f as string | null, label: farmLabel(f) })),
  ];

  const flowersOf = (farm: string | null) =>
    (farm ? FLOWER_TYPES_BY_FARM[farm] ?? [] : ["rose", "chrysanthemum", "eustoma"])
      .map((t) => FLOWER_TYPE_LABELS_PLURAL[t] ?? t)
      .join(", ");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Аналитика</h1>
          <p className="text-sm text-ink-secondary">
            Последние {summary.days} дней ({summary.periodLabel}) против предыдущих {summary.days} (
            {summary.prevLabel}).
          </p>
        </div>
        <span className="text-xs text-ink-muted">
          Обновлено {new Date(summary.generatedAt).toLocaleString("ru-RU")}
        </span>
      </div>

      {ownFarm ? (
        <p className="text-sm text-ink-secondary">
          Только ваше производство — <b>{farmLabel(ownFarm)}</b> ({flowersOf(ownFarm)}).
        </p>
      ) : (
        <div>
          <div className="flex flex-wrap gap-1 border-b border-line-hairline">
            {tabs.map((t) => {
              const active = t.farm === selected;
              return (
                <Link
                  key={t.farm ?? "all"}
                  href={t.farm ? `/analytics?farm=${t.farm}` : "/analytics"}
                  className={clsx(
                    "px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors",
                    active
                      ? "border-accent text-accent"
                      : "border-transparent text-ink-secondary hover:text-ink-primary"
                  )}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
          <p className="text-xs text-ink-muted mt-1.5">
            {selected
              ? `Считается только ${flowersOf(selected)} — деньги, склад и срезка этого производства.`
              : "Считается всё хозяйство сразу: роза и эустома Rose Farm плюс хризантема Есентая."}
          </p>
        </div>
      )}

      {summary.headline.length > 0 && (
        <div className="card border-l-4 border-l-accent">
          <h3 className="font-medium mb-1.5">Коротко</h3>
          <ul className="space-y-1 text-sm text-ink-secondary">
            {summary.headline.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <AnalyticsBoard summary={summary} farm={selected} />
    </div>
  );
}
