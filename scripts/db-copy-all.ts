import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Копия Google-таблицы в базу данных — вкладка за вкладкой (переезд, этап 2, 13.11.2026). Копирует сам сайт
 * (`/api/db/copy`), этот скрипт только зовёт его по очереди и печатает итог: строк, ячеек, время и сошлось ли
 * записанное с прочитанным обратно. Ключ базы на этом компьютере не нужен — только CRON_SECRET. Запускать можно
 * сколько угодно раз: вкладка в базе перезаписывается целиком. Сайт при этом работает на таблице, как работал.
 *
 *   npx tsx scripts/db-copy-all.ts            — все вкладки основной таблицы
 *   npx tsx scripts/db-copy-all.ts Orders Clients — только названные
 *   npx tsx scripts/db-copy-all.ts --list     — что уже лежит в базе
 *   npx tsx scripts/db-copy-all.ts --verify   — ничего не писать, только сверить базу со свежей таблицей (пока сайт
 *                                               работает на таблице, расхождения в живых вкладках — это правки людей
 *                                               после копии, а не ошибка переноса)
 */
const BASE = "https://www.crm-ecoculture.kz";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(query: string) {
  const res = await fetch(`${BASE}/api/db/copy?${query}`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, cache: "no-store" });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: { error: text.slice(0, 200) } };
  }
}

async function main() {
  if (!process.env.CRON_SECRET) throw new Error("Нет CRON_SECRET в .env.local");
  const listed = await call("list=1");
  if (listed.status !== 200) throw new Error(`Список вкладок: ${listed.status} ${listed.data.error || ""}`);
  if (process.argv.includes("--list")) {
    for (const t of listed.data.inDb) console.log(`${String(t.tab).padEnd(22)} ${String(t.rows).padStart(7)} строк · скопирована ${t.copiedAt}`);
    console.log(`\nВ базе вкладок: ${listed.data.inDb.length} из ${listed.data.tabs.length}`);
    return;
  }
  const asked = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const tabs: string[] = asked.length ? asked : listed.data.tabs;
  const mode = process.argv.includes("--verify") ? "&verify=1" : "";
  console.log("Вкладка".padEnd(22), "строк".padStart(7), "ячеек".padStart(9), "чтение".padStart(8), "запись".padStart(8), "сверка".padStart(8), " итог");
  let rows = 0, cells = 0, bad = 0, failed = 0;
  for (const tab of tabs) {
    let r = await call(`tab=${encodeURIComponent(tab)}${mode}`);
    if (r.status !== 200) {
      await sleep(5000); // лимит Google или база проснулась не сразу — одна повторная попытка
      r = await call(`tab=${encodeURIComponent(tab)}${mode}`);
    }
    if (r.status !== 200) {
      failed++;
      console.log(tab.padEnd(22), `ОШИБКА ${r.status}: ${r.data.error || ""}`);
    } else {
      const d = r.data;
      rows += d.rows;
      cells += d.cells;
      if (d.mismatches) bad++;
      console.log(tab.padEnd(22), String(d.rows).padStart(7), String(d.cells).padStart(9), `${d.readMs} мс`.padStart(8), `${d.writeMs} мс`.padStart(8), `${d.verifyMs} мс`.padStart(8), d.mismatches ? ` РАСХОЖДЕНИЙ ${d.mismatches}: ${d.firstMismatch}` : " сошлось");
    }
    await sleep(1200);
  }
  console.log(`\nВкладок: ${tabs.length}, строк: ${rows}, ячеек: ${cells}. Не сошлось вкладок: ${bad}. Ошибок: ${failed}.`);
  if (bad || failed) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
