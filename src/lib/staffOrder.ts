import { FLOWER_TYPE_LABELS, formatGrade, ROLES } from "./constants";
import { parseBotOrder, type BotOrderDraft, type PlannedItem } from "./botOrder";
import type { StaffTarget } from "./staffCommand";

// ---------------------------------------------------------------------------
// Заявка клиенту по поручению менеджера (12.11.2026). Владелец прислал снимок чата основного номера: менеджер переслал
// туда наше предложение клиенту («Сделаю 5 пачек Alissa Pink и 3 пачки Alissa 1 Pure White, это 80 шт., на завтра -
// 32 000 ₸. Всё верно, оформляем?») и написал «Чат бот, прими заявку у Карины» — бот ответил «пока по поручению умею…».
// «Научись это делать по запросу менеджеров».
//
// Как устроено: клиента находит КОД (как для фото — `matchTargets`), состав заказа вынимает модель — из самого
// поручения, из того, что менеджер переслал боту прямо перед ним, или из переписки с клиентом (последнее конкретное
// предложение). Модели не верим (грабли 1.11): склад, цены, пачки, дату и повторы проверяет тот же путь, что у бота
// (`placeBotOrder`). Менеджеру уходит ПЛАН — позиции, сумма, день, куда уйдёт счёт — и «ответьте ДА»: заявка со счётом
// Kaspi и сообщением клиенту слишком дорогая ошибка, чтобы оформлять по догадке. «ДА» — заявка, счёт, сообщение клиенту
// с номера, где он переписывается; «НЕТ» — ничего. Здесь — чистые правила; работа — `staffOrderRunner.ts`.
// ---------------------------------------------------------------------------

/** Настройка с планом заявки, который ждёт «ДА»: `StaffOrder:<номер сотрудника>`. */
export const STAFF_ORDER_PREFIX = "StaffOrder:";
/** Сколько план ждёт «ДА». Склад за это время мог уйти — при оформлении всё проверяется заново. */
export const STAFF_ORDER_TTL_MS = 3 * 3600000;
/** Сколько минут назад сообщения менеджера боту считаются «пересланными к этому поручению». */
export const STAFF_ORDER_FORWARD_MINUTES = 15;
/** Сколько дней переписки с клиентом показываем модели и сколько сообщений. */
export const STAFF_ORDER_CHAT_DAYS = 4;
export const STAFF_ORDER_CHAT_MESSAGES = 30;

export interface StaffOrderPending {
  at: string;
  target: StaffTarget;
  draft: BotOrderDraft;
  /** Номер для счёта Kaspi (из карточки клиента или номер WhatsApp); пусто — номер WhatsApp. */
  kaspiPhone: string;
  /** Откуда модель взяла состав — одной фразой, для отчёта. */
  basis: string;
}

export function parseStaffOrderPending(raw: string | undefined, now = Date.now()): StaffOrderPending | null {
  try {
    const p = JSON.parse(raw || "") as StaffOrderPending;
    if (!p?.at || !p.target?.phone || !p.draft || !Array.isArray(p.draft.items) || !p.draft.items.length) return null;
    if (now - Date.parse(p.at) > STAFF_ORDER_TTL_MS) return null;
    return { at: p.at, target: p.target, draft: { ...parseBotOrder({ ...p.draft, confirmed: true }) }, kaspiPhone: String(p.kaspiPhone || ""), basis: String(p.basis || "") };
  } catch {
    return null;
  }
}

/** Кому бот оформляет заявку по поручению: тем, кто продаёт клиентам, и администратору. */
export function canOrderByCommand(role: string | null | undefined): boolean {
  return role === ROLES.MANAGER || role === ROLES.SALES_HEAD || role === ROLES.ADMIN;
}

// --- Что спросить у модели --------------------------------------------------------------

const S = (description: string) => ({ type: "string", description });

