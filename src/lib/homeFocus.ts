import { DEBT_OVERDUE_DAYS, MONEY_EPSILON, ORDER_STATUSES, ROLES } from "./constants";
import { isConsignment, isRegionOrder } from "./orderKind";
import { isRetailOrder } from "./retail";
import { isReadyToShip, missingForShip } from "./orderReady";
import { newOrderLinkFor } from "./newOrder";

/**
 * «Что у вас сегодня» — первый блок главной страницы.
 *
 * Главная у всех была одна: сводка по складу. Зав. складом это ровно её работа,
 * а менеджеру — три экрана чужих цифр, после которых внизу лежит кнопка
 * «Принять заявку»; на телефоне до неё девять экранов прокрутки. Бухгалтеру
 * склад не нужен вовсе: её вопрос — кто должен и кому звонить.
 *
 * Поэтому наверх встаёт короткий блок про СВОЮ работу, а склад остаётся под
 * ним. Именно под ним, а не вместо: цветок — общее дело, и посмотреть, что
 * лежит в холодильнике, приходится всем. По той же причине здесь нет
 * переадресации на «свой» раздел: адрес `/` у людей в закладках, и уводить его
 * в разные места у разных ролей — значит сделать ссылку, о которой нельзя
 * договориться («открой главную» перестаёт что-то означать).
 *
 * Считается всё из уже прочитанных заявок, без новых обращений к таблице, и
 * чистой функцией — чтобы цифры можно было проверить тестом, а не глазами на
 * боевых данных.
 */

export interface FocusStat {
  label: string;
  value: string;
  /** Пояснение под цифрой: что она означает и что с ней делать. */
  hint?: string;
  /** Куда ведёт нажатие. Без адреса плитка не кликается. */
  href?: string;
  /** Цвет: тревожный только там, где нужно вмешаться. */
  tone?: "default" | "good" | "warn" | "critical";
}

export interface HomeFocus {
  title: string;
  /** Одна фраза: что это за блок и почему он тут. */
  subtitle: string;
  action?: { href: string; label: string };
  stats: FocusStat[];
  /** Показывать ли блок ВЫШЕ склада. У зав. складом склад и есть работа. */
  aboveStock: boolean;
}

export interface FocusOrder {
  orderId: string;
  managerEmail: string;
  status: string;
  deliveryDate: string;
  /**
   * Когда заявку оформили. Нужен ровно для одного: у заявки может не быть даты
   * доставки, и тогда возраст долга считается отсюда — ровно как в
   * `finance.ts`. Без этого главная показывала 500 000 просрочки там, где
   * страница долгов показывала 707 900, и одно из двух чисел было бы неверным
   * в любом случае.
   */
  createdAt: string;
  managerConfirmed: boolean;
  paid: boolean;
  paidAmount: number;
  totalAmount: number;
  retail?: string;
  kind?: string;
  /** Направление: заявка на реализацию (пожарка) долгом не считается. */
  direction?: string;
}

const num = (n: number) => n.toLocaleString("ru-RU");

/** Долг по заявке — остаток, а не вся сумма. Отменённые и розница не в счёт. */
function debtOf(o: FocusOrder): number {
  if (o.status === ORDER_STATUSES.CANCELLED) return 0;
  if (isRetailOrder(o)) return 0;
  // Реализация — не долг: платят за проданное, остаток есть всегда (finance.ts).
  if (isConsignment(o)) return 0;
  const rest = o.totalAmount - o.paidAmount;
  return rest > MONEY_EPSILON ? rest : 0;
}

/**
 * От какой даты считать возраст долга: от доставки, а если её нет — от
 * оформления. Правило то же, что в `finance.ts`, и повторено здесь намеренно
 * одной строкой: два разных ответа на «сколько дней висит» — это два разных
 * числа «Просрочено» на двух страницах, и человеку не из чего выбрать верное.
 */
function debtBasis(o: FocusOrder): string {
  return o.deliveryDate || (o.createdAt || "").slice(0, 10);
}

