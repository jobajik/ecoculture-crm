import { chatJson, openAiConfigured } from "./openai";
import { salesKnowledge } from "./botEngine";
import { toWhatsApp } from "./botOrder";
import { sendFileByUrl, sendText, type GreenConfig } from "./greenApi";
import { isInfoPhoto, photoLabel, pickItemPhoto, type BotPhoto } from "./botPhotos";
import { listBotPhotos, botPhotoSentWrite } from "./repo/botPhotos";
import { photoFileUrl } from "./catalogFiles";
import { commitAtomic } from "./sheets";
import { ourPhoneKeys } from "./lineNotify";
import { phoneKey } from "./leads";
import { mergeMessages, messageText } from "./whatsapp";
import { appendWaMessages, listWaMessages } from "./repo/talks";
import { optedOutKeys, settingsMap } from "./repo/broadcasts";
import { saveSettings } from "./repo/settings";
import { chainBusy, parseChainLock } from "./autoBroadcast";
import { listUsers } from "./repo/users";
import { listLeads } from "./repo/leads";
import { listClients } from "./repo/clients";
import { appendAssistantLog, assistantLineConfig, listAssistantLog, listAssistantLines, listWaLines } from "./repo/waLines";
import { ASSISTANT_STALE_HOURS, assistantVerdict, genitiveName, LEADS_LINE, type WaLine } from "./waLines";
import { sellerTurn } from "./lineSeller";
import { cleanStage, isClosedStage } from "./leads";
import { ensureGreeting, SHORT_TASK, tooLong } from "./assistantText";
import { greenConfig } from "./greenApi";
import type { Lead, WaMessage } from "./types";
import { humanStylePrompt } from "./humanStyle";
import { packingPromptBlock } from "./packing";

// ---------------------------------------------------------------------------
// ИИ-помощник менеджера (16.10.2026, владелец выбрал «подсказывает, отвечает при
// молчании»). Две роли:
//  - ПОДСКАЗКА: в «Переписках» кнопка «Предложить ответ» — черновик, менеджер
//    правит и отправляет сам;
//  - ОТВЕТ ПРИ МОЛЧАНИИ: клиент ждёт дольше 20 минут в рабочее время или пишет
//    вечером и в выходные (`assistantVerdict`) — помощник отвечает с номера
//    менеджера сам. Заказ и счёт он НЕ оформляет: подтверждает, что понял, и
//    оставляет менеджеру записку «оформить заказ: …» (`AssistantLog`, kind note).
// Знание о ценах и складе — то же, что у бота (`salesKnowledge`), модель — та же быстрая.
// ---------------------------------------------------------------------------

const S = (description: string) => ({ type: "string", description });

export const ASSISTANT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "silent", "needs_manager", "photo"],
  properties: {
    reply: S("Сообщение клиенту в WhatsApp. Пусто, если silent"),
    silent: { type: "boolean", description: "true — не отвечать: автоответ, кивок, не про цветы, сотрудник, поставщик, водитель, личное" },
    needs_manager: S("Что сделать менеджеру одной фразой: оформить заказ (позиции, количество, день), дать ответ на вопрос, позвонить. Иначе пусто"),
    photo: {
      type: "object",
      additionalProperties: false,
      required: ["flowerType", "variety", "grade"],
      description:
        "О какой позиции твой ответ (предлагаешь её или клиент о ней спрашивает) — система приложит её фото из теплицы, ответ уйдёт подписью к фото. Нет конкретной позиции — пустые строки.",
      properties: {
        flowerType: { type: "string", enum: ["", "rose", "chrysanthemum", "eustoma"] },
        variety: { type: "string" },
        grade: { type: "string" },
      },
    },
  },
};

