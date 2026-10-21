import { cleanStage, isClosedStage, phoneKey } from "./leads";
import { looksLikeRefusal } from "./clientRefusal";
import { messageText } from "./whatsapp";
import { OPT_OUT_LINE, waPhone } from "./broadcast";
import { addDaysToKey } from "./dayKey";
import type { NudgeOffer } from "./botNudge";
import type { PushLine } from "./salesPush";
import type { Lead, LeadAnalysis, WaMessage } from "./types";

// ---------------------------------------------------------------------------
// Автопилот рассылок (17.10.2026). Владелец: «Почему ты не делаешь рассылки автоматом сам? Почему надо
// напоминать?» Его решения: четыре правила — дожим просроченных лидов, клиенты, которые давно не
// заказывали, распродажа «в первую очередь», новый срез и наличие; утром в WhatsApp — план, и если до
// 10:00 не ответили «ОТМЕНА», сайт отправляет сам, без компьютера.
//
// Здесь только чистые правила: кому, каким текстом, когда. Чтение, запись и отправка —
// `autoBroadcastRunner.ts`; проверка — `scripts/check-auto-broadcast.ts`.
// ---------------------------------------------------------------------------

export type AutoRule = "leads" | "sleeping" | "push" | "fresh";
export const AUTO_RULES: AutoRule[] = ["leads", "sleeping", "push", "fresh"];
export const AUTO_RULE_LABELS: Record<AutoRule, string> = {
  leads: "Дожим просроченных лидов",
  sleeping: "Давно не заказывали",
  push: "Распродажа «в первую очередь»",
  fresh: "Свежий срез и наличие",
};
export const AUTO_RULE_HINTS: Record<AutoRule, string> = {
  leads: "лидам, у которых касание сегодня или просрочено, — с того номера, где шла переписка",
  sleeping: "клиентам, которые молчат дольше обычного: что брали в прошлый раз и цены сейчас",
  push: "тем, кто уже брал распродаваемую позицию: склад и цена от объёма",
  fresh: "по понедельникам — тёплым клиентам: что сейчас хорошо в наличии",
};

/** Настройки автопилота — JSON во вкладке Settings. Нет настройки — все правила включены (выбор владельца). */
export const AUTO_SETTING = "AutoBroadcasts";
/** План на сегодня: когда собран, когда уйдёт, какие рассылки, отменён ли. */
export const AUTO_PLAN_SETTING = "AutoBroadcastPlan";
/** Замок цепочки отправки: кто сейчас ведёт рассылки и что было в последний раз. */
export const CHAIN_SETTING = "BroadcastChain";
/** Кто «автор» рассылок автопилота. */
export const AUTO_AUTHOR = "Автопилот";

/** Сколько за день по правилу. Лиды — на каждый номер свои. */
export const AUTO_CAPS: Record<AutoRule, number> = { leads: 30, sleeping: 15, push: 15, fresh: 25 };
/** Всего с рабочего номера за день по автопилоту (давно не заказывали + распродажа + срез). */
export const AUTO_MAIN_MAX = 45;

/** План собирается с 9:00, уходит с 10:00, но не раньше, чем через 45 минут после письма с планом. */
export const PLAN_FROM_HOUR = 9;
export const PLAN_TO_HOUR = 16;
export const ACTIVATE_HOUR = 10;
export const CANCEL_WINDOW_MINUTES = 45;

/** Не писать тому, кому любая рассылка уходила за столько дней. */
export const RECENT_BROADCAST_DAYS = 7;
/** Тому, кто заказывал за столько дней, — не предлагать. */
export const ORDERED_RECENTLY_DAYS = 3;
/** Переписка (в любую сторону) моложе стольких часов — идёт разговор, не вмешиваемся. */
export const CHAT_QUIET_HOURS = 24;
/** Лиды: не больше двух напоминаний без ответа и не чаще раза в 4 дня. */
export const LEAD_MAX_UNANSWERED = 2;
export const LEAD_REMIND_GAP_DAYS = 4;
/** Свежий разбор (`Решения ИИ`) годится как текст, если он не старше этого и новых сообщений после него нет. */
/** Черновик разбора старше стольких дней не годится (с 21.10.2026 автопилот черновики не шлёт вовсе — см. `LeadPick.draft`). */
export const DRAFT_MAX_AGE_DAYS = 10;
/** «Давно не заказывали»: молчит не меньше недели и в полтора раза дольше обычного, но не дольше двух месяцев. */
export const SLEEP_MIN_DAYS = 7;
export const SLEEP_MAX_DAYS = 60;
export const SLEEP_GAP_FACTOR = 1.5;
/** Распродажа — тем, кто брал эту позицию за столько дней. */
export const PUSH_BUYERS_DAYS = 60;
/** Свежий срез — по понедельникам; «тёплый» — писал нам или покупал за столько дней. */
export const FRESH_WEEKDAY = 1;
export const FRESH_WARM_DAYS = 60;

