/**
 * Постоянники менеджеров: пересчёт привычек по заявкам и рассылки от имени менеджера с его номера (`clientHabits.ts`),
 * его словами (`managerStyle.ts`). Три запуска (09.11.2026, владелец: «напоминание от бота, по команде менеджера боту
 * Экокультуры, и где-то самостоятельно; общаться как сами менеджеры, на автомате, и вести аналитику»):
 *
 *  - `runClientHabits({ send })` — утром из сводки (`/api/digest`, 9:00 пн–сб): кому сегодня его день (`habitDue`);
 *  - по команде менеджера основному номеру («напомни постоянникам …») — план и «ДА», `staffBroadcastRunner.ts` берёт
 *    получателей и тексты отсюда (`habitRecipientsFor`);
 *  - `runHabitOverdue({ send })` — раз в час (`/api/bot/followup`, 10–18): постоянник молчит дольше своего обычного
 *    промежутка, менеджер с ним не переписывается, ему неделю не писали — пишем сами, не больше `OVERDUE_DAILY_LIMIT`
 *    с одного номера в день.
 *
 * Все три заводят рассылку с `Auto` = «habits» и `PlannedFor` = сегодня (цепочка рассылок ведёт её сегодня, назавтра
 * недоотправленное отменяется — вчерашнее «на сегодня» не уходит), заголовок «Постоянным · Имя · режим · ДД.ММ»; по этой
 * метке считается аналитика (`habitsAnalytics.ts`). Текст — модель в манере менеджера (`styledText`), цифры проверены,
 * иначе шаблон `habitText`. Пересчёт привычек переписывает вкладку `ClientHabits` (LastSentAt и Active сохраняет).
 */
import { listOrdersWithItems } from "./repo/orders";
import { listUsers } from "./repo/users";
import { listWaLines } from "./repo/waLines";
import { listWaMessages } from "./repo/talks";
import { listSellableBatches } from "./repo/sellable";
import { getCurrentPrices } from "./repo/prices";
import { createBroadcast, listBroadcasts, listRecipients, optedOutKeys, settingsMap } from "./repo/broadcasts";
import { readTable, rowToRecord, appendRows, updateRows, prefetchTables, SHEET_TABS } from "./sheets";
import { priceFor } from "./priceList";
import { phoneKey } from "./leads";
import { waPhone, BROADCAST_STATUSES } from "./broadcast";
import { chatFacts } from "./autoBroadcast";
import { ROTATION_FILE } from "./botPhotos";
import { isNotASale } from "./orderKind";
import { ORDER_STATUSES, ROLES } from "./constants";
import { localDayKey } from "./timezone";
import { almatyHourOf } from "./officeStore";
import { kickBroadcast } from "./autoBroadcastRunner";
import { SITE } from "./broadcastSend";
import { MANAGER_PROFILES_SETTING, nextShipDay, parseManagerProfiles, profileOf, shipDayLabel } from "./managerProfile";
import { stylesFrom, styledTexts, type StyledInput } from "./managerStyleRunner";
import { buildHabits, habitDue, habitText, usualLabel, MIN_SEND_GAP_DAYS, type ClientHabit, type HabitOffer, type HabitOrder } from "./clientHabits";
import type { WaMessage } from "./types";

export const HABIT_AUTO = "habits";
/** Самостоятельных сообщений молчащим — не больше стольких с одного номера в день. */
export const OVERDUE_DAILY_LIMIT = 8;
/** Молчит дольше обычного: от 1 до 14 дней после ожидаемой даты; дальше — не постоянник, а потерянный клиент. */
export const OVERDUE_MIN_DAYS = 1;
export const OVERDUE_MAX_DAYS = 14;
/** Менеджер переписывался с клиентом за эти часы — молчим. */
export const OVERDUE_TALK_HOURS = 6;
export const OVERDUE_HOURS = { from: 10, to: 18 };

export type HabitMode = "weekly" | "command" | "overdue";
const MODE_LABEL: Record<HabitMode, string> = { weekly: "день", command: "по просьбе", overdue: "молчат" };

