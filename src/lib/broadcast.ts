import { phoneKey } from "./leads";
import type { WaMessage } from "./types";
import { EMPTY_BOT_ORDER, parseBotOrder, type BotOrderDraft } from "./botOrder";

// ---------------------------------------------------------------------------
// Рассылки WhatsApp через Green API и бот-автоответчик — чистые правила.
//
// Владелец: «включить бота по рассылке для наших клиентов через WhatsApp,
// чтобы у меня был такой интерфейс». Его решения: канал — Green API (обычный
// WhatsApp по QR, тот же рабочий номер, что и переписка; Wazzup он сначала
// выбрал, потом передумал); кому — клиенты, лиды и выбор вручную;
// что — текст с именем, картинка или прайс, ответы — менеджеру, автоответ ботом;
// запускают только админ и РОП.
//
// Главный риск обычного WhatsApp — блокировка номера за массовую отправку.
// Отсюда правила ниже: пауза между сообщениями случайная (как у человека),
// дневной предел, имя в тексте (одинаковые сообщения — признак спама),
// «ответьте СТОП» и отписка, которая уважается во всех следующих рассылках.
//
// Здесь только чистые функции — их зовут страницы, действия, вебхук и
// проверка `scripts/check-broadcasts.ts`. Модуль без googleapis (грабли 1.8).
// ---------------------------------------------------------------------------

/** Пауза между сообщениями рассылки, секунды: случайно в этих пределах. */
export const SEND_GAP_MIN_SECONDS = 25;
export const SEND_GAP_MAX_SECONDS = 50;
/** Сколько сообщений рассылок в сутки по умолчанию (меняется в настройках). */
export const DEFAULT_DAILY_LIMIT = 150;
export const MAX_DAILY_LIMIT = 1000;
/** Сколько получателей в одной рассылке — больше разбивайте на несколько. */
export const MAX_RECIPIENTS = 3000;
/** Предел текста сообщения WhatsApp держим с большим запасом. */
export const MAX_TEXT = 4000;

export const OPT_OUT_LINE = "Чтобы не получать такие сообщения, ответьте СТОП.";

export const BROADCAST_STATUSES = {
  DRAFT: "draft",
  SENDING: "sending",
  PAUSED: "paused",
  DONE: "done",
  CANCELLED: "cancelled",
} as const;

export const BROADCAST_STATUS_LABELS: Record<string, string> = {
  draft: "Черновик",
  sending: "Идёт отправка",
  paused: "На паузе",
  done: "Отправлена",
  cancelled: "Остановлена",
};

/** Состояние получателя в нашей таблице. Доставлено / прочитано — из WaStatuses. */
export const RECIPIENT_STATUSES = {
  QUEUED: "queued",
  SENT: "sent",
  ERROR: "error",
  SKIPPED: "skipped",
} as const;

// --- Номер ------------------------------------------------------------------

/**
 * Номер для WhatsApp цифрами с кодом страны: «8 701 555 20 30» → «77015552030».
 * Казахстанские городские (71x, 72x) — пусто: WhatsApp на них не бывает, а
 * отправка «в никуда» портит репутацию номера.
 */
export function waPhone(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "");
  let ten = "";
  if (d.length === 11 && (d[0] === "7" || d[0] === "8")) ten = d.slice(1);
  else if (d.length === 10) ten = d;
  else if (d.length >= 11 && d.length <= 13 && d[0] !== "7" && d[0] !== "8") return d; // чужая страна: как есть
  if (!ten) return "";
  if (ten[0] === "7" && !/^7[03-9]/.test(ten)) return "";
  if (ten[0] === "7") return `7${ten}`;
  // Российские и прочие мобильные на +7: 9xx.
  if (ten[0] === "9") return `7${ten}`;
  return "";
}

// --- Текст ------------------------------------------------------------------

