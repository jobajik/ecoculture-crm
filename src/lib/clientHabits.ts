/**
 * Привычки постоянных клиентов менеджера (09.11.2026, владелец: «определить привычку и периодичность клиентов по Ильясу
 * (Эмилю), чтобы каждую неделю делать рассылку ботом по его постоянникам от имени Ильяса»).
 *
 * Привычка считается из заявок клиента за окно (90 дней): как часто заказывает (медиана промежутка между заявками), в какой
 * день недели обычно (самый частый), что берёт обычно (позиции по стеблям, у каждой — обычное количество, медиана) и на
 * какую сумму. «Постоянник» — от `minOrders` заявок в окне и промежуток не больше `maxGapDays`.
 *
 * Рассылка постояннику (`habitDue`): в его день недели, не чаще раза в `MIN_SEND_GAP_DAYS`, не раньше чем через 3 дня
 * после его последней заявки, не если он сам писал за последние сутки и не если отписался. Текст собирает код
 * (`habitText`): от имени менеджера, одна–две его обычные позиции с ценой и наличием сейчас, вопрос «оформить как обычно?».
 * Чистые функции, проверка — `scripts/check-client-habits.ts`.
 */
import { FLOWER_TYPE_LABELS, formatGrade, isMiniMixVariety } from "./constants";

export const HABIT_WINDOW_DAYS = 90;
export const HABIT_MIN_ORDERS = 3;
export const HABIT_MAX_GAP_DAYS = 21;
export const MIN_SEND_GAP_DAYS = 6;
export const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

export interface HabitOrderItem {
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  unitPrice: number;
}

export interface HabitOrder {
  orderId: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  managerEmail: string;
  /** День оформления, «ГГГГ-ММ-ДД». */
  day: string;
  items: HabitOrderItem[];
  totalAmount: number;
}

export interface UsualItem {
  flowerType: string;
  variety: string;
  grade: string;
  /** Обычное количество за заявку (медиана), округлено до 10. */
  qty: number;
  /** В скольких заявках была позиция. */
  times: number;
}

export interface ClientHabit {
  clientId: string;
  name: string;
  phone: string;
  managerEmail: string;
  orders: number;
  firstAt: string;
  lastAt: string;
  /** Медиана промежутка между заявками, дней. 0 — одна заявка. */
  medianGapDays: number;
  /** Самый частый день недели заявок: 0 — вс … 6 — сб. */
  weekday: number;
  /** Доля заявок в этот день недели. */
  weekdayShare: number;
  usual: UsualItem[];
  avgAmount: number;
  /** Когда ждём следующую заявку: последняя + медиана. */
  nextExpectedAt: string;
  regular: boolean;
}

const dayOf = (iso: string) => (iso || "").slice(0, 10);
const addDays = (day: string, n: number) => {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r10 = (x: number) => Math.max(10, Math.round(x / 10) * 10);

export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** Привычки клиентов одного менеджера (или всех, если менеджер не задан) по заявкам за окно. */
export function buildHabits(
  orders: HabitOrder[],
  today: string,
  opts: { managerEmail?: string; windowDays?: number; minOrders?: number; maxGapDays?: number } = {}
): ClientHabit[] {
  const window = opts.windowDays ?? HABIT_WINDOW_DAYS;
  const from = addDays(today, -window);
  const mine = orders.filter((o) => o.day >= from && o.day <= today && (!opts.managerEmail || o.managerEmail === opts.managerEmail));
  const byClient = new Map<string, HabitOrder[]>();
  for (const o of mine) {
    const key = o.clientId || o.clientPhone;
    if (!key) continue;
    const list = byClient.get(key) ?? [];
    list.push(o);
    byClient.set(key, list);
  }
  const out: ClientHabit[] = [];
  for (const [key, list] of byClient) {
    // Несколько заявок в один день — один «заказ» для периодичности.
    const days = Array.from(new Set(list.map((o) => o.day))).sort();
    const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d));
    const wd = new Map<number, number>();
    for (const d of days) wd.set(weekdayOf(d), (wd.get(weekdayOf(d)) ?? 0) + 1);
    const [weekday, wdCount] = Array.from(wd.entries()).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    const items = new Map<string, { qtys: number[]; stems: number; item: HabitOrderItem }>();
    for (const o of list) {
      const perOrder = new Map<string, number>();
      for (const it of o.items) {
        if (it.quantity <= 0) continue;
        const k = `${it.flowerType}|${it.variety}|${it.grade}`;
        perOrder.set(k, (perOrder.get(k) ?? 0) + it.quantity);
        if (!items.has(k)) items.set(k, { qtys: [], stems: 0, item: it });
      }
      for (const [k, q] of perOrder) {
        const e = items.get(k)!;
        e.qtys.push(q);
        e.stems += q;
      }
    }
    const usual = Array.from(items.values())
      .sort((a, b) => b.stems - a.stems)
      .slice(0, 3)
      .map((e) => ({ flowerType: e.item.flowerType, variety: e.item.variety, grade: e.item.grade, qty: r10(median(e.qtys)), times: e.qtys.length }));
    const last = list.reduce((a, b) => (a.day > b.day ? a : b));
    const medianGap = Math.round(median(gaps));
    const minOrders = opts.minOrders ?? HABIT_MIN_ORDERS;
    const maxGap = opts.maxGapDays ?? HABIT_MAX_GAP_DAYS;
    out.push({
      clientId: last.clientId || key,
      name: last.clientName,
      phone: last.clientPhone,
      managerEmail: last.managerEmail,
      orders: days.length,
      firstAt: days[0],
      lastAt: days[days.length - 1],
      medianGapDays: medianGap,
      weekday,
      weekdayShare: days.length ? wdCount / days.length : 0,
      usual,
      avgAmount: Math.round(list.reduce((s, o) => s + o.totalAmount, 0) / list.length),
      nextExpectedAt: medianGap > 0 ? addDays(days[days.length - 1], medianGap) : "",
      regular: days.length >= minOrders && medianGap > 0 && medianGap <= maxGap,
    });
  }
  return out.sort((a, b) => b.orders - a.orders || b.avgAmount - a.avgAmount);
}

