/*
 * Экран ошибки: отличаем «страница из старой версии» от настоящей поломки.
 *
 * Цена ошибки здесь несимметрична, и поэтому проверка нужна.
 *
 * Если распознать СЛИШКОМ ШИРОКО — страница начнёт перезагружать сама себя на
 * любой поломке. Человек увидит мигающий экран и никогда не прочитает, что
 * случилось; настоящая ошибка станет невидимой. От этого же защищает пауза
 * между перезагрузками.
 *
 * Если распознать СЛИШКОМ УЗКО — вернётся то, с чего всё началось: белый экран
 * с английской надписью на телефоне у владельца, хотя лечится он одним
 * обновлением страницы.
 *
 * Запуск: npx tsx scripts/check-stale-version.ts
 */
import {
  RELOAD_COOLDOWN_MS,
  looksLikeStaleVersion,
  shouldAutoReload,
} from "../src/lib/staleVersion";

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

// --- Что считаем «старой версией» -------------------------------------------

const err = (message: string, name = "Error") => Object.assign(new Error(message), { name });

check("ChunkLoadError по имени", looksLikeStaleVersion(err("boom", "ChunkLoadError")), true);
check(
  "не загрузился кусок кода",
  looksLikeStaleVersion(err("Loading chunk 4821 failed. (missing: https://.../_next/static/...)")),
  true
);
check("не загрузился кусок стилей", looksLikeStaleVersion(err("Loading CSS chunk 12 failed")), true);
check(
  "Safari: модуль не подгрузился",
  looksLikeStaleVersion(err("Importing a module script failed.")),
  true
);
check(
  "Firefox: модуль не подгрузился",
  looksLikeStaleVersion(err("error loading dynamically imported module")),
  true
);
check(
  "Chrome: модуль не подгрузился",
  looksLikeStaleVersion(err("Failed to fetch dynamically imported module: https://...")),
  true
);
check(
  "вместо файла пришла страница с ошибкой",
  looksLikeStaleVersion(err("Unexpected token '<'")),
  true
);
check(
  "серверное действие из старой сборки",
  looksLikeStaleVersion(
    err("Failed to find Server Action '7f3a'. This request might be from an older deployment.")
  ),
  true
);

// --- Что НЕ считаем ---------------------------------------------------------

check(
  "обычная ошибка в коде — не старая версия",
  looksLikeStaleVersion(err("Cannot read properties of undefined (reading 'map')")),
  false
);
check(
  "отказ сервера по правам — не старая версия",
  looksLikeStaleVersion(err("Недостаточно прав: заявки создают менеджеры")),
  false
);
check("пустая ошибка — не старая версия", looksLikeStaleVersion(null), false);
check("ошибка без текста — не старая версия", looksLikeStaleVersion({}), false);
check("строка вместо ошибки тоже разбирается", looksLikeStaleVersion("ChunkLoadError: ..."), true);
check(
  "смотрим и в digest — серверная ошибка приходит только с ним",
  looksLikeStaleVersion({ digest: "ChunkLoadError" }),
  true
);

// --- Защита от кольца перезагрузок ------------------------------------------

const NOW = 1_000_000;
check("первый раз перезагружаемся", shouldAutoReload(null, NOW), true);
check(
  "сразу второй раз — нет, иначе экран будет мигать",
  shouldAutoReload(NOW - 1000, NOW),
  false
);
check(
  "ровно на границе паузы — ещё нет",
  shouldAutoReload(NOW - RELOAD_COOLDOWN_MS, NOW),
  false
);
check(
  "после паузы — можно снова",
  shouldAutoReload(NOW - RELOAD_COOLDOWN_MS - 1, NOW),
  true
);

console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено проверок: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
