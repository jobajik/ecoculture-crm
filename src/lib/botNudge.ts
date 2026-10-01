import { BOT_MODES, type BotChat, type BotSettings } from "./broadcast";

// ---------------------------------------------------------------------------
// Дожим молчащего клиента (владелец, 01.10.2026: «бот уходит в инактив, когда
// клиент молчит; давай каждый час спрашивать и пытаться продавать»).
//
// Не без конца: неофициальный WhatsApp банят за «робота», а клиент на десятое
// «ну что, берёте?» пишет «СТОП» — и рассылки ему больше не уходят никогда.
// Поэтому четыре касания раз в полтора часа (владелец, 01.10: «таймер раз в
// 1.5 часа») и только днём; дальше бот ждёт, пока клиент напишет сам. Клиент
// ответил — счёт заново. Модель вправе решить,
// что дожимать нечего (отказ, заказ оплачен, служебный разговор), — тогда
// дожим этого разговора закрыт. Проверка — `check-bot-order`.
// ---------------------------------------------------------------------------

/**
 * Пауза перед каждым касанием, часов: каждые полтора часа, пока клиент молчит,
 * четыре раза (владелец, 01.10.2026: «давай таймер раз в 1.5 часа, если клиент
 * молчит»). Было 1 / 3 / 20 ч. Последнее касание — мягкое, без цен.
 */
export const NUDGE_GAPS_HOURS = [1.5, 1.5, 1.5, 1.5];
/** Дожимаем только днём по Алматы: [с, до). */
export const NUDGE_FROM_HOUR = 9;
export const NUDGE_TO_HOUR = 20;
/** Менеджер писал в чате за столько дней — чат его, бот не дожимает. */
export const NUDGE_MANAGER_CHAT_DAYS = 14;
/** Разговор, где клиент молчит дольше, — уже не разговор: не дожимаем. */
export const NUDGE_MAX_SILENCE_DAYS = 3;

function hoursSince(iso: string, now: Date): number {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) ? (now.getTime() - t) / 3600000 : Infinity;
}

/**
 * Пора ли дожимать этот чат и почему нет. `attempt` — номер касания (1…4) или
 * 0; `reason` — словами, для диагностики (`scripts/diag-bot-nudge.ts`).
 * Только разговоры, где клиент уже отвечал, а последним писали мы.
 */
export function nudgeStatus(input: { settings: BotSettings; chat: BotChat; now: Date; hour: number }): { attempt: number; reason: string } {
  const { settings, chat, now, hour } = input;
  const no = (reason: string) => ({ attempt: 0, reason });
  if (!settings.enabled) return no("бот выключен");
  if (chat.mode === BOT_MODES.OPT_OUT) return no("отписался");
  if (settings.scope === "broadcast" && chat.ourIds.length === 0) return no("не из рассылки");
  if (hour < NUDGE_FROM_HOUR || hour >= NUDGE_TO_HOUR) return no("не рабочее время");
  // Менеджер сам писал в этом чате за две недели — это его клиент и его разговор (доставка, «как в
  // прошлый раз»): бот туда с «пробной партией» не лезет. Первая проверка на живых чатах показала
  // именно это — «Ок», «Как в прошлый раз с доставкой в ГРЭС», «Я у Ильяса беру».
  if (hoursSince(chat.humanAt, now) < NUDGE_MANAGER_CHAT_DAYS * 24) return no("менеджер писал в чате за 14 дней");
  const nudge = chat.nudge ?? { count: 0, at: "", done: false };
  if (nudge.done) return no("дожим закрыт (модель: не писать, или заказ и счёт)");
  if (nudge.count >= NUDGE_GAPS_HOURS.length) return no(`все ${NUDGE_GAPS_HOURS.length} касания были`);
  const ctx = chat.context;
  const last = ctx[ctx.length - 1];
  if (!last) return no("пустой чат");
  if (last.role !== "us") return no("последним писал клиент — ждёт ответа бота");
  const lastClient = [...ctx].reverse().find((c) => c.role === "client");
  if (!lastClient) return no("клиент ни разу не ответил"); // это рассылка, а не разговор
  if (hoursSince(lastClient.at, now) > NUDGE_MAX_SILENCE_DAYS * 24) return no("клиент молчит дольше 3 дней");
  const from = nudge.count === 0 ? last.at : nudge.at;
  const gap = NUDGE_GAPS_HOURS[nudge.count];
  const passed = hoursSince(from, now);
  if (passed < gap) return no(`рано: прошло ${passed.toFixed(1)} ч из ${gap}`);
  return { attempt: nudge.count + 1, reason: "пора" };
}

/** Пора ли дожимать: номер касания (1…4) или 0. */
export function nudgeDue(input: { settings: BotSettings; chat: BotChat; now: Date; hour: number }): number {
  return nudgeStatus(input).attempt;
}

/** Задание модели на касание: вместо «ответь на последнее сообщение». */
export function nudgeTask(attempt: number, silentHours: number): string {
  const hours = Math.max(1, Math.round(silentHours));
  return [
    `Клиент не отвечает уже около ${hours} ч после нашего последнего сообщения. Это дожим №${attempt} из ${NUDGE_GAPS_HOURS.length}.`,
    "Напиши ОДНО короткое сообщение (1–2 предложения), которое вернёт клиента к покупке: новый повод (свежий срез, позиция",
    "заканчивается на складе, доставка завтра, пробная партия 50 шт.), конкретное предложение с ценой и простой вопрос,",
    "на который легко ответить «да». Не повторяй прошлые сообщения, не упрекай за молчание, не дави.",
    attempt >= NUDGE_GAPS_HOURS.length ? "Это последнее касание: мягко — «если понадобится, просто напишите»." : "",
    "Назови не больше двух позиций, и цену каждой бери ТОЛЬКО из прайса: найди строку сорта и нужную длину/категорию в ней.",
    "silent=true, если: клиент отказался или сказал, что берёт у нашего менеджера (Ильяс, Эмиль, Бауыржан и др.) или у",
    "другого поставщика; он уже заказал и ждёт доставку; заказ оплачен; разговор служебный (доставка, курьер); писать неуместно.",
    "Оформлять заказ сейчас нельзя: order.confirmed=false, kaspiPhone пусто.",
  ]
    .filter(Boolean)
    .join("\n");
}

