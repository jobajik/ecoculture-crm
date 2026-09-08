/*
 * Проверка файла прогноза срезки «по кругу»: собираем шаблон, заполняем его
 * так, как это сделал бы агроном, читаем обратно и сверяем.
 *
 * Проверять разбор на выдуманной строке бесполезно — сломается всё равно на
 * настоящем шаблоне. Поэтому здесь ровно тот файл, который скачивает агроном:
 * на каждый цветок два листа, «сорта» и «ростовка», недели — колонками.
 *
 * Запуск: npx tsx scripts/check-forecast-excel.ts
 */
import ExcelJS from "exceljs";
import { buildForecastTemplate, parseForecastWorkbook } from "../src/lib/excel";
import { weeksOfMonth } from "../src/lib/constants";
import { rowsToZero } from "../src/lib/forecastReplace";

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

/** Ставит значение в ячейку «строка с таким названием × Неделя N». */
function put(sheet: ExcelJS.Worksheet, label: string, weekIndex: number, value: number) {
  const header = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
  const col = header.indexOf(`Неделя ${weekIndex}`) + 1;
  if (col === 0) throw new Error(`нет колонки «Неделя ${weekIndex}» на листе ${sheet.name}`);
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (String(row.getCell(1).value ?? "").trim() === label) {
      row.getCell(col).value = value;
      return;
    }
  }
  throw new Error(`не нашёл строку «${label}» на листе ${sheet.name}`);
}

