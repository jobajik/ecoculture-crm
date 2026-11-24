/**
 * Проверка копирайтера рассылок (24.11.2026, промпт владельца «для рассылок и бота»): метка сценария, что считается
 * данными программы, какие ответы модели проходят и какие нет, что уходит модели, правила для бота.
 *   npx tsx scripts/check-broadcast-copy.ts
 */
import {
  COPY_SYSTEM_PROMPT,
  botCopyRules,
  checkCopy,
  cleanCopy,
  copyDone,
  copyGist,
  copyOutcome,
  copySpecValue,
  copyUserMessage,
  holidayFacts,
  parseCopySpec,
  programFacts,
  segmentByLastOrder,
  senderOf,
  splitOptOut,
  type CopySpec,
} from "../src/lib/broadcastCopy";
import { OPT_OUT_LINE } from "../src/lib/broadcast";
import { freshText, holidayText, introText, lowText, sleepingText } from "../src/lib/autoBroadcast";

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
  if (!ok) failed++;
}
/** Замечания по тексту: пусто — текст годится. `has` — есть ли замечание с таким словом. */
const has = (problems: string[], word: string) => problems.some((p) => p.includes(word));

// --- Метка ----------------------------------------------------------------------------------------------
const spec: CopySpec = { scenario: "FRESH_CUT", segment: "MANAGERS", sender: "MAIN" };
check("метка: туда и обратно", parseCopySpec(copySpecValue(spec)), spec);
check("метка: пусто — ИИ не включается", parseCopySpec(""), null);
check("метка: незнакомый сценарий — ИИ не включается", parseCopySpec("SALE|MANAGERS|MAIN"), null);
check("метка: неполная — ИИ не включается", parseCopySpec("FRESH_CUT|MANAGERS"), null);
check("метка: регистр и пробелы", parseCopySpec(" fresh_cut|common|manager "), { scenario: "FRESH_CUT", segment: "COMMON", sender: "MANAGER" });
check("метка после отправки: написал ИИ", copyDone(spec, "ai"), "FRESH_CUT|MANAGERS|MAIN|ai");
check("метка после отправки: по-прежнему читается как сценарий", parseCopySpec(copyDone(spec, "ai")), spec);
check("метка после отправки: ушёл текст программы, с причиной", copyOutcome(copyDone(spec, "program", ["потеряна цена 180 ₸"])), { by: "program", why: "потеряна цена 180 ₸" });
check("метка до отправки: ещё черновик", copyOutcome(copySpecValue(spec)), { by: "", why: "" });
check("метка: причина с чертой не ломает разбор", copyOutcome(copyDone(spec, "program", ["a|b"])).why, "a/b");

check("сегмент: заказ 10 дней назад — клиенты менеджеров", segmentByLastOrder("2026-11-14", "2026-11-24"), "MANAGERS");
check("сегмент: заказ ровно 60 дней назад — ещё активный", segmentByLastOrder("2026-09-25", "2026-11-24"), "MANAGERS");
check("сегмент: заказ 90 дней назад — общая база", segmentByLastOrder("2026-08-26", "2026-11-24"), "COMMON");
check("сегмент: не покупал — общая база", segmentByLastOrder("", "2026-11-24"), "COMMON");
check("отправитель", [senderOf("", false), senderOf("m-ilyas", false), senderOf("leads", false), senderOf("m-alexey", true), senderOf("", true)], ["MAIN", "MANAGER", "MANAGER", "REGIONAL", "REGIONAL"]);

// --- Что программа передала -----------------------------------------------------------------------------
const lab = (o: { variety: string; grade: string }) => `Роза ${o.variety}, ${o.grade}`;
const offers = [
  { flowerType: "rose", variety: "Jumilia", grade: "50 см", price: 180, qty: 900 },
  { flowerType: "rose", variety: "Alissa 1 Pure White", grade: "60 см", price: 1235, qty: 400 },
];
const fresh = splitOptOut(freshText(offers, lab, { cut: "yesterday" }).replace("{имя}", "Айгерим"), OPT_OUT_LINE);
check("строка «СТОП» отделяется от черновика", [fresh.optOut, fresh.body.includes("СТОП")], [true, false]);
check("черновик без «СТОП» — так и говорим", splitOptOut("Здравствуйте!", OPT_OUT_LINE), { body: "Здравствуйте!", optOut: false });
const facts = programFacts(fresh.body);
check("цены из черновика", facts.prices, ["180", "1235"]);
check("строки позиций", facts.lines, ["роза jumilia, 50 см - 180 ₸", "роза alissa 1 pure white, 60 см - 1 235 ₸"]);
check("сорта латиницей", facts.latin, ["jumilia", "alissa 1 pure white"]);
check("день срезки назван программой", facts.cutDay, true);
check("день срезки не назван", programFacts(splitOptOut(freshText(offers, lab), OPT_OUT_LINE).body).cutDay, false);
const sleeping = splitOptOut(sleepingText({ last: [{ label: "Роза Jumilia, 50 см", quantity: 300 }], offers: [offers[0]], label: lab }), OPT_OUT_LINE).body;
check("количества из черновика («брали 300 шт.»)", programFacts(sleeping).quantities, ["300"]);