/** Ключевых слов вроде maxLength нет: строгий режим OpenAI на незнакомом отказывает целиком. */
export const STAFF_ORDER_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["items", "deliveryDate", "address", "note", "basis", "unclear"],
  properties: {
    items: {
      type: "array",
      description: "Позиции ОДНОГО заказа — самого свежего. Нет состава — пусто.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["flowerType", "variety", "grade", "quantity"],
        properties: {
          flowerType: { type: "string", enum: ["rose", "chrysanthemum", "chrysanthemum_rf", "eustoma"], description: "Как в списке «Что есть сейчас»." },
          variety: S("Сорт ТОЧНО как в списке «Что есть сейчас»."),
          grade: S("Категория или длина ТОЧНО как в списке «Что есть сейчас». Не названа и по цене не определяется однозначно — пусто."),
          quantity: { type: "integer", description: "Сколько СТЕБЛЕЙ (пачки переведи в штуки по паккингу)." },
        },
      },
    },
    deliveryDate: S("День доставки ГГГГ-ММ-ДД. «Завтра», «сегодня», «в пятницу» считай от даты ТОГО сообщения, где это сказано. Не назван — пусто."),
    address: S("Адрес доставки, если назван в этом заказе. Иначе пусто."),
    note: S("Пожелания клиента к этому заказу коротко (упаковка, время). Иначе пусто."),
    basis: S("Откуда взят состав, одной короткой фразой: «ваше поручение», «пересланное сообщение 18:47», «наше предложение клиенту 12.11 18:40»."),
    unclear: S("Если состав определить нельзя — чего не хватает, одной фразой. Иначе пусто."),
  },
};

export function staffOrderSystemPrompt(): string {
  return [
    "Ты помогаешь менеджеру компании Ecoculture (оптовые цветы: розы, хризантемы, эустома) оформить заявку клиенту в CRM.",
    "Менеджер написал рабочему боту поручение принять заявку у клиента. Твоя задача — определить СОСТАВ заказа и день доставки.",
    "",
    "Откуда брать состав — по порядку:",
    "1) из самого поручения, если менеджер перечислил позиции («оформи Карине: Alissa Pink 50 шт на завтра»);",
    "2) из сообщений, которые менеджер переслал боту прямо перед поручением (обычно это наше предложение клиенту или сообщение клиента);",
    "3) из переписки с клиентом: последнее КОНКРЕТНОЕ предложение или заказ — наше сообщение вида «Сделаю … шт. … на завтра - … ₸.",
    "   Всё верно, оформляем?» или сообщение клиента со списком и количеством.",
    "Бери ОДИН заказ — самый свежий. Заказы, после которых в переписке уже есть «Заказ №… оформлен», не бери — они оформлены.",
    "Ничего не выдумывай: позиции и количество — только из этих сообщений. Состава нет — items пусто, в unclear — чего не хватает.",
    "",
    "Позиции: цветок, сорт и категория/длина — ТОЧНО как в списке «Что есть сейчас и почём» (по-русски «Алиса Пинк» — Alissa Pink).",
    "Пачки переводи в штуки по паккингу. Если категория/длина не названа, но названа цена или сумма — возьми ту, у которой",
    "цена сходится с суммой; не сходится однозначно — grade пусто (программа переспросит). Цены не пиши — их поставит программа.",
    "Дата: у каждого сообщения стоит его день и время; «завтра» в сообщении от 12.11 — это 13.11.",
  ].join("\n");
}

export function staffOrderUserPrompt(input: {
  now: string;
  clientName: string;
  command: string;
  forwarded: string;
  chat: string;
  sellable: string;
  packing: string;
}): string {
  return [
    `Сейчас по Алматы: ${input.now}.`,
    `Клиент: ${input.clientName}.`,
    "",
    "ПОРУЧЕНИЕ МЕНЕДЖЕРА:",
    input.command,
    "",
    "СООБЩЕНИЯ МЕНЕДЖЕРА БОТУ ПРЯМО ПЕРЕД ПОРУЧЕНИЕМ:",
    input.forwarded || "(нет)",
    "",
    "ПЕРЕПИСКА С КЛИЕНТОМ (последние сообщения, «Мы» — менеджер или его ИИ-помощник):",
    input.chat || "(переписки нет)",
    "",
    "ЧТО ЕСТЬ СЕЙЧАС И ПОЧЁМ:",
    input.sellable || "(нет данных)",
    input.packing,
  ].join("\n");
}

