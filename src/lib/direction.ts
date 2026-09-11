import {
  DIRECTION_GROUPS,
  FLOWER_TYPES,
  ROLES,
  SHIPMENT_DIRECTIONS,
  isKnownDirection,
} from "./constants";

/**
 * Куда уехал оптовый цветок — направление отгрузки.
 *
 * Зачем это вообще. План отгрузок РОП ведёт по направлениям и по неделям уже
 * давно, а сравнить его было НЕ С ЧЕМ: у заявки направления не было, и вопрос
 * «сделали мы план по Астане или нет» упирался в то, что факта по Астане в
 * системе не существует. Отсюда одна колонка в заявке и этот модуль правил.
 *
 * Три решения владельца, от которых здесь всё зависит:
 *
 * 1. **Заявки в регионы заводит РОП**, менеджеры остаются на Алматы. Поэтому
 *    поле «Направление» видит только он (и админ), а у менеджера его нет
 *    вовсе — лишнее поле в ежедневной форме это лишний способ ошибиться.
 * 2. **Направление подставляется по городу клиента**, но остаётся изменяемым:
 *    везут и не туда, где офис клиента.
 * 3. **Алматы в списке направлений НЕТ.** Пустое направление и значит «Алматы
 *    и округа». Это сознательный выбор владельца, и из него следует важное:
 *    сумма по направлениям МЕНЬШЕ общих продаж, и так и должно быть.
 *
 * Функции здесь чистые и покрыты `scripts/check-directions.ts`.
 */

/** Направление или пусто. Неизвестное значение — пусто (грабли 1.10). */
export function cleanDirection(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (isKnownDirection(raw)) return raw;
  // Регистр и «ё» в ячейке правили руками — это не повод терять направление.
  const key = normalize(raw);
  return SHIPMENT_DIRECTIONS.find((d) => normalize(d) === key) ?? "";
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/g, "е").replace(/[\s-]+/g, " ").trim();
}

/**
 * Как город клиента называют в жизни — и какое это направление.
 *
 * Город в карточке пишется руками и закрытым списком не является (это решение
 * принималось для клиентской базы и менять его ради отчёта не стоит). Значит,
 * подстановка обязана понимать то, что люди действительно пишут: «Нур-Султан»
 * — это Астана, «Оскемен» — Усть-Каменогорск, «Семипалатинск» — Семей.
 *
 * Список нарочно короткий и очевидный. Угадывать по первым буквам нельзя: так
 * «Кара-Балта» стала бы «Карагандой», а подстановка, которая иногда врёт,
 * хуже пустого поля — пустое хотя бы заметно.
 */
const CITY_ALIASES: Record<string, string> = {
  "астана": "Астана",
  "нур султан": "Астана",
  "нурсултан": "Астана",
  "акмола": "Астана",
  "караганда": "Караганда",
  "карагандв": "Караганда",
  "караганды": "Караганда",
  "семей": "Семей",
  "семипалатинск": "Семей",
  "усть каменогорск": "Усть-Каменогорск",
  "устькаменогорск": "Усть-Каменогорск",
  "оскемен": "Усть-Каменогорск",
  "бишкек": "Киргизия",
  "киргизия": "Киргизия",
  "кыргызстан": "Киргизия",
  "россия": "РФ",
  "рф": "РФ",
  "москва": "РФ",
  "новосибирск": "РФ",
  "омск": "РФ",
};

/** Направление, которое подставится по городу клиента. Пусто — не угадали. */
export function directionForCity(city: string | null | undefined): string {
  const key = normalize(String(city ?? ""));
  if (!key) return "";
  const direct = cleanDirection(city);
  if (direct) return direct;
  return CITY_ALIASES[key] ?? "";
}

// --- Права ------------------------------------------------------------------

/**
 * Кто ставит направление. Владелец решил: региональный опт — работа РОПа.
 *
 * Администратор тоже: он чинит то, что сломалось, и без него исправить
 * направление в старой заявке было бы некому.
 */
