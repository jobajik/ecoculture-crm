import { CLIENT_SOURCES, CLIENT_TYPES, ROLES } from "./constants";
import { toIsoDate } from "./sheetDate";
import type { Lead, LeadTouch } from "./types";

// ---------------------------------------------------------------------------
// Лиды: база тех, кто ещё не покупал, и работа с ней по стадиям.
//
// Владелец: «вкладка Лиды, где будет загружена база с клиентами (новые тоже
// будут добавляться), стадии отработки, несколько касаний, на каждом касании
// комментарии менеджера».
//
// Здесь только чистые правила — их зовут и страницы, и серверные действия, и
// проверка `scripts/check-leads.ts`. Модуль без googleapis: его импортирует и
// браузер (грабли 1.8).
// ---------------------------------------------------------------------------

export const LEAD_STAGES = [
  { key: "new", label: "Новый", short: "Новый", hint: "ещё не связывались" },
  { key: "contact", label: "Первый контакт", short: "Контакт", hint: "дозвонились или ответили" },
  { key: "need", label: "Выявили потребность", short: "Потребность", hint: "знаем, что берут и сколько" },
  { key: "offer", label: "Отправили прайс / КП", short: "Прайс / КП", hint: "ждём решения" },
  { key: "trial", label: "Пробный заказ", short: "Пробный", hint: "заведён клиентом, первая заявка" },
  { key: "regular", label: "Постоянный клиент", short: "Постоянный", hint: "берут регулярно" },
  { key: "lost", label: "Отказ", short: "Отказ", hint: "с причиной" },
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number]["key"];
export const LEAD_STAGE_KEYS = LEAD_STAGES.map((s) => s.key) as string[];
/** Закрытые стадии: с ними больше не работают, касание не назначается. */
export const CLOSED_STAGES = ["regular", "lost"];
/** Стадии, на которые можно встать, только заведя карточку клиента. */
export const CLIENT_STAGES = ["trial", "regular"];

export function stageLabel(key: string): string {
  return LEAD_STAGES.find((s) => s.key === key)?.label ?? "Новый";
}
/** Короткое имя стадии — для воронки и узких мест. */
export function stageShort(key: string): string {
  return LEAD_STAGES.find((s) => s.key === key)?.short ?? "Новый";
}
export function stageIndex(key: string): number {
  const i = LEAD_STAGE_KEYS.indexOf(key);
  return i < 0 ? 0 : i;
}
/** Пустая или незнакомая стадия читается как «Новый» — лид из таблицы руками. */
export function cleanStage(key: string | null | undefined): LeadStage {
  const k = (key || "").trim();
  return (LEAD_STAGE_KEYS.includes(k) ? k : "new") as LeadStage;
}
export const isClosedStage = (key: string) => CLOSED_STAGES.includes(key);

export const LEAD_CHANNELS = ["Звонок", "WhatsApp", "Встреча", "Instagram", "Другое"] as const;

export const LEAD_LOST_REASONS = [
  "Дорого",
  "Есть поставщик",
  "Не нужен наш цветок",
  "Не выходит на связь",
  "Неверный контакт",
  "Закрылись",
  // Хотел букет, а не опт. Это не отказ: такого человека продать оптом нельзя.
  "Не оптовик (розница)",
  "Другое",
] as const;

/** Касание без комментария ничего не сообщает — меньше этого не принимаем. */
export const MIN_COMMENT = 3;
/** Дальше года касание не назначают: это уже не план, а опечатка в годе. */
const MAX_AHEAD_DAYS = 366;

// --- Кто что видит ------------------------------------------------------------

/** Лидами занимаются продажи: менеджер, РОП, админ. */
export function canUseLeads(role: string | null | undefined): boolean {
  return role === ROLES.MANAGER || role === ROLES.SALES_HEAD || role === ROLES.ADMIN;
}
/** Раздавать лиды, загружать базу и видеть всех — РОП и админ. */
export function canManageLeads(role: string | null | undefined): boolean {
  return role === ROLES.SALES_HEAD || role === ROLES.ADMIN;
}
/**
 * Менеджер видит свои лиды и НИЧЬИ — чтобы взять себе. Чужие не видит: иначе
 * тёплый лид коллеги можно было бы тихо «дожать» самому.
 */
