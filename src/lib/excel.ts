import ExcelJS from "exceljs";
import {
  FLOWER_TYPES,
  FLOWER_TYPE_LABELS,
  FLOWER_TYPE_LABELS_PLURAL,
  GRADE_LABELS,
  getGradesFor,
  farmLabel,
  flowerTypesForFarm,
  type FlowerType,
} from "./constants";

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