export function parseStaffOrderDraft(raw: unknown): { draft: BotOrderDraft; basis: string; unclear: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const draft = parseBotOrder({ confirmed: true, items: r.items, deliveryDate: r.deliveryDate, city: "", shopName: "", address: r.address, note: r.note });
  const items = draft.items.filter((i) => FLOWER_TYPE_LABELS[i.flowerType] && Number.isFinite(i.quantity) && i.quantity > 0);
  return {
    draft: { ...draft, items, confirmed: items.length > 0 },
    basis: String(r.basis || "").trim().slice(0, 200),
    unclear: String(r.unclear || "").trim().slice(0, 300),
  };
}

// --- Переписка для модели ------------------------------------------------------------------

/** «12.11 18:47» по Алматы. */
export function almatyStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return `${get("day")}.${get("month")} ${get("hour")}:${get("minute")}`;
}

export interface OrderChatMessage {
  at: string;
  direction: "in" | "out";
  text: string;
}

/** Строки переписки с днём и временем: по ним модель считает «завтра». Длинные сообщения обрезаются. */
export function orderChatLines(messages: OrderChatMessage[], who: { in: string; out: string }): string {
  return [...messages]
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .map((m) => `[${almatyStamp(m.at)}] ${m.direction === "in" ? who.in : who.out}: ${m.text.replace(/\s+/g, " ").trim().slice(0, 600)}`)
    .join("\n");
}

/** Последние сообщения клиента и наши — за `STAFF_ORDER_CHAT_DAYS` дней, не больше `STAFF_ORDER_CHAT_MESSAGES`. */
export function recentChat<T extends { at: string }>(messages: T[], now = new Date()): T[] {
  const since = new Date(now.getTime() - STAFF_ORDER_CHAT_DAYS * 86400000).toISOString();
  return messages
    .filter((m) => m.at >= since)
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .slice(-STAFF_ORDER_CHAT_MESSAGES);
}

/** Что менеджер писал или пересылал боту за последние минуты ДО поручения (само поручение не в счёт). */
export function forwardedBefore<T extends { at: string; messageId: string }>(messages: T[], commandId: string, commandAt: string): T[] {
  const until = Date.parse(commandAt) || Date.now();
  const since = until - STAFF_ORDER_FORWARD_MINUTES * 60000;
  return messages
    .filter((m) => m.messageId !== commandId)
    .filter((m) => {
      const t = Date.parse(m.at);
      // Пересланное и поручение уходят одно за другим и могут прийти в обратном порядке — берём и полминуты после.
      return t >= since && t <= until + 30000;
    })
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .slice(-6);
}

const flat = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/^\[[^\]]*\]\s*/, "")
    .replace(/[^a-zа-яәіңғүұқөһ0-9]+/gi, " ")
    .trim();

/** Сколько часов переписка считается «идущей сейчас» — для выбора между тёзками. */
export const STAFF_ORDER_ACTIVE_HOURS = 48;

/**
 * «Прими заявку у Карины», а Карин в базе пять. Прежде чем переспрашивать менеджера цифрой, смотрим, о ком речь:
 * 1) менеджер переслал боту сообщение из переписки — берём того, в чьём чате оно есть (текст совпадает);
 * 2) иначе — того, с кем переписывались за последние двое суток, если такой один.
 * Не сузилось до одного — возвращаем как было (менеджер выберет цифрой). Угадывать между двумя живыми чатами нельзя.
 */
export function narrowOrderTargets<T extends { phone: string }>(
  targets: T[],
  chats: { phoneKey: string; at: string; text: string }[],
  forwarded: string[],
  keyOf: (phone: string) => string,
  now = new Date()
): T[] {
  if (targets.length <= 1) return targets;
  const keys = new Map(targets.map((t) => [keyOf(t.phone), t]));
  const mine = chats.filter((m) => keys.has(m.phoneKey));
  const fw = forwarded.map(flat).filter((t) => t.length >= 20);
  if (fw.length) {
    const hit = new Set(mine.filter((m) => fw.some((f) => flat(m.text).includes(f) || (flat(m.text).length >= 20 && f.includes(flat(m.text))))).map((m) => m.phoneKey));
    if (hit.size === 1) return targets.filter((t) => hit.has(keyOf(t.phone)));
  }
  const since = new Date(now.getTime() - STAFF_ORDER_ACTIVE_HOURS * 3600000).toISOString();
  const active = new Set(mine.filter((m) => m.at >= since).map((m) => m.phoneKey));
  if (active.size === 1) return targets.filter((t) => active.has(keyOf(t.phone)));
  return targets;
}

