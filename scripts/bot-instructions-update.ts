import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Правка указаний бота (настройка BotInstructions) по живым разговорам. Меняет
 * только перечисленные строки, остальное — как написал владелец. Повторный
 * запуск ничего не дублирует: строка, которой уже нет, просто пропускается.
 * Без --yes — показ.
 *
 * 02.10.2026, вторая правка. Владелец: «не нравится, что ты задаёшь много
 * вопросов и пишешь одинаковые сообщения — будь человечнее и отправляй фотку».
 * Указания владельца стоят выше общих правил, а в них было «каждое сообщение
 * заканчивай вопросом — чаще всего «Оформляю?»» — отсюда одинаковые хвосты.
 * (Первая правка того же дня — коробка хризантемы третьей = 200 шт. и пункт
 * «0. ГЛАВНОЕ» — уже в таблице.)
 *
 *   npx tsx scripts/bot-instructions-update.ts [--yes]
 */
import { settingsMap } from "../src/lib/repo/broadcasts";
import { saveSettings } from "../src/lib/repo/settings";

const EDITS: [RegExp, string][] = [
  [
    /^- Каждое сообщение заканчивай одним простым вопросом.*$/m,
    "- Пиши каждый раз по-новому, не повторяй уже сказанное. Вопрос — не больше одного и только когда без него никак.",
  ],
  [/сумма, день — и «Оформляю\?»\./, "сумма, день — и сразу оформляй, без «Оформляю?»."],
  [
    /^5\. Закрой сделку: повтори заказ с суммой и спроси «Оформляю\?»\. После «да» — оформляй\.\s*$/m,
    "5. Закрой сделку: позиция и количество названы — оформляй сразу.",
  ],
  [
    /^- Просят каталог или фото — система сама пришлёт.*$/m,
    "- Фото позиции, о которой говоришь, и каталог система пришлёт сама — не обещай их.",
  ],
];

async function main() {
  const map = await settingsMap(true);
  const before = map.BotInstructions || "";
  let after = before;
  for (const [re, text] of EDITS) {
    if (!re.test(after)) console.log(`не нашёл (уже поправлено?): ${re}`);
    after = after.replace(re, text);
  }
  // Форма «Бот» хранит не больше 4000 знаков — длиннее обрежется при следующем сохранении.
  if (after.length > 4000) throw new Error(`длиннее 4000 знаков: ${after.length}`);
  console.log(`было ${before.length} знаков, стало ${after.length}\n---NEW---\n${after}\n---END---`);
  if (!process.argv.includes("--yes")) return console.log("Только показ.");
  if (after === before) return console.log("Менять нечего.");
  await saveSettings({ BotInstructions: after });
  console.log("Сохранено.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
