/*
 * Файл плана отгрузок «по кругу»: собрать шаблон, заполнить его и прочитать
 * обратно тем же разборщиком, которым читает система.
 *
 * Тихая поломка здесь выглядит так: файл вроде загрузился, но половина строк
 * молча не распозналась — и РОП думает, что план поставлен, а он пустой.
 * Поэтому проверяем и то, что цифры доехали, и то, что мусор честно помечен
 * ошибкой, а не проглочен.
 *
 * Запуск: npx tsx scripts/check-plan-excel.ts
 */
import ExcelJS from "exceljs";
import { buildShipmentPlanTemplate, parseShipmentPlanWorkbook } from "../src/lib/excel";
import { SHIPMENT_DIRECTIONS, weeksOfMonth } from "../src/lib/constants";

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

async function main() {
  const weeks = weeksOfMonth(MONTH);

  // --- Шаблон ---------------------------------------------------------------
  const template = await buildShipmentPlanTemplate(MONTH);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(template as unknown as ArrayBuffer);

  check(
    "листы шаблона",
    wb.worksheets.map((w) => w.name),
    ["Розы", "Хризантемы", "Эустома", "Как заполнять"]
  );

  const roses = wb.getWorksheet("Розы")!;
  const header = roses.getRow(1).values as unknown[];
  check("первая колонка — направление", String(header[1]), "Направление");
  check("колонок-недель столько же, сколько недель в месяце", (header.length as number) - 2, weeks.length);

  const labels: string[] = [];
  roses.eachRow((row, n) => {
    if (n === 1) return;
    labels.push(String(row.getCell(1).value ?? ""));
  });
  check(
    "в шаблоне есть все направления",
    SHIPMENT_DIRECTIONS.every((d) => labels.includes(d)),
    true
  );
  check(
    "блоки подписаны заглавными",
    labels.some((l) => l === "РЕГИОНЫ КАЗАХСТАНА"),
    true
  );

  // --- Заполняем как человек ------------------------------------------------
  const fill = (sheetName: string, direction: string, weekIndex: number, value: unknown) => {
    const sheet = wb.getWorksheet(sheetName)!;
    let target = 0;
    sheet.eachRow((row, n) => {
      if (n === 1) return;
      if (String(row.getCell(1).value ?? "").trim() === direction) target = n;
    });
    sheet.getRow(target).getCell(1 + weekIndex).value = value as never;
  };

  fill("Розы", "Астана", 1, 4000);
  fill("Розы", "Астана", 2, "4 500"); // с пробелом, как копируют из таблицы
  fill("Розы", "РФ", 1, 9000);
  fill("Хризантемы", "Караганда", 3, 2500);
  fill("Эустома", "Астана", 1, 0); // ноль — «в это направление не везём»
  // Мусор: строка не из списка направлений и не число.
  const rosesSheet = wb.getWorksheet("Розы")!;
  const junkRow = rosesSheet.addRow(["Новосибирск", 100]);
  junkRow.commit();
  fill("Розы", "Семей", 1, "много");

  const filled = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
  const result = await parseShipmentPlanWorkbook(filled, MONTH);

  check("файл прочитался", result.fatalError ?? null, null);

  const good = result.rows.filter((r) => !r.error);
  const find = (flowerType: string, direction: string, weekIndex: number) =>
    good.find(
      (r) => r.flowerType === flowerType && r.direction === direction && r.weekIndex === weekIndex
    )?.stems ?? null;

  check("роза Астана, неделя 1", find("rose", "Астана", 1), 4000);
  check("число с пробелом разобрано", find("rose", "Астана", 2), 4500);
  check("роза РФ, неделя 1", find("rose", "РФ", 1), 9000);
  check("хризантема Караганда, неделя 3", find("chrysanthemum", "Караганда", 3), 2500);
  check("ноль читается как ноль, а не как пусто", find("eustoma", "Астана", 1), 0);
  check("неделя привязана к коду месяца", good[0].week.startsWith(MONTH), true);

  const errors = result.rows.filter((r) => r.error);
  check(
    "чужое направление помечено ошибкой",
    errors.some((r) => r.direction === "Новосибирск"),
    true
  );
  check(
    "не-число помечено ошибкой",
    errors.some((r) => r.direction === "Семей" && (r.error ?? "").includes("много")),
    true
  );
  check("испорченное не попало в хорошие", good.some((r) => r.direction === "Новосибирск"), false);
  check("пустые ячейки не создают строк", good.length, 5);

  // --- Не тот файл ----------------------------------------------------------
  const alien = new ExcelJS.Workbook();
  const sheet = alien.addWorksheet("Лист1");
  sheet.addRow(["Что-то", "своё"]);
  const alienBuffer = (await alien.xlsx.writeBuffer()) as ArrayBuffer;
  const alienResult = await parseShipmentPlanWorkbook(alienBuffer, MONTH);
  check("чужой файл честно отклонён", Boolean(alienResult.fatalError), true);
  check("из чужого файла ничего не взяли", alienResult.rows.length, 0);

  console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
