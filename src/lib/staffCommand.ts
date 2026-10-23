import { phoneKey } from "./leads";
import { FLOWER_TYPE_LABELS, isMiniMixVariety } from "./constants";
import { normalizeGrade } from "./botOrder";
import { packFor, roseKindMatches } from "./packing";
import { priceFor, type PriceRow } from "./priceList";
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
  /** Сколько штук (для расчёта стоимости); 0 — не названо. */
  quantity: number;
  /** Цвет, как написал сотрудник («ярко-розовые»), — для строки расчёта, когда сорт не назван. */
  color?: string;
  /** Вид розы: single — одноголовая, spray — кустовая, peony — пионовидная; пусто — не сказано или не роза. */
  kind: string;
}

export interface StaffCommand {
  /**
   * send — отправить клиенту; quote — посчитать стоимость списка по прайсу (23.10.2026, Ильгар: «можешь посчитать
   * сколько по стоимости выйдет», владелец: «надо чтобы ты теперь тоже так мог»); other — просьба, которую бот не
   * умеет; none — не поручение.
   */
  intent: "send" | "quote" | "other" | "none";
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
      enum: ["send", "quote", "other", "none"],
      description:
        "send — сотрудник просит отправить клиенту фото, каталог или сообщение; quote — просит посчитать стоимость списка позиций («сколько выйдет», «посчитай», «сумма», «скинь расчёт»), список — в items с количеством; other — просит бота сделать что-то другое; none — не поручение (приветствие, ответ на сводку, «ок», новости).",
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
        required: ["flowerType", "variety", "grade", "many", "quantity", "kind", "color"],
        properties: {
          flowerType: { type: "string", enum: ["rose", "chrysanthemum", "eustoma"] },
          variety: S("Сорт ТОЧНО как в списках ниже (фото или прайс), только если он НАЗВАН или цвет прямо в названии сорта («белая эустома» → Alissa White, «розовая эустома» → Alissa Pink). Цвет розы («ярко-розовые», «нежные») или вид («кустовая») — НЕ сорт: пусто, цвет — в color. Не угадывай."),
          color: S("Цвет, если назван («ярко-розовые», «нежные», «белые»). Иначе пусто."),
          grade: S("Категория или длина, если названа («Первая», «Третья», «60», «Стандарт», «Мини-микс»). Эустома «классическая» — Стандарт. Иначе пусто."),
          many: { type: "boolean", description: "true — «все категории», «все сорта», «разные»: несколько фото этого цветка." },
          quantity: { type: "number", description: "Сколько штук этой позиции (для расчёта). Разбивка по цветам одной позиции («20 розовых, 20 белых») — отдельными пунктами. Не названо — 0." },
          kind: { type: "string", enum: ["single", "spray", "peony", ""], description: "Роза: single — одноголовая, spray — кустовая, peony — пионовидная; не роза или не сказано — пусто." },
        },
      },
    },
    text: S("Что передать клиенту словами, если сотрудник просил (без фото). Иначе пусто."),
  },
};

export function staffCommandPrompt(photoLabels: string[], priceList = ""): string {
  return [
    "Ты разбираешь сообщение СОТРУДНИКА компании Ecoculture (оптовые цветы: розы, хризантемы, эустома) рабочему номеру WhatsApp.",
    "Сотрудники пишут сюда поручения вроде «отправь фото Altaj первой Маргарите Пожарка» или «скинь клиенту Асель каталог роз».",
    "Определи, поручение ли это, кому и что отправить. Ничего не выдумывай: клиента и позиции бери только из сообщения.",
    "«Скинь фото Jumilia», «покажи Altaj», «мне скинь» — сотрудник просит фото СЕБЕ: intent send, client «мне».",
    "Сорт пиши как в списке фото ниже, даже если сотрудник написал по-русски («джумилия» — Jumilia, «алтай» — Altaj).",
    "Цвет → сорт по списку фото: белая эустома — Alissa White, розовая — Alissa Pink (и Corelli Pink, если просят все розовые).",
    "«Хризантема всех категорий» — один пункт: chrysanthemum, сорт пусто, категория пусто, many=true.",
    "Каталог или «что есть» по цветку — пункт этого цветка с many=true.",
    "Посчитать стоимость — intent quote: каждая строка списка — пункт с количеством; если строка разбита по цветам",
    "(«40 шт: 20 ярко-розовых, 20 нежных»), — два пункта по 20, цвет — в color, сорт пусто, если его не назвали.",
    "Сорт и категорию бери ТОЛЬКО из прайса ниже, сорт не придумывай; цены не считай — посчитает программа.",
    "«Посчитай и отправь клиенту X» — тоже quote, клиент в client. У розы «1 сорт 60 см» — длина «60», «2 сорт 60» — «60 (2 сорт)».",
    "Роза: кустовая — kind spray, одноголовая — single, пионовидная — peony; сорт — только если назван.",
    "",
    "Фото в CRM сейчас:",
    ...photoLabels.map((l) => `- ${l}`),
    ...(priceList ? ["", "Прайс на сегодня (сорта и категории):", priceList] : []),
  ].join("\n");
}