export function habitTitle(manager: string, mode: HabitMode, today: string): string {
  return `Постоянным · ${manager} · ${MODE_LABEL[mode]} · ${today.slice(8, 10)}.${today.slice(5, 7)}`;
}
/** Режим по заголовку рассылки (для аналитики). */
export function habitModeOf(title: string): HabitMode | null {
  if (!/^Постоянным · /.test(title || "")) return null;
  if (title.includes("· молчат ·")) return "overdue";
  if (title.includes("· по просьбе ·")) return "command";
  return "weekly";
}

export interface HabitRow extends ClientHabit {
  lastSentAt: string;
  active: boolean;
  rowNumber?: number;
}

const firstName = (name: string) => (name || "").trim().split(/\s+/)[0] || "менеджер";
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
const KZ = /[әғқңөұүһі]|салем|сәлем|жаксы|жақсы|рахмет|керек|болды|жок|жоқ|калай|қалай|бар ма|иә/i;

async function loadSaved(): Promise<Map<string, { rowNumber: number; lastSentAt: string; active: boolean }>> {
  const out = new Map<string, { rowNumber: number; lastSentAt: string; active: boolean }>();
  try {
    const t = await readTable(SHEET_TABS.CLIENT_HABITS, { fresh: true });
    t.rows.forEach((row, i) => {
      const r = rowToRecord(SHEET_TABS.CLIENT_HABITS, row);
      if (r.ClientID) out.set(r.ClientID, { rowNumber: t.rowNumbers[i], lastSentAt: r.LastSentAt || "", active: String(r.Active || "").trim().toUpperCase() !== "FALSE" });
    });
  } catch {
    /* вкладки ещё нет — setup-sheet */
  }
  return out;
}

export async function computeHabits(today = localDayKey()): Promise<HabitRow[]> {
  await prefetchTables([SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS, SHEET_TABS.USERS]);
  const [orders, users, saved] = await Promise.all([listOrdersWithItems(), listUsers(), loadSaved()]);
  const managers = new Set(users.filter((u) => u.active && u.role === ROLES.MANAGER).map((u) => u.email));
  const src: HabitOrder[] = orders
    .filter((o) => o.status !== ORDER_STATUSES.CANCELLED && !isNotASale(o) && managers.has(o.managerEmail))
    .map((o) => ({
      orderId: o.orderId,
      clientId: o.clientId,
      clientName: o.clientName,
      clientPhone: o.clientPhone,
      managerEmail: o.managerEmail,
      day: (o.createdAt || "").slice(0, 10),
      items: o.items.map((i) => ({ flowerType: i.flowerType, variety: i.variety, grade: i.grade, quantity: i.quantity, unitPrice: i.unitPrice })),
      totalAmount: o.totalAmount,
    }));
  return buildHabits(src, today).map((h) => {
    const s = saved.get(h.clientId);
    return { ...h, lastSentAt: s?.lastSentAt ?? "", active: s?.active ?? true, rowNumber: s?.rowNumber };
  });
}

function habitRecord(h: HabitRow, now: string): Record<string, unknown> {
  return {
    ClientID: h.clientId,
    ManagerEmail: h.managerEmail,
    Name: h.name,
    Phone: h.phone,
    Orders: h.orders,
    MedianDays: h.medianGapDays,
    Weekday: h.weekday,
    UsualItems: JSON.stringify(h.usual),
    AvgAmount: h.avgAmount,
    LastOrderAt: h.lastAt,
    NextExpectedAt: h.nextExpectedAt,
    LastSentAt: h.lastSentAt,
    UpdatedAt: now,
    Active: h.active ? "TRUE" : "FALSE",
  };
}

export async function saveHabits(rows: HabitRow[]): Promise<{ updated: number; added: number }> {
  const now = new Date().toISOString();
  const regular = rows.filter((h) => h.regular);
  const upd = regular.filter((h) => h.rowNumber).map((h) => ({ rowNumber: h.rowNumber!, record: habitRecord(h, now) }));
  const add = regular.filter((h) => !h.rowNumber).map((h) => habitRecord(h, now));
  if (upd.length) await updateRows(SHEET_TABS.CLIENT_HABITS, upd);
  if (add.length) await appendRows(SHEET_TABS.CLIENT_HABITS, add);
  return { updated: upd.length, added: add.length };
}

