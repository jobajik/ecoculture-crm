import "./timezone";
import { google, sheets_v4 } from "googleapis";
import { SHEET_HEADERS, SHEET_TABS } from "./constants";
import { sheetSafeText } from "./sheetCell";

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
/**
 * Значение для ячейки.
 *
 * Строка проходит через `sheetSafeText()`: значение, начинающееся с `+`, `-`,
 * `=` или `@`, Google-таблица принимает за формулу и считает. Именно так
 * телефон «+7 701 555 20 30» превращался в `#ERROR!` — и терялся, потому что
 * обратно программа читала уже эту надпись. Подробности — в `sheetCell.ts`.
 */
function toCell(value: unknown): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return value as number;
  return sheetSafeText(String(value));
}

export interface SheetTable {
  headers: string[];
  rows: string[][];
  /** Номер строки в самой таблице (1-based, с учётом строки заголовка) для каждой записи из rows. */
  rowNumbers: number[];
}

// ---------------------------------------------------------------------------
// Лимит Google: 60 чтений в минуту на человека.
//
// Упёрлись в него на складе. Зав. складом отгружала позицию из десяти партий,
// по партии за нажатие, и на третьем-четвёртом нажатии получила от Google
// «превышено число запросов». Каждое нажатие читало одни и те же вкладки по
// пять-шесть раз: заявку — чтобы проверить готовность, ещё раз — чтобы
// проверить остаток, ещё раз — чтобы пересчитать статус, и потом вся страница
// заново, где партии читались отдельно для каждой позиции.
//
// Отсюда две защиты, обе здесь, чтобы работали для всех страниц сразу:
//  1) одинаковые чтения в пределах трёх секунд склеиваются в одно. Любая
//     запись сбрасывает запомненное целиком, так что после своей правки
//     человек видит свою правку, а не то, что было до неё;
//  2) если Google всё же ответил «лимит», запрос повторяется через 2 и 5
//     секунд, и только потом человек видит отказ — по-русски и с тем, что
//     делать.
// Проверки перед записью (остаток партии, сколько отгружено по позиции)
// читают таблицу СВЕЖЕЙ — `{ fresh: true }`: там три секунды старины могли бы
// стоить двойной отгрузки.
// ---------------------------------------------------------------------------

const READ_MEMO_MS = 3000;
const readMemo = new Map<string, { at: number; promise: Promise<SheetTable> }>();

/** Забыть всё прочитанное. Зовётся после любой записи. */
export function forgetReads(): void {
  readMemo.clear();
}

/** Похоже ли на отказ Google по лимиту запросов. */
export function isQuotaError(err: unknown): boolean {
  const e = err as { code?: unknown; status?: unknown; response?: { status?: unknown }; message?: unknown };
  if (e?.code === 429 || e?.status === 429 || e?.response?.status === 429) return true;
  const text = String(e?.message ?? "");
  return /quota|rate limit|too many requests|RESOURCE_EXHAUSTED|превышен/i.test(text);
}

export const QUOTA_MESSAGE =
  "Google временно ограничил число обращений к таблице — лимит общий на всю компанию. " +
  "Подождите минуту и повторите. Если это случилось во время отгрузки, сначала обновите " +
  "страницу и посмотрите, что уже отгружено.";

const RETRY_DELAYS_MS = [2000, 5000];

/** Выполнить запрос к Google, переждав отказ по лимиту. */
async function callGoogle<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await request();
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      if (attempt >= RETRY_DELAYS_MS.length) throw new Error(QUOTA_MESSAGE);
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}

/** Запись в Google: пережидает лимит и сбрасывает запомненные чтения. */
async function writeThrough<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await callGoogle(request);
  } finally {
    // И после неудачи тоже: запись могла дойти частично, и верить прежнему
    // прочитанному уже нельзя.
    forgetReads();
  }
}

export interface ReadOptions {
  /** Прочитать заново, не пользуясь запомненным. Для проверок перед записью. */
  fresh?: boolean;
}

/** Читает вкладку целиком. Первая строка считается заголовком. */
export async function readTable(tabName: string, options: ReadOptions = {}): Promise<SheetTable> {
  const now = Date.now();
  const memo = readMemo.get(tabName);
  if (!options.fresh && memo && now - memo.at < READ_MEMO_MS) return memo.promise;

  const promise = callGoogle(() => fetchTable(tabName));
  readMemo.set(tabName, { at: now, promise });
  // Неудачное чтение не запоминаем: следующий запрос должен попробовать снова.
  promise.catch(() => {
    if (readMemo.get(tabName)?.promise === promise) readMemo.delete(tabName);
  });
  return promise;
}

async function fetchTable(tabName: string): Promise<SheetTable> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range: `${tabName}!A:ZZ`,
  });
  return toSheetTable(tabName, (res.data.values ?? []) as string[][]);
}

