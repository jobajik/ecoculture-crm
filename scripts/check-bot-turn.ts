/**
 * Ход бота в переписке (`src/lib/botTurn.ts`) и план срезки для бота (`harvestForBot`).
 *   npx tsx scripts/check-bot-turn.ts
 */
import {
  mergeChatMemory,
  missingIncoming,
  repeatsOurMessage,
  supersededBy,
  withMissingIncoming,
  type TurnMessage,
} from "../src/lib/botTurn";
import { harvestForBot } from "../src/lib/botKnowledge";
import { emptyBotChat } from "../src/lib/repo/broadcasts";
import type { BotChat } from "../src/lib/broadcast";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`${ok ? "✓" : "✗"} ${name}`);
  if (!ok) failed++;
}

const PHONE = "77475415272";
const offer = "Роза Jumilia, 40 см сейчас есть около 100 шт. Поставить 100?";
const ctx: BotChat["context"] = [
  { role: "client", text: "Мне нужно на Караганду 3000 Джамили красное и белые по тыщу штук", at: "2026-10-08T16:50:57.000Z" },
  { role: "us", text: offer, at: "2026-10-08T16:51:02.000Z" },
  { role: "client", text: "Блин зачем мне 100 штук что я ими буду делать мне 1000 надо", at: "2026-10-08T16:51:21.000Z" },
];

// --- повтор
check("живой случай: тот же текст — повтор", repeatsOurMessage(offer, ctx));
check("тот же текст с другими знаками — повтор", repeatsOurMessage("роза jumilia 40 см — сейчас есть около 100 шт, поставить 100", ctx));
check(
  "другое предложение — не повтор",
  !repeatsOurMessage("Jumilia 40 см только около 100, но 60 см — около 1 000 шт. по 220 ₸. Ставим 1000 шестидесятки?", ctx)
);
check("короткое «Хорошо, оформляю» — не повтор", !repeatsOurMessage("Хорошо, оформляю", [...ctx, { role: "us", text: "Хорошо, оформляю", at: "x" }]));
check("повтор только НАШЕГО сообщения, не клиента", !repeatsOurMessage(ctx[0].text, [ctx[0]]));

// --- серия сообщений
const m = (id: string, at: string, text: string, type = "text"): TurnMessage => ({ messageId: id, phone: PHONE, direction: "in", at, text, type });
const julia = m("A", "2026-10-08T16:49:28.000Z", "Нет сорта Джулия красные есть эти сорта");
const white = m("B", "2026-10-08T16:49:32.000Z", "Белая");
check("«Белая» через 4 с забирает ответ у первого", supersededBy(julia, [julia, white], PHONE)?.messageId === "B");
check("последнее сообщение не перекрыто", supersededBy(white, [julia, white], PHONE) === null);
const blin = m("C", "2026-10-08T16:51:21.000Z", "Блин зачем мне 100 штук мне 1000 надо");
const smile = m("D", "2026-10-08T16:51:25.000Z", "😅");
check("смайлик после — ответ НЕ забирает", supersededBy(blin, [blin, smile], PHONE) === null);
check("голосовое после — забирает", supersededBy(blin, [blin, m("E", "2026-10-08T16:51:30.000Z", "", "audio")], PHONE)?.messageId === "E");
check("чужой номер не в счёт", supersededBy(blin, [blin, { ...white, phone: "77010000000", at: "2026-10-08T16:52:00.000Z" }], PHONE) === null);
check("наше исходящее не в счёт", supersededBy(blin, [blin, { ...white, direction: "out", at: "2026-10-08T16:52:00.000Z" }], PHONE) === null);