/** Имя для обращения: контактное лицо, иначе название. «Без имени» — пусто. */
export function greetingName(contactPerson: string, name: string): string {
  // «ИП Жанибекова» → «Жанибекова»: форма собственности в обращении звучит как в налоговой.
  const pick = ((contactPerson || "").trim() || (name || "").trim()).replace(/^(ИП|ТОО|ООО|АО|ЧП)\s+/i, "").trim();
  if (!pick || /^без имени$/i.test(pick)) return "";
  // Длинное название точки («ТОО Цветы 24 на Абая») в обращение не годится.
  return pick.length > 32 ? "" : pick;
}

/**
 * Текст для одного получателя: {имя} подставляется, а если имени нет — фраза
 * «Здравствуйте, {имя}!» не превращается в «Здравствуйте, !».
 */
export function personalize(template: string, name: string, withOptOut: boolean): string {
  let text = String(template || "").replace(/\r/g, "");
  if (name) {
    text = text.replace(/\{\s*имя\s*\}/gi, name);
  } else {
    text = text
      .replace(/,\s*\{\s*имя\s*\}\s*([!.,])/gi, "$1")
      .replace(/\s*\{\s*имя\s*\}/gi, "");
  }
  text = text.trim();
  if (withOptOut && !/стоп/i.test(text)) text = `${text}\n\n${OPT_OUT_LINE}`;
  return text;
}

/** Отказ по тексту рассылки. Пустая строка — можно. */
export function broadcastTextRefusal(text: string, hasFile: boolean): string {
  const t = String(text || "").trim();
  if (!t && !hasFile) return "Напишите текст сообщения или прикрепите файл";
  if (t.length > MAX_TEXT) return `Текст длиннее ${MAX_TEXT} знаков — сократите`;
  return "";
}

/** Клиент написал «стоп» — больше рассылок ему не шлём. */
export function isOptOutText(text: string | null | undefined): boolean {
  const t = String(text || "").trim().toLowerCase().replace(/[.!\s]+$/g, "");
  return /^(стоп|stop|отписаться|отпишите|не пишите|тоқта|токта)$/.test(t);
}

// --- Получатели -------------------------------------------------------------

export interface AudienceCandidate {
  kind: "client" | "lead";
  refId: string;
  name: string;
  contactPerson: string;
  phone: string;
  city: string;
  managerEmail: string;
  /** Для фильтров: тип точки, стадия лида, обзвон, группа, дни без заказа. */
  clientType: string;
  stage: string;
  campaign: string;
  segment: string;
  daysSinceOrder: number | null;
  /** Какие цветы клиент брал хоть раз (коды) — для фильтра «брали хризантему». У лида пусто. */
  flowers: string[];
}

export interface AudienceRow extends AudienceCandidate {
  waPhone: string;
  /** Почему не пойдёт: нет мобильного, отписался, повтор номера. Пусто — пойдёт. */
  excluded: string;
}

/**
 * Кому реально уйдёт: без мобильного — нет, отписавшимся — нет, один номер —
 * одно сообщение (клиент и лид с тем же номером: остаётся клиент). Порядок
 * сохраняется.
 */
export function prepareAudience(candidates: AudienceCandidate[], optedOut: Set<string>): AudienceRow[] {
  const seen = new Set<string>();
  const sorted = [...candidates].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "client" ? -1 : 1));
  const byRef = new Map<string, AudienceRow>();
  for (const c of sorted) {
    const phone = waPhone(c.phone);
    const key = phoneKey(phone);
    let excluded = "";
    if (!phone) excluded = "нет мобильного";
    else if (optedOut.has(key)) excluded = "отписался";
    else if (seen.has(key)) excluded = "номер уже есть";
    if (!excluded) seen.add(key);
    byRef.set(`${c.kind}:${c.refId}`, { ...c, waPhone: phone, excluded });
  }
  return candidates.map((c) => byRef.get(`${c.kind}:${c.refId}`)!);
}

// --- Отправка ---------------------------------------------------------------

/** Пауза до следующего сообщения, секунды. `rnd` — для проверки. */
export function nextGapSeconds(rnd: () => number = Math.random): number {
  return Math.round(SEND_GAP_MIN_SECONDS + (SEND_GAP_MAX_SECONDS - SEND_GAP_MIN_SECONDS) * rnd());
}