function toSheetTable(tabName: string, values: string[][]): SheetTable {
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

/**
 * Читает вкладки ДВАЖДЫ: что в них видно и что в них записано.
 *
 * Обычно это одно и то же, и разница нужна ровно в одном случае — когда
 * таблица приняла наш текст за формулу и показывает `#ERROR!`. Тогда видимое
 * значение потеряно, а записанное цело: Google отдаёт его как формулу
 * (`=+7 701 555 20 30`), и телефон можно вернуть, а не придумать заново.
 * Пользуется этим `scripts/fix-error-cells.ts`.
 */
export async function readTablesWithFormulas(
  tabNames: string[]
): Promise<Map<string, { shown: string[][]; formulas: string[][] }>> {
  const out = new Map<string, { shown: string[][]; formulas: string[][] }>();
  if (tabNames.length === 0) return out;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const ranges = tabNames.map((tab) => `${tab}!A:ZZ`);

  // Все вкладки — ОДНИМ запросом на каждую картину, а не по два запроса на
  // вкладку. Вкладок семнадцать, и построчный обход стоил бы 34 обращения;
  // вместе с резервной копией это упирается в лимит Google (60 чтений в минуту
  // на пользователя), и работа обрывается на середине. Так уже случилось.
  const [shownRes, formulaRes] = await Promise.all([
    sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges }),
    sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
      valueRenderOption: "FORMULA",
    }),
  ]);

  tabNames.forEach((tab, i) => {
    out.set(tab, {
      shown: (shownRes.data.valueRanges?.[i]?.values ?? []) as string[][],
      formulas: (formulaRes.data.valueRanges?.[i]?.values ?? []) as string[][],
    });
  });
  return out;
}

/**
 * Записывает отдельные ячейки по адресам вида «Clients!E14».
 *
 * Единственный способ починить одну ячейку, не переписывая всю строку: строку
 * пришлось бы собрать заново, а в ней могут быть значения, которых мы не
 * трогали и не должны трогать.
 */
export async function writeCells(cells: { address: string; value: string }[]): Promise<void> {
  if (cells.length === 0) return;
  const sheets = getSheetsClient();
  await writeThrough(() => sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: cells.map((c) => ({ range: c.address, values: [[toCell(c.value)]] })),
    },
  }));
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
  await writeThrough(() => sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${tabName}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  }));
}

export async function appendRows(tabName: string, records: Record<string, unknown>[]): Promise<void> {
  if (records.length === 0) return;
  const sheets = getSheetsClient();
  const rows = records.map((r) => recordToRow(tabName, r));
  await writeThrough(() => sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `${tabName}!A1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  }));
}

/** Перезаписывает конкретную строку (rowNumber — абсолютный номер строки в листе, как возвращает readTable). */
export async function updateRow(
  tabName: string,
  rowNumber: number,
  record: Record<string, unknown>
): Promise<void> {
  const sheets = getSheetsClient();
  const row = recordToRow(tabName, record);
  await writeThrough(() => sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range: `${tabName}!A${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  }));
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
  await writeThrough(() => sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates.map((u) => ({
        range: `${tabName}!A${u.rowNumber}`,
        values: [recordToRow(tabName, u.record)],
      })),
    },
  }));
}

/**
 * Находит первую запись, для которой predicate(record) истинен, и обновляет её
 * через updater. Возвращает true, если запись найдена.
 *
 * Пишутся ТОЛЬКО изменившиеся ячейки, а не строка целиком. Раньше строка
 * переписывалась вся — значениями, прочитанными за долю секунды до записи. Если
 * в эту долю секунды кто-то другой менял в той же строке другое поле (склад
 * ставил статус, бухгалтер — сумму оплаты), его правка молча откатывалась.
 * Аудит сентября нашёл, что так и бывает: см. `commitAtomic`.
 */
export async function updateWhere(
  tabName: string,
  predicate: (record: Record<string, string>) => boolean,
  updater: (record: Record<string, string>) => Record<string, unknown>
): Promise<boolean> {
  const table = await readTable(tabName, { fresh: true });
  for (let i = 0; i < table.rows.length; i++) {
    const record = rowToRecord(tabName, table.rows[i]);
    if (predicate(record)) {
      const changes = changedCells(record, updater(record));
      if (Object.keys(changes).length > 0) {
        await commitAtomic([{ kind: "update", tab: tabName, rowNumber: table.rowNumbers[i], changes }]);
      }
      return true;
    }
  }
  return false;
}

