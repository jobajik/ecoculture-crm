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
  SHIPMENT_PLANS: "ShipmentPlans",
  HARVEST_FORECAST: "HarvestForecast",
  HARVEST_MIX: "HarvestMix",
  CLAIMS: "Claims",
  MONEY_LOG: "MoneyLog",
  CLIENTS: "Clients",
  SETTINGS: "Settings",
  STAFF_TAKEOUTS: "StaffTakeouts",
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
    // Частичная оплата и работа с долгом — тоже в конец строки (грабли 1.1).
    // PaidAmount пустой у старых заявок: там смотрим на флаг Paid.
    "PaidAmount",
    "PromisedAt",
    "CollectionNote",
    // Клиент из базы. В конец строки, как и всё остальное (грабли 1.1).
    // ClientName остаётся рядом намеренно: это СНИМОК имени на момент заявки.
    // Клиент может переименоваться или сменить владельца, а в старой заявке
    // должно остаться то, что было написано тогда.
    "ClientID",
    // Оплата ПО КОМПАНИЯМ. Счёт выставляют два разных ТОО: роза и эустома от
    // Rose Farm, хризантема от Есентая, и клиент платит двумя переводами.
    // Бухгалтеру нужно отметить каждый отдельно, иначе «оплачено наполовину»
    // не отличить от «одно ТОО получило деньги, второе нет».
    // Сумма этих двух и есть PaidAmount — он остаётся итогом.
    // Строго ПОСЛЕ ClientID: новая колонка идёт только в конец (грабли 1.1),
    // иначе у уже заполненных заявок ClientID уехал бы на две клетки.
    "PaidRoseFarm",
    "PaidEsentai",
    // Заявка в наш магазин: пусто — обычная продажа, иначе направление розницы.
    // Это СНИМОК на момент заявки, как и ClientName: если точку потом закроют
    // или переведут в другое направление, старая заявка обязана остаться такой,
    // какой была. И, что важнее, деньги считаются по этой колонке — без похода
    // в карточку клиента из каждого расчёта.
    "Retail",
    // Куда уехал оптовый цветок: одно из направлений плана отгрузок
    // (`SHIPMENT_DIRECTIONS`) или пусто — значит Алматы и ближайшая округа.
    //
    // Колонка последняя, как и всё остальное (грабли 1.1). Пустая ячейка у
    // старых заявок читается как «направление не проставлено» — это честно:
    // до сентября его никто и не записывал.
    //
    // Ради неё всё и затевалось: план отгрузок РОПа вёлся по направлениям, а
    // сравнить его было НЕ С ЧЕМ — у заявки направления просто не было. Это
    // много месяцев числилось в «что ещё не сделано».
    "Direction",
    // Вид заявки. Пусто — обычная продажа клиенту; «region» — недельный объём
    // на город: РОП двигает в регион столько-то стеблей, клиента у такой
    // заявки нет вовсе, цены в позициях нет, а сумму поступлений подтверждает
    // потом бухгалтер прямо на заявке.
    //
    // Колонка последняя (грабли 1.1). Пустая ячейка у старых заявок читается
    // как «обычная продажа» — это и есть правда.
    "Kind",
  ],
  // Клиентская база. Заводит менеджер, правит свой менеджер, РОП и админ.
  [SHEET_TABS.CLIENTS]: [
    "ClientID",
    "CreatedAt",
    "Name",
    "City",
    "ShopName",
    "ClientType",
    "ContactPerson",
    "Phone",
    "Messenger",
    "Address",
    "PaymentTerms",
    "Source",
    "Note",
    "ManagerEmail",
    "Active",
    // Чем платит и куда. В конец строки, как и всё остальное (грабли 1.1).
    // Каспи клиента: их бывает несколько, поэтому два поля со свободным вводом.
    "PaymentMethod",
    "KaspiPay1",
    "KaspiPay2",
    // Наш ли это магазин и чей. Пустая ячейка — обычный клиент; «almaty» или
    // «regions» — собственная точка соответствующего направления. Одна колонка
    // вместо двух намеренно: «наш магазин без направления» — состояние, которое
    // ничего не значит и только плодит вопросы, кто им занимается.
    "Retail",
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
  // Kind в конце (грабли 1.1): пустая ячейка — обычный прайс для клиентов,
  // «retail» — внутренняя цена для наших магазинов. Так старые строки прайса
  // остаются клиентскими без единой правки.
  [SHEET_TABS.PRICE_HISTORY]: ["Date", "FlowerType", "Variety", "Grade", "Price", "Kind"],
  [SHEET_TABS.VARIETIES]: ["FlowerType", "Variety", "Active"],
  // FlowerType дописан ПОСЛЕДНИМ (грабли 1.1). Пустой он означает строку
  // старой схемы — план на менеджера без разбивки по цветку.
  [SHEET_TABS.PLANS]: ["Period", "ManagerEmail", "TargetAmount", "TargetStems", "FlowerType"],
  // План отгрузок РОПа: одна строка — одно направление и один цветок в месяце.
  // Ключ строки — Period + Direction + FlowerType: при повторном сохранении
  // строка не дублируется, а переписывается.
  [SHEET_TABS.SHIPMENT_PLANS]: [
    "Period",
    "Direction",
    "FlowerType",
    "TargetStems",
    "TargetAmount",
    "UpdatedAt",
    "UpdatedByEmail",
  ],
  // Прогноз срезки по сортам: одна строка — сорт в неделю.
  // Ключ — Period + FlowerType + Variety.
  //
  // Колонка Grade осталась от прежней версии, где прогноз вёлся сразу с
  // разбивкой по длинам. Сейчас она НЕ используется и пишется пустой: длины
  // переехали на отдельную вкладку HarvestMix, потому что ростовку планируют
  // на весь цветок целиком, а не на каждый сорт. Колонку не удаляем — данные
  // читаются по позиции, и её удаление сдвинуло бы всё правее (грабли 1.1).
  [SHEET_TABS.HARVEST_FORECAST]: [
    "Period",
    "FlowerType",
    "Variety",
    "Grade",
    "TargetStems",
    "UpdatedAt",
    "UpdatedByEmail",
  ],
  // Ростовка: одна строка — градация в неделю, на весь цветок.
  // Ключ — Period + FlowerType + Grade.
  [SHEET_TABS.HARVEST_MIX]: [
    "Period",
    "FlowerType",
    "Grade",
    "TargetStems",
    "UpdatedAt",
    "UpdatedByEmail",
  ],
  // Рекламация: менеджер сообщает, что с заявкой не так, бухгалтер решает.
  [SHEET_TABS.CLAIMS]: [
    "ClaimID",
    "CreatedAt",
    "OrderID",
    "ManagerEmail",
    "Reason",
    "Comment",
    "Status",
    "DecidedAt",
    "AccountantEmail",
    "Decision",
  ],
  // Журнал действий по деньгам: кто, когда, с какой заявкой и что сделал.
  [SHEET_TABS.MONEY_LOG]: [
    "LogID",
    "CreatedAt",
    "ActorEmail",
    "OrderID",
    "Action",
    "Details",
    "AmountBefore",
    "AmountAfter",
  ],
  [SHEET_TABS.SETTINGS]: ["Key", "Value"],
  /**
   * Цветы, которые сотрудник взял в счёт зарплаты.
   *
   * Это ОТДЕЛЬНАЯ вкладка, а не причина в списаниях, и вот почему. Списание —
   * это потеря: цветок завял, сломался, не продался. Доля списаний от приёмки
   * стоит в аналитике с ориентиром, и если подмешать туда выдачи сотрудникам,
   * показатель начнёт расти от того, что люди берут домой букеты, — то есть
   * перестанет отвечать на вопрос, ради которого заведён. Отдельная вкладка
   * стоит одной строки в схеме и навсегда разводит потери и выдачи.
   *
   * Цветок, сорт и градация записываются СНИМКОМ, хотя их можно было бы
   * подсмотреть в партии по BatchID. Это денежный документ — по нему считают
   * удержание из зарплаты, — а партии живут месяц и стираются при очистке
   * склада: через полгода строка обязана читаться сама по себе.
   *
   * Суммы в строке нет: она считается как Quantity × UnitPrice. Два поля,
   * отвечающие за одно и то же, рано или поздно разъезжаются (так уже решено
   * с оплатой по компаниям).
   */
  [SHEET_TABS.STAFF_TAKEOUTS]: [
    "TakeoutID",
    "CreatedAt",
    "Date",
    "StaffName",
    "BatchID",
    "FlowerType",
    "Variety",
    "Grade",
    "Quantity",
    "UnitPrice",
    "WarehouseEmail",
    "Note",
  ],
};

