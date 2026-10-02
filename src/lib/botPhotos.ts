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
}

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
export function pickRotationPhoto(photos: BotPhoto[], opts: { flowers?: string[]; exclude?: string[] } = {}): BotPhoto | null {
  const exclude = new Set(opts.exclude ?? []);
  const live = photos.filter((p) => p.active && p.fileId && !exclude.has(p.photoId));
  const wanted = (opts.flowers ?? []).filter(Boolean);
  const pool = wanted.length ? live.filter((p) => wanted.includes(p.flowerType)) : [];
  const list = pool.length ? pool : live;
  if (list.length === 0) return null;
  const t = (iso: string) => Date.parse(iso || "") || 0;
  return [...list].sort((a, b) => t(a.lastSentAt) - t(b.lastSentAt) || a.sentCount - b.sentCount || (a.createdAt < b.createdAt ? 1 : -1))[0];
}

/** Фото цветка для каталога: свежие первыми; первое — большое, следующие три — галерея. */
export function catalogPhotos(photos: BotPhoto[], flowerType: string): BotPhoto[] {
  return photos
    .filter((p) => p.active && p.fileId && p.flowerType === flowerType)
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
 * этому человеку не шлём. Нет подходящего — null.
 */
export function pickItemPhoto(
  photos: BotPhoto[],
  item: { flowerType: string; variety: string; grade: string },
  recent = ""
): BotPhoto | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");
  const v = norm(item.variety);
  const g = norm(item.grade);
  const scored = photos
    .filter((p) => p.active && p.fileId && p.flowerType === item.flowerType)
    .filter((p) => !(p.caption && recent.includes(p.caption.slice(0, 40))))
    .map((p) => {
      const pv = norm(p.variety);
      const pg = norm(p.grade);
      if ((pv && v && pv !== v) || (pg && g && pg !== g)) return null;
      return { p, score: (pv && pv === v ? 2 : 0) + (pg && pg === g ? 1 : 0) };
    })
    .filter((x): x is { p: BotPhoto; score: number } => !!x);
  if (scored.length === 0) return null;
  const t = (iso: string) => Date.parse(iso || "") || 0;
  scored.sort((a, b) => b.score - a.score || t(a.p.lastSentAt) - t(b.p.lastSentAt) || a.p.sentCount - b.p.sentCount);
  return scored[0].p;
}
