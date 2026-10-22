import { phoneKey } from "./leads";
import { isInfoPhoto, photoLabel, type BotPhoto } from "./botPhotos";

// ---------------------------------------------------------------------------
// Поручения сотрудников основному номеру (21.10.2026). Сотрудник написал на
// рабочий номер «Отправь фотографии хризантемы всех категорий и эустому белого
// и розового цвета клиенту Маргарита Пожарка» — и ничего не произошло: номерам
// сотрудников бот не отвечает (`ourPhoneKeys`), а поручений не понимал вовсе.
// Владелец: «Почему ты не отправил по запросу менеджера?»
//
// Теперь: сообщение с номера сотрудника разбирает модель (что отправить и кому),
// клиента находит КОД — по карточкам клиентов, лидов и именам в WhatsApp; один
// подходящий — фото уходят ему с того номера, где он переписывается; несколько —
// бот переспрашивает сотрудника списком, ответ цифрой. Здесь — чистые правила.
// ---------------------------------------------------------------------------

export const STAFF_ASK_PREFIX = "StaffAsk:";
/** Сколько ждать ответа сотрудника на «кому из них?». */
export const STAFF_ASK_TTL_MS = 3 * 3600000;
/** Больше фото за одно поручение не шлём — неофициальный WhatsApp банят за «робота». */
export const STAFF_MAX_PHOTOS = 10;

export interface StaffItem {
  flowerType: string;
  variety: string;
  grade: string;
  /** «Всех категорий», «все сорта» — несколько фото этого цветка, а не одно. */
  many: boolean;
}

export interface StaffCommand {
  /** send — отправить клиенту; other — просьба к боту, которую он не умеет; none — не поручение. */
  intent: "send" | "other" | "none";
  /** Кому, как написал сотрудник: имя, точка, город. */
  client: string;
  /** Номер клиента, если сотрудник его написал (цифры). */
  phone: string;
  items: StaffItem[];
  /** Текст клиенту от сотрудника (если просил что-то передать словами). */
  text: string;
}

const S = (description: string) => ({ type: "string", description });

export const STAFF_COMMAND_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "client", "phone", "items", "text"],
  properties: {
    intent: {
      type: "string",
      enum: ["send", "other", "none"],
      description:
        "send — сотрудник просит отправить клиенту фото, каталог или сообщение; other — просит бота сделать что-то другое; none — не поручение (приветствие, ответ на сводку, «ок», новости).",
    },
    client: S(
      "Кому отправить — имя/название клиента, как написано (с точкой, районом, городом). «Мне», «себе», «скинь фото Altaj» без адресата — «мне» (сотрудник просит себе). Пусто — только если просил клиенту, но не назвал кому."
    ),
    phone: S("Номер клиента цифрами, если он есть в сообщении. Иначе пусто."),
    items: {
      type: "array",
      description: "Что показать на фото. Пусто, если фото не просили.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["flowerType", "variety", "grade", "many"],
        properties: {
          flowerType: { type: "string", enum: ["rose", "chrysanthemum", "eustoma"] },
          variety: S("Сорт из списка фото ниже, если назван или ясен по цвету («белая эустома» → Alissa White). Иначе пусто."),
          grade: S("Категория или длина, если названа («Первая», «60», «Мини-микс»). Иначе пусто."),
          many: { type: "boolean", description: "true — «все категории», «все сорта», «разные»: несколько фото этого цветка." },
        },
      },
    },
    text: S("Что передать клиенту словами, если сотрудник просил (без фото). Иначе пусто."),
  },
};

export function staffCommandPrompt(photoLabels: string[]): string {
  return [
    "Ты разбираешь сообщение СОТРУДНИКА компании Ecoculture (оптовые цветы: розы, хризантемы, эустома) рабочему номеру WhatsApp.",
    "Сотрудники пишут сюда поручения вроде «отправь фото Altaj первой Маргарите Пожарка» или «скинь клиенту Асель каталог роз».",
    "Определи, поручение ли это, кому и что отправить. Ничего не выдумывай: клиента и позиции бери только из сообщения.",
    "«Скинь фото Jumilia», «покажи Altaj», «мне скинь» — сотрудник просит фото СЕБЕ: intent send, client «мне».",
    "Сорт пиши как в списке фото ниже, даже если сотрудник написал по-русски («джумилия» — Jumilia, «алтай» — Altaj).",
    "Цвет → сорт по списку фото: белая эустома — Alissa White, розовая — Alissa Pink (и Corelli Pink, если просят все розовые).",
    "«Хризантема всех категорий» — один пункт: chrysanthemum, сорт пусто, категория пусто, many=true.",
    "Каталог или «что есть» по цветку — пункт этого цветка с many=true.",
    "",
    "Фото в CRM сейчас:",
    ...photoLabels.map((l) => `- ${l}`),
  ].join("\n");
}