async function main() {
  const weeks = weeksOfMonth(MONTH);

  // --- Шаблон Rose Farm: два цветка, по два листа на каждый + пояснения ----
  const roseFarmTemplate = await buildForecastTemplate(CATALOG, "rose_farm", MONTH);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(roseFarmTemplate).buffer as ArrayBuffer);

  check(
    "листы шаблона Rose Farm",
    wb.worksheets.map((s) => s.name),
    [
      "Розы — сорта",
      "Розы — ростовка",
      "Эустома — сорта",
      "Эустома — ростовка",
      "Как заполнять",
    ]
  );

  const roseSorts = wb.getWorksheet("Розы — сорта")!;
  const sortHeader = (roseSorts.getRow(1).values as unknown[]).slice(1).map(String);
  check("шапка листа сортов", sortHeader.slice(0, 3), ["Сорт", "Неделя 1", "Неделя 2"]);
  check("колонок-недель столько же, сколько недель", sortHeader.length - 1, weeks.length);
  check("строк — по сорту на строку", roseSorts.rowCount - 1, CATALOG.rose.length);

  const roseMix = wb.getWorksheet("Розы — ростовка")!;
  const mixHeader = (roseMix.getRow(1).values as unknown[]).slice(1).map(String);
  check("шапка листа ростовки", mixHeader[0], "Длина");
  check(
    "строки ростовки — длины",
    [1, 2, 3].map((r) => String(roseMix.getRow(r + 1).getCell(1).value)),
    ["40 см", "50 см", "60 см"]
  );

  // Есентай получает только хризантему — чужого цветка в файле быть не должно.
  const esentai = new ExcelJS.Workbook();
  await esentai.xlsx.load(
    new Uint8Array(await buildForecastTemplate(CATALOG, "esentai", MONTH)).buffer as ArrayBuffer
  );
  check(
    "шаблон Есентая — только хризантема",
    esentai.worksheets.map((s) => s.name),
    ["Хризантемы — сорта", "Хризантемы — ростовка", "Как заполнять"]
  );
  check(
    "у хризантемы строки ростовки — категории",
    [1, 2].map((r) =>
      String(esentai.getWorksheet("Хризантемы — ростовка")!.getRow(r + 1).getCell(1).value)
    ),
    ["Высшая", "Первая"]
  );

  // --- Заполняем как агроном ----------------------------------------------
  put(roseSorts, "Freedom", 1, 5000);
  put(roseSorts, "Freedom", 2, 4000);
  put(roseSorts, "Explorer", 1, 2000);
  // Ноль — это «сорта не будет», он обязан доехать как ноль, а не пропасть.
  put(roseSorts, "Red Naomi", 1, 0);

  put(roseMix, "60 см", 1, 4000);
  put(roseMix, "80 см", 1, 3000);
  put(roseMix, "60 см", 2, 4000);

  // Строка с ошибкой: неизвестный сорт.
  const strayRow = roseSorts.getRow(roseSorts.rowCount + 1);
  strayRow.getCell(1).value = "Неизвестный сорт";
  strayRow.getCell(2).value = 500;

  put(wb.getWorksheet("Эустома — сорта")!, "Alissa White", 3, 900);
  put(wb.getWorksheet("Эустома — ростовка")!, "Стандарт", 3, 900);

  const filled = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

  // --- Читаем обратно ------------------------------------------------------
  const parsed = await parseForecastWorkbook(filled, CATALOG, ["rose", "eustoma"], MONTH);

  check("файл прочитан без общей ошибки", parsed.fatalError, undefined);
  check("распознано без ошибок", parsed.validCount, 9);
  check("строк с ошибками", parsed.errorCount, 1);

  const goodVarieties = parsed.varieties.filter((r) => !r.error);
  const goodMix = parsed.mix.filter((r) => !r.error);
  const variety = (name: string, week: string) =>
    goodVarieties.find((r) => r.variety === name && r.week === week);
  const grade = (name: string, week: string) =>
    goodMix.find((r) => r.grade === name && r.week === week);

  check("Freedom неделя 1", variety("Freedom", "2026-09-W1")?.stems, 5000);
  check("Freedom неделя 2", variety("Freedom", "2026-09-W2")?.stems, 4000);
  check("Explorer неделя 1", variety("Explorer", "2026-09-W1")?.stems, 2000);
  check("ноль не потерялся", variety("Red Naomi", "2026-09-W1")?.stems, 0);
  check("эустома со своего листа", variety("Alissa White", "2026-09-W3")?.stems, 900);
  check("ростовка 60 см неделя 1", grade("60", "2026-09-W1")?.stems, 4000);
  check("ростовка 80 см неделя 1", grade("80", "2026-09-W1")?.stems, 3000);
  check("ростовка 60 см неделя 2", grade("60", "2026-09-W2")?.stems, 4000);

  check(
    "тип цветка взят из названия листа",
    [variety("Freedom", "2026-09-W1")?.flowerType, variety("Alissa White", "2026-09-W3")?.flowerType],
    ["rose", "eustoma"]
  );
  check(
    "сорта и ростовка сошлись за неделю 1",
    goodVarieties
      .filter((r) => r.flowerType === "rose" && r.week === "2026-09-W1")
      .reduce((s, r) => s + r.stems, 0),
    goodMix
      .filter((r) => r.flowerType === "rose" && r.week === "2026-09-W1")
      .reduce((s, r) => s + r.stems, 0)
  );
  check(
    "пустые ячейки не превратились в строки",
    goodVarieties.some((r) => r.variety === "Explorer" && r.week === "2026-09-W3"),
    false
  );

  const bad = parsed.varieties.find((r) => r.error);
  check("неизвестный сорт помечен ошибкой", bad?.error?.includes("не найден в справочнике"), true);
  check("ошибочная строка знает свой лист", bad?.sheet, "Розы — сорта");

  // --- Чужое производство --------------------------------------------------
  // Агроном Есентая не должен суметь загрузить лист с розами.
  const forEsentai = await parseForecastWorkbook(filled, CATALOG, ["chrysanthemum"], MONTH);
  check("для Есентая ничего не проходит", forEsentai.validCount, 0);
  check(
    "и сказано, почему",
    forEsentai.varieties[0]?.error?.includes("не ваше производство"),
    true
  );

  // --- Неделя, которой в месяце нет ---------------------------------------
  const extra = new ExcelJS.Workbook();
  const extraSheet = extra.addWorksheet("Розы — сорта");
  extraSheet.addRow(["Сорт", "Неделя 6"]);
  extraSheet.addRow(["Freedom", 100]);
  const withBadWeek = await parseForecastWorkbook(
    (await extra.xlsx.writeBuffer()) as ArrayBuffer,
    CATALOG,
    ["rose"],
    MONTH
  );
  check(
    "несуществующая неделя помечена",
    !!withBadWeek.varieties.find((r) => r.error?.includes("недели 6")),
    true
  );

  // --- Порядок колонок можно менять ---------------------------------------
  const shuffled = new ExcelJS.Workbook();
  const shuffledSheet = shuffled.addWorksheet("Розы — сорта");
  shuffledSheet.addRow(["Сорт", "Неделя 2", "Неделя 1"]);
  shuffledSheet.addRow(["Freedom", 22, 11]);
  const shuffledParsed = await parseForecastWorkbook(
    (await shuffled.xlsx.writeBuffer()) as ArrayBuffer,
    CATALOG,
    ["rose"],
    MONTH
  );
  check(
    "колонки читаются по заголовку, а не по порядку",
    [
      shuffledParsed.varieties.find((r) => r.week === "2026-09-W1")?.stems,
      shuffledParsed.varieties.find((r) => r.week === "2026-09-W2")?.stems,
    ],
    [11, 22]
  );

  // --- Совсем не тот файл --------------------------------------------------
  const junk = new ExcelJS.Workbook();
  junk.addWorksheet("Лист1").addRow(["привет", "как дела"]);
  const junkParsed = await parseForecastWorkbook(
    (await junk.xlsx.writeBuffer()) as ArrayBuffer,
    CATALOG,
    ["rose"],
    MONTH
  );
  check("посторонний файл отвергнут понятно", !!junkParsed.fatalError, true);

  // --- Загрузка заменяет месяц ---------------------------------------------
  // Агроном перезагружает файл целиком. Позиция, которой в новом файле нет,
  // обязана обнулиться, иначе прошлая цифра прилипает и всплывает в балансе как
  // урожай, которого никто не обещал.
  const weekCodes = weeksOfMonth(MONTH).map((w) => w.code);
  const existing = [
    { period: weekCodes[0], flowerType: "rose", key: "Prestige", targetStems: 1000 },
    { period: weekCodes[0], flowerType: "rose", key: "Freedom", targetStems: 500 },
    { period: weekCodes[1], flowerType: "rose", key: "Prestige", targetStems: 700 },
    { period: weekCodes[0], flowerType: "chrysanthemum", key: "Altaj", targetStems: 900 },
    { period: "2026-08-W1", flowerType: "rose", key: "Prestige", targetStems: 400 },
    { period: weekCodes[0], flowerType: "rose", key: "Уже ноль", targetStems: 0 },
  ];
  const loaded = [
    { period: weekCodes[0], flowerType: "rose", key: "Prestige" },
    { period: weekCodes[1], flowerType: "rose", key: "Prestige" },
  ];
  const zeros = rowsToZero(existing, loaded, weekCodes);

  check(
    "исчезнувший из файла сорт обнуляется",
    zeros.map((r) => `${r.flowerType}:${r.key}`),
    ["rose:Freedom"]
  );
  check(
    "цветок, которого не было в файле, не трогаем",
    zeros.some((r) => r.flowerType === "chrysanthemum"),
    false
  );
  check(
    "чужой месяц не трогаем",
    zeros.some((r) => r.period === "2026-08-W1"),
    false
  );
  check("уже нулевые строки не переписываем", zeros.some((r) => r.key === "Уже ноль"), false);
  check("пустая загрузка ничего не стирает", rowsToZero(existing, [], weekCodes).length, 0);

  console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
