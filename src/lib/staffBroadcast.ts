import { commonExclusion, type ExclusionContext } from "./autoBroadcast";
import type { NudgeOffer } from "./botNudge";

// ---------------------------------------------------------------------------
// Рассылка по просьбе менеджера в WhatsApp основному номеру (27.10.2026, владелец: «дай менеджерам делать рассылку,
// обращаясь в чат Ecoculture Казахстан — пишут с утра: „Сделай сегодня рассылку 20-ти клиентам из контактов, с упором на
// продажи хризантемы 3 категории, с фото“»). Решения владельца: с номера САМОГО менеджера (не подключён — с основного);
// сначала план и «ДА»; «из контактов» — тёплые: его клиенты и лиды, с кем он переписывался в WhatsApp, первыми — кто
// брал названную позицию. Разбор — `staffCommand.ts` (intent broadcast), работа — `staffBroadcastRunner.ts`.
// ---------------------------------------------------------------------------

/** Настройка с планом, ждущим «ДА»: `StaffBroadcast:<номер сотрудника>`. */
export const STAFF_BROADCAST_PREFIX = "StaffBroadcast:";
export const STAFF_BROADCAST_TTL_MS = 3 * 3600000;
/** Сколько, если не назвал. */
export const STAFF_BROADCAST_DEFAULT = 20;
/** Больше за раз не берём: с номера менеджера в час уходит до 20, в день — до 50 (`MANAGER_PACE`). */
export const STAFF_BROADCAST_MAX = 30;

export interface StaffBroadcastRecipient {
  phone: string;
  name: string;
  kind: string;
  refId: string;
  managerEmail: string;
  text: string;
}

export interface StaffBroadcastPlan {
  at: string;
  line: string;
  /** «вашего номера», «основного номера». */
  via: string;
  title: string;
  fileId: string;
  fileName: string;
  focus: string;
  recipients: StaffBroadcastRecipient[];
}

export function parseStaffBroadcastPlan(raw: string | undefined, now = Date.now()): StaffBroadcastPlan | null {
  try {
    const p = JSON.parse(raw || "") as StaffBroadcastPlan;
    if (!p?.at || !Array.isArray(p.recipients) || now - Date.parse(p.at) > STAFF_BROADCAST_TTL_MS) return null;
    return p;
  } catch {
    return null;
  }
}

const clean = (t: string) => String(t || "").trim().toLowerCase().replace(/ё/g, "е").replace(/[.!)\s]+$/, "");

/** «ДА» на план: короткое согласие. */
export function isYesText(text: string): boolean {
  const t = clean(text);
  return t.length <= 30 && /^(да|даа+|да,? ?(запускай|давай|отправляй)|давай|запускай|запусти|отправляй|поехали|ок|ok|окей|иә|ия|ия,? жибер|жибер|go)$/.test(t);
}

/** «НЕТ» на план. («ОТМЕНА» у сотрудников сводки останавливает автопилот — её не просим.) */
export function isNoText(text: string): boolean {
  const t = clean(text);
  return t.length <= 30 && /^(нет|не надо|не нужно|не запускай|отбой|жок|жоқ|керек емес)$/.test(t);
}

/** Сколько брать: названное число в пределах, не названо — 20. */
export function broadcastCount(asked: number): number {
  const n = Math.round(Number(asked) || 0);
  if (n <= 0) return STAFF_BROADCAST_DEFAULT;
  return Math.min(n, STAFF_BROADCAST_MAX);
}

export interface ContactCandidate {
  key: string;
  phone: string;
  name: string;
  kind: string;
  refId: string;
  managerEmail: string;
  /** Последнее сообщение клиента на этом номере, ISO. */
  lastInAt: string;
  /** Брал названную позицию (цветок и категория) за 60 дней. */
  boughtFocus: boolean;
  /** Лид закрыт, карточка выключена, наш магазин, клиент отказался в переписке. */
  closed: string;
}

/**
 * Кому: собеседники номера, кто сам писал хотя бы раз. Не берём: закрытых, отказавшихся и всех, кого режут общие запреты
 * рассылок (сотрудник, отписался, переписка меньше суток назад, рассылка за 7 дней). Первыми — кто брал названную
 * позицию, потом — кто писал недавно.
 */
export function pickBroadcastContacts(
  candidates: ContactCandidate[],
  ctx: ExclusionContext,
  count: number
): { take: ContactCandidate[]; skipped: Record<string, number> } {
  const skipped: Record<string, number> = {};
  const skip = (why: string) => (skipped[why] = (skipped[why] || 0) + 1);
  const seen = new Set<string>();
  const ok: ContactCandidate[] = [];
  for (const c of candidates) {
    if (!c.key || seen.has(c.key)) continue;
    seen.add(c.key);
    if (!c.lastInAt) {
      skip("сам ни разу не писал");
      continue;
    }
    if (c.closed) {
      skip(c.closed);
      continue;
    }
    const why = commonExclusion(c.key, ctx);
    if (why) {
      skip(why);
      continue;
    }
    ok.push(c);
  }
  ok.sort((a, b) => Number(b.boughtFocus) - Number(a.boughtFocus) || b.lastInAt.localeCompare(a.lastInAt));
  return { take: ok.slice(0, count), skipped };
}

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ")} ₸`;

/**
 * Текст каждому — собирает код, цены из прайса (модель цен не пишет): приветствие от имени менеджера, позиции с ценой,
 * один вопрос. `{имя}` подставляет отправка. Регион — «ближайшей фурой в …» вместо «на завтра».
 */
export function staffBroadcastText(input: { manager: string; offers: NudgeOffer[]; label: (o: NudgeOffer) => string; shipDay?: string }): string {
  const hello = input.manager ? `Здравствуйте, {имя}! Это ${input.manager}, Ecoculture.` : "Здравствуйте, {имя}! Это Ecoculture.";
  const ask = input.shipDay ? `Отправим ближайшей фурой — ${input.shipDay}. Записать вас?` : "Поставить вам на завтра? Для пробы — от 50 шт.";
  return [hello, "Сегодня свежий срез:", "", ...input.offers.map((o) => `• ${input.label(o)} — *${money(o.price)}*`), "", ask].join("\n");
}

/** Ответ сотруднику: план и «ответьте ДА». */
export function staffBroadcastPlanText(input: { plan: StaffBroadcastPlan; asked: number; skipped: Record<string, number>; withPhoto: boolean }): string {
  const { plan } = input;
  const n = plan.recipients.length;
  const names = plan.recipients
    .slice(0, 8)
    .map((r) => r.name || `…${r.phone.slice(-4)}`)
    .join(", ");
  const skippedText = Object.entries(input.skipped)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([why, k]) => `${why} — ${k}`)
    .join("; ");
  const sample = (plan.recipients[0]?.text || "").replace("{имя}", plan.recipients[0]?.name || "");
  return [
    `Рассылка с ${plan.via}: *${n}* ${n < input.asked ? `(просили ${input.asked}, подходящих меньше) ` : ""}— ${plan.focus}.`,
    `Кому: ${names}${n > 8 ? ` и ещё ${n - 8}` : ""}.`,
    ...(skippedText ? [`Не беру: ${skippedText}.`] : []),
    "",
    `Текст${input.withPhoto ? " (с фото позиции)" : ""}:`,
    sample,
    "",
    "Ответьте *ДА* — запущу, *НЕТ* — не запускаю. План ждёт 3 часа.",
  ].join("\n");
}
