import { chatJson, openAiConfigured } from "./openai";
import { OPT_OUT_LINE, personalize } from "./broadcast";
import { plainTyping } from "./humanStyle";
import {
  COPY_SCHEMA,
  COPY_SYSTEM_PROMPT,
  checkCopy,
  cleanCopy,
  copyUserMessage,
  niceName,
  splitOptOut,
  type CopySpec,
} from "./broadcastCopy";

// ---------------------------------------------------------------------------
// Копирайтер рассылок — вызов модели (правила и проверка ответа — `broadcastCopy.ts`).
//
// Одно сообщение: черновик программы → модель → проверка → при замечаниях одна повторная попытка с ними → не сошлось
// или модель не ответила — уходит черновик программы. Рассылка от сбоя ИИ не встаёт: шаг отправки живёт минуту, и
// на копирайтера из неё отдано не больше `budgetMs` (22 с — меньше паузы, которую второй отправитель ждёт после метки
// «шлю я»: у номера Земфиры она 35 с).
// ---------------------------------------------------------------------------

const WEEKDAYS = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];

/** День и час по Алматы: «вторник, 24.11.2026, 10:35 (утро)» — модели, час — проверке приветствия. */
export function copyMoment(now: Date = new Date()): { label: string; hour: number } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  const hour = Number(p.hour) % 24;
  const part = hour < 12 ? "утро" : hour < 17 ? "день" : "вечер";
  return { label: `${WEEKDAYS[wd] ?? ""}, ${p.day}.${p.month}.${p.year}, ${String(hour).padStart(2, "0")}:${p.minute} (${part})`, hour };
}

export interface CopyResult {
  /** Что отправлять: текст копирайтера или, если не вышло, черновик программы. Строка про «СТОП» уже на месте. */
  text: string;
  by: "ai" | "program";
  /** Почему ушёл черновик (или что было не так в первой попытке). */
  problems: string[];
  model: string;
  attempts: number;
}

export async function writeCopy(input: {
  spec: CopySpec;
  /** Имя для обращения (уже очищенное `greetingName`) или пусто. */
  name: string;
  /** Текст программы с «{имя}» — как лежит у получателя. */
  template: string;
  /** Что уже ушло другим сегодня (начало и конец сообщений). */
  avoid?: string[];
  now?: Date;
  /** Сколько всего можно думать, мс. */
  budgetMs?: number;
}): Promise<CopyResult> {
  const started = Date.now();
  const budget = input.budgetMs ?? 22000;
  const name = niceName(input.name);
  const moment = copyMoment(input.now);
  const fallback = plainTyping(personalize(input.template, name, false));
  const { body, optOut } = splitOptOut(fallback, OPT_OUT_LINE);
  const result = (text: string, by: "ai" | "program", problems: string[], model: string, attempts: number): CopyResult => ({ text, by, problems, model, attempts });
  if (!openAiConfigured()) return result(fallback, "program", ["ИИ не подключён"], "", 0);
  if (!body) return result(fallback, "program", ["пустой черновик"], "", 0);

  let problems: string[] = [];
  let model = "";
  let attempts = 0;
  for (let i = 0; i < 2; i++) {
    const left = budget - (Date.now() - started);
    if (left < 5000) break;
    attempts += 1;
    try {
      const res = await chatJson(
        COPY_SYSTEM_PROMPT,
        copyUserMessage({ spec: input.spec, name, program: body, today: moment.label, avoid: input.avoid, problems: i > 0 ? problems : undefined }),
        "broadcast_copy",
        COPY_SCHEMA as unknown as Record<string, unknown>,
        { fast: true, timeoutMs: Math.min(12000, left - 1000) }
      );
      model = res.model;
      const text = plainTyping(cleanCopy((res.data as { message?: unknown })?.message));
      problems = checkCopy(text, { program: body, name, spec: input.spec, hour: moment.hour, previous: input.avoid });
      if (problems.length === 0) return result(optOut ? `${text}\n\n${OPT_OUT_LINE}` : text, "ai", [], model, attempts);
    } catch (err) {
      problems = [`модель не ответила: ${err instanceof Error ? err.message.slice(0, 120) : "ошибка"}`];
    }
  }
  return result(fallback, "program", problems.length ? problems : ["не хватило времени"], model, attempts);
}
