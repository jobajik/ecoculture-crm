import ExcelJS from "exceljs";
import {
  FLOWER_TYPES,
  FLOWER_TYPE_LABELS,
  FLOWER_TYPE_LABELS_PLURAL,
  GRADE_LABELS,
  getGradesFor,
  farmLabel,
  flowerTypesForFarm,
  getFarmFor,
  periodLabel,
  topGradeHint,
  formatGrade,
  weeksOfMonth,
  DIRECTION_GROUPS,
  SHIPMENT_DIRECTIONS,
  type FlowerType,
} from "./constants";
import { BASE_VARIETY, BASE_VARIETY_LABEL } from "./priceList";

// ---------------------------------------------------------------------------
// Загрузка приёмки с производства из Excel-файла.
//
// Файл может быть выгрузкой из теплицы или заполненным шаблоном (его можно
// скачать прямо из интерфейса). Колонки определяются по названиям заголовков —
// регистр, лишние пробелы и порядок колонок значения не имеют, лишние колонки
// игнорируются.
// ---------------------------------------------------------------------------

/** Названия колонок, которые понимает импорт. Первый вариант — тот, что в шаблоне. */
const COLUMN_ALIASES: Record<string, string[]> = {
  harvestDate: ["дата сбора", "дата срезки", "дата", "harvestdate", "date"],
  flowerType: ["тип цветка", "тип", "культура", "flowertype", "type"],
  variety: ["сорт", "variety", "название сорта"],
  grade: ["длина / категория", "длина/категория", "длина", "категория", "grade", "length"],
  quantity: ["количество, шт", "количество", "кол-во", "quantity", "qty", "шт"],
  location: ["место хранения", "место", "холодильник", "location"],
};

export interface ParsedBatchRow {
  rowNumber: number;
  harvestDate: string;
  flowerType: FlowerType;
  variety: string;
  grade: string;
  quantity: number;
  location: string;
  /** Заполнено, если строку нельзя импортировать как есть. */
  error?: string;
}

export interface ParseResult {
  rows: ParsedBatchRow[];
  validCount: number;
  errorCount: number;
  /** Ошибка, из-за которой файл не удалось прочитать вообще. */
  fatalError?: string;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function detectFlowerType(raw: string): FlowerType | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith("роз") || value === "rose") return FLOWER_TYPES.ROSE;
  if (value.startsWith("хриз") || value === "chrysanthemum" || value.startsWith("chrys")) {
    return FLOWER_TYPES.CHRYSANTHEMUM;
  }
  if (value.startsWith("эустом") || value.startsWith("евстом") || value.startsWith("лизиант") ||
      value === "eustoma" || value.startsWith("lisianth")) {
    return FLOWER_TYPES.EUSTOMA;
  }
  return null;
}

/** Приводит значение к одному из допустимых вариантов длины/категории для этого типа цветка. */
function normalizeGrade(raw: string, flowerType: FlowerType): string | null {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\s*(см|cm)\.?$/i, "")
    .replace(/ё/g, "е")
    .trim();
  if (!cleaned) return null;

  for (const grade of getGradesFor(flowerType)) {
    if (grade.toLowerCase().replace(/ё/g, "е") === cleaned) return grade;
  }

  // Числовые длины могут приехать как 60.0 или "60,0"
  const numeric = Number(cleaned.replace(",", "."));
  if (!Number.isNaN(numeric) && Number.isFinite(numeric)) {
    const asString = String(Math.round(numeric));
    for (const grade of getGradesFor(flowerType)) {
      if (grade === asString) return grade;
    }
  }

  return null;
}

/** Дата может приехать как настоящая дата Excel, как текст «06.09.2026» или «2026-09-06». */
function normalizeDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const dotted = raw.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (dotted) {
    const [, d, m, y] = dotted;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return null;
}

function cellText(cell: ExcelJS.Cell | undefined): string {
  if (!cell) return "";
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String((value as { text: unknown }).text ?? "").trim();
  if (typeof value === "object" && "result" in value) {
    return String((value as { result: unknown }).result ?? "").trim();
  }
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

export async function parseBatchesWorkbook(
  buffer: ArrayBuffer,
  /** Справочник сортов по типам цветка — сорт из файла сверяется с ним. */
  varietyCatalog: Record<string, string[]> = {}
): Promise<ParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    return {
      rows: [],
      validCount: 0,
      errorCount: 0,
      fatalError: "Не удалось прочитать файл. Нужен файл Excel в формате .xlsx.",
    };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { rows: [], validCount: 0, errorCount: 0, fatalError: "В файле нет ни одного листа." };
  }

  // Ищем строку заголовков среди первых 10 строк — файл из теплицы может начинаться с шапки.
  let headerRowNumber = 0;
  const columnIndex: Record<string, number> = {};

  for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    const found: Record<string, number> = {};
    row.eachCell((cell, colNumber) => {
      const header = normalizeHeader(cellText(cell));
      for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (found[field] === undefined && aliases.includes(header)) found[field] = colNumber;
      }
    });
    if (found.variety !== undefined && found.quantity !== undefined) {
      headerRowNumber = r;
      Object.assign(columnIndex, found);
      break;
    }
  }

  if (!headerRowNumber) {
    return {
      rows: [],
      validCount: 0,
      errorCount: 0,
      fatalError:
        "Не нашёл строку с заголовками. Нужны как минимум колонки «Сорт» и «Количество» — " +
        "проще всего скачать шаблон и заполнить его.",
    };
  }

  const rows: ParsedBatchRow[] = [];

  for (let r = headerRowNumber + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const rawVariety = cellText(row.getCell(columnIndex.variety ?? 0));
    const rawQuantity = cellText(row.getCell(columnIndex.quantity ?? 0));
    const rawType = columnIndex.flowerType ? cellText(row.getCell(columnIndex.flowerType)) : "";
    const rawGrade = columnIndex.grade ? cellText(row.getCell(columnIndex.grade)) : "";
    const rawDateCell = columnIndex.harvestDate ? row.getCell(columnIndex.harvestDate).value : null;
    const rawLocation = columnIndex.location ? cellText(row.getCell(columnIndex.location)) : "";

    // Полностью пустая строка — просто пропускаем.
    if (!rawVariety && !rawQuantity && !rawType && !rawGrade) continue;

    const errors: string[] = [];

    const flowerType = detectFlowerType(rawType);
    if (!flowerType) errors.push(
        `тип цветка «${rawType || "пусто"}» непонятен (нужно «${FLOWER_TYPE_LABELS.rose}», ` +
          `«${FLOWER_TYPE_LABELS.chrysanthemum}» или «${FLOWER_TYPE_LABELS.eustoma}»)`
      );

    let variety = rawVariety;
    if (!rawVariety) {
      errors.push("не указан сорт");
    } else if (flowerType) {
      const known = varietyCatalog[flowerType] ?? [];
      if (known.length > 0) {
        const match = known.find(
          (v) => v.toLowerCase() === rawVariety.trim().replace(/\s+/g, " ").toLowerCase()
        );
        if (match) {
          variety = match;
        } else {
          errors.push(
            `сорт «${rawVariety}» не найден в справочнике ` +
              `(${FLOWER_TYPE_LABELS[flowerType]}: ${known.join(", ")}). ` +
              "Новый сорт можно добавить на вкладке Varieties в таблице"
          );
        }
      }
    }

    const quantity = Number(rawQuantity.replace(/\s/g, "").replace(",", "."));
    if (!rawQuantity) errors.push("не указано количество");
    else if (Number.isNaN(quantity) || quantity <= 0) errors.push(`количество «${rawQuantity}» — не число больше нуля`);

    const harvestDate = normalizeDate(rawDateCell);
    if (!harvestDate) errors.push(`дата сбора «${cellText(row.getCell(columnIndex.harvestDate ?? 0)) || "пусто"}» не распознана`);

    let grade = "";
    if (flowerType) {
      const normalized = normalizeGrade(rawGrade, flowerType);
      if (!normalized) {
        errors.push(
          `${GRADE_LABELS[flowerType].toLowerCase()} «${rawGrade || "пусто"}» не из списка ` +
            `(допустимо: ${getGradesFor(flowerType).join(", ")})`
        );
      } else {
        grade = normalized;
      }
    }

    rows.push({
      rowNumber: r,
      harvestDate: harvestDate ?? "",
      flowerType: flowerType ?? FLOWER_TYPES.ROSE,
      variety,
      grade,
      quantity: Number.isNaN(quantity) ? 0 : quantity,
      location: rawLocation,
      error: errors.length > 0 ? errors.join("; ") : undefined,
    });
  }

  return {
    rows,
    validCount: rows.filter((r) => !r.error).length,
    errorCount: rows.filter((r) => r.error).length,
  };
}

