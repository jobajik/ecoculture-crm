import { settingsMap } from "./broadcasts";
import { commitAtomic, readTable, rowToRecord, SHEET_TABS } from "../sheets";
import { MANAGER_PROFILES_SETTING, parseManagerProfiles, profileOf, type ManagerProfile } from "../managerProfile";
import { regionStoreForCity, type StoreCode } from "../officeStore";

// Склад региона сотрудника (02.11.2026): менеджер, у которого в профиле (`ManagerProfiles`) город с региональным
// складом (Салтанат — Астана), ведёт этот склад: видит остатки, отгружает и списывает. С 17.11.2026 там же флаг
// «директор региона» (`regionTruck.ts`). Читается при каждой отрисовке страницы (меню, права), поэтому настройки — не
// чаще раза в минуту, как вкладка Users (грабли 1.14).

// Память — одна на процесс, а не на копию модуля (грабли 1.15-ter): назначил директора в «Настройках» — меню и права
// на этом сервере видят это сразу, а не через минуту.
const holder = globalThis as unknown as { __managerProfiles?: { at: number; profiles: Record<string, ManagerProfile> } | null };

export async function managerProfiles(fresh = false): Promise<Record<string, ManagerProfile>> {
  const cache = holder.__managerProfiles;
  if (!fresh && cache && Date.now() - cache.at < 60000) return cache.profiles;
  const p = parseManagerProfiles((await settingsMap(fresh))[MANAGER_PROFILES_SETTING]);
  holder.__managerProfiles = { at: Date.now(), profiles: p };
  return p;
}

/** Склад региона, который ведёт этот сотрудник; нет — «». Сбой таблицы — «» (прав не даём, грабли 1.10). */
export async function regionStoreOfEmail(email: string | null | undefined): Promise<StoreCode> {
  return (await regionSeatOfEmail(email)).store;
}

/** Где посажен сотрудник: склад региона и директор ли он там. Сбой таблицы — «никуда» (грабли 1.10). */
export async function regionSeatOfEmail(email: string | null | undefined): Promise<{ store: StoreCode; director: boolean }> {
  if (!email) return { store: "", director: false };
  try {
    const p = profileOf(await managerProfiles(), email);
    const store = regionStoreForCity(p?.city);
    return { store, director: !!store && p?.director === true };
  } catch {
    return { store: "", director: false };
  }
}

/**
 * Записать профили целиком (настройка `ManagerProfiles`). Читается свежей и пишется одной атомарной записью: строку
 * настройки двигают руками, поэтому ищем по ключу. `change` получает СЫРОЙ объект (с полями, которых эта версия может
 * не знать) и возвращает новый.
 */
export async function updateManagerProfiles(change: (raw: Record<string, Record<string, unknown>>) => Record<string, Record<string, unknown>>): Promise<void> {
  const table = await readTable(SHEET_TABS.SETTINGS, { fresh: true });
  const index = table.rows.findIndex((row) => (rowToRecord(SHEET_TABS.SETTINGS, row).Key || "").trim() === MANAGER_PROFILES_SETTING);
  let raw: Record<string, Record<string, unknown>> = {};
  if (index >= 0) {
    try {
      const parsed = JSON.parse(rowToRecord(SHEET_TABS.SETTINGS, table.rows[index]).Value || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed;
    } catch {
      throw new Error("Настройка ManagerProfiles испорчена — запись остановлена, чтобы не стереть остальных");
    }
  }
  const value = JSON.stringify(change(raw));
  await commitAtomic(
    index >= 0
      ? [{ kind: "update", tab: SHEET_TABS.SETTINGS, rowNumber: table.rowNumbers[index], changes: { Value: value } }]
      : [{ kind: "append", tab: SHEET_TABS.SETTINGS, records: [{ Key: MANAGER_PROFILES_SETTING, Value: value }] }]
  );
  holder.__managerProfiles = null;
}
