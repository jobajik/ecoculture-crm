/**
 * Почерк менеджера (09.11.2026, владелец: «важно, чтобы бот старался общаться как сами менеджеры и не было различий:
 * изучи повадки, черты в переписках и пиши так, чтобы это было правдоподобно»).
 *
 * Профиль считается кодом по СОБСТВЕННЫМ сообщениям менеджера с его номера (`isOwnManagerMessage`: не помощник, не
 * дожим, не отправка из CRM, не рассылка, не сотрудникам): черты (длина, приветствия, регистр, точки, смайлики,
 * казахский, частые обороты) и живые примеры. Хранится настройкой `ManagerStyle:<код линии>` и пересчитывается раз в
 * неделю (`managerStyleRunner.ts`). Модели профиль отдаётся блоком `stylePromptBlock` («ты Ильяс, вот как ты пишешь»),
 * а цифры в её тексте проверяет `styledTextOk`: число, которого нет среди разрешённых (цены, количество, категории,
 * длины), — текст не уходит, вместо него шаблон кода. Чистые функции, проверка — `scripts/check-manager-style.ts`.
 */
import type { WaMessage } from "./types";

export const STYLE_SETTING_PREFIX = "ManagerStyle:";
/** За сколько дней берём сообщения и сколько примеров храним. */
export const STYLE_WINDOW_DAYS = 60;
export const STYLE_SAMPLES = 30;
/** Пересчитывать профиль, если он старше (дней). */
export const STYLE_REFRESH_DAYS = 7;
/** Минимум своих сообщений, чтобы профиль считался надёжным; меньше — пишем общим стилем. */
export const STYLE_MIN_MESSAGES = 40;
/** Длиннее текст постояннику не уходит (как у помощника). */
export const STYLE_MAX_CHARS = 380;

export interface StyleProfile {
  updatedAt: string;
  messages: number;
  medianChars: number;
  pctEmoji: number;
  pctLowercaseStart: number;
  pctNoFinalDot: number;
  pctKazakh: number;
  pctGreeting: number;
  pctExclamation: number;
  /** «кат» или «сорт» или «категория» — как менеджер зовёт категорию хризантемы. */
  gradeWord: string;
  /** «тг» / «₸» / «тенге» / пусто — как пишет цену. */
  priceWord: string;
  /** Имя перед приветствием («Фарида добрый день») или после («Добрый день Фарида»). */
  nameFirst: boolean;
  topOpeners: [string, number][];
  topBigrams: [string, number][];
  samples: string[];
}

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const KZ = /[әғқңөұүһі]|салем|сәлем|жаксы|жақсы|рахмет|керек|болды|бар\b|жок|жоқ|калай|қалай/i;
const GREET = /^(здравствуйте|добрый|доброе|добрый|салем|сәлем|сәлеметсіз|салеметсызбе|ассалаумағалейкум|уалейкумассалам|привет|здравствуй)/i;
const NAME_THEN_GREET = /^[А-ЯЁӘҒҚҢӨҰҮҺІ][а-яёәғқңөұүһі]+[,!]?\s+(добрый|доброе|здравствуйте|салеметсызбе|привет)/i;
const JUNK = /https?:\/\/|\+?\d[\d\s-]{8,}\d|kaspi\.kz|^\[/i;
const STOP = new Set("и в на с по не что это как я вы мы а но у за из для до от то же бы ли или если все всё есть был была были будет можно нужно надо там тут вот так ну да нет ок".split(/\s+/));

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : 0);
const top = (m: Map<string, number>, n: number, min = 1): [string, number][] =>
  Array.from(m)
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);

/**
 * Собственное сообщение менеджера с его номера: исходящее текстовое, не из журнала помощника (ответы ИИ, дожим,
 * отправка из CRM), не из рассылки, не сотруднику.
 */
export function isOwnManagerMessage(m: WaMessage, ctx: { autoIds: Set<string>; broadcastIds: Set<string>; staffKeys: Set<string>; keyOf: (phone: string) => string }): boolean {
  if (m.direction !== "out" || m.type !== "text" || !(m.text || "").trim()) return false;
  if (ctx.autoIds.has(m.messageId) || ctx.broadcastIds.has(m.messageId) || m.source === "assistant") return false;
  if (ctx.staffKeys.has(ctx.keyOf(m.phone))) return false;
  return true;
}