export function assistantSystemPrompt(p: {
  managerName: string;
  prices: string;
  stock: string;
  /** Склад и цена одним списком (`sellableForBot`) — если есть, прайс и склад отдельно не показываются. */
  sellable?: string;
  storeNote: string;
  harvest: string;
  push: string;
  client: string;
  instructions: string;
  today: string;
  /** Чей это номер — «leads» (Земфира) или номер менеджера: от этого зависит, что обещать клиенту. */
  line?: string;
}): string {
  const leads = p.line === LEADS_LINE;
  const weekday = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"][new Date(`${p.today}T12:00:00`).getDay()];
  // Что есть и почём — одним списком (21.10.2026, Земфира: бот называл категории из прайса, которых нет на складе).
  const goods = p.sellable
    ? `\nЧто есть сейчас и почём (тенге за стебель; ТОЛЬКО эти позиции — чего нет в списке, того нет, и цену его не называй):\n${p.sellable}`
    : [
        p.prices ? `\nДействующий прайс:\n${p.prices}` : "\nПрайса сейчас нет — цены не называй.",
        p.stock ? `\nСклад сейчас (можно продать):\n${p.stock}` : "\nДанных склада нет — о наличии не обещай.",
      ].join("\n");
  return [
    leads
      ? `Ты — помощник ${genitiveName(p.managerName || "Земфира")}, специалиста по заявкам с рекламы оптовой цветочной компании Ecoculture`
      : `Ты — помощник менеджера по продажам${p.managerName ? ` ${p.managerName}` : ""} оптовой цветочной компании Ecoculture`,
    "(Казахстан, своё тепличное хозяйство: розы, хризантемы, эустома; продаём оптом магазинам, салонам, цветочникам).",
    leads
      ? "Пишешь клиенту в WhatsApp С ЕЁ РАБОЧЕГО НОМЕРА, от её имени (женский род: «передала», «уточню»), пока она занята."
      : "Пишешь клиенту в WhatsApp С РАБОЧЕГО НОМЕРА МЕНЕДЖЕРА, от его имени, пока он занят.",
    leads
      ? "На этот номер пишут по рекламе (Instagram и другие источники). Земфира отвечает на первые вопросы, а готового к заказу клиента ПЕРЕДАЁТ менеджеру по оформлению — заказ и счёт оформляет менеджер, с клиентом он связывается здесь же, в WhatsApp."
      : "",
    "Цель — не потерять клиента и продать: ответить по существу, предложить конкретное, довести до согласия на заказ.",
    "",
    "Стиль — как живой человек в переписке, КОРОТКО: 2–4 предложения, одна тема за сообщение, не больше 300 знаков.",
    "Не вываливай всё сразу: сорта, цены, наличие, доставку и условия — в одном сообщении нельзя. Ответь на то, что спросили,",
    "предложи ОДНУ-ДВЕ позиции с ценой и задай один вопрос; остальное клиент спросит сам.",
    "Первое наше сообщение в переписке начинай с приветствия («Здравствуйте!» / «Сәлеметсіз бе!»), даже если клиент",
    "написал шаблоном с рекламы. Дальше заново не здоровайся. Не обращайся по имени. Не повторяй уже сказанное.",
    "На языке клиента (русский или казахский). Вопрос клиенту — не больше одного, последней строкой.",
    "Позиции и цены — списком «• …», не больше двух строк. Не используй # и **.",
    "",
    ...humanStylePrompt({ who: leads ? p.managerName || "Земфира" : p.managerName, female: leads, helper: true }),
    "",
    "Что можно:",
    "- цены и наличие — ТОЛЬКО из списка «Что есть сейчас» ниже; точное число стеблей не называй;",
    "  категории или сорта, которых нет в списке, НЕ предлагай и не называй их цену — скажи «сейчас нет» и предложи, что есть;",
    "- на «что есть» / «прайс и фото» — одна-две ходовые позиции с ценой (не весь список) и фото; объём не назван — одно число с суммой;",
    "- «дорого» — предложи категорию ниже или другой сорт с суммой; «подумаю» — пробную партию.",
    "- Доставка: сначала СПРОСИ ГОРОД. Пока город неизвестен — одной фразой «доставляем, условия зависят от города — вы в",
    "  каком городе?». Условия по Алматы и регионам, минимальный заказ и бесплатную доставку не перечисляй, пока не",
    "  знаешь город и пока прямо не спросили.",
    "- Спрашивают о цветах (что есть, сорт, категория, цена, мини-микс, свежесть) — отвечай С ФОТО: заполни photo позицией,",
    "  о которой речь (на общий вопрос — ходовой сорт со склада, который предлагаешь; объясняешь, что такое мини-микс, —",
    "  grade «Мини-микс»). Живое фото с теплицы продаёт лучше слов.",
    "  Тогда reply уйдёт ПОДПИСЬЮ к фото: коротко, что за позиция, цена и одна живая деталь. Не пиши «отправляю фото» —",
    "  оно придёт само, если есть. Без фото (photo пустой): отказ, раздражение, оплата, доставка, документы, автоответ, «спасибо».",
    "Что НЕЛЬЗЯ, это решает менеджер (тогда честно «уточню и отпишусь» и заполни needs_manager):",
    "- оформлять заказ и выставлять счёт: клиент назвал позицию и количество или согласился — подтверди коротко",
    leads
      ? "  (позиция, количество, цена, сумма, день) и напиши, что передаёшь менеджеру по оформлению — он напишет сюда же и выставит счёт;"
      : "  (позиция, количество, цена, сумма, день) и напиши, что оформляешь и подтверждение со счётом придёт сюда же;",
    "  needs_manager = «оформить заказ: …»;",
    leads
      ? "- клиент спрашивает, когда с ним свяжутся или почему менеджер молчит, — извинись коротко, скажи, что менеджер напишет, needs_manager = «связаться с клиентом: …»;"
      : "",
    "- оплата не вперёд (при получении, отсрочка, частями), скидки сверх прайса, документы, доставка ко времени, жалоба,",
    "  договорённости, о которых нет в переписке, просьба позвонить — needs_manager;",
    "- выдумывать то, чего нет в данных: цены, наличие, сроки, условия.",
    "silent=true — автоответ магазина, кивок без вопроса («ок», «спасибо», 👍), разговор не про цветы, сотрудник, водитель,",
    "поставщик, личное, а также клиент закрыл разговор: «неактуально», «не надо», «для себя», нужны саженцы или растения",
    "с корнями — не отвечай и не прощайся. Сомневаешься, клиент ли это, — silent.",
    "Если ответить по существу нечем — короткое «Принято, уточню и отпишусь здесь» и needs_manager.",
    `\nСегодня ${p.today}, ${weekday} (Алматы).`,
    p.storeNote ? p.storeNote : "",
    p.client ? `\nО клиенте:\n${p.client}` : "",
    p.instructions ? `\nУказания владельца для продаж (условия доставки из них — только когда известен город и прямо спросили):\n${p.instructions}` : "",
    p.push ? `\n${p.push}` : "",
    packingPromptBlock(),
    goods,
    p.harvest ? `\nПлан срезки (прогноз; продать можно только то, что в списке «Что есть сейчас», остальное — «ожидаем срезку»):\n${p.harvest}` : "",
  ]
    .filter((x) => x !== "")
    .join("\n");
}

function shortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
  return p.replace(",", "");
}

/** Переписка для модели: последние сообщения, «Клиент» / «Мы». */
export function assistantTranscript(chat: WaMessage[], maxChars = 12000): string {
  const lines: string[] = [];
  let total = 0;
  for (let i = chat.length - 1; i >= 0; i--) {
    const m = chat[i];
    const line = `[${shortTime(m.at)}] ${m.direction === "in" ? "Клиент" : "Мы"}: ${messageText(m)}`;
    if (total + line.length > maxChars && lines.length) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.reverse().join("\n");
}

export interface AssistantAnswer {
  reply: string;
  silent: boolean;
  note: string;
  /** О какой позиции ответ — к нему уйдёт её фото (20.10.2026, владелец: «мало шлёшь фоток… это же визуал»). */
  photo: { flowerType: string; variety: string; grade: string };
}

const PHOTO_FLOWERS = ["rose", "chrysanthemum", "eustoma"];

export function parseAssistantAnswer(raw: unknown): AssistantAnswer {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const silent = r.silent === true;
  const reply = silent ? "" : toWhatsApp(String(r.reply || "").trim()).slice(0, 3000);
  const ph = (r.photo && typeof r.photo === "object" ? r.photo : {}) as Record<string, unknown>;
  const flowerType = PHOTO_FLOWERS.includes(String(ph.flowerType || "")) ? String(ph.flowerType) : "";
  const photo = flowerType
    ? { flowerType, variety: String(ph.variety || "").trim().slice(0, 80), grade: String(ph.grade || "").trim().slice(0, 40) }
    : { flowerType: "", variety: "", grade: "" };
  return { reply, silent: silent || !reply, note: String(r.needs_manager || "").trim().slice(0, 400), photo };
}

/**
 * Фото позиции к ответу помощника: то же правило, что у бота (`pickItemPhoto`) — живые первыми, фото, уже
 * ушедшее этому человеку (подпись есть в переписке), второй раз не идёт. Нет фото или ответ длиннее подписи — null.
 */
export async function assistantPhotoFor(chat: WaMessage[], a: AssistantAnswer): Promise<(BotPhoto & { rowNumber: number }) | null> {
  if (!a.photo.flowerType || !a.reply || a.reply.length > 1024) return null;
  try {
    const photos = await listBotPhotos();
    const recent = chat.map((m) => messageText(m)).join("\n");
    const live = photos.filter((p) => !isInfoPhoto(p));
    return pickItemPhoto(live, a.photo, recent, []) as (BotPhoto & { rowNumber: number }) | null;
  } catch (err) {
    console.error("assistant photo:", err instanceof Error ? err.message : err);
    return null;
  }
}

/** Ответ помощника на переписку ОДНОЙ линии с ОДНИМ номером — без отправки. `line` — чей номер (Земфира пишет иначе). */
export async function assistantAnswer(chat: WaMessage[], phone: string, managerName: string, task: string, line = ""): Promise<AssistantAnswer> {
  if (!openAiConfigured()) throw new Error("ИИ не подключён — нужен ключ OpenAI.");
  const k = await salesKnowledge(phone);
  const system = assistantSystemPrompt({ managerName, line, ...k });
  const user = `Переписка (последние сообщения):\n${assistantTranscript(mergeMessages(chat))}\n\n${task}`;
  const { data } = await chatJson(system, user, "manager_assistant", ASSISTANT_SCHEMA, { fast: true });
  const first = parseAssistantAnswer(data);
  if (first.silent || !tooLong(first.reply)) return first;
  // Длинно (21.10.2026, Земфира: «слишком длинные сообщения») — переспросить короче; не вышло — короткий вариант всё равно короче.
  try {
    const again = await chatJson(system, `${user}\n\nТвой прошлый ответ:\n${first.reply}\n\n${SHORT_TASK}`, "manager_assistant", ASSISTANT_SCHEMA, { fast: true });
    const second = parseAssistantAnswer(again.data);
    if (!second.silent && second.reply && second.reply.length < first.reply.length) return { ...second, note: second.note || first.note };
  } catch (err) {
    console.error("assistant shorten:", err instanceof Error ? err.message : err);
  }
  return first;
}

export const DRAFT_TASK = "Подготовь ответ на последнее сообщение клиента — менеджер посмотрит, поправит и отправит сам.";
export const AUTO_TASK = "Менеджер сейчас не может ответить. Ответь на последнее сообщение клиента сам.";

/** Первое слово имени менеджера — для подсказки модели. */
async function managerNameOf(email: string): Promise<string> {
  try {
    const u = (await listUsers()).find((x) => x.email.toLowerCase() === email);
    return (u?.name || "").split(/\s+/)[0] || "";
  } catch {
    return "";
  }
}

/** Отправить текст с номера линии (менеджера или Земфиры), записать в переписку и журнал. Возвращает номер сообщения. */
export async function sendFromLine(
  line: WaLine,
  phone: string,
  text: string,
  kind: "auto" | "crm",
  byEmail: string,
  note = "",
  photo: (BotPhoto & { rowNumber: number }) | null = null
): Promise<string> {
  const cfg = assistantLineConfig(line);
  if (!cfg) throw new Error("Номер не подключён или выключен — проверьте в «Настройках → WhatsApp менеджеров».");
  return sendOnLine(line.code, cfg, phone, text, kind, byEmail, note, photo);
}

/**
 * Отправить с любой линии по её ключам (номер менеджера, номер Земфиры) и записать в переписку и журнал — чтобы
 * сообщение из CRM сразу было видно в чате, не дожидаясь уведомления Green API (19.10.2026: «Отправить» и на номере
 * Земфиры — владелец: «нажать „предложить ответ“ и реально отправить»).
 */
export async function sendOnLine(
  code: string,
  cfg: GreenConfig,
  phone: string,
  text: string,
  kind: "auto" | "crm",
  byEmail: string,
  note = "",
  photo: (BotPhoto & { rowNumber: number }) | null = null
): Promise<string> {
  // С фото — ответ подписью к нему; в переписку — с пометкой фото и началом его подписи (как у бота), чтобы то же
  // фото этому человеку второй раз не ушло.
  const id = photo ? await sendFileByUrl(cfg, phone, photoFileUrl(photo), photo.fileName || "photo.jpg", text) : await sendText(cfg, phone, text);
  if (photo) await commitAtomic([botPhotoSentWrite(photo)]).catch(() => undefined);
  const now = new Date().toISOString();
  const msg: WaMessage = {
    messageId: id,
    at: now,
    chatId: `${phone}@c.us`,
    phone,
    direction: "out",
    type: photo ? "image" : "text",
    text: photo ? `[фото: ${photoLabel(photo)} — ${photo.caption.slice(0, 40)}] ${text}` : text,
    mediaUrl: "",
    senderName: "",
    source: kind === "auto" ? "assistant" : "crm",
    line: code,
  };
  await appendWaMessages([msg]);
  await appendAssistantLog([{ at: now, line: code, phone, kind, messageId: id, text, note, byEmail }]);
  return id;
}

// --- Один ответ на одно сообщение -------------------------------------------------------------------------
//
// 21.10.2026, 08:13 по Алматы: за ночь на номере Земфиры накопились вопросы, и в восемь утра их разбирали
// сразу несколько проходов (расписание, вебхук, сторож) — Архат, Салтанат и Гүлжауһар получили по два разных
// ответа на одно сообщение. Проверка «уже ответили» по журналу стояла ДО вызова модели, а модель думает
// 5–10 секунд, и за это время второй проход проходил ту же проверку. Теперь перед ответом чат «занимается»:
// заявка на ответ пишется в настройку `AssistantClaim:<код>` (на номер — одна, внутри — номера и время
// сообщения), через 1,2 с перечитывается, и отвечает только тот, чья заявка устояла. Тот же приём, что у
// цепочки рассылок и у авто-лида.

const CLAIM_PREFIX = "AssistantClaim:";
const CLAIM_TTL_MS = 3 * 60000;
/**
 * Ответ на сообщение решён окончательно, но не отправлен (ИИ промолчал, повтор, заказ — дело менеджера): занятость
 * держится до конца срока ответа, иначе через 3 минуты чат брался заново и модель спрашивали по тому же сообщению
 * снова и снова (21.10.2026: на «Всё поняла, спасибо» Сабины одна из попыток оформила второй заказ).
 */
const CLAIM_DONE_TTL_MS = ASSISTANT_STALE_HOURS * 3600000;
type Claim = { token: string; at: string; inAt: string; done?: boolean };

function parseClaims(raw: string | null | undefined): Record<string, Claim> {
  try {
    const o = JSON.parse(raw || "{}") as Record<string, unknown>;
    const out: Record<string, Claim> = {};
    for (const [k, v] of Object.entries(o)) {
      const c = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
      if (typeof c.token === "string" && typeof c.at === "string") out[k] = { token: c.token, at: c.at, inAt: typeof c.inAt === "string" ? c.inAt : "", done: c.done === true };
    }
    return out;
  } catch {
    return {};
  }
}

/** Занять ответ на сообщение `inAt` в чате: true — отвечаем мы, false — его уже взял другой проход. */
async function claimReply(code: string, phone: string, inAt: string): Promise<boolean> {
  const key = `${CLAIM_PREFIX}${code}`;
  const chat = phoneKey(phone);
  const my = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const now = Date.now();
  const alive = (c: Claim | undefined) => !!c && now - Date.parse(c.at) < (c.done ? CLAIM_DONE_TTL_MS : CLAIM_TTL_MS);
  const read = async () => parseClaims((await settingsMap(true))[key]);
  const cur = await read();
  const mine = cur[chat];
  if (alive(mine) && mine!.inAt === inAt) return false;
  const next: Record<string, Claim> = {};
  for (const [k, c] of Object.entries(cur)) if (alive(c)) next[k] = c;
  next[chat] = { token: my, at: new Date(now).toISOString(), inAt };
  await saveSettings({ [key]: JSON.stringify(next) });
  await new Promise((r) => setTimeout(r, 1200));
  return (await read())[chat]?.token === my;
}

/** Ответ на `inAt` решён без отправки — больше этот чат по этому сообщению не брать (`CLAIM_DONE_TTL_MS`). */
async function settleClaim(code: string, phone: string, inAt: string): Promise<void> {
  const key = `${CLAIM_PREFIX}${code}`;
  const now = Date.now();
  const cur = parseClaims((await settingsMap(true))[key]);
  const next: Record<string, Claim> = {};
  for (const [k, c] of Object.entries(cur)) if (now - Date.parse(c.at) < (c.done ? CLAIM_DONE_TTL_MS : CLAIM_TTL_MS)) next[k] = c;
  next[phoneKey(phone)] = { token: "done", at: new Date(now).toISOString(), inAt, done: true };
  await saveSettings({ [key]: JSON.stringify(next) });
}

/** Кому передан лид и закрыт ли он — по номеру; только для номера Земфиры. */
type LeadFacts = { handedTo: string; closed: boolean; client: boolean; leadId: string };

export interface SweepResult {
  checked: number;
  replied: number;
  notes: number;
  skipped: string[];
  /** Клиент ждёт, ответить можно будет через столько мс (режим «продаёт сам») — сторожу номера ждать. */
  pendingMs?: number;
  /** Номера в режиме «продаёт сам», где кто-то ждёт: общий проход их не трогает, а будит сторожа номера. */
  watch?: string[];
}

/** Лиды и карточки клиентов по номеру — для номера Земфиры. Лид передан — имя менеджера, закрыт — «отказ». */
async function leadFactsByPhone(): Promise<Map<string, LeadFacts>> {
  const [leads, clients, users] = await Promise.all([listLeads().catch(() => [] as Lead[]), listClients().catch(() => []), listUsers().catch(() => [])]);
  const nameOf = (email: string) => {
    const u = users.find((x) => x.email.toLowerCase() === (email || "").toLowerCase());
    return (u?.name || "").split(/\s+/)[0] || email || "менеджер";
  };
  const out = new Map<string, LeadFacts>();
  for (const l of leads) {
    const k = phoneKey(l.phone);
    if (!k) continue;
    const cur = out.get(k) ?? { handedTo: "", closed: false, client: false, leadId: l.leadId };
    if (l.handedOverAt) cur.handedTo = cur.handedTo || nameOf(l.managerEmail);
    if (isClosedStage(cleanStage(l.stage))) cur.closed = true;
    else cur.closed = false; // открытый лид с тем же номером перебивает закрытый
    if (l.clientId) cur.client = true;
    out.set(k, cur);
  }
  for (const c of clients) {
    if (!c.active) continue;
    for (const p of [c.phone, c.messenger]) {
      const k = phoneKey(p);
      if (!k) continue;
      const cur = out.get(k) ?? { handedTo: "", closed: false, client: false, leadId: "" };
      cur.client = true;
      out.set(k, cur);
    }
  }
  return out;
}

/**
 * Переданный лид написал на номер Земфиры: записка в журнал и сообщение менеджеру с основного номера
 * («Ваш клиент … написал на номер Земфиры: …»), один раз на сообщение клиента.
 */
async function tellManagerAboutHandedLead(line: WaLine, phone: string, lastIn: WaMessage, facts: LeadFacts, log: { kind: string; line: string; phone: string; at: string }[]): Promise<boolean> {
  if (log.some((r) => r.kind === "note" && r.line === line.code && phoneKey(r.phone) === phoneKey(phone) && r.at > lastIn.at)) return false;
  const text = messageText(lastIn).slice(0, 200);
  const note = `клиент передан ${facts.handedTo}, написал на номер Земфиры: «${text}» — ответить должен он`;
  await appendAssistantLog([{ at: new Date().toISOString(), line: line.code, phone, kind: "note", messageId: "", text: "", note, byEmail: "assistant" }]);
  const [leads, users, waLines] = await Promise.all([listLeads().catch(() => [] as Lead[]), listUsers().catch(() => []), listWaLines().catch(() => [])]);
  const lead = leads.find((l) => l.leadId === facts.leadId) ?? leads.find((l) => phoneKey(l.phone) === phoneKey(phone) && l.handedOverAt);
  const email = (lead?.managerEmail || "").toLowerCase();
  const managerPhone = (waLines.find((w) => w.managerEmail.toLowerCase() === email && w.phone)?.phone || users.find((u) => u.email.toLowerCase() === email)?.phone || "").replace(/\D/g, "");
  const cfg = greenConfig();
  if (!cfg || !managerPhone) return true;
  const who = lead?.name ? `${lead.name} (…${phoneKey(phone).slice(-4)})` : `…${phoneKey(phone).slice(-4)}`;
  await sendText(cfg, managerPhone, `Ваш клиент ${who}, переданный вам, написал на номер Земфиры:\n«${text}»\n\nОтветьте ему, пожалуйста, со своего номера.`, { linkPreview: false }).catch((err) => console.error("handed lead notify:", err instanceof Error ? err.message : err));
  return true;
}

/**
 * Пройти по номерам менеджеров (и номеру Земфиры, 20.10.2026 — режим в настройке `LeadsAssistant`) с включённым
 * помощником и ответить там, где клиент ждёт (`assistantVerdict`). `only` — один чат (вебхук после сообщения вне рабочего времени).
 * Не больше `limit` ответов за проход; ответ уходит, только если после нашего чтения клиенту
 * никто не ответил (журнал перечитывается свежим перед каждой отправкой).
 */
export async function runAssistantSweep(
  options: {
    limit?: number;
    budgetMs?: number;
    only?: { line: string; phone?: string };
    quick?: boolean;
    /** Проход сторожа номера «продаёт сам» (`/api/assistant/sweep?watch=…`): только он отвечает на таких номерах. */
    watcher?: boolean;
  } = {}
): Promise<SweepResult> {
  const result: SweepResult = { checked: 0, replied: 0, notes: 0, skipped: [], watch: [] };
  if (!openAiConfigured()) return result;
  const started = Date.now();
  const lines = (await listAssistantLines()).filter((l) => l.active && l.assistant !== "off" && (!options.only || l.code === options.only.line));
  if (lines.length === 0) return result;
  const codes = new Set(lines.map((l) => l.code));
  const [messages, log, map] = await Promise.all([listWaMessages({ lines: "all" }), listAssistantLog(), settingsMap()]);
  const autoIds = new Set(log.filter((r) => r.kind === "auto" || r.kind === "nudge").map((r) => r.messageId));
  const staff = await ourPhoneKeys(map);
  // «Не пиши клиенту X» от сотрудника и «СТОП» от клиента — память бота, режим optout (`staffCommand.ts`).
  const muted = await optedOutKeys().catch(() => new Set<string>());
  const now = new Date();
  // Номер Земфиры: лид передан менеджеру или закрыт, у номера есть карточка клиента — помощник не отвечает
  // (21.10.2026, Земфира: «бот повторно пишет клиентам, которых я уже передала Ильгару, у которых уже есть заказы»).
  const leadFacts = lines.some((l) => l.code === LEADS_LINE) ? await leadFactsByPhone() : new Map<string, LeadFacts>();

  type Due = { line: WaLine; phone: string; chat: WaMessage[]; lastInAt: string; lastIn: WaMessage };
  const due: Due[] = [];
  const handed: { line: WaLine; phone: string; lastIn: WaMessage; facts: LeadFacts }[] = [];
  for (const line of lines) {
    const byKey = new Map<string, WaMessage[]>();
    for (const m of messages) {
      if (m.line !== line.code || !codes.has(m.line)) continue;
      const key = phoneKey(m.phone);
      if (!key || (options.only?.phone && key !== phoneKey(options.only.phone))) continue;
      byKey.set(key, [...(byKey.get(key) ?? []), m]);
    }
    for (const [key, chat] of Array.from(byKey.entries())) {
      result.checked++;
      const facts = line.code === LEADS_LINE ? leadFacts.get(key) : undefined;
      const v = assistantVerdict({
        chat,
        autoIds,
        now,
        staff: staff.has(key),
        muted: muted.has(key),
        mode: line.assistant,
        quick: options.quick,
        lead: facts ? { handedTo: facts.handedTo, closed: facts.closed, client: facts.client } : undefined,
      });
      if (line.assistant === "sell" && !options.watcher) {
        // Номер «продаёт сам» ведёт только его сторож (один на номер, под замком) — иначе два прохода ответили бы дважды.
        if ((v.due || v.retryInMs) && !result.watch!.includes(line.code)) result.watch!.push(line.code);
        continue;
      }
      if (v.due && v.lastIn) due.push({ line, phone: v.lastIn.phone, chat, lastInAt: v.lastIn.at, lastIn: v.lastIn });
      else if (v.retryInMs && line.assistant === "sell") result.pendingMs = Math.min(result.pendingMs ?? Infinity, v.retryInMs);
      else if (v.handed && v.lastIn && facts && now.getTime() - Date.parse(v.lastIn.at) < ASSISTANT_STALE_HOURS * 3600000)
        handed.push({ line, phone: v.lastIn.phone, lastIn: v.lastIn, facts });
    }
  }
  // Переданный лид написал на номер Земфиры — не отвечаем, а сообщаем его менеджеру (один раз на сообщение).
  for (const h of handed) {
    try {
      const told = await tellManagerAboutHandedLead(h.line, h.phone, h.lastIn, h.facts, log);
      if (told) result.notes++;
      result.skipped.push(`…${h.phone.slice(-4)}: передан ${h.facts.handedTo}${told ? " — сообщили ему" : ""}`);
    } catch (err) {
      result.skipped.push(`…${h.phone.slice(-4)}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
    }
  }
  // Дольше ждущие — первыми.
  due.sort((a, b) => (a.lastInAt < b.lastInAt ? -1 : 1));
  const limit = options.limit ?? 6;
  const names = new Map<string, string>();
  for (const d of due) {
    if (result.replied >= limit || Date.now() - started > (options.budgetMs ?? 30000)) {
      // Не успели — сторож номера «продаёт сам» вернётся к ним сразу.
      if (d.line.assistant === "sell") result.pendingMs = Math.min(result.pendingMs ?? Infinity, 1000);
      break;
    }
    // Свежий журнал: другой проход мог ответить этому клиенту секунду назад.
    const fresh = await listAssistantLog({ fresh: true });
    if (fresh.some((r) => r.kind === "auto" && r.line === d.line.code && phoneKey(r.phone) === phoneKey(d.phone) && r.at > d.lastInAt)) {
      result.skipped.push(`…${d.phone.slice(-4)}: уже ответили`);
      continue;
    }
    // Журнал видит только отправленное, а модель думает секунды — занять чат, чтобы два прохода не ответили дважды.
    if (!(await claimReply(d.line.code, d.phone, d.lastInAt))) {
      result.skipped.push(`…${d.phone.slice(-4)}: отвечает другой проход`);
      continue;
    }
    try {
      if (!names.has(d.line.managerEmail)) names.set(d.line.managerEmail, await managerNameOf(d.line.managerEmail));
      if (d.line.assistant === "sell") {
        // Продающий помощник: тот же продавец, что бот, — с заказом, счётом и фото (`lineSeller.ts`).
        const r = await sellerTurn({ line: d.line, phone: d.phone, chat: d.chat, lastIn: d.lastIn, managerName: names.get(d.line.managerEmail) ?? "" });
        if (r.sent) result.replied++;
        else result.skipped.push(`…${d.phone.slice(-4)}: ${r.why}`);
        if (!r.sent && r.settled) await settleClaim(d.line.code, d.phone, d.lastInAt).catch(() => undefined);
        continue;
      }
      const a = await assistantAnswer(d.chat, d.phone, names.get(d.line.managerEmail) ?? "", AUTO_TASK, d.line.code);
      if (a.silent) {
        result.skipped.push(`…${d.phone.slice(-4)}: ИИ решил промолчать`);
        await settleClaim(d.line.code, d.phone, d.lastInAt).catch(() => undefined);
        if (a.note) {
          await appendAssistantLog([{ at: new Date().toISOString(), line: d.line.code, phone: d.phone, kind: "note", messageId: "", text: "", note: a.note, byEmail: "assistant" }]);
          result.notes++;
        }
        continue;
      }
      // Перед отправкой — ещё раз свежая переписка: клиент дописал или менеджер ответил, пока думала модель.
      const latest = mergeMessages((await listWaMessages({ lines: "all", fresh: true })).filter((m) => m.line === d.line.code && phoneKey(m.phone) === phoneKey(d.phone)));
      const lastNow = latest[latest.length - 1];
      if (lastNow && lastNow.at > d.lastInAt) {
        result.skipped.push(`…${d.phone.slice(-4)}: ${lastNow.direction === "in" ? "клиент дописал — ответим на новое" : "менеджер уже ответил"}`);
        continue;
      }
      const reply = ensureGreeting(a.reply, d.chat);
      const pic = await assistantPhotoFor(d.chat, { ...a, reply });
      await sendFromLine(d.line, d.phone, reply, "auto", "assistant", "", pic);
      result.replied++;
      if (a.note) {
        await appendAssistantLog([{ at: new Date().toISOString(), line: d.line.code, phone: d.phone, kind: "note", messageId: "", text: a.reply, note: a.note, byEmail: "assistant" }]);
        result.notes++;
      }
    } catch (err) {
      result.skipped.push(`…${d.phone.slice(-4)}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 200));
    }
  }
  return result;
}