// --- недостающие входящие
const now = new Date("2026-10-08T16:49:40.000Z");
const memWhite: BotChat["context"] = [
  { role: "us", text: "Да, роза есть…", at: "2026-10-08T16:49:03.000Z" },
  { role: "client", text: "Белая", at: "2026-10-08T16:49:32.000Z" },
];
const miss = missingIncoming(memWhite, [julia, white], PHONE, now);
check("ход «Белой» находит «Нет сорта Джулия…»", miss.length === 1 && miss[0].messageId === "A");
const merged = withMissingIncoming(memWhite, miss);
check("и ставит его по времени перед «Белой»", merged.map((c) => c.text).join("|") === "Да, роза есть…|Нет сорта Джулия красные есть эти сорта|Белая");
check(
  "голосовое: в памяти «[audio]», в таблице расшифровка — не дубль",
  missingIncoming([{ role: "client", text: "[audio]", at: "2026-10-08T16:49:28.400Z" }], [{ ...julia, type: "audio" }], PHONE, now).length === 0
);
check("старше окна — не берём", missingIncoming([], [julia], PHONE, new Date("2026-10-08T18:00:00.000Z")).length === 0);

// --- объединение памяти двух ходов
const base = emptyBotChat(PHONE);
const a: BotChat = { ...base, context: [...ctx, { role: "us", text: "Jumilia 60 см — около 1 000", at: "2026-10-08T16:51:27.000Z" }], ourIds: ["x1", "x2"], botReplies: 6 };
const b: BotChat = { ...base, context: [...ctx.slice(0, 2), { role: "client", text: "😅", at: "2026-10-08T16:51:25.000Z" }], ourIds: ["x1"], botReplies: 5 };
const mm = mergeChatMemory(b, a);
check("объединение сохраняет наш ответ соседнего хода", mm.context.some((c) => c.text.startsWith("Jumilia 60")));
check("и смайлик этого хода", mm.context.some((c) => c.text === "😅"));
check("строки не задвоены", mm.context.filter((c) => c.text === offer).length === 1);
check("по времени", mm.context.every((c, i, arr) => i === 0 || arr[i - 1].at <= c.at));
check("номера наших сообщений — обоих", mm.ourIds.includes("x2"));
check("счётчик ответов не уменьшился", mm.botReplies === 6);
check("без свежей строки — своё как есть", mergeChatMemory(b, null) === b);

// --- план срезки для бота
const rows = [
  { period: "2026-10-W2", flowerType: "rose", variety: "Jumilia", targetStems: 11389 },
  { period: "2026-10-W3", flowerType: "rose", variety: "Jumilia", targetStems: 11421 },
  { period: "2026-10-W5", flowerType: "rose", variety: "Jumilia", targetStems: 9206 },
  { period: "2026-10-W2", flowerType: "chrysanthemum", variety: "Altaj", targetStems: 950 },
  { period: "2026-10-W2", flowerType: "rose", variety: "Мелочь", targetStems: 50 },
];
const h = harvestForBot(rows, "2026-10-09");
console.log(h);
// 09.10 — пятница: от недели 5–11 октября осталось 2 дня из 7.
check("текущая неделя — только остаток: «до 11 октября» и 2/7 прогноза", h.includes("до 11 октября ~3 000"));
check("следующая неделя — целиком", h.includes("12–18 октября ~11 000"));
check("дальше двух недель — нет", !h.includes("~9 000"));
check("меньше сотни — не показываем", !h.includes("Мелочь"));
check("остаток недели — сотнями (950 × 2/7)", h.includes("Altaj: до 11 октября ~200"));
// 04.10 — воскресенье: неделя 5–11 октября впереди целиком.
const h2 = harvestForBot(rows, "2026-10-04");
check("неделя впереди — целиком, до тысячи сотнями", h2.includes("5–11 октября ~11 000") && h2.includes("Altaj: 5–11 октября ~900"));
check("в понедельник сегодняшний день не считается", harvestForBot(rows, "2026-10-05").includes("до 11 октября ~9 000"));
check("роза раньше хризантемы", h2.indexOf("Jumilia") < h2.indexOf("Altaj"));
check("в последний день недели её уже нет", !harvestForBot(rows, "2026-10-11").includes("октября ~11 000 · 12–18") && harvestForBot(rows, "2026-10-11").startsWith("Роза · Jumilia: 12–18 октября"));
check("пустой прогноз — пусто", harvestForBot([], "2026-10-09") === "");

if (failed) {
  console.log(`\nПровалено: ${failed}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
