/*
 * Неответ таблицы — это не увольнение.
 *
 * Владелец прислал снимок: у бухгалтера Юлии список оплат открыт, а кнопок нет
 * ни у одной строки — вместо них слово «просмотр». При этом на страницу
 * `/finance` пускают только бухгалтера и администратора, то есть охранник на
 * входе её признал, а сама страница — нет.
 *
 * Причина: роль перечитывается из вкладки Users при КАЖДОЙ отрисовке страницы
 * (так задумано, чтобы права менялись на ходу), охранник же смотрит в готовый
 * пропуск и ничего не перечитывает. Таблица в тот момент не ответила — Google
 * отвечает не всегда, — и программа сделала вывод «такого сотрудника нет», то
 * есть обошлась с Юлией как с уволенной.
 *
 * Эта проверка стережёт обе стороны правила, и обе важны:
 *
 * - **отзыв прав обязан работать.** Удалили строку, поставили Active=FALSE,
 *   понизили роль — при первом же удачном чтении это должно сработать. Ради
 *   этого перечитывание и заводилось;
 * - **но только когда мы ЗНАЕМ.** «Не смогли прочитать» ответом не является.
 *
 * Запуск: npx tsx scripts/check-auth-role.ts
 */
import { roleForToken, type RoleLookup } from "../src/lib/authRole";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${
      ok ? "" : ` (ждали ${JSON.stringify(expected)})`
    }`
  );
}

const accountant = { role: "accountant", farm: null, name: "Юлия" };
const found = (over: Partial<{ role: string; farm: string | null; name: string; active: boolean }>): RoleLookup => ({
  ok: true,
  user: { role: "accountant", farm: null, name: "Юлия", active: true, ...over },
});

// --- Таблица ответила: делаем, что она сказала ------------------------------

check("роль из таблицы попадает в пропуск", roleForToken(accountant, found({})), {
  role: "accountant",
  farm: null,
  name: "Юлия",
});
check(
  "повышение срабатывает",
  roleForToken(accountant, found({ role: "admin" })),
  { role: "admin", farm: null, name: "Юлия" }
);
check(
  "производство подхватывается",
  roleForToken({ role: "warehouse", farm: null, name: "Разия" }, found({ role: "warehouse", farm: "rose_farm", name: "Разия" })),
  { role: "warehouse", farm: "rose_farm", name: "Разия" }
);
check(
  "имя из таблицы важнее имени из Google",
  roleForToken({ role: "manager", farm: null, name: "Yerzhan S." }, found({ role: "manager", name: "Ержан" })).name,
  "Ержан"
);
check(
  "пустое имя в таблице прежнее не затирает",
  roleForToken({ role: "manager", farm: null, name: "Ержан" }, found({ role: "manager", name: "" })).name,
  "Ержан"
);

// --- Отзыв прав обязан работать --------------------------------------------

check(
  "строку удалили — прав нет",
  roleForToken(accountant, { ok: true, user: null }),
  { role: undefined, farm: null, name: "Юлия" }
);
check(
  "Active=FALSE — прав нет",
  roleForToken(accountant, found({ active: false })),
  { role: undefined, farm: null, name: "Юлия" }
);
check(
  "пустая роль в таблице — прав нет (грабли 1.10)",
  roleForToken(accountant, found({ role: "" })).role,
  ""
);

// --- А неответ таблицы прав не отнимает -------------------------------------
//
// Ровно тот случай, который и увидел владелец. Разница между «нет такого
// сотрудника» и «не удалось спросить» — это разница между уволенным и живым
// человеком, у которого посреди рабочего дня пропали все кнопки.

const unchanged = roleForToken(accountant, { ok: false });
check("таблица не ответила — роль осталась", unchanged, accountant);
check(
  "и у зав. складом производство тоже осталось",
  roleForToken({ role: "warehouse", farm: "esentai", name: "Диана" }, { ok: false }),
  { role: "warehouse", farm: "esentai", name: "Диана" }
);
check(
  "неответ не даёт прав тому, у кого их не было",
  roleForToken({ role: undefined, farm: null, name: "Кто-то" }, { ok: false }).role,
  undefined
);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