export function canSetDirection(role: string | null | undefined): boolean {
  return role === ROLES.SALES_HEAD || role === ROLES.ADMIN;
}

/** Кто видит раздел «Регионы». Пока те же: это рабочее место РОПа. */
export function canSeeRegionSales(role: string | null | undefined): boolean {
  return canSetDirection(role);
}

/**
 * Почему направление проставить нельзя. Пустая строка — можно.
 *
 * Проверка сервера, а не формы: серверное действие вызывается обычным
 * запросом, и спрятанное поле ничего не запрещает (грабли 1.11).
 */
export function directionRefusal(input: {
  role: string | null | undefined;
  direction: string;
  /** Заявка в наш магазин? У розницы направления отгрузки не бывает. */
  isShop: boolean;
}): string {
  if (!input.direction) return "";
  if (!canSetDirection(input.role)) {
    return "Направление отгрузки ставит руководитель отдела продаж";
  }
  if (input.isShop) {
    return "Заявка в наш магазин — это перемещение внутри компании, направления отгрузки у неё нет";
  }
  if (!cleanDirection(input.direction)) return "Неизвестное направление";
  return "";
}

// --- План против факта ------------------------------------------------------

export interface DirectionFactOrder {
  orderId: string;
  clientName: string;
  deliveryDate: string;
  status: string;
  direction: string;
  /** Направление собственной розницы — такие заявки в опт не идут. */
  retail?: string;
  managerEmail: string;
  items: { flowerType: string; quantity: number; shippedQuantity: number; unitPrice: number }[];
}

export interface DirectionPlanRow {
  period: string;
  direction: string;
  /** План отгрузок ведётся по цветкам — разрез в нём есть с самого начала. */
  flowerType: string;
  targetStems: number;
  targetAmount: number;
}

export interface DirectionRow {
  direction: string;
  planStems: number;
  planAmount: number;
  /** Стеблей в заявках с датой доставки внутри периода. */
  orderedStems: number;
  /** Из них фактически отгружено. */
  shippedStems: number;
  amount: number;
  orders: number;
  /** Выполнение плана по стеблям, %. Нет плана — null, а не ноль. */
  donePercent: number | null;
}

export interface DirectionGroupRow {
  key: string;
  label: string;
  rows: DirectionRow[];
  planStems: number;
  orderedStems: number;
  shippedStems: number;
  amount: number;
}

/** Одна строка сводки «по цветку»: план и факт по всем направлениям сразу. */
export interface FlowerFactRow {
  flowerType: string;
  planStems: number;
  planAmount: number;
  orderedStems: number;
  shippedStems: number;
  amount: number;
  donePercent: number | null;
}

export interface DirectionFact {
  groups: DirectionGroupRow[];
  /**
   * Разрез по цветку — Розы, Хризантемы, Эустома.
   *
   * Владелец попросил его отдельно, и правильно: девять направлений на три
   * цветка в одной таблице — это двадцать семь строк, а вопрос «сколько роз мы
   * должны отгрузить в регионы» задают чаще, чем «сколько роз в Караганду».
   * Строки идут в порядке цветков, принятом в системе, и показываются ВСЕ три,
   * даже пустые: пустая строка здесь — это «плана нет», и её надо видеть.
   */
  byFlower: FlowerFactRow[];
  planStems: number;
  planAmount: number;
  orderedStems: number;
  shippedStems: number;
  amount: number;
  orders: number;
  donePercent: number | null;
}

/** Идёт ли заявка в оптовый счёт по направлениям. */
export function countsAsWholesale(order: {
  status: string;
  retail?: string;
}, cancelledStatus: string): boolean {
  // Отменённая не в счёт — то же правило, что и везде в деньгах.
  if (order.status === cancelledStatus) return false;
  // Собственная розница — внутреннее перемещение, а не отгрузка клиенту.
  // Забыть этот фильтр значило бы записать наши же магазины в продажи по
  // Астане и Семею: карточки городов там называются ровно так же.
  if ((order.retail || "").trim()) return false;
  return true;
}

