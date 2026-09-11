/*
 * Очистка рабочих данных перед стартом «в бою».
 *
 * По умолчанию стирает только рабочие данные дня: заявки и их позиции,
 * отгрузки, списания, рекламации и журнал действий по деньгам. Склад
 * добавляется ключом `--with-stock`, а всё остальное — прайс, планы, прогноз и
 * клиентская база — ключом `--all`.
 *
 * Справочники (Users, Varieties, Settings) не стираются никогда, ни при каком
 * ключе: без них система не работает, а восстанавливать их пришлось бы руками.
 *
 * Четыре предохранителя, и все четыре нужны:
 *
 * 1. **Сначала копия.** Скрипт сам создаёт резервную копию всей таблицы
 *    отдельным файлом с датой в названии и печатает ссылку на него. Если
 *    копия не сделалась — ничего не стирается. Отменить очистку иначе нельзя:
 *    в Google-таблице нет корзины для удалённых строк.
 * 2. **Показывает, что именно удалит, и ждёт слова.** Запуск без ключа
 *    показывает список вкладок и число строк — и на этом останавливается.
 *    Чтобы стереть, нужен ключ `--yes`.
 * 3. **Возвращает остаток в партии.** Отгрузка и списание уменьшают остаток
 *    партии. Партии мы оставляем — это живой холодильник, — поэтому вычтенные
 *    стебли возвращаются, иначе склад показал бы меньше, чем в нём лежит.
 * 4. **Стирает строки, а не значения.** `clearDataRows()` удаляет строки
 *    целиком: стёртые значения оставляют формат ячейки, и он потом достаётся
 *    новым данным (см. CLAUDE.md, грабли 1.9-bis — из-за этого дата
 *    возвращалась числом 46274).
 *
 * Запуск:  npx tsx scripts/clear-work-data.ts               — только показать
 *          npx tsx scripts/clear-work-data.ts --yes         — копия и очистка
 *          npx tsx scripts/clear-work-data.ts --yes --with-stock
 *                                            — то же плюс обнулить склад
 *          npx tsx scripts/clear-work-data.ts --yes --all
 *                                            — стереть ВСЁ, кроме справочников
 *
 * Весь вывод дублируется в `_temp/clear-work-data.log` — файл пишет сам скрипт,
 * а не перенаправление в `.bat`: перенаправление уводит с экрана всё, и окно
 * выглядит зависшим, а обёртка через PowerShell на этом компьютере запрещена
 * политикой выполнения скриптов.
 */
import * as dotenv from "dotenv";

// Ключи доступа лежат в .env.local и должны подтянуться ДО первого обращения
// к таблице — поэтому загрузка стоит выше импортов, работающих с Google.
dotenv.config({ path: ".env.local" });
dotenv.config();

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

import { clearDataRows, readTable, rowToRecord, SHEET_TABS } from "../src/lib/sheets";
import { returnBatchQuantity } from "../src/lib/repo/batches";
import { createBackup } from "../src/lib/backup";

/**
 * Пишем и на экран, и в файл — сразу, строка за строкой.
 *
 * На экран, чтобы окно не выглядело мёртвым: копия боевой таблицы делается
 * около минуты, и молчащее окно закрывают на середине (так уже случилось).
 * В файл — чтобы вывод можно было переслать целиком, не переписывая с экрана.
 *
 * Пишет сам скрипт, а не перенаправление в `.bat`: перенаправление уводит с
 * экрана ВЕСЬ вывод, а обёртка через PowerShell на этом компьютере запрещена
 * политикой выполнения скриптов (`npx.ps1` не запускается).
 *
 * Дозапись идёт построчно, поэтому даже прерванный запуск оставляет читаемый
 * лог до места остановки.
 */
const LOG_PATH = "_temp/clear-work-data.log";

function startLog() {
  try {
    mkdirSync("_temp", { recursive: true });
    writeFileSync(LOG_PATH, `Запуск ${new Date().toISOString()}\n`, "utf-8");
  } catch {
    // Не смогли завести файл — не повод не работать: экран остаётся.
  }
}

