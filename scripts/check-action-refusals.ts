/*
 * Отказы сервера должны доходить до человека.
 *
 * Владелец прислал снимок экрана: менеджер сохраняет карточку клиента и видит
 * абзац по-английски — «An error occurred in the Server Components render…».
 * Оказалось, что Next.js в БОЕВОЙ сборке подменяет текст любой ошибки,
 * брошенной из серверного действия. Все понятные запреты программы —
 * «Это клиент другого менеджера», «в партии осталось 200» — до людей не
 * доходили НИКОГДА. На моём компьютере сборка отладочная, там текст доходит
 * целиком, поэтому я этого не видел много недель.
 *
 * Лечение: отказ не бросают, а ВОЗВРАЩАЮТ (`guard`), и в браузере превращают
 * обратно в ошибку с тем же текстом (`unwrap`).
 *
 * Эта проверка стережёт обе половины правила, потому что забыть любую легко, а
 * последствия разные и обе скверные:
 *
 * - забыли `guard` у действия — вернулась английская заглушка, как было;
 * - забыли `unwrap` у вызова — форма примет ОТКАЗ ЗА УСПЕХ: закроется,
 *   покажет «сохранено», а в таблице ничего не изменится. Это хуже заглушки:
 *   заглушку видно, а молчаливую потерю правки — нет.
 *
 * Запуск: npx tsx scripts/check-action-refusals.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { guard, isRefusal, refusalOf, unwrap } from "../src/lib/actionResult";

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
function fail(line: string) {
  fails++;
  console.log(`FAIL ${line}`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

// --- Сама механика ---------------------------------------------------------

check("отказ узнаётся", isRefusal({ __serverRefusal: "нельзя" }), true);
check("обычный ответ не отказ", isRefusal({ ok: true }), false);
check("пусто не отказ", isRefusal(null), false);
check("строка не отказ", isRefusal("нельзя"), false);

check("текст ошибки сохраняется", refusalOf(new Error("Это клиент другого менеджера")), {
  __serverRefusal: "Это клиент другого менеджера",
});
check("пустая ошибка получает человеческий текст", isRefusal(refusalOf(new Error("   "))), true);
check("не-ошибка тоже становится отказом", isRefusal(refusalOf("что-то")), true);

// Служебные ошибки Next.js (переход, «не найдено») ловить нельзя: поймав, мы
// отменим переход, и человек останется на странице, думая, что ничего не было.
const redirectError = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/orders" });
let rethrown = false;
try {
  refusalOf(redirectError);
} catch (e) {
  rethrown = e === redirectError;
}
check("переход Next.js пропускается дальше", rethrown, true);

async function mechanics() {
  check("успех проходит насквозь", await guard(async () => 42), 42);
  const refused = await guard(async () => {
    throw new Error("в партии осталось 200");
  });
  check("отказ возвращается, а не бросается", refused, { __serverRefusal: "в партии осталось 200" });

  check("unwrap пропускает успех", unwrap(42), 42);
  let message = "";
  try {
    unwrap(refused);
  } catch (e) {
    message = e instanceof Error ? e.message : String(e);
  }
  check("unwrap возвращает ТОТ ЖЕ текст", message, "в партии осталось 200");
}

// --- Каждое действие обёрнуто ----------------------------------------------

const actionFiles = walk("src/app").filter((p) => p.endsWith("actions.ts"));
check("файлы действий найдены", actionFiles.length > 0, true);

const actionNames = new Set<string>();
for (const path of actionFiles) {
  const src = readFileSync(path, "utf-8");
  const exported = [...src.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]);
  for (const name of exported) {
    actionNames.add(name);
    // Экспортируемое наружу действие обязано быть тонкой обёрткой над работой.
    const wrapper = new RegExp(
      `export async function ${name}\\([^)]*\\)\\s*\\{\\s*return guard\\(\\(\\) => ${name}Inner\\(`
    );
    if (!wrapper.test(src)) {
      fail(`${path}: действие ${name} не обёрнуто guard() — отказ уйдёт заглушкой Next.js`);
    }
  }
}
console.log(`OK   действий под guard(): ${actionNames.size}`);

// --- Каждый вызов в браузере обёрнут ---------------------------------------

const viewFiles = [...walk("src/components"), ...walk("src/app")].filter((p) => p.endsWith(".tsx"));
let calls = 0;
for (const path of viewFiles) {
  const src = readFileSync(path, "utf-8");
  for (const name of actionNames) {
    const pattern = new RegExp(`(unwrap\\(\\s*)?await ${name}\\(`, "g");
    for (const m of src.matchAll(pattern)) {
      calls++;
      if (!m[1]) {
        const line = src.slice(0, m.index ?? 0).split("\n").length;
        fail(
          `${path}:${line}: вызов ${name} без unwrap() — форма примет отказ за успех и молча закроется`
        );
      }
    }
  }
}
console.log(`OK   вызовов под unwrap(): ${calls}`);

mechanics().then(() => {
  console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
});
