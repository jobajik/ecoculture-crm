// Названия вкладок (листов) в Google-таблице и их заголовки.
// Порядок колонок здесь ДОЛЖЕН совпадать с порядком в самой таблице —
// используйте scripts/setup-sheet.ts, чтобы создать таблицу с нужной структурой.

export const SHEET_TABS = {
  USERS: "Users",
  ORDERS: "Orders",
  ORDER_ITEMS: "OrderItems",
  BATCHES: "Batches",
  SHIPMENTS: "Shipments",
  WRITEOFFS: "Writeoffs",
  PRICE_HISTORY: "PriceHistory",
  VARIETIES: "Varieties",
  PLANS: "Plans",
  SETTINGS: "Settings",
} as const;

export const SHEET_HEADERS: Record<string, string[]> = {
  // Farm стоит последней колонкой намеренно: так в уже работающей таблице
  // существующие строки не «съезжают» при добавлении производств.
  [SHEET_TABS.USERS]: ["Email", "Name", "Role", "Active", "Farm"],
  // Колонки оплаты стоят в конце — как и Farm, чтобы уже заполненные строки
  // не «съезжали» при добавлении (см. CLAUDE.md, раздел «Грабли»).
  [SHEET_TABS.ORDERS]: [
    "OrderID",
    "CreatedAt",
    "ManagerEmail",
    "ClientName",
    "ClientPhone",
    "DeliveryDate",
    "Status",
    "Notes",
    "ManagerConfirmed",
    "ManagerConfirmedAt",
    "Paid",
    "PaidAt",
    "PaymentMethod",
    "AccountantEmail",
  ],
  [SHEET_TABS.ORDER_ITEMS]: [
    "OrderID",
    "ItemID",
    "FlowerType",
    "Variety",
    "Grade",
    "Quantity",
    "UnitPrice",
    "ShippedQuantity",
  ],
  [SHEET_TABS.BATCHES]: [
    "BatchID",
    "ReceivedAt",
    "HarvestDate",
    "FlowerType",
    "Variety",
    "Grade",
    "QuantityIn",
    "QuantityRemaining",
    "Location",
    "ReceivedByEmail",
  ],
  [SHEET_TABS.SHIPMENTS]: [
    "ShipmentID",
    "CreatedAt",
    "OrderID",
    "ItemID",
    "BatchID",
    "Quantity",
    "WarehouseEmail",
    "Notes",
  ],
  [SHEET_TABS.WRITEOFFS]: [
    "WriteoffID",
    "CreatedAt",
    "BatchID",
    "Quantity",
    "Reason",
    "WarehouseEmail",
  ],
  [SHEET_TABS.PRICE_HISTORY]: ["Date", "FlowerType", "Variety", "Grade", "Price"],
  [SHEET_TABS.VARIETIES]: ["FlowerType", "Variety", "Active"],
  [SHEET_TABS.PLANS]: ["Period", "ManagerEmail", "TargetAmount", "TargetStems"],
  [SHEET_TABS.SETTINGS]: ["Key", "Value"],
};

export const ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
  WAREHOUSE: "warehouse",
  ACCOUNTANT: "accountant",
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  warehouse: "Зав. склад",
  accountant: "Бухгалтер",
};

// ---------------------------------------------------------------------------
// Готовность заявки к сборке — те самые «две зелёные галочки»:
// менеджер окончательно согласовал заявку с клиентом, бухгалтер увидел деньги.
// Склад собирает такие заявки в первую очередь; неоплаченные видны, но помечены.
// ---------------------------------------------------------------------------

