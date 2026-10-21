import { FLOWER_TYPE_LABELS, formatGrade } from "./constants";

// ---------------------------------------------------------------------------
// Фото для клиентов (владелец, 01.10.2026: «надо, чтобы ты отправлял клиентам
// фотки, которые я загружу в систему, — разные фотографии в ротации, с цветком
// и каким-нибудь продающим текстом»). Решения владельца: фото грузятся в CRM
// («Клиенты → Рассылки → Фото и каталог»), к фото — цветок (сорт и категория по
// желанию) и подпись: её предлагает ИИ, человек правит. ЦЕНЫ в подписи нет — она
// дописывается при отправке из действующего прайса, иначе фото месяц спустя
// обещало бы старую цену. Уходят фото: при дожиме молчащих, когда клиент просит
// каталог или фото, и в рассылках («фото из ротации» — каждому своё).
//
// Ротация: реже всех отправленное фото первым (`pickRotationPhoto`), так
// клиенты видят разные снимки, а не один и тот же.
//
// Инфографика (`kind = "info"`, 12.10.2026, владелец: «пусть бот чаще использует живые
// фотографии, а эту инфографику — как ознакомительную»; 13.10: «не в первых сообщениях,
// лучше живые и настоящие»): в ротацию, каталог и дожим не идёт; к ответу про позицию —
// только когда живые этому человеку уже уходили и подходящих живых не осталось, один раз.
// Чистые правила — проверка `scripts/check-bot-photos.ts`.
// ---------------------------------------------------------------------------

export interface BotPhoto {
  photoId: string;
  createdAt: string;
  createdByEmail: string;
  flowerType: string;
  variety: string;
  grade: string;
  caption: string;
  fileId: string;
  fileName: string;
  active: boolean;
  sentCount: number;
  lastSentAt: string;
  /** «info» — инфографика; пусто — живое фото. */
  kind?: string;
}

export const INFO_PHOTO = "info";
export const isInfoPhoto = (p: Pick<BotPhoto, "kind">) => p.kind === INFO_PHOTO;

/** Вложение рассылки: вместо своего файла — фото из ротации или каталог. */
export const ROTATION_FILE = "@rotation";
export const CATALOG_FILE = "@catalog";
export const isSpecialFile = (fileId: string) => fileId === ROTATION_FILE || fileId === CATALOG_FILE;
export const specialFileLabel = (fileId: string) =>
  fileId === ROTATION_FILE ? "фото из ротации — каждому своё" : fileId === CATALOG_FILE ? "каталог (JPEG по цветам)" : "";

export const MAX_PHOTO_CAPTION = 400;

/** Подпись фото: цветок, сорт, категория — «Хризантема Altaj, Первая». */
export function photoLabel(p: Pick<BotPhoto, "flowerType" | "variety" | "grade">): string {
  const name = [FLOWER_TYPE_LABELS[p.flowerType] ?? p.flowerType, p.variety].filter(Boolean).join(" ");
  return p.grade ? `${name}, ${formatGrade(p.grade)}` : name;
}

/** Проверка перед записью фото — на сервере. Пусто — можно. */
export function photoRefusal(input: { flowerType: string; caption: string; fileId: string }): string {
  if (!input.fileId || isSpecialFile(input.fileId)) return "Фото не загрузилось — выберите заново";
  if (!FLOWER_TYPE_LABELS[input.flowerType]) return "Выберите цветок";
  if (String(input.caption || "").trim().length > MAX_PHOTO_CAPTION) return `Подпись длиннее ${MAX_PHOTO_CAPTION} знаков — сократите`;
  return "";
}

/**
 * Какое фото отправить: из включённых, сначала нужного цветка (если такие
 * есть), из них — давнее всех отправленное, потом реже отправленное, потом
 * новое. `exclude` — уже отправленные этому человеку сегодня.
 */
