/*
 * Шаг отправки рассылки с копирайтером на выдуманных данных (24.11.2026): таблица — в памяти проверочной копии,
 * OpenAI и Green API подменены. Проверяет то, чего чистые правила (`check-broadcast-copy`) не видят, — саму отправку:
 * клиенту уходит текст ИИ, а не черновик; у получателя остаётся ровно то, что ушло; следующему модель получает уже
 * отправленное («начни иначе»); потерял цену — вторая попытка; дважды назвал остаток или не ответил — уходит черновик
 * программы, рассылка не встаёт; получатель без метки получает текст дословно, и модель не зовётся.
 *
 * Запускается ВНУТРИ проверочной копии (там `sheets.ts` подменён чтением из файла — `scripts/ui-demo/run.sh`):
 *   cd /tmp/ecoculture-ui-demo/demo && npx tsx scripts/demo-broadcast-copy-run.ts
 * В самом репозитории не запускается: без подмены таблицы отказывается сразу.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

if (!readFileSync(join(__dirname, "../src/lib/sheets.ts"), "utf-8").includes("demoClient")) {
  console.error("Это проверка для проверочной копии (scripts/ui-demo/run.sh). В репозитории не запускается.");
  process.exit(2);
}
process.env.DEMO_FIXTURE = process.env.DEMO_FIXTURE || "/tmp/ecoculture-ui-demo/fixture.json";
process.env.NEXTAUTH_SECRET = "demo-secret-not-real";
process.env.NEXTAUTH_URL = "http://site.test";
process.env.GREENAPI_INSTANCE = "111";
process.env.GREENAPI_TOKEN = "maintoken";
process.env.GREENAPI_URL = "http://green.test";
process.env.OPENAI_API_KEY = "sk-demo-not-real";
process.env.CRON_SECRET = "x";
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "demo";
process.env.PAYROLL_SPREADSHEET_ID = "demo2";
process.env.GOOGLE_CLIENT_ID = "demo";
process.env.GOOGLE_CLIENT_SECRET = "demo";

// Часы: полдень по Алматы, между шагами — вперёд на 4 минуты (иначе шаг честно ответит «подождите»).
const RealDate = Date;
let offset = RealDate.parse(`${new RealDate().toISOString().slice(0, 10)}T07:00:00Z`) - RealDate.now();
class FakeDate extends RealDate {
  constructor(...a: unknown[]) {
    if (a.length === 0) super(RealDate.now() + offset);
    else super(...(a as [number]));
  }
  static now() {
    return RealDate.now() + offset;
  }
}
globalThis.Date = FakeDate as unknown as DateConstructor;

import { createBroadcast, listRecipients } from "../src/lib/repo/broadcasts";
import { sendNextBroadcastMessage } from "../src/lib/broadcastSend";
import { BROADCAST_STATUSES, OPT_OUT_LINE } from "../src/lib/broadcast";
import { freshText } from "../src/lib/autoBroadcast";
import { copyOutcome, copySpecValue } from "../src/lib/broadcastCopy";
import { forgetReads } from "../src/lib/sheets";

const lab = (o: { variety: string; grade: string }) => `Роза ${o.variety}, ${o.grade}`;
const offers = [{ flowerType: "rose", variety: "Jumilia", grade: "50 см", price: 180, qty: 900 }];
const draft = freshText(offers, lab);
const GOOD = (hello: string, ask: string) => `${hello} Свежий срез розы, уходит быстро:\n\n• Роза Jumilia, 50 см — *180 ₸*\n\n${ask}`;

/** Что ответит «модель» на очередной запрос. */
const script: (string | "ERROR")[] = [];
const asked: string[] = [];
const sent: { chat: string; text: string }[] = [];
let n = 0;
globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
  const url = String(input);
  if (url.includes("/chat/completions")) {
    const body = JSON.parse(init?.body || "{}") as { messages?: { content: string }[] };
    asked.push(body.messages?.[1]?.content || "");
    const next = script.shift();
    if (next === undefined || next === "ERROR") return new Response(JSON.stringify({ error: { message: "boom", code: "server_error" } }), { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ message: next }) } }] }), { status: 200 });
  }
  const m = /waInstance(\d+)\/(\w+)\//.exec(url);
  if (m) {
    if (m[2] === "getStateInstance") return new Response(JSON.stringify({ stateInstance: "authorized" }), { status: 200 });
    if (m[2] === "sendMessage") {
      const b = JSON.parse(init?.body || "{}") as { chatId?: string; message?: string };
      sent.push({ chat: String(b.chatId || ""), text: String(b.message || "") });
      return new Response(JSON.stringify({ idMessage: `ID${++n}` }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }
  return new Response("nope", { status: 404 });
}) as typeof fetch;

let fails = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
  if (!ok) fails++;
};

async function step(id: string) {
  offset += 4 * 60000;
  forgetReads();
  return sendNextBroadcastMessage(id);
}

