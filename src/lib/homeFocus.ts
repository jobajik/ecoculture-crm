import { DEBT_OVERDUE_DAYS, MONEY_EPSILON, ORDER_STATUSES, ROLES } from "./constants";
import { isConsignment, isRegionOrder } from "./orderKind";
import { isRetailOrder } from "./retail";
import { missingForShip } from "./orderReady";
import { orderStage, type OrderStage } from "./orderStage";
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
  hint?: string;
  href?: string;
  tone?: "default" | "good" | "warn" | "critical";
}

/** Строка списка «Требует внимания»: что не так, насколько, куда нажать. */
export interface AttentionItem {
  label: string;
  detail: string;
  href: string;
  tone: "critical" | "warn";
}

export interface HomeFocus {
  title: string;
  subtitle: string;
  action?: { href: string; label: string };
  stats: FocusStat[];
  aboveStock: boolean;
  /** Ранжированный список «что требует внимания» — у владельца и у бухгалтера. */
  attention?: AttentionItem[];
  /** Одна строка над складом — у зав. складом, чья главная остаётся складом. */
  strip?: { text: string; href: string; tone: "critical" | "default" };
  /** Показывать ли сводку склада на главной вообще. */
  showStock: boolean;
}

export interface FocusOrder {
  orderId: string;
  managerEmail: string;
  status: string;
  deliveryDate: string;
  createdAt: string;
  managerConfirmed: boolean;
  paid: boolean;
  paidAmount: number;
  totalAmount: number;
  retail?: string;
  kind?: string;
  direction?: string;
  clientPaymentTerms?: string;
  items?: { quantity: number; shippedQuantity: number }[];
}

/** То, что главная знает помимо заявок (считается страницей из уже прочитанного). */
export interface FocusExtras {
  /** Стеблей на складе дольше срока хранения и всего на складе. */
  expiredStems?: number;
  stockStems?: number;
  /** Открытых рекламаций. */
  openClaims?: number;
}

const num = (n: number) => n.toLocaleString("ru-RU");
const money = (n: number) => `${num(Math.round(n))} ₸`;

function debtOf(o: FocusOrder): number {
  if (o.status === ORDER_STATUSES.CANCELLED) return 0;
  if (isRetailOrder(o)) return 0;
  if (isConsignment(o)) return 0;
  const rest = o.totalAmount - o.paidAmount;
  return rest > MONEY_EPSILON ? rest : 0;
}

function overpaidOf(o: FocusOrder): number {
  if (o.status === ORDER_STATUSES.CANCELLED || isRetailOrder(o) || isRegionOrder(o)) return 0;
  const over = o.paidAmount - o.totalAmount;
  return over > 1 ? over : 0;
}