// --- Проверка ответа модели -----------------------------------------------------------------------------
const good = [
  "Айгерим, добрый день! Вчера срезали розу, цветок свежий, уходит быстро:",
  "",
  "• Роза Jumilia, 50 см — *180 ₸*",
  "• Роза Alissa 1 Pure White, 60 см — *1 235 ₸*",
  "",
  "Закрепим за вами объём на завтра?",
].join("\n");
const ctx = { program: fresh.body, name: "Айгерим", spec };
check("хороший текст — без замечаний", checkCopy(good, ctx), []);
check("тире заменили дефисом, звёздочки убрали — тоже годится", checkCopy(good.replace(/—/g, "-").replace(/\*/g, ""), ctx), []);
check("цена изменена — нельзя", has(checkCopy(good.replace("180", "170"), ctx), "170 ₸"), true);
check("позиция потеряна — нельзя", has(checkCopy(good.replace("• Роза Alissa 1 Pure White, 60 см — *1 235 ₸*\n", ""), ctx), "перенеси дословно"), true);
check("длина позиции изменена — нельзя", has(checkCopy(good.replace("50 см", "60 см"), ctx), "перенеси дословно"), true);
check("выдуманная позиция — нельзя", has(checkCopy(good.replace("\n\nЗакрепим", "\n• Роза Mondial, 60 см — *235 ₸*\n\nЗакрепим"), ctx), "нет в данных программы"), true);
check("выдуманный сорт в тексте — нельзя", has(checkCopy(good.replace("розу,", "розу Freedom,"), ctx), "freedom"), true);
check("остаток штуками — нельзя", has(checkCopy(good.replace("уходит быстро", "осталось 300 шт."), ctx), "300 шт."), true);
check("остаток цифрой без «шт.» — нельзя", has(checkCopy(good.replace("уходит быстро", "на складе всего 300"), ctx), "точный остаток"), true);
check("без вопроса в конце — нельзя", has(checkCopy(good.replace("Закрепим за вами объём на завтра?", "Хорошего дня."), ctx), "призыва"), true);
check("призыв без вопросительного знака — можно", checkCopy(good.replace("Закрепим за вами объём на завтра?", "Напишите, сколько поставить на завтра."), ctx), []);
check("«акция» — нельзя", has(checkCopy(good.replace("цветок свежий", "акция, цветок свежий"), ctx), "спам-слова"), true);
check("«срочно успейте» — нельзя", has(checkCopy(good.replace("уходит быстро", "срочно успейте"), ctx), "спам-слова"), true);
check("капс — нельзя", has(checkCopy(good.replace("цветок свежий", "СВЕЖИЙ цветок"), ctx), "капсом"), true);
check("«СНГ» и «ТОО» — не капс", checkCopy(good.replace("цветок свежий", "цветок свежий, как нигде в СНГ"), ctx), []);
check("три эмодзи — нельзя", has(checkCopy(`${good} 🌸🌷🔥`, ctx), "эмодзи"), true);
check("два эмодзи — можно", checkCopy(`${good} 🌸🌷`, ctx), []);
check("про «СТОП» сама не пишет", has(checkCopy(`${good}\nЧтобы не получать сообщения, ответьте СТОП.`, ctx), "СТОП"), true);
check("«стопроцентно» — не «СТОП»", has(checkCopy(good.replace("цветок свежий", "цветок стопроцентно свежий"), ctx), "СТОП"), false);
check("осталось «{имя}» — нельзя", has(checkCopy(good.replace("Айгерим", "{имя}"), ctx), "{имя}"), true);
check("текст в кавычках — нельзя", has(checkCopy(`«${good}»`, ctx), "кавычк"), true);
check("служебные слова — нельзя", has(checkCopy(good.replace("Айгерим, добрый день!", "FRESH_CUT: добрый день!"), ctx), "служебные"), true);
check("слишком длинно — нельзя", has(checkCopy(`${"Очень длинный рассказ о теплице. ".repeat(25)}\n${good}`, ctx), "длинно"), true);
check("пустой ответ — нельзя", checkCopy("  ", ctx), ["пустой текст"]);
check("про следующую срезку программа не знает", has(checkCopy(good.replace("уходит быстро", "следующая срезка не скоро"), ctx), "следующая срезка"), true);
check("про 16 декабря в обычной рассылке — нельзя", has(checkCopy(good.replace("уходит быстро", "к 16 декабря разберут"), ctx), "16 декабря"), true);
check("про фуру, когда её нет в данных, — нельзя", has(checkCopy(good.replace("на завтра?", "ближайшей фурой?"), ctx), "фуру"), true);