/**
 * Вид заявки.
 *
 * `REGION` — оптовый объём на город. Владелец объяснил это так: «она не продаёт
 * клиенту, а только городу двигает объём, только количество». Отсюда всё
 * остальное: контрагента нет, цены в позициях нет, счёта нет и долга нет.
 * Деньги появляются позже и с другой стороны — бухгалтер вписывает, сколько
 * по этому городу поступило.
 */
export const ORDER_KINDS = {
  CLIENT: "",
  REGION: "region",
} as const;

export const ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
  WAREHOUSE: "warehouse",
  ACCOUNTANT: "accountant",
  SALES_HEAD: "sales_head",
  AGRONOMIST: "agronomist",
  // Розница — НАШИ СОБСТВЕННЫЕ магазины. Это не продажа наружу, а перемещение
  // цветка внутри компании, поэтому роль отдельная: у неё нет ни счёта, ни
  // долга, ни бонуса, и оплату ждать не от кого. Две роли, а не одна, потому
  // что владелец хочет жёсткую границу: алматинец не должен видеть заявки по
  // регионам и наоборот.
  RETAIL_ALMATY: "retail_almaty",
  RETAIL_REGIONS: "retail_regions",
} as const;
export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_LABELS: Record<string, string> = {
  admin: "Администратор",
  manager: "Менеджер",
  warehouse: "Зав. склад",
  accountant: "Бухгалтер",
  sales_head: "Руководитель отдела продаж",
  agronomist: "Агроном",
  retail_almaty: "Менеджер розницы (Алматы)",
  retail_regions: "Менеджер розницы (регионы)",
};