/** Как принимают деньги. Список короткий намеренно — бухгалтеру меньше кликов. */
export const PAYMENT_METHODS = ["Каспи", "Наличные"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Через сколько дней после даты доставки долг считается просроченным. */
export const DEBT_OVERDUE_DAYS = 3;

// ---------------------------------------------------------------------------
// Бонусы менеджеров. Процент зависит от типа цветка и совпадает с делением по
// производствам: Rose Farm (роза, эустома) — 1,5 %, Есентай (хризантема) — 2 %.
//
// Бонус считается ТОЛЬКО с оплаченных заявок: пока бухгалтер не отметила деньги,
// бонуса нет. Так менеджер заинтересован довести оплату до конца.
// ---------------------------------------------------------------------------

export const BONUS_RATE_BY_FLOWER_TYPE: Record<string, number> = {
  rose: 0.015,
  eustoma: 0.015,
  chrysanthemum: 0.02,
};

export function bonusRateFor(flowerType: string): number {
  return BONUS_RATE_BY_FLOWER_TYPE[flowerType] ?? 0;
}

export const FLOWER_TYPES = {
  ROSE: "rose",
  CHRYSANTHEMUM: "chrysanthemum",
  EUSTOMA: "eustoma",
} as const;
export type FlowerType = (typeof FLOWER_TYPES)[keyof typeof FLOWER_TYPES];

// ---------------------------------------------------------------------------
// Производства (ТОО). Каждый тип цветка выращивает своё хозяйство, и у каждого
// хозяйства свой зав. складом: он видит, принимает и отгружает только свой цветок.
// ---------------------------------------------------------------------------

export const FARMS = {
  ROSE_FARM: "rose_farm",
  ESENTAI: "esentai",
} as const;
export type Farm = (typeof FARMS)[keyof typeof FARMS];

export const FARM_LABELS: Record<string, string> = {
  rose_farm: "Rose Farm",
  esentai: "Есентай Агро Хим",
};

/** Какому производству принадлежит тип цветка. */
export const FARM_BY_FLOWER_TYPE: Record<string, Farm> = {
  rose: FARMS.ROSE_FARM,
  eustoma: FARMS.ROSE_FARM,
  chrysanthemum: FARMS.ESENTAI,
};

/** Какие типы цветка выращивает производство (порядок важен для интерфейса). */
export const FLOWER_TYPES_BY_FARM: Record<string, string[]> = {
  rose_farm: ["rose", "eustoma"],
  esentai: ["chrysanthemum"],
};

export const FARM_ORDER: string[] = [FARMS.ROSE_FARM, FARMS.ESENTAI];

export function getFarmFor(flowerType: string): Farm | null {
  return FARM_BY_FLOWER_TYPE[flowerType] ?? null;
}

export function farmLabel(farm: string | null | undefined): string {
  if (!farm) return "Все производства";
  return FARM_LABELS[farm] ?? farm;
}

/**
 * Типы цветка, доступные пользователю: зав. складом видит только своё
 * производство, менеджеры и администратор — всё.
 */
export function flowerTypesForFarm(farm: string | null | undefined): string[] {
  if (!farm) return Object.keys(FARM_BY_FLOWER_TYPE);
  return FLOWER_TYPES_BY_FARM[farm] ?? [];
}

export const FLOWER_TYPE_LABELS: Record<string, string> = {
  rose: "Роза",
  chrysanthemum: "Хризантема",
  eustoma: "Эустома",
};

/** Множественная форма — для заголовков разделов («Розы», «Хризантемы»). */
export const FLOWER_TYPE_LABELS_PLURAL: Record<string, string> = {
  rose: "Розы",
  chrysanthemum: "Хризантемы",
  eustoma: "Эустома",
};

// ---------------------------------------------------------------------------
// Градации товара.
//
// У роз это длина стебля в сантиметрах (плюс отдельные позиции, которые по
// длине не меряются), у хризантем — категория качества. Значения хранятся в
// таблице как есть (строкой), поэтому список можно расширить, просто дописав
// сюда новый вариант — данные, записанные раньше, от этого не сломаются.
// ---------------------------------------------------------------------------

export const ROSE_GRADES = [
  "40",
  "50",
  "60",
  "70",
  "80",
  "90",
  "100",
  "Мини-микс",
  "Уценка",
  "B-quality",
] as const;

export const CHRYSANTHEMUM_GRADES = [
  "Высшая",
  "Первая",
  "Вторая",
  "Третья",
  "Четвёртая",
  "Мини-микс",
  "Уценка",
] as const;

export const EUSTOMA_GRADES = ["Стандарт", "50", "Мини-микс", "Уценка"] as const;

export const GRADES_BY_FLOWER_TYPE: Record<string, readonly string[]> = {
  rose: ROSE_GRADES,
  chrysanthemum: CHRYSANTHEMUM_GRADES,
  eustoma: EUSTOMA_GRADES,
};

// ---------------------------------------------------------------------------
// Сорта, которые выращивает хозяйство. Это значения по умолчанию: они попадают
// на вкладку Varieties при первом запуске setup-sheet, а дальше список ведётся
// прямо в Google-таблице — добавить новый сорт можно строкой в таблице, без
// изменения кода.
// ---------------------------------------------------------------------------

export const DEFAULT_VARIETIES: Record<string, string[]> = {
  rose: [
    "Prestige",
    "Red Naomi",
    "Avalanche",
    "Peach Avalanche",
    "Love Lydia",
    "Revival",
    "Anna Karina",
    "Whisky",
    "Odiliy",
    "Jana",
    "Kamala",
    "Candy Avalanche",
    "Jumilia",
    "Misty Bubbles",
    "Red Eagle",
    "Con Amore",
    "Julieta Spray",
    "Blanchette",
    "Mix",
  ],
  chrysanthemum: ["Altaj", "Ассортимент"],
  eustoma: ["Alissa White", "Alissa Pink", "Corelli Pink"],
};

/** Как называется поле градации в интерфейсе — у роз это длина, у хризантем категория. */
export const GRADE_LABELS: Record<string, string> = {
  rose: "Длина",
  chrysanthemum: "Категория",
  eustoma: "Длина",
};

export function getGradesFor(flowerType: string): readonly string[] {
  return GRADES_BY_FLOWER_TYPE[flowerType] ?? [];
}

/** Отображение значения: числовые длины показываем с «см», остальные — как есть. */
export function formatGrade(grade: string): string {
  if (!grade) return "—";
  return /^\d+$/.test(grade) ? `${grade} см` : grade;
}

export const ORDER_STATUSES = {
  NEW: "new",
  IN_PROGRESS: "in_progress",
  READY: "ready",
  SHIPPED: "shipped",
  CANCELLED: "cancelled",
} as const;
export type OrderStatus = (typeof ORDER_STATUSES)[keyof typeof ORDER_STATUSES];

export const ORDER_STATUS_LABELS: Record<string, string> = {
  new: "Новая",
  in_progress: "В работе",
  ready: "Готова к отгрузке",
  shipped: "Отгружена",
  cancelled: "Отменена",
};

// Значения по умолчанию для срока хранения (в сутках), если в листе Settings
// ничего не указано. Розы хранятся заметно меньше хризантем.
export const DEFAULT_SHELF_LIFE_DAYS: Record<string, number> = {
  rose: 7,
  chrysanthemum: 18,
  eustoma: 10,
};

// Доля от максимального срока хранения, после которой партия считается
// "требует внимания" (жёлтый статус) до перехода в "просрочена" (красный).
export const DEFAULT_WARNING_THRESHOLD = 0.7;
