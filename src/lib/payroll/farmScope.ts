import { FARM_ORDER } from "../constants";

// ---------------------------------------------------------------------------
// Компания в разделе «Зарплата» (28.10.2026, владелец: «Везде в зп должно быть чёткое разделение по компаниям. Не
// должно быть такой опции как обе компании»). Зарплата считается по ТОО Rose Farm и ТОО Есентай Агро Хим раздельно —
// ведомость, табели, штат и подразделения всегда открыты на ОДНОЙ компании. Выбор едет в адресе (`?farm=`) и
// запоминается в браузере (cookie), поэтому пункт меню без параметра открывает ту же компанию, что смотрели.
// ---------------------------------------------------------------------------

export const PAYROLL_FARM_COOKIE = "payroll_farm";

/** Компания страницы: из адреса, иначе запомненная, иначе первая. «Обе» не бывает. */
export function pickPayrollFarm(param: string | undefined, cookie: string | undefined): string {
  const p = (param ?? "").trim().toLowerCase();
  if (FARM_ORDER.includes(p)) return p;
  const c = (cookie ?? "").trim().toLowerCase();
  if (FARM_ORDER.includes(c)) return c;
  return FARM_ORDER[0];
}

/** Адрес страницы раздела с компанией и остальными параметрами. */
export function payrollHref(path: string, farm: string, params: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  q.set("farm", farm);
  return `${path}?${q.toString()}`;
}
