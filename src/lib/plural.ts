/**
 * Русские окончания после числа: «1 заявка», «2 заявки», «5 заявок».
 *
 * Мелочь, но заметная: «1 клиентов» и «4 заявок» на видном месте читаются как
 * недоделка и подрывают доверие ко всем остальным цифрам на странице. Правило
 * одно на весь проект, потому что иначе оно расползётся по компонентам в трёх
 * слегка разных версиях — так уже было со словом «ростовка».
 *
 * Живёт в `lib` без «use client»: нужно и серверным страницам, и браузеру
 * (грабли 1.8).
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.round(n));
  const tens = abs % 100;
  // 11–14 — исключение: «одиннадцать заявок», а не «одиннадцать заявка».
  if (tens >= 11 && tens <= 14) return many;
  const last = abs % 10;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** Число вместе со словом: «3 заявки». */
export function withPlural(n: number, one: string, few: string, many: string): string {
  return `${Math.round(n).toLocaleString("ru-RU")} ${plural(n, one, few, many)}`;
}

/** Готовые формы того, что считается в этом проекте чаще всего. */
export const WORDS = {
  order: ["заявка", "заявки", "заявок"] as const,
  client: ["клиент", "клиента", "клиентов"] as const,
  day: ["день", "дня", "дней"] as const,
  stem: ["стебель", "стебля", "стеблей"] as const,
  record: ["запись", "записи", "записей"] as const,
};

export function orders(n: number): string {
  return withPlural(n, ...WORDS.order);
}
export function clients(n: number): string {
  return withPlural(n, ...WORDS.client);
}
export function days(n: number): string {
  return withPlural(n, ...WORDS.day);
}
