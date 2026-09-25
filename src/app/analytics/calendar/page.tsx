import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getCalendarMonth } from "@/lib/calendar";
import { ROLES, isValidPeriod, periodOf } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import Section from "@/components/Section";
import PeriodPicker from "@/components/PeriodPicker";
import CalendarBoard from "@/components/CalendarBoard";
import Hint from "@/components/Hint";
import { analyticsTabsFor } from "../tabs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Календарь месяца — только для администратора.
 *
 * Здесь нет фильтра по производству: страницу видит один человек, который
 * отвечает за всё хозяйство. Если календарь когда-нибудь откроют зав. складом,
 * фильтр придётся ставить в КАЖДОМ разрезе (грабли 1.1-ter), а не только в
 * заголовке.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { period?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== ROLES.ADMIN) redirect("/analytics");

  const month =
    searchParams.period && isValidPeriod(searchParams.period)
      ? searchParams.period
      : periodOf(new Date());

  const data = await getCalendarMonth(month);

  return (
    <div className="space-y-5">
      <PageHeader
        area="analytics"
        title="Календарь"
        icon="calendar"
        tabs={analyticsTabsFor(role)}
        subtitle={
          <>
            Нажмите на день — откроются подробности.
            <Hint>Продажи — по дню оформления заявки, деньги — по дню оплаты.</Hint>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker period={month} />
        <span className="text-sm text-ink-muted">
          {data.totals.orderCount > 0
            ? `Заявок за месяц: ${data.totals.orderCount}`
            : "Заявок за месяц не было"}
        </span>
      </div>

      {data.headline.length > 0 && (
        <Section tone="analytics" icon="note" title="Коротко о месяце" className="!mb-0">
          <ul className="space-y-1 text-sm text-ink-secondary">
            {data.headline.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </Section>
      )}

      <CalendarBoard data={data} />
    </div>
  );
}