const FLOWERS = ["rose", "chrysanthemum", "eustoma"];

export function parseStaffCommand(raw: unknown): StaffCommand {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const intent = r.intent === "send" || r.intent === "quote" || r.intent === "other" ? r.intent : "none";
  const items = (Array.isArray(r.items) ? r.items : [])
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .filter((x) => FLOWERS.includes(String(x.flowerType || "")))
    .map((x) => ({
      flowerType: String(x.flowerType),
      variety: String(x.variety || "").trim().slice(0, 80),
      grade: String(x.grade || "").trim().slice(0, 40),
      many: x.many === true,
      quantity: Math.max(0, Math.round(Number(x.quantity) || 0)),
      kind: ["single", "spray", "peony"].includes(String(x.kind)) ? String(x.kind) : "",
      color: String(x.color || "").trim().slice(0, 40),
    }))
    .slice(0, 12);
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
  "Пока по поручению умею: отправить клиенту фото или сообщение и посчитать стоимость по прайсу. Например: «Отправь фото Altaj первой Маргарите Пожарка» или «Посчитай: Altaj 3 кат 200 шт, роза 60 см 150 шт».";

// --- Расчёт стоимости -----------------------------------------------------------

const KIND_LABEL: Record<string, string> = { single: "одноголовая", spray: "кустовая", peony: "пионовидная" };
const ROSE_PACK: Record<string, number> = { single: 15, spray: 15, peony: 10 };

export interface QuoteLine {
  label: string;
  quantity: number;
  /** Цена стебля; 0 — нет в прайсе. */
  price: number;
  /**
   * Сорт не назван, а цены у сортов разные: в `price` — цена основной массы склада, здесь — остальные цены с сортами
   * («Jana, Love Lydia — 410 ₸»). Пусто — цена одна.
   */
  others: { price: number; varieties: string[] }[];
  /** Сколько в пачке, если знаем. */
  pack: number | null;
  /** Свободно на складе (все сорта позиции, если сорт не назван); null — не знаем. */
  stock: number | null;
}

/** Строка позиции: «Роза кустовая Julieta Spray, 60 см». */
export function quoteLabel(it: Pick<StaffItem, "flowerType" | "variety" | "grade" | "kind" | "color">, flowerLabel: string): string {
  const kind = it.flowerType === "rose" && KIND_LABEL[it.kind] && !/мини-?микс/i.test(it.variety) ? ` ${KIND_LABEL[it.kind]}` : "";
  const variety = it.variety ? ` ${it.variety}` : it.color ? ` (${it.color})` : "";
  const grade = it.grade ? `, ${/^\d+$/.test(it.grade) ? `${it.grade} см` : it.grade}` : "";
  return `${flowerLabel}${kind}${variety}${grade}`;
}

/** Пачка для расчёта: правила паккинга, а у обычной розы — по виду, если сотрудник его назвал. */
export function quotePack(it: Pick<StaffItem, "flowerType" | "kind">, known: number | null | undefined): number | null {
  if (known) return known;
  // undefined — у сортов позиции на складе пачки разные или неизвестны: не угадываем.
  if (known === undefined) return null;
  if (it.flowerType === "rose" && ROSE_PACK[it.kind]) return ROSE_PACK[it.kind];
  return null;
}

/** Пачка, одинаковая у всех сортов позиции; разные или хоть одна неизвестна — undefined. */
export function commonPack(packs: (number | null)[]): number | undefined {
  const set = new Set(packs);
  const only = set.size === 1 ? Array.from(set)[0] : null;
  return only ?? undefined;
}

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU").replace(/\u00a0/g, " ")} ₸`;

/**
 * Текст расчёта сотруднику: строка на позицию (штуки × цена = сумма), не кратно пачке — во сколько выйдет целыми пачками,
 * на складе меньше — сколько есть, нет цены — так и пишем. Итог — по позициям с ценой; «с пачками» — отдельной строкой,
 * если хоть одна позиция не кратна. Цены считает код, не модель.
 */
export function staffQuoteText(lines: QuoteLine[], forClient = false): string {
  const out: string[] = [forClient ? "Расчёт по вашему списку (цены на сегодня):" : "Расчёт по прайсу на сегодня:"];
  let total = 0;
  let totalPacks = 0;
  let packsDiffer = false;
  const missing: string[] = [];
  const low: string[] = [];
  for (const l of lines) {
    if (!l.quantity) {
      missing.push(`${l.label} — не понял, сколько штук`);
      continue;
    }
    if (!l.price) {
      missing.push(`${l.label} — нет цены в прайсе`);
      continue;
    }
    const packed = l.pack && l.quantity % l.pack !== 0 ? Math.ceil(l.quantity / l.pack) * l.pack : l.quantity;
    total += l.quantity * l.price;
    totalPacks += packed * l.price;
    let row = `• ${l.label} — ${l.quantity} шт. × ${money(l.price)} = ${money(l.quantity * l.price)}`;
    if (packed !== l.quantity) {
      packsDiffer = true;
      row += `\n   пачками по ${l.pack}: ${packed} шт. — ${money(packed * l.price)}`;
    }
    // Сорт не назван — цена основной массы, остальные цены — с сортами: пусть сотрудник уточнит.
    if (l.others.length) row += `\n   ${forClient ? "другие сорта" : "это основная цена; другие сорта"}: ${l.others.map((o) => `${o.varieties.join(", ")} — ${money(o.price)}`).join("; ")}`;
    out.push(row);
    if (l.stock !== null && l.stock < packed) low.push(`${l.label} — ${l.stock > 0 ? `свободно ~${l.stock} шт.` : "сейчас нет"}`);
  }
  if (total > 0) {
    out.push("", `Итого: *${money(total)}*`);
    if (packsDiffer) out.push(`Целыми пачками: *${money(totalPacks)}*`);
  }
  // Клиенту — только посчитанное: «не понял» и склад — дело сотрудника.
  if (forClient) return out.join("\n");
  if (missing.length) out.push("", "Не посчитал:", ...missing.map((m) => `• ${m}`));
  if (low.length) out.push("", "На складе меньше:", ...low.map((m) => `• ${m}`));
  return out.join("\n");
}

/**
 * Строки расчёта по прайсу и складу. Сорт и категория названы — их цена (своя или общая по категории). Сорт не назван —
 * смотрим сорта этой позиции на складе (у розы — с учётом вида сорта по списку владельца, `roseKindMatches` в `packing.ts`): цена
 * у всех одна — она, разные — цена основной массы склада, остальные — строкой с сортами; на складе нет — общая цена. Цены считает код.
 */
export function quoteLines(items: StaffItem[], prices: Map<string, PriceRow>, stock: { flower: string; variety: string; grade: string; qty: number }[]): QuoteLine[] {
  const n = (s: string) => norm(s).replace(/\s+/g, "");
  return items.map((raw) => {
    const f = raw.flowerType;
    const grade = normalizeGrade(f, raw.grade) || raw.grade;
    // Сорт — как он записан на складе («altaj» → «Altaj»).
    const variety = (stock.find((s) => s.flower === f && n(s.variety) === n(raw.variety))?.variety ?? raw.variety).trim();
    const fits = (v: string) => {
      if (isMiniMixVariety(v)) return /мини/i.test(grade);
      return f !== "rose" || !raw.kind || roseKindMatches(v, raw.kind);
    };
    const rows = stock.filter((s) => s.flower === f && (!grade || s.grade === grade) && (variety ? n(s.variety) === n(variety) : fits(s.variety)));
    let price = 0;
    let others: QuoteLine["others"] = [];
    if (variety && grade) price = priceFor(prices, f, variety, grade);
    else {
      // Цены сортов этой позиции на складе: основная — у которой больше всего стеблей.
      const tiers = new Map<number, { qty: number; varieties: Set<string> }>();
      for (const r of rows) {
        const p = priceFor(prices, f, r.variety, r.grade);
        if (p <= 0) continue;
        const t = tiers.get(p) ?? { qty: 0, varieties: new Set<string>() };
        t.qty += r.qty;
        t.varieties.add(r.variety);
        tiers.set(p, t);
      }
      const sorted = Array.from(tiers.entries()).sort((a, b) => b[1].qty - a[1].qty || a[0] - b[0]);
      if (sorted.length) {
        price = sorted[0][0];
        others = sorted
          .slice(1)
          .sort((a, b) => a[0] - b[0])
          .map(([p, t]) => ({ price: p, varieties: Array.from(t.varieties).sort() }));
      } else if (grade) price = priceFor(prices, f, "", grade);
    }
    return {
      label: quoteLabel({ flowerType: f, variety, grade, kind: raw.kind, color: raw.color }, FLOWER_TYPE_LABELS[f] || f),
      quantity: raw.quantity,
      price,
      others,
      pack: quotePack(raw, variety || !rows.length ? packFor(f, variety, grade) : commonPack(rows.filter((r) => !price || priceFor(prices, f, r.variety, r.grade) === price).map((r) => packFor(f, r.variety, r.grade)))),
      stock: grade ? rows.reduce((sum, s) => sum + s.qty, 0) : null,
    };
  });
}
