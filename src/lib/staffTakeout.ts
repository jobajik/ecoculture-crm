import { ROLES, getFarmFor, type FlowerType } from "./constants";

/**
 * Цветы, которые сотрудник берёт в счёт зарплаты.
 *
 * Весь раздел держится на одной мысли: **стебли уходят, деньги не приходят**.
 * Это не продажа — выручки нет и не будет, счёта клиенту никто не выставляет.
 * И это не списание — цветок не пропал, он у человека, и его стоимость
 * вычтут из зарплаты. Поэтому у выдач своя вкладка, свои страницы и этот
 * модуль правил: подмешать их к продажам значило бы выдумать выручку, а к
 * списаниям — испортить показатель потерь, у которого есть ориентир.
 *
 * Все функции здесь чистые и покрыты `scripts/check-takeouts.ts`. Так же
 * сделаны правила заявки и розницы, и по той же причине: то, что нельзя
 * нарушать, проверяется на сервере тестируемой функцией, а не подсказкой в
 * браузере (грабли 1.11).
 */

// --- Имя сотрудника ---------------------------------------------------------

/**
 * Приводит написанное к виду, пригодному для хранения.
 *
 * Владелец выбрал свободный ввод фамилии, а не справочник: сборщицы, водители
 * и охрана в CRM не заведены, и заводить их ради двух букетов в месяц никто не
 * станет. Плата за это известна — «Ахметова», «ахметова » и «Ахметова  Разия»
 * станут тремя разными людьми в итоге за месяц. Поэтому лишние пробелы
 * убираются здесь, регистр и «ё» — в ключе ниже, а в форме фамилия
 * подсказывается из уже введённых.
 */