/** Отметить LastSentAt у тех, кому ушло. */
async function markSent(rows: HabitRow[], now: string): Promise<void> {
  const upd = rows.filter((h) => h.rowNumber).map((h) => ({ rowNumber: h.rowNumber!, record: habitRecord({ ...h, lastSentAt: now }, now) }));
  if (upd.length) await updateRows(SHEET_TABS.CLIENT_HABITS, upd).catch(() => undefined);
}

// --- Общее для трёх запусков -------------------------------------------------------------------------------------

export interface HabitContext {
  today: string;
  habits: HabitRow[];
  users: Awaited<ReturnType<typeof listUsers>>;
  lines: Awaited<ReturnType<typeof listWaLines>>;
  messages: WaMessage[];
  facts: ReturnType<typeof chatFacts>;
  optout: Set<string>;
  stockOf: (f: string, v: string, g: string) => number;
  priceOf: (f: string, v: string, g: string) => number;
  orders: Awaited<ReturnType<typeof listOrdersWithItems>>;
  map: Record<string, string>;
  styles: ReturnType<typeof stylesFrom>;
  broadcasts: Awaited<ReturnType<typeof listBroadcasts>>;
  recipients: Awaited<ReturnType<typeof listRecipients>>;
}

export async function loadHabitContext(today = localDayKey()): Promise<HabitContext> {
  const habits = await computeHabits(today);
  await saveHabits(habits).catch(() => undefined);
  await prefetchTables([SHEET_TABS.WA_MESSAGES, SHEET_TABS.WA_LINES, SHEET_TABS.BOT_CHATS, SHEET_TABS.BATCHES, SHEET_TABS.PRICE_HISTORY, SHEET_TABS.SETTINGS, SHEET_TABS.BROADCASTS, SHEET_TABS.BROADCAST_RECIPIENTS]).catch(() => undefined);
  const [users, lines, messages, optout, batches, prices, orders, map, broadcasts, recipients] = await Promise.all([
    listUsers(),
    listWaLines(),
    listWaMessages({ lines: "all" }),
    optedOutKeys(),
    listSellableBatches(),
    getCurrentPrices(),
    listOrdersWithItems(),
    settingsMap(),
    listBroadcasts(),
    listRecipients(),
  ]);
  return {
    today,
    habits,
    users,
    lines,
    messages,
    facts: chatFacts(messages),
    optout,
    stockOf: (f, v, g) => batches.filter((b) => b.flowerType === f && b.variety.toLowerCase() === v.toLowerCase() && b.grade === g).reduce((s, b) => s + b.quantityRemaining, 0),
    priceOf: (f, v, g) => priceFor(prices, f, v, g),
    orders,
    map,
    styles: stylesFrom(map),
    broadcasts,
    recipients,
  };
}

/** Последняя живая заявка клиента по карточке или телефону, день. */
export function lastOrderDay(ctx: Pick<HabitContext, "orders">, h: Pick<ClientHabit, "clientId" | "phone">): string {
  const key = phoneKey(h.phone);
  return (
    ctx.orders
      .filter((o) => o.status !== ORDER_STATUSES.CANCELLED && (o.clientId === h.clientId || (key && phoneKey(o.clientPhone) === key)))
      .map((o) => (o.createdAt || "").slice(0, 10))
      .sort()
      .pop() || ""
  );
}

/** Хвост переписки клиента с номером менеджера для подсказки модели и признак «пишет по-казахски». */
function chatTailFor(ctx: HabitContext, line: string, phone: string): { tail: string[]; kazakh: boolean } {
  const key = phoneKey(phone);
  const chat = ctx.messages.filter((m) => phoneKey(m.phone) === key && (m.line || "") === line && (m.text || "").trim()).sort((a, b) => (a.at < b.at ? -1 : 1));
  const incoming = chat.filter((m) => m.direction === "in");
  const kazakh = incoming.length >= 2 && incoming.filter((m) => KZ.test(m.text)).length / incoming.length >= 0.3;
  const tail = chat.slice(-8).map((m) => `${m.direction === "in" ? "клиент" : "я"}: ${m.text.replace(/\s*\n\s*/g, " / ").slice(0, 160)}`);
  return { tail, kazakh };
}

