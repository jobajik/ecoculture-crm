/*
 * Проверка файла прогноза срезки «по кругу»: собираем шаблон, заполняем его
 * так, как это сделал бы агроном, читаем обратно и сверяем.
 *
 * Проверять разбор на выдуманной строке бесполезно — сломается всё равно на
 * настоящем шаблоне. Поэтому здесь ровно тот файл, который скачивает агроном.
 *
 * Запуск: npx tsx scripts/check-forecast-excel.ts
 */
import ExcelJS from "exceljs";
import { buildForecastTemplate, parseForecastWorkbook } from "../src/lib/excel";
import { weeksOfMonth } from "../src/lib/constants";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${
      ok ? "" : ` (ждали ${JSON.stringify(expected)})`
    }`
  );
}

const MONTH = "2026-09";
const CATALOG = {
  rose: ["Freedom", "Explorer", "Red Naomi"],
  eustoma: ["Alissa White"],
  chrysanthemum: ["Altaj"],
};

async function main() {
  const weeks = weeksOfMonth(MONTH);

  // --- Шаблон Rose Farm: два цветка, значит два листа + пояснения ---------
  const roseFarmTemplate = await buildForecastTemplate(CATALOG, "rose_farm", MONTH);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(roseFarmTemplate).buffer as ArrayBuffer);

  check(
    "листы шаблона Rose Farm",
    wb.worksheets.map((s) => s.name),
    ["Розы", "Эустома", "Как заполнять"]
  );

  const roses = wb.getWorksheet("Розы")!;
  const header = (roses.getRow(1).values as unknown[]).slice(1).map(String);
  check("первые колонки — сорт и неделя", header.slice(0, 2), ["Сорт", "Неделя"]);
  check("дальше идёт ростовка", header.slice(2, 5), ["40 см", "50 см", "60 см"]);
  check(
    "строк: сорт × неделя",
    roses.rowCount - 1,
    CATALOG.rose.length * weeks.length
  );

  // Есентай получает только хризантему — чужого цветка в файле быть не должно.
  const esentai = new ExcelJS.Workbook();
  await esentai.xlsx.load(
    new Uint8Array(await buildForecastTemplate(CATALOG, "esentai", MONTH)).buffer as ArrayBuffer
  );
  check(
    "шаблон Есентая — только хризантема",
    esentai.worksheets.map((s) => s.name),
    ["Хризантемы", "Как заполнять"]
  );
  check(
    "у хризантемы колонки — категории",
    (esentai.getWorksheet("Хризантемы")!.getRow(1).values as unknown[]).slice(3, 5).map(String),
    ["Высшая", "Первая"]
  );

  // --- Заполняем как агроном ----------------------------------------------
  // Freedom, неделя 1: 60 см — 3000, 80 см — 1500. Неделя 2: 60 см — 4000.
  const col = (name: string) => header.indexOf(name) + 1;
  const findRow = (variety: string, weekIndex: number) => {
    for (let r = 2; r <= roses.rowCount; r++) {
      const row = roses.getRow(r);
      if (String(row.getCell(1).value) === variety && Number(row.getCell(2).value) === weekIndex) {
        return row;
      }
    }
    throw new Error(`не нашёл строку ${variety} / неделя ${weekIndex}`);
  };

  findRow("Freedom", 1).getCell(col("60 см")).value = 3000;
  findRow("Freedom", 1).getCell(col("80 см")).value = 1500;
  findRow("Freedom", 2).getCell(col("60 см")).value = 4000;
  // Ноль — это «позиции не будет», он обязан доехать как ноль, а не пропасть.
  findRow("Explorer", 1).getCell(col("50 см")).value = 0;
  // Строка с ошибкой: неизвестный сорт.
  const strayRow = roses.getRow(roses.rowCount + 1);
  strayRow.getCell(1).value = "Неизвестный сорт";
  strayRow.getCell(2).value = 1;
  strayRow.getCell(col("60 см")).value = 500;

  const eustoma = wb.getWorksheet("Эустома")!;
  const eustomaHeader = (eustoma.getRow(1).values as unknown[]).slice(1).map(String);
  for (let r = 2; r <= eustoma.rowCount; r++) {
    const row = eustoma.getRow(r);
    if (String(row.getCell(1).value) === "Alissa White" && Number(row.getCell(2).value) === 3) {
      row.getCell(eustomaHeader.indexOf("Стандарт") + 1).value = 900;
      break;
    }
  }

  const filled = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

  // --- Читаем обратно ------------------------------------------------------
  const parsed = await parseForecastWorkbook(
    filled,
    CATALOG,
    ["rose", "eustoma"],
    MONTH,
    `${MONTH}-W1`
  );

  check("файл прочитан без общей ошибки", parsed.fatalError, undefined);
  check("распознано без ошибок", parsed.validCount, 5);
  check("строк с ошибками", parsed.errorCount, 1);

  const good = parsed.rows.filter((r) => !r.error);
  const find = (variety: string, grade: string, week: string) =>
    good.find((r) => r.variety === variety && r.grade === grade && r.week === week);

  check("Freedom 60 см неделя 1", find("Freedom", "60", "2026-09-W1")?.stems, 3000);
  check("Freedom 80 см неделя 1", find("Freedom", "80", "2026-09-W1")?.stems, 1500);
  check("Freedom 60 см неделя 2", find("Freedom", "60", "2026-09-W2")?.stems, 4000);
  check("ноль не потерялся", find("Explorer", "50", "2026-09-W1")?.stems, 0);
  check("эустома со своего листа", find("Alissa White", "Стандарт", "2026-09-W3")?.stems, 900);
  check(
    "тип цветка взят из названия листа",
    [find("Freedom", "60", "2026-09-W1")?.flowerType, find("Alissa White", "Стандарт", "2026-09-W3")?.flowerType],
    ["rose", "eustoma"]
  );
  check(
    "пустые ячейки не превратились в строки",
    good.some((r) => r.stems === 0 && r.variety === "Red Naomi"),
    false
  );

  const bad = parsed.rows.find((r) => r.error);
  check("неизвестный сорт помечен ошибкой", bad?.error?.includes("не найден в справочнике"), true);
  check("ошибочная строка знает свой лист", bad?.sheet, "Розы");

  // --- Чужое производство --------------------------------------------------
  // Агроном Есентая не должен суметь загрузить лист с розами.
  const forEsentai = await parseForecastWorkbook(filled, CATALOG, ["chrysanthemum"], MONTH, `${MONTH}-W1`);
  check("для Есентая все розы — ошибка", forEsentai.validCount, 0);
  check(
    "и сказано, почему",
    forEsentai.rows[0]?.error?.includes("не ваше производство"),
    true
  );

  // --- Неделя вне месяца ---------------------------------------------------
  strayRow.getCell(1).value = "Freedom";
  strayRow.getCell(2).value = 9; // девятой недели в сентябре нет
  const withBadWeek = await parseForecastWorkbook(
    (await wb.xlsx.writeBuffer()) as ArrayBuffer,
    CATALOG,
    ["rose", "eustoma"],
    MONTH,
    `${MONTH}-W1`
  );
  const weekError = withBadWeek.rows.find((r) => r.error?.includes("не из этого месяца"));
  check("несуществующая неделя помечена", !!weekError, true);

  // --- Старый построчный формат ещё понимается -----------------------------
  const legacy = new ExcelJS.Workbook();
  const sheet = legacy.addWorksheet("Прогноз срезки");
  sheet.addRow(["Тип цветка", "Сорт", "Длина / категория", "Количество, шт"]);
  sheet.addRow(["Роза", "Freedom", "60", 700]);
  const legacyParsed = await parseForecastWorkbook(
    (await legacy.xlsx.writeBuffer()) as ArrayBuffer,
    CATALOG,
    ["rose", "eustoma"],
    MONTH,
    `${MONTH}-W2`
  );
  check("старый формат читается", legacyParsed.validCount, 1);
  check("старый формат: количество", legacyParsed.rows[0]?.stems, 700);
  check("старый формат: неделя по умолчанию", legacyParsed.rows[0]?.week, "2026-09-W2");

  // --- Совсем не тот файл --------------------------------------------------
  const junk = new ExcelJS.Workbook();
  junk.addWorksheet("Лист1").addRow(["привет", "как дела"]);
  const junkParsed = await parseForecastWorkbook(
    (await junk.xlsx.writeBuffer()) as ArrayBuffer,
    CATALOG,
    ["rose"],
    MONTH,
    `${MONTH}-W1`
  );
  check("посторонний файл отвергнут понятно", !!junkParsed.fatalError, true);

  console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
