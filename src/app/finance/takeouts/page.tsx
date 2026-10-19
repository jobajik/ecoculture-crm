import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listStaffTakeouts } from "@/lib/repo/staffTakeouts";
import { periodLabel, periodOf, periodShift } from "@/lib/constants";
import { buildCompanyUse, buildStaffMonth, canSeeTakeouts, takeoutFarmScope } from "@/lib/staffTakeout";
import CompanyUseReport from "@/components/CompanyUseReport";
import PageHeader from "@/components/PageHeader";
import { financeTabsFor } from "../tabs";
import StaffTakeoutMonth from "@/components/StaffTakeoutMonth";

export const dynamic = "force-dynamic";

/**
 * Цветы в счёт зарплаты — то, что бухгалтер удержит.
 *
 * Здесь нет ни формы, ни возможности что-то поправить: выдачи ведут зав.
 * складами, а бухгалтер получает готовый итог. Разрешить правку и ей значило бы
 * два входа в одни и те же данные — ровно то, чего избегали с прогнозом
 * срезки, где ручная правка рядом с загрузкой файла расходится к третьему разу.
 *
 * Показываются оба производства: удержание считается по человеку, а не по
 * теплице, и одна сотрудница может взять и розу, и хризантему.
 *
 * Месяц переключается, потому что зарплату считают, когда месяц уже кончился:
 * третьего октября нужен сентябрь, а не начатый октябрь.
 */
export default async function FinanceTakeoutsPage({
  searchParams,
}: {
  searchParams?: { month?: string };
}) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  if (!canSeeTakeouts(role)) redirect("/?error=forbidden");

  const current = periodOf(new Date());
  const month =
    searchParams?.month && /^\d{4}-\d{2}$/.test(searchParams.month) ? searchParams.month : current;

  const takeouts = await listStaffTakeouts();
  const farm = takeoutFarmScope(role, session?.user?.farm ?? null);
  const data = buildStaffMonth({ takeouts, month, farm });
  // Расход на нужды компании — рядом, но отдельно: из зарплаты он не удерживается.
  const company = buildCompanyUse({ takeouts, from: `${month}-01`, to: `${month}-31`, farm });

  // Три месяца назад и вперёд до текущего: глубже за зарплатой не ходят, а
  // список из двенадцати кнопок читался бы дольше, чем сама таблица.
  const months: string[] = [];
  for (let i = 3; i >= 0; i--) months.push(periodShift(current, -i));

  return (
    <div className="space-y-5">
      <PageHeader
        area="money"
        title="Цветы в счёт зарплаты"
        icon="leaf"
        tabs={financeTabsFor(role)}
        actions={
          <div className="flex flex-wrap gap-1">
            {months.map((m) => (
              <Link
                key={m}
                href={`/finance/takeouts?month=${m}`}
                className={
                  m === month
                    ? "px-3 py-1.5 rounded-lg text-sm bg-ink-primary text-white"
                    : "px-3 py-1.5 rounded-lg text-sm border border-line-hairline bg-surface text-ink-secondary hover:text-ink-primary"
                }
              >
                {periodLabel(m)}
              </Link>
            ))}
          </div>
        }
      />

      {/* Две колонки: к удержанию — слева, нужды компании (не удерживается) — справа. */}
      <div className="grid gap-5 xl:grid-cols-2 items-start">
        <div className="min-w-0">
          <StaffTakeoutMonth
            month={data}
            title={`${periodLabel(month)} — по сотрудникам`}
            hint="Сумма к удержанию из зарплаты"
          />
        </div>
        <div className="min-w-0">
          <CompanyUseReport
            data={company}
            title={`${periodLabel(month)} — на нужды компании (не удерживается)`}
          />
        </div>
      </div>
    </div>
  );
}
