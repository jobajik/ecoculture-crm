import { CLIENT_SOURCES, CLIENT_TYPES, ROLES } from "./constants";
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
  /** Пусто — новый; иначе почему не заводим. */
  skip: string;
}

export interface LeadImportResult {
  rows: LeadImportRow[];
  fresh: number;
  skipped: number;
  fatalError?: string;
}

/** Как может называться колонка в файле владельца. Сравнение — без регистра и знаков. */
const HEADER_SYNONYMS: Record<string, string[]> = {
  name: ["название", "наименование", "клиент", "компания", "магазин", "имя", "организация", "точка", "name"],
  city: ["город", "city", "населенныйпункт"],
  phone: ["телефон", "тел", "номер", "номертелефона", "phone", "whatsapp", "ватсап", "контакты"],
  contactPerson: ["контактноелицо", "контакт", "фио", "лпр", "имяконтакта"],
  clientType: ["тип", "типточки", "типклиента"],
  source: ["источник", "откуда"],
  address: ["адрес", "address"],
  note: ["комментарий", "примечание", "заметка", "описание", "note", "коммент"],
  manager: ["менеджер", "ответственный", "manager"],
};

const headerKey = (v: string) => (v || "").toLowerCase().replace(/ё/g, "е").replace(/[^\p{L}\p{N}]+/gu, "");

/** Находит строку заголовков (в первых 10) и какая колонка чем является. */
export function detectLeadColumns(matrix: string[][]): { headerRow: number; columns: Record<string, number> } | null {
  for (let r = 0; r < Math.min(10, matrix.length); r++) {
    const columns: Record<string, number> = {};
    matrix[r].forEach((cell, c) => {
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
    if (columns.name !== undefined) return { headerRow: r, columns };
  }
  return null;
}

const fromList = (value: string, list: readonly string[]) => {
  const k = headerKey(value);
  return list.find((x) => headerKey(x) === k) ?? "";
};

/**
 * Разбирает таблицу из файла в строки лидов. Двойники ищутся по телефону и по
 * названию+городу — и среди уже заведённых лидов и клиентов, и внутри самого
 * файла. Двойника не заводим: второй лид на ту же точку — два менеджера звонят
 * одному человеку.
 */
export function parseLeadMatrix(
  matrix: string[][],
  existing: { leads: Pick<Lead, "name" | "city" | "phone">[]; clients: { name: string; city: string; phone: string }[] },
  users: { email: string; name: string }[]
): LeadImportResult {
  const detected = detectLeadColumns(matrix);
  if (!detected) {
    return { rows: [], fresh: 0, skipped: 0, fatalError: "Не нашёл колонку с названием клиента. Первой строкой должны идти заголовки: «Название», «Город», «Телефон»…" };
  }
  const { headerRow, columns } = detected;
  const get = (row: string[], field: string) => (columns[field] === undefined ? "" : (row[columns[field]] ?? "").toString().trim());

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

  const rows: LeadImportRow[] = [];
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const row = matrix[r] ?? [];
    const name = get(row, "name");
    const phone = get(row, "phone");
    const city = get(row, "city");
    if (!name && !phone) continue;
    const managerRaw = get(row, "manager");
    const item: LeadImportRow = {
      line: r + 1,
      name,
      city,
      phone,
      contactPerson: get(row, "contactPerson"),
      clientType: fromList(get(row, "clientType"), CLIENT_TYPES),
      source: fromList(get(row, "source"), CLIENT_SOURCES),
      address: get(row, "address"),
      note: get(row, "note"),
      managerRaw,
      managerEmail: managerRaw ? userByKey.get(headerKey(managerRaw)) ?? "" : "",
      skip: "",
    };
    const pk = phoneKey(phone);
    const nk = `${nameKey(name)}|${nameKey(city)}`;
    if (!name) item.skip = "нет названия";
    else if (name.length > 200) item.skip = "слишком длинное название";
    else if (pk && seenPhones.has(pk)) item.skip = `${seenPhones.get(pk)} (тот же телефон)`;
    else if (!pk && seenNames.has(nk)) item.skip = `${seenNames.get(nk)} (то же название и город)`;
    if (!item.skip) remember(name, city, phone, `повтор в файле, строка ${item.line}`);
    rows.push(item);
  }
  if (rows.length > 3000) {
    return { rows: [], fresh: 0, skipped: 0, fatalError: "В файле больше 3 000 строк — разбейте на части" };
  }
  const fresh = rows.filter((x) => !x.skip).length;
  return { rows, fresh, skipped: rows.length - fresh };
}
