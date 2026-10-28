import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import EmployeeCard from "@/components/payroll/EmployeeCard";
import { seesDepartment } from "@/lib/payroll/access";
import { payrollSession } from "@/lib/payroll/session";
import { listDepartments, listEmployees, listRates, prefetchPayroll } from "@/lib/repo/payroll";
import { localDayKey } from "@/lib/timezone";
import { payrollTabsFor } from "../../tabs";
import { addRateAction, deleteRateAction, saveEmployeeAction } from "../../actions";

export const dynamic = "force-dynamic";

/** Карточка сотрудника. Чужое подразделение начальнику не открывается и по прямой ссылке (как заявки — грабли 1.1-ter). */
export default async function PayrollEmployeePage({ params }: { params: { id: string } }) {
  const { scope } = await payrollSession();
  if (!scope) redirect("/payroll");

  await prefetchPayroll();
  const [departments, employees, rates] = await Promise.all([listDepartments(), listEmployees(), listRates()]);
  const employee = employees.find((e) => e.employeeId === params.id);
  if (!employee || !seesDepartment(scope, employee.deptId)) notFound();

  const department = departments.find((d) => d.deptId === employee.deptId);
  const mine = rates.filter((r) => r.employeeId === employee.employeeId);

  return (
    <div className="space-y-5">
      <PageHeader
        area="payroll"
        title={employee.fullName}
        eyebrow="Сотрудники"
        subtitle={`${employee.position} · ${department?.name ?? employee.deptId}`}
        icon="client"
        tabs={payrollTabsFor(scope)}
      />
      <EmployeeCard
        employee={employee}
        departmentName={department?.name ?? employee.deptId}
        departments={departments.map((d) => ({ deptId: d.deptId, name: d.name, active: d.active }))}
        rates={mine}
        today={localDayKey()}
        canEdit={scope.editsEmployees}
        canRate={scope.editsRates}
        seesMoney={scope.seesMoney}
        saveEmployee={saveEmployeeAction}
        addRate={addRateAction}
        deleteRate={deleteRateAction}
      />
    </div>
  );
}
