/*
 * Диагностика: почему сотрудник не может войти на сайт.
 *
 * Скрипт НИЧЕГО НЕ МЕНЯЕТ. Он читает вкладку Users и по каждому сотруднику
 * отвечает ровно на тот вопрос, который задаёт программа при входе: пустит или
 * не пустит, и если нет — почему.
 *
 * Смотреть глазами на вкладку тут плохо помогает, потому что все три причины
 * НЕВИДИМЫЕ:
 *
 * - **лишний пробел или заглавная буква в почте.** Вход сверяет почту Google
 *   с ячейкой, приведя обе к нижнему регистру и обрезав пробелы по краям, — но
 *   пробел ВНУТРИ или похожая буква из другого алфавита (латинская `a` вместо
 *   русской, `о` вместо `o`) делают строки разными, а на вид они одинаковые.
 *   Поэтому почта печатается в кавычках, а подозрительные буквы — отдельной
 *   строкой;
 * - **пустая колонка Role.** Роли по умолчанию нет (грабли 1.10): пустая
 *   ячейка не пускает никуда. На вид строка заполнена — имя и почта на месте;
 * - **опечатка в самой роли.** «manger», «Менеджер», «manager » — всё это не
 *   роль, и человек с ней не войдёт.
 *
 * Плюс колонка Farm: у зав. складом и агронома без неё действия отказывают, и
 * выглядит это как «сайт не работает», хотя войти человек смог.
 *
 * Запуск:
 *   npx tsx scripts/diag-login.ts             — все сотрудники
 *   npx tsx scripts/diag-login.ts саят        — только те, у кого это в имени
 *                                               или почте
 */
import * as dotenv from "dotenv";

// Ключи доступа лежат в .env.local и должны подтянуться ДО первого обращения
// к таблице — поэтому загрузка стоит выше импортов, работающих с Google.
dotenv.config({ path: ".env.local" });
dotenv.config();

import { readTable, rowToRecord } from "../src/lib/sheets";
import { SHEET_TABS, ROLES, ROLE_LABELS, isFarmBoundRole, farmLabel } from "../src/lib/constants";

const KNOWN_ROLES: string[] = Object.values(ROLES);

/** Буквы, которые выглядят одинаково в латинице и кириллице. */
const LOOKALIKE = "аеорсхукАЕОРСХУКABCEHKMOPTXaceopxy";

function suspiciousLetters(text: string): string[] {
  const found = new Set<string>();
  for (const ch of text) {
    if (LOOKALIKE.includes(ch)) {
      const cyrillic = /[А-Яа-яЁё]/.test(ch);
      found.add(`${ch} (${cyrillic ? "русская" : "латинская"})`);
    }
  }
  return [...found];
}

async function main() {
  const needle = (process.argv[2] || "").trim().toLowerCase();
  const table = await readTable(SHEET_TABS.USERS);

  console.log(`Строк на вкладке Users: ${table.rows.length}`);
  console.log("");

  let shown = 0;
  table.rows.forEach((row, i) => {
    const record = rowToRecord(SHEET_TABS.USERS, row);
    const rawEmail = record.Email ?? "";
    const rawRole = record.Role ?? "";
    const rawActive = record.Active ?? "";
    const rawFarm = record.Farm ?? "";
    const name = record.Name ?? "";

    if (needle && !`${name} ${rawEmail}`.toLowerCase().includes(needle)) return;
    shown += 1;

    const email = rawEmail.trim().toLowerCase();
    const role = rawRole.trim();
    const active = !["FALSE", "НЕТ", "NO", "0", "-", "N", "Н"].includes(
      rawActive.trim().toUpperCase()
    );

    const problems: string[] = [];
    if (!email) problems.push("почта не заполнена — войти нельзя");
    if (rawEmail !== rawEmail.trim()) problems.push("в почте пробел по краям (сам по себе не мешает, но подозрительно)");
    if (/\s/.test(email)) problems.push("ВНУТРИ почты есть пробел — вход не сработает");
    if (rawEmail !== rawEmail.toLowerCase()) problems.push("в почте заглавные буквы (вход это переживёт)");
    if (!role) problems.push("КОЛОНКА Role ПУСТАЯ — программа не пускает никуда (грабли 1.10)");
    else if (!KNOWN_ROLES.includes(role)) {
      problems.push(`роль «${role}» неизвестна — допустимые: ${KNOWN_ROLES.join(", ")}`);
    }
    if (!active) problems.push(`в колонке Active стоит «${rawActive}» — доступ закрыт`);
    if (role && KNOWN_ROLES.includes(role) && isFarmBoundRole(role) && !rawFarm.trim()) {
      problems.push("КОЛОНКА Farm ПУСТАЯ — войти он сможет, но его действия будут отказывать");
    }

    const letters = suspiciousLetters(rawEmail);

    console.log(`Строка ${table.rowNumbers[i]} — ${name || "(без имени)"}`);
    console.log(`    почта:  "${rawEmail}"`);
    console.log(
      `    роль:   "${rawRole}"${
        role && KNOWN_ROLES.includes(role) ? ` (${ROLE_LABELS[role] ?? role})` : ""
      }`
    );
    console.log(`    Active: "${rawActive}"`);
    console.log(
      `    Farm:   "${rawFarm}"${rawFarm.trim() ? ` (${farmLabel(rawFarm.trim().toLowerCase())})` : ""}`
    );
    if (letters.length > 0) {
      console.log(`    буквы-двойники в почте: ${letters.join(", ")}`);
      console.log("      (проверьте, что почта набрана латиницей целиком)");
    }
    if (problems.length === 0) {
      console.log("    ВОЙДЁТ");
    } else {
      console.log("    НЕ ВОЙДЁТ или будет работать неправильно:");
      for (const p of problems) console.log(`      - ${p}`);
    }
    console.log("");
  });

  if (shown === 0) {
    console.log(`По запросу «${needle}» никого не нашлось.`);
    console.log("Скорее всего, строки этого сотрудника на вкладке Users просто НЕТ —");
    console.log("тогда Google пустит его к себе, а сайт ответит «нет доступа».");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
