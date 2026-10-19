import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { getCalendarMonth } from "@/lib/calendar";
import { ROLES, isValidPeriod, periodOf } from "@/lib/constants";
import PageHeader from "@/components/PageHeader";
import KpiTile from "@/components/KpiTile";
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

  const t = data.totals;
  const money = (n: number) =>
    n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} млн ₸` : `${Math.round(n).toLocaleString("ru-RU")} ₸`;
  const nf = (n: number) => Math.round(n).toLocaleString("ru-RU");

  return (
    <div>
      <PageHeader
        area="analytics"
        title="Календарь"
        icon="calendar"
        tabs={analyticsTabsFor(role)}
        actions={
          <div className="flex items-center gap-2">
            <PeriodPicker period={month} />
            <Hint>Нажмите на день — откроются подробности. Продажи — по дню оформления заявки, деньги — по дню оплаты.</Hint>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5">
        <KpiTile
          icon="chart"
          label="Продано за месяц"
          value={money(t.soldMoney)}
          hint={t.orderCount > 0 ? `${t.orderCount} заявок · рабочих дней ${t.workingDays} из ${t.daysPassed}` : "заявок за месяц не было"}
        />
        <KpiTile icon="leaf" label="Срезали и приняли" value={`${nf(t.receivedStems)} шт`} hint={t.receivedMoney > 0 ? `${money(t.receivedMoney)} по прайсу` : undefined} />
        <KpiTile icon="truck" label="Отгрузили" value={`${nf(t.shippedStems)} шт`} hint={t.writeoffStems > 0 ? `списано ${nf(t.writeoffStems)} шт` : undefined} />
        <KpiTile icon="wallet" label="Пришло денег" value={money(t.paidMoney)} hint="по дню оплаты" />
      </div>

      {data.headline.length > 0 && (
        <div className="card !p-4 sm:!p-5 mb-5">
          <ul className="grid gap-x-6 gap-y-1.5 text-sm text-ink-secondary lg:grid-cols-2">
            {data.headline.map((line, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 w-1.5 h-1.5 rounded-full bg-section-analytics flex-none" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <CalendarBoard data={data} />
    </div>
  );
}
