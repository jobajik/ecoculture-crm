import { appendRow, readTable, rowToRecord, updateRow, updateWhere, SHEET_TABS } from "../sheets";
import type { AppUser } from "../types";
import type { Role } from "../constants";
import { formatPhone } from "../phone";

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
    phone: formatPhone(record.Phone || ""),
    payrollRole: (record.PayrollRole || "").trim().toLowerCase(),
    payrollDepartments: splitDepartments(record.PayrollDepartments),
  };
}

/** «teplitsa, security» → ["teplitsa", "security"]: коды подразделений через запятую, без пустых и повторов. */
export function splitDepartments(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const part of String(raw ?? "").split(/[,;\s]+/)) {
    const code = part.trim().toLowerCase();
    if (code) seen.add(code);
  }
  return Array.from(seen);
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
 * С появлением формы «Сотрудники» программа во вкладку Users ПИШЕТ, поэтому у
 * кэша есть сброс — `forgetUsers()`. Без него владелец менял бы роль и минуту
 * смотрел на старую, решая, что не сохранилось, и нажимал ещё раз. Кэш живёт в
 * памяти одного экземпляра сервера и исчезает при новой сборке; на Vercel
 * экземпляров бывает несколько, поэтому чужой кэш всё равно доживает свою
 * минуту — обещание «через минуту действует» от этого не меняется.
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

/** Забыть кэш — после любой записи в Users. */
export function forgetUsers(): void {
  cache = null;
}

/**
 * Завести сотрудника или переписать существующего.
 *
 * Ключ — почта, и строка ищется по ней, а не по номеру: строки во вкладке
 * владелец двигает руками, и запись «во вторую строку» рано или поздно попала
 * бы не в того человека.
 *
 * Правила (кого можно, какая роль, обязательно ли производство, не запираем ли
 * сами себя) проверяются ДО вызова — `staffRules.ts`. Здесь только запись.
 */
export async function saveUser(user: {
  email: string;
  name: string;
  role: string;
  farm: string;
  active: boolean;
  phone?: string;
}): Promise<{ created: boolean }> {
  const email = user.email.trim().toLowerCase();
  const table = await readTable(SHEET_TABS.USERS);

  let rowNumber: number | null = null;
  let before: Record<string, string> | null = null;
  table.rows.forEach((row, idx) => {
    const record = rowToRecord(SHEET_TABS.USERS, row);
    if ((record.Email || "").trim().toLowerCase() === email) {
      rowNumber = table.rowNumbers[idx];
      before = record;
    }
  });

  const record = {
    Email: email,
    Name: user.name.trim(),
    Role: user.role.trim(),
    // Пишем словами TRUE/FALSE: вкладку читают и глазами, а «1» и «0» в колонке
    // «Active» человек толкует как угодно.
    Active: user.active ? "TRUE" : "FALSE",
    Farm: user.farm.trim().toLowerCase(),
    Phone: formatPhone(user.phone ?? ""),
    // Роль в «Зарплате» форма сотрудников не трогает — она ставится на странице доступа модуля. Строка пишется
    // целиком, поэтому прежнее значение переносится как есть, иначе правка телефона стирала бы доступ к табелю.
    PayrollRole: (before as Record<string, string> | null)?.PayrollRole ?? "",
    PayrollDepartments: (before as Record<string, string> | null)?.PayrollDepartments ?? "",
  };

  if (rowNumber === null) {
    await appendRow(SHEET_TABS.USERS, record);
    forgetUsers();
    return { created: true };
  }

  await updateRow(SHEET_TABS.USERS, rowNumber, record);
  forgetUsers();
  return { created: false };
}

/**
 * Роль в модуле «Зарплата» и подразделения начальника — отдельной записью, только изменившиеся ячейки
 * (`updateWhere`): остальное в строке сотрудника не трогается. Сотрудника без строки в Users не бывает —
 * доступ к зарплате даётся тому, кто уже входит в CRM.
 */
export async function setPayrollAccess(email: string, payrollRole: string, departments: string[]): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const changed = await updateWhere(
    SHEET_TABS.USERS,
    (r) => (r.Email || "").trim().toLowerCase() === normalized,
    () => ({ PayrollRole: payrollRole.trim().toLowerCase(), PayrollDepartments: departments.join(", ") })
  );
  forgetUsers();
  return changed;
}