export interface HabitRecipient {
  phone: string;
  name: string;
  kind: string;
  refId: string;
  managerEmail: string;
  text: string;
  habit: HabitRow;
  /** style — модель в манере менеджера; template — шаблон кода. */
  source: "style" | "template";
}

/**
 * Получатели и тексты для списка постоянников одного менеджера. `focus` — о чём просил напомнить менеджер (режим
 * «по просьбе»), `focusOffers` — эти позиции со склада с ценой (иначе берутся обычные позиции клиента).
 */
export async function habitRecipientsFor(
  ctx: HabitContext,
  managerEmail: string,
  list: HabitRow[],
  mode: HabitMode,
  opts: { focus?: string; focusOffers?: HabitOffer[]; budgetMs?: number } = {}
): Promise<{ recipients: HabitRecipient[]; skipped: { name: string; why: string }[]; line: string; manager: string }> {
  const user = ctx.users.find((u) => u.email === managerEmail);
  const manager = firstName(user?.name || managerEmail);
  const line = ctx.lines.find((l) => l.active && l.assistant !== "off" && l.managerEmail === managerEmail)?.code ?? "";
  const profile = profileOf(parseManagerProfiles(ctx.map[MANAGER_PROFILES_SETTING]), managerEmail);
  const shipDay = profile?.shipWeekday ? shipDayLabel(nextShipDay(ctx.today, profile.shipWeekday, almatyHourOf(new Date()))) : "";
  const style = line ? ctx.styles.get(line) ?? null : null;
  const skipped: { name: string; why: string }[] = [];
  const inputs: (StyledInput & { h: HabitRow; wa: string; offers: HabitOffer[] })[] = [];
  for (const h of list) {
    const wa = waPhone(h.phone);
    if (!wa) {
      skipped.push({ name: h.name, why: "нет мобильного" });
      continue;
    }
    const own: HabitOffer[] = h.usual.map((it) => ({ item: it, price: ctx.priceOf(it.flowerType, it.variety, it.grade), stock: ctx.stockOf(it.flowerType, it.variety, it.grade) }));
    const offers = opts.focusOffers?.length ? [...opts.focusOffers, ...own.filter((o) => !opts.focusOffers!.some((f) => usualLabel(f.item) === usualLabel(o.item)))] : own;
    const fallback = habitText(h, manager, offers);
    const { tail, kazakh } = chatTailFor(ctx, line, h.phone);
    const late = h.nextExpectedAt ? daysBetween(h.nextExpectedAt, ctx.today) : 0;
    inputs.push({
      h,
      wa,
      offers,
      managerName: manager,
      female: !!profile?.female,
      profile: style,
      mode,
      clientName: h.name,
      kazakh,
      usual: offers.map((o) => ({ label: usualLabel(o.item), qty: o.item.qty, price: o.price, stock: o.stock })),
      focus: opts.focus,
      lateDays: late > 0 ? late : undefined,
      gapDays: h.medianGapDays,
      shipDay,
      chatTail: tail,
      fallback,
    });
  }
  const texts = await styledTexts(inputs, { budgetMs: opts.budgetMs ?? 30000 });
  const recipients = inputs.map((inp, i) => ({
    phone: inp.wa,
    name: inp.h.name,
    kind: "client",
    refId: inp.h.clientId,
    managerEmail,
    text: texts[i].text,
    habit: inp.h,
    source: texts[i].source,
  }));
  return { recipients, skipped, line, manager };
}