export function canSeeLead(role: string | null | undefined, email: string, lead: Pick<Lead, "managerEmail">): boolean {
  if (canManageLeads(role)) return true;
  if (role !== ROLES.MANAGER) return false;
  return !lead.managerEmail || lead.managerEmail === email.toLowerCase();
}
/** Работать с лидом (касание, правка) — его менеджер, РОП и админ. */
export function canWorkLead(role: string | null | undefined, email: string, lead: Pick<Lead, "managerEmail">): boolean {
  if (canManageLeads(role)) return true;
  return role === ROLES.MANAGER && !!lead.managerEmail && lead.managerEmail === email.toLowerCase();
}

// --- Телефон и двойники ---------------------------------------------------------

/**
 * Ключ телефона: последние 10 цифр. «+7 701 555 20 30», «87015552030» и
 * «7015552030» — один номер. Меньше 7 цифр — не телефон, ключа нет.
 */
export function phoneKey(phone: string | null | undefined): string {
  const digits = (phone || "").replace(/\D/g, "");
  if (digits.length < 7) return "";
  return digits.slice(-10);
}

/** Ссылка на чат WhatsApp по номеру; казахстанский «8…» превращается в «7…». */
export function whatsappLink(phone: string | null | undefined): string {
  let digits = (phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) digits = `7${digits.slice(1)}`;
  if (digits.length === 10) digits = `7${digits}`;
  return digits.length >= 10 ? `https://wa.me/${digits}` : "";
}

export function nameKey(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/(^|\s)(тоо|ип|ооо|тд|компания)(?=\s|$)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

// --- Касание --------------------------------------------------------------------

export interface TouchInput {
  channel: string;
  comment: string;
  stage: string;
  nextTouchAt: string;
  lostReason: string;
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Почему касание нельзя записать; пустая строка — можно. */
export function touchRefusal(input: TouchInput, lead: Pick<Lead, "stage" | "clientId">, today: string): string {
  if (!(LEAD_CHANNELS as readonly string[]).includes(input.channel)) return "Выберите, как связывались";
  if ((input.comment || "").trim().length < MIN_COMMENT) return "Напишите, о чём договорились";
  if (input.comment.length > 3000) return "Комментарий слишком длинный";
  if (!LEAD_STAGE_KEYS.includes(input.stage)) return "Непонятная стадия";
  if (CLIENT_STAGES.includes(input.stage) && !lead.clientId) {
    return "Сначала заведите лида клиентом — без карточки заявку не оформить";
  }
  if (input.stage === "lost" && !(LEAD_LOST_REASONS as readonly string[]).includes(input.lostReason)) {
    return "Укажите причину отказа";
  }
  if (!isClosedStage(input.stage)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.nextTouchAt || "")) return "Когда следующее касание?";
    if (input.nextTouchAt < today) return "Следующее касание не может быть в прошлом";
    if (input.nextTouchAt > addDays(today, MAX_AHEAD_DAYS)) return "Проверьте год следующего касания";
  }
  return "";
}

/** Что меняется в строке лида после касания. */
export function leadChangesAfterTouch(
  lead: Pick<Lead, "stage">,
  input: TouchInput,
  nowIso: string
): Record<string, string> {
  const changes: Record<string, string> = {};
  const from = cleanStage(lead.stage);
  if (input.stage !== from) {
    changes.Stage = input.stage;
    changes.StageChangedAt = nowIso;
  }
  changes.NextTouchAt = isClosedStage(input.stage) ? "" : input.nextTouchAt;
  changes.LostReason = input.stage === "lost" ? input.lostReason : "";
  return changes;
}

// --- Список и сводка --------------------------------------------------------------