export function pickRotationPhoto(photos: BotPhoto[], opts: { flowers?: string[]; exclude?: string[]; text?: string } = {}): BotPhoto | null {
  const exclude = new Set(opts.exclude ?? []);
  const live = photos.filter((p) => p.active && p.fileId && !isInfoPhoto(p) && !exclude.has(p.photoId));
  const wanted = (opts.flowers ?? []).filter(Boolean);
  const pool = wanted.length ? live.filter((p) => wanted.includes(p.flowerType)) : [];
  // Сорт, названный в тексте («Jumilia 60 — 220 ₸»), — фото этого сорта (20.10.2026: фото к позиции, а не любое фото цветка).
  const named = namedInText(pool.length ? pool : live, opts.text || "");
  const list = named.length ? named : pool.length ? pool : live;
  if (list.length === 0) return null;
  const t = (iso: string) => Date.parse(iso || "") || 0;
  return [...list].sort((a, b) => t(a.lastSentAt) - t(b.lastSentAt) || a.sentCount - b.sentCount || (a.createdAt < b.createdAt ? 1 : -1))[0];
}

/** Фото, чей сорт (или «мини-микс») назван в тексте. */
export function namedInText(photos: BotPhoto[], text: string): BotPhoto[] {
  const norm = (x: string) => x.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  const t = norm(text);
  if (!t) return [];
  const mini = /мини[\s-]?микс/.test(t);
  return photos.filter((p) => {
    const v = norm(p.variety || "");
    if (v && v.length >= 3 && t.includes(v)) return true;
    return mini && /мини[\s-]?микс/.test(norm(`${p.variety} ${p.grade}`));
  });
}

/**
 * Какие цветы названы в тексте рассылки — фото из ротации берётся этого цветка (14.10.2026: рассылка про
 * хризантему 4 категории шла с инфографикой, владелец: «почему опять отправляешь эту инфографику?»).
 */
export function flowersInText(text: string): string[] {
  const t = String(text || "").toLowerCase().replace(/ё/g, "е");
  const out: string[] = [];
  if (/хризантем|altaj|алтай/.test(t)) out.push("chrysanthemum");
  if (/(^|[^а-я])роз(а|ы|у|е|ой|ам|ами|ах)?([^а-я]|$)/.test(t)) out.push("rose");
  if (/эустом/.test(t)) out.push("eustoma");
  return out;
}

/** Фото цветка для каталога: свежие первыми; первое — большое, следующие три — галерея. */
export function catalogPhotos(photos: BotPhoto[], flowerType: string): BotPhoto[] {
  return photos
    .filter((p) => p.active && p.fileId && !isInfoPhoto(p) && p.flowerType === flowerType)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 4);
}

/**
 * Подпись к фото при отправке: продающий текст, цены из прайса списком,
 * вопрос. Не длиннее подписи WhatsApp (1024).
 */
export function photoMessage(input: { caption: string; prices: { label: string; price: number }[]; question: string }): string {
  const nf = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\s/g, " ")} ₸`;
  const parts = [String(input.caption || "").trim()];
  if (input.prices.length) parts.push(input.prices.map((p) => `• ${p.label} — *${nf(p.price)}*`).join("\n"));
  if (input.question) parts.push(input.question);
  return parts.filter(Boolean).join("\n\n").slice(0, 1024);
}

/**
 * Подпись для дожима — одно предложение (21.10.2026, владелец: «лаконично»): полная подпись ИИ к фото — три строки
 * маркетинга, и дожим с ней читался как рассылка. Берём первое предложение, не длиннее 140 знаков.
 */
export function shortCaption(caption: string, max = 140): string {
  const t = String(caption || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  const first = t.split(/(?<=[.!?…])\s+/)[0] || t;
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 60)).trim()}…`;
}

/** Вопрос под фото по номеру касания дожима. */
export function nudgePhotoQuestion(attempt: number): string {
  if (attempt <= 1) return "Поставить вам на завтра? Для пробы — от 50 шт.";
  if (attempt === 2) return "Отложить для вас 50–100 шт. на завтра?";
  return "Собрать пробную партию на завтра?";
}

// --- Подпись от ИИ ------------------------------------------------------------

