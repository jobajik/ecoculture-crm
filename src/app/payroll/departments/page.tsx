import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import DepartmentsBoard from "@/components/payroll/DepartmentsBoard";
import { payrollSession } from "@/lib/payroll/session";
import { isWorking } from "@/lib/payroll/rules";
import { listDepartments, listEmployees, prefetchPayroll } from "@/lib/repo/payroll";
import { listUsers } from "@/lib/repo/users";
import { localDayKey } from "@/lib/timezone";
import { payrollTabsFor } from "../tabs";
import { saveDepartmentAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PayrollDepartmentsPage() {
  const { scope } = await payrollSession();
  if (!scope) redirect("/payroll");
  if (scope.kind === "head") redirect("/payroll/employees");

  await prefetchPayroll();
  const [departments, employees, users] = await Promise.all([listDepartments(), listEmployees(), listUsers()]);
  const today = localDayKey();

  const headcount: Record<string, number> = {};
  for (const e of employees) if (isWorking(e, today)) headcount[e.deptId] = (headcount[e.deptId] ?? 0) + 1;

  const heads: Record<string, string[]> = {};
  for (const u of users) {
    if (!u.active || u.payrollRole !== "head") continue;
    for (const code of u.payrollDepartments) (heads[code] ??= []).push(u.name || u.email);
  }

  return (
    <div className="space-y-5">
      <PageHeader area="payroll" title="Подразделения" icon="list" tabs={payrollTabsFor(scope)} />
      <DepartmentsBoard departments={departments} headcount={headcount} heads={heads} canEdit={scope.editsDepartments} save={saveDepartmentAction} />
    </div>
  );
}
