/*
 * Починка ячеек, которые Google-таблица испортила, приняв текст за формулу.
 *
 * Владелец прислал снимок заявки: вместо телефона клиента — **#ERROR!**, и той
 * же надписью испорчена фраза про Kaspi. Телефон был записан как
 * «+7 701 555 20 30», а значение, начинающееся с плюса, таблица считает началом
 * формулы: пытается сосчитать и оставляет в ячейке жалобу. Программа потом
 * читает уже её — телефон потерян.
 *
 * Причина вылечена в `src/lib/sheetCell.ts`: теперь такой текст помечается при
 * записи. Но ячейки, испорченные ДО этого, сами не починятся — их и разбирает
 * этот скрипт.
 *
 * Как он возвращает потерянное. Значение цело: таблица хранит его как ФОРМУЛУ,
 * и Google отдаёт её, если попросить `valueRenderOption: "FORMULA"`. Из
 * `=+7 701 555 20 30` телефон восстанавливается ровно таким, каким его вводил
 * человек, — ничего не придумывается.
 *
 * Предохранители, как и у скрипта удаления заявок:
 *
 * 1. **без ключа `--yes` ничего не пишется** — скрипт только показывает, что
 *    нашёл и во что это превратится;
 * 2. **перед записью делается копия всей таблицы** отдельным файлом, и без неё
 *    скрипт не начинает;
 * 3. **настоящие формулы владельца не трогаются.** Если в ячейке `=СУММ(A1:A9)`
 *    или ссылка на ячейку — это расчёт, который вёл человек, и превратить его в
 *    текст значило бы сломать таблицу. Такие ячейки показываются отдельно и
 *    остаются как есть.
 *
 * Запуск:
 *   npx tsx scripts/fix-error-cells.ts          — показать
 *   npx tsx scripts/fix-error-cells.ts --yes    — починить
 */
import * as dotenv from "dotenv";

// Ключи доступа лежат в .env.local и должны подтянуться ДО первого обращения
// к таблице — поэтому загрузка стоит выше импортов, работающих с Google.
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readTablesWithFormulas, writeCells } from "../src/lib/sheets";
import { SHEET_HEADERS, SHEET_TABS } from "../src/lib/constants";
import { containsSheetError, isSheetError, recoverFromFormula } from "../src/lib/sheetCell";
import { createBackup } from "../src/lib/backup";

interface Broken {
  tab: string;
  /** Адрес ячейки в таблице, например «Clients!E14». */
  address: string;
  column: string;
  /** Что показывает ячейка сейчас: #ERROR! и подобное. */
  shown: string;
  /** Что было введено на самом деле. Пусто — восстановить нечем. */
  recovered: string;
  /** Что вернула таблица в ответ на просьбу показать записанное. */
  stored: string;
}

function columnLetter(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

async function main() {
  const apply = process.argv.includes("--yes");
  const tabs = Object.values(SHEET_TABS);

  const broken: Broken[] = [];
  const lost: Broken[] = [];
  const untouchable: Broken[] = [];

  // Две картины одной и той же таблицы: что ВИДНО (там ошибка) и что ЗАПИСАНО
  // (там уцелевший текст, превращённый в формулу). Обе — одним запросом на все
  // вкладки: по два запроса на вкладку упирается в лимит чтений Google.
  const pictures = await readTablesWithFormulas(tabs);

  for (const tab of tabs) {
    const { shown, formulas } = pictures.get(tab) ?? { shown: [], formulas: [] };
    const headers = SHEET_HEADERS[tab] ?? [];

    shown.forEach((row, r) => {
      // Строка 1 — заголовки, её не трогаем вовсе.
      if (r === 0) return;
      row.forEach((cell, c) => {
        if (!isSheetError(String(cell ?? ""))) return;
        const formula = String(formulas[r]?.[c] ?? "");
        const item: Broken = {
          tab,
          address: `${tab}!${columnLetter(c)}${r + 1}`,
          column: headers[c] ?? columnLetter(c),
          shown: String(cell ?? ""),
          recovered: recoverFromFormula(formula),
          stored: formula,
        };
        // Три судьбы. Восстановили — чиним. Внутри записанного та же жалоба
        // («#ERROR! ()») — значение потеряли ещё раньше, и честный ответ здесь
        // пустая ячейка, а не выдумка. Всё прочее — настоящая формула
        // владельца, её не трогаем вовсе.
        if (item.recovered) broken.push(item);
        else if (containsSheetError(formula) || !formula.trim()) lost.push(item);
        else untouchable.push(item);
      });
    });
  }

  console.log(`Сломанных ячеек: ${broken.length + lost.length + untouchable.length}`);
  console.log("");

  if (broken.length > 0) {
    console.log("=== Починю ===");
    for (const b of broken) {
      console.log(`  ${b.address} · ${b.column} · ${b.shown} → «${b.recovered}»`);
    }
    console.log("");
  }
  if (lost.length > 0) {
    console.log("=== Восстановить нечем — очищу ===");
    console.log("Настоящее значение потеряли раньше: в записи лежит та же жалоба таблицы.");
    console.log("Придумывать телефон нельзя, поэтому ячейка станет пустой.");
    for (const b of lost) console.log(`  ${b.address} · ${b.column} · записано: «${b.stored}»`);
    console.log("");
  }
  if (untouchable.length > 0) {
    console.log("=== Не трону: восстанавливать нечем или это настоящая формула ===");
    // Печатаем и то, что вернула таблица: первая версия скрипта не починила ни
    // одной ячейки, и понять почему было нельзя — в выводе не было главного,
    // самого записанного значения. Теперь оно видно, и гадать не придётся.
    for (const b of untouchable) {
      console.log(`  ${b.address} · ${b.column} · ${b.shown} · записано: «${b.stored}»`);
    }
    console.log("");
  }

  if (broken.length === 0 && lost.length === 0) {
    console.log("Чинить нечего.");
    return;
  }

  if (!apply) {
    console.log("Ничего не тронуто: это показ. Для починки запустите с ключом --yes.");
    return;
  }

  // Копия всей таблицы ДО первой записи. Вернуть ячейку иначе будет нечем:
  // в Google-таблице нет истории на уровне программы.
  console.log("=== Резервная копия всей таблицы ===");
  const backup = await createBackup(new Date(), (m) => console.log(`  ${m}`));
  console.log(`Копия готова: «${backup.title}» — ${backup.rows} строк, ${backup.tabs} вкладок`);
  console.log(backup.url);
  console.log("");

  // Пишем по одной ячейке. Пометку «это текст» ставит сам `writeCells` — там
  // же, где её ставит любая другая запись программы, чтобы правило жило в
  // одном месте и не разъехалось.
  await writeCells([
    ...broken.map((b) => ({ address: b.address, value: b.recovered })),
    ...lost.map((b) => ({ address: b.address, value: "" })),
  ]);

  console.log(`Восстановлено ячеек: ${broken.length}`);
  if (lost.length > 0) {
    console.log(`Очищено (восстановить было нечем): ${lost.length}`);
    console.log("Эти значения придётся вписать руками — программа их не знает.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
