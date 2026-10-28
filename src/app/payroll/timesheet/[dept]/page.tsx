import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import TimesheetGrid from "@/components/payroll/TimesheetGrid";
import { FARM_LABELS } from "@/lib/constants";
import { seesDepartment } from "@/lib/payroll/access";
import { extraDays, normDays, normHours } from "@/lib/payroll/rules";
import { payrollSession } from "@/lib/payroll/session";
import {
  dayInfos,
  dayShiftHours,
  decodeDays,
  monthLabel,
  rowKey,
  shiftMonth,
  timesheetEditRefusal,
  timesheetPeople,
} from "@/lib/payroll/timesheet";
import { listBalance, listDepartments, listEmployees, listHolidays, listTimesheet, listTimesheetStatus, prefetchPayroll } from "@/lib/repo/payroll";
import { localDayKey } from "@/lib/timezone";
import { payrollTabsFor } from "../../tabs";
import { moveTimesheetAction, saveTimesheetAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function TimesheetPage({ params, searchParams }: { params: { dept: string }; searchParams?: { month?: string } }) {
  const { scope } = await payrollSession();
  if (!scope) redirect("/payroll");
  const deptId = decodeURIComponent(params.dept).toLowerCase();
  if (!seesDepartment(scope, deptId)) notFound();
  const month = /^\d{4}-\d{2}$/.test(searchParams?.month ?? "") ? searchParams!.month! : localDayKey().slice(0, 7);

  await prefetchPayroll();
  const [departments, employees, sheet, statuses, balance, holidays] = await Promise.all([
    listDepartments(),
    listEmployees(),
    listTimesheet(month),
    listTimesheetStatus(month),
    listBalance(),
    listHolidays(),
  ]);
  const dept = departments.find((d) => d.deptId === deptId);
  if (!dept) notFound();

  const days = dayInfos(month, dept.workWeek, extraDays(holidays));
  const people = timesheetPeople(employees, deptId, month, sheet);
  const initial = Object.fromEntries(sheet.filter((t) => t.deptId === deptId).map((t) => [rowKey(t.employeeId, t.shift), decodeDays(t.days, days.length)]));
  const st = statuses.find((s) => s.deptId === deptId);
  const status = st?.status ?? "";
  const editRefusal = timesheetEditRefusal(scope, deptId, status);
  const nh = normHours(balance, month, dept.workWeek, holidays);
  const nd = normDays(balance, month, dept.workWeek, holidays);
  const backHref = `/payroll/timesheet?month=${month}`;

  return (
    <div className="space-y-4">
      <PageHeader
        area="payroll"
        eyebrow={<Link href={backHref}>Табель</Link>}
        title={dept.name}
        subtitle={`${FARM_LABELS[dept.farm] ?? ""} · ${dept.workWeek === 6 ? "шестидневка" : "пятидневка"} · норма ${nh} ч, ${nd} дн.${dept.overtime ? ` · сверхурочные ×${String(dept.overtimeRate).replace(".", ",")}` : ""}`}
        icon="calendar"
        tabs={payrollTabsFor(scope)}
        actions={
          <div className="flex items-center gap-2 text-sm">
            <Link className="btn !py-1.5" href={`/payroll/timesheet/${deptId}?month=${shiftMonth(month, -1)}`}>
              ‹
            </Link>
            <span className="font-medium min-w-[8.5rem] text-center">{monthLabel(month)}</span>
            <Link className="btn !py-1.5" href={`/payroll/timesheet/${deptId}?month=${shiftMonth(month, 1)}`}>
              ›
            </Link>
          </div>
        }
      />
      {people.length === 0 ? (
        <div className="card text-sm text-ink-secondary">
          В подразделении за {monthLabel(month).toLowerCase()} нет сотрудников. Их добавляют в «Сотрудниках» или загрузкой штатной расстановки.
        </div>
      ) : (
        <TimesheetGrid
          key={`${deptId}-${month}`}
          month={month}
          deptId={deptId}
          workWeek={dept.workWeek}
          overtime={dept.overtime}
          dayShiftHours={dayShiftHours(nh, nd)}
          days={days}
          people={people}
          initial={initial}
          status={status}
          comment={st?.comment ?? ""}
          canEdit={!editRefusal}
          editRefusal={editRefusal}
          canSubmit={scope.kind === "head"}
          canReview={scope.kind === "admin" || scope.kind === "accountant"}
          save={saveTimesheetAction}
          move={moveTimesheetAction}
        />
      )}
    </div>
  );
}
