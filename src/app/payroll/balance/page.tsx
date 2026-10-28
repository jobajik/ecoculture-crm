import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import BalanceBoard from "@/components/payroll/BalanceBoard";
import { payrollSession } from "@/lib/payroll/session";
import { listBalance, listHolidays, prefetchPayroll } from "@/lib/repo/payroll";
import { localDayKey } from "@/lib/timezone";
import { payrollTabsFor } from "../tabs";
import { addHolidayAction, checkCalendarAction, removeBalanceAction, removeHolidayAction, saveBalanceAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PayrollBalancePage({ searchParams }: { searchParams?: { year?: string } }) {
  const { scope } = await payrollSession();
  if (!scope) redirect("/payroll");
  if (scope.kind === "head") redirect("/payroll/employees");

  await prefetchPayroll();
  const [balance, holidays] = await Promise.all([listBalance(), listHolidays()]);
  const thisYear = Number(localDayKey().slice(0, 4));
  const year = /^\d{4}$/.test(searchParams?.year ?? "") ? Number(searchParams!.year) : thisYear;
  // Прошлый, текущий и следующий год плюс годы с перебивками: календарь известен на любой год, перебирать не нужно.
  const years = Array.from(new Set([...balance.map((b) => Number(b.month.slice(0, 4))), thisYear - 1, thisYear, thisYear + 1, year])).sort((a, b) => a - b);

  return (
    <div className="space-y-5">
      <PageHeader area="payroll" title="Календарь и нормы" icon="calendar" tabs={payrollTabsFor(scope)} />
      <BalanceBoard
        key={year}
        year={year}
        years={years}
        balance={balance}
        holidays={holidays}
        canEdit={scope.editsBalance}
        saveMonth={saveBalanceAction}
        removeMonth={removeBalanceAction}
        addHoliday={addHolidayAction}
        removeHoliday={removeHolidayAction}
        checkCalendar={checkCalendarAction}
      />
    </div>
  );
}