/**
 * Готовит .xlsx-шаблон для заполнения на производстве.
 *
 * Если передано производство (farm), в шаблон попадает только его цветок:
 * Rose Farm — розы и эустома, Есентай Агро Хим — хризантема. Так зав. складом
 * не сможет случайно принять чужую культуру.
 */
export async function buildBatchesTemplate(
  varietyCatalog: Record<string, string[]> = {},
  farm?: string | null
): Promise<Buffer> {
  const allowedTypes = (farm ? flowerTypesForFarm(farm) : [
    FLOWER_TYPES.ROSE,
    FLOWER_TYPES.CHRYSANTHEMUM,
    FLOWER_TYPES.EUSTOMA,
  ]) as FlowerType[];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ecoculture-CRM";
  const sheet = workbook.addWorksheet("Приёмка");

  sheet.columns = [
    { header: "Дата сбора", key: "harvestDate", width: 14 },
    { header: "Тип цветка", key: "flowerType", width: 16 },
    { header: "Сорт", key: "variety", width: 22 },
    { header: "Длина / категория", key: "grade", width: 20 },
    { header: "Количество, шт", key: "quantity", width: 16 },
    { header: "Место хранения", key: "location", width: 20 },
  ];

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle" };

  const today = new Date().toISOString().slice(0, 10);
  allowedTypes.forEach((type, idx) => {
    sheet.addRow({
      harvestDate: today,
      flowerType: FLOWER_TYPE_LABELS[type],
      variety: (varietyCatalog[type] ?? [])[0] ?? "",
      grade: getGradesFor(type)[0] ?? "",
      quantity: 500 - idx * 100,
      location: `Холодильник ${idx + 1}`,
    });
  });

  // Списки для выпадающих меню держим на отдельном листе: инлайновый список
  // в Excel ограничен 255 символами, а сортов у хозяйства заметно больше.
  const lists = workbook.addWorksheet("Списки");
  lists.columns = [
    { header: "Типы", width: 18 },
    { header: "Сорта", width: 24 },
    { header: "Длины / категории", width: 22 },
  ];
  lists.getRow(1).font = { bold: true };

  const allTypes = allowedTypes.map((t) => FLOWER_TYPE_LABELS[t]);
  const allVarieties = Array.from(
    new Set(allowedTypes.flatMap((t) => varietyCatalog[t] ?? []))
  );
  const allGrades = Array.from(new Set(allowedTypes.flatMap((t) => getGradesFor(t))));

  const maxRows = Math.max(allTypes.length, allVarieties.length, allGrades.length);
  for (let i = 0; i < maxRows; i++) {
    lists.addRow([allTypes[i] ?? "", allVarieties[i] ?? "", allGrades[i] ?? ""]);
  }

  const lastFormRow = 500;
  for (let r = 2; r <= lastFormRow; r++) {
    sheet.getCell(`B${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`Списки!$A$2:$A$${allTypes.length + 1}`],
    };
    if (allVarieties.length > 0) {
      sheet.getCell(`C${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`Списки!$B$2:$B$${allVarieties.length + 1}`],
      };
    }
    sheet.getCell(`D${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [`Списки!$C$2:$C$${allGrades.length + 1}`],
    };
  }

  const notes = workbook.addWorksheet("Как заполнять");
  notes.columns = [{ width: 110 }];
  const lines = [
    farm ? `Как заполнять файл приёмки — ${farmLabel(farm)}` : "Как заполнять файл приёмки",
    "",
    ...(farm
      ? [
          `В этом шаблоне только цветок производства «${farmLabel(farm)}»: ` +
            `${allTypes.join(", ")}. Другой цветок система при загрузке не примет.`,
          "",
        ]
      : []),
    "1. Одна строка — одна партия (один сорт одной длины/категории, собранный в один день).",
    "2. «Дата сбора» — день срезки. От неё считается срок хранения, поэтому это важное поле.",
    `3. «Тип цветка» — ${allTypes.map((t) => `«${t}»`).join(" или ")}.`,
    "4. «Количество, шт» — целое число стеблей.",
    "5. «Место хранения» — необязательно (например, «Холодильник 1»).",
    "",
    "Длины и категории:",
    ...allowedTypes.map((t) => `   ${FLOWER_TYPE_LABELS[t]}: ${getGradesFor(t).join(", ")}.`),
    "",
    "Сорта:",
    ...allowedTypes.map(
      (t) => `   ${FLOWER_TYPE_LABELS[t]}: ${(varietyCatalog[t] ?? []).join(", ")}.`
    ),
    "",
    "Строки-примеры на первом листе можно удалить или заменить своими данными.",
    "Порядок колонок менять можно — система ориентируется на названия заголовков.",
    "Новый сорт добавляется на вкладке Varieties в самой Google-таблице CRM.",
  ];
  lines.forEach((line) => notes.addRow([line]));
  notes.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ---------------------------------------------------------------------------
// Отчёт бухгалтера: сводка за период, разбивки и полный список заявок с
// отметками об оплате, плюс отдельный лист по долгам.
// ---------------------------------------------------------------------------

export async function buildFinanceReportWorkbook(snapshot: {
  period: string;
  periodLabel: string;
  from: string;
  to: string;
  totals: {
    amount: number;
    paidAmount: number;
    unpaidAmount: number;
    orders: number;
    paidOrders: number;
    collectPercent: number;
    avgOrder: number;
  };
  byMethod: { method: string; amount: number; orders: number }[];
  byManager: { managerName: string; amount: number; paidAmount: number; orders: number }[];
  orders: {
    createdDate: string;
    deliveryDate: string;
    clientName: string;
    clientPhone: string;
    managerName: string;
    amount: number;
    stems: number;
    managerConfirmed: boolean;
    paid: boolean;
    paymentMethod: string;
    positions: string;
  }[];
  debts: {
    clientName: string;
    clientPhone: string;
    managerName: string;
    orders: number;
    amount: number;
    oldestDays: number;
    overdue: boolean;
  }[];
  debtTotal: number;
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ecoculture-CRM";

  const HEADER_FILL = "FFF1F3EF";
  const MONEY = '# ##0" ₸"';
  const periodTitle =
    snapshot.period === "day" ? "День" : snapshot.period === "week" ? "Неделя" : "Месяц";

  const styleHeader = (row: ExcelJS.Row) => {
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.border = { bottom: { style: "thin" } };
    });
  };

  // ---------- Лист 1: сводка ----------
  const summary = workbook.addWorksheet("Сводка", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  summary.columns = [{ width: 34 }, { width: 20 }, { width: 14 }, { width: 14 }];

  summary.addRow([`ОТЧЁТ ПО ОПЛАТАМ — ${periodTitle}`]).font = { bold: true, size: 14 };
  summary.addRow([snapshot.periodLabel]).font = { color: { argb: "FF666666" } };
  summary.addRow([`Период: ${snapshot.from} — ${snapshot.to}`]).font = { color: { argb: "FF666666" } };
  summary.addRow([]);

  const t = snapshot.totals;
  const facts: [string, number | string][] = [
    ["Оформлено заявок", t.orders],
    ["Сумма заявок", t.amount],
    ["Оплачено", t.paidAmount],
    ["Ждём оплату", t.unpaidAmount],
    ["Оплаченных заявок", t.paidOrders],
    ["Собираемость", `${t.collectPercent.toFixed(0)}%`],
    ["Средний чек", t.avgOrder],
    ["Долг по всей базе", snapshot.debtTotal],
  ];
  for (const [label, value] of facts) {
    const row = summary.addRow([label, value]);
    if (typeof value === "number" && label !== "Оформлено заявок" && label !== "Оплаченных заявок") {
      row.getCell(2).numFmt = MONEY;
    }
    row.getCell(1).font = { bold: true };
  }

  if (snapshot.byMethod.length > 0) {
    summary.addRow([]);
    summary.addRow(["ПО СПОСОБАМ ОПЛАТЫ"]).font = { bold: true, size: 12 };
    styleHeader(summary.addRow(["Способ", "Сумма", "Заявок"]));
    for (const m of snapshot.byMethod) {
      const row = summary.addRow([m.method, m.amount, m.orders]);
      row.getCell(2).numFmt = MONEY;
    }
  }

  if (snapshot.byManager.length > 0) {
    summary.addRow([]);
    summary.addRow(["ПО МЕНЕДЖЕРАМ"]).font = { bold: true, size: 12 };
    styleHeader(summary.addRow(["Менеджер", "Оформлено", "Оплачено", "Заявок"]));
    for (const m of snapshot.byManager) {
      const row = summary.addRow([m.managerName, m.amount, m.paidAmount, m.orders]);
      row.getCell(2).numFmt = MONEY;
      row.getCell(3).numFmt = MONEY;
    }
  }

  // ---------- Лист 2: заявки ----------
  const orders = workbook.addWorksheet("Заявки", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  orders.columns = [
    { width: 12 },
    { width: 12 },
    { width: 24 },
    { width: 16 },
    { width: 18 },
    { width: 14 },
    { width: 10 },
    { width: 12 },
    { width: 12 },
    { width: 16 },
    { width: 40 },
  ];
  styleHeader(
    orders.addRow([
      "Оформлена",
      "Доставка",
      "Клиент",
      "Телефон",
      "Менеджер",
      "Сумма",
      "Шт.",
      "Подтв.",
      "Оплачено",
      "Способ",
      "Состав",
    ])
  );
  for (const o of snapshot.orders) {
    const row = orders.addRow([
      o.createdDate,
      o.deliveryDate || "—",
      o.clientName,
      o.clientPhone,
      o.managerName,
      o.amount,
      o.stems,
      o.managerConfirmed ? "да" : "нет",
      o.paid ? "да" : "нет",
      o.paymentMethod || "—",
      o.positions,
    ]);
    row.getCell(6).numFmt = MONEY;
    if (!o.paid) {
      row.getCell(9).font = { bold: true, color: { argb: "FFC00000" } };
    }
  }
  orders.addRow([]);
  const totalRow = orders.addRow(["", "", "ИТОГО", "", "", snapshot.totals.amount]);
  totalRow.font = { bold: true };
  totalRow.getCell(6).numFmt = MONEY;

  // ---------- Лист 3: долги ----------
  const debts = workbook.addWorksheet("Долги", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  debts.columns = [{ width: 28 }, { width: 18 }, { width: 20 }, { width: 10 }, { width: 16 }, { width: 12 }];
  styleHeader(debts.addRow(["Клиент", "Телефон", "Менеджер", "Заявок", "Сумма", "Дней"]));
  for (const d of snapshot.debts) {
    const row = debts.addRow([d.clientName, d.clientPhone || "—", d.managerName, d.orders, d.amount, d.oldestDays]);
    row.getCell(5).numFmt = MONEY;
    if (d.overdue) {
      row.getCell(6).font = { bold: true, color: { argb: "FFC00000" } };
    }
  }
  debts.addRow([]);
  const debtTotalRow = debts.addRow(["ИТОГО ДОЛГ", "", "", "", snapshot.debtTotal]);
  debtTotalRow.font = { bold: true };
  debtTotalRow.getCell(5).numFmt = MONEY;

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ---------------------------------------------------------------------------
// Выгрузка сводной заявки склада на день в .xlsx — тот же документ, что и на
// печать, но в файле: можно отправить в мессенджер или сохранить в архив.
// ---------------------------------------------------------------------------

export async function buildPicklistWorkbook(picklist: {
  date: string;
  dateLabel: string;
  farm: string | null;
  totalOrders: number;
  totalStems: number;
  shortageStems: number;
  lines: {
    flowerType: string;
    variety: string;
    grade: string;
    quantity: number;
    shipped: number;
    available: number;
    perOrder: { clientName: string; quantity: number }[];
  }[];
  orders: {
    orderId: string;
    clientName: string;
    clientPhone: string;
    managerName: string;
    notes: string;
    totalStems: number;
    items: { flowerType: string; variety: string; grade: string; quantity: number; shipped: number }[];
  }[];
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ecoculture-CRM";

  const formatGradeCell = (grade: string) => (/^\d+$/.test(grade) ? `${grade} см` : grade);
  const HEADER_FILL = "FFF1F3EF";

  // ---------- Лист 1: что собрать, по типам цветка ----------
  const collect = workbook.addWorksheet("Собрать", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  collect.columns = [
    { width: 6 },
    { width: 24 },
    { width: 16 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 42 },
  ];

  collect.mergeCells("A1:G1");
  collect.getCell("A1").value = picklist.farm
    ? `ЗАЯВКА НА СБОРКУ — ${farmLabel(picklist.farm).toUpperCase()}`
    : "ЗАЯВКА НА СБОРКУ";
  collect.getCell("A1").font = { bold: true, size: 14 };
  collect.mergeCells("A2:G2");
  collect.getCell("A2").value = `Дата доставки: ${picklist.dateLabel}`;
  collect.mergeCells("A3:G3");
  collect.getCell("A3").value =
    `Заявок: ${picklist.totalOrders} · всего ${picklist.totalStems} шт.` +
    (picklist.shortageStems > 0 ? ` · не хватает на складе ${picklist.shortageStems} шт.` : "");
  collect.getCell("A3").font = { color: { argb: "FF666666" } };

  const typeOrder = ["rose", "chrysanthemum", "eustoma"];
  for (const type of typeOrder) {
    const lines = picklist.lines.filter((l) => l.flowerType === type);
    if (lines.length === 0) continue;

    collect.addRow([]);
    const typeTotal = lines.reduce((sum, l) => sum + Math.max(0, l.quantity - l.shipped), 0);
    const titleRow = collect.addRow([
      (FLOWER_TYPE_LABELS_PLURAL[type] ?? type).toUpperCase(),
      "",
      "",
      "",
      "",
      `${typeTotal} шт.`,
    ]);
    titleRow.font = { bold: true, size: 12 };

    const headerRow = collect.addRow(["№", "Сорт", "Длина / кат.", "Нужно", "На складе", "Собрано", "Кому"]);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
      cell.border = { bottom: { style: "thin" } };
    });

    lines.forEach((line, idx) => {
      const need = Math.max(0, line.quantity - line.shipped);
      const shortage = Math.max(0, need - line.available);
      const row = collect.addRow([
        idx + 1,
        line.variety,
        formatGradeCell(line.grade),
        need,
        line.available,
        "",
        line.perOrder.map((p) => `${p.clientName} ${p.quantity}`).join(" · "),
      ]);
      row.getCell(4).font = { bold: true };
      row.getCell(6).border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
      if (shortage > 0) {
        row.getCell(5).value = `${line.available} (не хватает ${shortage})`;
        row.getCell(5).font = { bold: true, color: { argb: "FFC00000" } };
      }
    });
  }

  collect.addRow([]);
  const totalRow = collect.addRow(["", "ИТОГО К СБОРКЕ", "", picklist.totalStems]);
  totalRow.font = { bold: true, size: 12 };

  // ---------- Лист 2: раскладка по клиентам ----------
  const byOrder = workbook.addWorksheet("По клиентам", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  byOrder.columns = [
    { width: 26 },
    { width: 18 },
    { width: 16 },
    { width: 26 },
    { width: 16 },
    { width: 10 },
  ];
  const orderHeader = byOrder.addRow(["Клиент", "Телефон", "Менеджер", "Сорт", "Длина / кат.", "Кол-во"]);
  orderHeader.font = { bold: true };
  orderHeader.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = { bottom: { style: "thin" } };
  });

  for (const order of picklist.orders) {
    order.items.forEach((item, idx) => {
      byOrder.addRow([
        idx === 0 ? order.clientName : "",
        idx === 0 ? order.clientPhone : "",
        idx === 0 ? order.managerName : "",
        `${FLOWER_TYPE_LABELS[item.flowerType] ?? item.flowerType} ${item.variety}`,
        formatGradeCell(item.grade),
        item.quantity - item.shipped,
      ]);
    });
    const totals = byOrder.addRow(["", "", "", "Итого по клиенту", "", order.totalStems]);
    totals.font = { bold: true };
    if (order.notes) {
      const noteRow = byOrder.addRow([`Внимание: ${order.notes}`]);
      noteRow.font = { italic: true, color: { argb: "FF666666" } };
    }
    byOrder.addRow([]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ---------------------------------------------------------------------------
// Прогноз срезки агронома: загрузка из Excel и шаблон.
//
// Файл состоит из ДВУХ таблиц на каждый цветок, и это отражает то, как агроном
// на самом деле думает:
//
//   «Сорта»   — строки: сорта, колонки: недели, в ячейках количество к срезу.
//   «Ростовка» — строки: длины (у хризантемы категории), колонки: недели,
//                в ячейках количество — НА ВЕСЬ ЦВЕТОК, а не по сортам.
//
// Почему ростовка отдельно, а не колонками у каждого сорта: агроном знает
// урожайность сорта и знает ростовку по теплице в целом, но не знает ростовку
// каждого сорта в отдельности. Требовать её — значит получать выдуманные цифры.
//
// Неделя — это колонка («Неделя 1»…«Неделя 5»), номер недели месяца. Месяц
// выбирается на странице, в файле его нет: иначе агроном, копируя прошлый файл,
// регулярно затирал бы не тот месяц.
// ---------------------------------------------------------------------------

export interface ParsedVarietyRow {
  sheet: string;
  rowNumber: number;
  flowerType: FlowerType;
  variety: string;
  week: string;
  stems: number;
  error?: string;
}

export interface ParsedMixRow {
  sheet: string;
  rowNumber: number;
  flowerType: FlowerType;
  grade: string;
  week: string;
  stems: number;
  error?: string;
}

export interface ForecastParseResult {
  varieties: ParsedVarietyRow[];
  mix: ParsedMixRow[];
  validCount: number;
  errorCount: number;
  fatalError?: string;
}

const VARIETY_HEADERS = ["сорт", "сорта", "variety"];
const MIX_HEADERS = [
  "длина",
  "длина / категория",
  "длина/категория",
  "категория",
  "ростовка",
  "grade",
];

/** «Неделя 3» → 3. Понимает «Нед. 3», «Неделя3», «3». */
function weekNumberFromHeader(header: string): number | null {
  const cleaned = header.trim().toLowerCase();
  if (!cleaned) return null;
  const match = /^(?:нед(?:еля|\.)?\s*|week\s*)?(\d{1,2})$/.exec(cleaned);
  if (!match) return null;
  const n = Number(match[1]);
  return n >= 1 && n <= 6 ? n : null;
}

/** Тип цветка по названию листа: «Розы — сорта», «Хризантемы (ростовка)». */
function flowerTypeFromSheetName(name: string): FlowerType | null {
  const value = name.trim().toLowerCase();
  if (value.startsWith("роз")) return FLOWER_TYPES.ROSE;
  if (value.startsWith("хриз")) return FLOWER_TYPES.CHRYSANTHEMUM;
  if (value.startsWith("эустом") || value.startsWith("евстом")) return FLOWER_TYPES.EUSTOMA;
  return null;
}

export async function parseForecastWorkbook(
  buffer: ArrayBuffer,
  varietyCatalog: Record<string, string[]> = {},
  /** Типы цветка, которые агроному разрешено планировать. */
  allowedTypes: string[] = [],
  /** Месяц («2026-09») — из него собираются коды недель. */
  month = ""
): Promise<ForecastParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    return {
      varieties: [],
      mix: [],
      validCount: 0,
      errorCount: 0,
      fatalError: "Не удалось прочитать файл. Нужен файл Excel в формате .xlsx.",
    };
  }

  const weeks = month ? weeksOfMonth(month) : [];
  const varieties: ParsedVarietyRow[] = [];
  const mix: ParsedMixRow[] = [];
  let sawAnyTable = false;

  for (const sheet of workbook.worksheets) {
    if (normalizeHeader(sheet.name).startsWith("как заполнять")) continue;

    const sheetType = flowerTypeFromSheetName(sheet.name);

    // Ищем шапку: первая колонка — «Сорт» или «Длина», дальше колонки-недели.
    let headerRow = 0;
    let firstCol = 0;
    let kind: "variety" | "mix" | null = null;
    const weekCols: { col: number; index: number }[] = [];

    for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      let foundFirst = 0;
      let foundKind: "variety" | "mix" | null = null;
      const cols: { col: number; index: number }[] = [];

      row.eachCell((cell, colNumber) => {
        const header = normalizeHeader(cellText(cell));
        if (!header) return;
        if (!foundKind && VARIETY_HEADERS.includes(header)) {
          foundKind = "variety";
          foundFirst = colNumber;
          return;
        }
        if (!foundKind && MIX_HEADERS.includes(header)) {
          foundKind = "mix";
          foundFirst = colNumber;
          return;
        }
        const weekIndex = weekNumberFromHeader(header);
        if (weekIndex) cols.push({ col: colNumber, index: weekIndex });
      });

      if (foundKind && cols.length > 0) {
        headerRow = r;
        firstCol = foundFirst;
        kind = foundKind;
        weekCols.push(...cols);
        break;
      }
    }

    if (!headerRow || !kind) continue;
    sawAnyTable = true;

    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const label = cellText(row.getCell(firstCol));
      const anyValue = weekCols.some(({ col }) => cellText(row.getCell(col)));
      if (!label && !anyValue) continue;

      for (const { col, index } of weekCols) {
        const raw = cellText(row.getCell(col));
        // Пустая ячейка — «ничего не жду», её пропускаем: иначе один сорт давал
        // бы пять строк, из которых четыре пустые.
        if (!raw) continue;

        const errors: string[] = [];

        const week = weeks.find((w) => w.index === index);
        if (!week) {
          errors.push(`недели ${index} в этом месяце нет (есть 1…${weeks.length})`);
        }

        if (!sheetType) {
          errors.push(
            "не понял тип цветка: назовите лист «Розы», «Хризантемы» или «Эустома»"
          );
        } else if (allowedTypes.length > 0 && !allowedTypes.includes(sheetType)) {
          errors.push(
            `${FLOWER_TYPE_LABELS[sheetType]} — не ваше производство ` +
              `(${farmLabel(getFarmFor(sheetType))}), эту строку загрузить нельзя`
          );
        }

        const stems = Number(raw.replace(/\s/g, "").replace(",", "."));
        if (Number.isNaN(stems) || stems < 0) {
          errors.push(`количество «${raw}» — не число (ноль допустим, минус нет)`);
        }

        const common = {
          sheet: sheet.name,
          rowNumber: r,
          flowerType: sheetType ?? FLOWER_TYPES.ROSE,
          week: week?.code ?? "",
          stems: Number.isNaN(stems) ? 0 : Math.round(stems),
        };

        if (kind === "variety") {
          let variety = label;
          if (!label) errors.push("не указан сорт");
          else if (sheetType) {
            const known = varietyCatalog[sheetType] ?? [];
            if (known.length > 0) {
              const match = known.find(
                (v) => v.toLowerCase() === label.trim().replace(/\s+/g, " ").toLowerCase()
              );
              if (match) variety = match;
              else {
                errors.push(
                  `сорт «${label}» не найден в справочнике. ` +
                    "Новый сорт добавляется на вкладке Varieties в таблице"
                );
              }
            }
          }
          varieties.push({
            ...common,
            variety,
            error: errors.length > 0 ? errors.join("; ") : undefined,
          });
        } else {
          let grade = "";
          if (!label) errors.push("не указана длина/категория");
          else if (sheetType) {
            const normalized = normalizeGrade(label, sheetType);
            if (!normalized) {
              errors.push(
                `${GRADE_LABELS[sheetType].toLowerCase()} «${label}» не из списка ` +
                  `(допустимо: ${getGradesFor(sheetType).join(", ")})`
              );
            } else {
              grade = normalized;
            }
          }
          mix.push({
            ...common,
            grade,
            error: errors.length > 0 ? errors.join("; ") : undefined,
          });
        }
      }
    }
  }

  if (!sawAnyTable) {
    return {
      varieties: [],
      mix: [],
      validCount: 0,
      errorCount: 0,
      fatalError:
        "Не нашёл таблицу с данными. Нужна первая колонка «Сорт» (или «Длина») и колонки " +
        "«Неделя 1», «Неделя 2»… — проще всего скачать шаблон и заполнить его.",
    };
  }

  const all = [...varieties, ...mix];
  return {
    varieties,
    mix,
    validCount: all.filter((r) => !r.error).length,
    errorCount: all.filter((r) => r.error).length,
  };
}

/**
 * Шаблон прогноза: на каждый цветок два листа — «сорта» и «ростовка».
 * Строки — сорта (или длины), колонки — недели месяца, в ячейках количество.
 */
export async function buildForecastTemplate(
  varietyCatalog: Record<string, string[]> = {},
  farm: string | null,
  month: string
): Promise<Buffer> {
  const allowedTypes = (farm
    ? flowerTypesForFarm(farm)
    : [FLOWER_TYPES.ROSE, FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.EUSTOMA]) as FlowerType[];

  const weeks = weeksOfMonth(month);
  const weekColumns = weeks.map((w) => ({
    header: `Неделя ${w.index}`,
    key: `w${w.index}`,
    width: 12,
  }));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ecoculture-CRM";

  for (const type of allowedTypes) {
    const plural = FLOWER_TYPE_LABELS_PLURAL[type] ?? FLOWER_TYPE_LABELS[type];

    const bySort = workbook.addWorksheet(`${plural} — сорта`);
    bySort.columns = [{ header: "Сорт", key: "label", width: 26 }, ...weekColumns];
    bySort.getRow(1).font = { bold: true };
    bySort.getRow(1).alignment = { horizontal: "center", vertical: "middle" };
    bySort.getColumn(1).alignment = { horizontal: "left" };
    bySort.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
    for (const variety of varietyCatalog[type] ?? []) bySort.addRow({ label: variety });

    const byMix = workbook.addWorksheet(`${plural} — ростовка`);
    byMix.columns = [
      { header: GRADE_LABELS[type] ?? "Длина", key: "label", width: 26 },
      ...weekColumns,
    ];
    byMix.getRow(1).font = { bold: true };
    byMix.getRow(1).alignment = { horizontal: "center", vertical: "middle" };
    byMix.getColumn(1).alignment = { horizontal: "left" };
    byMix.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
    for (const grade of getGradesFor(type)) byMix.addRow({ label: formatGrade(grade) });
  }

  const notes = workbook.addWorksheet("Как заполнять");
  notes.columns = [{ width: 110 }];
  const lines = [
    `Прогноз срезки на ${periodLabel(month)}${farm ? ` — ${farmLabel(farm)}` : ""}`,
    "",
    "На каждый цветок два листа.",
    "",
    "Лист «сорта»: строки — сорта, колонки — недели, в ячейках количество стеблей",
    "к срезу. Это ответ на вопрос «сколько даст каждый сорт».",
    "",
    "Лист «ростовка»: строки — длины (у хризантемы категории), колонки — недели.",
    "Это ответ на вопрос «какая ростовка получится по цветку в целом» — цифры на",
    "весь цветок, а не по каждому сорту.",
    "",
    "Суммы двух листов за неделю должны примерно совпадать: и там и там это один",
    "и тот же урожай, посчитанный с разных сторон. Система покажет расхождение,",
    "но загрузить даст в любом случае — прогноз есть прогноз.",
    "",
    "Недели этого месяца:",
    ...weeks.map((w) => `      Неделя ${w.index} — ${w.label} (${w.days} дн.)`),
    "",
    "Заполняйте только те ячейки, где ждёте срезку. Пустые пропускаются.",
    "Ноль означает «этой позиции не будет»: так убирается то, что вносили раньше.",
    "Порядок колонок менять можно — система смотрит на заголовки.",
    "",
    "Что считается высшей категорией выхода:",
    ...allowedTypes.map((t) => `   ${FLOWER_TYPE_LABELS[t]}: ${topGradeHint(t)}.`),
    "",
    "Новый сорт добавляется на вкладке Varieties в самой Google-таблице CRM.",
  ];
  lines.forEach((line) => notes.addRow([line]));
  notes.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ---------------------------------------------------------------------------
// План отгрузок РОПа: файл «направления × недели» на каждый цветок.
//
// Сделан по образцу прогноза срезки — сознательно: в хозяйстве уже привыкли,
// что план заполняется таблицей, где строки это позиции, а колонки недели.
// Второй непохожий формат означал бы второе обучение.
// ---------------------------------------------------------------------------

export interface ParsedShipmentPlanRow {
  week: string;
  weekIndex: number;
  flowerType: string;
  direction: string;
  stems: number;
  error?: string;
}

export interface ShipmentPlanParseResult {
  rows: ParsedShipmentPlanRow[];
  validCount: number;
  errorCount: number;
  fatalError?: string;
}

const DIRECTION_HEADERS = ["направление", "направления", "direction"];

/** «Астана » или «астана» — то же направление. */
function matchDirection(raw: string): string | null {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return null;
  return SHIPMENT_DIRECTIONS.find((d) => d.trim().toLowerCase() === cleaned) ?? null;
}

export async function parseShipmentPlanWorkbook(
  buffer: ArrayBuffer,
  /** Месяц («2026-09») — из него собираются коды недель. */
  month = ""
): Promise<ShipmentPlanParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    return {
      rows: [],
      validCount: 0,
      errorCount: 0,
      fatalError: "Не удалось прочитать файл. Нужен файл Excel в формате .xlsx.",
    };
  }

  const weeks = month ? weeksOfMonth(month) : [];
  const rows: ParsedShipmentPlanRow[] = [];
  let sawAnyTable = false;

  for (const sheet of workbook.worksheets) {
    if (normalizeHeader(sheet.name).startsWith("как заполнять")) continue;

    const sheetType = flowerTypeFromSheetName(sheet.name);

    let headerRow = 0;
    let firstCol = 0;
    const weekCols: { col: number; index: number }[] = [];

    for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      let foundFirst = 0;
      const cols: { col: number; index: number }[] = [];

      row.eachCell((cell, colNumber) => {
        const header = normalizeHeader(cellText(cell));
        if (!header) return;
        if (!foundFirst && DIRECTION_HEADERS.includes(header)) {
          foundFirst = colNumber;
          return;
        }
        const weekIndex = weekNumberFromHeader(header);
        if (weekIndex) cols.push({ col: colNumber, index: weekIndex });
      });

      if (foundFirst && cols.length > 0) {
        headerRow = r;
        firstCol = foundFirst;
        weekCols.push(...cols);
        break;
      }
    }

    if (!headerRow) continue;
    sawAnyTable = true;

    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const label = cellText(row.getCell(firstCol));
      if (!label.trim()) continue;
      // Строки-заголовки блоков («РЕГИОНЫ КАЗАХСТАНА») просто пропускаем.
      const direction = matchDirection(label);

      for (const { col, index } of weekCols) {
        const raw = cellText(row.getCell(col));
        if (!raw.trim()) continue;
        const parsed = Number(raw.replace(/\s/g, "").replace(",", "."));
        const stems = Number.isNaN(parsed) || parsed < 0 ? null : Math.round(parsed);
        const week = weeks.find((w) => w.index === index);

        if (!direction) {
          // Неизвестная строка с цифрами — это ошибка, а не заголовок блока.
          rows.push({
            week: week?.code ?? "",
            weekIndex: index,
            flowerType: sheetType ?? "",
            direction: label.trim(),
            stems: 0,
            error: `Направление «${label.trim()}» не из списка`,
          });
          continue;
        }
        if (!sheetType) {
          rows.push({
            week: week?.code ?? "",
            weekIndex: index,
            flowerType: "",
            direction,
            stems: 0,
            error: `Не понял, какой цветок на листе «${sheet.name}»`,
          });
          continue;
        }
        if (!week) {
          rows.push({
            week: "",
            weekIndex: index,
            flowerType: sheetType,
            direction,
            stems: 0,
            error: `В этом месяце нет недели ${index}`,
          });
          continue;
        }
        if (stems === null) {
          rows.push({
            week: week.code,
            weekIndex: index,
            flowerType: sheetType,
            direction,
            stems: 0,
            error: `«${raw}» — не количество`,
          });
          continue;
        }
        rows.push({
          week: week.code,
          weekIndex: index,
          flowerType: sheetType,
          direction,
          stems,
        });
      }
    }
  }

  if (!sawAnyTable) {
    return {
      rows: [],
      validCount: 0,
      errorCount: 0,
      fatalError:
        "В файле не нашлось таблицы плана. Нужна колонка «Направление» и колонки «Неделя 1», «Неделя 2» и так далее — проще всего скачать шаблон.",
    };
  }

  return {
    rows,
    validCount: rows.filter((r) => !r.error).length,
    errorCount: rows.filter((r) => r.error).length,
  };
}

export async function buildShipmentPlanTemplate(month: string): Promise<Buffer> {
  const weeks = weeksOfMonth(month);
  const weekColumns = weeks.map((w) => ({
    header: `Неделя ${w.index}`,
    key: `w${w.index}`,
    width: 12,
  }));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ecoculture-CRM";

  const types = [FLOWER_TYPES.ROSE, FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.EUSTOMA];
  for (const type of types) {
    const plural = FLOWER_TYPE_LABELS_PLURAL[type] ?? FLOWER_TYPE_LABELS[type];
    const sheet = workbook.addWorksheet(plural);
    sheet.columns = [{ header: "Направление", key: "label", width: 28 }, ...weekColumns];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getColumn(1).alignment = { horizontal: "left" };
    sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];

    for (const group of DIRECTION_GROUPS) {
      const head = sheet.addRow({ label: group.label.toUpperCase() });
      head.font = { bold: true };
      for (const direction of group.directions) sheet.addRow({ label: direction });
    }
  }

  const notes = workbook.addWorksheet("Как заполнять");
  notes.columns = [{ width: 110 }];
  const lines = [
    `План отгрузок на ${periodLabel(month)}`,
    "",
    "На каждый цветок свой лист: строки — направления, колонки — недели месяца,",
    "в ячейках количество стеблей.",
    "",
    "Недели этого месяца:",
    ...weeks.map((w) => `      Неделя ${w.index} — ${w.label} (${w.days} дн.)`),
    "",
    "Суммы вводить не нужно: система посчитает их сама по цене из прайс-листа,",
    "а поправить цену можно прямо на странице плана.",
    "",
    "Заполняйте только те ячейки, куда собираетесь отгружать. Пустые пропускаются.",
    "Ноль означает «в это направление на этой неделе не везём» — так убирается то,",
    "что вносили раньше.",
    "",
    "Строки с названиями блоков («РЕГИОНЫ КАЗАХСТАНА») трогать не нужно, они для",
    "удобства. Порядок колонок менять можно — система смотрит на заголовки.",
    "",
    "Новое направление в файле не появится: список закрытый, иначе за месяц",
    "набегает «Астана», «астана» и «Астана » тремя разными строками.",
  ];
  lines.forEach((line) => notes.addRow([line]));
  notes.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}


// ---------------------------------------------------------------------------
// Прайс-лист файлом.
//
// Прайс ведёт РОП, и вести его через веб-таблицу из трёхсот ячеек — работа на
// полдня. Поэтому тот же приём, что у агронома с прогнозом: скачал файл,
// поправил в Excel, загрузил обратно. Шаблон выгружается УЖЕ ЗАПОЛНЕННЫМ
// действующими ценами — правят обычно две-три строки, а не весь прайс заново.
//
// Пустая ячейка означает «цену не трогаем», а не ноль: иначе загрузка файла, где
// человек заполнил один цветок, стёрла бы цены на два остальных. Ноль пишется
// отдельно и означает «цены нет» (см. priceList.ts).
// ---------------------------------------------------------------------------

export interface ParsedPriceRow {
  sheet: string;
  rowNumber: number;
  flowerType: string;
  /** Пустая строка — цена «на все сорта» этого цветка. */
  variety: string;
  grade: string;
  price: number;
  /** Прежняя цена, если она была: показываем в предпросмотре «было → стало». */
  wasPrice: number | null;
  error?: string;
}

export interface PriceParseResult {
  rows: ParsedPriceRow[];
  validCount: number;
  errorCount: number;
  /** Сколько строк файла совпали с действующей ценой — их писать незачем. */
  sameCount: number;
  fatalError?: string;
}

/** Подписи первой колонки, которые понимает разбор прайса. */
const PRICE_LABEL_HEADERS = [...VARIETY_HEADERS, "позиция", "название"];

function isBaseVarietyLabel(raw: string): boolean {
  const cleaned = raw.trim().toLowerCase().replace(/ё/g, "е");
  return cleaned === BASE_VARIETY_LABEL.toLowerCase() || cleaned === "все" || cleaned === "общая";
}

export async function parsePriceWorkbook(
  buffer: ArrayBuffer,
  /** Справочник сортов: цена не должна повиснуть на сорте, которого нет. */
  varietyCatalog: Record<string, string[]> = {},
  /** Действующие цены «цветок|сорт|градация» → цена: чтобы не писать то же самое. */
  current: Record<string, number> = {}
): Promise<PriceParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    return {
      rows: [],
      validCount: 0,
      errorCount: 0,
      sameCount: 0,
      fatalError: "Не удалось прочитать файл. Нужен файл Excel в формате .xlsx.",
    };
  }

  const rows: ParsedPriceRow[] = [];
  let sameCount = 0;
  let sawAnyTable = false;

  for (const sheet of workbook.worksheets) {
    if (normalizeHeader(sheet.name).startsWith("как заполнять")) continue;
    const flowerType = flowerTypeFromSheetName(sheet.name);

    // Ищем шапку: колонка с сортом плюс хотя бы одна колонка-градация.
    let headerRow = 0;
    let labelCol = 0;
    const gradeCols: { col: number; grade: string }[] = [];

    for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
      const row = sheet.getRow(r);
      let foundLabel = 0;
      const cols: { col: number; grade: string }[] = [];

      row.eachCell((cell, colNumber) => {
        const header = normalizeHeader(cellText(cell));
        if (!header) return;
        if (!foundLabel && PRICE_LABEL_HEADERS.includes(header)) {
          foundLabel = colNumber;
          return;
        }
        if (!flowerType) return;
        const grade = normalizeGrade(cellText(cell), flowerType);
        if (grade) cols.push({ col: colNumber, grade });
      });

      if (foundLabel && cols.length > 0) {
        headerRow = r;
        labelCol = foundLabel;
        gradeCols.push(...cols);
        break;
      }
    }

    if (!headerRow) continue;
    sawAnyTable = true;

    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const label = cellText(row.getCell(labelCol)).trim();
      if (!label) continue;

      const base = isBaseVarietyLabel(label);
      const variety = base ? BASE_VARIETY : label;
      const known =
        base || (varietyCatalog[flowerType ?? ""] ?? []).some((v) => v.trim() === variety);

      for (const { col, grade } of gradeCols) {
        const raw = cellText(row.getCell(col));
        // Пустая ячейка — «не трогаем». Именно пустая, а не ноль.
        if (!raw.trim()) continue;

        const parsed = Number(raw.replace(/\s/g, "").replace(",", "."));
        const wasKey = `${flowerType ?? ""}|${variety}|${grade}`;
        const was = Object.prototype.hasOwnProperty.call(current, wasKey) ? current[wasKey] : null;

        if (!flowerType) {
          rows.push({
            sheet: sheet.name,
            rowNumber: r,
            flowerType: "",
            variety,
            grade,
            price: 0,
            wasPrice: null,
            error: `Не понял, какой цветок на листе «${sheet.name}»`,
          });
          continue;
        }
        if (!known) {
          rows.push({
            sheet: sheet.name,
            rowNumber: r,
            flowerType,
            variety,
            grade,
            price: 0,
            wasPrice: null,
            error: `Сорт «${variety}» не найден в справочнике`,
          });
          continue;
        }
        if (Number.isNaN(parsed) || !Number.isFinite(parsed) || parsed < 0) {
          rows.push({
            sheet: sheet.name,
            rowNumber: r,
            flowerType,
            variety,
            grade,
            price: 0,
            wasPrice: was,
            error: `«${raw}» — не цена`,
          });
          continue;
        }

        const price = Math.round(parsed * 100) / 100;
        // Цена не изменилась — в загрузку не берём: иначе история цен за неделю
        // распухнет строками «было 250, стало 250».
        if (was !== null && was === price) {
          sameCount += 1;
          continue;
        }

        rows.push({
          sheet: sheet.name,
          rowNumber: r,
          flowerType,
          variety,
          grade,
          price,
          wasPrice: was,
        });
      }
    }
  }

  if (!sawAnyTable) {
    return {
      rows: [],
      validCount: 0,
      errorCount: 0,
      sameCount: 0,
      fatalError:
        "В файле не нашлось таблицы прайса. Нужна колонка «Сорт» и колонки с длинами или категориями — проще всего скачать шаблон: он выгружается уже с текущими ценами.",
    };
  }

  return {
    rows,
    validCount: rows.filter((r) => !r.error).length,
    errorCount: rows.filter((r) => r.error).length,
    sameCount,
  };
}

export async function buildPriceTemplate(
  varietyCatalog: Record<string, string[]> = {},
  /** Действующие цены «цветок|сорт|градация» → цена. Шаблон выгружается заполненным. */
  current: Record<string, number> = {}
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Ecoculture-CRM";

  const types = [FLOWER_TYPES.ROSE, FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.EUSTOMA];
  for (const type of types) {
    const grades = getGradesFor(type);
    const plural = FLOWER_TYPE_LABELS_PLURAL[type] ?? FLOWER_TYPE_LABELS[type];
    const sheet = workbook.addWorksheet(plural);
    sheet.columns = [
      { header: "Сорт", key: "label", width: 30 },
      ...grades.map((g) => ({ header: formatGrade(g), key: `g${g}`, width: 12 })),
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).alignment = { horizontal: "center", vertical: "middle" };
    sheet.getColumn(1).alignment = { horizontal: "left" };
    sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];

    const addPriceRow = (label: string, variety: string, bold: boolean) => {
      const values: Record<string, unknown> = { label };
      for (const grade of grades) {
        const price = current[`${type}|${variety}|${grade}`];
        if (price !== undefined && price > 0) values[`g${grade}`] = price;
      }
      const row = sheet.addRow(values);
      if (bold) row.font = { bold: true };
    };

    // Первая строка — та, ради которой всё и затевалось: цена по длине.
    addPriceRow(BASE_VARIETY_LABEL, BASE_VARIETY, true);
    for (const variety of varietyCatalog[type] ?? []) addPriceRow(variety, variety, false);
  }

  const notes = workbook.addWorksheet("Как заполнять");
  notes.columns = [{ width: 110 }];
  const lines = [
    "Прайс-лист: цена за один стебель, ₸",
    "",
    "На каждый цветок свой лист: строки — сорта, колонки — длина (у хризантемы категория).",
    "",
    `Строка «${BASE_VARIETY_LABEL}» — главная. Её одной достаточно, чтобы оценить весь цветок:`,
    "в хозяйстве цена почти всегда зависит от длины, а не от того, с какого куста стебель.",
    "Отдельную цену сорту ставьте только там, где он действительно дороже или дешевле.",
    "",
    "Файл выгружается уже с действующими ценами — правьте только то, что меняется.",
    "",
    "Пустая ячейка означает «цену не трогаем», она останется прежней.",
    "Ноль означает «цены нет»: позиция перестанет подставляться в заявку сама.",
    "",
    "Дата изменения запоминается сама: система хранит историю и показывает,",
    "когда и на сколько цена менялась, а в аналитике — насколько продажи",
    "отклоняются от заданной цены.",
    "",
    "Новых сортов файл не создаёт: сорта ведутся в справочнике. Незнакомая строка",
    "с ценами будет помечена ошибкой и не загрузится.",
  ];
  lines.forEach((line) => notes.addRow([line]));
  notes.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
