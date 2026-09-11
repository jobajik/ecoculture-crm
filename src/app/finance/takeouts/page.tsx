import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listStaffTakeouts } from "@/lib/repo/staffTakeouts";
import { periodLabel, periodOf, periodShift } from "@/lib/constants";
import { buildStaffMonth, canSeeTakeouts, takeoutFarmScope } from "@/lib/staffTakeout";
import SectionTabs from "@/components/SectionTabs";
import { FINANCE_TABS } from "../tabs";
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

  // Три месяца назад и вперёд до текущего: глубже за зарплатой не ходят, а
  // список из двенадцати кнопок читался бы дольше, чем сама таблица.
  const months: string[] = [];
  for (let i = 3; i >= 0; i--) months.push(periodShift(current, -i));

  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Цветы в счёт зарплаты</h1>
      <p className="text-ink-secondary mb-3">
        Что сотрудники взяли со склада. Это не продажа: выручки по таким строкам нет, а сумма —
        то, что удерживается из зарплаты. Записывают зав. складами.
      </p>

      <div className="mb-4">
        <SectionTabs tabs={FINANCE_TABS} />
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {months.map((m) => (
          <Link
            key={m}
            href={`/finance/takeouts?month=${m}`}
            className={
              "px-3 py-1.5 rounded-lg text-sm border transition-colors " +
              (m === month
                ? "border-accent bg-accent-soft text-ink-primary font-medium"
                : "border-line-hairline text-ink-secondary hover:text-ink-primary")
            }
          >
            {periodLabel(m)}
          </Link>
        ))}
      </div>

      <StaffTakeoutMonth
        month={data}
        title={`${periodLabel(month)} — по сотрудникам`}
        hint="Сумма к удержанию из зарплаты"
      />
    </div>
  );
}
