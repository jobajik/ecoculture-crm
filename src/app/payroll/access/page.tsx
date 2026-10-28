import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import AccessBoard from "@/components/payroll/AccessBoard";
import { payrollSession } from "@/lib/payroll/session";
import { listDepartments, prefetchPayroll } from "@/lib/repo/payroll";
import { listUsers } from "@/lib/repo/users";
import { payrollTabsFor } from "../tabs";
import { setPayrollAccessAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function PayrollAccessPage() {
  const { scope } = await payrollSession();
  if (!scope) redirect("/payroll");
  if (!scope.editsAccess) redirect("/payroll/employees");

  await prefetchPayroll();
  const [users, departments] = await Promise.all([listUsers(), listDepartments()]);
  const rows = users
    .filter((u) => u.active)
    .sort((a, b) => {
      // Сначала те, у кого роль в модуле уже есть, и «только зарплата» — остальные ниже по имени.
      const rank = (u: typeof a) => (u.role === "admin" ? 0 : u.payrollRole || u.role === "payroll" ? 1 : 2);
      return rank(a) - rank(b) || (a.name || a.email).localeCompare(b.name || b.email, "ru");
    })
    .map((u) => ({ email: u.email, name: u.name, role: u.role, payrollRole: u.payrollRole, departments: u.payrollDepartments }));

  return (
    <div className="space-y-5">
      <PageHeader area="payroll" title="Доступ к зарплате" icon="gear" tabs={payrollTabsFor(scope)} />
      <AccessBoard rows={rows} departments={departments.filter((d) => d.active).map((d) => ({ deptId: d.deptId, name: d.name }))} save={setPayrollAccessAction} />
    </div>
  );
}