/** День по умолчанию, когда его не назвали: завтра (план всё равно ждёт «ДА» — менеджер увидит и поправит). */
export function nextDay(today: string): string {
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// --- Что написать менеджеру ----------------------------------------------------------------

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ")} ₸`;
const dayText = (day: string) => (/^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8, 10)}.${day.slice(5, 7)}` : day);
const tail = (phone: string) => `…${phone.replace(/\D/g, "").slice(-4)}`;
const itemName = (i: { flowerType: string; variety: string; grade: string }) =>
  `${FLOWER_TYPE_LABELS[i.flowerType] ?? i.flowerType}${i.variety ? ` ${i.variety}` : ""}${i.grade ? `, ${formatGrade(i.grade)}` : ""}`;

const STORE_TEXT: Record<string, string> = { "": "основной склад", office: "склад офиса" };

/** План заявки менеджеру: что оформлю, на какой день, куда уйдёт счёт — и «ответьте ДА». */
export function staffOrderPlanText(input: {
  name: string;
  phone: string;
  items: PlannedItem[];
  deliveryDate: string;
  /** День не назвали — поставлен завтрашний. */
  dateGuessed: boolean;
  store: string;
  total: number;
  kaspiPhone: string;
  via: string;
  basis: string;
  newClient: boolean;
  /** Похожая заявка клиента за двое суток — предупредить, что это будет НОВАЯ. */
  similar?: { code: string; createdAt: string; deliveryDate: string; shipped: boolean } | null;
}): string {
  const lines = input.items.map((i) => `• ${itemName(i)} — ${i.quantity} шт. × ${money(i.unitPrice)}${input.items.length > 1 ? ` = ${money(i.quantity * i.unitPrice)}` : ""}`);
  return [
    `Заявка для ${input.name} (${tail(input.phone)})${input.newClient ? " — карточки клиента ещё нет, заведу" : ""}:`,
    "",
    ...lines,
    "",
    `Итого: *${money(input.total)}*`,
    `Доставка: ${dayText(input.deliveryDate)}${input.dateGuessed ? " (день не назван — поставил завтра)" : ""} · ${STORE_TEXT[input.store] ?? `склад «${input.store}»`}`,
    `Счёт Kaspi уйдёт на ${tail(input.kaspiPhone || input.phone)}, клиенту напишу с ${input.via}.`,
    ...(input.basis ? [`Взял из: ${input.basis}.`] : []),
    ...(input.similar
      ? [
          "",
          `Внимание: у клиента уже есть заявка №${input.similar.code} от ${dayText(input.similar.createdAt.slice(0, 10))} с этими же позициями (доставка ${dayText(input.similar.deliveryDate)}${input.similar.shipped ? ", отгружена" : ""}). Это будет НОВАЯ заявка — если речь о той, ответьте НЕТ.`,
        ]
      : []),
    "",
    "Ответьте *ДА* — оформлю и выставлю счёт. *НЕТ* — отмена. Что-то не так — напишите поручение заново с позициями.",
  ].join("\n");
}

/** Состав не понят или склад не сходится — что написать менеджеру. */
export function staffOrderProblemText(name: string, problem: string): string {
  return [
    `Заявку для ${name} не оформил: ${problem.replace(/[.?!]+$/, "")}.`,
    "",
    "Напишите поручение с позициями, например: «Оформи заявку Карине: Alissa Pink Стандарт 50 шт, Altaj третья 100 шт, на завтра» — или перешлите сюда сообщение с заказом и повторите.",
  ].join("\n");
}

/** Заявка оформлена: коротко менеджеру (подробности — в сообщении «оформил заказ №…» и в CRM). */
export function staffOrderDoneText(input: { code: string; name: string; phone: string; via: string; clientText: string; problems: string; sentToClient: boolean }): string {
  return [
    `Готово: заявка №${input.code} для ${input.name} (${tail(input.phone)}).`,
    ...(input.problems ? [`Внимание: ${input.problems}.`] : []),
    input.sentToClient ? `Клиенту написал с ${input.via}:` : "Клиенту написать НЕ получилось — отправьте ему сами:",
    "",
    input.clientText,
  ].join("\n");
}
