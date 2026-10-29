import type { PayrollScope } from "@/lib/payroll/access";

/**
 * Вкладки раздела «Зарплата» — по тому, что человеку можно. Начальник подразделения видит только своих людей
 * и их табель; доступ к модулю раздаёт один администратор. Файл без "use client": его читают
 * страницы и меню (грабли 1.8).
 */
export function payrollTabsFor(scope: PayrollScope | null, farm = ""): { href: string; label: string; match?: string[] }[] {
  if (!scope) return [];
  const tabs: { href: string; label: string; match?: string[] }[] = [];
  // Компания едет по вкладкам (`farmScope.ts`): раздел всегда открыт на одной из двух. `match` — адрес без параметра,
  // иначе вкладка с `?farm=` не горела бы (SectionTabs сравнивает с pathname).
  const push = (href: string, label: string) => tabs.push({ href: farm ? `${href}?farm=${farm}` : href, label, match: [href] });
  // Обзор — «где мы по месяцу»: три шага (люди → табель → ведомость) одной страницей; начальнику он ни к чему.
  if (scope.seesMoney) push("/payroll", "Обзор");
  push("/payroll/timesheet", "Табель");
  // Выработка (этап 7): ввод за день, журнал, аналитика, оплата труда — свои вкладки внутри страницы (`WorkTabs`).
  tabs.push({
    href: farm ? `/payroll/work?farm=${farm}` : "/payroll/work",
    label: "Выработка",
    match: ["/payroll/work", "/payroll/work/journal", "/payroll/work/analytics", "/payroll/work/pay"],
  });
  if (scope.seesMoney) push("/payroll/payslip", "Ведомость");
  push("/payroll/employees", "Сотрудники");
  if (scope.kind !== "head") {
    push("/payroll/departments", "Подразделения");
    push("/payroll/balance", "Календарь и нормы");
  }
  if (scope.editsAccess) push("/payroll/access", "Доступ");
  return tabs;
}
