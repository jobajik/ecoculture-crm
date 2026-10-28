import type { Department, Employee } from "./types";
import { employedIn } from "./rules";
import type { TimesheetStatus } from "./timesheet";
import type { DeptTab } from "../../components/payroll/DeptTabs";

/** Плитки подразделений для табеля: только видимые человеку, с числом людей в месяце и состоянием табеля. */
export function buildDeptTabs(
  departments: Department[],
  employees: Employee[],
  statuses: { deptId: string; status: TimesheetStatus }[],
  month: string,
  visible: (deptId: string) => boolean,
): DeptTab[] {
  return departments
    .filter((d) => d.active && visible(d.deptId))
    .map((d) => ({
      deptId: d.deptId,
      name: d.name,
      farm: d.farm,
      people: employees.filter((e) => e.deptId === d.deptId && employedIn(e, month)).length,
      status: statuses.find((s) => s.deptId === d.deptId)?.status ?? "",
      href: `/payroll/timesheet/${d.deptId}?month=${month}`,
    }));
}
