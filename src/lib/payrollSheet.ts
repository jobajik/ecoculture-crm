import { google } from "googleapis";
import { SHEET_HEADERS, SHEET_TABS } from "./constants";
import { isPayrollTab, payrollSpreadsheetId } from "./sheets";

/**
 * Таблица зарплаты — отдельный файл (28.10.2026, владелец: «сделай новую таблицу для зп»).
 *
 * Делается без компьютера владельца: администратор открывает `/api/payroll/setup`, и
 *  1) если `PAYROLL_SPREADSHEET_ID` ещё не задан — создаётся новый файл «Зарплата Rose Farm» с вкладками
 *     Payroll* и заголовками, а страница говорит, какой ID вписать в настройки хостинга;
 *  2) если задан — в этой таблице дописываются недостающие вкладки и заголовки, а в общей таблице
 *     обновляется строка заголовков `Users` (новые колонки PayrollRole, PayrollDepartments).
 * Повторять можно сколько угодно: ничего не удаляется и не двигается.
 *
 * Файл создаётся через Sheets API (`spreadsheets.create`), как резервная копия: у приложения есть доступ
 * только к таблицам. Файл появляется на диске владельца — того, чьим refresh-токеном ходит CRM.
 */

function client() {
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("Нет доступа к Google: проверьте переменные окружения");
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.sheets({ version: "v4", auth });
}

export const PAYROLL_SHEET_TITLE = "Зарплата Rose Farm";

export function payrollTabs(): string[] {
  return Object.values(SHEET_TABS).filter(isPayrollTab);
}

export interface PayrollSheetResult {
  /** created — файл создан сейчас, ID ещё не прописан; ready — таблица подключена и вкладки на месте. */
  state: "created" | "ready";
  spreadsheetId: string;
  url: string;
  createdTabs: string[];
  usersHeadersUpdated: boolean;
}

export async function ensurePayrollSheet(): Promise<PayrollSheetResult> {
  const sheets = client();
  const tabs = payrollTabs();
  const existingId = payrollSpreadsheetId();

  if (!existingId) {
    const created = await sheets.spreadsheets.create({
      requestBody: {
        properties: { title: PAYROLL_SHEET_TITLE },
        sheets: tabs.map((title) => ({
          properties: { title },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [{ values: SHEET_HEADERS[title].map((h) => ({ userEnteredValue: { stringValue: h } })) }],
            },
          ],
        })),
      },
    });
    const spreadsheetId = created.data.spreadsheetId ?? "";
    return {
      state: "created",
      spreadsheetId,
      url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
      createdTabs: tabs,
      usersHeadersUpdated: false,
    };
  }

  const meta = await sheets.spreadsheets.get({ spreadsheetId: existingId, fields: "sheets.properties" });
  const have = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title ?? ""));
  const toCreate = tabs.filter((t) => !have.has(t));
  if (toCreate.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: existingId,
      requestBody: { requests: toCreate.map((title) => ({ addSheet: { properties: { title } } })) },
    });
  }
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: existingId,
    requestBody: {
      valueInputOption: "RAW",
      data: tabs.map((t) => ({ range: `${t}!A1`, values: [SHEET_HEADERS[t]] })),
    },
  });

  // Колонки PayrollRole и PayrollDepartments в конце Users общей таблицы: заголовки строки 1 переписываются целиком
  // (так же делает setup-sheet), данные ниже не трогаются.
  const mainId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  let usersHeadersUpdated = false;
  if (mainId) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: mainId,
      range: `${SHEET_TABS.USERS}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [SHEET_HEADERS[SHEET_TABS.USERS]] },
    });
    usersHeadersUpdated = true;
  }

  return {
    state: "ready",
    spreadsheetId: existingId,
    url: `https://docs.google.com/spreadsheets/d/${existingId}`,
    createdTabs: toCreate,
    usersHeadersUpdated,
  };
}