/** Пора ли писать постояннику сегодня, и почему нет. */
export function habitDue(
  h: ClientHabit,
  today: string,
  ctx: { lastSentAt?: string; lastClientMsgAt?: string; optedOut?: boolean; orderedSince?: string }
): { due: boolean; why: string } {
  if (!h.regular) return { due: false, why: "не постоянник" };
  if (ctx.optedOut) return { due: false, why: "отписался" };
  if (weekdayOf(today) !== h.weekday) return { due: false, why: `его день — ${WEEKDAYS[h.weekday]}` };
  const lastOrder = ctx.orderedSince && ctx.orderedSince > h.lastAt ? ctx.orderedSince : h.lastAt;
  if (daysBetween(lastOrder, today) < 3) return { due: false, why: "заказывал на днях" };
  if (ctx.lastSentAt && daysBetween(dayOf(ctx.lastSentAt), today) < MIN_SEND_GAP_DAYS) return { due: false, why: "писали меньше недели назад" };
  if (ctx.lastClientMsgAt && Date.parse(ctx.lastClientMsgAt) > Date.parse(`${today}T00:00:00+05:00`) - 86400000) return { due: false, why: "сам писал за сутки" };
  return { due: true, why: "" };
}

export interface HabitOffer {
  item: UsualItem;
  price: number;
  /** Свободный остаток на складе сейчас; 0 — нет. */
  stock: number;
}

export function usualLabel(it: { flowerType: string; variety: string; grade: string }): string {
  const flower = FLOWER_TYPE_LABELS[it.flowerType] ?? it.flowerType;
  if (isMiniMixVariety(it.variety)) return `${flower} ${it.variety}`;
  return `${flower} ${it.variety}, ${formatGrade(it.grade)}`;
}

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ")} ₸`;

/** Слова, с которых начинается название точки, а не имя человека (первое слово карточки). */
const STORE_WORDS = new Set([
  "цветы", "цветок", "цветочный", "цветочная", "цветочное", "цветочки", "магазин", "салон", "студия", "бутик", "лавка", "точка",
  "дом", "мир", "база", "опт", "оптовик", "оптовый", "оптовая", "рынок", "павильон", "киоск", "букет", "букеты", "центр", "сеть",
  "компания", "фирма", "клиент", "новый", "новая", "новое", "старый", "мини", "микс", "эко", "арт", "флора", "флорист",
  "флористика", "флористы", "доставка", "свадебный", "свадебная", "декор", "ателье", "агентство", "ресторан", "кафе", "отель",
  "гостиница", "школа", "садик", "детский", "зелёный", "зеленый", "белый", "красный", "розовый", "гипермаркет", "супермаркет",
  "маркет", "корзина", "оранжерея", "теплица", "питомник", "сад", "бутон", "лепесток", "лепестки", "аромат", "гармония",
]);

/**
 * Как обратиться к клиенту по карточке: первое слово, если оно похоже на имя (кириллица с большой буквы, не «ИП/ТОО»,
 * не слово из названий точек). В базе карточки вида «Асем Каскелен», «Мира новый», «Лена Фабричный» — имя и пометка
 * менеджера, здороваемся «Асем», «Мира», «Лена»; «Цветы 24», «ТОО Ромашка», «Клиент WhatsApp 1234» — без имени.
 */
export function habitGreetingName(name: string): string {
  const clean = (name || "").trim().replace(/^["«»'„“]+|["«»'„“]+$/g, "");
  if (!clean || /^(ип|тоо|ооо|ao|ао)\b/i.test(clean)) return "";
  const words = clean.split(/\s+/);
  if (words.length > 3) return "";
  const first = words[0].replace(/[,.;:!?]+$/, "");
  if (!/^[А-ЯЁӘҒҚҢӨҰҮҺІ][а-яёәғқңөұүһі]{1,14}$/.test(first)) return "";
  if (STORE_WORDS.has(first.toLowerCase())) return "";
  return first;
}

/**
 * Текст постояннику от имени менеджера: одна-две обычные позиции, которые есть на складе, с ценой, и вопрос
 * «оформить как обычно?». Позиций на складе нет — короткое «что есть сегодня» без цифр. Без длинных тире.
 */
export function habitText(h: ClientHabit, managerName: string, offers: HabitOffer[], greeting = "Здравствуйте"): string {
  const name = habitGreetingName(h.name);
  const hello = name ? `${greeting}, ${name}!` : `${greeting}!`;
  const inStock = offers.filter((o) => o.stock > 0 && o.price > 0).slice(0, 2);
  if (!inStock.length) {
    return `${hello} Это ${managerName}, Ecoculture.\n\nНа этой неделе свежий срез, цены прежние. Скинуть, что есть сегодня, с фото?`;
  }
  const lines = inStock.map((o) => `• ${usualLabel(o.item)}: *${money(o.price)}*`).join("\n");
  const first = inStock[0];
  const qty = Math.min(first.item.qty, Math.floor(first.stock / 10) * 10 || first.item.qty);
  return `${hello} Это ${managerName}, Ecoculture.\n\nСвежий срез, как вы обычно берёте:\n${lines}\n\nОформить как обычно, ${qty} шт. ${usualLabel(first.item)}? Напишите, на какой день.`;
}