/** Завести рассылку постоянникам: «идёт», с номера менеджера, помечена для аналитики; отметить LastSentAt. */
export async function launchHabitBroadcast(
  ctx: Pick<HabitContext, "today">,
  input: { manager: string; line: string; mode: HabitMode; recipients: HabitRecipient[]; byEmail?: string; audience?: string }
): Promise<string> {
  if (!input.recipients.length) return "";
  const id = await createBroadcast({
    createdByEmail: input.byEmail || "habits",
    title: habitTitle(input.manager, input.mode, ctx.today),
    text: input.recipients[0].text,
    fileId: ROTATION_FILE,
    fileName: "Фото из ротации",
    audience: input.audience || `Постоянные клиенты ${input.manager}: ${MODE_LABEL[input.mode]} (${input.recipients.length})`,
    recipients: input.recipients.map(({ habit: _h, source: _s, ...r }) => r),
    line: input.line,
    status: BROADCAST_STATUSES.SENDING,
    auto: HABIT_AUTO,
    plannedFor: ctx.today,
  });
  await markSent(
    input.recipients.map((r) => r.habit),
    new Date().toISOString()
  );
  return id;
}

// --- 1. Утром: чей сегодня день -------------------------------------------------------------------------------------

export interface HabitSendResult {
  line: string;
  manager: string;
  mode: HabitMode;
  sent: { name: string; phone: string; text: string; source: "style" | "template" }[];
  skipped: { name: string; why: string }[];
  broadcastId: string;
}

/** Кому пора сегодня — по менеджерам, с текстами; с `send` — заводит рассылки и отмечает LastSentAt. */
export async function runClientHabits(opts: { send: boolean; today?: string; byEmail?: string; ctx?: HabitContext } = { send: false }): Promise<{ habits: HabitRow[]; results: HabitSendResult[] }> {
  const ctx = opts.ctx ?? (await loadHabitContext(opts.today ?? localDayKey()));
  const results: HabitSendResult[] = [];
  const byManager = new Map<string, { due: HabitRow[]; skipped: { name: string; why: string }[] }>();
  for (const h of ctx.habits) {
    if (!h.regular || !h.active) continue;
    const e = byManager.get(h.managerEmail) ?? { due: [], skipped: [] };
    const key = phoneKey(h.phone);
    const verdict = habitDue(h, ctx.today, { lastSentAt: h.lastSentAt, lastClientMsgAt: ctx.facts.get(key)?.lastInAt, optedOut: ctx.optout.has(key), orderedSince: lastOrderDay(ctx, h) });
    if (verdict.due) e.due.push(h);
    else e.skipped.push({ name: h.name, why: verdict.why });
    byManager.set(h.managerEmail, e);
  }
  for (const [email, e] of byManager) {
    const { recipients, skipped, line, manager } = await habitRecipientsFor(ctx, email, e.due, "weekly");
    const res: HabitSendResult = { line, manager, mode: "weekly", sent: recipients.map((r) => ({ name: r.name, phone: r.phone, text: r.text, source: r.source })), skipped: [...e.skipped, ...skipped], broadcastId: "" };
    if (recipients.length && opts.send) res.broadcastId = await launchHabitBroadcast(ctx, { manager, line, mode: "weekly", recipients, byEmail: opts.byEmail });
    results.push(res);
  }
  if (opts.send && results.some((r) => r.broadcastId)) await kickBroadcast(SITE()).catch(() => undefined);
  return { habits: ctx.habits, results };
}

// --- 3. Сам: молчит дольше обычного ------------------------------------------------------------------------------

/** Сколько постоянникам уже ушло сегодня с этого номера (все три режима) — для дневного предела. */
export function habitSentToday(ctx: Pick<HabitContext, "broadcasts" | "recipients" | "today">, line: string): number {
  const ids = new Set(ctx.broadcasts.filter((b) => b.auto === HABIT_AUTO && b.plannedFor === ctx.today && (b.line || "") === line).map((b) => b.broadcastId));
  return ctx.recipients.filter((r) => ids.has(r.broadcastId)).length;
}

