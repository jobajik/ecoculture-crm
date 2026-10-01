import { FLOWER_TYPE_LABELS, formatGrade, getGradesFor } from "./constants";
import { prettyKaspiPhone } from "./kaspiInvoice";

// ---------------------------------------------------------------------------
// Заказ, который бот принял в WhatsApp, — полный цикл (владелец, 01.10.2026:
// «бот продаёт в полный цикл: отработал клиента, взял заказ, отправил заявку на
// склад, выставил счёт, удостоверился, что счёт оплачен»). Здесь — чистые
// правила: что модель прислала и можно ли по этому оформить заявку, и тексты
// клиенту. Запись и счёт — `botOrderRunner.ts`, проверка — `check-bot-order`.
//
// Модели НЕ верим (грабли 1.11): цветок, сорт и градация сверяются со складом,
// цена берётся из прайса, количество — не больше склада, дата — не раньше сегодня.
// ---------------------------------------------------------------------------

/** Что модель присылает, когда клиент подтвердил заказ. */
export interface BotOrderDraft {
  confirmed: boolean;
  items: { flowerType: string; variety: string; grade: string; quantity: number }[];
  deliveryDate: string;
  city: string;
  shopName: string;
  address: string;
  note: string;
}

export const EMPTY_BOT_ORDER: BotOrderDraft = {
  confirmed: false,
  items: [],
  deliveryDate: "",
  city: "",
  shopName: "",
  address: "",
  note: "",
};

/** Часть схемы ответа модели — заказ. Ключевых слов вроде maxLength нет: строгий режим OpenAI их не берёт. */
export const BOT_ORDER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["confirmed", "items", "deliveryDate", "city", "shopName", "address", "note"],
  properties: {
    confirmed: { type: "boolean", description: "true — клиент ЯВНО подтвердил заказ («да», «оформляйте»). Иначе false и всё пусто." },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["flowerType", "variety", "grade", "quantity"],
        properties: {
          flowerType: { type: "string", description: "rose, chrysanthemum или eustoma" },
          variety: { type: "string", description: "Сорт точно как в складе" },
          grade: { type: "string", description: "Категория или длина точно как в складе" },
          quantity: { type: "integer", description: "Сколько стеблей" },
        },
      },
    },
    deliveryDate: { type: "string", description: "Дата доставки ГГГГ-ММ-ДД" },
    city: { type: "string", description: "Город доставки" },
    shopName: { type: "string", description: "Название точки клиента (для нового клиента)" },
    address: { type: "string", description: "Адрес доставки, если назвал" },
    note: { type: "string", description: "Пожелания клиента коротко или пусто" },
  },
} as const;

