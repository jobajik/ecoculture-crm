import type { PayrollScope } from "@/lib/payroll/access";

/**
 * Вкладки раздела «Зарплата» — по тому, что человеку можно. Начальник подразделения видит только своих людей
 * и их табель; доступ к модулю раздаёт один администратор. Файл без "use client": его читают
 * страницы и меню (грабли 1.8).
 */
export function payrollTabsFor(scope: PayrollScope | null): { href: string; label: string }[] {
  if (!scope) return [];
  const tabs: { href: string; label: string }[] = [];
  // Обзор — «где мы по месяцу»: три шага (люди → табель → ведомость) одной страницей; начальнику он ни к чему.
  if (scope.seesMoney) tabs.push({ href: "/payroll", label: "Обзор" });
  tabs.push({ href: "/payroll/timesheet", label: "Табель" });
  if (scope.seesMoney) tabs.push({ href: "/payroll/payslip", label: "Ведомость" });
  tabs.push({ href: "/payroll/employees", label: "Сотрудники" });
  if (scope.kind !== "head") {
    tabs.push({ href: "/payroll/departments", label: "Подразделения" });
    tabs.push({ href: "/payroll/balance", label: "Календарь и нормы" });
  }
  if (scope.editsAccess) tabs.push({ href: "/payroll/access", label: "Доступ" });
  return tabs;
}