export interface LeadRow extends Lead {
  stage: LeadStage;
  managerName: string;
  touches: number;
  lastTouchAt: string;
  lastComment: string;
  lastChannel: string;
  /** Касание назначено на прошедший день и не сделано. */
  overdue: boolean;
  dueToday: boolean;
  /** Дней на текущей стадии. */
  daysInStage: number;
}

function dayOf(iso: string): string {
  return (iso || "").slice(0, 10);
}
function daysBetween(from: string, to: string): number {
  if (!from || !to) return 0;
  return Math.max(0, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86_400_000));
}

export function buildLeadRows(
  leads: Lead[],
  touches: LeadTouch[],
  nameByEmail: Map<string, string>,
  today: string
): LeadRow[] {
  const byLead = new Map<string, LeadTouch[]>();
  for (const t of touches) {
    const list = byLead.get(t.leadId) ?? [];
    list.push(t);
    byLead.set(t.leadId, list);
  }
  return leads.map((l) => {
    const list = (byLead.get(l.leadId) ?? []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const last = list[0];
    const stage = cleanStage(l.stage);
    const open = !isClosedStage(stage);
    return {
      ...l,
      stage,
      managerName: l.managerEmail ? nameByEmail.get(l.managerEmail) ?? l.managerEmail : "",
      touches: list.length,
      lastTouchAt: last?.createdAt ?? "",
      lastComment: last?.comment ?? "",
      lastChannel: last?.channel ?? "",
      overdue: open && !!l.nextTouchAt && l.nextTouchAt < today,
      dueToday: open && l.nextTouchAt === today,
      daysInStage: daysBetween(dayOf(l.stageChangedAt || l.createdAt), today),
    };
  });
}

/**
 * Порядок списка: сначала просроченные касания (самые давние сверху), потом на
 * сегодня, потом назначенные дальше по дате, потом новые без касаний, в конце
 * закрытые. Так менеджер открывает вкладку и работает сверху вниз.
 */
export function compareLeadRows(a: LeadRow, b: LeadRow): number {
  const rank = (r: LeadRow) =>
    isClosedStage(r.stage) ? 4 : r.overdue ? 0 : r.dueToday ? 1 : r.nextTouchAt ? 2 : 3;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra <= 2 && a.nextTouchAt !== b.nextTouchAt) return a.nextTouchAt < b.nextTouchAt ? -1 : 1;
  if (ra === 4 && a.stageChangedAt !== b.stageChangedAt) return a.stageChangedAt < b.stageChangedAt ? 1 : -1;
  return a.name.localeCompare(b.name, "ru");
}

export interface LeadManagerRow {
  email: string;
  name: string;
  open: number;
  overdue: number;
  touches7: number;
  /** Сколько за 30 дней дошли до пробного заказа или дальше. */
  won30: number;
  lost30: number;
}

export interface LeadSummary {
  byStage: { key: string; label: string; count: number }[];
  open: number;
  overdue: number;
  dueToday: number;
  unassigned: number;
  touches7: number;
  byManager: LeadManagerRow[];
}

export function summarizeLeads(rows: LeadRow[], touches: LeadTouch[], nameByEmail: Map<string, string>, today: string): LeadSummary {
  const weekAgo = addDays(today, -6);
  const monthAgo = addDays(today, -29);
  const visible = new Set(rows.map((r) => r.leadId));
  const recent = touches.filter((t) => visible.has(t.leadId) && dayOf(t.createdAt) >= weekAgo);

  const managers = new Map<string, LeadManagerRow>();
  const mgr = (email: string) => {
    if (!managers.has(email)) {
      managers.set(email, { email, name: nameByEmail.get(email) ?? email, open: 0, overdue: 0, touches7: 0, won30: 0, lost30: 0 });
    }
    return managers.get(email)!;
  };
  for (const r of rows) {
    if (!r.managerEmail) continue;
    const m = mgr(r.managerEmail);
    if (!isClosedStage(r.stage)) m.open += 1;
    if (r.overdue) m.overdue += 1;
    const changed = dayOf(r.stageChangedAt);
    if (changed >= monthAgo && CLIENT_STAGES.includes(r.stage)) m.won30 += 1;
    if (changed >= monthAgo && r.stage === "lost") m.lost30 += 1;
  }
  for (const t of recent) if (t.managerEmail) mgr(t.managerEmail).touches7 += 1;

  return {
    byStage: LEAD_STAGES.map((s) => ({ key: s.key, label: s.label, count: rows.filter((r) => r.stage === s.key).length })),
    open: rows.filter((r) => !isClosedStage(r.stage)).length,
    overdue: rows.filter((r) => r.overdue).length,
    dueToday: rows.filter((r) => r.dueToday).length,
    unassigned: rows.filter((r) => !r.managerEmail && !isClosedStage(r.stage)).length,
    touches7: recent.length,
    byManager: [...managers.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name, "ru")),
  };
}