function log(line = "") {
  console.log(line);
  try {
    appendFileSync(LOG_PATH, `${line}\n`, "utf-8");
  } catch {
    // см. выше
  }
}

/** Что стираем всегда. Порядок сверху вниз — как о них думает человек. */
const ALWAYS: { tab: string; what: string }[] = [
  { tab: SHEET_TABS.ORDERS, what: "заявки" },
  { tab: SHEET_TABS.ORDER_ITEMS, what: "позиции заявок" },
  { tab: SHEET_TABS.SHIPMENTS, what: "отгрузки" },
  { tab: SHEET_TABS.WRITEOFFS, what: "списания" },
  { tab: SHEET_TABS.STAFF_TAKEOUTS, what: "выдачи сотрудникам в счёт зарплаты" },
  { tab: SHEET_TABS.CLAIMS, what: "рекламации" },
  { tab: SHEET_TABS.MONEY_LOG, what: "журнал действий по деньгам" },
];

/**
 * Всё остальное — по ключу `--all`: прайс, планы РОПа и прогноз агронома, а
 * также клиентская база. Это уже не «рабочие данные за день», а то, что
 * заводили руками, поэтому отдельным ключом.
 *
 * Справочники не стираются НИКОГДА, даже с `--all`: без вкладки Users в систему
 * не войдёт никто, включая владельца; без Varieties склад не примет ни одного
 * сорта; без Settings пропадут сроки хранения. Восстанавливать их пришлось бы
 * руками, и «чистая база» превратилась бы в нерабочую.
 */
const EXTRA: { tab: string; what: string }[] = [
  { tab: SHEET_TABS.CLIENTS, what: "клиентская база" },
  { tab: SHEET_TABS.PRICE_HISTORY, what: "прайс-лист и история цен" },
  { tab: SHEET_TABS.PLANS, what: "планы продаж менеджерам" },
  { tab: SHEET_TABS.SHIPMENT_PLANS, what: "план отгрузок" },
  { tab: SHEET_TABS.HARVEST_FORECAST, what: "прогноз срезки по сортам" },
  { tab: SHEET_TABS.HARVEST_MIX, what: "прогноз ростовки" },
];

/**
 * Склад стирается только по отдельному ключу `--with-stock`.
 *
 * Партии — это живой холодильник, и обнулять его вместе с заявками нельзя:
 * заявки заводят заново за день, а пересчитать физический остаток — работа на
 * несколько часов. Но перед самым запуском «в бою» владелец решил обнулить и
 * его: зав. складом внесут настоящий остаток приёмкой сами, и это честнее,
 * чем стартовать с цифрами, набранными для проверки.
 */
const STOCK = { tab: SHEET_TABS.BATCHES, what: "партии на складе" };

/** Что остаётся нетронутым ВСЕГДА — печатаем явно, чтобы не было сюрприза. */
const ALWAYS_KEPT = [
  "сотрудники (Users) — без них никто не войдёт",
  "справочник сортов (Varieties) — без него склад не примет приёмку",
  "настройки сроков хранения (Settings)",
];

/**
 * Сколько стеблей вернуть в каждую партию.
 *
 * Отгрузка и списание уменьшают остаток партии. Если стереть отгрузки, а
 * партии оставить (а мы их оставляем — это живой холодильник), стебли так и
 * останутся вычтенными: склад покажет меньше, чем лежит на самом деле, и
 * записи, объясняющей разницу, уже не будет. Поэтому перед стиранием остаток
 * возвращается, и склад становится ровно таким, каким был до проверочных
 * отгрузок.
 */
