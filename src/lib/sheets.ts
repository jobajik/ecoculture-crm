import { google, sheets_v4 } from "googleapis";
import { SHEET_HEADERS, SHEET_TABS } from "./constants";

// ---------------------------------------------------------------------------
// Низкоуровневый клиент Google Sheets API.
//
// Google Sheets используется здесь как база данных. Это осознанный выбор для
// небольшой/средней компании: не нужно администрировать отдельную БД, все
// данные видно и можно поправить руками в самой таблице. Плата за это —
// отсутствие настоящих транзакций и лимиты Google Sheets API (по умолчанию
// 300 запросов/мин на проект, 60/мин на пользователя — для одной компании
// с несколькими сотрудниками этого более чем достаточно).
//
// Поддерживаются ДВА способа авторизации (нужен ровно один):
//   1) Сервисный аккаунт (GOOGLE_SERVICE_ACCOUNT_EMAIL + ..._PRIVATE_KEY) —
//      способ по умолчанию, см. SETUP.md, Шаг 5.
//   2) Обычный Google-аккаунт через refresh token (GOOGLE_OAUTH_REFRESH_TOKEN,
//      использует тот же GOOGLE_CLIENT_ID/SECRET, что и вход сотрудников) —
//      запасной вариант на случай, если в Google Cloud организации запрещено
//      создавать ключи сервисных аккаунтов (политика
//      iam.disableServiceAccountKeyCreation). См. SETUP.md, "Вариант Б" и
//      scripts/get-refresh-token.ts.
// ---------------------------------------------------------------------------

let cachedClient: sheets_v4.Sheets | null = null;

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Переменная окружения ${name} не задана. Проверьте .env.local / настройки хостинга.`
    );
  }
  return value;
}

function getSheetsClient(): sheets_v4.Sheets {
  if (cachedClient) return cachedClient;

  const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const servicePrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (serviceEmail && servicePrivateKey) {
    // Способ 1: сервисный аккаунт.
    // Приватный ключ хранится в env с экранированными \n — возвращаем настоящие переносы строк.
    const key = servicePrivateKey.replace(/\\n/g, "\n");
    const auth = new google.auth.JWT({
      email: serviceEmail,
      key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    cachedClient = google.sheets({ version: "v4", auth });
    return cachedClient;
  }

  if (refreshToken) {
    // Способ 2: обычный Google-аккаунт (refresh token из scripts/get-refresh-token.ts).
    const clientId = getEnv("GOOGLE_CLIENT_ID");
    const clientSecret = getEnv("GOOGLE_CLIENT_SECRET");
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    cachedClient = google.sheets({ version: "v4", auth: oauth2Client });
    return cachedClient;
  }

  throw new Error(
    "Не настроен доступ к Google Sheets: заполните либо GOOGLE_SERVICE_ACCOUNT_EMAIL " +
      "и GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, либо GOOGLE_OAUTH_REFRESH_TOKEN. См. SETUP.md."
  );
}

function getSpreadsheetId(): string {
  return getEnv("GOOGLE_SHEETS_SPREADSHEET_ID");
}

/** Экранирует значение для безопасной записи в CSV-подобную ячейку (не требуется для values.update, оставлено для ясности). */
function toCell(value: unknown): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value as number;
  return String(value);
}

export interface SheetTable {
  headers: string[];
  rows: string[][];
  /** Номер строки в самой таблице (1-based, с учётом строки заголовка) для каждой записи из rows. */
  rowNumbers: number[];
}

/** Читает вкладку целиком. Первая строка считается заголовком. */
export async function readTable(tabName: string): Promise<SheetTable> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${tabName}!A:ZZ`,
  });
  const values = res.data.values ?? [];
  if (values.length === 0) {
    return { headers: SHEET_HEADERS[tabName] ?? [], rows: [], rowNumbers: [] };
  }
  const [headerRow, ...dataRows] = values;
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  dataRows.forEach((row, idx) => {
    // Пропускаем полностью пустые строки (Sheets иногда их возвращает).
    if (row.every((cell) => cell === "" || cell === undefined)) return;
    rows.push(row);
    rowNumbers.push(idx + 2); // +1 за заголовок, +1 за 1-based индексацию
  });
  return { headers: headerRow, rows, rowNumbers };
}

