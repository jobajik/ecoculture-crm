/*
 * Ищет вызовы функций из клиентских модулей на сервере.
 *
 * Отрисовать компонент с «use client» со страницы-сервера можно — это обычное
 * дело. А вот ИМПОРТИРОВАТЬ ЗНАЧЕНИЕ (функцию, константу) из такого файла в
 * серверный нельзя: сервер получает не саму функцию, а заглушку-ссылку на
 * клиентский модуль, и вызов падает с «TypeError: x is not a function».
 *
 * Коварство в том, что сборка проходит, типы сходятся, страница открывается —
 * и падает только тогда, когда до этой строки дойдёт выполнение. У нас так
 * ломалось дважды за один день (forecastCellKey, planCellKey), причём во второй
 * раз — уже после того, как правило было записано в CLAUDE.md. Правило в
 * документации не работает; работает проверка.
 *
 * Что разрешено:
 *   import Foo from "@/components/Foo"          — импорт по умолчанию (сам компонент)
 *   import { type Bar } from "@/components/Foo" — типы, они стираются при сборке
 * Что запрещено:
 *   import { helper } from "@/components/Foo"   — значение из клиентского модуля
 *
 * Запуск: npx tsx scripts/check-client-imports.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";

const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const source = new Map<string, string>();
for (const file of files) source.set(file, readFileSync(file, "utf8"));

const isClient = (file: string) => {
  const text = source.get(file) ?? "";
  // Директива должна стоять в самом начале файла.
  return /^\s*["']use client["']/.test(text);
};

/** Приводит путь из импорта к файлу на диске. */
function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (source.has(candidate)) return candidate;
  }
  return null;
}

const problems: string[] = [];

for (const file of files) {
  if (isClient(file)) continue; // серверные файлы и общие модули
  const text = source.get(file) ?? "";

  // import { ... } from "..." — с фигурными скобками, то есть именованный импорт.
  const re = /import\s+([^;]*?)\s+from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const clause = match[1];
    const spec = match[2];

    const braces = clause.match(/\{([^}]*)\}/);
    if (!braces) continue; // только default-импорт — это законно

    const target = resolveImport(file, spec);
    if (!target || !isClient(target)) continue;

    // Разбираем то, что в скобках: `type Foo`, `Foo as Bar`, `Foo`.
    const named = braces[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      // Импорт целиком помечен как типовой — тоже безопасно.
      .filter(() => !/^\s*import\s+type/.test(match![0]))
      .filter((s) => !s.startsWith("type "));

    if (named.length > 0) {
      problems.push(
        `${relative(ROOT, file)} импортирует значение { ${named.join(", ")} } ` +
          `из клиентского модуля ${relative(ROOT, target)}`
      );
    }
  }
}

if (problems.length === 0) {
  console.log(`Проверено файлов: ${files.length}. Клиентских: ${files.filter(isClient).length}.`);
  console.log("\nВсе проверки прошли.");
  process.exit(0);
}

console.log("Найдены вызовы клиентского кода на сервере:\n");
for (const p of problems) console.log(`FAIL ${p}`);
console.log(
  "\nПеренесите общую функцию в обычный модуль в src/lib/ (как forecastCell.ts, planCell.ts)."
);
console.log(`\nПровалено: ${problems.length}`);
process.exit(1);