/** Профиль по текстам собственных сообщений. Примеры выбираются детерминированно (без случайности), без ссылок и номеров. */
export function buildStyleProfile(texts: string[], now = new Date().toISOString()): StyleProfile {
  const ts = texts.map((t) => (t || "").trim()).filter((t) => t.length >= 2);
  const openers = new Map<string, number>();
  const bigrams = new Map<string, number>();
  let emoji = 0, lower = 0, noDot = 0, kz = 0, greet = 0, excl = 0, nameFirst = 0, greetAny = 0;
  const gradeWords = new Map<string, number>();
  const priceWords = new Map<string, number>();
  for (const t of ts) {
    if (EMOJI.test(t)) emoji++;
    if (/^[a-zа-яёәғқңөұүһі]/.test(t)) lower++;
    if (!/[.!?…]$/.test(t)) noDot++;
    if (KZ.test(t)) kz++;
    if (GREET.test(t)) greet++;
    if (t.includes("!")) excl++;
    if (NAME_THEN_GREET.test(t)) nameFirst++;
    if (GREET.test(t) || NAME_THEN_GREET.test(t)) greetAny++;
    const low = t.toLowerCase();
    // `\b` в JS не знает кириллицы — границы слова через «не буква».
    for (const w of ["кат", "сорт", "категория"]) if (new RegExp(`(^|[^а-яёa-z])${w}([^а-яёa-z]|$)`).test(low)) gradeWords.set(w, (gradeWords.get(w) ?? 0) + 1);
    for (const w of ["тг", "₸", "тенге"]) if (low.includes(w)) priceWords.set(w, (priceWords.get(w) ?? 0) + 1);
    const ws = low.replace(/[^a-zа-яёәғқңөұүһі0-9\s-]/gi, " ").split(/\s+/).filter(Boolean);
    if (ws.length >= 2) openers.set(ws.slice(0, 2).join(" "), (openers.get(ws.slice(0, 2).join(" ")) ?? 0) + 1);
    for (let i = 0; i + 1 < ws.length; i++) {
      if (STOP.has(ws[i]) && STOP.has(ws[i + 1])) continue;
      if (/^\d+$/.test(ws[i]) && /^\d+$/.test(ws[i + 1])) continue;
      const b = `${ws[i]} ${ws[i + 1]}`;
      bigrams.set(b, (bigrams.get(b) ?? 0) + 1);
    }
  }
  const pool = ts.filter((t) => t.length >= 12 && t.length <= 280 && !JUNK.test(t));
  const samples: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < pool.length && samples.length < STYLE_SAMPLES; i++) {
    const t = pool[(i * 7919) % pool.length];
    const k = t.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(k)) continue;
    seen.add(k);
    samples.push(t);
  }
  const n = ts.length;
  return {
    updatedAt: now,
    messages: n,
    medianChars: median(ts.map((t) => t.length)),
    pctEmoji: pct(emoji, n),
    pctLowercaseStart: pct(lower, n),
    pctNoFinalDot: pct(noDot, n),
    pctKazakh: pct(kz, n),
    pctGreeting: pct(greet, n),
    pctExclamation: pct(excl, n),
    gradeWord: top(gradeWords, 1)[0]?.[0] ?? "",
    priceWord: top(priceWords, 1)[0]?.[0] ?? "",
    nameFirst: greetAny > 0 && nameFirst / greetAny >= 0.5,
    topOpeners: top(openers, 12, 3),
    topBigrams: top(bigrams, 25, 3),
    samples,
  };
}

export function parseStyleProfile(raw: string | undefined): StyleProfile | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Partial<StyleProfile>;
    if (!p || typeof p !== "object" || !Array.isArray(p.samples) || typeof p.messages !== "number") return null;
    return {
      updatedAt: String(p.updatedAt || ""),
      messages: p.messages,
      medianChars: Number(p.medianChars) || 0,
      pctEmoji: Number(p.pctEmoji) || 0,
      pctLowercaseStart: Number(p.pctLowercaseStart) || 0,
      pctNoFinalDot: Number(p.pctNoFinalDot) || 0,
      pctKazakh: Number(p.pctKazakh) || 0,
      pctGreeting: Number(p.pctGreeting) || 0,
      pctExclamation: Number(p.pctExclamation) || 0,
      gradeWord: String(p.gradeWord || ""),
      priceWord: String(p.priceWord || ""),
      nameFirst: p.nameFirst === true,
      topOpeners: Array.isArray(p.topOpeners) ? (p.topOpeners as [string, number][]) : [],
      topBigrams: Array.isArray(p.topBigrams) ? (p.topBigrams as [string, number][]) : [],
      samples: p.samples.map(String).slice(0, STYLE_SAMPLES),
    };
  } catch {
    return null;
  }
}

