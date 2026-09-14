import { FARM_BOUND_ROLES, FARMS, ROLES, isFarmBoundRole } from "./constants";
import type { AppUser } from "./types";

/**
 * Кого и как можно заводить в систему.
 *
 * До этого сотрудники жили только в Google-таблице: чтобы принять человека или
 * закрыть доступ уволенному, владелец открывал вкладку `Users`, вписывал строку
 * и ставил `TRUE` в колонке `Active`. Страница «Настройки» была не настройками,
 * а инструкцией, как это сделать руками.
 *
 * Своя дверь в программе опаснее, чем кажется, поэтому все запреты собраны
 * здесь — чистыми функциями, покрытыми `scripts/check-staff.ts`, а не разложены
 * по форме и обработчику. Ровно этот урок уже стоил дорого (грабли 1.10 и 1.11):
 * проверка в браузере — подсказка, а запрещает только сервер, и ошибка обязана
 * ЗАКРЫВАТЬ доступ, а не открывать.
 *
 * Три запрета стоят отдельно от остальных, потому что каждый из них — это
 * возможность запереть себя снаружи:
 *
 * 1. **свою роль не меняют.** Иначе один неверный выбор в списке — и
 *    единственный администратор становится агрономом, а вернуть себя назад
 *    некому: страница «Настройки» ему уже не откроется;
 * 2. **себя не отключают.** То же самое, только быстрее;
 * 3. **последнего активного администратора не разжалуют и не отключают.**
 *    Первые два запрета этого не покрывают: администраторов может быть двое, и
 *    один способен отключить другого, а потом сам уйти в отпуск.
 *
 * Выход из запертой двери всё равно остаётся — вкладка `Users` в таблице никуда
 * не делась, и владелец может поправить строку руками. Но это аварийный выход,
 * а не рабочий путь, и знать про него должен только тот, кто читает этот файл.
 */

export interface StaffDraft {
  email: string;
  name: string;
  role: string;
  /** Производство: обязательно у зав. складом и агронома, у остальных пусто. */
  farm: string;
  active: boolean;
}

export interface StaffContext {
  /** Кто сохраняет. Имеет значение только `admin`. */
  actorRole: string | undefined;
  actorEmail: string;
  /** Все сотрудники, как они лежат сейчас. */
  users: AppUser[];
}

const FARM_CODES: string[] = Object.values(FARMS);

/** Приводим введённое к тому виду, в котором это ляжет в таблицу. */
export function cleanStaff(draft: StaffDraft): StaffDraft {
  const role = (draft.role || "").trim();
  return {
    email: (draft.email || "").trim().toLowerCase(),
    name: (draft.name || "").trim(),
    role,
    // Производство имеет смысл только у двух ролей. У остальных оно СТИРАЕТСЯ,
    // а не сохраняется «на всякий случай»: оставленное поле потом читается как
    // настоящее ограничение и приводит к пустому складу (грабли 1.1).
    farm: isFarmBoundRole(role) ? (draft.farm || "").trim().toLowerCase() : "",
    active: Boolean(draft.active),
  };
}

/** Похоже ли это на почту. Строго, но без попытки проверить существование. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/**
 * Почему сохранить нельзя. Пустая строка — можно.
 *
 * Возвращаем ТЕКСТ, а не флаг: человеку нужно знать, что именно поправить, и
 * тот же текст показывает и форма, и серверный отказ — двух формулировок
 * одного правила быть не должно.
 */
export function staffSaveRefusal(ctx: StaffContext, draft: StaffDraft): string {
  if (ctx.actorRole !== ROLES.ADMIN) {
    return "Сотрудников заводит и отключает только администратор.";
  }

  const clean = cleanStaff(draft);
  const actor = (ctx.actorEmail || "").trim().toLowerCase();
  const existing = ctx.users.find((u) => u.email === clean.email) ?? null;

  if (!clean.email) return "Не указана рабочая почта — по ней человек входит в систему.";
  if (!looksLikeEmail(clean.email)) {
    return `«${clean.email}» не похоже на адрес почты. Нужен адрес вида имя@ecoculture.kz.`;
  }
  if (!clean.name) {
    // Не придирка: имя подставляется везде, где человек видит сотрудника.
    // Без него в списках стоит почтовый адрес — это уже было и читалось плохо.
    return "Не указано имя. Без него человек будет виден почтой во всех списках.";
  }

  const roleCodes: string[] = Object.values(ROLES);
  if (!clean.role) return "Не выбрана роль. Без роли человек не попадёт никуда.";
  if (!roleCodes.includes(clean.role)) return `Роль «${clean.role}» не существует.`;

  if (isFarmBoundRole(clean.role)) {
    if (!clean.farm) {
      return "У этой роли обязательно производство: без него человек не увидит ни одной партии.";
    }
    if (!FARM_CODES.includes(clean.farm)) return `Производство «${clean.farm}» не существует.`;
  }

  // --- Запреты, которые не дают запереть себя снаружи ------------------------
  if (existing && existing.email === actor) {
    if (clean.role !== existing.role) {
      return "Свою роль менять нельзя: ошибка в выборе закрыла бы вам эту страницу навсегда.";
    }
    if (!clean.active) {
      return "Отключить себя нельзя — войти обратно будет некому.";
    }
  }

  const activeAdminsAfter = ctx.users.filter((u) => {
    if (u.email === clean.email) return clean.role === ROLES.ADMIN && clean.active;
    return u.role === ROLES.ADMIN && u.active;
  });
  // Если сотрудника ещё нет в списке, он добавится сверх имеющихся.
  const willBeAdmin = !existing && clean.role === ROLES.ADMIN && clean.active;
  if (activeAdminsAfter.length === 0 && !willBeAdmin) {
    return "После этого не останется ни одного активного администратора — настройки станут недоступны никому.";
  }

  return "";
}

/** Что именно изменится — для журнала и для подтверждения человеку. */
export function staffChangeSummary(before: AppUser | null, after: StaffDraft): string {
  const clean = cleanStaff(after);
  if (!before) return `заведён ${clean.name} (${clean.email}), роль ${clean.role}`;
  const parts: string[] = [];
  if (before.name !== clean.name) parts.push(`имя: ${before.name || "—"} → ${clean.name}`);
  if (before.role !== clean.role) parts.push(`роль: ${before.role || "—"} → ${clean.role}`);
  if ((before.farm ?? "") !== clean.farm) {
    parts.push(`производство: ${before.farm || "—"} → ${clean.farm || "—"}`);
  }
  if (before.active !== clean.active) {
    parts.push(clean.active ? "доступ открыт" : "доступ закрыт");
  }
  return parts.length ? parts.join(", ") : "без изменений";
}

/** Роли, у которых производство обязательно, — для подписи в форме. */
export const FARM_REQUIRED_ROLES = FARM_BOUND_ROLES;