// --- Решение «писать ли» и сам текст -------------------------------------------
//
// Первая версия просила модель и решить, и написать — на живых чатах она дожимала
// «Я у Ильяса беру», «Я не занимаюсь цветами», автоответ детского магазина и
// путала цены (Jumilia 60 см — 410 вместо 220). Теперь: модель только РЕШАЕТ,
// узким вопросом с ответом «да/нет» (по умолчанию — нет), а текст с ценами
// собирает код из склада и прайса — цифру выдумать негде.

export const NUDGE_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["nudge", "reason"],
  properties: {
    nudge: { type: "boolean", description: "true — клиент интересовался покупкой и замолчал; написать ещё раз уместно." },
    reason: { type: "string", description: "Почему — одной короткой фразой." },
  },
} as const;

export function nudgeDecisionPrompt(): string {
  return [
    "Ты проверяешь переписку оптовой цветочной компании с клиентом в WhatsApp. Последним писали мы, клиент молчит.",
    "Реши: уместно ли сейчас написать клиенту ещё раз с предложением купить цветы.",
    "nudge=true ТОЛЬКО если клиент проявлял интерес к покупке (спрашивал цену, наличие, условия, говорил «да»,",
    "«интересно», обсуждал заказ) и после этого замолчал.",
    "nudge=false, если хоть одно: отказался или «сейчас не нужно», «товар уже привезли»; берёт у нашего менеджера",
    "(называет имя: Ильяс, Эмиль, Бауыржан и др.) или у другого поставщика; не занимается цветами, ошиблись номером;",
    "это автоответ магазина или бота, а не человек; уже заказал и ждёт доставку или заказ оформлен; разговор о доставке,",
    "курьере, оплате уже сделанного заказа; просил не писать; жалоба; клиент ни разу не проявил интереса.",
    "Сомневаешься — nudge=false.",
  ].join("\n");
}

/** Ответ модели о дожиме; странный — «не писать». */
export function parseNudgeDecision(raw: unknown): { nudge: boolean; reason: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { nudge: o.nudge === true, reason: typeof o.reason === "string" ? o.reason.trim().slice(0, 200) : "" };
}

export interface NudgeOffer {
  flowerType: string;
  variety: string;
  grade: string;
  price: number;
  qty: number;
}

const normWord = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/**
 * Что предложить: позиции со склада с ценой из прайса. Сначала то, о чём шла
 * речь (сорт назван в переписке или в рассылке клиенту), потом самые большие
 * остатки ходовых позиций. Не больше двух.
 */
export function pickNudgeOffers(input: {
  stock: { flower: string; variety: string; grade: string; qty: number }[];
  priceOf: (flowerType: string, variety: string, grade: string) => number;
  mentioned: string;
  isLiquid: (flowerType: string, grade: string) => boolean;
}): NudgeOffer[] {
  const text = normWord(input.mentioned);
  const rows = input.stock
    .filter((s) => s.qty >= 100 && s.variety && input.isLiquid(s.flower, s.grade))
    .map((s) => ({ flowerType: s.flower, variety: s.variety, grade: s.grade, qty: s.qty, price: input.priceOf(s.flower, s.variety, s.grade) }))
    .filter((s) => s.price > 0);
  const named = rows.filter((r) => text.includes(normWord(r.variety)) || (normWord(r.variety) === "altaj" && text.includes("алтай")));
  const byQty = (a: NudgeOffer, b: NudgeOffer) => b.qty - a.qty;
  const out: NudgeOffer[] = [];
  for (const r of [...named.sort(byQty), ...rows.sort(byQty)]) {
    if (out.length >= 2) break;
    if (out.some((o) => o.flowerType === r.flowerType && o.variety === r.variety)) continue;
    out.push(r);
  }
  return out;
}

/**
 * Текст касания. Цены — из `pickNudgeOffers`, то есть из прайса. Оформление
 * WhatsApp: позиции списком, цена и сумма жирным, вопрос отдельной строкой.
 */
export function nudgeText(attempt: number, offers: NudgeOffer[], labels: (o: NudgeOffer) => string): string {
  const price = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ")} ₸`;
  const line = (o: NudgeOffer) => `• ${labels(o)} — *${price(o.price)}*`;
  if (attempt >= NUDGE_GAPS_HOURS.length || offers.length === 0) {
    return "Если цветы понадобятся — просто напишите сюда.\nПодберём по наличию и привезём. Хорошего дня!";
  }
  const first = offers[0];
  if (attempt === 1) {
    return ["Здравствуйте! Сегодня свежий срез:", "", ...offers.map(line), "", "Поставить вам на завтра? Для пробы — от 50 шт."].join("\n");
  }
  if (attempt === 2) {
    return [line(first), "", "Сейчас хорошо в наличии, но разбирают быстро.", "Отложить для вас 50–100 шт. на завтра?"].join("\n");
  }
  return [
    "Могу собрать пробную партию:",
    "",
    `• ${labels(first)} — 50 шт. × ${price(first.price)} = *${price(first.price * 50)}*`,
    "",
    "Доставка завтра. Оформить?",
  ].join("\n");
}