export interface AutoConfig {
  rules: Record<AutoRule, boolean>;
}

export function parseAutoConfig(raw: string | null | undefined): AutoConfig {
  const rules: Record<AutoRule, boolean> = { leads: true, sleeping: true, push: true, fresh: true };
  try {
    const o = JSON.parse(raw || "{}") as Record<string, unknown>;
    const r = (o.rules && typeof o.rules === "object" ? o.rules : o) as Record<string, unknown>;
    for (const k of AUTO_RULES) if (typeof r[k] === "boolean") rules[k] = r[k] as boolean;
  } catch {
    // Испорченная настройка — как по умолчанию.
  }
  return { rules };
}

export const autoConfigValue = (cfg: AutoConfig) => JSON.stringify({ rules: cfg.rules });
export const anyRuleOn = (cfg: AutoConfig) => AUTO_RULES.some((r) => cfg.rules[r]);

// --- План дня ---------------------------------------------------------------------------------------------

export interface PlanRecord {
  day: string;
  /** Когда собран, ISO. */
  at: string;
  /** С какого момента можно слать, ISO. */
  activateAt: string;
  ids: string[];
  counts: Partial<Record<AutoRule, number>>;
  activated: boolean;
  cancelled: boolean;
  cancelledBy: string;
  note: string;
}

export const EMPTY_PLAN: PlanRecord = { day: "", at: "", activateAt: "", ids: [], counts: {}, activated: false, cancelled: false, cancelledBy: "", note: "" };

export function parsePlanRecord(raw: string | null | undefined): PlanRecord {
  try {
    const o = JSON.parse(raw || "{}") as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const counts: Partial<Record<AutoRule, number>> = {};
    const c = (o.counts && typeof o.counts === "object" ? o.counts : {}) as Record<string, unknown>;
    for (const k of AUTO_RULES) if (Number(c[k]) > 0) counts[k] = Math.round(Number(c[k]));
    return {
      day: str(o.day).slice(0, 10),
      at: str(o.at),
      activateAt: str(o.activateAt),
      ids: Array.isArray(o.ids) ? o.ids.filter((x): x is string => typeof x === "string") : [],
      counts,
      activated: o.activated === true,
      cancelled: o.cancelled === true,
      cancelledBy: str(o.cancelledBy),
      note: str(o.note).slice(0, 300),
    };
  } catch {
    return { ...EMPTY_PLAN };
  }
}

export const planRecordValue = (p: PlanRecord) => JSON.stringify(p);

/** Час и минуты по Алматы (сервер живёт по Алматы — `timezone.ts`, но считаем явно: так проверяется где угодно). */
export function almatyParts(d: Date): { day: string; hour: number; minutes: number; weekday: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  const hour = Number(p.hour) % 24;
  return { day: `${p.year}-${p.month}-${p.day}`, hour, minutes: hour * 60 + Number(p.minute), weekday };
}

/** Пора ли собирать план: пн–сб, 9:00–16:00, сегодня ещё не собирали, хоть одно правило включено. */
export function planDue(now: Date, plan: PlanRecord, cfg: AutoConfig): boolean {
  const t = almatyParts(now);
  if (t.weekday === 0 || !anyRuleOn(cfg)) return false;
  if (t.hour < PLAN_FROM_HOUR || t.hour >= PLAN_TO_HOUR) return false;
  return plan.day !== t.day;
}

