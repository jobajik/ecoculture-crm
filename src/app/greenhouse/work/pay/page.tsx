import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import GhFarmSwitch from "@/components/greenhouse/GhFarmSwitch";
import { ghHref } from "@/lib/greenhouse/farm";
import WorkTabs from "@/components/greenhouse/work/WorkTabs";
import WorkPayBoard from "@/components/greenhouse/work/WorkPayBoard";
import { FARM_LABELS } from "@/lib/constants";
import { isMonth } from "@/lib/payroll/rules";
import { shiftMonth } from "@/lib/payroll/timesheet";
import { monthRange } from "@/lib/payroll/work";
import { loadWorkContext } from "@/lib/payroll/workData";
import { listWork, listWorkBudgets } from "@/lib/repo/payrollWork";
import { localDayKey } from "@/lib/timezone";
import { greenhouseTabsFor } from "../../tabs";
import { saveWorkBudgetsAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Оплата труда по выработке — лист «Расчёт заработной платы» книги Есентая, только считается сам: бюджет месяца на
 * каждый вид работ, доля каждого в выработке и заработанное. Видят те, кому открыты деньги; бюджеты ставит бухгалтер
 * по зарплате или администратор.
 */
export default async function WorkPayPage({ searchParams }: { searchParams?: { farm?: string; month?: string } }) {
  const ctx = await loadWorkContext(searchParams);
  if (!ctx.scope) redirect(ghHref("/greenhouse", ctx.farm));
  if (!ctx.scope.seesMoney) redirect(ghHref("/greenhouse/work", ctx.farm));
  const { scope, farm } = ctx;
  const today = localDayKey();
  const month = searchParams?.month && isMonth(searchParams.month) ? searchParams.month : today.slice(0, 7);
  const range = monthRange(month);
  const prevMonth = shiftMonth(month, -1);
  const [entries, budgets, prevBudgets] = await Promise.all([listWork({ farm, from: range.from, to: range.to }), listWorkBudgets(farm, month), listWorkBudgets(farm, prevMonth)]);
  const href = (f: string) => ghHref("/greenhouse/work/pay", f, { month });

  return (
    <div className="space-y-5">
      <PageHeader area="greenhouse" title="Выработка — оплата труда" subtitle={FARM_LABELS[farm] ?? farm} icon="wallet" tabs={greenhouseTabsFor(ctx.gh, farm)} actions={<GhFarmSwitch farm={farm} href={href} locked={!!ctx.gh?.farmLocked} />}>
        <WorkTabs active="pay" farm={farm} seesMoney={scope.seesMoney} params={{ month }} />
      </PageHeader>
      <WorkPayBoard
        key={`${farm}-${month}`}
        farm={farm}
        farmLabel={FARM_LABELS[farm] ?? farm}
        month={month}
        entries={entries.map((e) => ({ area: e.area, employeeId: e.employeeId, name: e.name, workType: e.workType, qty: e.qty, hours: e.hours }))}
        names={Object.fromEntries(ctx.names)}
        budgets={budgets.map((b) => ({ area: b.area, workType: b.workType, amount: b.amount, note: b.note }))}
        prevBudgets={prevBudgets.map((b) => ({ area: b.area, workType: b.workType, amount: b.amount, note: b.note }))}
        prevMonth={prevMonth}
        canEdit={scope.editsRates}
        save={saveWorkBudgetsAction}
      />
    </div>
  );
}