// --- Загрузка базы из файла ----------------------------------------------------------

export interface LeadImportRow {
  line: number;
  name: string;
  city: string;
  phone: string;
  contactPerson: string;
  clientType: string;
  source: string;
  address: string;
  note: string;
  /** Как написано в файле — имя или почта менеджера. */
  managerRaw: string;
  managerEmail: string;
  /** Группа из файла («Спящий», «Только заявка»…) — по ней решают, кого грузить. */
  segment: string;
  /** Что известно из прошлой CRM — одной строкой для экрана звонка. */
  history: string;
  firstSeenAt: string;
  pastOrders: number;
  /** Пусто — новый; иначе почему не заводим. */
  skip: string;
}

export interface LeadImportResult {
  rows: LeadImportRow[];
  fresh: number;
  skipped: number;
  fatalError?: string;
  /** С какого листа взята база (в файле их бывает несколько). */
  sheet?: string;
  /** Группы из файла с числом новых строк — чтобы снять лишние галочкой. */
  segments?: { name: string; count: number; bought: boolean }[];
}

/** Больше за раз не загружаем: одна запись в таблицу, и та не резиновая. */
export const MAX_IMPORT_ROWS = 6000;
const MAX_HISTORY = 600;

/** Как может называться колонка в файле владельца. Сравнение — без регистра и знаков. */
const HEADER_SYNONYMS: Record<string, string[]> = {
  name: ["название", "наименование", "клиент", "компания", "магазин", "имя", "организация", "точка", "name", "названиеклиента"],
  city: ["город", "city", "населенныйпункт"],
  phone: ["телефон", "тел", "номер", "номертелефона", "phone", "whatsapp", "ватсап", "контакты"],
  contactPerson: ["контактноелицо", "контакт", "фио", "лпр", "имяконтакта"],
  clientType: ["тип", "типточки", "типклиента", "видклиента"],
  source: ["источник", "откуда"],
  address: ["адрес", "address"],
  note: ["комментарий", "примечание", "заметка", "описание", "note", "коммент"],
  manager: ["менеджер", "ответственный", "manager"],
  // Выгрузка из прошлой CRM: группа, покупки, даты. Всё это — подсказка
  // менеджеру на экране звонка, в отдельные поля карточки не раскладывается.
  segment: ["статус", "сегмент", "группа", "статусклиента"],
  orders: ["заказов", "количествозаказов", "заказы"],
  revenue: ["выручка", "суммазаказов", "выручкатг"],
  lastOrder: ["последнийзаказ", "датапоследнегозаказа"],
  firstSeen: ["первоеобращение", "первыйконтакт", "датаобращения", "датапервогообращения"],
  mainVariety: ["основнойсорт"],
  branch: ["филиал", "регион"],
  contactId: ["idконтакта", "idклиента", "контактid"],
  requests: ["заявокбеззаказа"],
  history: ["история"],
};

const headerKey = (v: string) => (v || "").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");

