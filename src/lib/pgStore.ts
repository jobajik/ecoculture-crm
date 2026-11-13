import { Client } from "pg";
import { directDbUrl, scrubDbError } from "./dbUrl";
import type { SheetTable } from "./sheets";

/**
 * Хранилище вкладок в базе данных (PostgreSQL) — переезд с Google-таблицы, этап 2 (13.11.2026).
 *
 * Данные переносятся КАК ЕСТЬ: вкладка остаётся вкладкой, строка — строкой, ячейка — тем же текстом, который сайт
 * получает от Google сейчас. Поэтому таблица в базе одна на все вкладки: `sheet_rows (tab, row_number, cells)`, где
 * `cells` — массив текстов ровно той длины, что пришла из таблицы (Google обрезает пустой хвост строки — и мы храним
 * обрезанной). `row_number` — номер строки в Google-таблице на момент копии: по нему сайт правит и удаляет строки.
 * Заголовки вкладки и время копии — в `sheet_tabs`.
 *
 * Сайт этим ещё НЕ пользуется: он работает на Google-таблице. Здесь только копирование и сверка.
 */

const SCHEMA = `
create table if not exists sheet_rows (
  tab text not null,
  row_number integer not null,
  cells text[] not null,
  primary key (tab, row_number)
);
create table if not exists sheet_tabs (
  tab text primary key,
  headers text[] not null,
  row_count integer not null,
  copied_at timestamptz not null default now()
);`;

const BATCH = 1500;

/**
 * Два вида знаков база не хранит, и они убираются при копии — это ЕДИНСТВЕННОЕ отступление от «как есть», и оно
 * считается (`cleaned`): нулевой знак (U+0000 — PostgreSQL его в тексте не допускает; на живых данных 13.11.2026 он
 * нашёлся во вкладке AssistantLog, и вкладка не скопировалась вовсе) убирается, половинка составного знака (оборванный
 * смайлик) заменяется на «\uFFFD». Оба невидимы и смысла не несут.
 */
const NUL = /\u0000/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export function cleanCell(value: string | null | undefined): string {
  const text = value ?? "";
  if (!NUL.test(text) && !LONE_SURROGATE.test(text)) {
    NUL.lastIndex = 0;
    LONE_SURROGATE.lastIndex = 0;
    return text;
  }
  NUL.lastIndex = 0;
  LONE_SURROGATE.lastIndex = 0;
  return text.replace(NUL, "").replace(LONE_SURROGATE, "\uFFFD");
}

export interface CopyResult {
  tab: string;
  rows: number;
  cells: number;
  /** Сколько ячеек пришлось очистить от знаков, которые база не хранит (см. `cleanCell`), и где первая. */
  cleaned: number;
  firstCleaned: string;
  /** Сколько строк, прочитанных обратно из базы, не совпали с тем, что записывали. Должно быть 0. */
  mismatches: number;
  /** Где первое расхождение: номер строки и колонка (содержимое не печатаем — это данные клиентов). */
  firstMismatch: string;
  writeMs: number;
  verifyMs: number;
}

function sameRow(a: string[], b: (string | null)[]): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if ((a[i] ?? "") !== (b[i] ?? "")) return i;
  return -1;
}