function daysBetween(from: string, todayKey: string): number {
  if (!from) return 0;
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${todayKey}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

export function homeFocus(input: {
  role: string | undefined;
  email: string;
  orders: FocusOrder[];
  /** Сегодняшний день в виде «ГГГГ-ММ-ДД». */
  todayKey: string;
}): HomeFocus | null {
  const { role, email, orders, todayKey } = input;
  if (!role) return null;

  const mine = orders.filter(
    (o) => (o.managerEmail || "").toLowerCase() === (email || "").toLowerCase()
  );
  const live = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED);

  // --- Менеджер и менеджер розницы ------------------------------------------
  if (role === ROLES.MANAGER || role === ROLES.RETAIL_ALMATY || role === ROLES.RETAIL_REGIONS) {
    const open = mine.filter((o) => o.status === ORDER_STATUSES.NEW);
    const ready = open.filter((o) => isReadyToShip(o));
    const waitingMe = open.filter((o) => !o.managerConfirmed);
    const noDate = open.filter((o) => !o.deliveryDate);
    const link = newOrderLinkFor(role);

    return {
      title: "Ваши заявки",
      subtitle: "Открытые заявки, которые ещё не отгружены.",
      action: link ? { href: link.href, label: link.label } : undefined,
      aboveStock: true,
      stats: [
        {
          label: "Можно собирать",
          value: num(ready.length),
          hint: ready.length ? "склад может отгружать" : "пока ни одной",
          href: "/orders",
          tone: ready.length ? "good" : "default",
        },
        {
          label: "Ждут вашей галочки",
          value: num(waitingMe.length),
          hint: waitingMe.length
            ? "без подтверждения заявку не соберут"
            : "все подтверждены",
          href: "/orders",
          tone: waitingMe.length ? "warn" : "default",
        },
        {
          label: "Без даты доставки",
          value: num(noDate.length),
          // Это не придирка к аккуратности: лист сборки строится ПО ДАТЕ
          // доставки, и заявка без неё не попадает ни в один дневной лист.
          hint: noDate.length ? "не попадут в лист сборки" : "все с датой",
          href: "/orders",
          tone: noDate.length ? "critical" : "default",
        },
        {
          label: "Всего открытых",
          value: num(open.length),
          hint: "ваших, ещё не отгруженных",
          href: "/orders",
        },
      ],
    };
  }

  // --- Администратор ---------------------------------------------------------
  //
  // Это владелец. Ему нужен не свой участок, а то, где сейчас затык: деньги,
  // которые не пришли, и заявки, которые не поедут. Аналитика отвечает на
  // вопрос «как идут дела за месяц», а этот блок — «что не так прямо сейчас».
  if (role === ROLES.ADMIN) {
    const withDebt = live.filter((o) => debtOf(o) > 0);
    const overdue = withDebt.filter(
      (o) => daysBetween(debtBasis(o), todayKey) > DEBT_OVERDUE_DAYS
    );
    const overdueSum = overdue.reduce((s, o) => s + debtOf(o), 0);
    const open = live.filter((o) => o.status === ORDER_STATUSES.NEW);
    const stuck = open.filter((o) => !isReadyToShip(o));
    const noDate = open.filter((o) => !o.deliveryDate);

    return {
      title: "Где сейчас затык",
      subtitle:
        "Не «как идут дела» — это в Аналитике, — а что стоит на месте и ждёт решения.",
      aboveStock: true,
      stats: [
        {
          label: "Просрочено",
          value: `${num(Math.round(overdueSum))} ₸`,
          hint: `${num(overdue.length)} заявок дольше ${DEBT_OVERDUE_DAYS} дней`,
          href: "/finance/debts",
          tone: overdueSum > 0 ? "critical" : "good",
        },
        {
          label: "Должны нам всего",
          value: `${num(Math.round(withDebt.reduce((s, o) => s + debtOf(o), 0)))} ₸`,
          hint: `${num(withDebt.length)} незакрытых заявок`,
          href: "/finance/debts",
          tone: withDebt.length > 0 ? "warn" : "good",
        },
        {
          label: "Заявки стоят",
          value: num(stuck.length),
          hint: stuck.length ? "нет подтверждения или денег" : "все готовы к сборке",
          href: "/orders",
          tone: stuck.length ? "warn" : "good",
        },
        {
          label: "Без даты доставки",
          value: num(noDate.length),
          hint: noDate.length ? "выпадают из листа сборки" : "все с датой",
          href: "/orders",
          tone: noDate.length ? "critical" : "good",
        },
      ],
    };
  }

  // --- Бухгалтер и РОП -------------------------------------------------------
  if (role === ROLES.ACCOUNTANT || role === ROLES.SALES_HEAD) {
    const withDebt = live.filter((o) => debtOf(o) > 0);
    const debt = withDebt.reduce((s, o) => s + debtOf(o), 0);
    const overdue = withDebt.filter(
      (o) => daysBetween(debtBasis(o), todayKey) > DEBT_OVERDUE_DAYS
    );
    const overdueSum = overdue.reduce((s, o) => s + debtOf(o), 0);

    return {
      title: role === ROLES.ACCOUNTANT ? "Деньги на сегодня" : "Деньги отдела",
      subtitle:
        role === ROLES.ACCOUNTANT
          ? "Долги по всей базе, а не за период: висяк не перестаёт быть висяком от смены месяца."
          : "Только на просмотр. Отмечает оплаты бухгалтер.",
      aboveStock: true,
      stats: [
        {
          label: "Должны нам",
          value: `${num(Math.round(debt))} ₸`,
          hint: `${num(withDebt.length)} незакрытых заявок`,
          href: "/finance/debts",
          tone: debt > 0 ? "warn" : "good",
        },
        {
          label: "Просрочено",
          value: `${num(Math.round(overdueSum))} ₸`,
          hint: `дольше ${DEBT_OVERDUE_DAYS} дней`,
          href: "/finance/debts",
          tone: overdueSum > 0 ? "critical" : "good",
        },
        {
          label: "Заявок в просрочке",
          value: num(overdue.length),
          hint: overdue.length ? "с них и начинают обзвон" : "просроченных нет",
          href: "/finance/debts",
          tone: overdue.length ? "critical" : "good",
        },
      ],
    };
  }

  // --- Зав. складом ----------------------------------------------------------
  if (role === ROLES.WAREHOUSE) {
    const open = live.filter((o) => o.status === ORDER_STATUSES.NEW);
    const canShip = open.filter((o) => isReadyToShip(o));
    const today = open.filter((o) => o.deliveryDate === todayKey);
    return {
      title: "Очередь на отгрузку",
      subtitle: "Отгружать можно только заявки с обеими галочками.",
      action: { href: "/warehouse/picklist", label: "Лист сборки на сегодня" },
      // У зав. складом склад и ЕСТЬ работа: её сводку не оттесняем вниз.
      aboveStock: false,
      stats: [
        {
          label: "Можно отгружать",
          value: num(canShip.length),
          hint: canShip.length ? "подтверждены и оплачены" : "готовых нет",
          href: "/warehouse",
          tone: canShip.length ? "good" : "default",
        },
        {
          label: "Ждут",
          value: num(open.length - canShip.length),
          hint: "не хватает подтверждения или денег",
          href: "/warehouse",
        },
        {
          label: "Доставка сегодня",
          value: num(today.length),
          hint: today.length ? "их собирают в первую очередь" : "на сегодня доставок нет",
          href: "/warehouse/picklist",
          tone: today.length ? "warn" : "default",
        },
      ],
    };
  }

  return null;
}

/** Чего не хватает заявке — тем же текстом, что видит склад. */
export function focusReason(order: FocusOrder): string {
  const missing = missingForShip(order);
  return missing.length === 0 ? "" : `Ждёт ${missing.join(" и ")}`;
}

/** Городская заявка в счёт менеджеру не идёт — она общая. */
export function isOwnSellable(order: FocusOrder): boolean {
  return !isRegionOrder(order);
}