/** Находит строку заголовков (в первых 10) и какая колонка чем является. */
export function detectLeadColumns(matrix: string[][]): { headerRow: number; columns: Record<string, number> } | null {
  let best: { headerRow: number; columns: Record<string, number> } | null = null;
  for (let r = 0; r < Math.min(10, matrix.length); r++) {
    const columns: Record<string, number> = {};
    (matrix[r] ?? []).forEach((cell, c) => {
      const k = headerKey(cell);
      if (!k) return;
      for (const [field, names] of Object.entries(HEADER_SYNONYMS)) {
        if (columns[field] !== undefined) continue;
        if (names.includes(k)) {
          columns[field] = c;
          return;
        }
      }
    });
    if (columns.name !== undefined && (!best || Object.keys(columns).length > Object.keys(best.columns).length)) {
      best = { headerRow: r, columns };
    }
  }
  return best;
}

/**
 * Какой лист файла — база. В выгрузке из прошлой CRM листов восемь (сводка,
 * сделки, позиции, клиенты…), и первым идёт сводка. Берём лист, где узнаётся
 * больше всего колонок, при равенстве — где больше строк.
 */
export function pickLeadSheet(sheets: { name: string; matrix: string[][] }[]): { name: string; matrix: string[][] } | null {
  let best: { sheet: { name: string; matrix: string[][] }; score: number; rows: number } | null = null;
  for (const sheet of sheets) {
    const d = detectLeadColumns(sheet.matrix);
    if (!d || d.columns.phone === undefined) continue;
    const score = Object.keys(d.columns).length;
    const rows = sheet.matrix.length - d.headerRow - 1;
    if (!best || score > best.score || (score === best.score && rows > best.rows)) best = { sheet, score, rows };
  }
  return best?.sheet ?? (sheets[0] ? sheets[0] : null);
}

const fromList = (value: string, list: readonly string[]) => {
  const k = headerKey(value);
  return list.find((x) => headerKey(x) === k) ?? "";
};

/** Источник из чужой CRM («WhatsApp ОПТ Алматы») — к нашему закрытому списку. */
export function sourceFrom(raw: string): string {
  const exact = fromList(raw, CLIENT_SOURCES);
  if (exact) return exact;
  if (/whats\s*app|ватсап|вотсап/i.test(raw)) return "Написали в WhatsApp";
  if (/insta|инстаграм/i.test(raw)) return "Instagram";
  return "";
}

/** «Мелкий опт», «Средний опт» → «Оптовик» и т. п.; незнакомое — пусто. */
export function clientTypeFrom(raw: string): string {
  const exact = fromList(raw, CLIENT_TYPES);
  if (exact) return exact;
  if (/опт/i.test(raw)) return "Оптовик";
  if (/салон/i.test(raw)) return "Флористический салон";
  if (/сеть/i.test(raw)) return "Сеть магазинов";
  if (/магазин|киоск|бутик/i.test(raw)) return "Розничный магазин";
  return "";
}

const KNOWN_CITIES: [RegExp, string][] = [
  [/алмат/i, "Алматы"],
  [/астан|нур-?султан/i, "Астана"],
  [/шымкент/i, "Шымкент"],
  [/караганд/i, "Караганда"],
  [/павлодар/i, "Павлодар"],
  [/семей|семипалат/i, "Семей"],
  [/усть-?каменогор|өскемен/i, "Усть-Каменогорск"],
  [/актобе/i, "Актобе"],
  [/атырау/i, "Атырау"],
  [/костанай/i, "Костанай"],
  [/кызылорд/i, "Кызылорда"],
  [/тараз/i, "Тараз"],
  [/петропавл/i, "Петропавловск"],
  [/талдыкорган/i, "Талдыкорган"],
  [/уральск|орал/i, "Уральск"],
  [/актау/i, "Актау"],
  [/туркестан/i, "Туркестан"],
  [/экибастуз/i, "Экибастуз"],
  [/кордай/i, "Кордай"],
  [/бишкек/i, "Бишкек"],
];

/** Город по косвенным признакам: филиал, адрес, источник («…ОПТ Астаны»). */
export function guessCity(...texts: string[]): string {
  for (const t of texts) {
    if (!t) continue;
    for (const [re, city] of KNOWN_CITIES) if (re.test(t)) return city;
  }
  return "";
}

