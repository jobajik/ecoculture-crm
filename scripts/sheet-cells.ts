import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Сколько ячеек занимает основная таблица и где они пустые (29.10.2026: приёмка файлом на 70 партий — «В результате
 * этого действия количество ячеек в книге превысит максимально допустимое (20000000)»). Google считает ВСЮ сетку
 * вкладки — строки × колонки, — заполненные и пустые. Печатает по вкладкам сетку, занятое данными и лишнее.
 *
 * С --yes: копия таблицы, потом у каждой вкладки удаляются только ПУСТЫЕ хвосты — колонки правее последней занятой (и
 * не меньше числа заголовков из SHEET_HEADERS) и строки ниже последней занятой + запас 200. Данные не трогаются.
 *
 *   npx tsx scripts/sheet-cells.ts [--yes]
 */
import { google } from "googleapis";
import { SHEET_HEADERS } from "../src/lib/constants";
import { createBackup } from "../src/lib/backup";

const SPARE_ROWS = 200;

function client() {
  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  return google.sheets({ version: "v4", auth });
}

const fmt = (n: number) => n.toLocaleString("ru-RU").replace(/\s/g, " ");

async function main() {
  const yes = process.argv.includes("--yes");
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "";
  if (!spreadsheetId) throw new Error("нет GOOGLE_SHEETS_SPREADSHEET_ID");
  const sheets = client();
  const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" });
  type Tab = { id: number; title: string; rows: number; cols: number; usedRows: number; usedCols: number; keepCols: number; keepRows: number };
  const tabs: Tab[] = [];
  for (const s of meta.data.sheets ?? []) {
    const p = s.properties!;
    const title = p.title ?? "";
    const rows = p.gridProperties?.rowCount ?? 0;
    const cols = p.gridProperties?.columnCount ?? 0;
    // Занятое данными: Google отдаёт значения только до последней непустой строки и колонки.
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${title.replace(/'/g, "''")}'`, majorDimension: "ROWS" });
    const values = res.data.values ?? [];
    const usedRows = values.length;
    const usedCols = values.reduce((m, r) => Math.max(m, r.length), 0);
    const keepCols = Math.max(usedCols, (SHEET_HEADERS[title] ?? []).length, 1);
    const keepRows = Math.max(usedRows + SPARE_ROWS, 2);
    tabs.push({ id: p.sheetId ?? 0, title, rows, cols, usedRows, usedCols, keepCols, keepRows });
    await new Promise((r) => setTimeout(r, 1200)); // лимит чтений Google
  }
  const total = tabs.reduce((s, t) => s + t.rows * t.cols, 0);
  const after = tabs.reduce((s, t) => s + Math.min(t.rows, t.keepRows) * Math.min(t.cols, t.keepCols), 0);
  console.log(`Вкладок: ${tabs.length}. Ячеек в сетке: ${fmt(total)}; после обрезки пустых хвостов будет ~${fmt(after)}.\n`);
  for (const t of [...tabs].sort((a, b) => b.rows * b.cols - a.rows * a.cols)) {
    console.log(
      `${t.title.padEnd(22)} сетка ${fmt(t.rows)} × ${t.cols} = ${fmt(t.rows * t.cols).padStart(11)} · занято ${fmt(t.usedRows)} × ${t.usedCols}` +
        (t.cols > t.keepCols || t.rows > t.keepRows ? ` · лишнее: ${t.cols > t.keepCols ? `${t.cols - t.keepCols} колонок` : ""}${t.cols > t.keepCols && t.rows > t.keepRows ? ", " : ""}${t.rows > t.keepRows ? `${fmt(t.rows - t.keepRows)} строк` : ""}` : "")
    );
  }
  if (!yes) return console.log("\nТолько показ. Обрезать пустые хвосты — с --yes (сначала копия таблицы).");

  const backup = await createBackup(new Date(), (m) => console.log(`  копия: ${m}`));
  console.log(`Копия таблицы: ${backup.url}`);
  const requests = [];
  for (const t of tabs) {
    if (t.cols > t.keepCols) requests.push({ deleteDimension: { range: { sheetId: t.id, dimension: "COLUMNS", startIndex: t.keepCols, endIndex: t.cols } } });
    if (t.rows > t.keepRows) requests.push({ deleteDimension: { range: { sheetId: t.id, dimension: "ROWS", startIndex: t.keepRows, endIndex: t.rows } } });
  }
  if (requests.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
  console.log(`Обрезано: ${requests.length} хвостов. Ячеек теперь ~${fmt(after)}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
