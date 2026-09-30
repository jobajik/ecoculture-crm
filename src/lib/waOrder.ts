/**
 * Заказ из WhatsApp → черновик заявки (сентябрь 2026, владелец: «клиент пишет
 * „60 роз по 60 см на завтра“, ИИ сам заполняет заявку, менеджер проверяет и
 * нажимает „подтвердить“»; выбрал кнопку «Оформить», а не заявку без проверки).
 *
 * Путь: вебхук WhatsApp → `looksLikeOrder` (дешёвый фильтр: без цифр и без
 * слов про цветок ИИ не зовём) → модель разбирает сообщение по схеме →
 * `parseWaOrder` проверяет ответ по нашим спискам → строка во вкладке
 * `WaOrderDrafts`. У менеджера в «Заявках» — блок «Заказы из WhatsApp», кнопка
 * «Оформить» открывает обычную форму заявки уже заполненной.
 *
 * ИИ только ПРЕДЛАГАЕТ: черновик — не заявка, он не попадает ни в продажи, ни
 * в лист сборки, пока менеджер не сохранит форму сам.
 */
import { FLOWER_TYPE_LABELS, getGradesFor } from "./constants";
import { phoneKey } from "./leads";
import { priceFromMap } from "./priceList";

export const DRAFT_STATUSES = { NEW: "new", DONE: "done", DISMISSED: "dismissed" } as const;

export interface WaOrderItem {
  flowerType: string;
  /** Сорт из нашего списка; пусто — клиент не назвал, выберет менеджер. */
  variety: string;
  /** Длина или категория из нашего списка; пусто — не назвал. */
  grade: string;
  quantity: number;
}

export interface WaOrderDraft {
  draftId: string;
  createdAt: string;
  phone: string;
  senderName: string;
  messageId: string;
  text: string;
  items: WaOrderItem[];
  deliveryDate: string;
  note: string;
  status: string;
  orderId: string;
  handledByEmail: string;
  handledAt: string;
}

// --- Фильтр перед ИИ ----------------------------------------------------------

const FLOWER_WORDS = /(роз|хриз|эуст|лизиа|кустов|пион|мини|микс|шт|штук|см\b|цвет|букет|ростовк|пачк|упак|бал|сорт)/i;

/**
 * Похоже ли сообщение на заказ. Дёшево и с запасом: лучше позвать ИИ лишний
 * раз, чем пропустить заказ. Но «спасибо», «ок» и «где машина?» не зовут.
 */
export function looksLikeOrder(text: string): boolean {
  const t = String(text || "").trim();
  if (t.length < 4 || t.length > 1500) return false;
  if (!/\d/.test(t)) return false;
  return FLOWER_WORDS.test(t);
}

// --- Модель ----------------------------------------------------------------------

export const WA_ORDER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isOrder", "items", "deliveryDate", "note"],
  properties: {
    isOrder: { type: "boolean", description: "Клиент заказывает цветы (а не спрашивает цену, не благодарит)" },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["flowerType", "variety", "grade", "quantity"],
        properties: {
          flowerType: { type: "string", description: "Код цветка из списка" },
          variety: { type: "string", description: "Сорт из списка или пусто" },
          grade: { type: "string", description: "Длина или категория из списка или пусто" },
          quantity: { type: "integer", description: "Сколько штук (стеблей)" },
        },
      },
    },
    deliveryDate: { type: "string", description: "ГГГГ-ММ-ДД или пусто" },
    note: { type: "string", description: "Прочие пожелания клиента коротко, или пусто" },
  },
} as const;

export type WaCatalog = Record<string, string[]>;

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

/** Подсказка модели: наш ассортимент и сегодняшний день (для «на завтра»). */
export function waOrderSystemPrompt(catalog: WaCatalog, todayKey: string): string {
  const d = new Date(`${todayKey}T12:00:00`);
  const lines = Object.keys(catalog)
    .filter((t) => FLOWER_TYPE_LABELS[t])
    .map(
      (t) =>
        `- ${t} (${FLOWER_TYPE_LABELS[t]}): сорта — ${catalog[t].join(", ") || "—"}; ` +
        `${t === "chrysanthemum" ? "категории" : "длины/градации"} — ${getGradesFor(t).join(", ")}`
    );
  return [
    "Ты помогаешь менеджеру цветочного оптового хозяйства в Казахстане. Клиент написал в WhatsApp.",
    "Определи, заказывает ли он цветы, и разложи заказ по позициям.",
    `Сегодня ${todayKey}, ${WEEKDAYS[d.getDay()]} (Алматы). «Завтра», «в пятницу» и т.п. переведи в дату ГГГГ-ММ-ДД. Дату не назвал — пусто.`,
    "Ассортимент (коды пиши ровно так):",
    ...lines,
    "Правила:",
    "- «роза 60», «60-ка», «60 см» — это градация «60». У розы число после слова см/ростовка — длина, а число штук — количество.",
    "- Сорт и градацию пиши ТОЛЬКО из списка, точным написанием. Не уверен — пусто, менеджер выберет сам.",
    "- «пачка» роз обычно 10 штук, «упаковка»/«бал» — не угадывай, оставь в note.",
    "- Вопрос о цене или наличии без количества — не заказ (isOrder=false).",
    "- Ничего не выдумывай. Не заказ — isOrder=false и пустой список.",
  ].join("\n");
}