/** Ответ модели → черновик заказа. Странное — пустой неподтверждённый. */
export function parseBotOrder(raw: unknown): BotOrderDraft {
  if (!raw || typeof raw !== "object") return EMPTY_BOT_ORDER;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const items = (Array.isArray(r.items) ? r.items : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x) => ({
      flowerType: text(x.flowerType, 30).toLowerCase(),
      variety: text(x.variety, 80),
      grade: text(x.grade, 40),
      quantity: Math.round(Number(x.quantity)),
    }))
    .slice(0, 20);
  return {
    confirmed: r.confirmed === true && items.length > 0,
    items,
    deliveryDate: text(r.deliveryDate, 10),
    city: text(r.city, 60),
    shopName: text(r.shopName, 100),
    address: text(r.address, 200),
    note: text(r.note, 300),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/** «60 см», «60», «третья», «3 категория» → градация из нашего списка; не узналась — пусто. */
export function normalizeGrade(flowerType: string, raw: string): string {
  const grades = getGradesFor(flowerType);
  // \b в JS не видит границу кириллического слова — поэтому явные пробел и конец строки.
  const t = norm(raw).replace(/\s*см\.?(?=\s|$)/, "").replace(/\s*категори[яи](?=\s|$)/, "").trim();
  const exact = grades.find((g) => norm(g) === t);
  if (exact) return exact;
  if (flowerType === "chrysanthemum") {
    const byNumber: Record<string, string> = { "1": "Первая", "2": "Вторая", "3": "Третья", "4": "Четвёртая", "высш": "Высшая" };
    const key = Object.keys(byNumber).find((k) => t === k || t.startsWith(k));
    if (key && grades.includes(byNumber[key])) return byNumber[key];
  }
  return "";
}

export interface StockRow {
  flower: string;
  variety: string;
  grade: string;
  qty: number;
}

export interface PlannedItem {
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  unitPrice: number;
}

export type BotOrderPlan =
  | { ok: true; items: PlannedItem[]; deliveryDate: string }
  | { ok: false; question: string };

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const itemName = (flowerType: string, variety: string, grade: string) =>
  `${FLOWER_TYPE_LABELS[flowerType] ?? flowerType}${variety ? ` ${variety}` : ""}${grade ? `, ${formatGrade(grade)}` : ""}`;

/**
 * Можно ли оформить заявку по тому, что прислала модель. Нельзя — вопрос
 * клиенту, который это исправит: бот спросит, а не оформит неправильно.
 */
export function planBotOrder(input: {
  draft: BotOrderDraft;
  stock: StockRow[];
  priceOf: (flowerType: string, variety: string, grade: string) => number;
  today: string;
}): BotOrderPlan {
  const { draft, stock, today } = input;
  if (!draft.confirmed || draft.items.length === 0) return { ok: false, question: "Что и сколько поставить в заказ?" };
  const date = draft.deliveryDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > addDays(today, 14)) {
    return { ok: false, question: "На какой день сделать доставку?" };
  }
  const merged = new Map<string, PlannedItem>();
  for (const it of draft.items) {
    if (!FLOWER_TYPE_LABELS[it.flowerType]) return { ok: false, question: "Уточните, пожалуйста, какой цветок: роза, хризантема или эустома?" };
    if (!Number.isFinite(it.quantity) || it.quantity <= 0 || it.quantity > 100000) {
      return { ok: false, question: `Сколько штук «${itemName(it.flowerType, it.variety, it.grade)}» поставить?` };
    }
    const grade = normalizeGrade(it.flowerType, it.grade);
    const rows = stock.filter((s) => s.flower === it.flowerType && norm(s.variety) === norm(it.variety));
    if (!it.variety || rows.length === 0) {
      const kinds = Array.from(new Set(stock.filter((s) => s.flower === it.flowerType).map((s) => s.variety))).slice(0, 6);
      return {
        ok: false,
        question: kinds.length
          ? `Какой сорт ${(FLOWER_TYPE_LABELS[it.flowerType] ?? "").toLowerCase()} поставить? Сейчас есть: ${kinds.join(", ")}.`
          : `${FLOWER_TYPE_LABELS[it.flowerType]} сейчас нет на складе. Предложить другой цветок?`,
      };
    }
    const variety = rows[0].variety;
    const row = rows.find((s) => s.grade === grade);
    if (!grade || !row) {
      const have = rows.map((s) => formatGrade(s.grade)).join(", ");
      return { ok: false, question: `${itemName(it.flowerType, variety, "")}: какую ${it.flowerType === "chrysanthemum" ? "категорию" : "длину"} поставить? Есть: ${have}.` };
    }
    const key = `${it.flowerType}|${variety}|${grade}`;
    const quantity = (merged.get(key)?.quantity ?? 0) + it.quantity;
    if (quantity > row.qty) {
      const can = row.qty >= 1000 ? Math.floor(row.qty / 100) * 100 : Math.floor(row.qty / 10) * 10;
      return {
        ok: false,
        question: can > 0
          ? `${itemName(it.flowerType, variety, grade)} сейчас есть около ${can} шт. Поставить ${can}?`
          : `${itemName(it.flowerType, variety, grade)} сейчас закончилась. Предложить похожую позицию?`,
      };
    }
    const unitPrice = input.priceOf(it.flowerType, variety, grade);
    if (!(unitPrice > 0)) return { ok: false, question: `На ${itemName(it.flowerType, variety, grade)} уточняю цену. Взять пока другую позицию?` };
    merged.set(key, { flowerType: it.flowerType, variety, grade, quantity, unitPrice });
  }
  return { ok: true, items: Array.from(merged.values()), deliveryDate: date };
}

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ")} ₸`;
const dayText = (day: string) => (/^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8, 10)}.${day.slice(5, 7)}` : day);

export interface InvoiceOutcome {
  farmLabel: string;
  amount: number;
  /** sent — счёт ушёл; manual — касса не подключена; failed — не ушёл. */
  result: "sent" | "manual" | "failed";
  phone: string;
  error?: string;
}

// --- Тексты клиенту ------------------------------------------------------------
//
// Оформление WhatsApp (владелец, 01.10.2026: «не нравится визуал — идут стеной
// текста»): короткие блоки через пустую строку, позиции и варианты — списком «•»,
// главное (номер заказа, сумма) — *жирным* (звёздочки — разметка WhatsApp).

/** Подтверждение клиенту: номер заказа, позиции, сумма, счета. */
export function botOrderText(input: {
  code: string;
  items: PlannedItem[];
  deliveryDate: string;
  city: string;
  invoices: InvoiceOutcome[];
}): string {
  const lines = input.items.map(
    (i) =>
      `• ${itemName(i.flowerType, i.variety, i.grade)} — ${i.quantity} шт. × ${money(i.unitPrice)}` +
      (input.items.length > 1 ? ` = ${money(i.quantity * i.unitPrice)}` : "")
  );
  const total = input.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const out = [
    `*Заказ №${input.code} оформлен*`,
    "",
    ...lines,
    "",
    `Итого: *${money(total)}*`,
    `Доставка: ${dayText(input.deliveryDate)}${input.city ? `, ${input.city}` : ""}`,
    "",
  ];
  const many = input.invoices.length > 1;
  for (const inv of input.invoices.filter((i) => i.result === "sent")) {
    out.push(`Счёт Kaspi${many ? ` (${inv.farmLabel})` : ""} на *${money(inv.amount)}* отправлен на номер ${prettyKaspiPhone(inv.phone)} — оплатите в приложении Kaspi.`);
  }
  for (const inv of input.invoices.filter((i) => i.result !== "sent")) {
    out.push(`Счёт${many ? ` (${inv.farmLabel})` : ""} на *${money(inv.amount)}* пришлём сюда же в ближайшее время.`);
  }
  out.push("", "После оплаты заказ сразу уйдёт на сборку — я напишу.");
  return out.join("\n");
}

export function botPaidText(input: { code: string; amount: number; fullyPaid: boolean; deliveryDate: string }): string {
  return input.fullyPaid
    ? `*Оплата получена* — ${money(input.amount)} по заказу №${input.code}. Спасибо!\n\nЗаказ передан на сборку, доставка ${dayText(input.deliveryDate)}.`
    : `*Оплата получена* — ${money(input.amount)} по заказу №${input.code}. Спасибо!\n\nЖдём оплату по второму счёту — после неё заказ уйдёт на сборку.`;
}

export function botInvoiceErrorText(input: { code: string; phone: string; reason: string }): string {
  return [
    `Счёт Kaspi по заказу №${input.code} на номер ${prettyKaspiPhone(input.phone)} *не дошёл*: ${input.reason}.`,
    "",
    "Напишите номер, к которому привязан ваш Kaspi, — выставлю счёт заново.",
  ].join("\n");
}

export function botReminderText(input: { code: string; amount: number; reissued: boolean }): string {
  const head = input.reissued
    ? `Напоминаю про заказ №${input.code}: прошлый счёт истёк, я выставил новый на *${money(input.amount)}* — он в приложении Kaspi.`
    : `Напоминаю про заказ №${input.code}: счёт Kaspi на *${money(input.amount)}* ждёт оплаты в приложении Kaspi.`;
  return `${head}\n\nПосле оплаты заказ сразу уйдёт на сборку.`;
}

/**
 * Клиент отклонил счёт Kaspi (владелец, 01.10.2026: «я отклонил оплату, которую
 * бот мне выставил — теперь нужно же какое-то взаимодействие клиенту»). Не
 * выставлять заново молча, а спросить, что не так, и предложить выходы.
 */
export function botDeclinedText(input: { code: string; amount: number }): string {
  return [
    `Счёт Kaspi по заказу №${input.code} на *${money(input.amount)}* отклонён. Что-то не так?`,
    "",
    "Могу:",
    "• поменять количество или сорт",
    "• перенести доставку",
    "• выставить счёт заново или на другой номер Kaspi",
    "• отменить заказ, если он уже не нужен",
    "",
    "Напишите, как вам удобнее.",
  ].join("\n");
}

/** Назавтра после отклонённого счёта клиент молчит — один раз спросить, держать ли заказ. */
export function botDeclinedReminderText(input: { code: string; amount: number }): string {
  return [
    `Заказ №${input.code} на *${money(input.amount)}* пока ждёт оплаты — счёт был отклонён.`,
    "",
    "Держать заказ за вами? Могу выставить счёт заново или отменить.",
  ].join("\n");
}

/** Заказ отменён по просьбе клиента. */
export function botCancelledText(code: string): string {
  return `Заказ №${code} отменил.`;
}

/**
 * Текст модели — в разметку WhatsApp: «**жирный**» (Markdown) → «*жирный*»,
 * без заголовков «#», маркеры списка «-»/«*» → «•», не больше одной пустой строки.
 */
export function toWhatsApp(text: string): string {
  return String(text || "")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^[ \t]*[-*][ \t]+/gm, "• ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
