import { getServerSession } from "next-auth";
import { authOptions } from "../auth";
import { payrollScope, type PayrollScope } from "./access";

/**
 * Кто открыл страницу «Зарплаты» и что ему можно. Одна функция на страницы и действия раздела: охранник
 * (middleware) пускает по роли CRM, а здесь решает роль модуля (`payrollScope`). Scope null — доступа нет; страница
 * показывает объяснение, действие отказывает.
 */
export async function payrollSession(): Promise<{ email: string; name: string; scope: PayrollScope | null }> {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  return {
    email: (user?.email ?? "").trim().toLowerCase(),
    name: user?.name ?? "",
    scope: user
      ? payrollScope({ role: user.role, payrollRole: user.payrollRole, payrollDepartments: user.payrollDepartments })
      : null,
  };
}
