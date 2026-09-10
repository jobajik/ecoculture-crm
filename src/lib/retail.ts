import {
  RETAIL_ORDER,
  RETAIL_ROLES,
  RETAIL_SHORT_LABELS,
  RETAIL_TERRITORY_BY_ROLE,
  RETAIL_TERRITORIES,
  ROLES,
  retailLabel,
} from "./constants";

/**
 * Собственная розница — одно правило на всю программу.
 *
 * Наш магазин НЕ клиент. Цветок в него не продаётся, а перемещается внутри
 * компании: счёта нет, денег между нами нет, ждать оплату не от кого. Выручка
 * появится, когда магазин продаст букет покупателю, — и это уже другая история.
 *
 * Из этого следует всё остальное, и именно поэтому правило живёт в одном
 * файле: спрашивают о нём в десятке мест — деньги бухгалтера, бонусы
 * менеджеров, клиентская база, аналитика продаж, календарь, лист сборки,
 * готовность к отгрузке. Разъедься эта проверка по местам — одна отстанет, и
 * внутреннее перемещение однажды посчитается выручкой. Дважды: сначала когда
 * магазин получил цветок, потом когда продал его покупателю.
 */

/** Заявка в наш магазин — внутреннее перемещение, а не продажа. */
export function isRetailOrder(order: { retail?: string | null }): boolean {
  return !!(order.retail ?? "").trim();
}

/** Карточка нашего магазина, а не клиента. */
export function isOwnShop(client: { retail?: string | null }): boolean {
  return !!(client.retail ?? "").trim();
}

/**
 * Какой розницей заведует роль: «almaty», «regions» или null.
 *
 * У админа — null, и это НЕ значит «никакой»: значит «не привязан к одному
 * направлению». Разницу разбирает `canSeeShop`, здесь её намеренно нет, чтобы
 * функция отвечала ровно на один вопрос.
 */
export function retailTerritoryFor(role: string | null | undefined): string | null {
  return (role && RETAIL_TERRITORY_BY_ROLE[role]) || null;
}

export function isRetailRole(role: string | null | undefined): boolean {
  return !!role && RETAIL_ROLES.includes(role);
}

/**
 * Кто видит магазин.
 *
 * Менеджер розницы — только своё направление: в этом и был смысл двух ролей.
 * Админ и РОП — всё: РОП отвечает за объёмы и прайс, включая внутренний.
 * Остальные роли собственных магазинов не видят вовсе — им там нечего делать,
 * а в клиентской базе наши точки только мешали бы считать средний чек.
 *
 * Склад — отдельный случай и сюда не попадает: он собирает всё, что ему
 * прислали, и делит заявки по производству, а не по направлению продаж.
 */
export function canSeeShop(role: string | null | undefined, shop: { retail?: string | null }): boolean {
  if (!isOwnShop(shop)) return false;
  if (role === ROLES.ADMIN || role === ROLES.SALES_HEAD) return true;
  const territory = retailTerritoryFor(role);
  return !!territory && territory === (shop.retail ?? "").trim();
}

/**
 * Может ли роль оформить заявку в этот магазин.
 *
 * Отличается от «видеть»: РОП видит обе розницы, но заявки за менеджера не
 * оформляет — иначе непонятно, чья это заявка и с кого спрашивать. Админ может
 * всё, он же и чинит, когда что-то пошло не так.
 */
export function canOrderForShop(
  role: string | null | undefined,
  shop: { retail?: string | null }
): boolean {
  if (!isOwnShop(shop)) return false;
  if (role === ROLES.ADMIN) return true;
  const territory = retailTerritoryFor(role);
  return !!territory && territory === (shop.retail ?? "").trim();
}

/**
 * Какие направления розницы человек видит. Пустой список — розницы у него нет.
 * Порядок постоянный (`RETAIL_ORDER`), чтобы вкладки не прыгали.
 */
export function territoriesFor(role: string | null | undefined): string[] {
  if (role === ROLES.ADMIN || role === ROLES.SALES_HEAD) return [...RETAIL_ORDER];
  const own = retailTerritoryFor(role);
  return own ? [own] : [];
}

/** Значение из закрытого списка направлений или пустая строка. */
export function cleanTerritory(value: string | null | undefined): string {
  const clean = (value ?? "").trim();
  return (Object.values(RETAIL_TERRITORIES) as string[]).includes(clean) ? clean : "";
}