// ---------------------------------------------------------------------------
// Собственная розница.
//
// «Наш магазин» — не клиент. Цветок в него не продаётся, а перемещается: денег
// между нами нет, счёта нет, оплаты ждать не от кого. Выручка появится тогда,
// когда магазин продаст букет покупателю, — а это уже не про эту программу.
//
// Отсюда всё остальное: заявка в свой магазин не идёт ни в выручку, ни в
// долги, ни в бонусы менеджеров, отгрузку открывает один менеджер розницы без
// бухгалтера, и цена берётся из отдельного внутреннего прайса.
// ---------------------------------------------------------------------------

export const RETAIL_TERRITORIES = {
  ALMATY: "almaty",
  REGIONS: "regions",
} as const;
export type RetailTerritory = (typeof RETAIL_TERRITORIES)[keyof typeof RETAIL_TERRITORIES];

export const RETAIL_LABELS: Record<string, string> = {
  almaty: "Розница Алматы",
  regions: "Розница регионы",
};

/** Короткая подпись — для строки в таблице, где длинная не помещается. */
export const RETAIL_SHORT_LABELS: Record<string, string> = {
  almaty: "Алматы",
  regions: "Регионы",
};

/**
 * Какой розницей заведует роль. У остальных ролей — null, и это значит «не
 * розничный менеджер», а не «вся розница»: право видеть чужие магазины должно
 * появляться явно, а не по умолчанию (грабли 1.10 — ошибка закрывает доступ).
 */
export const RETAIL_TERRITORY_BY_ROLE: Record<string, RetailTerritory> = {
  [ROLES.RETAIL_ALMATY]: RETAIL_TERRITORIES.ALMATY,
  [ROLES.RETAIL_REGIONS]: RETAIL_TERRITORIES.REGIONS,
};

export const RETAIL_ROLES: string[] = [ROLES.RETAIL_ALMATY, ROLES.RETAIL_REGIONS];

export const RETAIL_ORDER: string[] = [RETAIL_TERRITORIES.ALMATY, RETAIL_TERRITORIES.REGIONS];

/**
 * Города, где у нас есть своя розница в регионах.
 *
 * Список ЗАКРЫТЫЙ и лежит в коде, а не в таблице, — по той же причине, что и
 * направления отгрузки: свободный ввод за месяц даёт «Усть-Каменогорск»,
 * «Усть-каменогорск» и «УКА», и разрез перестаёт считаться. Новый город
 * дописывается в конец списка одной строкой, и по нему сразу появляется
 * вкладка.
 *
 * Контрагент здесь — ГОРОД ЦЕЛИКОМ, а не отдельные точки: зав. складом заказывает
 * на весь город одной заявкой, а дальше развозит сама. Так решил владелец.
 */
export const RETAIL_REGION_CITIES = ["Астана", "Семей", "Усть-Каменогорск"] as const;
export type RetailRegionCity = (typeof RETAIL_REGION_CITIES)[number];

export function retailLabel(territory: string | null | undefined): string {
  if (!territory) return "";
  return RETAIL_LABELS[territory] ?? territory;
}

/**
 * Роли, у которых колонка Farm в таблице Users имеет смысл: они работают по
 * одному производству. У остальных ролей она не влияет ни на что.
 */
export const FARM_BOUND_ROLES: string[] = [ROLES.WAREHOUSE, ROLES.AGRONOMIST];