/** Только те поля, чьё значение действительно меняется (в виде, как его покажет таблица). */
export function changedCells(
  before: Record<string, string>,
  after: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) {
    const next = value === null || value === undefined ? "" : String(value);
    if (next !== (before[key] ?? "")) out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Атомарная запись: всё или ничего, одним запросом.
//
// Отгрузка раньше писалась ЧЕТЫРЬМЯ запросами подряд: остаток партии,
// «отгружено» по позиции, статус заявки, журнал отгрузок. Google Sheets
// транзакций не знает, и когда четвёртый запрос упирался в лимит, первые три
// уже были записаны. Аудит живой базы в сентябре нашёл ровно это: 18 позиций,
// у которых «отгружено» больше суммы журнала, и 25 партий, опустевших без
// единой строки отгрузки, — 2 820 стеблей ушли без следа в отчётах.
//
// `spreadsheets.batchUpdate` Google применяет целиком или никак, поэтому все
// шаги одного действия собираются в один такой запрос: правка отдельных ячеек
// (`updateCells`) и дописывание строк (`appendCells`). Плюс это один запрос к
// лимиту вместо четырёх.
//
// Значения пишутся как есть, без разбора «как если бы человек набрал руками»:
// число — числом, строка — строкой. Текст, начинающийся с «+» или «=», поэтому
// не превращается в формулу (грабли 1.9-ter), а «2026-09-18» остаётся текстом и
// не становится серийным числом (грабли 1.9-bis). Строка из одних цифр пишется
// числом — как было при прежней записи, чтобы суммы в самой таблице считались.
// ---------------------------------------------------------------------------

export type WriteOp =
  | { kind: "update"; tab: string; rowNumber: number; changes: Record<string, unknown> }
  | { kind: "append"; tab: string; records: Record<string, unknown>[] };

const NUMERIC_TEXT = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** Значение ячейки для `batchUpdate`. Экспортировано ради проверки. */
export function toCellData(value: unknown): sheets_v4.Schema$CellData {
  if (value === null || value === undefined || value === "") return { userEnteredValue: { stringValue: "" } };
  if (typeof value === "number") {
    return Number.isFinite(value) ? { userEnteredValue: { numberValue: value } } : { userEnteredValue: { stringValue: "" } };
  }
  if (typeof value === "boolean") return { userEnteredValue: { stringValue: value ? "TRUE" : "FALSE" } };
  const text = String(value);
  if (NUMERIC_TEXT.test(text) && text.length <= 15) return { userEnteredValue: { numberValue: Number(text) } };
  return { userEnteredValue: { stringValue: text } };
}

let sheetIdCache: { at: number; ids: Map<string, number> } | null = null;
const SHEET_ID_TTL_MS = 10 * 60 * 1000;

async function sheetIdOf(tabName: string): Promise<number> {
  const now = Date.now();
  if (!sheetIdCache || now - sheetIdCache.at > SHEET_ID_TTL_MS || !sheetIdCache.ids.has(tabName)) {
    const sheets = getSheetsClient();
    const meta = await callGoogle(() =>
      sheets.spreadsheets.get({ spreadsheetId: getSpreadsheetId(), fields: "sheets.properties" })
    );
    const ids = new Map<string, number>();
    for (const s of meta.data.sheets ?? []) {
      if (s.properties?.title && typeof s.properties.sheetId === "number") ids.set(s.properties.title, s.properties.sheetId);
    }
    sheetIdCache = { at: now, ids };
  }
  const id = sheetIdCache.ids.get(tabName);
  if (id === undefined) throw new Error(`Лист «${tabName}» не найден`);
  return id;
}

/** Все записи — одним запросом, который Google применяет целиком или никак. */
export async function commitAtomic(ops: WriteOp[]): Promise<void> {
  const requests: sheets_v4.Schema$Request[] = [];
  for (const op of ops) {
    const headers = SHEET_HEADERS[op.tab] ?? [];
    const sheetId = await sheetIdOf(op.tab);
    if (op.kind === "update") {
      for (const [column, value] of Object.entries(op.changes)) {
        const col = headers.indexOf(column);
        if (col < 0) throw new Error(`Колонки «${column}» нет во вкладке «${op.tab}»`);
        requests.push({
          updateCells: {
            range: {
              sheetId,
              startRowIndex: op.rowNumber - 1,
              endRowIndex: op.rowNumber,
              startColumnIndex: col,
              endColumnIndex: col + 1,
            },
            rows: [{ values: [toCellData(value)] }],
            fields: "userEnteredValue",
          },
        });
      }
    } else if (op.records.length > 0) {
      requests.push({
        appendCells: {
          sheetId,
          rows: op.records.map((r) => ({ values: headers.map((h) => toCellData(r[h])) })),
          fields: "userEnteredValue",
        },
      });
    }
  }
  if (requests.length === 0) return;
  const sheets = getSheetsClient();
  await writeThrough(() =>
    sheets.spreadsheets.batchUpdate({ spreadsheetId: getSpreadsheetId(), requestBody: { requests } })
  );
}

/**
 * Прочитать несколько вкладок ОДНИМ запросом и положить их в память чтений.
 *
 * Все сотрудники ходят в таблицу под одним доступом (refresh-токен владельца),
 * поэтому лимит Google «60 чтений в минуту» у них ОБЩИЙ, а не у каждого свой.
 * Страница, которой нужны заявки, позиции, клиенты и партии, раньше стоила
 * четыре чтения; после этого вызова — одно, а следующие `readTable` в течение
 * трёх секунд берут готовое.
 */
export async function prefetchTables(tabNames: string[]): Promise<void> {
  const now = Date.now();
  const need = tabNames.filter((t) => {
    const memo = readMemo.get(t);
    return !(memo && now - memo.at < READ_MEMO_MS);
  });
  if (need.length === 0) return;
  const sheets = getSheetsClient();
  try {
    const res = await callGoogle(() =>
      sheets.spreadsheets.values.batchGet({
        spreadsheetId: getSpreadsheetId(),
        ranges: need.map((t) => `${t}!A:ZZ`),
      })
    );
    need.forEach((tab, i) => {
      const table = toSheetTable(tab, (res.data.valueRanges?.[i]?.values ?? []) as string[][]);
      readMemo.set(tab, { at: now, promise: Promise.resolve(table) });
    });
  } catch {
    // Пакет не прочитался (например, одной из вкладок ещё нет) — не беда:
    // каждый `readTable` дальше прочитает свою вкладку сам, как раньше.
  }
}

/**
 * Удаляет строки, подходящие под условие. Возвращает, сколько удалено.
 *
 * Нужно ровно для одного случая: менеджер убрал позицию из заявки. Оставить
 * вместо удаления «количество ноль» было бы хуже — строка осталась бы в листе
 * сборки, в истории и в печатной форме, и объяснить её никто бы не смог.
 *
 * Строки удаляются СНИЗУ ВВЕРХ. Удаление сдвигает всё, что ниже, на строку
 * вверх: пойди сверху — и второй запрос попал бы уже не в ту строку, то есть
 * стёр бы соседнюю позицию чужой заявки. Поэтому же удаление идёт одним
 * пакетом, а не отдельными запросами: между ними таблица успела бы измениться.
 */
export async function deleteWhere(
  tabName: string,
  predicate: (record: Record<string, string>) => boolean
): Promise<number> {
  const table = await readTable(tabName, { fresh: true });
  const rowNumbers: number[] = [];
  table.rows.forEach((row, i) => {
    if (predicate(rowToRecord(tabName, row))) rowNumbers.push(table.rowNumbers[i]);
  });
  if (rowNumbers.length === 0) return 0;

  const sheets = getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const meta = await callGoogle(() => sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" }));
  const sheetId = meta.data.sheets?.find((s) => s.properties?.title === tabName)?.properties
    ?.sheetId;
  if (sheetId === undefined || sheetId === null) {
    throw new Error(`Лист «${tabName}» не найден`);
  }

  await writeThrough(() => sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: rowNumbers
        .slice()
        .sort((a, b) => b - a)
        .map((rowNumber) => ({
          deleteDimension: {
            range: {
              sheetId,
              dimension: "ROWS",
              // Google считает строки с нуля, а `rowNumbers` — с единицы, как
              // их показывает сама таблица.
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        })),
    },
  }));
  return rowNumbers.length;
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
  const spreadsheetId = getSpreadsheetId();
  const before = await readTable(tabName, { fresh: true });
  if (before.rows.length === 0) return 0;

  // Строки именно УДАЛЯЮТСЯ, а не очищаются. Очистка значений оставляет формат
  // ячеек, а формат меняет то, что таблица потом отдаёт при чтении: в ячейке с
  // датным форматом «2026-09-03» вернётся как «03.09.2026». На этом уже
  // погорели — четыре строки старых данных испортили дату у новых, и роза
  // четырёхдневной давности показывалась свежей.
  const meta = await callGoogle(() => sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" }));
  const sheetId = meta.data.sheets?.find((s) => s.properties?.title === tabName)?.properties
    ?.sheetId;

  if (sheetId === undefined || sheetId === null) {
    // Лист не нашёлся — лучше очистить значения, чем не сделать ничего.
    await writeThrough(() => sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${tabName}!A2:ZZ`,
    }));
    return before.rows.length;
  }

  const lastRow = Math.max(...before.rowNumbers);
  await writeThrough(() => sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: { sheetId, dimension: "ROWS", startIndex: 1, endIndex: lastRow },
          },
        },
      ],
    },
  }));
  return before.rows.length;
}

export { SHEET_TABS };
