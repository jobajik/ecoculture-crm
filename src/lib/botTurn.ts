/**
 * Ход бота в живой переписке — правила, которых не видно из одного уведомления.
 *
 * 08.10.2026, клиентка: «Мне нужно на Караганду 3000 Джамили…» → бот: «Jumilia 40 см около 100 шт.
 * Поставить 100?» → «Блин зачем мне 100 штук, мне 1000 надо» → бот ТЕМ ЖЕ текстом. А раньше на «Нет
 * сорта Джулия…» и «Белая» (через 4 с) ушло два ответа подряд. Владелец: «почему повторяешься, а не
 * предлагаешь новое?» и «не объясняешь, что этих сортов пока нет, но срезка будет позже».
 *
 * Отсюда три правила:
 * - **ответ не повторяет уже отправленное** (`repeatsOurMessage`): совпал с одним из наших последних
 *   сообщений — модель переспрашивается с пояснением, а одинаковый текст второй раз не уходит;
 * - **на серию сообщений — один ответ** (`supersededBy`): клиент дописал следующее, пока бот думал, —
 *   отвечает ход последнего сообщения, а не каждого; кивок («ок», смайлик) ответ не забирает;
 * - **ход видит всё, что клиент написал** (`missingIncoming`): каждое уведомление обрабатывается само
 *   по себе, и память бота у второго ещё не знает первое — недостающее берётся из `WaMessages`.
 */
import { isAckOnly, pushContext, type BotChat } from "./broadcast";
import { phoneKey } from "./leads";

export interface TurnMessage {
  messageId: string;
  phone: string;
  direction: string;
  at: string;
  text: string;
  type: string;
}

/** Текст для сравнения: без регистра, знаков, эмодзи и лишних пробелов. */
export function normText(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function words(text: string): Set<string> {
  return new Set(normText(text).split(" ").filter((w) => w.length > 1));
}

/**
 * Ответ повторяет одно из наших последних сообщений: тот же текст или почти тот же (общих слов ≥ 85 %).
 * Короткие «Да», «Хорошо» не в счёт — у них повтор естественен.
 */
export function repeatsOurMessage(reply: string, context: BotChat["context"], lookBack = 3): boolean {
  const r = normText(reply);
  if (r.length < 25) return false;
  const rw = words(reply);
  const ours = context.filter((c) => c.role === "us").slice(-lookBack);
  return ours.some((c) => {
    const o = normText(c.text);
    if (o === r) return true;
    const ow = words(c.text);
    if (ow.size === 0 || rw.size === 0) return false;
    let common = 0;
    for (const w of rw) if (ow.has(w)) common += 1;
    return common / Math.max(rw.size, ow.size) >= 0.85;
  });
}

function sameClientLine(c: BotChat["context"][number], m: TurnMessage): boolean {
  if (c.role !== "client") return false;
  const dt = Math.abs((Date.parse(c.at) || 0) - (Date.parse(m.at) || 0));
  // Та же секунда — то же сообщение (у голосового в памяти «[audio]», а в WaMessages расшифровка).
  return dt <= 1000 || (dt <= 5000 && normText(c.text) === normText(m.text || `[${m.type}]`));
}

/**
 * Входящие этого номера, которых нет в памяти бота: за последние `windowMin` минут и после
 * последней строки памяти. Порядок — по времени.
 */
export function missingIncoming(
  context: BotChat["context"],
  recent: TurnMessage[],
  phone: string,
  now: Date,
  windowMin = 15
): TurnMessage[] {
  const key = phoneKey(phone);
  const from = now.getTime() - windowMin * 60_000;
  return recent
    .filter((m) => m.direction === "in" && phoneKey(m.phone) === key && (Date.parse(m.at) || 0) >= from)
    .filter((m) => !context.some((c) => sameClientLine(c, m)))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
}

/** Память с дописанными недостающими входящими — по времени, в тех же пределах, что `pushContext`. */
export function withMissingIncoming(context: BotChat["context"], missing: TurnMessage[]): BotChat["context"] {
  if (missing.length === 0) return context;
  const all = [...context, ...missing.map((m) => ({ role: "client" as const, text: m.text || `[${m.type}]`, at: m.at }))];
  all.sort((a, b) => (a.at < b.at ? -1 : 1));
  return all.reduce<BotChat["context"]>((acc, item) => pushContext(acc, item), []);
}

/**
 * Клиент написал ещё что-то после `last` (не кивок) — отвечать будет ход того сообщения, этот молчит.
 * Кивок ответа не забирает: на «Блин, мне 1000 надо» + «😅» отвечает ход первого.
 */
export function supersededBy(last: { messageId: string; at: string }, recent: TurnMessage[], phone: string): TurnMessage | null {
  const key = phoneKey(phone);
  const newer = recent
    .filter((m) => m.direction === "in" && phoneKey(m.phone) === key && m.messageId !== last.messageId)
    .filter((m) => (Date.parse(m.at) || 0) > (Date.parse(last.at) || 0))
    // Кивок («ок», «👍», смайлик) ответа не ждёт; голосовое, фото и текст по делу — ждут.
    .filter((m) => !(m.type === "text" && isAckOnly(m.text)))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  return newer[newer.length - 1] ?? null;
}

/**
 * Две записи одной памяти (два уведомления писали параллельно) — объединить: строки обеих по
 * времени без повторов, наши номера сообщений обеих. Иначе последняя запись стирала бы ответ
 * соседнего хода, и бот забывал, что уже ответил.
 */
export function mergeChatMemory(mine: BotChat, fresh: BotChat | null): BotChat {
  if (!fresh) return mine;
  const seen = new Set<string>();
  const all = [...fresh.context, ...mine.context]
    .sort((a, b) => (a.at < b.at ? -1 : 1))
    .filter((c) => {
      const k = `${c.role}|${normText(c.text)}|${Math.round((Date.parse(c.at) || 0) / 5000)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const context = all.reduce<BotChat["context"]>((acc, item) => pushContext(acc, item), []);
  const ourIds = Array.from(new Set([...fresh.ourIds, ...mine.ourIds])).slice(-20);
  return {
    ...mine,
    context,
    ourIds,
    botReplies: Math.max(mine.botReplies, fresh.botReplies),
    humanAt: [mine.humanAt, fresh.humanAt].sort().pop() || "",
    handoffAt: mine.handoffAt >= fresh.handoffAt ? mine.handoffAt : fresh.handoffAt,
    handoffReason: mine.handoffAt >= fresh.handoffAt ? mine.handoffReason : fresh.handoffReason,
    lastInMessageId: mine.lastInMessageId || fresh.lastInMessageId,
  };
}

/** Задание модели, если её ответ повторил уже отправленное. */
export const REPEAT_TASK =
  "Твой ответ дословно повторяет наше предыдущее сообщение, а клиент на него уже возразил. Не повторяй его. " +
  "Ответь на последнее сообщение клиента ДРУГИМ предложением: сложи наличие сорта по всем длинам, добери объём " +
  "другими длинами или похожим сортом того же цвета (с ценами и суммой), а чего не хватает — скажи честно и назови, " +
  "когда по плану срезки ожидаем этот сорт.";