export function isFarmBoundRole(role: string | null | undefined): boolean {
  return !!role && FARM_BOUND_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// Готовность заявки к сборке — те самые «две зелёные галочки»:
// менеджер окончательно согласовал заявку с клиентом, бухгалтер увидел деньги.
// Склад собирает такие заявки в первую очередь; неоплаченные видны, но помечены.
// ---------------------------------------------------------------------------

/** Как принимают деньги. Список короткий намеренно — бухгалтеру меньше кликов. */
export const PAYMENT_METHODS = ["Каспи", "Наличные", "Оплата по реквизитам"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Через сколько дней после даты доставки долг считается просроченным. */
export const DEBT_OVERDUE_DAYS = 3;

/**
 * Копеечный допуск при сравнении денег. Оплата 799 999,999 ₸ по счёту на
 * 800 000 ₸ — это оплачено целиком, а не «не хватает копейки»: иначе заявка
 * навсегда зависла бы в долгах из-за округления при пересчёте.
 */
export const MONEY_EPSILON = 1;

// ---------------------------------------------------------------------------
// Рекламации.
//
// Клиент жалуется менеджеру, а деньги правит бухгалтер — значит это разговор
// двух ролей, и его надо где-то хранить. Менеджер заводит рекламацию на своей
// заявке, бухгалтер её проводит (пересчитывает заявку) или отклоняет.
// Так решил владелец: «менеджер заводит, бухгалтер решает».
// ---------------------------------------------------------------------------

/** Причины рекламации. Список закрытый: свободный ввод не сводится в отчёт. */
export const CLAIM_REASONS = [
  "Брак",
  "Пересорт",
  "Недовоз",
  "Опоздание",
  "Ошибка в цене",
  "Другое",
] as const;
export type ClaimReason = (typeof CLAIM_REASONS)[number];

export const CLAIM_STATUSES = {
  NEW: "new",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
} as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[keyof typeof CLAIM_STATUSES];

export const CLAIM_STATUS_LABELS: Record<string, string> = {
  new: "Ждёт решения",
  accepted: "Проведена",
  rejected: "Отклонена",
};

/**
 * Что записывается в журнал действий по деньгам. Строки короткие и постоянные:
 * по ним потом фильтруют, а человеческую подпись даёт MONEY_LOG_LABELS.
 */
export const MONEY_LOG_ACTIONS = {
  PAYMENT: "payment",
  PAYMENT_CLEARED: "payment_cleared",
  RECALCULATED: "recalculated",
  CLAIM_CREATED: "claim_created",
  CLAIM_ACCEPTED: "claim_accepted",
  CLAIM_REJECTED: "claim_rejected",
  PROMISE: "promise",
  ORDER_CANCELLED: "order_cancelled",
  MANAGER_CONFIRMED: "manager_confirmed",
} as const;
export type MoneyLogAction = (typeof MONEY_LOG_ACTIONS)[keyof typeof MONEY_LOG_ACTIONS];

export const MONEY_LOG_LABELS: Record<string, string> = {
  order_cancelled: "Заявка отменена",
  manager_confirmed: "Подтверждение менеджера",
  payment: "Оплата",
  payment_cleared: "Оплата снята",
  recalculated: "Пересчёт заявки",
  claim_created: "Рекламация подана",
  claim_accepted: "Рекламация проведена",
  claim_rejected: "Рекламация отклонена",
  promise: "Обещание оплаты",
};

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

// Порядок в списке — не формальность: он же порядок строк на складе, в прайсе и
// в выпадающих списках. Владелец мыслит именно так: сначала длины по возрастанию,
// потом мини-микс, потом второй сорт по длинам, и только в конце то, что уже не
// про длину (B-quality и уценка). Менять порядок можно, данные от этого не едут —
// градации хранятся значением, а не номером.
export const ROSE_GRADES = [
  "40",
  "50",
  "60",
  "70",
  "80",
  "90",
  "100",
  "Мини-микс",
  // Второй сорт хозяйство считает ПО ДЛИНАМ, а не одной кучей: в утреннем стоке
  // и в срезе он приходит строками «2 сорт 40 см», «2 сорт 50 см». Поэтому это
  // отдельные градации, а не общий «B-quality» — иначе длина второго сорта
  // терялась бы навсегда. В высшую категорию выхода они не входят (см.
  // TOP_GRADES_BY_FLOWER_TYPE): второй сорт высшим не бывает.
  "40 (2 сорт)",
  "50 (2 сорт)",
  "60 (2 сорт)",
  "70 (2 сорт)",
  "B-quality",
  "Уценка",
] as const;

export const CHRYSANTHEMUM_GRADES = [
  "Высшая",
  "Первая",
  "Вторая",
  "Третья",
  "Четвёртая",
  "Мини-микс",
  // Из рабочего файла срезки хозяйства. «Брак» держим отдельно от «Уценки»:
  // уценка — решение о цене, брак — состояние цветка, и слить их значило бы
  // перестать видеть, сколько теряется на качестве (в первом же срезе — 1 955
  // стеблей из 19 410, каждый десятый).
  "Нераскрывшийся",
  "Брак",
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
    // Мини-микс продаётся тремя разными вещами, и в стоке они идут отдельными
    // колонками — держим их отдельными сортами, иначе 21 500 стеблей слились бы
    // в одну строку, по которой ничего не решишь.
    "Мини-микс одноголовые",
    "Мини-микс кустовые",
    "Мини-микс пионовидные",
  ],
  // Сорта хризантемы из ассортиментного листа хозяйства. Часть сейчас с нулевым
  // остатком — держим в справочнике всё равно: склад выбирает сорт из списка, и
  // отсутствие сорта заставило бы вписывать его руками с ошибками.
  chrysanthemum: [
    "Altaj",
    "Altay yellow",
    "Bacardy",
    "Bigoudi Purple",
    "Bigoudi Red",
    "Топспин",
    "Chik",
    "Карма пинк",
    "Ламира ред",
    "Ассортимент",
  ],
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

/**
 * Место градации в «правильном» порядке цветка — 40, 50, 60… мини-микс, 2 сорт.
 *
 * По нему сортируются ростовки везде, где их видит человек: диапазоны хранения
 * и «Подробно по позициям» на главной, разрезы в аналитике. Сортировать их по
 * количеству нельзя: длины — это шкала, и когда 60 см стоит выше 40 см просто
 * потому, что её больше, глаз каждый раз ищет строку заново.
 *
 * Незнакомая градация (кто-то вписал руками в таблицу) уходит в конец, но не
 * теряется.
 */
export function gradeOrder(flowerType: string, grade: string): number {
  const list = GRADES_BY_FLOWER_TYPE[flowerType] ?? [];
  const idx = list.indexOf(grade.trim());
  return idx === -1 ? list.length : idx;
}

/** Сравнение градаций одного цветка для sort(). */
export function compareGrades(flowerType: string, a: string, b: string): number {
  return gradeOrder(flowerType, a) - gradeOrder(flowerType, b) || a.localeCompare(b, "ru");
}

/** Отображение значения: числовые длины показываем с «см», остальные — как есть. */
export function formatGrade(grade: string): string {
  if (!grade) return "—";
  return /^\d+$/.test(grade) ? `${grade} см` : grade;
}

// ---------------------------------------------------------------------------
// Направления отгрузки. По ним руководитель отдела продаж ставит месячный план:
// сколько стеблей и на какую сумму планируется отгрузить в каждое.
//
// Список ведётся здесь, а не в таблице, намеренно: направлений мало, они
// меняются раз в год, а фиксированный список не даёт наплодить «Астана»,
// «астана» и «Астана ' » — иначе план развалится на три несводимые строки.
// Чтобы добавить направление, допишите строку В КОНЕЦ списка: уже сохранённые
// планы хранятся по названию, поэтому переименование старого направления
// «потеряет» его цифры, а добавление нового ничего не ломает.
// ---------------------------------------------------------------------------

/**
 * Направления сгруппированы по смыслу: внутренние регионы, экспорт, пожарка и
 * остальное. Группа — это не украшение интерфейса: по ней считаются подытоги,
 * и распределять остаток срезки удобно сразу на блок, а не тыкать в каждое
 * направление отдельно.
 *
 * Плоский список направлений выводится отсюда же (SHIPMENT_DIRECTIONS), чтобы
 * список и группировка не могли разойтись: направление, забытое в группе,
 * просто перестало бы существовать.
 */
export const DIRECTION_GROUPS = [
  {
    key: "regions",
    label: "Регионы Казахстана",
    directions: ["Астана", "Караганда", "Семей", "Усть-Каменогорск"],
  },
  { key: "export", label: "Экспорт", directions: ["Киргизия", "РФ"] },
  { key: "fire", label: "Пожарка", directions: ["Пожарка"] },
  { key: "retail", label: "Ритейл и прочее", directions: ["Магазины-ритейл", "Другие"] },
] as const;

export type DirectionGroupKey = (typeof DIRECTION_GROUPS)[number]["key"];

export const SHIPMENT_DIRECTIONS: string[] = DIRECTION_GROUPS.flatMap((g) => [...g.directions]);

export function isKnownDirection(value: string): boolean {
  return SHIPMENT_DIRECTIONS.includes(value);
}

/** В какой блок входит направление. */
export function groupOfDirection(direction: string): (typeof DIRECTION_GROUPS)[number] | null {
  return (
    DIRECTION_GROUPS.find((g) => (g.directions as readonly string[]).includes(direction)) ?? null
  );
}

// ---------------------------------------------------------------------------
// Высшая категория выхода.
//
// Агроном планирует ростовку — сколько стеблей какой длины (у розы и эустомы)
// или какой категории (у хризантемы) он рассчитывает срезать. Из этой ростовки
// система сама считает выход высшей категории: доля стеблей, попавших в
// перечисленные ниже градации.
//
// У хризантемы «высшая» — это прямо названная категория. У розы категории нет,
// её роль играет длина: чем длиннее стебель, тем выше сорт и цена, поэтому
// высшей считаем 70 см и длиннее. Если в хозяйстве принята другая граница —
// поменяйте список здесь, пересчёт по всем месяцам произойдёт сам.
// ---------------------------------------------------------------------------

export const TOP_GRADES_BY_FLOWER_TYPE: Record<string, string[]> = {
  // 70 см у розы высшей категорией НЕ считается — так сказал владелец. Высшая
  // роза начинается с 80 см; всё, что короче, это обычный товарный цветок.
  rose: ["80", "90", "100"],
  chrysanthemum: ["Высшая"],
  eustoma: ["Стандарт"],
};

/**
 * Ликвидное качество — то, что уходит с рынка без уговоров и скидок.
 *
 * У хризантемы это прямо названные владельцем «Высшая», «Первая» и «Вторая»:
 * третья и четвёртая уже продаются тяжело. У розы ликвид — весь первый сорт по
 * длинам; мини-микс, второй сорт, B-quality и уценка в него не входят. У
 * эустомы — стандарт и пятидесятка.
 *
 * Это бизнес-решение, а не техническое: если в хозяйстве считают иначе, здесь
 * меняется одна строка, и доля ликвида пересчитывается на всех страницах.
 */
export const LIQUID_GRADES_BY_FLOWER_TYPE: Record<string, string[]> = {
  rose: ["40", "50", "60", "70", "80", "90", "100"],
  chrysanthemum: ["Высшая", "Первая", "Вторая"],
  eustoma: ["Стандарт", "50"],
};

export function isLiquidGrade(flowerType: string, grade: string): boolean {
  return (LIQUID_GRADES_BY_FLOWER_TYPE[flowerType] ?? []).includes(grade.trim());
}

/** Человеческое название градации: у розы и эустомы «ростовка», у хризантемы «категория». */
const GRADE_NOUN: Record<string, [string, string, string]> = {
  rose: ["ростовка", "ростовки", "ростовок"],
  eustoma: ["ростовка", "ростовки", "ростовок"],
  chrysanthemum: ["категория", "категории", "категорий"],
};

/**
 * «7 ростовок» для розы и «7 категорий» для хризантемы.
 *
 * Владелец отдельно попросил: у хризантемы слова «ростовка» быть не должно —
 * она не меряется длиной, у неё качество. Для смешанного списка (когда на
 * экране сразу все цветки) есть нейтральное «позиция».
 */
export function gradeNoun(flowerType: string | null, count: number): string {
  const forms = flowerType ? GRADE_NOUN[flowerType] : undefined;
  const [one, few, many] = forms ?? ["позиция", "позиции", "позиций"];
  const t = Math.abs(count) % 100;
  const o = t % 10;
  if (t > 10 && t < 20) return many;
  if (o > 1 && o < 5) return few;
  if (o === 1) return one;
  return many;
}

/** Заголовок колонки: «Ростовка» или «Категория». */
export function gradeColumnLabel(flowerType: string | null): string {
  if (!flowerType) return "Позиция";
  return flowerType === "chrysanthemum" ? "Категория" : "Ростовка";
}

/**
 * То же самое для списка, где цветков может быть несколько: у Rose Farm это
 * роза и эустома — обе меряются длиной, поэтому «Ростовка»; у Есентая одна
 * хризантема — «Категория»; когда на экране все три, честнее написать оба слова.
 */
export function gradeColumnLabelFor(flowerTypes: readonly string[]): string {
  const set = new Set(flowerTypes);
  if (set.size === 0) return "Позиция";
  const hasChrysanthemum = set.has("chrysanthemum");
  const hasOther = Array.from(set).some((t) => t !== "chrysanthemum");
  if (hasChrysanthemum && hasOther) return "Ростовка и категория";
  return hasChrysanthemum ? "Категория" : "Ростовка";
}

/** «5 ростовок» / «5 категорий» / «5 позиций» — по составу списка. */
export function gradeNounFor(flowerTypes: readonly string[], count: number): string {
  const set = new Set(flowerTypes);
  const hasChrysanthemum = set.has("chrysanthemum");
  const hasOther = Array.from(set).some((t) => t !== "chrysanthemum");
  if (set.size === 0 || (hasChrysanthemum && hasOther)) return gradeNoun(null, count);
  return gradeNoun(hasChrysanthemum ? "chrysanthemum" : "rose", count);
}

export function isTopGrade(flowerType: string, grade: string): boolean {
  return (TOP_GRADES_BY_FLOWER_TYPE[flowerType] ?? []).includes(grade);
}

/** Человеческая подпись «что считается высшей категорией» — для интерфейса. */
export function topGradeHint(flowerType: string): string {
  const grades = TOP_GRADES_BY_FLOWER_TYPE[flowerType] ?? [];
  if (grades.length === 0) return "не задано";
  return grades.map(formatGrade).join(", ");
}

// ---------------------------------------------------------------------------
// Период планирования — месяц в виде «2026-09». И планы продаж, и план
// отгрузок, и прогноз срезки живут в одном формате, чтобы их можно было
// класть рядом в один отчёт.
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  "январь",
  "февраль",
  "март",
  "апрель",
  "май",
  "июнь",
  "июль",
  "август",
  "сентябрь",
  "октябрь",
  "ноябрь",
  "декабрь",
];

/** «2026-09» → «сентябрь 2026». */
export function periodLabel(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return period;
  return `${MONTH_NAMES[month - 1]} ${match[1]}`;
}

/** Месяц указанной даты в формате «2026-09» (по местному времени, не UTC). */
export function periodOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Сдвиг месяца: periodShift("2026-01", -1) === "2025-12". */
export function periodShift(period: string, months: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;
  const date = new Date(Number(match[1]), Number(match[2]) - 1 + months, 1);
  return periodOf(date);
}

export function isValidPeriod(period: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

// ---------------------------------------------------------------------------
// Недели внутри месяца.
//
// План отгрузок и прогноз срезки ведутся по неделям — так точнее, чем одной
// цифрой на месяц. Но месяц при этом остаётся главной единицей: он и в отчётах,
// и в планах менеджеров, и в разговоре.
//
// Поэтому неделя здесь — не «ISO-неделя года», а отрезок ВНУТРИ месяца:
// начинается с понедельника, но обрезается границами месяца. Первая и последняя
// недели могут быть короче семи дней — и это честно, потому что оставшиеся дни
// принадлежат соседнему месяцу.
//
// Плата за такой выбор — короткие недели по краям. Выигрыш важнее: сумма недель
// ТОЧНО равна месяцу. Возьми мы обычные ISO-недели, неделя на стыке месяцев
// попадала бы в оба сразу, и «план на сентябрь» перестал бы сходиться с суммой
// своих недель — а это ровно то, ради чего всё и затевалось.
//
// Код недели: «2026-09-W1». Месяц из него всегда восстанавливается.
// ---------------------------------------------------------------------------

export interface PlanWeek {
  /** «2026-09-W1» */
  code: string;
  /** 1…5 */
  index: number;
  /** ISO-дата первого дня, «2026-09-01» */
  from: string;
  /** ISO-дата последнего дня */
  to: string;
  /** «1–6 сентября» */
  label: string;
  /** «1–6» — для узких колонок */
  shortLabel: string;
  /** Сколько дней в этой неделе (у крайних бывает меньше семи). */
  days: number;
}

const MONTH_NAMES_GENITIVE = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

/** Разбивает месяц на недели: с понедельника, но не выходя за границы месяца. */
export function weeksOfMonth(period: string): PlanWeek[] {
  if (!isValidPeriod(period)) return [];
  const [yearStr, monthStr] = period.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  // День 0 следующего месяца — это последний день текущего; так же корректно
  // отрабатывает февраль високосного года, без отдельной проверки.
  const lastDay = new Date(year, month, 0).getDate();

  const weeks: PlanWeek[] = [];
  let dayFrom = 1;
  let index = 1;

  while (dayFrom <= lastDay) {
    const cursor = new Date(year, month - 1, dayFrom);
    // getDay(): 0 — воскресенье. Приводим к понедельнику как нулю.
    const weekday = (cursor.getDay() + 6) % 7;
    const dayTo = Math.min(dayFrom + (6 - weekday), lastDay);

    weeks.push({
      code: `${period}-W${index}`,
      index,
      from: isoDate(new Date(year, month - 1, dayFrom)),
      to: isoDate(new Date(year, month - 1, dayTo)),
      label:
        dayFrom === dayTo
          ? `${dayFrom} ${MONTH_NAMES_GENITIVE[month - 1]}`
          : `${dayFrom}–${dayTo} ${MONTH_NAMES_GENITIVE[month - 1]}`,
      shortLabel: dayFrom === dayTo ? `${dayFrom}` : `${dayFrom}–${dayTo}`,
      days: dayTo - dayFrom + 1,
    });

    dayFrom = dayTo + 1;
    index++;
  }

  return weeks;
}

export function isValidWeekCode(code: string): boolean {
  const match = /^(\d{4}-\d{2})-W(\d)$/.exec(code);
  if (!match) return false;
  const weeks = weeksOfMonth(match[1]);
  const index = Number(match[2]);
  return index >= 1 && index <= weeks.length;
}

/** «2026-09-W3» → «2026-09». Для месячной строки возвращает её саму. */
export function monthOfWeek(code: string): string {
  const match = /^(\d{4}-\d{2})(?:-W\d)?$/.exec(code);
  return match ? match[1] : "";
}

export function weekIndexOf(code: string): number {
  const match = /-W(\d)$/.exec(code);
  return match ? Number(match[1]) : 0;
}

/** Неделя, в которую попадает дата (для «текущей недели» по умолчанию). */
export function weekOfDate(date: Date): string {
  const period = periodOf(date);
  const day = date.getDate();
  const week = weeksOfMonth(period).find(
    (w) => day >= Number(w.from.slice(-2)) && day <= Number(w.to.slice(-2))
  );
  return week?.code ?? `${period}-W1`;
}

/** «2026-09-W1» → «1–6 сентября». */
export function weekLabel(code: string): string {
  const period = monthOfWeek(code);
  const week = weeksOfMonth(period).find((w) => w.code === code);
  return week ? week.label : code;
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

// ---------------------------------------------------------------------------
// Клиентская база.
//
// До неё клиент существовал только как имя, вписанное в заявку руками. Значит
// «Цветы 24», «цветы-24» и «ТОО Цветы 24» — три разных клиента в любом отчёте,
// а на вопрос «сколько мы возим в Караганду» ответить нельзя вовсе. Теперь у
// клиента есть карточка, а заявка на неё ссылается.
// ---------------------------------------------------------------------------

/**
 * Тип точки. Список закрытый: свободный ввод за месяц даёт «магазин»,
 * «Магазин» и «магазины» — три несводимые строки, и разрез перестаёт считаться.
 */
export const CLIENT_TYPES = [
  "Розничный магазин",
  "Сеть магазинов",
  "Оптовик",
  "Флористический салон",
  "Свадебное агентство",
  "Другое",
] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

/**
 * Условия оплаты — договорённость, а не факт. Бухгалтеру это нужно, чтобы
 * отличать «должен по договорённости» от «просто не платит»: клиенту с
 * отсрочкой 14 дней звонить на третий день бессмысленно и вредно.
 */
export const PAYMENT_TERMS = [
  "Предоплата",
  "По факту",
  "Отсрочка 3 дня",
  "Отсрочка 7 дней",
  "Отсрочка 14 дней",
  "Отсрочка 30 дней",
] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];

/** Откуда пришёл клиент. Нужно, чтобы понимать, что действительно приводит людей. */
export const CLIENT_SOURCES = [
  "Сарафанное радио",
  "Сами нашли",
  "Выставка",
  "Instagram",
  "Холодный звонок",
  "Старый клиент вернулся",
  "Другое",
] as const;
export type ClientSource = (typeof CLIENT_SOURCES)[number];

/**
 * Сколько дней без заказа считать «клиент отвалился».
 *
 * Это не строгая наука, а порог для глаза: роза берётся регулярно, и месяц
 * тишины у постоянного клиента — повод позвонить, а не ждать. Значение
 * бизнесовое, меняется одной строкой.
 */
export const CLIENT_SLEEPING_DAYS = 30;

/**
 * Куда в строке заявки писать оплату каждой компании.
 *
 * Счёт выставляют два разных ТОО: роза и эустома от Rose Farm, хризантема от
 * Есентая. Клиент платит двумя переводами, и бухгалтер отмечает каждый
 * отдельно — иначе «оплачено наполовину» не отличить от «одно ТОО деньги
 * получило, второе нет».
 *
 * Ключ — код производства, чтобы связь с `FARM_BY_FLOWER_TYPE` была прямой и
 * не разъехалась при появлении третьей компании.
 */
export const PAID_FIELD_BY_FARM: Record<string, "paidRoseFarm" | "paidEsentai"> = {
  [FARMS.ROSE_FARM]: "paidRoseFarm",
  [FARMS.ESENTAI]: "paidEsentai",
};

/** Способ оплаты показывается в карточке клиента; каспи-поля нужны только ему. */
export const KASPI_METHOD = "Каспи";