async function withClient<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const url = directDbUrl();
  if (!url) throw new Error("Ключ базы данных не задан (DATABASE_URL)");
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 30_000 });
  try {
    await client.connect();
    return await work(client);
  } catch (err) {
    throw new Error(scrubDbError(err, url));
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Перезаписывает вкладку в базе тем, что прочитано из Google-таблицы, одной транзакцией (всё или ничего), и тут же
 * читает её обратно и сравнивает ячейка в ячейку. Запускать можно сколько угодно раз.
 */
export async function copyTabToDb(tab: string, table: SheetTable): Promise<CopyResult> {
  return withClient(async (client) => {
    await client.query(SCHEMA);
    const t0 = Date.now();
    await client.query("begin");
    try {
      await client.query("delete from sheet_rows where tab = $1", [tab]);
      for (let from = 0; from < table.rows.length; from += BATCH) {
        const part = table.rows.slice(from, from + BATCH).map((cells, i) => ({ n: table.rowNumbers[from + i], c: cells.map(cleanCell) }));
        await client.query(
          `insert into sheet_rows (tab, row_number, cells)
           select $1, (e->>'n')::int, array(select jsonb_array_elements_text(e->'c'))
           from jsonb_array_elements($2::jsonb) e`,
          [tab, JSON.stringify(part)]
        );
      }
      await client.query(
        `insert into sheet_tabs (tab, headers, row_count, copied_at) values ($1, $2, $3, now())
         on conflict (tab) do update set headers = excluded.headers, row_count = excluded.row_count, copied_at = excluded.copied_at`,
        [tab, table.headers.map(cleanCell), table.rows.length]
      );
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    }
    const writeMs = Date.now() - t0;

    const check = await compareWithDb(client, tab, table);
    const cells = table.rows.reduce((sum, r) => sum + r.length, 0);
    return { tab, rows: table.rows.length, cells, writeMs, ...countCleaned(table), ...check };
  });
}

function countCleaned(table: SheetTable): Pick<CopyResult, "cleaned" | "firstCleaned"> {
  let cleaned = 0;
  let firstCleaned = "";
  table.rows.forEach((cells, i) =>
    cells.forEach((v, col) => {
      if (cleanCell(v) === (v ?? "")) return;
      cleaned++;
      if (!firstCleaned) firstCleaned = `строка ${table.rowNumbers[i]}, колонка ${col + 1}`;
    })
  );
  return { cleaned, firstCleaned };
}

/** Сравнивает вкладку в базе с переданной (из Google-таблицы) ячейка в ячейку — после `cleanCell`. Ничего не меняет. */
async function compareWithDb(client: Client, tab: string, table: SheetTable): Promise<Pick<CopyResult, "mismatches" | "firstMismatch" | "verifyMs">> {
  const t1 = Date.now();
  const back = await client.query<{ row_number: number; cells: (string | null)[] }>(
    "select row_number, cells from sheet_rows where tab = $1 order by row_number",
    [tab]
  );
  const head = await client.query<{ headers: string[] }>("select headers from sheet_tabs where tab = $1", [tab]);
  let mismatches = 0;
  let firstMismatch = "";
  const note = (where: string) => {
    mismatches++;
    if (!firstMismatch) firstMismatch = where;
  };
  if (sameRow(table.headers.map(cleanCell), head.rows[0]?.headers ?? []) !== -1) note("заголовки");
  if (back.rows.length !== table.rows.length) note(`строк в базе ${back.rows.length}, в таблице ${table.rows.length}`);
  const inDb = new Map(back.rows.map((r) => [r.row_number, r.cells]));
  table.rows.forEach((cells, i) => {
    const stored = inDb.get(table.rowNumbers[i]);
    if (!stored) return note(`строки ${table.rowNumbers[i]} в базе нет`);
    const col = sameRow(cells.map(cleanCell), stored);
    if (col !== -1) note(`строка ${table.rowNumbers[i]}, колонка ${col + 1}`);
  });
  return { mismatches, firstMismatch, verifyMs: Date.now() - t1 };
}

/**
 * Сверка без записи: вкладка из Google-таблицы против того, что лежит в базе. Пока сайт работает на таблице, копия
 * отстаёт на каждую правку — ноль расхождений здесь ждём только при остановленной записи (вечер переключения).
 */
export async function verifyTabInDb(tab: string, table: SheetTable): Promise<CopyResult> {
  return withClient(async (client) => {
    await client.query(SCHEMA);
    const check = await compareWithDb(client, tab, table);
    return { tab, rows: table.rows.length, cells: table.rows.reduce((sum, r) => sum + r.length, 0), writeMs: 0, ...countCleaned(table), ...check };
  });
}

/** Что сейчас лежит в базе: вкладка, строк, когда скопирована. */
export async function dbTabsSummary(): Promise<{ tab: string; rows: number; copiedAt: string }[]> {
  return withClient(async (client) => {
    await client.query(SCHEMA);
    const res = await client.query<{ tab: string; row_count: number; copied_at: Date }>("select tab, row_count, copied_at from sheet_tabs order by tab");
    return res.rows.map((r) => ({ tab: r.tab, rows: r.row_count, copiedAt: r.copied_at.toISOString() }));
  });
}