/** С какого момента план можно отправлять: 10:00 по Алматы, но не раньше чем через 45 минут после письма. */
export function activateAtFor(plannedAt: Date): string {
  const t = almatyParts(plannedAt);
  const tenAm = Date.parse(`${t.day}T${String(ACTIVATE_HOUR).padStart(2, "0")}:00:00+05:00`);
  return new Date(Math.max(tenAm, plannedAt.getTime() + CANCEL_WINDOW_MINUTES * 60000)).toISOString();
}

/** Пора ли запускать сегодняшний план. */
export function activationDue(now: Date, plan: PlanRecord): boolean {
  if (!plan.day || plan.activated || plan.cancelled || plan.ids.length === 0) return false;
  if (plan.day !== almatyParts(now).day) return false;
  return !!plan.activateAt && now.getTime() >= Date.parse(plan.activateAt);
}

/** Сотрудник ответил на план «отмена»: короткое сообщение, только эти слова. «СТОП» — это отписка клиента, его не берём. */
export function isCancelText(text: string | null | undefined): boolean {
  const t = String(text || "").trim().toLowerCase().replace(/ё/g, "е");
  if (!t || t.length > 40) return false;
  return /^(отмена|отменить|отмени|отменяй|отменяю|не отправляй|не отправлять|не надо|без рассылок?|отмена рассылк[иа]?|рассылк[уи] не надо)[\s.!)]*$/.test(t);
}

// --- Кто сейчас разговаривает и кому что уходило ---------------------------------------------------------

export interface ChatFacts {
  /** Последнее сообщение в любую сторону, на любом номере. */
  lastAt: string;
  lastDirection: "in" | "out";
  /** Номер, на котором было последнее сообщение. */
  line: string;
  /** Последнее входящее (клиент писал), ISO или пусто. */
  lastInAt: string;
  /** Текст последнего входящего — по нему видно, что клиент закрыл разговор («неактуально»). */
  lastInText: string;
}

export function chatFacts(messages: (Pick<WaMessage, "phone" | "at" | "direction" | "line"> & Partial<Pick<WaMessage, "type" | "text">>)[]): Map<string, ChatFacts> {
  const out = new Map<string, ChatFacts>();
  for (const m of messages) {
    const k = phoneKey(m.phone);
    if (!k || !m.at) continue;
    const cur = out.get(k) ?? { lastAt: "", lastDirection: "out" as const, line: "", lastInAt: "", lastInText: "" };
    if (m.at > cur.lastAt) {
      cur.lastAt = m.at;
      cur.lastDirection = m.direction;
      cur.line = m.line || "";
    }
    if (m.direction === "in" && m.at > cur.lastInAt) {
      cur.lastInAt = m.at;
      cur.lastInText = m.text ? messageText({ type: m.type || "text", text: m.text }) : "";
    }
    out.set(k, cur);
  }
  return out;
}

export interface SentFacts {
  /** Последнее сообщение любой рассылки, ISO. */
  lastSentAt: string;
  /** Напоминания автопилота лидам (время отправки). */
  leadReminders: string[];
}

export function sentFacts(
  recipients: { broadcastId: string; phone: string; status: string; sentAt: string }[],
  autoOf: Map<string, string>
): Map<string, SentFacts> {
  const out = new Map<string, SentFacts>();
  for (const r of recipients) {
    if (r.status !== "sent" || !r.sentAt) continue;
    const k = phoneKey(r.phone);
    if (!k) continue;
    const cur = out.get(k) ?? { lastSentAt: "", leadReminders: [] };
    if (r.sentAt > cur.lastSentAt) cur.lastSentAt = r.sentAt;
    if (autoOf.get(r.broadcastId) === "leads") cur.leadReminders.push(r.sentAt);
    out.set(k, cur);
  }
  return out;
}

const hoursSince = (iso: string, now: Date) => (iso ? (now.getTime() - Date.parse(iso)) / 3600000 : Infinity);

export interface ExclusionContext {
  now: Date;
  staff: Set<string>;
  optedOut: Set<string>;
  facts: Map<string, ChatFacts>;
  sent: Map<string, SentFacts>;
}

