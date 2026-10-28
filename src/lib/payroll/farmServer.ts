import { cookies } from "next/headers";
import { PAYROLL_FARM_COOKIE, pickPayrollFarm } from "./farmScope";

/** Компания страницы «Зарплаты» на сервере: `?farm=`, иначе cookie, иначе первая (`farmScope.ts`). */
export function payrollFarm(searchParams?: { farm?: string }): string {
  let cookie: string | undefined;
  try {
    cookie = cookies().get(PAYROLL_FARM_COOKIE)?.value;
  } catch {
    cookie = undefined;
  }
  return pickPayrollFarm(searchParams?.farm, cookie);
}