/**
 * План против факта по направлениям за период.
 *
 * **Факт считается по ДАТЕ ДОСТАВКИ**, а не по дате оформления. Это
 * единственный честный вариант: план называется «план отгрузок на неделю», и
 * заявка, оформленная в понедельник на следующий вторник, относится к той
 * неделе, когда цветок уедет. (Продажи менеджеров, наоборот, считаются по дате
 * оформления — у них вопрос другой: «кто сколько продал в этом месяце».)
 *
 * Рядом со «заказано» стоит «отгружено» — сумма `shippedQuantity`. Разница
 * между ними и есть то, что ещё не уехало: без неё «план выполнен» означало бы
 * только «заявки оформлены».
 */
export function buildDirectionFact(input: {
  orders: DirectionFactOrder[];
  plans: DirectionPlanRow[];
  /** Отрезок дат доставки, включительно: «ГГГГ-ММ-ДД». */
  from: string;
  to: string;
  /** Коды периодов плана (недели), попадающие в отрезок. */
  planPeriods: string[];
  cancelledStatus: string;
  /**
   * Считать только по одному цветку. Пусто — по всем.
   *
   * Фильтр стоит ЗДЕСЬ, а не на странице: иначе «план» отфильтровали бы, а
   * «факт» забыли, и выполнение выглядело бы втрое лучше, чем есть.
   */
  flowerType?: string;
}): DirectionFact {
  const periods = new Set(input.planPeriods);
  const onlyFlower = (input.flowerType || "").trim();
  const mineFlower = (flowerType: string) => !onlyFlower || flowerType === onlyFlower;

  const plan = new Map<string, { stems: number; amount: number }>();
  const planByFlower = new Map<string, { stems: number; amount: number }>();
  for (const row of input.plans) {
    if (!periods.has(row.period)) continue;
    if (!mineFlower(row.flowerType)) continue;
    const direction = cleanDirection(row.direction);
    if (!direction) continue;
    const acc = plan.get(direction) ?? { stems: 0, amount: 0 };
    acc.stems += row.targetStems;
    acc.amount += row.targetAmount;
    plan.set(direction, acc);

    const byFlower = planByFlower.get(row.flowerType) ?? { stems: 0, amount: 0 };
    byFlower.stems += row.targetStems;
    byFlower.amount += row.targetAmount;
    planByFlower.set(row.flowerType, byFlower);
  }

  const fact = new Map<string, { ordered: number; shipped: number; amount: number; orders: number }>();
  const factByFlower = new Map<string, { ordered: number; shipped: number; amount: number }>();
  for (const order of input.orders) {
    if (!countsAsWholesale(order, input.cancelledStatus)) continue;
    const direction = cleanDirection(order.direction);
    if (!direction) continue;
    if (!order.deliveryDate || order.deliveryDate < input.from || order.deliveryDate > input.to) {
      continue;
    }

    const items = order.items.filter((i) => mineFlower(i.flowerType));
    // Заявка без позиций выбранного цветка в счёт не идёт вовсе — иначе
    // «заявок: 5» стояло бы там, где роз не везли ни одной.
    if (items.length === 0) continue;

    const acc = fact.get(direction) ?? { ordered: 0, shipped: 0, amount: 0, orders: 0 };
    for (const item of items) {
      acc.ordered += item.quantity;
      acc.shipped += item.shippedQuantity;
      acc.amount += item.quantity * item.unitPrice;

      const byFlower = factByFlower.get(item.flowerType) ?? { ordered: 0, shipped: 0, amount: 0 };
      byFlower.ordered += item.quantity;
      byFlower.shipped += item.shippedQuantity;
      byFlower.amount += item.quantity * item.unitPrice;
      factByFlower.set(item.flowerType, byFlower);
    }
    acc.orders += 1;
    fact.set(direction, acc);
  }

  const groups: DirectionGroupRow[] = DIRECTION_GROUPS.map((group) => {
    const rows: DirectionRow[] = group.directions.map((direction) => {
      const p = plan.get(direction) ?? { stems: 0, amount: 0 };
      const f = fact.get(direction) ?? { ordered: 0, shipped: 0, amount: 0, orders: 0 };
      return {
        direction,
        planStems: p.stems,
        planAmount: p.amount,
        orderedStems: f.ordered,
        shippedStems: f.shipped,
        amount: f.amount,
        orders: f.orders,
        // Нет плана — не ноль процентов, а прочерк: «плана не ставили» и
        // «план провален» это разные новости.
        donePercent: p.stems > 0 ? (f.ordered / p.stems) * 100 : null,
      };
    });
    return {
      key: group.key,
      label: group.label,
      rows,
      planStems: rows.reduce((s, r) => s + r.planStems, 0),
      orderedStems: rows.reduce((s, r) => s + r.orderedStems, 0),
      shippedStems: rows.reduce((s, r) => s + r.shippedStems, 0),
      amount: rows.reduce((s, r) => s + r.amount, 0),
    };
  });

  // Все три цветка показываем всегда, даже пустые: пустая строка здесь значит
  // «плана по этому цветку в регионы нет», и её надо видеть, а не искать.
  const flowerOrder = [FLOWER_TYPES.ROSE, FLOWER_TYPES.CHRYSANTHEMUM, FLOWER_TYPES.EUSTOMA];
  const byFlower: FlowerFactRow[] = flowerOrder
    .filter((flowerType) => mineFlower(flowerType))
    .map((flowerType) => {
      const p = planByFlower.get(flowerType) ?? { stems: 0, amount: 0 };
      const f = factByFlower.get(flowerType) ?? { ordered: 0, shipped: 0, amount: 0 };
      return {
        flowerType,
        planStems: p.stems,
        planAmount: p.amount,
        orderedStems: f.ordered,
        shippedStems: f.shipped,
        amount: f.amount,
        donePercent: p.stems > 0 ? (f.ordered / p.stems) * 100 : null,
      };
    });

  const planStems = groups.reduce((s, g) => s + g.planStems, 0);
  const orderedStems = groups.reduce((s, g) => s + g.orderedStems, 0);

  return {
    groups,
    byFlower,
    planStems,
    planAmount: Array.from(plan.values()).reduce((s, p) => s + p.amount, 0),
    orderedStems,
    shippedStems: groups.reduce((s, g) => s + g.shippedStems, 0),
    amount: groups.reduce((s, g) => s + g.amount, 0),
    orders: Array.from(fact.values()).reduce((s, f) => s + f.orders, 0),
    donePercent: planStems > 0 ? (orderedStems / planStems) * 100 : null,
  };
}