/** Можно ли отправлять сейчас: не чаще паузы (защита от двух открытых вкладок). */
export function sendTooSoon(lastSendAt: string, now: Date): boolean {
  const t = Date.parse(lastSendAt || "");
  if (!Number.isFinite(t)) return false;
  return now.getTime() - t < (SEND_GAP_MIN_SECONDS - 5) * 1000;
}

/** Предел на сутки из настройки: пусто или мусор — по умолчанию. */
export function dailyLimitOf(raw: string | null | undefined): number {
  const n = Math.floor(Number(String(raw ?? "").trim()));
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAILY_LIMIT;
  return Math.min(n, MAX_DAILY_LIMIT);
}

// --- Отчёт ------------------------------------------------------------------

export interface RecipientRow {
  broadcastId: string;
  phone: string;
  name: string;
  kind: string;
  refId: string;
  managerEmail: string;
  status: string;
  messageId: string;
  sentAt: string;
  error: string;
}

export interface WaStatusRow {
  messageId: string;
  at: string;
  status: string;
  error: string;
}

const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

/** Лучший статус по сообщению: прочитано > доставлено > отправлено; ошибка — если только она. */
export function deliveryByMessage(statuses: WaStatusRow[]): Map<string, { status: string; error: string }> {
  const out = new Map<string, { status: string; error: string }>();
  for (const s of statuses) {
    if (!s.messageId) continue;
    const cur = out.get(s.messageId);
    const rank = STATUS_RANK[s.status] ?? 0;
    if (s.status === "error") {
      if (!cur) out.set(s.messageId, { status: "error", error: s.error });
      continue;
    }
    if (!cur || cur.status === "error" || rank > (STATUS_RANK[cur.status] ?? 0)) {
      out.set(s.messageId, { status: s.status, error: "" });
    }
  }
  return out;
}

export type RecipientState = "queued" | "skipped" | "error" | "sent" | "delivered" | "read" | "replied";

export const RECIPIENT_STATE_LABELS: Record<RecipientState, string> = {
  queued: "в очереди",
  skipped: "пропущен",
  error: "ошибка",
  sent: "отправлено",
  delivered: "доставлено",
  read: "прочитано",
  replied: "ответил",
};

export interface RecipientView extends RecipientRow {
  state: RecipientState;
  replyText: string;
  replyAt: string;
}

/**
 * Итог по каждому получателю: наша отметка + статусы Green API + ответ клиента
 * (входящее сообщение с того же номера ПОСЛЕ отправки).
 */
export function recipientViews(
  rows: RecipientRow[],
  statuses: Map<string, { status: string; error: string }>,
  messages: WaMessage[]
): RecipientView[] {
  const firstReply = new Map<string, WaMessage[]>();
  for (const m of messages) {
    if (m.direction !== "in") continue;
    const key = phoneKey(m.phone);
    if (!key) continue;
    const list = firstReply.get(key) ?? [];
    list.push(m);
    firstReply.set(key, list);
  }
  return rows.map((r) => {
    let state: RecipientState = r.status === "skipped" ? "skipped" : r.status === "error" ? "error" : r.status === "sent" ? "sent" : "queued";
    let error = r.error;
    let replyText = "";
    let replyAt = "";
    if (state === "sent") {
      const d = statuses.get(r.messageId);
      if (d?.status === "error") {
        state = "error";
        error = d.error || "WhatsApp не доставил";
      } else if (d?.status === "read") state = "read";
      else if (d?.status === "delivered") state = "delivered";
      const replies = (firstReply.get(phoneKey(r.phone)) ?? [])
        .filter((m) => m.at > r.sentAt)
        .sort((a, b) => (a.at < b.at ? -1 : 1));
      if (replies.length > 0 && state !== "error") {
        state = "replied";
        replyText = replies[0].text || "";
        replyAt = replies[0].at;
      }
    }
    return { ...r, error, state, replyText, replyAt };
  });
}

export interface BroadcastTotals {
  total: number;
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  replied: number;
  errors: number;
  skipped: number;
  optedOut: number;
}