export function cleanStaffName(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/**
 * Ключ, по которому выдачи одного человека складываются в одну строку.
 *
 * Регистр и «ё» не считаются разными людьми, точки после инициалов — тоже:
 * «Ахметова Р.» и «ахметова Р» — это один человек и одно удержание.
 */
export function staffKey(value: string | null | undefined): string {
  return cleanStaffName(value)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Грубый ключ для подсказки «не этот ли человек?».
 *
 * Фамилия плюс первая буква имени: «Ахметова Разия» и «Ахметова Р.» дают
 * одинаковый грубый ключ, но разный точный — значит одно из написаний почти
 * наверняка описка. Полного совпадения он не гарантирует (две однофамилицы с
 * именами на одну букву дадут ложное срабатывание), поэтому это ПОДСКАЗКА, а
 * не запрет: ровно так же сделана проверка на двойника в клиентской базе.
 */
export function looseStaffKey(value: string | null | undefined): string {
  const parts = staffKey(value).split(" ").filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]}|${parts[1][0]}`;
}

/**
 * Как показывать человека, если его фамилию писали по-разному.
 *
 * Правило: сначала написания с ЗАГЛАВНОЙ буквы, среди них — самое свежее.
 * Просто «побеждает последнее» не годится: одна запись в спешке строчными — и
 * в отчёте, который читает бухгалтер, человек навсегда становится «ахметова
 * разия». А правку фамилии учитывать всё же надо, поэтому среди приличных
 * написаний берётся последнее.
 */
export function staffSpellings(
  takeouts: { staffName: string; date: string }[]
): Map<string, { name: string; date: string }> {
  const best = new Map<string, { name: string; date: string; proper: boolean }>();
  for (const t of takeouts) {
    const key = staffKey(t.staffName);
    if (!key) continue;
    const name = cleanStaffName(t.staffName);
    const proper = /^[A-ZА-ЯЁ]/.test(name);
    const prev = best.get(key);
    if (!prev) {
      best.set(key, { name, date: t.date, proper });
      continue;
    }
    // Приличное написание бьёт неприличное; при равенстве — более свежее.
    if ((proper && !prev.proper) || (proper === prev.proper && t.date >= prev.date)) {
      best.set(key, { name, date: t.date, proper });
    }
  }
  const out = new Map<string, { name: string; date: string }>();
  for (const [key, v] of best) out.set(key, { name: v.name, date: v.date });
  return out;
}

/**
 * Уже встречавшиеся написания — для подсказки в поле ввода.
 *
 * Сначала те, кого выдавали недавно: человек, бравший цветок вчера, скорее
 * возьмёт и сегодня, а список из тридцати фамилий по алфавиту пришлось бы
 * читать целиком.
 */
export function knownStaffNames(takeouts: { staffName: string; date: string }[]): string[] {
  return Array.from(staffSpellings(takeouts).values())
    .sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name, "ru") : a.date < b.date ? 1 : -1))
    .map((v) => v.name);
}

/** Похожее написание из уже введённых — или пусто, если такого нет. */
export function findSimilarStaff(name: string, known: string[]): string {
  const key = staffKey(name);
  if (!key) return "";
  const loose = looseStaffKey(name);
  for (const candidate of known) {
    if (staffKey(candidate) === key) return "";
  }
  for (const candidate of known) {
    if (looseStaffKey(candidate) === loose) return candidate;
  }
  return "";
}

// --- Права ------------------------------------------------------------------

/** Кто записывает выдачу. Владелец решил: ведут сами зав. складами. */
export function canFillTakeouts(role: string | null | undefined): boolean {
  return role === ROLES.WAREHOUSE || role === ROLES.ADMIN;
}

/**
 * Кто видит выдачи.
 *
 * Плюс бухгалтер: итог за месяц — это то, что она удержит из зарплаты, без
 * него учёт «именно по сотрудникам» пришлось бы складывать руками по строкам.
 */
export function canSeeTakeouts(role: string | null | undefined): boolean {
  return canFillTakeouts(role) || role === ROLES.ACCOUNTANT;
}

/**
 * Какое производство показывать. Зав. складом — только своё (грабли 1.1-ter),
 * бухгалтеру и администратору — оба: удержание считается по человеку, а не по
 * теплице, и одна сотрудница может взять и розу, и хризантему.
 */
export function takeoutFarmScope(
  role: string | null | undefined,
  farm: string | null | undefined
): string | null {
  return role === ROLES.WAREHOUSE ? farm ?? null : null;
}

// --- Отказ сервера ----------------------------------------------------------

export interface TakeoutCheckInput {
  role: string | null | undefined;
  /** Производство зав. складом; у администратора пусто. */
  farm: string | null | undefined;
  staffName: string;
  quantity: number;
  unitPrice: number;
  date: string;
  /** Сегодняшний день в формате «ГГГГ-ММ-ДД» — передаётся, чтобы функция была чистой. */
  today: string;
  batch: { flowerType: string; quantityRemaining: number } | null;
}

/**
 * Почему выдачу записать нельзя. Пустая строка — можно.
 *
 * Проверки сервера, а не формы: серверное действие Next.js вызывается обычным
 * запросом, и спрятанная кнопка ничего не запрещает.
 */
export function takeoutRefusal(input: TakeoutCheckInput): string {
  if (!canFillTakeouts(input.role)) {
    return "Записывать выдачи может только зав. складом или администратор";
  }
  if (!cleanStaffName(input.staffName)) return "Укажите, кому выдали";
  if (!input.batch) return "Партия не найдена";

  // Чужой цветок не выдают — то же правило, что на приёмке, отгрузке и
  // списании. Зав. складом Есентая не распоряжается розой.
  if (input.role === ROLES.WAREHOUSE) {
    if (!input.farm) {
      return (
        "У вас не указано производство. Попросите администратора заполнить колонку Farm " +
        "на вкладке Users — без неё работать со складом нельзя."
      );
    }
    if (getFarmFor(input.batch.flowerType as FlowerType) !== input.farm) {
      return "Эта партия относится к другому производству";
    }
  }

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return "Укажите количество";
  }
  if (!Number.isInteger(input.quantity)) return "Количество считается в стеблях, целым числом";
  if (input.quantity > input.batch.quantityRemaining) {
    return `В партии осталось ${input.batch.quantityRemaining} шт.`;
  }

  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) {
    return "Цена не может быть отрицательной";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return "Укажите дату выдачи";
  // Будущим днём выдать нельзя: цветок отдают из рук в руки, а запись «завтра»
  // попала бы в следующий месяц и уехала бы из удержания.
  if (input.date > input.today) return "Дата выдачи не может быть будущей";

  return "";
}

// --- Таблица за день --------------------------------------------------------

export interface TakeoutRow {
  takeoutId: string;
  staffName: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  note: string;
}

export interface TakeoutDay {
  rows: TakeoutRow[];
  stems: number;
  amount: number;
  /** Сколько строк без цены — их сумма в удержание не попадёт. */
  noPrice: number;
  /** Сколько человек брали цветок в этот день. */
  people: number;
}

export interface RawTakeout {
  takeoutId: string;
  date: string;
  staffName: string;
  flowerType: string;
  variety: string;
  grade: string;
  quantity: number;
  unitPrice: number;
  note?: string;
}

/** Отбирает выдачи своего производства. Пустая ферма — берём все. */
function scoped<T extends { flowerType: string }>(items: T[], farm: string | null): T[] {
  if (!farm) return items;
  return items.filter((t) => getFarmFor(t.flowerType as FlowerType) === farm);
}

/** Выдачи за один день — та самая отдельная таблица в отчёте за день. */
export function buildTakeoutDay(input: {
  takeouts: RawTakeout[];
  date: string;
  farm: string | null;
}): TakeoutDay {
  // Показываем КАНОНИЧЕСКОЕ написание, а не то, что вписали в этой строке.
  // Иначе две строки одного человека («Ахметова Разия» и «ахметова разия»)
  // выглядят как два разных сотрудника, и вся склейка кажется несработавшей.
  const spellings = staffSpellings(input.takeouts);
  const rows = scoped(input.takeouts, input.farm)
    .filter((t) => t.date === input.date)
    .map((t) => ({
      takeoutId: t.takeoutId,
      staffName: spellings.get(staffKey(t.staffName))?.name ?? cleanStaffName(t.staffName),
      flowerType: t.flowerType,
      variety: t.variety,
      grade: t.grade,
      quantity: t.quantity,
      unitPrice: t.unitPrice,
      amount: t.quantity * t.unitPrice,
      note: t.note ?? "",
    }))
    // Одного человека держим рядом: в дне бывает три строки на одну фамилию,
    // и вперемешку их пришлось бы собирать глазами.
    //
    // Сортируем по КЛЮЧУ, а не по написанию. Иначе «Ахметова Разия» и
    // «ахметова разия» — один и тот же человек — оказываются в разных концах
    // таблицы, то есть ровно там, где учёт по сотрудникам и разваливается.
    .sort(
      (a, b) =>
        staffKey(a.staffName).localeCompare(staffKey(b.staffName), "ru") ||
        b.quantity - a.quantity
    );

  return {
    rows,
    stems: rows.reduce((s, r) => s + r.quantity, 0),
    amount: rows.reduce((s, r) => s + r.amount, 0),
    noPrice: rows.filter((r) => r.unitPrice <= 0).length,
    people: new Set(rows.map((r) => staffKey(r.staffName))).size,
  };
}

// --- Итог за месяц ----------------------------------------------------------

export interface StaffMonthRow {
  /** Написание, которым показываем человека: самое свежее из его строк. */
  staffName: string;
  key: string;
  stems: number;
  amount: number;
  takeouts: number;
  lastDate: string;
  /** Разбивка по цветку — «20 роз и 15 хризантем» читается лучше, чем «35 шт.». */
  byFlower: { flowerType: string; stems: number }[];
  /** Строк без цены: их стебли в сумме не учтены. */
  noPrice: number;
}

export interface StaffMonth {
  rows: StaffMonthRow[];
  stems: number;
  amount: number;
  people: number;
  noPrice: number;
}

/**
 * Сколько каждый сотрудник взял за месяц и на какую сумму.
 *
 * Это и есть ответ на «вести учёт именно по сотрудникам»: строка на человека,
 * сумма — то, что бухгалтер удержит. Сортировка по сумме, а не по алфавиту:
 * разговор начинается с того, у кого набежало больше всех.
 */
export function buildStaffMonth(input: {
  takeouts: RawTakeout[];
  /** Месяц в формате «2026-09». */
  month: string;
  farm: string | null;
}): StaffMonth {
  const mine = scoped(input.takeouts, input.farm).filter((t) => t.date.startsWith(`${input.month}-`));

  const spellings = staffSpellings(input.takeouts);
  const map = new Map<string, StaffMonthRow & { flowers: Map<string, number> }>();
  for (const t of mine) {
    const key = staffKey(t.staffName);
    if (!key) continue;
    let row = map.get(key);
    if (!row) {
      row = {
        staffName: spellings.get(key)?.name ?? cleanStaffName(t.staffName),
        key,
        stems: 0,
        amount: 0,
        takeouts: 0,
        lastDate: "",
        byFlower: [],
        noPrice: 0,
        flowers: new Map(),
      };
      map.set(key, row);
    }
    row.stems += t.quantity;
    row.amount += t.quantity * t.unitPrice;
    row.takeouts += 1;
    if (t.unitPrice <= 0) row.noPrice += 1;
    if (t.date >= row.lastDate) row.lastDate = t.date;
    row.flowers.set(t.flowerType, (row.flowers.get(t.flowerType) ?? 0) + t.quantity);
  }

  const rows = Array.from(map.values())
    .map(({ flowers, ...row }) => ({
      ...row,
      byFlower: Array.from(flowers.entries())
        .map(([flowerType, stems]) => ({ flowerType, stems }))
        .sort((a, b) => b.stems - a.stems),
    }))
    .sort((a, b) => b.amount - a.amount || b.stems - a.stems || a.staffName.localeCompare(b.staffName, "ru"));

  return {
    rows,
    stems: rows.reduce((s, r) => s + r.stems, 0),
    amount: rows.reduce((s, r) => s + r.amount, 0),
    people: rows.length,
    noPrice: rows.reduce((s, r) => s + r.noPrice, 0),
  };
}

/** Сколько стеблей ушло сотрудникам по каждому цветку за отрезок дат. */
export function takeoutStemsByFlower(input: {
  takeouts: RawTakeout[];
  from: string;
  to: string;
}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of input.takeouts) {
    if (t.date < input.from || t.date > input.to) continue;
    out[t.flowerType] = (out[t.flowerType] ?? 0) + t.quantity;
  }
  return out;
}
