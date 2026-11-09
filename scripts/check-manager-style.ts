/**
 * Проверка почерка менеджеров и аналитики постоянников (`managerStyle.ts`, `habitsAnalytics.ts`): профиль по текстам,
 * фильтр чисел в тексте модели, режим по заголовку, подсчёт отправлено/ответили/заказали.
 *   npx tsx scripts/check-manager-style.ts
 */
import { allowedNumbers, buildStyleProfile, habitTaskLines, isOwnManagerMessage, parseStyleProfile, stylePromptBlock, styleUsable, styledTextOk } from "../src/lib/managerStyle";
import { habitModeOfTitle, habitsAnalytics, habitsDigestLine } from "../src/lib/habitsAnalytics";
import { habitModeOf, habitTitle } from "../src/lib/clientHabitsRunner";
import type { WaMessage } from "../src/lib/types";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (ждали ${JSON.stringify(want)})`}`);
};

// --- Профиль ---
const ilyas = [
  "Добрый день Елена!\nНа сегодня",
  "Алтай 3 кат 200",
  "Привет Катя. Ок",
  "Ок",
  "Добрый день Дмитрий, как дела, как торговля?",
  "Салем Акмарал\nКызыл 90 шт",
  "Асем, на завтра только розовые 70 см эустома будет",
  "Анеля чек отправьте пож-та",
  "По городу мотаюсь. Утром у тебя заказ будет до 8 00👍",
  "Доброе утро коллеги! Принимаем заказы на сегодня. Алтай 3 кат 270 тг, минимикс 150 тг",
  "Жаксы",
  "Рахмет",
];
const p = buildStyleProfile(ilyas, "2026-11-09T05:00:00Z");
check("профиль: сообщений", p.messages, 12);
check("профиль: без точки в конце — большинство", p.pctNoFinalDot >= 70, true);
check("профиль: категория — «кат»", p.gradeWord, "кат");
check("профиль: цена — «тг»", p.priceWord, "тг");
check("профиль: имя после приветствия", p.nameFirst, false);
check("профиль: казахский замечен", p.pctKazakh > 0, true);
check("профиль: примеры без коротких «Ок»", p.samples.includes("Ок"), false);
check("профиль: мало сообщений — ненадёжен", styleUsable(p), false);
const big = buildStyleProfile(Array.from({ length: 60 }, (_, i) => `${ilyas[i % ilyas.length]} ${i}`));
check("профиль: 60 сообщений — надёжен", styleUsable(big), true);
check("профиль: разбор того, что сохранили", parseStyleProfile(JSON.stringify(big))?.messages, 60);
check("профиль: мусор не разбирается", parseStyleProfile("{\"x\":1}"), null);
const emil = buildStyleProfile(["Фарида добрый день", "Сабина добрый день", "Вам хризантема нужна?", "3 сорт жаксы,свежий", "Вы оплатили?", "Дана добрый день"]);
check("профиль Эмиля: имя перед приветствием", emil.nameFirst, true);
check("профиль Эмиля: «сорт»", emil.gradeWord, "сорт");
const block = stylePromptBlock(big, "Ильяс");
check("подсказка: от имени менеджера и с примерами", [block[0].includes("Ильяс"), block.some((l) => l.includes("›"))], [true, true]);

// --- Своё сообщение менеджера ---
const msg = (over: Partial<WaMessage>): WaMessage => ({ messageId: "m1", at: "2026-11-01T05:00:00Z", chatId: "", phone: "77010000001", direction: "out", type: "text", text: "Привет", mediaUrl: "", senderName: "", source: "webhook", line: "m-x", ...over });
const ctx = { autoIds: new Set(["ai1"]), broadcastIds: new Set(["bc1"]), staffKeys: new Set(["7700000000"]), keyOf: (p: string) => p.slice(-10) };
check("своё: обычное исходящее — да", isOwnManagerMessage(msg({}), ctx), true);
check("своё: ответ помощника — нет", isOwnManagerMessage(msg({ messageId: "ai1" }), ctx), false);
check("своё: рассылка — нет", isOwnManagerMessage(msg({ messageId: "bc1" }), ctx), false);
check("своё: сотруднику — нет", isOwnManagerMessage(msg({ phone: "77700000000" }), ctx), false);
check("своё: входящее — нет", isOwnManagerMessage(msg({ direction: "in" }), ctx), false);

// --- Числа в тексте модели ---
const allowed = allowedNumbers({ prices: [270, 400], qtys: [200, 100] });
check("числа: цены и количества разрешены", styledTextOk("Привет Катя\nАлтай 3 кат 270 тг, как обычно 200 шт ставить?", allowed).ok, true);
check("числа: выдуманная цена — нет", styledTextOk("Алтай 3 кат 250 тг, 200 шт?", allowed).why, "число 250 не из данных");
check("числа: время не число", styledTextOk("Заберёте до 18:00? Алтай 270", allowed).ok, true);
check("числа: дата не число", styledTextOk("Фура 12.11, Алтай 270 тг", allowed).ok, true);
check("числа: длинное тире — нет", styledTextOk("Алтай — 270", allowed).why, "длинное тире");
check("числа: ссылка — нет", styledTextOk("Оплатите https://pay.kaspi.kz/pay/x", allowed).why, "ссылка");
check("числа: телефон — нет", styledTextOk("Пишите на +7 701 555 20 30", allowed).why, "похоже на номер телефона");
check("числа: слишком длинно — нет", styledTextOk("а".repeat(400), allowed).why, "длиннее 380");
check("числа: «2 кат» и «60 см» без данных — можно", styledTextOk("Есть 2 кат и 60 см", allowedNumbers({})).ok, true);

