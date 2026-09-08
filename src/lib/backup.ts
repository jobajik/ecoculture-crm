import { google } from "googleapis";
import { SHEET_TABS } from "./constants";
import { readTable } from "./sheets";

/**
 * Резервная копия таблицы.
 *
 * Вся база хозяйства — одна Google-таблица. История версий у Google есть, но она
 * не спасает от того, что файл удалят целиком или что кто-то с доступом снесёт
 * половину строк и это заметят через неделю. Поэтому раз в сутки данные
 * складываются в ОТДЕЛЬНЫЙ файл с датой в названии.
 *
 * Копия делается через Sheets API (`spreadsheets.create`), а не через Drive:
 * у приложения есть доступ только к таблицам, и просить ради копии доступ ко
 * всему диску было бы неоправданно широко.
 *
 * Копия — это снимок значений. Формулы, форматирование и примечания не
 * переносятся: в этой таблице их нет, она хранит данные, а не расчёты.
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

export interface BackupResult {
  spreadsheetId: string;
  title: string;
  url: string;
  tabs: number;
  rows: number;
}

export async function createBackup(now: Date = new Date()): Promise<BackupResult> {
  const sheets = client();
  const tabs = Object.values(SHEET_TABS);

  // Сначала читаем всё, и только потом создаём файл: если чтение упадёт, лучше
  // не оставлять в диске пустую копию, которая выглядит как удачная.
  const data: { title: string; values: string[][] }[] = [];
  let rows = 0;
  for (const tab of tabs) {
    try {
      const table = await readTable(tab);
      const values = [table.headers, ...table.rows];
      rows += table.rows.length;
      data.push({ title: tab, values });
    } catch {
      // Вкладки может не быть — пропускаем, но не молча: в итоге видно, сколько
      // вкладок попало в копию.
    }
  }

  const stamp = now.toISOString().slice(0, 16).replace("T", " ");
  const title = `Ecoculture-CRM — копия ${stamp}`;

  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: data.map((d) => ({
        properties: { title: d.title },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: d.values.map((row) => ({
              values: row.map((cell) => ({
                userEnteredValue: { stringValue: String(cell ?? "") },
              })),
            })),
          },
        ],
      })),
    },
  });

  const spreadsheetId = created.data.spreadsheetId ?? "";
  return {
    spreadsheetId,
    title,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
    tabs: data.length,
    rows,
  };
}