/** Преобразует строку значений в объект по заголовкам конкретной вкладки (используются заголовки из констант, а не из самой таблицы, чтобы не зависеть от ручных правок порядка). */
export function rowToRecord(tabName: string, row: string[]): Record<string, string> {
  const headers = SHEET_HEADERS[tabName] ?? [];
  const record: Record<string, string> = {};
  headers.forEach((header, idx) => {
    record[header] = row[idx] ?? "";
  });
  return record;
}

export function recordToRow(tabName: string, record: Record<string, unknown>): (string | number)[] {
  const headers = SHEET_HEADERS[tabName] ?? [];
  return headers.map((header) => toCell(record[header]));
}

/** Добавляет новую строку в конец вкладки. */
export async function appendRow(tabName: string, record: Record<string, unknown>): Promise<void> {
  const sheets = getSheetsClient();
  const row = recordToRow(tabName, record);
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${tabName}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });
}

export async function appendRows(tabName: string, records: Record<string, unknown>[]): Promise<void> {
  if (records.length === 0) return;
  const sheets = getSheetsClient();
  const rows = records.map((r) => recordToRow(tabName, r));
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${tabName}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

/** Перезаписывает конкретную строку (rowNumber — абсолютный номер строки в листе, как возвращает readTable). */
export async function updateRow(
  tabName: string,
  rowNumber: number,
  record: Record<string, unknown>
): Promise<void> {
  const sheets = getSheetsClient();
  const row = recordToRow(tabName, record);
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${tabName}!A${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}

/**
 * Перезаписывает несколько строк ОДНИМ запросом к Google.
 *
 * Нужно там, где человек правит сразу много ячеек — план отгрузок по девяти
 * направлениям или ростовку по двум десяткам сортов. Построчный updateRow там
 * означал бы сотню запросов подряд: это и медленно, и упирается в лимит
 * Google Sheets API (60 запросов в минуту на пользователя).
 */
export async function updateRows(
  tabName: string,
  updates: { rowNumber: number; record: Record<string, unknown> }[]
): Promise<void> {
  if (updates.length === 0) return;
  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates.map((u) => ({
        range: `${tabName}!A${u.rowNumber}`,
        values: [recordToRow(tabName, u.record)],
      })),
    },
  });
}

/** Находит первую запись, для которой predicate(record) истинен, и обновляет её через updater. Возвращает true, если запись найдена и обновлена. */
export async function updateWhere(
  tabName: string,
  predicate: (record: Record<string, string>) => boolean,
  updater: (record: Record<string, string>) => Record<string, unknown>
): Promise<boolean> {
  const table = await readTable(tabName);
  for (let i = 0; i < table.rows.length; i++) {
    const record = rowToRecord(tabName, table.rows[i]);
    if (predicate(record)) {
      const updated = updater(record);
      await updateRow(tabName, table.rowNumbers[i], { ...record, ...updated });
      return true;
    }
  }
  return false;
}

/**
 * Стирает все строки данных вкладки, оставляя строку заголовков.
 *
 * Значения именно СТИРАЮТСЯ, а строки не удаляются: так не съезжают ссылки и
 * форматирование, а `readTable()` пустые строки и так пропускает. Следующая
 * запись через appendRows снова начнётся со второй строки.
 */
export async function clearDataRows(tabName: string): Promise<number> {
  const sheets = getSheetsClient();
  const before = await readTable(tabName);
  if (before.rows.length === 0) return 0;
  await sheets.spreadsheets.values.clear({
    spreadsheetId: getSpreadsheetId(),
    range: `${tabName}!A2:ZZ`,
  });
  return before.rows.length;
}

export { SHEET_TABS };