async function main() {
  const copy = copySpecValue({ scenario: "FRESH_CUT", segment: "MANAGERS", sender: "MAIN" });
  const people = ["Айгерим", "Марат", "Дана", "Олжас", "Сауле"];
  const id = await createBroadcast({
    createdByEmail: "harness",
    title: "Проверка копирайтера",
    text: draft,
    fileId: "",
    fileName: "",
    audience: "проверка",
    status: BROADCAST_STATUSES.SENDING,
    recipients: people.map((name, i) => ({ phone: `7701555010${i}`, name, kind: "client", refId: `C${i}`, managerEmail: "", text: i === 4 ? "Сауле, это текст менеджера - дословно." : draft, ...(i === 4 ? {} : { copy }) })),
  });
  const row = async (i: number) => (await listRecipients(true)).find((r) => r.broadcastId === id && r.phone === `7701555010${i}`)!;
  const order: number[] = [];
  const who = (s: { sentTo?: string }) => people.indexOf(s.sentTo || "");

  // 1. Хороший ответ с первой попытки.
  script.push(GOOD("Айгерим, добрый день!", "Закрепим за вами объём на завтра?"));
  let s = await step(id);
  let i = who(s);
  order.push(i);
  check("1: сообщение ушло", [sent.length, i >= 0], [1, true]);
  check("1: ушёл текст ИИ со строкой «СТОП», а не черновик", [sent[0].text.includes("Закрепим за вами объ"), sent[0].text.endsWith(OPT_OUT_LINE), sent[0].text.includes("Свежий срез на этой неделе")], [true, true, false]);
  check("1: тире заменены дефисами (как пишут с телефона)", /[—–]/.test(sent[0].text), false);
  check("1: позиция и цена дошли", sent[0].text.includes("Роза Jumilia, 50 см - *180 ₸*"), true);
  let r = await row(i);
  check("1: у получателя записано то, что ушло", [r.status, r.text === sent[0].text, copyOutcome(r.copy).by], ["sent", true, "ai"]);
  check("1: модели ушли имя и черновик, без «СТОП»", [asked[0].includes(`Имя клиента: ${people[i]}`), asked[0].includes("• Роза Jumilia, 50 см - *180 ₸*"), asked[0].includes("СТОП")], [true, true, false]);

  // 2. Первая попытка потеряла цену — вторая исправила; модель видит, что уже ушло первому.
  script.push(GOOD("Добрый день!", "Поставить вам на завтра?").replace("180", "170"), GOOD("Здравствуйте!", "Поставить вам на завтра?"));
  const before2 = asked.length;
  s = await step(id);
  i = who(s);
  order.push(i);
  check("2: ушло второе сообщение, двумя запросами к модели", [sent.length, asked.length - before2], [2, 2]);
  check("2: в запросе — что уже отправлено другим", asked[before2].includes("Уже отправлено другим клиентам сегодня") && asked[before2].includes("Закрепим за вами"), true);
  check("2: во втором запросе — замечание про цену", asked[before2 + 1].includes("170 ₸"), true);
  check("2: клиент получил верную цену", [sent[1].text.includes("180 ₸"), sent[1].text.includes("170")], [true, false]);
  check("2: написал ИИ", copyOutcome((await row(i)).copy).by, "ai");

  // 3. Дважды назвал остаток — уходит черновик программы.
  const bad = GOOD("Добрый день!", "Оформим заказ на завтра?").replace("уходит быстро", "осталось 300 шт.");
  script.push(bad, bad);
  s = await step(id);
  i = who(s);
  order.push(i);
  check("3: сообщение всё равно ушло", sent.length, 3);
  check("3: это черновик программы с именем, остатка в нём нет", [sent[2].text.startsWith(`Здравствуйте, ${people[i]}!`), sent[2].text.includes("300"), sent[2].text.endsWith(OPT_OUT_LINE)], [true, false, true]);
  r = await row(i);
  check("3: в метке — «текст программы» и почему", [copyOutcome(r.copy).by, copyOutcome(r.copy).why.includes("300 шт.")], ["program", true]);

  // 4. Модель не отвечает — уходит черновик, рассылка идёт дальше.
  script.push("ERROR", "ERROR");
  s = await step(id);
  i = who(s);
  order.push(i);
  check("4: модель не ответила — сообщение ушло черновиком", [sent.length, sent[3].text.startsWith(`Здравствуйте, ${people[i]}!`), copyOutcome((await row(i)).copy).by], [4, true, "program"]);
  check("4: рассылка не встала", s.status, BROADCAST_STATUSES.SENDING);

  // 5. Получатель без метки — текст человека дословно, модель не зовётся.
  const before5 = asked.length;
  s = await step(id);
  check("5: текст человека ушёл дословно, без запроса к модели", [sent.length, sent[4]?.text, asked.length - before5], [5, "Сауле, это текст менеджера - дословно.", 0]);
  check("каждому — одно сообщение", new Set(sent.map((x) => x.chat)).size, 5);
  check("четверо с меткой — разные люди", new Set(order).size, 4);

  console.log(fails ? `\nПРОВАЛЕНО: ${fails}` : "\nВсе проверки прошли");
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error("ОШИБКА:", e);
  process.exit(1);
});