/** Общие запреты для всех правил. Пусто — можно. */
export function commonExclusion(key: string, ctx: ExclusionContext, recentBroadcastDays = RECENT_BROADCAST_DAYS): string {
  if (!key) return "нет мобильного";
  if (ctx.staff.has(key)) return "сотрудник";
  if (ctx.optedOut.has(key)) return "отписался";
  const f = ctx.facts.get(key);
  if (f && hoursSince(f.lastAt, ctx.now) < CHAT_QUIET_HOURS) return "переписка меньше суток назад";
  const s = ctx.sent.get(key);
  if (s && hoursSince(s.lastSentAt, ctx.now) < recentBroadcastDays * 24) return `рассылка была за ${recentBroadcastDays} дн.`;
  return "";
}

// --- Правило «лиды» ---------------------------------------------------------------------------------------

export interface LeadPick {
  lead: Lead;
  phone: string;
  line: string;
  /**
   * Текст из разбора ИИ. С 21.10.2026 всегда пусто — текст собирает код: черновики разбора писались «от имени
   * менеджера» и обещали то, чего автопилот сделать не может («подтверждаю заказ, оформим сейчас», «готовлю счёт»),
   * а потом никто не оформлял (Гера, Аида — замечания Земфиры). Поле оставлено для «Решений ИИ», где черновик
   * отправляет человек.
   */
  draft: string;
}

export function pickLeadReminders(input: {
  leads: Lead[];
  analyses: Map<string, Pick<LeadAnalysis, "createdAt" | "decision" | "draft" | "nextTouchDays" | "lostReason" | "suggestedStage" | "temperature">>;
  ctx: ExclusionContext;
  today: string;
  lineOk: (line: string) => boolean;
  toDay: (iso: string) => string;
  /** Номера, у которых есть карточка клиента (телефон или мессенджер): их ведёт менеджер, напоминание не идёт. */
  clientKeys?: Set<string>;
}): { take: LeadPick[]; skipped: Record<string, number>; waiting: Lead[] } {
  const { ctx, today } = input;
  const take: LeadPick[] = [];
  const skipped: Record<string, number> = {};
  const waiting: Lead[] = [];
  const skip = (why: string) => (skipped[why] = (skipped[why] ?? 0) + 1);
  const seen = new Set<string>();
  const perLine = new Map<string, number>();
  const due = input.leads
    .filter((l) => !isClosedStage(cleanStage(l.stage)) && !l.clientId && l.nextTouchAt && l.nextTouchAt.slice(0, 10) <= today)
    .sort((a, b) => a.nextTouchAt.localeCompare(b.nextTouchAt));
  for (const lead of due) {
    const phone = waPhone(lead.phone);
    const key = phoneKey(phone);
    if (!phone || seen.has(key)) {
      skip(phone ? "номер повторяется" : "нет мобильного");
      continue;
    }
    // Передан менеджеру — дальше пишет он, а не номер Земфиры (21.10.2026, Земфира: «бот повторно пишет
    // клиентам, которых я уже передала Ильгару»); карточка клиента по номеру — то же самое.
    if (lead.handedOverAt) {
      skip("передан менеджеру");
      continue;
    }
    if (input.clientKeys?.has(key)) {
      skip("есть карточка клиента");
      continue;
    }
    const f = ctx.facts.get(key);
    if (!f) {
      skip("нет переписки в WhatsApp");
      continue;
    }
    if (f.lastDirection === "in") {
      // Клиент написал последним — ему нужен живой ответ, а не напоминание.
      waiting.push(lead);
      skip("клиент ждёт ответа");
      continue;
    }
    if (looksLikeRefusal(f.lastInText)) {
      skip("клиент отказался");
      continue;
    }
    // Рассылку человека лиду тоже считаем: после неё напоминание через 4 дня, а не 7.
    const why = commonExclusion(key, ctx, LEAD_REMIND_GAP_DAYS);
    if (why) {
      skip(why);
      continue;
    }
    const s = ctx.sent.get(key);
    const unanswered = (s?.leadReminders ?? []).filter((at) => !f.lastInAt || at > f.lastInAt).length;
    if (unanswered >= LEAD_MAX_UNANSWERED) {
      skip("два напоминания без ответа");
      continue;
    }
    const a = input.analyses.get(lead.leadId);
    if (a?.decision === "lost") {
      skip("ИИ советует отказ");
      continue;
    }
    if (a?.decision === "follow_up" && a.nextTouchDays) {
      const dueDay = addDaysToKey(input.toDay(a.createdAt) || today, a.nextTouchDays);
      if (dueDay > today) {
        skip("ИИ советует написать позже");
        continue;
      }
    }
    if (!input.lineOk(f.line)) {
      skip("номер, где шла переписка, не подключён");
      continue;
    }
    if ((perLine.get(f.line) ?? 0) >= AUTO_CAPS.leads) {
      skip("предел на сегодня");
      continue;
    }
    seen.add(key);
    perLine.set(f.line, (perLine.get(f.line) ?? 0) + 1);
    take.push({ lead, phone, line: f.line, draft: "" });
  }
  return { take, skipped, waiting };
}

