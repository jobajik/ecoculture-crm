import { copyTabToDb, dbTabsSummary, verifyTabInDb } from "@/lib/pgStore";
import { isPayrollTab, readTable, SHEET_TABS } from "@/lib/sheets";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Копия вкладки Google-таблицы в базу данных (переезд, этап 2, 13.11.2026). Копирует САМ САЙТ: у него уже есть и доступ
 * к таблице, и ключ базы, поэтому на компьютере владельца ключ базы не нужен — оттуда этот адрес только зовут
 * (`scripts/db-copy-all.ts`). Только с секретом CRON_SECRET.
 *
 *   ?list=1      — какие вкладки копируются (основная таблица; зарплата и теплица — отдельным этапом) и что уже в базе
 *   ?tab=Orders  — прочитать вкладку свежей, перезаписать её в базе и сверить записанное ячейка в ячейку
 *   ?tab=Orders&verify=1 — только сверить то, что лежит в базе, со свежей вкладкой; ничего не писать
 *
 * Сайт по-прежнему работает на таблице: копия в базе ни на что не влияет и устаревает со следующей правкой.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  const params = new URL(request.url).searchParams;
  const tabs: string[] = Object.values(SHEET_TABS).filter((t) => !isPayrollTab(t));
  try {
    if (params.get("list")) return Response.json({ tabs, inDb: await dbTabsSummary() });
    const tab = params.get("tab") || "";
    if (!tabs.includes(tab)) return Response.json({ error: "нет такой вкладки" }, { status: 400 });
    const t0 = Date.now();
    const table = await readTable(tab, { fresh: true });
    const readMs = Date.now() - t0;
    const result = params.get("verify") ? await verifyTabInDb(tab, table) : await copyTabToDb(tab, table);
    return Response.json({ readMs, ...result });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message.slice(0, 300) : String(err) }, { status: 500 });
  }
}
