import { messageText } from "./whatsapp";
import type { WaMessage } from "./types";

/**
 * Как помощник пишет (21.10.2026, замечания Земфиры к боту на её номере: «слишком длинные сообщения —
 * сразу сорта, цены, наличие, доставка», «не здоровается, когда клиент пришёл с рекламы с шаблонным
 * сообщением»). Правила, которые держит КОД, а не подсказка модели: модель их уже нарушала.
 */

/** Длиннее стольких знаков — ответ переспрашивается короче (`SHORT_TASK`). */
export const ASSISTANT_MAX_CHARS = 380;
/** Во сколько знаков просим уложиться при пересказе. */
export const ASSISTANT_SHORT_CHARS = 300;

const GREETING = /^(здравствуйте|здравствуй|добрый\s+(день|вечер|утро)|доброе\s+утро|доброго\s+(дня|вечера)|привет|сәлем|сәлеметсіз|саламатсыз|салем|салеметсиз|қайырлы|кайырлы|ассалау|ассалям)/i;
const KAZAKH = /[әіңғүұқөһ]/i;

/** Есть ли приветствие в начале текста. */
export const startsWithGreeting = (text: string) => GREETING.test(String(text || "").trim());

/**
 * Первое наше сообщение в переписке (клиент написал первым — с рекламы приходят шаблоном «Можете
 * отправить прайс и фото хризантем») обязано начинаться с приветствия. Модель здоровалась через раз —
 * теперь код: нет нашего сообщения до этого и приветствия в ответе нет — ставим его сами, на языке ответа.
 */
export function ensureGreeting(reply: string, chat: Pick<WaMessage, "direction" | "type" | "text">[]): string {
  const text = String(reply || "").trim();
  if (!text) return text;
  const weWrote = chat.some((m) => m.direction === "out" && messageText(m).trim() !== "");
  if (weWrote || startsWithGreeting(text)) return text;
  return `${KAZAKH.test(text) ? "Сәлеметсіз бе!" : "Здравствуйте!"} ${text}`;
}

/** Ответ слишком длинный для живой переписки — попросить модель сократить. */
export const tooLong = (reply: string) => String(reply || "").length > ASSISTANT_MAX_CHARS;

export const SHORT_TASK = `Твой ответ слишком длинный для WhatsApp. Перепиши его КОРОЧЕ — не больше ${ASSISTANT_SHORT_CHARS} знаков: одна тема, не больше двух позиций с ценой, один вопрос в конце. Остальное клиент спросит сам.`;