export const CAPTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["caption"],
  properties: {
    caption: { type: "string", description: "Продающая подпись к фото: 1–2 коротких предложения, без цен." },
  },
} as const;

export function captionPrompt(): string {
  return [
    "Ты пишешь подписи к фотографиям цветов для WhatsApp-рассылки оптовой цветочной компании Ecoculture",
    "(своя теплица в Казахстане: розы, хризантемы, эустома). Читают владельцы цветочных магазинов и салонов.",
    "Напиши ОДНУ подпись: 1–2 коротких живых предложения, которые продают — свежесть среза, стойкость в вазе,",
    "крупный бутон, ровный стебель, как цветок выглядит в букете, спрос у покупателей. Конкретно, без штампов",
    "«лучший», «уникальный», без восклицательных цепочек.",
    "НЕ пиши цены, количество на складе, сроки доставки и скидки — их программа добавит сама. Без эмодзи,",
    "без хэштегов, без обращения по имени. Название сорта, если оно дано, можно упомянуть.",
  ].join("\n");
}

/** Ответ модели → подпись: без цен (их дописывает код), не длиннее предела. */
export function parseCaption(raw: unknown): string {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = typeof o.caption === "string" ? o.caption : "";
  return text
    .replace(/\d[\d\s]*\s?(₸|тг|тенге)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, MAX_PHOTO_CAPTION);
}

/**
 * Фото к ответу бота про конкретную позицию (владелец, 02.10.2026: «почему не
 * отправляешь фото категории? Будь человечнее и отправляй фотку»). Подходит
 * фото того же цветка, у которого сорт и категория либо совпадают, либо не
 * указаны (общее фото цветка). Точнее совпало — лучше; при равенстве — давнее
 * отправленное. Фото, чья подпись уже есть в переписке (`recent`), второй раз
 * этому человеку не шлём. Сначала — живые фото. Инфографика — никогда первым
 * фото в разговоре (владелец, 13.10.2026: «не используй инфографику в первых
 * сообщениях, лучше живые и настоящие фотки»), только когда живое этому
 * человеку уже уходило и подходящих живых больше нет; и одна на человека
 * (`infoSent`). Нет подходящего — null.
 */
export function pickItemPhoto(
  photos: BotPhoto[],
  item: { flowerType: string; variety: string; grade: string },
  recent = "",
  infoSent: string[] = []
): BotPhoto | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");
  const v = norm(item.variety);
  const g = norm(item.grade);
  const liveSent = photos.some((p) => !isInfoPhoto(p) && p.caption && recent.includes(p.caption.slice(0, 40)));
  const scored = photos
    .filter((p) => p.active && p.fileId && p.flowerType === item.flowerType)
    .filter((p) => !(p.caption && recent.includes(p.caption.slice(0, 40))))
    .filter((p) => !(isInfoPhoto(p) && infoSent.includes(p.photoId)))
    // Инфографика — только после ЖИВОГО фото в этом разговоре (14.10.2026: «[фото:» в памяти было от прошлой
    // переписки, и Динаре первым ушла инфографика — та же, что пришла ей рассылкой).
    .filter((p) => !(isInfoPhoto(p) && !liveSent))
    .map((p) => {
      const pv = norm(p.variety);
      const pg = norm(p.grade);
      if ((pv && v && pv !== v) || (pg && g && pg !== g)) return null;
      // Инфографика сорта — только когда речь именно об этом сорте.
      if (isInfoPhoto(p) && !(pv && pv === v)) return null;
      return { p, score: (pv && pv === v ? 2 : 0) + (pg && pg === g ? 1 : 0) };
    })
    .filter((x): x is { p: BotPhoto; score: number } => !!x);
  if (scored.length === 0) return null;
  const t = (iso: string) => Date.parse(iso || "") || 0;
  const info = (p: BotPhoto) => (isInfoPhoto(p) ? 1 : 0);
  scored.sort((a, b) => info(a.p) - info(b.p) || b.score - a.score || t(a.p.lastSentAt) - t(b.p.lastSentAt) || a.p.sentCount - b.p.sentCount);
  return scored[0].p;
}