// --- Задание модели ---
const task = habitTaskLines({ mode: "overdue", clientName: "Елена", kazakh: false, usual: [{ label: "Хризантема Altaj, Третья", qty: 200, price: 270, stock: 500 }, { label: "Роза Revival, 60 см", qty: 30, price: 0, stock: 100 }], lateDays: 8, gapDays: 7 });
check("задание: позиция без цены не предлагается", task.some((l) => l.includes("Revival")), false);
check("задание: повод «молчит»", task.some((l) => l.includes("8 дн. дольше")), true);

// --- Заголовки и режимы ---
check("заголовок: день", habitTitle("Ильяс", "weekly", "2026-11-10"), "Постоянным · Ильяс · день · 10.11");
check("режим по заголовку: молчат", [habitModeOf("Постоянным · Эмиль · молчат · 10.11"), habitModeOfTitle("Постоянным · Эмиль · по просьбе · 10.11"), habitModeOf("Авто · Дожим лидов")], ["overdue", "command", null]);

// --- Аналитика ---
const bc = (id: string, title: string, line = "m-ilyas") => ({ broadcastId: id, createdAt: "2026-11-10T04:00:00Z", createdByEmail: "habits", title, text: "t", fileId: "", fileName: "", status: "done", audience: "", startedAt: "", finishedAt: "", lastSendAt: "", updatedAt: "", note: "", line, auto: "habits", plannedFor: "2026-11-10" });
const rec = (bcId: string, phone: string, refId: string, status: string, sentAt: string, messageId: string) => ({ broadcastId: bcId, phone, name: "К", kind: "client", refId, managerEmail: "ilyas@x", status, messageId, sentAt, error: "", text: "личный" });
const res = habitsAnalytics({
  broadcasts: [bc("B1", "Постоянным · Ильяс · день · 10.11"), bc("B2", "Постоянным · Ильяс · молчат · 10.11"), { ...bc("B3", "Авто · Свежий срез"), auto: "fresh" }],
  recipients: [
    rec("B1", "77010000001", "C1", "sent", "2026-11-10T05:00:00Z", "w1"),
    rec("B1", "77010000002", "C2", "sent", "2026-11-10T05:01:00Z", "w2"),
    rec("B2", "77010000003", "C3", "queued", "", ""),
    rec("B3", "77010000004", "C4", "sent", "2026-11-10T05:02:00Z", "w4"),
  ],
  statuses: new Map([
    ["w1", { status: "read", error: "" }],
    ["w2", { status: "delivered", error: "" }],
  ]),
  messages: [{ messageId: "in1", at: "2026-11-10T06:00:00Z", chatId: "", phone: "77010000001", direction: "in", type: "text", text: "Да, ставьте 200", mediaUrl: "", senderName: "", source: "webhook", line: "m-ilyas" }],
  orders: [
    { orderId: "O1", createdAt: "2026-11-10T07:00:00Z", clientId: "C1", clientPhone: "+77010000001", status: "confirmed", totalAmount: 54000 } as never,
    { orderId: "O2", createdAt: "2026-11-15T07:00:00Z", clientId: "C2", clientPhone: "+77010000002", status: "confirmed", totalAmount: 1000 } as never,
  ],
  nameOf: () => "Ильяс",
  today: "2026-11-11",
  days: 7,
});
check("аналитика: только рассылки постоянникам", res.total.recipients, 3);
check("аналитика: отправлено / прочитали / ответили", [res.total.sent, res.total.read, res.total.replied], [2, 1, 1]);
check("аналитика: заказ за 3 дня после — да, через 5 — нет", [res.total.ordered, res.total.revenue], [1, 54000]);
check("аналитика: в очереди", res.total.queued, 1);
check("аналитика: по режимам", res.byMode.map((m) => `${m.mode}:${m.recipients}`), ["weekly:2", "command:0", "overdue:1"]);
check("аналитика: строка сводки", habitsDigestLine(res).replace(/\u00a0/g, " ").startsWith("Постоянникам: отправлено 2, прочитали 50 %, ответили 1, заказали 1 на 54 000 ₸"), true);
check("аналитика: пусто — без строки", habitsDigestLine({ total: { ...res.total, recipients: 0 }, byManager: [] }), "");

console.log(failed ? `\nПровалено проверок: ${failed}` : "\nВсе проверки прошли.");
process.exit(failed ? 1 : 0);
