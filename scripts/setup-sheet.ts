/**
 * Bootstrap-скрипт: создаёт в указанной Google-таблице все нужные вкладки
 * (Users, Orders, OrderItems, Batches, Shipments, Writeoffs, PriceHistory,
 * Settings) с правильными заголовками и небольшими значениями по умолчанию.
 *
 * Запуск: npm run setup-sheet
 * Перед запуском заполните .env.local (см. SETUP.md), в частности:
 *   GOOGLE_SHEETS_SPREADSHEET_ID
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
 * и убедитесь, что сама таблица расшарена на email сервисного аккаунта
 * с правами редактора.
 */
import * as dotenv from "dotenv";
import { google } from "googleapis";
import {
  SHEET_HEADERS,
  SHEET_TABS,
  DEFAULT_SHELF_LIFE_DAYS,
  DEFAULT_WARNING_THRESHOLD,
  DEFAULT_VARIETIES,
} from "../src/lib/constants";

dotenv.config({ path: ".env.local" });
dotenv.config(); // на случай .env без .local

/**
 * Собирает авторизацию тем же способом, что и приложение (src/lib/sheets.ts):
 * либо сервисный аккаунт, либо обычный Google-аккаунт через refresh token.
 */
function buildAuth() {
  const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const servicePrivateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (serviceEmail && servicePrivateKey) {
    return new google.auth.JWT({
      email: serviceEmail,
      key: servicePrivateKey.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
  }

  if (refreshToken) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      console.error(
        "\nДля способа с refresh token нужны также GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET в .env.local.\n"
      );
      process.exit(1);
    }
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return oauth2Client;
  }

  return null;
}

async function main() {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;

  if (!spreadsheetId) {
    console.error(
      "\nНе задан GOOGLE_SHEETS_SPREADSHEET_ID в .env.local (ID таблицы — часть ссылки между /d/ и /edit).\n"
    );
    process.exit(1);
  }

  const auth = buildAuth();
  if (!auth) {
    console.error(
      "\nНе настроен доступ к таблице. Заполните в .env.local ЛИБО пару\n" +
        "GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,\n" +
        "ЛИБО GOOGLE_OAUTH_REFRESH_TOKEN (получается командой npm run get-refresh-token).\n" +
        "См. SETUP.md.\n"
    );
    process.exit(1);
  }

  const sheets = google.sheets({ version: "v4", auth });

  console.log("Подключаюсь к таблице…");
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existingTitles = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title));

  const tabNames = Object.values(SHEET_TABS);
  const toCreate = tabNames.filter((name) => !existingTitles.has(name));

  if (toCreate.length > 0) {
    console.log("Создаю вкладки:", toCreate.join(", "));
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: toCreate.map((title) => ({ addSheet: { properties: { title } } })),
      },
    });
  } else {
    console.log("Все вкладки уже существуют.");
  }

  for (const tabName of tabNames) {
    const headers = SHEET_HEADERS[tabName];
    console.log(`Пишу заголовки для ${tabName}: ${headers.join(", ")}`);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }

  // Заполняем Settings значениями по умолчанию, если вкладка пустая.
  const settingsRange = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_TABS.SETTINGS}!A2:B`,
  });
  if (!settingsRange.data.values || settingsRange.data.values.length === 0) {
    console.log("Заполняю Settings значениями по умолчанию…");
    const rows: [string, number][] = [
      ...Object.entries(DEFAULT_SHELF_LIFE_DAYS).map(
        ([flowerType, days]) => [`ShelfLifeDays_${flowerType}`, days] as [string, number]
      ),
      ["WarningThresholdPercent", Math.round(DEFAULT_WARNING_THRESHOLD * 100)],
    ];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_TABS.SETTINGS}!A2`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
  }

  // Заполняем справочник сортов, если вкладка пустая.
  const varietiesRange = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_TABS.VARIETIES}!A2:C`,
  });
  if (!varietiesRange.data.values || varietiesRange.data.values.length === 0) {
    console.log("Заполняю справочник сортов (вкладка Varieties)…");
    const rows: (string | boolean)[][] = [];
    for (const [flowerType, varieties] of Object.entries(DEFAULT_VARIETIES)) {
      for (const variety of varieties) rows.push([flowerType, variety, "TRUE"]);
    }
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${SHEET_TABS.VARIETIES}!A2`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
    console.log(`  добавлено сортов: ${rows.length}`);
  }

  console.log("\nГотово! Таблица настроена.");
  console.log(
    "Не забудьте добавить хотя бы одного пользователя на вкладку Users " +
      "(колонки Email, Name, Role, Active), иначе никто не сможет войти в систему."
  );
}

main().catch((err) => {
  console.error("Ошибка настройки таблицы:", err.message ?? err);
  process.exit(1);
});
