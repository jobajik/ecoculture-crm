import { Client } from "pg";
import { dbUrlFacts, directDbUrl, pooledDbUrl, scrubDbError } from "@/lib/dbUrl";
import { forgetReads, prefetchTables, readTable, SHEET_TABS } from "@/lib/sheets";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Замер скорости С САМОГО СЕРВЕРА сайта (переезд на базу данных, этап 1, 13.11.2026): в каком регионе работает
 * функция, сколько у неё занимает чтение Google-таблицы и сколько — обращение к базе Neon. С компьютера владельца это
 * не измерить: он в Казахстане, а сервер — в США или Европе. Ничего не меняет. Только с секретом CRON_SECRET; строки
 * подключения в ответ не попадают — лишь признаки (`dbUrlFacts`). `?sheets=0` — без чтения таблицы.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  const params = new URL(request.url).searchParams;
  const withSheets = params.get("sheets") !== "0";
  const out: Record<string, unknown> = {
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 7),
    region: process.env.VERCEL_REGION || "",
  };
  // `?set=chats` — только чтение набора вкладок одной страницы (одним запросом, как это делает сама страница).
  const set = params.get("set") || "";
  if (set) {
    out.set = await pageSetTiming(set);
    return Response.json(out, { headers: { "Cache-Control": "no-store" } });
  }
  if (withSheets) out.sheets = await sheetsTimings();
  out.db = { pooled: await dbTimings(pooledDbUrl()), direct: await dbTimings(directDbUrl()) };
  return Response.json(out, { headers: { "Cache-Control": "no-store" } });
}

/** Какие вкладки берёт страница — те же наборы, что в `scripts/diag-speed.ts`. */
function pageSets(): Record<string, string[]> {
  const T = SHEET_TABS;
  return {
    orders: [T.ORDERS, T.ORDER_ITEMS, T.CLIENTS, T.USERS],
    order: [T.ORDERS, T.ORDER_ITEMS, T.CLIENTS, T.USERS, T.SHIPMENTS, T.BATCHES, T.PAYMENTS, T.KASPI_INVOICES, T.CLAIMS],
    finance: [T.ORDERS, T.ORDER_ITEMS, T.CLIENTS, T.USERS, T.PAYMENTS, T.KASPI_INVOICES],
    stock: [T.BATCHES, T.ORDERS, T.ORDER_ITEMS, T.SHIPMENTS, T.WRITEOFFS],
    chats: [T.WA_MESSAGES, T.LEADS, T.CLIENTS, T.USERS, T.ASSISTANT_LOG, T.LEAD_ANALYSES, T.LEAD_TOUCHES],
    leads: [T.LEADS, T.LEAD_TOUCHES, T.WA_MESSAGES, T.LEAD_ANALYSES, T.CLIENTS, T.USERS],
  };
}

async function pageSetTiming(name: string) {
  const tabs = pageSets()[name];
  if (!tabs) return { name, error: "нет такого набора" };
  try {
    forgetReads();
    const t0 = Date.now();
    await prefetchTables(tabs);
    const ms = Date.now() - t0;
    let rows = 0;
    for (const tab of tabs) rows += (await readTable(tab)).rows.length; // из памяти чтений — второго запроса нет
    return { name, tabs: tabs.length, rows, ms };
  } catch (err) {
    return { name, error: err instanceof Error ? err.message.slice(0, 200) : String(err) };
  }
}

async function sheetsTimings() {
  const T = SHEET_TABS;
  const result: Record<string, unknown>[] = [];
  try {
    for (const tab of [T.USERS, T.ORDERS]) {
      const t0 = Date.now();
      const table = await readTable(tab, { fresh: true });
      result.push({ what: tab, rows: table.rows.length, ms: Date.now() - t0 });
    }
    forgetReads();
    const t0 = Date.now();
    await prefetchTables([T.ORDERS, T.ORDER_ITEMS, T.CLIENTS, T.USERS]);
    result.push({ what: "orders page set", ms: Date.now() - t0 });
  } catch (err) {
    result.push({ error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
  }
  return result;
}

async function dbTimings(url: string) {
  const facts = dbUrlFacts(url);
  if (!url) return facts;
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000, statement_timeout: 10_000 });
  try {
    const t0 = Date.now();
    await client.connect();
    const connectMs = Date.now() - t0;
    const queryMs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const q0 = Date.now();
      await client.query("select 1");
      queryMs.push(Date.now() - q0);
    }
    const info = await client.query(
      "select current_database() as db, split_part(version(), ' ', 2) as version, (select count(*)::int from information_schema.tables where table_schema = 'public') as tables"
    );
    return { ...facts, ok: true, connectMs, queryMs, ...info.rows[0] };
  } catch (err) {
    return { ...facts, ok: false, error: scrubDbError(err, url) };
  } finally {
    await client.end().catch(() => {});
  }
}
