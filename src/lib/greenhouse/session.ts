import { cookies } from "next/headers";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth";
import { greenhouseScope, type GreenhouseScope } from "./access";
import { GREENHOUSE_FARM_COOKIE, pickGreenhouseFarm } from "./farm";

/** Кто открыл «Теплицу», что ему можно и какая компания. Одна функция на страницы и действия раздела. */
export async function greenhouseSession(searchParams?: { farm?: string }): Promise<{ email: string; name: string; role: string; scope: GreenhouseScope | null; farm: string }> {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  const scope = user ? greenhouseScope({ role: user.role, farm: user.farm, payrollRole: user.payrollRole, payrollDepartments: user.payrollDepartments }) : null;
  let cookie: string | undefined;
  try {
    cookie = cookies().get(GREENHOUSE_FARM_COOKIE)?.value;
  } catch {
    cookie = undefined;
  }
  return { email: (user?.email ?? "").trim().toLowerCase(), name: user?.name ?? "", role: user?.role ?? "", scope, farm: pickGreenhouseFarm(searchParams?.farm, cookie, scope?.farmLocked ?? null) };
}