/** Воронка рассылки. «Доставлено» включает прочитанные и ответившие — как в WhatsApp. */
export function broadcastTotals(views: RecipientView[], optedOutKeys: Set<string>): BroadcastTotals {
  const t: BroadcastTotals = { total: views.length, queued: 0, sent: 0, delivered: 0, read: 0, replied: 0, errors: 0, skipped: 0, optedOut: 0 };
  for (const v of views) {
    if (v.state === "queued") t.queued++;
    else if (v.state === "skipped") t.skipped++;
    else if (v.state === "error") t.errors++;
    if (["sent", "delivered", "read", "replied"].includes(v.state)) t.sent++;
    if (["delivered", "read", "replied"].includes(v.state)) t.delivered++;
    if (["read", "replied"].includes(v.state)) t.read++;
    if (v.state === "replied") t.replied++;
    if (v.state !== "queued" && v.state !== "skipped" && optedOutKeys.has(phoneKey(v.phone))) t.optedOut++;
  }
  return t;
}

/** Сколько сообщений рассылок ушло за сутки `day` («ГГГГ-ММ-ДД», по Алматы). */
export function sentOnDay(rows: RecipientRow[], day: string, dayOf: (iso: string) => string): number {
  return rows.filter((r) => r.status === "sent" && r.sentAt && dayOf(r.sentAt) === day).length;
}

// --- Бот ----------------------------------------------------------------------

export const BOT_MODES = { BOT: "bot", HANDOFF: "handoff", OPT_OUT: "optout" } as const;

/**
 * После сообщения живого человека бот молчит в этом чате столько часов — чтобы
 * не влезать в разговор менеджера. Пробовали 3 ч: на проверке живых чатов бот
 * влезал в переписку о доставке («курьер пусть звонит» → «Сколько штук в каждой
 * коробке кладём?»). Пишет менеджер — продаёт менеджер.
 */
export const BOT_HUMAN_QUIET_HOURS = 12;
/** Окно для предела ответов: столько часов после последнего сообщения бота. */
export const BOT_HANDOFF_QUIET_HOURS = 24;
/** Больше стольких ответов в сутки бот не даёт — защита от кольца с другим ботом. Продажа с заказом — 10–15 реплик. */
export const BOT_MAX_REPLIES = 40;

export interface BotSettings {
  enabled: boolean;
  /** «broadcast» — только в чатах, куда писала рассылка или бот; «all» — всем. */
  scope: "broadcast" | "all";
  /** «always» — круглосуточно; «offhours» — только вне рабочего времени. */
  hours: "always" | "offhours";
  /** Рабочее время менеджеров, часы по Алматы: [начало, конец). */
  workFrom: number;
  workTo: number;
  instructions: string;
}

export interface BotChat {
  phone: string;
  updatedAt: string;
  mode: string;
  humanAt: string;
  handoffAt: string;
  handoffReason: string;
  lastInMessageId: string;
  ourIds: string[];
  context: { role: "client" | "us"; text: string; at: string }[];
  name: string;
  botReplies: number;
  /** Дожим молчащего клиента: сколько раз, когда последний, закрыт ли (`botNudge.ts`). */
  nudge: BotNudgeState;
}

export interface BotNudgeState {
  count: number;
  at: string;
  done: boolean;
}

export const EMPTY_NUDGE: BotNudgeState = { count: 0, at: "", done: false };

function hoursSince(iso: string, now: Date): number {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? (now.getTime() - t) / 3600000 : Infinity;
}

/**
 * Отвечать ли боту на входящее. Возвращает причину молчания или пусто —
 * «отвечать». Любое сомнение — молчать: лишний ответ бота в чужом разговоре
 * хуже, чем минута ожидания менеджера.
 */