// --- Правило «давно не заказывали» ------------------------------------------------------------------------

export interface ClientHistory {
  clientId: string;
  name: string;
  contactPerson: string;
  phone: string;
  managerEmail: string;
  /** Дни заказов (продажи, без отменённых), по возрастанию, без повторов. */
  days: string[];
  revenue: number;
  /** Позиции последнего заказа. */
  lastItems: { flowerType: string; variety: string; grade: string; quantity: number }[];
  /** Позиции за `PUSH_BUYERS_DAYS` дней — цветок|градация. */
  recentGrades: Set<string>;
  flowers: Set<string>;
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** Обычный перерыв между заказами клиента, дни; меньше двух заказов — неизвестен. */
export function usualGapDays(days: string[]): number | null {
  if (days.length < 2) return null;
  return Math.round(dayDiff(days[0], days[days.length - 1]) / (days.length - 1));
}

/** Молчит ли клиент дольше обычного (и не слишком давно — того уже не вернуть рассылкой). */
export function isSleeping(days: string[], today: string): boolean {
  if (days.length === 0) return false;
  const quiet = dayDiff(days[days.length - 1], today);
  if (quiet < SLEEP_MIN_DAYS || quiet > SLEEP_MAX_DAYS) return false;
  const gap = usualGapDays(days);
  return gap === null || quiet > gap * SLEEP_GAP_FACTOR;
}

export const orderedRecently = (days: string[], today: string) =>
  days.length > 0 && dayDiff(days[days.length - 1], today) < ORDERED_RECENTLY_DAYS;

// --- Тексты -----------------------------------------------------------------------------------------------

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ")} ₸`;
const qty = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ")} шт.`;
const offerLine = (o: NudgeOffer, label: (o: NudgeOffer) => string) => `• ${label(o)} — *${money(o.price)}*`;
const withOptOut = (t: string) => `${t}\n\n${OPT_OUT_LINE}`;

/** Напоминание лиду: свежий черновик разбора или предложение со склада. Без «СТОП» — это личная переписка. */
export function leadReminderText(input: { draft: string; manager: string; offers: NudgeOffer[]; label: (o: NudgeOffer) => string }): string {
  if (input.draft) return input.draft;
  const hello = input.manager ? `Здравствуйте, {имя}! Это ${input.manager}, Ecoculture.` : "Здравствуйте, {имя}! Это Ecoculture.";
  if (input.offers.length === 0) {
    return [hello, "", "Напомню о себе: свежий срез каждый день, привезём завтра.", "Подобрать вам что-нибудь?"].join("\n");
  }
  return [hello, "Напомню о себе — сегодня свежий срез:", "", ...input.offers.map((o) => offerLine(o, input.label)), "", "Поставить вам на завтра? Для пробы — от 50 шт."].join("\n");
}

/** «Давно не заказывали»: что брали в прошлый раз и что есть сейчас. */
export function sleepingText(input: { last: { label: string; quantity: number }[]; offers: NudgeOffer[]; label: (o: NudgeOffer) => string }): string {
  const lines = ["Здравствуйте, {имя}!", "Давно от вас не было заказа — повторим?"];
  if (input.last.length) lines.push("", "В прошлый раз вы брали:", ...input.last.map((l) => `• ${l.label} — ${qty(l.quantity)}`));
  lines.push("", "Сейчас в наличии:", ...input.offers.map((o) => offerLine(o, input.label)), "", "Поставить вам на завтра?");
  return withOptOut(lines.join("\n"));
}

/** Распродажа: тем, кто уже брал эту позицию. */
export function pushText(line: Pick<PushLine, "label" | "varieties" | "bulkFrom" | "bulkPrice">): string {
  const vars = line.varieties.filter((v) => v.price > 0 && v.qty >= 50).slice(0, 3);
  const lines = ["Здравствуйте, {имя}!", `${line.label} — сейчас много на складе, свежий срез:`, "", ...vars.map((v) => `• ${v.variety} — *${money(v.price)}*`)];
  if (line.bulkFrom > 0 && line.bulkPrice > 0) lines.push("", `От ${qty(line.bulkFrom)} — *${money(line.bulkPrice)}* за стебель.`);
  lines.push("", "Вы уже брали эту позицию — поставить на завтра?");
  return withOptOut(lines.join("\n"));
}

/** Свежий срез: что сейчас хорошо в наличии. */
export function freshText(offers: NudgeOffer[], label: (o: NudgeOffer) => string): string {
  return withOptOut(
    ["Здравствуйте, {имя}!", "Свежий срез на этой неделе:", "", ...offers.map((o) => offerLine(o, label)), "", "Поставить вам на завтра? Привезём по Алматы."].join("\n")
  );
}

// --- Письмо с планом ---------------------------------------------------------------------------------------

export interface PlanPart {
  rule: AutoRule;
  /** Подпись номера: «рабочий», «Земфира», «Ильяс». */
  lineLabel: string;
  count: number;
  sample: string;
}

export function planMessageText(input: { parts: PlanPart[]; activateAt: string; link: string; waiting: number }): string {
  const total = input.parts.reduce((s, p) => s + p.count, 0);
  const t = almatyParts(new Date(input.activateAt));
  const at = `${String(t.hour).padStart(2, "0")}:${String(t.minutes % 60).padStart(2, "0")}`;
  const lines = ["*Авторассылки на сегодня*", "", `С ${at} уйдёт ${total} сообщ.:`];
  for (const p of input.parts) lines.push(`• ${AUTO_RULE_LABELS[p.rule]}${p.lineLabel ? ` (${p.lineLabel})` : ""}: ${p.count}`);
  const sample = input.parts.find((p) => p.sample);
  if (sample) {
    const text = sample.sample.replace(/\{\s*имя\s*\}/gi, "Айгерим").replace(`\n\n${OPT_OUT_LINE}`, "");
    lines.push("", `Пример («${AUTO_RULE_LABELS[sample.rule]}»):`, text.length > 600 ? `${text.slice(0, 600)}…` : text);
  }
  if (input.waiting > 0) lines.push("", `Ещё ${input.waiting} лид(ов) ждут живого ответа — им автопилот не пишет.`);
  lines.push("", `Все тексты: ${input.link}`, "Не отправлять сегодня — ответьте *ОТМЕНА*.");
  return lines.join("\n");
}

/** Как долго ждать следующего шага цепочки, если отправители сказали разное: минимальное, но не меньше 1 с. */
export function chainWait(waits: number[]): number {
  const w = waits.filter((x) => Number.isFinite(x) && x >= 0);
  return w.length ? Math.max(1, Math.min(...w)) : 0;
}

/** Замок цепочки: кто ведёт и когда последний раз отметился. */
export interface ChainLock {
  token: string;
  at: string;
  note: string;
}
export const CHAIN_LOCK_SECONDS = 90;

export function parseChainLock(raw: string | null | undefined): ChainLock {
  try {
    const o = JSON.parse(raw || "{}") as Record<string, unknown>;
    return { token: typeof o.token === "string" ? o.token : "", at: typeof o.at === "string" ? o.at : "", note: typeof o.note === "string" ? o.note.slice(0, 300) : "" };
  } catch {
    return { token: "", at: "", note: "" };
  }
}

/** Занят ли замок кем-то другим. */
export function chainBusy(lock: ChainLock, myToken: string, now: Date): boolean {
  if (!lock.token || lock.token === myToken || !lock.at) return false;
  return now.getTime() - Date.parse(lock.at) < CHAIN_LOCK_SECONDS * 1000;
}
