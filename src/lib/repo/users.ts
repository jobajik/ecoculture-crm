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

/**
 * Список сотрудников живёт в памяти сервера МИНУТУ.
 *
 * Без кэша эта вкладка читалась из Google при КАЖДОЙ отрисовке любой страницы:
 * роль сотрудника перечитывается на каждый запрос сессии, а `getServerSession()`
 * зовёт этот обработчик сам. Один человек, листающий заявки, давал десятки
 * чтений в минуту — при лимите Google в 60 чтений в минуту на пользователя. Мы
 * в него уже упирались, и упирались больно: неответ таблицы программа приняла
 * за «сотрудника уволили» и показала бухгалтеру страницу оплат без кнопок.
 *
 * Минута выбрана так, чтобы обещание «права меняются на ходу» осталось правдой:
 * владелец правит строку в таблице — и через минуту она действует. Мгновенности
 * тут никто и не ждёт, а десятки лишних обращений к Google стоят дорого.
 *
 * Сбрасывать его руками неоткуда: САМА ПРОГРАММА во вкладку Users не пишет
 * никогда — сотрудников владелец правит в таблице, а скрипт `add-staff.ts`
 * работает отдельно от сайта. Кэш живёт в памяти одного экземпляра сервера и
 * исчезает при новой сборке.
 */
const CACHE_MS = 60_000;
let cache: { at: number; users: AppUser[] } | null = null;

export async function listUsers(): Promise<AppUser[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.users;
  const table = await readTable(SHEET_TABS.USERS);
  const users = table.rows.map((row) => toUser(rowToRecord(SHEET_TABS.USERS, row)));
  cache = { at: Date.now(), users };
  return users;
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  const normalized = email.trim().toLowerCase();
  const users = await listUsers();
  return users.find((u) => u.email === normalized) ?? null;
}
