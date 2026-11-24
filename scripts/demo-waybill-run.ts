/*
 * Проход накладных на выдуманных данных (24.11.2026): таблица — в памяти проверочной копии, Green API и сайт подменены.
 * Проверяет то, чего чистые правила (`check-waybill`) не видят, — саму отправку: через отключённый от WhatsApp номер
 * не уходит ничего; ушедшая в такой номер накладная отправляется заново с рабочего, доставленная — нет; пропущенные из-за
 * номера и списка «не писать» отправляются; «Green API не ответил» не превращается во вторую накладную клиенту; когда
 * не работает ни один номер, строка честно «не отправлена».
 *
 * Запускается ВНУТРИ проверочной копии (там `sheets.ts` подменён чтением из файла — `scripts/ui-demo/run.sh`; папка
 * `scripts` копируется туда вместе с исходниками): cd /tmp/ecoculture-ui-demo/demo && npx tsx scripts/demo-waybill-run.ts
 * В самом репозитории не запускается: без подмены таблицы отказывается сразу.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!readFileSync(join(__dirname, "../src/lib/sheets.ts"), "utf-8").includes("demoClient")) {
  console.error("Это проверка для проверочной копии (scripts/ui-demo/run.sh). В репозитории не запускается.");
  process.exit(2);
}

// Данные копии: автомат «включён с завтра» (свои отгрузки образца не мешают), у всех заявок — мобильный номер.
{
  const src = process.env.WB_FIXTURE_SRC || process.env.DEMO_FIXTURE || "/tmp/ecoculture-ui-demo/fixture.json";
  const d = JSON.parse(readFileSync(src, "utf-8")) as Record<string, string[][]>;
  for (const r of d.Settings.slice(1)) if (r[0] === "WaybillSince") r[1] = new Date(Date.now() + 86400000).toISOString();
  const col = d.Orders[0].indexOf("ClientPhone");
  d.Orders.slice(1).forEach((r, k) => (r[col] = `+7 701 555 ${String(Math.floor(k / 100)).padStart(2, "0")} ${String(k % 100).padStart(2, "0")}`));
  const st = d.Waybills[0].indexOf("Status");
  d.Waybills = [d.Waybills[0], ...d.Waybills.slice(1).filter((r) => r[st] !== "sending" && r[st] !== "")];
  const out = join(tmpdir(), `wb-harness-${process.pid}.json`);
  writeFileSync(out, JSON.stringify(d));
  process.env.DEMO_FIXTURE = out;
}
process.env.NEXTAUTH_SECRET = "demo-secret-not-real";
process.env.NEXTAUTH_URL = "http://site.test";
process.env.GREENAPI_INSTANCE = "111";
process.env.GREENAPI_TOKEN = "maintoken";
process.env.GREENAPI_URL = "http://green.test";
process.env.CRON_SECRET = "x";
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = "demo";
process.env.PAYROLL_SPREADSHEET_ID = "demo2";
process.env.GOOGLE_CLIENT_ID = "demo";
process.env.GOOGLE_CLIENT_SECRET = "demo";

import { commitAtomic, readTable, rowToRecord, SHEET_TABS, forgetReads } from "../src/lib/sheets";
const appendRows = (tab: string, records: Record<string, unknown>[]) => commitAtomic([{ kind: "append", tab, records }]);
import { sealSecret } from "../src/lib/secretBox";
import { runWaybills } from "../src/lib/waybillRunner";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listShipments } from "../src/lib/repo/shipments";
import { listClients } from "../src/lib/repo/clients";
import { buildWaybillDoc } from "../src/lib/waybill";

const state: Record<string, string | null> = { "111": "authorized", "222": "notAuthorized" };
const sent: { instance: string; method: string; chat: string }[] = [];
let n = 0;
globalThis.fetch = (async (input: unknown, init?: { body?: string }) => {
  const url = String(input);
  const m = /waInstance(\d+)\/(\w+)\//.exec(url);
  if (m) {
    const [, inst, method] = m;
    if (method === "getStateInstance") {
      if (state[inst] === null) throw new Error("timeout");
      if (state[inst] === "expired") return new Response("Instance account is expired", { status: 400 });
      return new Response(JSON.stringify({ stateInstance: state[inst] }), { status: 200 });
    }
    if (method === "sendFileByUrl" || method === "sendMessage") {
      sent.push({ instance: inst, method, chat: String(JSON.parse(init?.body || "{}").chatId || "") });
      return new Response(JSON.stringify({ idMessage: `ID${++n}` }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  }
  if (url.startsWith("http://site.test/api/waybill/")) return new Response("ok", { status: 200 });
  return new Response("nope", { status: 404 });
}) as typeof fetch;

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60000).toISOString();
let fails = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(actual)}${ok ? "" : ` (ждали ${JSON.stringify(expected)})`}`);
};
const rows = async () => {
  forgetReads();
  const t = await readTable(SHEET_TABS.WAYBILLS, { fresh: true });
  return t.rows.map((r) => rowToRecord(SHEET_TABS.WAYBILLS, r));
};
const row = async (id: string) => (await rows()).find((r) => r.WaybillID === id)!;

async function main() {
  // Автомат включён «с позавчера», а час сейчас может быть ночной — проход проверяет час по Алматы.
  const [orders, shipments, clients] = await Promise.all([listOrdersWithItems(), listShipments(), listClients()]);
  const taken = new Set((await rows()).map((r) => r.OrderID));
  // Отгруженные клиентские заявки без накладных, отгрузки — старше двух суток (чтобы автомат их сам не брал).
  const pool = orders.filter((o) => o.status === "shipped" && !o.retail && !o.kind && o.clientId && !taken.has(o.orderId) && shipments.some((s) => s.orderId === o.orderId));
  console.log("подходящих заявок:", pool.length);
  const mk = (k: number, id: string, over: Record<string, unknown>, managerEmail?: string) => {
    const o = pool[k];
    const own = shipments.filter((s) => s.orderId === o.orderId);
    const doc = buildWaybillDoc({ order: o, shipments: own, shipmentIds: own.map((s) => s.shipmentId), number: o.orderId.slice(-5), date: "2026-11-24", city: "Алматы", manager: "Ильяс", shippedBy: "Разия" });
    return { order: o, rec: { WaybillID: id, CreatedAt: iso(60), OrderID: o.orderId, Number: doc.number, ShipmentIDs: own.map((s) => s.shipmentId).join(","), Doc: JSON.stringify(doc), Stems: doc.stems, Amount: doc.amount, Phone: "77015550001", Line: "m-ilyas", Status: "sent", Note: "", MessageID: `M-${id}`, ByEmail: "auto", SentAt: iso(60), ...over } };
  };
  const a = mk(0, "WB-DEAD", {});
  const b = mk(1, "WB-DELIVERED", { Phone: "77015550002" });
  const c = mk(2, "WB-OPTOUT", { Status: "skipped", Note: "клиент просил не писать — отправьте кнопкой, если накладная нужна", Line: "", MessageID: "", SentAt: "", Phone: "" });
  const d = mk(3, "WB-NOPHONE", { Status: "skipped", Note: "нет мобильного номера клиента — в заявке и в карточке", Line: "", MessageID: "", SentAt: "", Phone: "" });
  const e = mk(4, "WB-MAIN", { Line: "main", Phone: "77015550005" });
  const f = mk(5, "WB-OLD", { CreatedAt: iso(60 * 60), SentAt: iso(60 * 60), Phone: "77015550006" });
  await appendRows(SHEET_TABS.WAYBILLS, [a, b, c, d, e, f].map((x) => x.rec));
  await appendRows(SHEET_TABS.WA_STATUSES, [{ MessageID: "M-WB-DELIVERED", At: iso(59), Status: "delivered", Error: "", CreatedAt: iso(59) }]);
  await appendRows(SHEET_TABS.WA_LINES, [{ Code: "m-ilyas", ManagerEmail: "ilyas@demo.kz", Label: "Ильяс", Url: "http://green.test", Instance: "222", TokenEnc: sealSecret("linetoken"), Active: "TRUE", Assistant: "off", CreatedAt: iso(9999), UpdatedAt: iso(9999), Phone: "77010000222", State: "authorized", StateAt: iso(9999) }]);
  const phoneOf = (o: (typeof pool)[number]) => o.clientPhone || clients.find((x) => x.clientId === o.clientId)?.phone || "";
  console.log("телефоны заявок c/d:", !!phoneOf(c.order), !!phoneOf(d.order));

  console.log("\n— Проход 1: номер менеджера отключён, основной работает —");
  const r1 = await runWaybills({ limit: 200, budgetMs: 600000 });
  console.log(r1.off ? `ПРОХОД НЕ ШЁЛ: ${r1.off}` : `sent ${r1.sent} failed ${r1.failed} skipped ${r1.skipped}`);
  for (const x of r1.notes) console.log("   ", x);
  const A = await row("WB-DEAD");
  check("ушедшая в отключённый номер — отправлена заново с основного", [A.Status, A.Line, A.Note.startsWith("отправлена повторно"), A.MessageID !== "M-WB-DEAD"], ["sent", "main", true, true]);
  const B = await row("WB-DELIVERED");
  check("доставленная через тот же номер — не тронута", [B.Status, B.Line, B.MessageID, B.Note], ["sent", "m-ilyas", "M-WB-DELIVERED", ""]);
  const C = await row("WB-OPTOUT");
  check("пропущенная по «не писать» — отправлена", [C.Status, !!C.Phone, C.Line], ["sent", true, "main"]);
  const D = await row("WB-NOPHONE");
  check("без номера: номер появился — отправлена", [D.Status, D.Line], ["sent", "main"]);
  const E = await row("WB-MAIN");
  check("отправленная с основного номера — не тронута", [E.Status, E.Line, E.MessageID], ["sent", "main", "M-WB-MAIN"]);
  const F = await row("WB-OLD");
  check("старше двух суток — не тронута", [F.Status, F.Line, F.MessageID], ["sent", "m-ilyas", "M-WB-OLD"]);
  check("через отключённый номер не ушло ничего", sent.filter((s) => s.instance === "222").length, 0);
  check("клиенту A накладная ушла ровно одна", sent.filter((s) => s.method === "sendFileByUrl" && s.chat.startsWith(A.Phone)).length, 1);
  const phonesTouched = [A.Phone, C.Phone, D.Phone];

  console.log("\n— Проход 2: повтор — ничего лишнего —");
  const before = sent.length;
  const r2 = await runWaybills({ limit: 200, budgetMs: 600000 });
  for (const x of r2.notes) console.log("   ", x);
  check("второй проход не шлёт ни одной накладной", sent.slice(before).filter((s) => s.method === "sendFileByUrl").length, 0);
  void phonesTouched;

  console.log("\n— Проход 3: Green API не отвечает по номеру менеджера — «не знаю», повторов нет —");
  state["222"] = null;
  const g = mk(6, "WB-UNKNOWN", { Phone: "77015550007" });
  await appendRows(SHEET_TABS.WAYBILLS, [g.rec]);
  const before3 = sent.length;
  const r3 = await runWaybills({ limit: 200, budgetMs: 600000 });
  for (const x of r3.notes) console.log("   ", x);
  const G = await row("WB-UNKNOWN");
  check("номер не ответил — накладная не объявлена недоставленной", [G.Status, G.Line, G.MessageID], ["sent", "m-ilyas", "M-WB-UNKNOWN"]);
  check("…и клиенту ничего не ушло второй раз", sent.slice(before3).filter((s) => s.method === "sendFileByUrl").length, 0);

  console.log("\n— Проход 4: инстанс не оплачен — это «отключён» —");
  state["222"] = "expired";
  const r4 = await runWaybills({ limit: 200, budgetMs: 600000 });
  for (const x of r4.notes) console.log("   ", x);
  const G2 = await row("WB-UNKNOWN");
  check("неоплаченный номер: накладная ушла заново с основного", [G2.Status, G2.Line], ["sent", "main"]);

  console.log("\n— Проход 5: номер менеджера снова работает — новые накладные идут через него —");
  state["222"] = "authorized";
  // Заявка Ильяса, клиент с его номером не переписывался — накладная всё равно идёт с номера менеджера заявки.
  const ilyasAt = pool.findIndex((o, i) => i > 10 && o.managerEmail === "ilyas@demo.kz");
  const h = mk(ilyasAt >= 0 ? ilyasAt : 7, "WB-OPT2", { Status: "skipped", Note: "клиент просил не писать — отправьте кнопкой, если накладная нужна", Line: "", MessageID: "", SentAt: "", Phone: "" });
  await appendRows(SHEET_TABS.WAYBILLS, [h.rec]);
  const before5 = sent.length;
  await runWaybills({ limit: 200, budgetMs: 600000 });
  const H = await row("WB-OPT2");
  console.log("    менеджер заявки:", h.order.managerEmail, "→ линия", H.Line, "· отправок:", JSON.stringify(sent.slice(before5)));
  check("нашлась заявка Ильяса", h.order.managerEmail, "ilyas@demo.kz");
  check("накладная ушла с номера менеджера заявки", [H.Status, H.Line], ["sent", "m-ilyas"]);
  check("…и только с него", sent.slice(before5).filter((x) => x.method === "sendFileByUrl").map((x) => x.instance), ["222"]);

  console.log("\n— Проход 6: не работает ни один номер —");
  state["111"] = "notAuthorized";
  state["222"] = "notAuthorized";
  const k = mk(8, "WB-OPT3", { Status: "skipped", Note: "клиент просил не писать — отправьте кнопкой, если накладная нужна", Line: "", MessageID: "", SentAt: "", Phone: "" });
  await appendRows(SHEET_TABS.WAYBILLS, [k.rec]);
  const before6 = sent.length;
  await runWaybills({ limit: 200, budgetMs: 600000 });
  const K = await row("WB-OPT3");
  check("ни один номер не подключён — «не отправлена» с причиной, а не ложное «отправлено»", [K.Status, K.Note.includes("не подключён")], ["failed", true]);
  check("…и в отключённые номера ничего не ушло", sent.slice(before6).filter((s) => s.method === "sendFileByUrl").length, 0);

  console.log("\n— Проход 7: два прохода разом (склад отгружает заявку за заявкой) — накладная одна —");
  state["111"] = "authorized";
  state["222"] = "notAuthorized";
  const z1 = mk(9, "WB-RACE1", { Status: "skipped", Note: "клиент просил не писать — отправьте кнопкой, если накладная нужна", Line: "", MessageID: "", SentAt: "", Phone: "" });
  const z2 = mk(10, "WB-RACE2", {});
  await appendRows(SHEET_TABS.WAYBILLS, [z1.rec, z2.rec]);
  const before7 = sent.length;
  await Promise.all([runWaybills({ limit: 200, budgetMs: 600000 }), runWaybills({ limit: 200, budgetMs: 600000 }), runWaybills({ limit: 200, budgetMs: 600000 })]);
  const Z1 = await row("WB-RACE1");
  const Z2 = await row("WB-RACE2");
  check("обе строки отправлены", [Z1.Status, Z2.Status, Z2.Line], ["sent", "sent", "main"]);
  check("три прохода разом — каждому клиенту ровно одна накладная", [Z1.Phone, Z2.Phone].map((p) => sent.slice(before7).filter((x) => x.method === "sendFileByUrl" && x.chat.startsWith(p)).length), [1, 1]);

  console.log(fails === 0 ? "\nВсе проверки прошли" : `\nПровалено: ${fails}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