export function styleIsStale(p: StyleProfile | null, now = Date.now()): boolean {
  if (!p || !p.updatedAt) return true;
  const t = Date.parse(p.updatedAt);
  return !Number.isFinite(t) || now - t > STYLE_REFRESH_DAYS * 86400000;
}

/** Надёжен ли профиль: достаточно своих сообщений. */
export function styleUsable(p: StyleProfile | null): p is StyleProfile {
  return !!p && p.messages >= STYLE_MIN_MESSAGES && p.samples.length >= 10;
}

/** Блок подсказки модели: как пишет этот человек. */
export function stylePromptBlock(p: StyleProfile, managerName: string): string[] {
  const traits: string[] = [];
  traits.push(p.medianChars <= 20 ? "сообщения очень короткие, часто одна строка" : p.medianChars <= 40 ? "сообщения короткие, одна-две строки" : "сообщения средней длины, две-три строки");
  if (p.pctNoFinalDot >= 70) traits.push("точку в конце не ставит");
  if (p.pctLowercaseStart >= 40) traits.push("часто начинает с маленькой буквы");
  else traits.push("начинает с большой буквы");
  traits.push(p.pctEmoji >= 15 ? "смайлики использует часто" : p.pctEmoji >= 4 ? "смайлик изредка, один, в конце" : "смайликов почти нет");
  if (p.pctExclamation >= 25) traits.push("часто восклицательный знак");
  if (p.pctKazakh >= 8) traits.push("с казахоязычными клиентами пишет по-казахски русскими буквами, вперемешку с русским");
  else if (p.pctKazakh >= 2) traits.push("изредка вставляет казахские слова (салем, жаксы, рахмет)");
  if (p.gradeWord) traits.push(`категорию хризантемы называет «${p.gradeWord}»${p.gradeWord === "кат" ? " («Алтай 3 кат»)" : p.gradeWord === "сорт" ? " («3 сорт»)" : ""}`);
  if (p.priceWord) traits.push(`цену пишет «270 ${p.priceWord}»`);
  if (p.pctGreeting >= 15) traits.push(p.nameFirst ? "здоровается, имя клиента ставит перед приветствием («Фарида добрый день»)" : "здоровается, имя после приветствия («Добрый день Фарида» или «Привет Мира»)");
  else traits.push("часто начинает сразу с сути, без приветствия");
  const openers = p.topOpeners.map(([w]) => w).filter((w) => !/^\d/.test(w)).slice(0, 6);
  const phrases = p.topBigrams.map(([w]) => w).filter((w) => !/^\d|\d$/.test(w)).slice(0, 8);
  return [
    `ПОЧЕРК: ты пишешь ОТ ИМЕНИ ${managerName} с его WhatsApp, и клиент должен видеть его обычное сообщение, а не рассылку и не бота.`,
    `Его манера (посчитано по ${p.messages} его сообщениям): ${traits.join("; ")}.`,
    ...(openers.length ? [`Как он обычно начинает: ${openers.map((w) => `«${w}»`).join(", ")}.`] : []),
    ...(phrases.length ? [`Его частые обороты: ${phrases.map((w) => `«${w}»`).join(", ")}.`] : []),
    "Вот его настоящие сообщения клиентам (копируй манеру, регистр, пунктуацию, длину, НЕ копируй содержание):",
    ...p.samples.slice(0, 24).map((s) => `  › ${s.replace(/\s*\n\s*/g, " / ")}`),
    "Пиши ТАК ЖЕ: той же длины и тона, с теми же словечками. Без «Это Ильяс, Ecoculture» и подписей: клиент знает, чей это номер.",
    "Без длинных тире, без маркированных списков и жирного, если он сам так не пишет. Один вопрос в конце, на который легко ответить «да».",
  ];
}