export { retailLabel };

export function retailShortLabel(territory: string | null | undefined): string {
  if (!territory) return "";
  return RETAIL_SHORT_LABELS[territory] ?? territory;
}

// ---------------------------------------------------------------------------
// «Заявка на день по магазинам» — то, ради чего роль и заводилась.
//
// Менеджер розницы не оформляет двенадцать разрозненных заявок и не держит в
// голове, кому уже отправил, а кому нет. Он смотрит на один день и видит все
// свои точки списком: у кого заявка есть, у кого пусто, сколько всего стеблей
// уходит в это направление. Пустая строка — это и есть напоминание, а не
// отсутствие данных.
// ---------------------------------------------------------------------------

export interface ShopDayOrder {
  orderId: string;
  status: string;
  stems: number;
  amount: number;
  managerConfirmed: boolean;
  positions: string;
}

export interface ShopDayRow {
  clientId: string;
  name: string;
  city: string;
  territory: string;
  /** Заявки этого магазина на выбранный день. Обычно одна, но бывает добор. */
  orders: ShopDayOrder[];
  stems: number;
  amount: number;
  /** Ни одной заявки на этот день — магазин ждёт, о нём легко забыть. */
  empty: boolean;
}

export interface ShopDayTotals {
  shops: number;
  /** Скольким магазинам заявка уже оформлена. */
  covered: number;
  stems: number;
  amount: number;
}

export interface ShopDayInput {
  shops: {
    clientId: string;
    name: string;
    city: string;
    retail: string;
    active: boolean;
  }[];
  orders: {
    orderId: string;
    clientId: string;
    deliveryDate: string;
    status: string;
    retail: string;
    managerConfirmed: boolean;
    items: { flowerType: string; variety: string; grade: string; quantity: number; unitPrice: number }[];
  }[];
  /** День доставки, «ГГГГ-ММ-ДД». */
  date: string;
  /** Какие направления показывать — результат `territoriesFor`. */
  territories: string[];
  /** Как подписать позицию: сорт и длина. Формат приходит снаружи. */
  positionLabel: (variety: string, grade: string) => string;
  /** Отменённые заявки не считаются — как и везде. */
  cancelledStatus: string;
}