const noDay = { program: splitOptOut(freshText(offers, lab), OPT_OUT_LINE).body, name: "", spec };
check("день срезки не назван — «вчера срезали» нельзя", has(checkCopy(good.replace("Айгерим, добрый день!", "Добрый день!"), noDay), "день срезки"), true);
check("день срезки не назван — «сегодня свежий срез» нельзя", has(checkCopy(good.replace("Айгерим, добрый день! Вчера срезали розу, цветок свежий", "Добрый день! Сегодня свежий срез"), noDay), "день срезки"), true);
check("день срезки не назван — «свежий срез» можно", checkCopy(good.replace("Айгерим, добрый день! Вчера срезали розу, цветок свежий", "Добрый день! Свежий срез розы"), noDay), []);
check("имени нет — «уважаемый» нельзя", has(checkCopy(good.replace("Айгерим, добрый день! Вчера срезали розу, цветок свежий", "Уважаемый клиент! Свежий срез розы"), noDay), "уважаем"), true);

const sleepGood = "Айгерим, здравствуйте! Давно не виделись.\n\nВ прошлый раз брали:\n• Роза Jumilia, 50 см — 300 шт.\n\nСейчас есть:\n• Роза Jumilia, 50 см — *180 ₸*\n\nПовторим на завтра?";
check("что брали в прошлый раз (300 шт.) — можно: это не остаток", checkCopy(sleepGood, { program: sleeping, name: "Айгерим", spec }), []);

const region = splitOptOut(freshText(offers, lab, { shipDay: "понедельник, 30.11" }), OPT_OUT_LINE).body;
const regionSpec: CopySpec = { scenario: "FRESH_CUT", segment: "MANAGERS", sender: "REGIONAL" };
check(
  "регион: призыв через фуру — можно",
  checkCopy("Добрый день! Свежий срез розы:\n• Роза Jumilia, 50 см — *180 ₸*\n• Роза Alissa 1 Pure White, 60 см — *1 235 ₸*\n\nБлижайшая фура в понедельник, 30.11 - записать вас на поставку?", { program: region, name: "", spec: regionSpec }),
  []
);

const intro = splitOptOut(introText(), OPT_OUT_LINE).body;
const introSpec: CopySpec = { scenario: "WHO_WE_ARE", segment: "COMMON", sender: "MAIN" };
const introGood = "Здравствуйте! Это Ecoculture: сами выращиваем розы, хризантему и эустому в своих теплицах в Казахстане. Розы растим уже 13 лет, а хризантему в промышленных объёмах в СНГ выращиваем только мы. Защищаем цветок полезными насекомыми, химии минимум.\n\nПрислать фото и цены на эту неделю?";
check("знакомство: хороший текст", checkCopy(introGood, { program: intro, name: "", spec: introSpec }), []);
check("знакомство: цену выдумывать нельзя", has(checkCopy(introGood.replace("химии минимум.", "химии минимум. Роза от 180 ₸."), { program: intro, name: "", spec: introSpec }), "180 ₸"), true);

const holiday = splitOptOut(holidayText("preorder", "среда"), OPT_OUT_LINE).body;
const holidaySpec: CopySpec = { scenario: "HOLIDAY_PREORDER", segment: "MANAGERS", sender: "MAIN" };
const holidayGood = "Добрый день! 16 декабря - День независимости, цветы к празднику лучше заказать заранее. Принимаем предзаказ: привезём свежий срез к 13-15 декабря.\n\nНапишите, какие позиции заложить для вас?";
check("праздник: хороший текст", checkCopy(holidayGood, { program: holiday, name: "", spec: holidaySpec }), []);
check("праздник: «16–17 декабря выходные» — нельзя, выходной один", has(checkCopy(holidayGood.replace("16 декабря - День независимости", "16-17 декабря - выходные"), { program: holiday, name: "", spec: holidaySpec }), "17"), true);
check("праздник: день недели 16 декабря 2026 — среда", holidayFacts(2026).dayLabel, "среда");