/**
 * Заявки, которые по городу клиента похожи на региональные, но направления не
 * несут.
 *
 * Ради этого списка направление и не сделали обязательным для менеджера.
 * Менеджер возит по Алматы и поля не видит; если заявка в регион всё же прошла
 * через него, она всплывёт здесь, и РОП поставит направление одним нажатием.
 * Без такого списка отчёт по регионам тихо недосчитывался бы, а понять это
 * было бы нельзя.
 */
export function ordersMissingDirection(input: {
  orders: DirectionFactOrder[];
  /** Город из карточки клиента по clientId заявки. */
  cityByOrder: Map<string, string>;
  from: string;
  to: string;
  cancelledStatus: string;
}): { orderId: string; clientName: string; deliveryDate: string; suggested: string }[] {
  const out: { orderId: string; clientName: string; deliveryDate: string; suggested: string }[] = [];
  for (const order of input.orders) {
    if (!countsAsWholesale(order, input.cancelledStatus)) continue;
    if (cleanDirection(order.direction)) continue;
    if (!order.deliveryDate || order.deliveryDate < input.from || order.deliveryDate > input.to) {
      continue;
    }
    const suggested = directionForCity(input.cityByOrder.get(order.orderId) ?? "");
    if (!suggested) continue;
    out.push({
      orderId: order.orderId,
      clientName: order.clientName,
      deliveryDate: order.deliveryDate,
      suggested,
    });
  }
  return out.sort((a, b) => (a.deliveryDate < b.deliveryDate ? -1 : 1));
}