export function buildShopDay(input: ShopDayInput): { rows: ShopDayRow[]; totals: ShopDayTotals } {
  const shops = input.shops
    .filter((s) => s.active && input.territories.includes((s.retail ?? "").trim()))
    // Порядок: сначала направление (как в RETAIL_ORDER), потом город, потом имя.
    // Алфавит внутри города нужен, чтобы список не прыгал день ото дня.
    .sort((a, b) => {
      const byTerritory = RETAIL_ORDER.indexOf(a.retail) - RETAIL_ORDER.indexOf(b.retail);
      if (byTerritory !== 0) return byTerritory;
      const byCity = (a.city || "").localeCompare(b.city || "", "ru");
      if (byCity !== 0) return byCity;
      return a.name.localeCompare(b.name, "ru");
    });

  const byShop = new Map<string, ShopDayOrder[]>();
  for (const order of input.orders) {
    if (order.status === input.cancelledStatus) continue;
    if (!isRetailOrder(order)) continue;
    if ((order.deliveryDate || "") !== input.date) continue;
    if (!order.clientId) continue;

    const stems = order.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    const amount = order.items.reduce(
      (s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0),
      0
    );
    const list = byShop.get(order.clientId) ?? [];
    list.push({
      orderId: order.orderId,
      status: order.status,
      stems,
      amount,
      managerConfirmed: order.managerConfirmed,
      positions: order.items
        .map((i) => `${input.positionLabel(i.variety, i.grade)} — ${i.quantity}`)
        .join(", "),
    });
    byShop.set(order.clientId, list);
  }

  const rows: ShopDayRow[] = shops.map((shop) => {
    const orders = byShop.get(shop.clientId) ?? [];
    return {
      clientId: shop.clientId,
      name: shop.name,
      city: shop.city,
      territory: shop.retail,
      orders,
      stems: orders.reduce((s, o) => s + o.stems, 0),
      amount: orders.reduce((s, o) => s + o.amount, 0),
      empty: orders.length === 0,
    };
  });

  return {
    rows,
    totals: {
      shops: rows.length,
      covered: rows.filter((r) => !r.empty).length,
      stems: rows.reduce((s, r) => s + r.stems, 0),
      amount: rows.reduce((s, r) => s + r.amount, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Сводка «сколько ушло в розницу» за период. Это не выручка — это объём
// перемещения, посчитанный по внутреннему прайсу. Название всюду говорит об
// этом прямо, чтобы цифру не приняли за продажи.
// ---------------------------------------------------------------------------

export interface RetailShopRow {
  clientId: string;
  name: string;
  city: string;
  territory: string;
  orders: number;
  stems: number;
  amount: number;
}

export interface RetailVarietyRow {
  flowerType: string;
  variety: string;
  grade: string;
  stems: number;
  amount: number;
}

export interface RetailSummary {
  byShop: RetailShopRow[];
  byVariety: RetailVarietyRow[];
  byTerritory: { territory: string; label: string; stems: number; amount: number; orders: number }[];
  totals: { orders: number; stems: number; amount: number; shops: number };
}

export interface RetailSummaryInput {
  shops: { clientId: string; name: string; city: string; retail: string }[];
  orders: {
    orderId: string;
    clientId: string;
    clientName: string;
    createdAt: string;
    status: string;
    retail: string;
    items: { flowerType: string; variety: string; grade: string; quantity: number; unitPrice: number }[];
  }[];
  /** Границы периода по дате ОФОРМЛЕНИЯ, «ГГГГ-ММ-ДД» включительно. */
  from: string;
  to: string;
  territories: string[];
  cancelledStatus: string;
}

export function buildRetailSummary(input: RetailSummaryInput): RetailSummary {
  const shopById = new Map(input.shops.map((s) => [s.clientId, s]));

  const counted = input.orders.filter((o) => {
    if (o.status === input.cancelledStatus) return false;
    if (!isRetailOrder(o)) return false;
    if (!input.territories.includes((o.retail ?? "").trim())) return false;
    const day = (o.createdAt || "").slice(0, 10);
    return !!day && day >= input.from && day <= input.to;
  });

  const shopMap = new Map<string, RetailShopRow>();
  const varietyMap = new Map<string, RetailVarietyRow>();
  const territoryMap = new Map<string, { stems: number; amount: number; orders: number }>();

  for (const order of counted) {
    const stems = order.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    const amount = order.items.reduce(
      (s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0),
      0
    );

    const shop = shopById.get(order.clientId);
    // Магазин мог быть удалён из базы, а заявка осталась. Показываем её под
    // именем из заявки, а не прячем: цветок уехал, и в сводке он обязан быть.
    const key = order.clientId || `~${order.clientName}`;
    const row = shopMap.get(key) ?? {
      clientId: order.clientId,
      name: shop?.name || order.clientName || "(магазин удалён)",
      city: shop?.city || "",
      territory: (order.retail ?? "").trim(),
      orders: 0,
      stems: 0,
      amount: 0,
    };
    row.orders += 1;
    row.stems += stems;
    row.amount += amount;
    shopMap.set(key, row);

    const t = territoryMap.get(row.territory) ?? { stems: 0, amount: 0, orders: 0 };
    t.stems += stems;
    t.amount += amount;
    t.orders += 1;
    territoryMap.set(row.territory, t);

    for (const item of order.items) {
      const vKey = `${item.flowerType}|${item.variety}|${item.grade}`;
      const v = varietyMap.get(vKey) ?? {
        flowerType: item.flowerType,
        variety: item.variety,
        grade: item.grade,
        stems: 0,
        amount: 0,
      };
      v.stems += Number(item.quantity) || 0;
      v.amount += (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0);
      varietyMap.set(vKey, v);
    }
  }

  const byShop = [...shopMap.values()].sort((a, b) => b.stems - a.stems);
  const byVariety = [...varietyMap.values()].sort((a, b) => b.stems - a.stems);
  const byTerritory = RETAIL_ORDER.filter((t) => territoryMap.has(t)).map((territory) => ({
    territory,
    label: retailLabel(territory),
    ...territoryMap.get(territory)!,
  }));

  return {
    byShop,
    byVariety,
    byTerritory,
    totals: {
      orders: counted.length,
      stems: byShop.reduce((s, r) => s + r.stems, 0),
      amount: byShop.reduce((s, r) => s + r.amount, 0),
      shops: byShop.length,
    },
  };
}