/** Телефон к одному виду: «8 705 …», «+7(705)…», «7705…» → «+77051234567». */
export function normalizePhone(raw: string): string {
  const t = (raw || "").trim();
  const d = t.replace(/\D/g, "");
  if (d.length === 11 && (d.startsWith("7") || d.startsWith("8"))) return `+7${d.slice(1)}`;
  if (d.length === 10 && d.startsWith("7")) return `+7${d}`;
  return t;
}

function dayText(raw: string): string {
  const iso = toIsoDate(raw);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "";
}
function ruDay(iso: string): string {
  return iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "";
}
function num(raw: string): number {
  const n = Number(String(raw || "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function money(n: number): string {
  return Math.round(n).toLocaleString("ru-RU").replace(/ /g, " ");
}
function plainText(raw: string): string {
  return (raw || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\[\/?[a-z]\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
function ordersWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "заказ";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "заказа";
  return "заказов";
}

/**
 * Что человек спрашивал раньше — по другим листам выгрузки (сделки, позиции):
 * номер контакта → последние осмысленные комментарии («270 хризантем», «к 8
 * марта»). Пустые, «Нет» и повторы отбрасываются.
 */
export function collectRequests(sheets: { name: string; matrix: string[][] }[], skipSheet: string): Map<string, string[]> {
  const out = new Map<string, { day: string; text: string }[]>();
  for (const sheet of sheets) {
    if (sheet.name === skipSheet) continue;
    const head = sheet.matrix[0] ?? [];
    const keys = head.map(headerKey);
    const idCol = keys.findIndex((k) => HEADER_SYNONYMS.contactId.includes(k));
    if (idCol < 0) continue;
    const textCols = keys
      .map((k, i) => (k === "комментарий" || k === "комментарийконтакта" ? i : -1))
      .filter((i) => i >= 0);
    if (textCols.length === 0) continue;
    const dateCol = keys.findIndex((k) => k === "датасоздания" || k === "дата");
    for (let r = 1; r < sheet.matrix.length; r++) {
      const row = sheet.matrix[r] ?? [];
      const id = (row[idCol] ?? "").trim();
      if (!id) continue;
      const day = dateCol >= 0 ? dayText(row[dateCol] ?? "") : "";
      for (const c of textCols) {
        const text = plainText(row[c] ?? "");
        if (text.length < 3 || /^(нет|-|—|сделка #\d+)$/i.test(text)) continue;
        const list = out.get(id) ?? [];
        if (!list.some((x) => x.text.toLowerCase() === text.toLowerCase())) list.push({ day, text: text.slice(0, 80) });
        out.set(id, list);
      }
    }
  }
  const result = new Map<string, string[]>();
  for (const [id, list] of Array.from(out.entries())) {
    result.set(
      id,
      list
        .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
        .slice(0, 3)
        .map((x) => (x.day ? `${x.day.slice(8, 10)}.${x.day.slice(5, 7)} — ${x.text}` : x.text))
    );
  }
  return result;
}

/**
 * Разбирает таблицу из файла в строки лидов. Двойники ищутся по телефону и по
 * названию+городу — и среди уже заведённых лидов и клиентов, и внутри самого
 * файла. Двойника не заводим: второй лид на ту же точку — два менеджера звонят
 * одному человеку. Если один телефон в файле встречается несколько раз,
 * остаётся строка, где человек ПОКУПАЛ (в выгрузке из прошлой CRM один и тот же
 * номер заведён и «заявкой», и «спящим клиентом»).
 */
export function parseLeadMatrix(
  matrix: string[][],
  existing: { leads: Pick<Lead, "name" | "city" | "phone">[]; clients: { name: string; city: string; phone: string }[] },
  users: { email: string; name: string }[],
  requests: Map<string, string[]> = new Map()
): LeadImportResult {
  const detected = detectLeadColumns(matrix);
  if (!detected) {
    return { rows: [], fresh: 0, skipped: 0, fatalError: "Не нашёл колонку с названием клиента. Первой строкой должны идти заголовки: «Название», «Город», «Телефон»…" };
  }
  const { headerRow, columns } = detected;
  const get = (row: string[], field: string) => (columns[field] === undefined ? "" : (row[columns[field]] ?? "").toString().trim());
  const hasPhoneColumn = columns.phone !== undefined;
  if (matrix.length - headerRow - 1 > MAX_IMPORT_ROWS) {
    return { rows: [], fresh: 0, skipped: 0, fatalError: `В файле больше ${MAX_IMPORT_ROWS.toLocaleString("ru-RU")} строк — разбейте на части` };
  }

  const seenPhones = new Map<string, string>();
  const seenNames = new Map<string, string>();
  const remember = (name: string, city: string, phone: string, label: string) => {
    const p = phoneKey(phone);
    if (p && !seenPhones.has(p)) seenPhones.set(p, label);
    const n = nameKey(name);
    if (n) seenNames.set(`${n}|${nameKey(city)}`, label);
  };
  existing.clients.forEach((c) => remember(c.name, c.city, c.phone, "уже клиент"));
  existing.leads.forEach((l) => remember(l.name, l.city, l.phone, "уже в лидах"));

  const userByKey = new Map<string, string>();
  for (const u of users) {
    userByKey.set(headerKey(u.email), u.email.toLowerCase());
    if (u.name) {
      userByKey.set(headerKey(u.name), u.email.toLowerCase());
      const first = u.name.trim().split(/\s+/)[0];
      if (first && !userByKey.has(headerKey(first))) userByKey.set(headerKey(first), u.email.toLowerCase());
    }
  }

  // Один телефон несколько раз — оставляем строку, где больше покупок, при
  // равенстве — более позднюю по первому обращению (там свежее имя).
  const bestLine = new Map<string, { r: number; orders: number; seen: string }>();
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const pk = phoneKey(get(row, "phone"));
    if (!pk || pk.length < 10) continue;
    const orders = num(get(row, "orders"));
    const seen = dayText(get(row, "firstSeen"));
    const cur = bestLine.get(pk);
    if (!cur || orders > cur.orders || (orders === cur.orders && seen > cur.seen)) bestLine.set(pk, { r, orders, seen });
  }

  const rows: LeadImportRow[] = [];
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const name = get(row, "name");
    const rawPhone = get(row, "phone");
    if (!name && !rawPhone) continue;
    const managerRaw = get(row, "manager");
    const segment = get(row, "segment").slice(0, 60);
    const orders = Math.max(0, Math.round(num(get(row, "orders"))));
    const firstSeenAt = dayText(get(row, "firstSeen"));
    const sourceRaw = get(row, "source");
    const typeRaw = get(row, "clientType");
    const address = get(row, "address");
    const city = get(row, "city") || guessCity(get(row, "branch"), address, sourceRaw);
    const phone = normalizePhone(rawPhone);
    const source = sourceFrom(sourceRaw);
    const clientType = clientTypeFrom(typeRaw);

    let history = get(row, "history");
    if (!history) {
      const parts: string[] = [];
      if (segment) parts.push(segment);
      if (orders > 0) {
        const revenue = num(get(row, "revenue"));
        parts.push(`${orders} ${ordersWord(orders)}${revenue > 0 ? ` на ${money(revenue)} ₸` : ""}`);
        const last = dayText(get(row, "lastOrder"));
        if (last) parts.push(`последний ${ruDay(last)}`);
        const variety = get(row, "mainVariety");
        if (variety) parts.push(`брал ${variety}`);
      } else {
        const req = Math.round(num(get(row, "requests")));
        if (req > 1) parts.push(`заявок без заказа: ${req}`);
      }
      if (firstSeenAt) parts.push(`впервые написал ${ruDay(firstSeenAt)}`);
      if (typeRaw && typeRaw !== clientType) parts.push(typeRaw);
      if (sourceRaw && sourceRaw !== source) parts.push(sourceRaw);
      if (managerRaw) parts.push(`вёл(а): ${managerRaw}`);
      const asked = requests.get(get(row, "contactId"));
      if (asked && asked.length > 0) parts.push(`спрашивал: ${asked.join("; ")}`);
      history = parts.join(" · ");
    }
    history = history.slice(0, MAX_HISTORY);

    const item: LeadImportRow = {
      line: r + 1,
      name,
      city,
      phone,
      contactPerson: get(row, "contactPerson"),
      clientType,
      source,
      address: address && address !== city ? address : "",
      note: get(row, "note"),
      managerRaw,
      managerEmail: managerRaw ? userByKey.get(headerKey(managerRaw)) ?? "" : "",
      segment,
      history,
      firstSeenAt,
      pastOrders: orders,
      skip: "",
    };
    const pk = phoneKey(phone);
    const nk = `${nameKey(name)}|${nameKey(city)}`;
    const best = pk ? bestLine.get(pk) : undefined;
    if (!name) item.skip = "нет названия";
    else if (name.length > 200) item.skip = "слишком длинное название";
    else if (hasPhoneColumn && !pk) item.skip = "нет телефона";
    else if (hasPhoneColumn && pk.length < 10) item.skip = "неполный телефон";
    else if (pk && seenPhones.has(pk)) item.skip = `${seenPhones.get(pk)} (тот же телефон)`;
    else if (best && best.r !== r) item.skip = `повтор в файле, оставлена строка ${best.r + 1}`;
    else if (!pk && seenNames.has(nk)) item.skip = `${seenNames.get(nk)} (то же название и город)`;
    if (!item.skip) remember(name, city, phone, `повтор в файле, строка ${item.line}`);
    rows.push(item);
  }
  const fresh = rows.filter((x) => !x.skip).length;
  const segs = new Map<string, { name: string; count: number; bought: boolean }>();
  for (const x of rows) {
    if (x.skip || !x.segment) continue;
    const s = segs.get(x.segment) ?? { name: x.segment, count: 0, bought: false };
    s.count += 1;
    if (x.pastOrders > 0) s.bought = true;
    segs.set(x.segment, s);
  }
  return {
    rows,
    fresh,
    skipped: rows.length - fresh,
    segments: Array.from(segs.values()).sort((a, b) => b.count - a.count),
  };
}

/**
 * Раздать поровну и случайно. Сначала раздаются бывшие покупатели, потом
 * остальные — счётчик идёт дальше, поэтому у каждого менеджера и всего, и
 * «покупавших» получается поровну (±1). Порядок внутри группы — случайный.
 */
export function dealEvenly<T>(
  items: T[],
  emails: string[],
  bought: (item: T) => boolean,
  random: () => number = Math.random
): Map<T, string> {
  const out = new Map<T, string>();
  if (emails.length === 0) return out;
  const shuffle = (list: T[]) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const order = shuffle(emails.map((_, i) => i as unknown as T)) as unknown as number[];
  let k = 0;
  for (const group of [items.filter(bought), items.filter((x) => !bought(x))]) {
    for (const item of shuffle(group)) {
      out.set(item, emails[order[k % emails.length]]);
      k += 1;
    }
  }
  return out;
}

/**
 * Строки предпросмотра обратно в таблицу — для повторной проверки на сервере.
 * Заголовки подобраны под `HEADER_SYNONYMS`, поэтому сервер разбирает их тем же
 * `parseLeadMatrix`, что и файл: присланному из браузера не верим (грабли 1.11).
 */
export function rowsToMatrix(rows: LeadImportRow[]): string[][] {
  return [
    ["Название", "Город", "Телефон", "Контактное лицо", "Тип точки", "Источник", "Адрес", "Комментарий", "Менеджер", "Статус", "Заказов", "Первое обращение", "История"],
    ...rows.map((r) =>
      [
        r.name,
        r.city,
        r.phone,
        r.contactPerson,
        r.clientType,
        r.source,
        r.address,
        r.note,
        r.managerEmail || r.managerRaw,
        r.segment,
        r.pastOrders ? String(r.pastOrders) : "",
        r.firstSeenAt,
        r.history,
      ].map((v) => String(v ?? "").slice(0, 1000))
    ),
  ];
}
