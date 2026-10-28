import { redirect } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import EmployeesBoard, { type EmployeeRow } from "@/components/payroll/EmployeesBoard";
import { seesDepartment } from "@/lib/payroll/access";
import { currentRate, isWorking } from "@/lib/payroll/rules";
import { payrollSession } from "@/lib/payroll/session";
import { listDepartments, listEmployees, listRates, prefetchPayroll } from "@/lib/repo/payroll";
import { localDayKey } from "@/lib/timezone";
import { payrollSpreadsheetId } from "@/lib/sheets";
import { payrollTabsFor } from "../tabs";
import { importStaffingAction, saveEmployeeAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Штат: кто где работает и на каких условиях. Заменяет вкладку «Штатная расстановка» гугл-книги.
 *
 * Начальник подразделения видит только своих людей и без сумм (так решил владелец); кадровик заводит и правит
 * карточки, бухгалтер ставит оклады — поэтому ставка и карточка живут отдельно и в форме, и в таблице.
 */
export default async function PayrollEmployeesPage() {
  const { scope, email } = await payrollSession();
  if (!scope) redirect("/payroll");

  await prefetchPayroll();
  const [departments, employees, rates] = await Promise.all([listDepartments(), listEmployees(), listRates()]);
  const today = localDayKey();

  const visibleDepartments = departments.filter((d) => seesDepartment(scope, d.deptId));
  const rows: EmployeeRow[] = employees
    .filter((e) => seesDepartment(scope, e.deptId))
    .map((e) => {
      const rate = currentRate(rates, e.employeeId, today);
      return {
        employee: e,
        departmentName: departments.find((d) => d.deptId === e.deptId)?.name ?? e.deptId,
        working: isWorking(e, today),
        salary1c: scope.seesMoney ? rate?.salary1c ?? null : null,
        total: scope.seesMoney ? rate?.total ?? null : null,
        hasRate: !!rate,
      };
    });

  return (
    <div className="space-y-5">
      <PageHeader area="payroll" title="Сотрудники" icon="client" tabs={payrollTabsFor(scope)} />
      {!payrollSpreadsheetId() && (
        <div className="card border-[#8a5a00]/30 bg-[#fdf6e7] text-sm">
          Таблица зарплаты ещё не подключена — раздел ничего не сохраняет.{" "}
          {scope.kind === "admin" ? (
            <a href="/api/payroll/setup" className="underline font-medium">
              Создать и подключить
            </a>
          ) : (
            "Попросите администратора её подключить."
          )}
        </div>
      )}
      <EmployeesBoard
        rows={rows}
        departments={visibleDepartments.map((d) => ({ deptId: d.deptId, name: d.name, active: d.active, farm: d.farm }))}
        today={today}
        actorEmail={email}
        canEdit={scope.editsEmployees}
        canRate={scope.editsRates}
        seesMoney={scope.seesMoney}
        save={saveEmployeeAction}
        importStaffing={importStaffingAction}
      />
    </div>
  );
}
