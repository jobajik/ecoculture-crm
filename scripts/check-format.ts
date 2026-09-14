/**
 * Как числа и имена показываются человеку.
 *
 * Проверка мелкая, но нужная: оба правила — про то, что читает глаз, и оба уже
 * расходились по сайту. Дробные числа писались то через точку, то через
 * запятую («25.8 %» рядом с «5,6 дн.»), а в колонке «Менеджер» стоял почтовый
 * адрес вместо фамилии.
 */
import { decimal, percent, shortMoney } from "../src/lib/formatNumber";
import { nameIndex, personName } from "../src/lib/personName";

let fails = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails += 1;
  console.log(
    `${ok ? "OK  " : "ПЛОХО"} ${name}: ${JSON.stringify(actual)}${
      ok ? "" : ` (ждали ${JSON.stringify(expected)})`
    }`
  );
}

// --- Дробные числа ---------------------------------------------------------
check("дробное пишется через запятую", decimal(25.8), "25,8");
check("целое остаётся целым, без хвоста", decimal(7), "7");
check("нулевой хвост отбрасывается", decimal(7.04), "7");
check("округление вверх", decimal(1.25), "1,3");
check("отрицательное не ломается", decimal(-0.5), "-0,5");
check("не-число даёт прочерк, а не NaN", decimal(Number.NaN), "—");

check("процент с неразрывным пробелом", percent(25.84), "25,8 %");
check("целый процент без хвоста", percent(30), "30 %");

check("миллионы коротко", shortMoney(1_262_500), "1,3 млн ₸");
check("тысячи коротко", shortMoney(208_000), "208 тыс ₸");
check("мелочь целиком", shortMoney(950), "950 ₸");
check("ровный миллион без хвоста", shortMoney(2_000_000), "2 млн ₸");

// --- Имена -----------------------------------------------------------------
const users = [
  { email: "Rop@Ecoculture.kz", name: "Марат Оспанов" },
  { email: "emil@ecoculture.kz", name: "  " }, // имя в таблице не заполнено
  { email: "", name: "Никто" },
];
const names = nameIndex(users);

check("имя находится независимо от регистра почты", personName("rop@ecoculture.kz", names), "Марат Оспанов");
check("почта в другом регистре тоже находит имя", personName("ROP@ECOCULTURE.KZ", names), "Марат Оспанов");
check(
  "без имени показываем почту, а не выдумываем имя",
  personName("emil@ecoculture.kz", names),
  "emil@ecoculture.kz"
);
check("незнакомая почта показывается как есть", personName("kto@to.kz", names), "kto@to.kz");
check("пустая почта — прочерк", personName("", names), "—");
check("пустая строка в Users в список не попадает", Object.keys(names), ["rop@ecoculture.kz"]);

console.log(fails === 0 ? "\nВсе проверки прошли." : `\nПровалено: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