const FLOWERS = ["rose", "chrysanthemum", "eustoma"];

export function parseStaffCommand(raw: unknown): StaffCommand {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const intent = r.intent === "send" || r.intent === "other" ? r.intent : "none";
  const items = (Array.isArray(r.items) ? r.items : [])
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .filter((x) => FLOWERS.includes(String(x.flowerType || "")))
    .map((x) => ({
      flowerType: String(x.flowerType),
      variety: String(x.variety || "").trim().slice(0, 80),
      grade: String(x.grade || "").trim().slice(0, 40),
      many: x.many === true,
    }))
    .slice(0, 8);
  return {
    intent,
    client: String(r.client || "").trim().slice(0, 120),
    phone: String(r.phone || "").replace(/\D/g, "").slice(0, 15),
    items,
    text: String(r.text || "").trim().slice(0, 1000),
  };
}

// --- Кому ---------------------------------------------------------------------

/**
 * Сотрудник просит фото СЕБЕ (22.10.2026, владелец: «Скинь фото джумилии» → бот ответил «Не нашёл клиента «без имени»»,
 * на «Мне скинь.» промолчал, «Почему не отправляешь фотки?»). Адресат не назван или «мне / себе / маған / өзіме» —
 * шлём на номер самого сотрудника. Ответ на «кому?» вида «мне», «мне скинь», «скиньте мне» — тоже.
 */
export function isSelfTarget(text: string): boolean {
  const t = norm(text);
  if (!t) return false;
  const verbs = "(?:скинь|скиньте|отправь|отправьте|кинь|киньте|пришли|пришлите|покажи|покажите|жибер|жіберіңіз|жибериниз)";
  return new RegExp(`^(?:${verbs} )?(?:мне|себе|сам|сама|маган|маған|озиме|өзіме)(?: ${verbs})?(?: пожалуйста| плиз)?$`, "i").test(t);
}

export interface StaffTarget {
  phone: string;
  name: string;
  /** «клиент», «лид», «WhatsApp» — откуда узнали. */
  kind: string;
  managerEmail: string;
  /** Когда последний раз переписывались (ISO) — свежие выше. */
  lastAt: string;
}

const norm = (s: string) =>
  String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-яәіңғүұқөһ0-9]+/gi, " ")
    .trim();

/** Основа слова: первые 5 букв — «Пожарка» найдёт «Пожарке», «Маргарита» — «Маргарите». */
const stem = (w: string) => w.slice(0, Math.max(3, Math.min(5, w.length)));

/**
 * Кандидаты по словам из поручения: в имени (карточки, лида, WhatsApp) должны найтись ВСЕ слова поручения от 3 букв.
 * Один номер — один кандидат (клиент перебивает лида, лид — имя в WhatsApp). Свои клиенты сотрудника — выше, потом
 * свежая переписка. Если по всем словам никого — ищем по каждому слову по отдельности не будем: «Маргарита» в базе
 * шесть разных, и угадывать нельзя.
 */