/** Числа, которые модель вправе написать: цены, количества, категории, длины, пачки, время. Остальные — выдумка. */
export function allowedNumbers(parts: { prices?: number[]; qtys?: number[]; extra?: number[] }): Set<number> {
  const out = new Set<number>([1, 2, 3, 4, 40, 50, 60, 70, 80, 90, 10, 15]);
  for (const p of parts.prices ?? []) if (p > 0) out.add(Math.round(p));
  for (const q of parts.qtys ?? []) if (q > 0) out.add(Math.round(q));
  for (const e of parts.extra ?? []) if (e > 0) out.add(Math.round(e));
  return out;
}

/**
 * Годится ли текст модели: не пустой, не длиннее предела, без длинных тире, без ссылок и номеров телефонов, и каждое
 * число в нём разрешено. Сумма «50 × 270 = 13 500» разрешена, если её тоже положили в `allowed`. Время «10:00» и
 * даты «12.11» не считаются числами.
 */
export function styledTextOk(text: string, allowed: Set<number>, maxChars = STYLE_MAX_CHARS): { ok: boolean; why: string } {
  const t = (text || "").trim();
  if (t.length < 8) return { ok: false, why: "пусто" };
  if (t.length > maxChars) return { ok: false, why: `длиннее ${maxChars}` };
  if (/[—–]/.test(t)) return { ok: false, why: "длинное тире" };
  if (/https?:\/\/|wa\.me|kaspi\.kz/i.test(t)) return { ok: false, why: "ссылка" };
  if (/\+?\d[\d\s()-]{9,}\d/.test(t.replace(/\d{1,2}:\d{2}/g, ""))) return { ok: false, why: "похоже на номер телефона" };
  const cleaned = t.replace(/\d{1,2}:\d{2}/g, " ").replace(/\b\d{1,2}\.\d{1,2}(\.\d{2,4})?\b/g, " ");
  for (const m of cleaned.matchAll(/\d[\d\s]*\d|\d/g)) {
    const n = Number(m[0].replace(/\s+/g, ""));
    if (!Number.isFinite(n)) continue;
    if (!allowed.has(n)) return { ok: false, why: `число ${m[0].trim()} не из данных` };
  }
  return { ok: true, why: "" };
}

/** Задание модели: что сказать постояннику в этом режиме. Цифры — только из `offers`. */
export function habitTaskLines(input: {
  mode: "weekly" | "command" | "overdue";
  clientName: string;
  kazakh: boolean;
  usual: { label: string; qty: number; price: number; stock: number }[];
  focus?: string;
  lateDays?: number;
  gapDays?: number;
  shipDay?: string;
}): string[] {
  const offers = input.usual.filter((u) => u.stock > 0 && u.price > 0);
  const lines = [
    `КЛИЕНТ: ${input.clientName || "имя неизвестно, не обращайся по имени"}${input.kazakh ? " — переписывается по-казахски или вперемешку, пиши так же, как ты обычно пишешь таким клиентам" : ""}.`,
    offers.length
      ? `ЧТО ОН ОБЫЧНО БЕРЁТ И ЧТО СЕЙЧАС ЕСТЬ (цена за стебель, можно назвать): ${offers.map((u) => `${u.label} — обычно ${u.qty} шт, цена ${u.price}`).join("; ")}.`
      : "Его обычных позиций сейчас на складе нет: цены и количества НЕ называй, предложи скинуть что есть сегодня.",
  ];
  if (input.mode === "weekly") lines.push("ПОВОД: сегодня его обычный день заказа. Коротко напомни про свежий срез по его позициям и спроси, оформить ли как обычно (назови его обычное количество).");
  if (input.mode === "command") lines.push(`ПОВОД: ты решил напомнить постоянникам${input.focus ? ` про ${input.focus}` : ""}. Предложи это одной-двумя строками и спроси, нужно ли ему.`);
  if (input.mode === "overdue") lines.push(`ПОВОД: он обычно заказывает раз в ${input.gapDays || "несколько"} дн., а сейчас молчит уже ${input.lateDays || "несколько"} дн. дольше обычного. Мягко, без упрёка: спроси, нужно ли что-то, скажи, что есть сейчас. Не пиши «вы давно не заказывали» в лоб.`);
  if (input.shipDay) lines.push(`Доставка в его город — ближайшей фурой, ${input.shipDay}; другой день не обещай.`);
  lines.push("Не выдумывай цифр, скидок, дефицита. Не здоровайся дважды. Верни ТОЛЬКО текст сообщения.");
  return lines;
}
