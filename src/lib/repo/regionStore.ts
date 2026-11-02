import { settingsMap } from "./broadcasts";
import { MANAGER_PROFILES_SETTING, parseManagerProfiles, profileOf } from "../managerProfile";
import { regionStoreForCity, type StoreCode } from "../officeStore";

// Склад региона сотрудника (02.11.2026): менеджер, у которого в профиле (`ManagerProfiles`) город с региональным
// складом (Салтанат — Астана), ведёт этот склад: видит остатки, отгружает и списывает. Читается при каждой отрисовке
// страницы (меню, права), поэтому настройки — не чаще раза в минуту, как вкладка Users (грабли 1.14).

let cache: { at: number; profiles: ReturnType<typeof parseManagerProfiles> } | null = null;

async function profiles(): Promise<ReturnType<typeof parseManagerProfiles>> {
  if (cache && Date.now() - cache.at < 60000) return cache.profiles;
  const p = parseManagerProfiles((await settingsMap())[MANAGER_PROFILES_SETTING]);
  cache = { at: Date.now(), profiles: p };
  return p;
}

/** Склад региона, который ведёт этот сотрудник; нет — «». Сбой таблицы — «» (прав не даём, грабли 1.10). */
export async function regionStoreOfEmail(email: string | null | undefined): Promise<StoreCode> {
  if (!email) return "";
  try {
    return regionStoreForCity(profileOf(await profiles(), email)?.city);
  } catch {
    return "";
  }
}
