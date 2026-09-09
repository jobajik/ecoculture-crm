import { readTable, rowToRecord, SHEET_TABS } from "../sheets";
import type { AppUser } from "../types";
import type { Role } from "../constants";

/**
 * Что в колонке Active считается «отключён».
 *
 * Раньше отключённым был только тот, у кого написано ровно FALSE. Владелец,
 * закрывая доступ уволенному, естественно СТИРАЕТ галочку или пишет «нет» — и
 * человек продолжал заходить. Пустая ячейка по-прежнему означает «активен»
 * (иначе новая строка не заработала бы), а вот все привычные способы сказать
 * «нет» теперь понимаются.
 */
const INACTIVE = new Set(["FALSE", "НЕТ", "NO", "0", "-", "N", "Н"]);

function toUser(record: Record<string, string>): AppUser {
  const active = (record.Active || "").toString().trim().toUpperCase();
  return {
    email: (record.Email || "").trim().toLowerCase(),
    name: record.Name || "",
    // Роли по умолчанию нет: пустая ячейка Role раньше давала права менеджера,
    // то есть ошибка в таблице ОТКРЫВАЛА доступ вместо того, чтобы закрыть.
    role: (record.Role || "").trim() as Role,
    farm: (record.Farm || "").trim().toLowerCase() || null,
    active: !INACTIVE.has(active),
  };
}

export async function listUsers(): Promise<AppUser[]> {
  const table = await readTable(SHEET_TABS.USERS);
  return table.rows.map((row) => toUser(rowToRecord(SHEET_TABS.USERS, row)));
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  const normalized = email.trim().toLowerCase();
  const users = await listUsers();
  return users.find((u) => u.email === normalized) ?? null;
}
