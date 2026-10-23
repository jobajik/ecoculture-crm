// ---------------------------------------------------------------------------
// Паккинг — сколько стеблей в пачке (22.10.2026, владелец: «это паккинг наш по цветкам, запомни»). Одна таблица
// на всю программу; сейчас её читает подсказка бота и помощника (`packingPromptBlock`), чтобы на «сколько в пачке?»
// отвечать по факту и предлагать количество целыми пачками; заказ бота не кратно пачке не оформляется (`packFor` в
// `planBotOrder`). По хризантеме пачек владелец не давал — её объёмы
// по-прежнему из его указаний («коробка третьей категории — 200 шт.»). Проверка — `check-bot-turn`.
// ---------------------------------------------------------------------------

export interface PackRule {
  flowerType: "rose" | "eustoma";
  /** Как называем позицию человеку. */
  label: string;
  stems: number;
}

export const PACKING: PackRule[] = [
  { flowerType: "rose", label: "Роза одноголовая", stems: 15 },
  { flowerType: "rose", label: "Роза кустовая", stems: 15 },
  { flowerType: "rose", label: "Роза пионовидная", stems: 10 },
  { flowerType: "rose", label: "Мини-микс одноголовые", stems: 90 },
  { flowerType: "rose", label: "Мини-микс кустовые", stems: 80 },
  { flowerType: "rose", label: "Мини-микс пионовидные", stems: 80 },
  { flowerType: "eustoma", label: "Эустома 70 см (Стандарт) и 50 см", stems: 10 },
  { flowerType: "eustoma", label: "Эустома мини-микс", stems: 60 },
];

/** Сколько в пачке у мини-микса розы по названию сорта («Мини-микс кустовые» → 80); не мини-микс — null. */
export function miniMixPack(variety: string): number | null {
  const v = variety.toLowerCase();
  if (!v.includes("мини-микс") && !v.includes("минимикс")) return null;
  if (v.includes("одноголов")) return 90;
  if (v.includes("кустов") || v.includes("пионовид")) return 80;
  return null;
}

/**
 * Вид розы по сорту — список владельца (23.10.2026, снимок «Анализ остатков», колонка «Тип розы»; «каких-то сортов уже
 * может и не быть на теплице»). Названия в его файле и в CRM пишутся по-разному («Lovely Lydia» / «Love Lydia»,
 * «Odilia» / «Odiliy», «Annakarina» / «Anna Karina», «Whiskey» / «Whisky») — сравнение без пробелов и регистра, оба
 * написания в списке. «Пионовидная спрей-роза» — и кустовая, и пионовидная. Сорта нет в списке — вид неизвестен
 * (не «одноголовая»: 23.10 так ошибочно считалось, и Misty Bubbles шла в одноголовые).
 */
export type RoseKind = "single" | "spray" | "peony_spray" | "peony";

export const ROSE_KINDS: Record<RoseKind, string[]> = {
  single: [
    "All Star", "Prestige", "Red Naomi", "Avalanche", "Peach Avalanche", "Penny Lane", "Maritime", "Revival",
    "Anna Karina", "Annakarina", "Whisky", "Whiskey", "Kamala", "Candy Avalanche", "Con Amore", "Red Eagle", "Jumilia",
  ],
  spray: ["Love Lydia", "Lovely Lydia", "Odiliy", "Odilia", "Jana", "Shine"],
  peony_spray: ["Misty Bubbles", "Julieta Spray", "Blanchette"],
  peony: ["Catalina"],
};

/** Сколько в пачке по виду; null — владелец не говорил (пионовидная спрей-роза — ждём ответа). */
export const ROSE_KIND_PACK: Record<RoseKind, number | null> = { single: 15, spray: 15, peony_spray: null, peony: 10 };

const varietyKey = (v: string) => v.toLowerCase().replace(/ё/g, "е").replace(/[\s-]+/g, "");

/** Вид розы по сорту; мини-микс, «Mix» и сорт не из списка — пусто (не знаем). */
export function roseKindOf(variety: string): RoseKind | "" {
  const k = varietyKey(variety);
  if (!k || /^минимикс/.test(k)) return "";
  for (const kind of Object.keys(ROSE_KINDS) as RoseKind[]) if (ROSE_KINDS[kind].some((v) => varietyKey(v) === k)) return kind;
  return "";
}

/** Подходит ли сорт под вид, который назвал человек: «кустовые» — и спрей, и пионовидные спрей; так же «пионовидные». */
export function roseKindMatches(variety: string, asked: string): boolean {
  const kind = roseKindOf(variety);
  if (asked === "single") return kind === "single";
  if (asked === "spray") return kind === "spray" || kind === "peony_spray";
  if (asked === "peony") return kind === "peony" || kind === "peony_spray";
  return true;
}

/**
 * Пачка позиции, если её знаем НАВЕРНЯКА (владелец, 22.10: «пачки не разбиваем — нельзя написать „возьмите 50 штук“»):
 * мини-микс розы — по сорту, обычная роза — по виду сорта (`ROSE_KINDS`), эустома — по длине. Не знаем — null, и
 * заказ бота количество не проверяет.
 */
export function packFor(flowerType: string, variety: string, grade: string): number | null {
  if (flowerType === "rose") {
    const mm = miniMixPack(variety);
    if (mm) return mm;
    const kind = roseKindOf(variety);
    return kind ? ROSE_KIND_PACK[kind] : null;
  }
  if (flowerType === "eustoma") {
    if (grade === "Мини-микс" || miniMixPack(variety) !== null || /мини-?микс/i.test(variety)) return 60;
    if (grade === "Стандарт" || grade === "50" || grade === "70") return 10;
  }
  return null;
}

/** Ближайшее большее целыми пачками (100 при пачке 15 → 105). */
export function roundUpToPack(quantity: number, pack: number): number {
  return Math.ceil(quantity / pack) * pack;
}

/** Блок подсказки модели: паккинг и как им пользоваться. */
export function packingPromptBlock(): string {
  return [
    "\nПАККИНГ — сколько стеблей в пачке (так собирает склад):",
    ...PACKING.map((p) => `• ${p.label} — ${p.stems} шт. в пачке`),
    "Хризантема — пачки не указаны: про объём хризантемы — только из указаний владельца.",
    "ПАЧКИ НЕ РАЗБИВАЕМ (владелец: «нельзя написать „возьмите 50 штук“ — паккинг мы не меняем»): количество — только",
    "целыми пачками. Сам предлагаешь — кратно пачке и называешь пачки («150 шт., 10 пачек»). На «сколько в пачке?» — по",
    "этому списку. Клиент назвал штуки не кратно пачке — не оформляй как есть: одной фразой предложи ближайшее большее",
    "целыми пачками с суммой («розы идут пачками по 15 — сделаю 105 шт., 7 пачек, это … ₸?»), оформляй на это число.",
    "Вид розы по сорту: одноголовые — " + ROSE_KINDS.single.join(", ") + "; кустовые (спрей) — " + ROSE_KINDS.spray.join(", ") +
      "; пионовидные спрей-розы — " + ROSE_KINDS.peony_spray.join(", ") + "; пионовидные — " + ROSE_KINDS.peony.join(", ") + ".",
    "Пионовидные спрей-розы — пачку не называй (не указана). Сорта нет в этом списке — пачку не называй.",
  ].join("\n");
}
