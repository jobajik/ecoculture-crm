import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { FARM_LABELS } from "@/lib/constants";
import { seesDepartment } from "@/lib/payroll/access";
import { payrollSession } from "@/lib/payroll/session";
import { TIMESHEET_STATUS_LABELS, decodeDays, monthDays, monthLabel, shiftMonth, timesheetPeople } from "@/lib/payroll/timesheet";
import { listDepartments, listEmployees, listTimesheet, listTimesheetStatus, prefetchPayroll } from "@/lib/repo/payroll";
import { localDayKey } from "@/lib/timezone";
import { payrollTabsFor } from "../tabs";

export const dynamic = "force-dynamic";

/**
 * Табели за месяц: строка на подразделение — сколько людей, у скольких заполнено и в каком состоянии табель.
 * Бухгалтер отсюда видит, кто ещё не сдал; начальник с одним подразделением попадает сразу в свой табель.
 */
export default async function TimesheetListPage({ searchParams }: { searchParams?: { month?: string } }) {
  const { scope } = await payrollSession();
  if (!scope) redirect("/payroll");
  const month = /^\d{4}-\d{2}$/.test(searchParams?.month ?? "") ? searchParams!.month! : localDayKey().slice(0, 7);

  await prefetchPayroll();
  const [departments, employees, sheet, statuses] = await Promise.all([listDepartments(), listEmployees(), listTimesheet(month), listTimesheetStatus(month)]);
  const visible = departments.filter((d) => d.active && seesDepartment(scope, d.deptId));
  // Табель — это всегда табель КОНКРЕТНОГО подразделения, переключаются они плитками над сеткой (28.10.2026, владелец:
  // «как вкладки с разными подразделениями»). Список остаётся только тому, у кого подразделений нет вовсе.
  const first = visible.find((d) => d.active) ?? visible[0];
  if (first) redirect(`/payroll/timesheet/${first.deptId}?month=${month}`);

  const n = monthDays(month).length;
  const rows = visible.map((d) => {
    const people = timesheetPeople(employees, d.deptId, month, sheet).filter((p) => p.shift === "");
    const filled = people.filter((p) => sheet.some((t) => t.employeeId === p.employeeId && t.deptId === d.deptId && decodeDays(t.days, n).some(Boolean))).length;
    const st = statuses.find((s) => s.deptId === d.deptId);
    return { d, people: people.length, filled, status: st?.status ?? "", comment: st?.comment ?? "" };
  });

  const tone = (s: string) =>
    s === "approved" ? "bg-status-good/10 text-status-good" : s === "submitted" ? "bg-[#fff4d6] text-[#8a5a00]" : s === "returned" ? "bg-[#fde8e8] text-[#a12b2b]" : "bg-surface-sunk text-ink-secondary";

  return (
    <div className="space-y-5">
      <PageHeader
        area="payroll"
        title="Табель"
        icon="calendar"
        tabs={payrollTabsFor(scope)}
        actions={
          <div className="flex items-center gap-2 text-sm">
            <Link className="btn !py-1.5" href={`/payroll/timesheet?month=${shiftMonth(month, -1)}`}>
              ‹
            </Link>
            <span className="font-medium min-w-[8.5rem] text-center">{monthLabel(month)}</span>
            <Link className="btn !py-1.5" href={`/payroll/timesheet?month=${shiftMonth(month, 1)}`}>
              ›
            </Link>
          </div>
        }
      />
      {visible.length === 0 ? (
        <div className="card text-sm text-ink-secondary">
          Подразделений пока нет. Их заводят в «Подразделениях» или вместе со штатной расстановкой («Сотрудники → Загрузить файлом»).
        </div>
      ) : (
        <div className="card !p-0">
          <table className="w-full text-sm table-cards">
            <thead>
              <tr className="text-xs text-ink-muted text-left border-b border-line-hairline">
                <th className="px-4 py-2 font-medium">Подразделение</th>
                <th className="px-4 py-2 font-medium">Компания</th>
                <th className="px-4 py-2 font-medium text-right">Заполнено</th>
                <th className="px-4 py-2 font-medium">Состояние</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ d, people, filled, status, comment }) => (
                <tr key={d.deptId} className="border-b border-line-hairline/60 last:border-0">
                  <td className="px-4 py-2.5 font-medium">
                    <Link href={`/payroll/timesheet/${d.deptId}?month=${month}`} className="hover:underline">
                      {d.name}
                    </Link>
                  </td>
                  <td data-label="Компания" className="px-4 py-2.5 text-ink-secondary">
                    {FARM_LABELS[d.farm] ?? "—"}
                  </td>
                  <td data-label="Заполнено" className="px-4 py-2.5 text-right tabular-nums">
                    {filled} из {people}
                  </td>
                  <td data-label="Состояние" className="px-4 py-2.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tone(status)}`}>{TIMESHEET_STATUS_LABELS[status]}</span>
                    {status === "returned" && comment && <div className="text-xs text-ink-muted mt-1 truncate max-w-[18rem]">{comment}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/payroll/timesheet/${d.deptId}?month=${month}`} className="btn !py-1 text-sm">
                      Открыть
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