const low = splitOptOut(lowText([offers[0]], lab), OPT_OUT_LINE).body;
const lowSpec: CopySpec = { scenario: "ALMOST_GONE", segment: "MANAGERS", sender: "MAIN" };
check("заканчивается: хороший текст", checkCopy("Добрый день! Роза, которую вы берёте, заканчивается, разбирают быстро:\n• Роза Jumilia, 50 см — *180 ₸*\n\nОтложить для вас на завтра, пока не разобрали?", { program: low, name: "", spec: lowSpec }), []);

// --- Что уходит модели -----------------------------------------------------------------------------------
const user = copyUserMessage({ spec, name: "Айгерим", program: fresh.body, today: "вторник, 24.11.2026", avoid: ["Добрый день! Свежий срез… Поставить вам на завтра?"], problems: ["потеряна цена 180 ₸"] });
check("запрос: имя, сегмент, отправитель, сценарий, день", ["Имя клиента: Айгерим", "Сегмент: MANAGERS", "Отправитель: MAIN", "Сценарий: FRESH_CUT", "Сегодня: вторник, 24.11.2026"].every((x) => user.includes(x)), true);
check("запрос: черновик целиком", user.includes(fresh.body), true);
check("запрос: что уже ушло другим", user.includes("начни иначе") && user.includes("Поставить вам на завтра?"), true);
check("запрос: замечания к прошлой попытке", user.includes("потеряна цена 180 ₸"), true);
check("запрос: строки «СТОП» нет", user.includes("СТОП"), false);
check("запрос без имени", copyUserMessage({ spec, name: "", program: fresh.body, today: "" }).includes("обращайся без имени"), true);
check("запрос: день срезки не назван — сказано прямо", copyUserMessage({ spec, name: "", program: noDay.program, today: "" }).includes("без «сегодня» и «вчера»"), true);
check("запрос праздника: выходной только 16-е", copyUserMessage({ spec: holidaySpec, name: "", program: holiday, today: "" }).includes("про 17 декабря не пиши"), true);
check("запрос без позиций: сортов и цен не называть", copyUserMessage({ spec: introSpec, name: "", program: intro, today: "" }).includes("не называй ни сортов, ни цен"), true);

check("ответ в кавычках — кавычки снимаются", cleanCopy("«Добрый день!»"), "Добрый день!");
check("кавычки внутри текста не трогаем", cleanCopy("«Оформим?» — так и напишите."), "«Оформим?» — так и напишите.");
check("не строка — пусто", cleanCopy(42), "");
check("суть сообщения: без «СТОП», начало и конец", copyGist(`${"а".repeat(300)}\n\n${OPT_OUT_LINE}`, OPT_OUT_LINE).length < 200, true);

// --- Промпт владельца и правила для бота -----------------------------------------------------------------
check(
  "промпт владельца: ключевые места на месте",
  ["# РОЛЬ И ЗАДАЧА", "Запрет на точные остатки в рассылке", "Обязательный призыв к действию (CTA)", "Анти-повтор", "`HOLIDAY_LAST_CHANCE`", "# ФОРМАТ ВЫВОДА", "биозащиту"].every((x) => COPY_SYSTEM_PROMPT.includes(x)),
  true
);
const botNov = botCopyRules(new Date("2026-11-24T06:00:00Z")).join("\n");
const botDec = botCopyRules(new Date("2026-12-10T06:00:00Z")).join("\n");
check("боту: остаток цифрой не называть и что ответить", botNov.includes("Остаток в штуках клиенту не называй") && botNov.includes("закрепить"), true);
check("боту: в ноябре про праздник ни слова", botNov.includes("16 декабря"), false);
check("боту: в декабре — праздник и предзаказ к 13-15", botDec.includes("16 декабря (среда)") && botDec.includes("13-15 декабря"), true);
check("боту: после праздника блок убран", botCopyRules(new Date("2026-12-17T06:00:00Z")).join("\n").includes("16 декабря"), false);

if (failed) {
  console.log(`\nПРОВАЛЕНО: ${failed}`);
  process.exit(1);
}
console.log("\nВсе проверки прошли");