/** Будить проход помощника из вебхука: не чаще раза в 3 минуты на экземпляр, запрос обрывается через 1,5 с. */
export async function kickAssistant(origin: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) return;
  const g = globalThis as unknown as { __assistantKick?: number };
  const now = Date.now();
  if (g.__assistantKick && now - g.__assistantKick < 3 * 60000) return;
  g.__assistantKick = now;
  try {
    await fetch(`${origin}/api/assistant/sweep?source=webhook`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Оборвали сами — проход идёт своей функцией.
  }
}

/** Ответ одному чату вне рабочего времени — своей функцией (`/api/assistant/sweep?line=…&phone=…`). */
export async function kickAssistantChat(origin: string, line: string, phone: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) return;
  try {
    await fetch(`${origin}/api/assistant/sweep?source=chat&line=${encodeURIComponent(line)}&phone=${encodeURIComponent(phone)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Оборвали сами.
  }
}

// --- Сторож номера «продаёт сам» ------------------------------------------------------
//
// Владелец выбрал «отвечать, если менеджер молчит 5 минут». Расписание у Vercel — раз в час, а вебхук
// не может ждать 5 минут, поэтому на номер — один сторож: функция под замком (настройка
// `AssistantWatch:<код>`, тот же приём, что у цепочки рассылок) проходит по чатам номера, отвечает тем,
// кому пора, ждёт до ближайшего «пора» (не дольше ~50 с) и, если кто-то ещё ждёт, будит себя снова.
// Никто не ждёт (менеджер ответил, ночь) — отпускает замок. Будят: вебхук номера на входящем, общий
// проход помощника и расписание раз в час.

const WATCH_PREFIX = "AssistantWatch:";
const WATCH_STEP_MS = 50000;
const WATCH_MAX_HOPS = 40;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runLineWatch(
  code: string,
  origin: string,
  token: string,
  hop: number
): Promise<{ ok: boolean; busy?: boolean; handed?: boolean; replied: number; skipped: string[] }> {
  const key = `${WATCH_PREFIX}${code}`;
  const my = token || `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const lock = parseChainLock((await settingsMap(true))[key]);
  if (chainBusy(lock, my, new Date())) return { ok: true, busy: true, replied: 0, skipped: [] };
  await saveSettings({ [key]: JSON.stringify({ token: my, at: new Date().toISOString(), note: `шаг ${hop}` }) });
  await pause(1200);
  if (parseChainLock((await settingsMap(true))[key]).token !== my) return { ok: true, busy: true, replied: 0, skipped: [] };
  const started = Date.now();
  let replied = 0;
  const skipped: string[] = [];
  for (;;) {
    const r = await runAssistantSweep({ only: { line: code }, limit: 3, budgetMs: 25000, watcher: true });
    replied += r.replied;
    skipped.push(...r.skipped);
    const pending = r.pendingMs;
    const left = WATCH_STEP_MS - (Date.now() - started);
    if (!pending || !Number.isFinite(pending)) break;
    if (pending <= left - 3000) {
      await pause(pending);
      continue;
    }
    if (hop >= WATCH_MAX_HOPS) break;
    await pause(Math.max(0, Math.min(pending, left) - 1500));
    await saveSettings({ [key]: JSON.stringify({ token: my, at: new Date().toISOString(), note: `шаг ${hop + 1}` }) }).catch(() => undefined);
    await kickLineWatch(origin, code, my, hop + 1);
    return { ok: true, handed: true, replied, skipped };
  }
  await saveSettings({ [key]: "" }).catch(() => undefined);
  return { ok: true, replied, skipped };
}

/** Разбудить сторожа номера «продаёт сам» (запрос обрывается через 1,5 с — сторож идёт своей функцией). */
export async function kickLineWatch(origin: string, code: string, token = "", hop = 0): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) return;
  try {
    const q = new URLSearchParams({ watch: code, hop: String(hop), ...(token ? { token } : {}) });
    await fetch(`${origin}/api/assistant/sweep?${q.toString()}`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(1500) });
  } catch {
    // Оборвали сами.
  }
}
