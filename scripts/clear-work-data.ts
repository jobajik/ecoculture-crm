/*
 * Очистка рабочих данных перед стартом «в бою».
 *
 * Стирает то, что вводили для проверки: заявки и их позиции, отгрузки,
 * списания, рекламации и журнал действий по деньгам. НЕ трогает партии на
 * складе (это живой остаток), прайс-лист, планы РОПа, прогноз агронома и
 * справочники — сотрудников, сорта, настройки сроков хранения.
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
 * Запуск:  npx tsx scripts/clear-work-data.ts        — только показать
 *          npx tsx scripts/clear-work-data.ts --yes  — сделать копию и стереть
 */
import * as dotenv from "dotenv";

// Ключи доступа лежат в .env.local и должны подтянуться ДО первого обращения
// к таблице — поэтому загрузка стоит выше импортов, работающих с Google.
dotenv.config({ path: ".env.local" });
dotenv.config();

import { clearDataRows, readTable, rowToRecord, SHEET_TABS } from "../src/lib/sheets";
import { returnBatchQuantity } from "../src/lib/repo/batches";
import { createBackup } from "../src/lib/backup";

/** Что стираем. Порядок сверху вниз — как о них думает человек. */
const TO_CLEAR: { tab: string; what: string }[] = [
  { tab: SHEET_TABS.ORDERS, what: "заявки" },
  { tab: SHEET_TABS.ORDER_ITEMS, what: "позиции заявок" },
  { tab: SHEET_TABS.SHIPMENTS, what: "отгрузки" },
  { tab: SHEET_TABS.WRITEOFFS, what: "списания" },
  { tab: SHEET_TABS.CLAIMS, what: "рекламации" },
  { tab: SHEET_TABS.MONEY_LOG, what: "журнал действий по деньгам" },
];

/** Что остаётся нетронутым — печатаем явно, чтобы не было сюрприза. */
const KEPT = [
  "партии на складе (текущие остатки)",
  "прайс-лист и история цен",
  "планы РОПа и план отгрузок",
  "прогноз срезки агронома",
  "сотрудники, сорта, настройки",
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
  for (const tab of [SHEET_TABS.SHIPMENTS, SHEET_TABS.WRITEOFFS]) {
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

  console.log("Будет стёрто:");
  let total = 0;
  const counts: number[] = [];
  for (const item of TO_CLEAR) {
    const rows = await countRows(item.tab);
    counts.push(rows);
    total += rows;
    console.log(`  ${item.what} (${item.tab}) — ${rows} строк`);
  }

  const back = await quantitiesToReturn();
  const backStems = Array.from(back.values()).reduce((sum, n) => sum + n, 0);
  if (backStems > 0) {
    console.log(
      `\nВ партии вернётся стеблей: ${backStems} (партий: ${back.size}) — их вычли отгрузки и`
    );
    console.log("списания, которые мы стираем. Иначе склад показал бы меньше, чем лежит.");
  }

  console.log("\nОстанется без изменений:");
  for (const line of KEPT) console.log(`  ${line}`);

  if (total === 0) {
    console.log("\nСтирать нечего — база уже чистая.");
    return;
  }

  if (!confirmed) {
    console.log(`\nВсего строк к удалению: ${total}.`);
    console.log("Ничего не тронуто: это показ. Для очистки запустите с ключом --yes.");
    return;
  }

  console.log("\nДелаю резервную копию всей таблицы. Это самая долгая часть — до минуты.");
  console.log("НЕ ЗАКРЫВАЙТЕ окно: пока копии нет, стирание не начнётся.\n");
  const backup = await createBackup(new Date(), (message) => console.log(message));
  console.log(`Копия готова: «${backup.title}» — ${backup.rows} строк, ${backup.tabs} вкладок`);
  console.log(backup.url);

  if (backStems > 0) {
    console.log("\nВозвращаю остаток в партии…");
    for (const [batchId, quantity] of back) {
      const ok = await returnBatchQuantity(batchId, quantity);
      console.log(`  ${batchId}: +${quantity}${ok ? "" : " — партия не найдена, пропущена"}`);
    }
  }

  console.log("\nСтираю…");
  let removed = 0;
  for (const item of TO_CLEAR) {
    const n = await clearDataRows(item.tab);
    removed += n;
    console.log(`  ${item.what}: удалено строк ${n}`);
  }

  console.log(`\nГотово. Удалено строк: ${removed}. База чистая, можно работать.`);
  console.log("Если что-то понадобится вернуть — данные лежат в копии по ссылке выше.");
}

main().catch((error) => {
  console.error("Не получилось:", error instanceof Error ? error.message : error);
  console.error("Ничего не стёрто — при ошибке скрипт останавливается целиком.");
  process.exit(1);
});