export function matchTargets(query: string, candidates: { text: string; target: StaffTarget }[], staffEmail = ""): StaffTarget[] {
  const words = norm(query)
    .split(" ")
    .filter((w) => w.length >= 3)
    .map(stem);
  if (!words.length) return [];
  const rank: Record<string, number> = { клиент: 0, лид: 1, WhatsApp: 2 };
  const best = new Map<string, StaffTarget>();
  for (const c of candidates) {
    const key = phoneKey(c.target.phone);
    if (!key) continue;
    const hay = norm(c.text);
    const tokens = hay.split(" ");
    if (!words.every((w) => tokens.some((t) => t.startsWith(w)))) continue;
    const prev = best.get(key);
    // Один номер — одна строка: карточка клиента главнее лида, лид — имени в WhatsApp; при равенстве — имя подробнее.
    const better = (a: StaffTarget, b: StaffTarget) => {
      const ra = rank[a.kind] ?? 3;
      const rb = rank[b.kind] ?? 3;
      return ra !== rb ? (ra < rb ? a : b) : a.name.length >= b.name.length ? a : b;
    };
    const merged = prev ? { ...better(c.target, prev), lastAt: [prev.lastAt, c.target.lastAt].sort().pop() || "" } : c.target;
    best.set(key, merged);
  }
  const mine = (t: StaffTarget) => (staffEmail && t.managerEmail.toLowerCase() === staffEmail.toLowerCase() ? 0 : 1);
  return Array.from(best.values()).sort((a, b) => mine(a) - mine(b) || (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}

/** Ответ сотрудника на «кому из них?»: «2», «2.», «номер 2». */
export function pickedNumber(text: string): number {
  const m = String(text || "").trim().match(/^(?:№|номер\s*)?(\d{1,2})[.)]?$/i);
  return m ? Number(m[1]) : 0;
}

/**
 * Поручение — себе? Модель назвала адресата «мне» — да; адресата нет вовсе — да, если в самом сообщении не просили
 * «клиенту» (тогда это забытое имя, и надо переспросить).
 */
export function wantsForSelf(command: Pick<StaffCommand, "client" | "phone">, message: string): boolean {
  if (command.phone) return false;
  if (command.client) return isSelfTarget(command.client);
  return !/клиент|кому|ему\b|ей\b/i.test(String(message || ""));
}

// --- Какие фото ----------------------------------------------------------------

/**
 * Фото под поручение. На пункт с сортом — до 2 фото этого сорта; «все категории / разные» — до 4 фото цветка
 * (разные сорта, живые первыми, инфографика категорий — в конце: её просили именно ради категорий). Одно фото дважды не
 * идёт; всего не больше `STAFF_MAX_PHOTOS`.
 */
export function pickStaffPhotos<T extends BotPhoto>(photos: T[], items: StaffItem[]): { picked: T[]; missing: string[] } {
  const n = (s: string) => norm(s).replace(/\s+/g, "");
  const live = photos.filter((p) => p.active && p.fileId);
  const used = new Set<string>();
  const picked: T[] = [];
  const missing: string[] = [];
  const t = (iso: string) => Date.parse(iso || "") || 0;
  for (const it of items) {
    const v = n(it.variety);
    const g = n(it.grade);
    const pool = live
      .filter((p) => p.flowerType === it.flowerType && !used.has(p.photoId))
      .filter((p) => !v || n(p.variety) === v)
      .filter((p) => !g || !p.grade || n(p.grade) === g)
      // Инфографика — только когда просят «все категории» (или о сорте, у которого она есть, — с ним в паре).
      .filter((p) => !isInfoPhoto(p) || it.many || (!!v && n(p.variety) === v));
    const ordered = pool.sort(
      (a, b) => Number(isInfoPhoto(a)) - Number(isInfoPhoto(b)) || Number(!!g && n(b.grade) === g) - Number(!!g && n(a.grade) === g) || t(a.lastSentAt) - t(b.lastSentAt)
    );
    const limit = it.many ? 4 : 2;
    const take: T[] = [];
    const varieties = new Set<string>();
    // «Все категории»: инфографика категорий — как раз про это, ей место оставляем (живых — на одно меньше).
    const info = it.many ? ordered.find((p) => isInfoPhoto(p)) : undefined;
    const liveLimit = info ? limit - 1 : limit;
    // Сначала разные сорта, потом — что осталось.
    for (const p of ordered) {
      if (isInfoPhoto(p) || take.length >= liveLimit || varieties.has(n(p.variety))) continue;
      take.push(p);
      varieties.add(n(p.variety));
    }
    for (const p of ordered) if (!isInfoPhoto(p) && take.length < liveLimit && !take.includes(p)) take.push(p);
    if (info) take.push(info);
    // Инфографики нет, а места есть — добираем (о сорте: её инфографика рядом с живым фото).
    for (const p of ordered) if (take.length < limit && !take.includes(p)) take.push(p);
    // Инфографику — последней.
    take.sort((a, b) => Number(isInfoPhoto(a)) - Number(isInfoPhoto(b)));
    if (!take.length) missing.push(photoLabel({ flowerType: it.flowerType, variety: it.variety, grade: it.grade }));
    for (const p of take) {
      if (picked.length >= STAFF_MAX_PHOTOS) break;
      used.add(p.photoId);
      picked.push(p);
    }
  }
  return { picked, missing };
}

// --- Тексты сотруднику ----------------------------------------------------------

export function staffAskText(query: string, list: StaffTarget[]): string {
  const lines = list.slice(0, 6).map((t, i) => `${i + 1}. ${t.name} · …${t.phone.replace(/\D/g, "").slice(-4)} (${t.kind})`);
  return [`Нашёл несколько «${query}». Кому отправить? Ответьте цифрой:`, "", ...lines].join("\n");
}

export function staffNotFoundText(query: string): string {
  return `Не нашёл клиента «${query}» в базе. Напишите его номер телефона — отправлю туда.`;
}

export function staffDoneText(input: { name: string; phone: string; via: string; sent: string[]; missing: string[]; text: boolean }): string {
  const parts = [`Отправил ${input.name} (…${input.phone.replace(/\D/g, "").slice(-4)}) с ${input.via}:`];
  if (input.sent.length) parts.push(input.sent.map((s) => `• ${s}`).join("\n"));
  if (input.text) parts.push("• ваше сообщение");
  if (input.missing.length) parts.push(`Фото нет в CRM: ${input.missing.join(", ")} — пришлите их владельцу, загружу.`);
  return parts.join("\n");
}

export const STAFF_OTHER_TEXT =
  "Пока по поручению умею только отправить клиенту фото или сообщение. Например: «Отправь фото Altaj первой и белую эустому Маргарите Пожарка».";
