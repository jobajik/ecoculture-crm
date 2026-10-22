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
 * Пачка позиции, если её знаем НАВЕРНЯКА (владелец, 22.10: «пачки не разбиваем — нельзя написать „возьмите 50 штук“»):
 * мини-микс розы — по сорту, эустома — по длине. Обычная роза — null: 15 у одноголовой и кустовой, 10 у пионовидной,
 * а какие сорта пионовидные, в справочнике не записано (`PEONY_ROSE_VARIETIES`, пока пусто) — угадывать нельзя.
 */
export const PEONY_ROSE_VARIETIES: string[] = [];

export function packFor(flowerType: string, variety: string, grade: string): number | null {
  if (flowerType === "rose") {
    const mm = miniMixPack(variety);
    if (mm) return mm;
    if (PEONY_ROSE_VARIETIES.some((v) => v.toLowerCase() === variety.trim().toLowerCase())) return 10;
    return PEONY_ROSE_VARIETIES.length ? 15 : null;
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
    "Сорт розы не знаешь, одноголовый он, кустовой или пионовидный, — пачку не называй.",
  ].join("\n");
}