/**
 * От какого дня считать возраст долга: от доставки, а если её нет — от дня
 * оформления. Ровно как в `finance.ts`: одно и то же число на главной и на
 * странице долгов обязано совпадать (главная показывала 500 000, а долги —
 * 707 900, пока правила расходились).
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

function stageOf(o: FocusOrder, todayKey: string): OrderStage {
  return orderStage({ ...o, items: o.items ?? [] }, todayKey);
}

const isOpenStage = (st: OrderStage) => st.key !== "shipped" && st.key !== "cancelled";
const isShippable = (st: OrderStage) => st.key === "ready" || st.key === "partly";
const stemsLeft = (o: FocusOrder) =>
  (o.items ?? []).reduce((s, i) => s + Math.max(0, i.quantity - i.shippedQuantity), 0);

export function homeFocus(input: {
  role: string | undefined;
  email: string;
  orders: FocusOrder[];
  todayKey: string;
  extras?: FocusExtras;
}): HomeFocus | null {
  const { role, email, orders, todayKey } = input;
  const extras = input.extras ?? {};
  if (!role) return null;

  const withStage = orders.map((o) => ({ o, st: stageOf(o, todayKey) }));
  const mine = withStage.filter(
    ({ o }) => (o.managerEmail || "").toLowerCase() === (email || "").toLowerCase()
  );
  const live = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED);
  const withDebt = live.filter((o) => debtOf(o) > 0);
  const overdue = withDebt.filter((o) => daysBetween(debtBasis(o), todayKey) > DEBT_OVERDUE_DAYS);
  const overdueSum = overdue.reduce((s, o) => s + debtOf(o), 0);
  const debtSum = withDebt.reduce((s, o) => s + debtOf(o), 0);
  const overpaid = live.filter((o) => overpaidOf(o) > 0);

  if (role === ROLES.MANAGER || role === ROLES.RETAIL_ALMATY || role === ROLES.RETAIL_REGIONS) {
    const open = mine.filter(({ st }) => isOpenStage(st));
    const ready = open.filter(({ st }) => isShippable(st));
    const waitingMe = open.filter(({ st }) => st.key === "wait_confirm");
    const late = open.filter(({ st }) => st.lateDays > 0);
    const noDate = open.filter(({ o }) => !o.deliveryDate);
    const link = newOrderLinkFor(role);
    const attention: AttentionItem[] = [];
    if (noDate.length) {
      attention.push({
        label: `Без даты доставки: ${num(noDate.length)}`,
        detail: "не попадут в лист сборки — укажите дату",
        href: "/orders?stage=open",
        tone: "critical",
      });
    }

    return {
      title: "Ваши заявки",
      subtitle: "Открытые заявки, которые ещё не отгружены.",
      action: link ? { href: link.href, label: link.label } : undefined,
      aboveStock: true,
      showStock: true,
      attention,
      stats: [
        {
          label: "Можно собирать",
          value: num(ready.length),
          hint: ready.length ? "склад может отгружать" : "пока ни одной",
          href: "/orders?stage=ready",
          tone: ready.length ? "good" : "default",
        },
        {
          label: "Ждут вашей галочки",
          value: num(waitingMe.length),
          hint: waitingMe.length ? "без подтверждения не соберут" : "все подтверждены",
          href: "/orders?stage=wait_confirm",
          tone: waitingMe.length ? "warn" : "default",
        },
        {
          label: "Опаздывают",
          value: num(late.length),
          hint: late.length ? "доставка прошла, не отгружены" : "опозданий нет",
          href: "/orders?stage=late",
          tone: late.length ? "critical" : "default",
        },
        {
          label: "Всего открытых",
          value: num(open.length),
          hint: "ваших, ещё не отгруженных",
          href: "/orders?stage=open",
        },
      ],
    };
  }

  if (role === ROLES.ADMIN || role === ROLES.SALES_HEAD) {
    const open = withStage.filter(({ st }) => isOpenStage(st));
    const late = open.filter(({ st }) => st.lateDays > 0);
    const lateStems = late.reduce((s, { o }) => s + stemsLeft(o), 0);
    const lateReady = late.filter(({ st }) => isShippable(st));
    const unconfirmed = open.filter(
      ({ o, st }) => st.key === "wait_confirm" && daysBetween((o.createdAt || "").slice(0, 10), todayKey) >= 1
    );
    const noDate = open.filter(({ o }) => !o.deliveryDate);

    const attention: AttentionItem[] = [];
    if (late.length) {
      attention.push({
        label: `Опаздывают с отгрузкой: ${num(late.length)} заявок`,
        detail:
          `${num(lateStems)} шт. · доставка уже прошла` +
          (lateReady.length ? ` · ${num(lateReady.length)} из них готовы — их просто не отметили` : ""),
        href: "/orders?stage=late",
        tone: "critical",
      });
    }
    if (overdue.length) {
      attention.push({
        label: `Долги в просрочке: ${money(overdueSum)}`,
        detail: `${num(overdue.length)} заявок дольше ${DEBT_OVERDUE_DAYS} дней`,
        href: "/finance/debts",
        tone: "critical",
      });
    }
    if (unconfirmed.length) {
      attention.push({
        label: `Ждут подтверждения дольше суток: ${num(unconfirmed.length)}`,
        detail: "склад не может их собирать",
        href: "/orders?stage=wait_confirm",
        tone: "warn",
      });
    }
    if ((extras.expiredStems ?? 0) > 0) {
      const share = extras.stockStems ? Math.round(((extras.expiredStems ?? 0) / extras.stockStems) * 100) : 0;
      attention.push({
        label: `Лежит дольше срока хранения: ${num(extras.expiredStems ?? 0)} шт.`,
        detail: `${share ? `${share} % склада · ` : ""}продать со скидкой, списать или сверить остаток`,
        href: role === ROLES.ADMIN ? "/warehouse/writeoff?mode=recount" : "/analytics",
        tone: share >= 10 ? "critical" : "warn",
      });
    }
    if (overpaid.length) {
      attention.push({
        label: `Переплаты: ${num(overpaid.length)} на ${money(overpaid.reduce((s, o) => s + overpaidOf(o), 0))}`,
        detail: "вернуть клиенту или проверить ввод",
        href: "/finance",
        tone: "warn",
      });
    }
    if ((extras.openClaims ?? 0) > 0) {
      attention.push({
        label: `Открытые рекламации: ${num(extras.openClaims ?? 0)}`,
        detail: "ждут решения бухгалтера",
        href: "/finance/claims",
        tone: "warn",
      });
    }
    if (noDate.length) {
      attention.push({
        label: `Без даты доставки: ${num(noDate.length)}`,
        detail: "выпадают из листа сборки",
        href: "/orders?stage=open",
        tone: "warn",
      });
    }

    return {
      title: "Требует внимания",
      subtitle:
        role === ROLES.ADMIN
          ? "Не «как идут дела» — это в Аналитике, — а что стоит на месте и ждёт решения. Каждая строка ведёт к делу."
          : "Отдел продаж: что стоит и кто должен. Оплаты отмечает бухгалтер.",
      aboveStock: true,
      showStock: true,
      attention,
      stats: [
        {
          label: "Опаздывают",
          value: num(late.length),
          hint: late.length ? `${num(lateStems)} шт. не отгружено` : "опозданий нет",
          href: "/orders?stage=late",
          tone: late.length ? "critical" : "good",
        },
        {
          label: "Ждут подтверждения",
          value: num(open.filter(({ st }) => st.key === "wait_confirm").length),
          hint: "склад не может собирать",
          href: "/orders?stage=wait_confirm",
          tone: unconfirmed.length ? "warn" : "default",
        },
        {
          label: "Просрочено",
          value: money(overdueSum),
          hint: `${num(overdue.length)} заявок дольше ${DEBT_OVERDUE_DAYS} дней`,
          href: "/finance/debts",
          tone: overdueSum > 0 ? "critical" : "good",
        },
        {
          label: "Должны нам всего",
          value: money(debtSum),
          hint: `${num(withDebt.length)} незакрытых заявок`,
          href: "/finance/debts",
          tone: withDebt.length > 0 ? "warn" : "good",
        },
      ],
    };
  }

  if (role === ROLES.ACCOUNTANT) {
    const attention: AttentionItem[] = [];
    if (overpaid.length) {
      attention.push({
        label: `Переплаты: ${num(overpaid.length)} на ${money(overpaid.reduce((s, o) => s + overpaidOf(o), 0))}`,
        detail: "вернуть клиенту или проверить ввод",
        href: "/finance",
        tone: "warn",
      });
    }
    if ((extras.openClaims ?? 0) > 0) {
      attention.push({
        label: `Рекламации ждут решения: ${num(extras.openClaims ?? 0)}`,
        detail: "провести или отклонить",
        href: "/finance/claims",
        tone: "warn",
      });
    }
    return {
      title: "Деньги на сегодня",
      subtitle: "Долги по всей базе, а не за период: висяк не перестаёт быть висяком от смены месяца.",
      aboveStock: true,
      // Бухгалтеру склад не нужен вовсе: её вопрос — кто должен и кому звонить.
      showStock: false,
      attention,
      stats: [
        {
          label: "Должны нам",
          value: money(debtSum),
          hint: `${num(withDebt.length)} незакрытых заявок`,
          href: "/finance/debts",
          tone: debtSum > 0 ? "warn" : "good",
        },
        {
          label: "Просрочено",
          value: money(overdueSum),
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

  if (role === ROLES.WAREHOUSE) {
    const open = withStage.filter(({ st }) => isOpenStage(st));
    const canShip = open.filter(({ st }) => isShippable(st));
    const late = canShip.filter(({ st }) => st.lateDays > 0);
    const today = open.filter(({ o }) => o.deliveryDate === todayKey);
    return {
      title: "Очередь на отгрузку",
      subtitle: "Отгружать можно только подтверждённые и оплаченные (или в долг по условиям клиента).",
      action: { href: "/warehouse/picklist", label: "Лист сборки на сегодня" },
      // Склад и есть её работа — сводка остаётся первой (решение владельца), а
      // очередь сверху обозначена одной строкой, чтобы до неё не листать.
      aboveStock: false,
      showStock: true,
      strip: canShip.length
        ? {
            text:
              `К отгрузке: ${num(canShip.length)}` + (late.length ? ` · опаздывают: ${num(late.length)}` : ""),
            href: "/warehouse",
            tone: late.length ? "critical" : "default",
          }
        : undefined,
      stats: [
        {
          label: "Можно отгружать",
          value: num(canShip.length),
          hint: canShip.length ? "подтверждены и оплачены" : "готовых нет",
          href: "/warehouse",
          tone: canShip.length ? "good" : "default",
        },
        {
          label: "Опаздывают",
          value: num(late.length),
          hint: late.length ? "доставка прошла — отгрузите или отметьте" : "опозданий нет",
          href: "/warehouse",
          tone: late.length ? "critical" : "default",
        },
        {
          label: "Ждут",
          value: num(open.length - canShip.length),
          hint: "подтверждения или денег",
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

export function focusReason(order: FocusOrder): string {
  const missing = missingForShip(order);
  return missing.length === 0 ? "" : `Ждёт ${missing.join(" и ")}`;
}

/** Городская заявка в счёт менеджеру не идёт — она общая. */
export function isOwnSellable(order: FocusOrder): boolean {
  return !isRegionOrder(order);
}
