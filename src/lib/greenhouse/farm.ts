import { FARM_ORDER, FARMS } from "../constants";

/**
 * Компания в «Теплице»: как в «Зарплате» — в адресе и в cookie, но по умолчанию Есентай: хризантема по циклам ведётся
 * там. Чистое правило — для проверки.
 */
export const GREENHOUSE_FARM_COOKIE = "greenhouse_farm";

export function pickGreenhouseFarm(param: string | undefined, cookie: string | undefined, locked: string | null = null): string {
  if (locked && FARM_ORDER.includes(locked)) return locked;
  const p = (param ?? "").trim().toLowerCase();
  if (FARM_ORDER.includes(p)) return p;
  const c = (cookie ?? "").trim().toLowerCase();
  if (FARM_ORDER.includes(c)) return c;
  return FARMS.ESENTAI;
}

export function ghHref(path: string, farm: string, params: Record<string, string | number | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  q.set("farm", farm);
  return `${path}?${q.toString()}`;
}