export function botSilenceReason(input: {
  settings: BotSettings;
  chat: BotChat | null;
  messageId: string;
  now: Date;
  /** Час по Алматы. */
  hour: number;
}): string {
  const { settings, chat, now } = input;
  if (!settings.enabled) return "бот выключен";
  if (chat?.lastInMessageId && chat.lastInMessageId === input.messageId) return "повтор уведомления";
  if (chat?.mode === BOT_MODES.OPT_OUT) return "клиент отписался";
  if (settings.scope === "broadcast" && (!chat || chat.ourIds.length === 0)) return "не из рассылки";
  if (settings.hours === "offhours" && input.hour >= settings.workFrom && input.hour < settings.workTo) {
    return "рабочее время — отвечают менеджеры";
  }
  if (chat && hoursSince(chat.humanAt, now) < BOT_HUMAN_QUIET_HOURS) return "в чате пишет менеджер";
  if (chat && chat.botReplies >= BOT_MAX_REPLIES && hoursSince(chat.updatedAt, now) < BOT_HANDOFF_QUIET_HOURS) {
    return "бот уже ответил много раз";
  }
  return "";
}

/** Настройки бота из пар ключ-значение вкладки Settings. */
export function botSettingsFrom(map: Record<string, string>): BotSettings {
  const hour = (raw: string | undefined, def: number) => {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n >= 0 && n <= 24 ? n : def;
  };
  return {
    enabled: /^(1|true|yes|да)$/i.test((map.BotEnabled || "").trim()),
    scope: (map.BotScope || "").trim() === "all" ? "all" : "broadcast",
    hours: (map.BotHours || "").trim() === "offhours" ? "offhours" : "always",
    workFrom: hour(map.BotWorkFrom, 9),
    workTo: hour(map.BotWorkTo, 19),
    instructions: (map.BotInstructions || "").trim(),
  };
}

/** Память разговора для бота: последние реплики, не длиннее предела. */
export function pushContext(
  context: BotChat["context"],
  item: BotChat["context"][number],
  maxItems = 12,
  maxChars = 3000
): BotChat["context"] {
  const next = [...context, { ...item, text: item.text.slice(0, 600) }].slice(-maxItems);
  while (next.length > 1 && JSON.stringify(next).length > maxChars) next.shift();
  return next;
}

/**
 * Ответ модели → то, что бот сделает. Менеджеру бот НЕ передаёт (владелец,
 * 01.10.2026: «бот не должен переключать на менеджеров, он должен продать»).
 * Подтверждённый заказ (`order.confirmed`) бот оформляет сам — заявка, счёт
 * Kaspi (`botOrderRunner.ts`); новый номер Kaspi (`kaspiPhone`) — счёт заново;
 * тревога (жалоба, просят человека) — записка менеджеру. Пустой или странный
 * ответ без заказа — не отправлять ничего.
 */
export function botDecision(raw: unknown): {
  reply: string;
  order: BotOrderDraft;
  kaspiPhone: string;
  alert: string;
  silent: boolean;
} {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const reply = text(o.reply, 1500);
  const order = parseBotOrder(o.order);
  const kaspiPhone = text(o.kaspiPhone, 30).replace(/\D/g, "");
  const act = order.confirmed || kaspiPhone.length >= 10;
  // Молчать — автоответ магазина, «👍», разговор о доставке: модель так решила или ответа нет.
  if (!act && (o.silent === true || !reply)) return { reply: "", order: EMPTY_BOT_ORDER, kaspiPhone: "", alert: "", silent: true };
  return { reply, order, kaspiPhone, alert: text(o.alert, 200), silent: false };
}

/**
 * Сообщение-кивок: смайлики, «ок», «спасибо», «👍». Отвечать на него нечем —
 * бот молчит и модель не спрашивает (живой случай: три ответа на три «👍»).
 */
export function isAckOnly(text: string): boolean {
  const t = String(text || "")
    .toLowerCase()
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]/gu, "")
    .replace(/[.!,)\s(]+/g, " ")
    .trim();
  if (!t) return true;
  return /^(ок|окей|ok|спасибо|рахмет|благодарю|понял|поняла|ясно|спс|👍)( (спасибо|рахмет|большое))?$/.test(t);
}

export const BOT_OPT_OUT_TEXT = "Хорошо, больше не будем присылать рассылки. Если понадобимся — просто напишите.";