/** Почему постояннику сейчас не пишем сами; пусто — пора. */
export function overdueVerdict(
  h: HabitRow,
  ctx: Pick<HabitContext, "today" | "facts" | "optout" | "orders">,
  now = new Date()
): string {
  if (!h.regular || !h.active) return "не постоянник";
  const key = phoneKey(h.phone);
  if (ctx.optout.has(key)) return "отписался";
  const last = lastOrderDay(ctx, h) || h.lastAt;
  const expected = h.medianGapDays > 0 ? new Date(Date.parse(`${last}T00:00:00Z`) + h.medianGapDays * 86400000).toISOString().slice(0, 10) : "";
  if (!expected) return "нет периодичности";
  const late = daysBetween(expected, ctx.today);
  if (late < OVERDUE_MIN_DAYS) return "ещё не опаздывает";
  if (late > OVERDUE_MAX_DAYS) return `молчит ${late} дн. — это уже звонок менеджера`;
  if (h.lastSentAt && daysBetween(h.lastSentAt.slice(0, 10), ctx.today) < MIN_SEND_GAP_DAYS + 1) return "писали на этой неделе";
  const f = ctx.facts.get(key);
  if (f?.lastDirection === "in") return "сам написал, ждёт ответа";
  if (f?.lastAt && now.getTime() - Date.parse(f.lastAt) < OVERDUE_TALK_HOURS * 3600000) return "переписка идёт";
  return "";
}

/** Самостоятельный запуск: молчащим постоянникам с номера их менеджера, в пределах дня и часа. */
export async function runHabitOverdue(opts: { send: boolean; today?: string; now?: Date; ctx?: HabitContext; ignoreHours?: boolean } = { send: false }): Promise<{ results: HabitSendResult[]; skippedAll: number }> {
  const now = opts.now ?? new Date();
  const hour = almatyHourOf(now);
  if (!opts.ignoreHours && (hour < OVERDUE_HOURS.from || hour >= OVERDUE_HOURS.to)) return { results: [], skippedAll: 0 };
  const ctx = opts.ctx ?? (await loadHabitContext(opts.today ?? localDayKey()));
  const byManager = new Map<string, { due: HabitRow[]; skipped: { name: string; why: string }[] }>();
  for (const h of ctx.habits) {
    if (!h.regular || !h.active) continue;
    const e = byManager.get(h.managerEmail) ?? { due: [], skipped: [] };
    const why = overdueVerdict(h, ctx, now);
    if (why) e.skipped.push({ name: h.name, why });
    else e.due.push(h);
    byManager.set(h.managerEmail, e);
  }
  const results: HabitSendResult[] = [];
  let skippedAll = 0;
  for (const [email, e] of byManager) {
    skippedAll += e.skipped.length;
    if (!e.due.length) continue;
    const line = ctx.lines.find((l) => l.active && l.assistant !== "off" && l.managerEmail === email)?.code ?? "";
    if (!line) {
      results.push({ line, manager: firstName(ctx.users.find((u) => u.email === email)?.name || email), mode: "overdue", sent: [], skipped: e.due.map((h) => ({ name: h.name, why: "номер менеджера не подключён — сами не пишем" })), broadcastId: "" });
      continue;
    }
    const room = Math.max(0, OVERDUE_DAILY_LIMIT - habitSentToday(ctx, line));
    // Самые ценные первыми: средний чек × заявок в неделю.
    const due = [...e.due].sort((a, b) => b.avgAmount / Math.max(1, b.medianGapDays) - a.avgAmount / Math.max(1, a.medianGapDays));
    const take = due.slice(0, room);
    const { recipients, skipped, manager } = await habitRecipientsFor(ctx, email, take, "overdue", { budgetMs: 25000 });
    const res: HabitSendResult = {
      line,
      manager,
      mode: "overdue",
      sent: recipients.map((r) => ({ name: r.name, phone: r.phone, text: r.text, source: r.source })),
      skipped: [...skipped, ...due.slice(room).map((h) => ({ name: h.name, why: `предел ${OVERDUE_DAILY_LIMIT} в день с номера` }))],
      broadcastId: "",
    };
    if (recipients.length && opts.send) res.broadcastId = await launchHabitBroadcast(ctx, { manager, line, mode: "overdue", recipients, audience: `Постоянные клиенты ${manager}, молчат дольше обычного (${recipients.length})` });
    results.push(res);
  }
  if (opts.send && results.some((r) => r.broadcastId)) await kickBroadcast(SITE()).catch(() => undefined);
  return { results, skippedAll };
}