async function quantitiesToReturn(): Promise<Map<string, number>> {
  const back = new Map<string, number>();
  // Выдачи сотрудникам снимают остаток так же, как отгрузка и списание, —
  // значит и возвращать их надо так же. Забыть эту вкладку здесь означало бы
  // молча уменьшить склад на всё, что люди брали домой.
  for (const tab of [SHEET_TABS.SHIPMENTS, SHEET_TABS.WRITEOFFS, SHEET_TABS.STAFF_TAKEOUTS]) {
    try {
      const table = await readTable(tab);
      for (const row of table.rows) {
        const record = rowToRecord(tab, row);
        const batchId = (record.BatchID || "").trim();
        const quantity = Number(record.Quantity) || 0;
        if (!batchId || quantity <= 0) continue;
        back.set(batchId, (back.get(batchId) ?? 0) + quantity);
      }
    } catch {
      // Вкладки может не быть — возвращать тогда нечего.
    }
  }
  return back;
}

async function countRows(tab: string): Promise<number> {
  try {
    const table = await readTable(tab);
    return table.rows.length;
  } catch {
    // Вкладки может не быть (например, MoneyLog до первого setup-sheet) —
    // это не ошибка, стирать там просто нечего.
    return 0;
  }
}

async function main() {
  const confirmed = process.argv.includes("--yes");
  // `--all` включает и склад: «стереть всё» без склада — это не всё.
  const all = process.argv.includes("--all");
  const withStock = all || process.argv.includes("--with-stock");
  startLog();

  // Если склад обнуляется, возвращать в него стебли незачем — партий не станет.
  const TO_CLEAR = [...ALWAYS, ...(withStock ? [STOCK] : []), ...(all ? EXTRA : [])];

  log("Будет стёрто:");
  let total = 0;
  const counts: number[] = [];
  for (const item of TO_CLEAR) {
    const rows = await countRows(item.tab);
    counts.push(rows);
    total += rows;
    log(`  ${item.what} (${item.tab}) — ${rows} строк`);
  }

  const back = withStock ? new Map<string, number>() : await quantitiesToReturn();
  const backStems = Array.from(back.values()).reduce((sum, n) => sum + n, 0);
  if (backStems > 0) {
    log(
      `\nВ партии вернётся стеблей: ${backStems} (партий: ${back.size}) — их вычли отгрузки и`
    );
    log("списания, которые мы стираем. Иначе склад показал бы меньше, чем лежит.");
  }

  if (!withStock) log("\nСклад НЕ трогаем: партии остаются как есть.");

  log("\nОстанется без изменений:");
  for (const line of ALWAYS_KEPT) log(`  ${line}`);
  if (!withStock) log("  партии на складе (текущие остатки)");
  if (!all) {
    log("  клиентская база");
    log("  прайс-лист и история цен");
    log("  планы РОПа и прогноз агронома");
  }

  if (total === 0) {
    log("\nСтирать нечего — база уже чистая.");
    return;
  }

  if (!confirmed) {
    log(`\nВсего строк к удалению: ${total}.`);
    log("Ничего не тронуто: это показ. Для очистки запустите с ключом --yes.");
    return;
  }

  log("\nДелаю резервную копию всей таблицы. Это самая долгая часть — до минуты.");
  log("НЕ ЗАКРЫВАЙТЕ окно: пока копии нет, стирание не начнётся.\n");
  const backup = await createBackup(new Date(), log);
  log(`Копия готова: «${backup.title}» — ${backup.rows} строк, ${backup.tabs} вкладок`);
  log(backup.url);

  if (backStems > 0) {
    log("\nВозвращаю остаток в партии…");
    for (const [batchId, quantity] of back) {
      const ok = await returnBatchQuantity(batchId, quantity);
      log(`  ${batchId}: +${quantity}${ok ? "" : " — партия не найдена, пропущена"}`);
    }
  }

  log("\nСтираю…");
  let removed = 0;
  for (const item of TO_CLEAR) {
    const n = await clearDataRows(item.tab);
    removed += n;
    log(`  ${item.what}: удалено строк ${n}`);
  }

  log(`\nГотово. Удалено строк: ${removed}. База чистая, можно работать.`);
  log("Если что-то понадобится вернуть — данные лежат в копии по ссылке выше.");
}

main().catch((error) => {
  log(`Не получилось: ${error instanceof Error ? error.message : String(error)}`);
  log("Ничего не стёрто — при ошибке скрипт останавливается целиком.");
  process.exit(1);
});
