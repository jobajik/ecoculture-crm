/*
 * Текст голосового предложения (16.11.2026): собирается кодом из склада и прайса и пишется «для уха».
 * Стережём: цены и наличие только из данных; чего мало или без цены — не предлагаем; латиницы и значков в тексте нет;
 * подпись к тесту честно говорит, что голос сгенерирован и это не голос сотрудника.
 *
 * Запуск: npx tsx scripts/check-voice-offer.ts
 */
import { pickVoiceOffers, voiceOfferText, voiceTestNote } from "../src/lib/voiceOffer";

let fails = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
}
const row = (flower: string, variety: string, grade: string, qty: number, price: number) => ({ flower, variety, grade, qty, price });
const stock = [
  row("chrysanthemum", "Altaj", "Вторая", 900, 400),
  row("chrysanthemum", "Altaj", "Третья", 1500, 270),
  row("chrysanthemum", "Altaj", "Четвёртая", 300, 180),
  row("chrysanthemum", "Altaj", "Высшая", 60, 630), // мало
  row("chrysanthemum_rf", "Bacardi", "Вторая", 200, 380),
  row("rose", "Jumilia", "60", 800, 235),
  row("rose", "Jana", "60", 300, 410),
  row("rose", "Jumilia", "50", 400, 200),
  row("rose", "Anna Karina", "70", 5000, 0), // без цены
  row("eustoma", "Alissa Pink", "Стандарт", 700, 400),
];
const lines = pickVoiceOffers(stock);
check("хризантема: сорт с самым большим запасом, две категории, дороже первой", lines[0]?.text, "хризантема Алтай: вторая категория по 400 тенге за стебель, третья категория по 270 тенге за стебель");
check("роза: длина с самым большим запасом, цена «от»", lines[1]?.text, "роза 60 сантиметров от 235 тенге за стебель");
check("позиция без цены не предлагается, даже если её много", lines.some((l) => l.text.includes("70 сантиметров")), false);
check("одна цена у длины — «по», а не «от»", pickVoiceOffers([row("rose", "Jumilia", "60", 800, 235)])[0]?.text, "роза 60 сантиметров по 235 тенге за стебель");
check("незнакомый сорт вслух не называем", pickVoiceOffers([row("chrysanthemum", "Zembla Lime", "Первая", 500, 580)])[0]?.text, "хризантема: первая категория по 580 тенге за стебель");
check("мало на складе — не предлагаем", pickVoiceOffers([row("chrysanthemum", "Altaj", "Вторая", 40, 400)]), []);
const text = voiceOfferText(lines);
check("текст целиком", text, "Здравствуйте! Это Экокультура, свежий срез из нашей теплицы. Сегодня есть хризантема Алтай: вторая категория по 400 тенге за стебель, третья категория по 270 тенге за стебель. И роза 60 сантиметров от 235 тенге за стебель. Сколько вам поставить на завтра? Напишите количество, и мы оформим заявку.");
check("для уха: без латиницы и значков", /[A-Za-z₸•*№]/.test(text), false);
check("нечего предлагать — текста нет", voiceOfferText([]), "");
const note = voiceTestNote(text);
check("подпись честная: сгенерирован, не Эмиль, не живая запись", [note.includes("сгенерирован ИИ"), note.includes("не голос Эмиля"), note.includes("не живая запись")], [true, true, true]);

console.log(fails ? `\nНЕ ПРОШЛО: ${fails}` : "\nВсе проверки прошли.");
process.exit(fails ? 1 : 0);
