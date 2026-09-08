/*
 * Проверка прайса как файла и как истории.
 *
 * Прайс переехал в зону ответственности РОПа: она скачивает файл с текущими
 * ценами, правит его в Excel и загружает обратно, а система запоминает дату
 * каждого изменения. Ошибиться здесь легко тихо: принять пустую ячейку за ноль
 * (и снять цену со всего цветка), записать в историю строки, где ничего не
 * менялось, или посчитать изменением повтор вчерашней цены.
 *
 * Поэтому файл гоняется «по кругу»: собрали шаблон с ценами → прочитали обратно
 * → сверили. А история собирается из выдуманных строк с заранее известным
 * ответом.
 *
 * Запуск: npx tsx scripts/check-price-file.ts
 */
import { buildPriceTemplate, parsePriceWorkbook } from "../src/lib/excel";
import { priceChangeDays, daysSinceLastChange } from "../src/lib/priceChanges";
import type { PriceRow } from "../src/lib/priceList";
import ExcelJS from "exceljs";

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

const CATALOG = {
  rose: ["Prestige", "Red Naomi"],
  chrysanthemum: ["Altaj"],
  eustoma: ["Rosita"],
};

async function main() {
  // --- Шаблон выгружается заполненным --------------------------------------
  const current = {
    "rose||60": 200,
    "rose||70": 300,
    "rose|Red Naomi|60": 260,
    "chrysanthemum||Высшая": 150,
  };
  const buffer = await buildPriceTemplate(CATALOG, current);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  check(
    "лист на каждый цветок плюс подсказка",
    wb.worksheets.map((s) => s.name),
    ["Розы", "Хризантемы", "Эустома", "Как заполнять"]
  );

  // --- Круг: прочитали свой же файл ----------------------------------------
  // Ничего не меняли — значит и изменений быть не должно, все строки уходят в
  // «без изменений». Иначе каждая выгрузка-загрузка плодила бы историю.
  const same = await parsePriceWorkbook(
    buffer as unknown as ArrayBuffer,
    CATALOG,
    current
  );
  check("круг: файл прочитан", same.fatalError, undefined);
  check("круг: изменений нет", same.validCount, 0);
  check("круг: строки признаны прежними", same.sameCount, 4);

  // --- Правка в файле ------------------------------------------------------
  const edited = new ExcelJS.Workbook();
  await edited.xlsx.load(buffer as unknown as ArrayBuffer);
  const roses = edited.getWorksheet("Розы")!;
  // Шапка в первой строке, «Все сорта» — во второй, дальше сорта.
  const gradeCol = (label: string) => {
    let found = 0;
    roses.getRow(1).eachCell((cell, col) => {
      if (String(cell.value ?? "").trim() === label) found = col;
    });
    return found;
  };
  roses.getRow(2).getCell(gradeCol("60 см")).value = 220; // подорожало
  roses.getRow(2).getCell(gradeCol("70 см")).value = 0; // цену сняли
  // Строка сорта Prestige — третья: ставим свою цену там, где её не было.
  roses.getRow(3).getCell(gradeCol("60 см")).value = 240;
  const editedBuffer = await edited.xlsx.writeBuffer();

  const parsed = await parsePriceWorkbook(
    editedBuffer as unknown as ArrayBuffer,
    CATALOG,
    current
  );
  check("правка: три изменения", parsed.validCount, 3);
  check("правка: ошибок нет", parsed.errorCount, 0);

  const byKey = new Map(parsed.rows.map((r) => [`${r.flowerType}|${r.variety}|${r.grade}`, r]));
  check("подорожание распознано", byKey.get("rose||60")?.price, 220);
  check("прежняя цена показана", byKey.get("rose||60")?.wasPrice, 200);
  check("ноль означает «цены нет», а не пропуск", byKey.get("rose||70")?.price, 0);
  check("новая цена сорта", byKey.get("rose|Prestige|60")?.price, 240);
  check("у новой цены прежней нет", byKey.get("rose|Prestige|60")?.wasPrice, null);
  check(
    "чужие цветки не тронуты",
    parsed.rows.some((r) => r.flowerType !== "rose"),
    false
  );

  // --- Пустая ячейка ≠ ноль ------------------------------------------------
  // Это главное правило файла: человек заполнил розы и загрузил — хризантема
  // обязана остаться как была.
  const cleared = new ExcelJS.Workbook();
  await cleared.xlsx.load(buffer as unknown as ArrayBuffer);
  const chrys = cleared.getWorksheet("Хризантемы")!;
  chrys.getRow(2).eachCell((cell, col) => {
    if (col > 1) cell.value = null;
  });
  const clearedParsed = await parsePriceWorkbook(
    (await cleared.xlsx.writeBuffer()) as unknown as ArrayBuffer,
    CATALOG,
    current
  );
  check(
    "пустая ячейка не снимает цену",
    clearedParsed.rows.some((r) => r.flowerType === "chrysanthemum"),
    false
  );

  // --- Незнакомый сорт -----------------------------------------------------
  const strange = new ExcelJS.Workbook();
  await strange.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = strange.getWorksheet("Розы")!;
  const row = sheet.addRow(["Выдуманный сорт"]);
  row.getCell(gradeCol("60 см")).value = 500;
  const strangeParsed = await parsePriceWorkbook(
    (await strange.xlsx.writeBuffer()) as unknown as ArrayBuffer,
    CATALOG,
    current
  );
  check("незнакомый сорт помечен ошибкой", strangeParsed.errorCount, 1);
  check(
    "и не проглочен молча",
    strangeParsed.rows.find((r) => r.error)?.variety,
    "Выдуманный сорт"
  );

  // --- Не файл -------------------------------------------------------------
  const garbage = await parsePriceWorkbook(new TextEncoder().encode("это не excel").buffer);
  check("мусор вместо файла — понятная ошибка", Boolean(garbage.fatalError), true);

  // --- История изменений ---------------------------------------------------
  const p = (date: string, grade: string, price: number, variety = ""): PriceRow => ({
    date,
    flowerType: "rose",
    variety,
    grade,
    price,
  });
  const history: PriceRow[] = [
    p("2026-09-01", "60", 200),
    p("2026-09-01", "70", 300),
    // Повтор той же цены — это не изменение.
    p("2026-09-05", "60", 200),
    p("2026-09-10", "60", 220),
    p("2026-09-10", "70", 270),
    // Строки в таблице лежат в порядке записи, а не дат: правка задним числом.
    p("2026-09-08", "80", 400),
  ];
  const days = priceChangeDays(history);
  check("дни идут сверху вниз от свежего", days.map((d) => d.date), [
    "2026-09-10",
    "2026-09-08",
    "2026-09-01",
  ]);
  check("повтор цены изменением не считается", days.find((d) => d.date === "2026-09-05"), undefined);

  const tenth = days[0];
  check("10 сентября: два изменения", tenth.changes.length, 2);
  check("подорожало", tenth.up, 1);
  check("подешевело", tenth.down, 1);
  check(
    "видно было → стало",
    tenth.changes.map((c) => [c.grade, c.from, c.to]),
    [
      ["60", 200, 220],
      ["70", 300, 270],
    ]
  );
  check("среднее изменение", Number(tenth.avgChangePercent!.toFixed(1)), 0);

  const first = days[days.length - 1];
  check("первая установка цены — не подорожание", [first.up, first.added], [0, 2]);
  check("сравнивать не с чем", first.changes[0].changePercent, null);

  check("дней с последней правки", daysSinceLastChange(days, "2026-09-20"), 10);
  check("правку сегодня видно нулём", daysSinceLastChange(days, "2026-09-10"), 0);
  check("пустая история — неизвестно", daysSinceLastChange([], "2026-09-20"), null);

  // Снятие цены (ноль) считается отдельно от подешевения: это разные события.
  const removed = priceChangeDays([p("2026-09-01", "60", 200), p("2026-09-02", "60", 0)]);
  check("ноль — это «цену сняли»", [removed[0].removed, removed[0].down], [1, 0]);

  console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