/**
 * Ответ модели — как присланное из браузера: чужой цветок, выдуманный сорт или
 * градация, ноль и дроби отбрасываются (грабли 1.11).
 */
export function parseWaOrder(
  raw: unknown,
  catalog: WaCatalog,
  todayKey: string
): { items: WaOrderItem[]; deliveryDate: string; note: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.isOrder !== true) return null;
  const items: WaOrderItem[] = [];
  for (const x of Array.isArray(r.items) ? r.items : []) {
    if (!x || typeof x !== "object") continue;
    const it = x as Record<string, unknown>;
    const flowerType = String(it.flowerType || "").trim().toLowerCase();
    if (!FLOWER_TYPE_LABELS[flowerType] || !catalog[flowerType]) continue;
    const quantity = Math.round(Number(it.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) continue;
    const variety = String(it.variety || "").trim();
    const grade = String(it.grade || "").trim();
    items.push({
      flowerType,
      variety: catalog[flowerType].includes(variety) ? variety : "",
      grade: getGradesFor(flowerType).includes(grade) ? grade : "",
      quantity,
    });
  }
  if (items.length === 0) return null;
  const date = String(r.deliveryDate || "").trim();
  // Дата — не раньше сегодня и не дальше двух месяцев: иначе это ошибка разбора.
  const far = new Date(`${todayKey}T00:00:00`);
  far.setDate(far.getDate() + 60);
  const farKey = `${far.getFullYear()}-${String(far.getMonth() + 1).padStart(2, "0")}-${String(far.getDate()).padStart(2, "0")}`;
  const deliveryDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= todayKey && date <= farKey ? date : "";
  return { items: items.slice(0, 20), deliveryDate, note: String(r.note || "").trim().slice(0, 300) };
}

// --- Кому показывать ------------------------------------------------------------

export interface DraftClient {
  clientId: string;
  name: string;
  phone: string;
  kaspiPay1?: string;
  kaspiPay2?: string;
  managerEmail: string;
  active: boolean;
}

/** Клиент по номеру: телефон карточки или один из её Kaspi-номеров. */
export function clientForPhone<T extends DraftClient>(clients: T[], phone: string): T | null {
  const key = phoneKey(phone);
  if (!key) return null;
  return (
    clients.find((c) => c.active && [c.phone, c.kaspiPay1, c.kaspiPay2].some((p) => phoneKey(p) === key)) ?? null
  );
}

/**
 * Какие черновики видит человек. Менеджер — заказы своих клиентов и тех, кого
 * ещё нет в базе (кто первым оформит, тот и заведёт клиента). Админ — все.
 * Остальным (РОП, склад, бухгалтер, розница) клиентских заявок не оформлять.
 */
export function visibleDrafts<T extends DraftClient>(
  drafts: WaOrderDraft[],
  clients: T[],
  role: string,
  email: string
): { draft: WaOrderDraft; client: T | null }[] {
  if (role !== "admin" && role !== "manager") return [];
  const me = (email || "").toLowerCase();
  return drafts
    .filter((d) => d.status === DRAFT_STATUSES.NEW)
    .map((draft) => ({ draft, client: clientForPhone(clients, draft.phone) }))
    .filter(({ client }) => role === "admin" || !client || (client.managerEmail || "").toLowerCase() === me)
    .sort((a, b) => (a.draft.createdAt < b.draft.createdAt ? 1 : -1));
}

/** Черновик старше трёх дней уже не актуален — его не показываем. */
export function freshDrafts(drafts: WaOrderDraft[], now: Date, days = 3): WaOrderDraft[] {
  const edge = now.getTime() - days * 86_400_000;
  return drafts.filter((d) => new Date(d.createdAt).getTime() >= edge);
}

/**
 * Позиции для формы заявки. Цена — из прайса клиента (без сорта — общая «Все
 * сорта» по длине). Сорт, которого уже нет в справочнике, — пусто: иначе
 * выпадающий список показал бы чужой первый сорт, а сохранилось бы пустое.
 * Единственный сорт цветка подставляется сам.
 */
export function draftFormItems(
  draft: Pick<WaOrderDraft, "items">,
  prices: Record<string, number>,
  catalog?: WaCatalog
): { flowerType: string; variety: string; grade: string; quantity: string; unitPrice: string }[] {
  return draft.items.map((it) => {
    const list = catalog?.[it.flowerType];
    let variety = it.variety;
    if (list && !list.includes(variety)) variety = "";
    if (list && !variety && list.length === 1) variety = list[0];
    const price = it.grade ? priceFromMap(prices, it.flowerType, variety, it.grade) : 0;
    return {
      flowerType: it.flowerType,
      variety,
      grade: it.grade,
      quantity: String(it.quantity),
      unitPrice: price > 0 ? String(price) : "",
    };
  });
}

/** Кратко для списка: «Роза 60 · 60 шт.; Хризантема · 100 шт.» */
export function draftSummary(items: WaOrderItem[]): string {
  return items
    .map((i) => {
      const name = [FLOWER_TYPE_LABELS[i.flowerType] ?? i.flowerType, i.variety, i.grade].filter(Boolean).join(" ");
      return `${name} · ${i.quantity.toLocaleString("ru-RU")} шт.`;
    })
    .join("; ");
}
