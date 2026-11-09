import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Аналитика рассылки по кампании лидов (09.11.2026, SkyGroup: «сделай рассылку по этим номерам и веди аналитику»).
 * Берёт лиды кампании и все рассылки, где они получатели: сколько отправлено / доставлено / прочитано / ответили /
 * отписались («СТОП»), сколько ответил бот, сколько стали клиентами и заказали, и список ответивших с их первым
 * сообщением. Печатает сводку и пишет Excel рядом с файлом кампании. Ничего не меняет.
 *
 *   npx tsx scripts/diag-campaign.ts "<кампания>" [путь к xlsx]
 */
import ExcelJS from "exceljs";
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listLeads } from "../src/lib/repo/leads";
import { listBroadcasts, listRecipients, listWaStatuses, listBotChats } from "../src/lib/repo/broadcasts";
import { listWaMessages } from "../src/lib/repo/talks";
import { listClients } from "../src/lib/repo/clients";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { deliveryByMessage, recipientViews, RECIPIENT_STATE_LABELS } from "../src/lib/broadcast";
import { phoneKey, stageLabel } from "../src/lib/leads";
import { ORDER_STATUSES } from "../src/lib/constants";
import { localDayKey } from "../src/lib/timezone";

const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₸`;
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)} %` : "—");

async function main() {
  const campaign = process.argv[2];
  if (!campaign) throw new Error("Укажите название кампании");
  const out = process.argv[3] || `campaign-${localDayKey()}.xlsx`;
  await prefetchTables([SHEET_TABS.LEADS, SHEET_TABS.BROADCASTS, SHEET_TABS.BROADCAST_RECIPIENTS, SHEET_TABS.WA_STATUSES, SHEET_TABS.WA_MESSAGES, SHEET_TABS.CLIENTS, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.BOT_CHATS]);
  const [leads, broadcasts, recipients, statuses, messages, clients, orders, chats] = await Promise.all([
    listLeads(),
    listBroadcasts(true),
    listRecipients(true),
    listWaStatuses(),
    listWaMessages({ lines: "all" }),
    listClients(),
    listOrdersWithItems(),
    listBotChats(),
  ]);
  const mine = leads.filter((l) => l.campaign === campaign);
  const keys = new Set(mine.map((l) => phoneKey(l.phone)).filter(Boolean));
  const leadByKey = new Map(mine.map((l) => [phoneKey(l.phone), l]));
  const rows = recipients.filter((r) => keys.has(phoneKey(r.phone)));
  const bcIds = new Set(rows.map((r) => r.broadcastId));
  const bcs = broadcasts.filter((b) => bcIds.has(b.broadcastId));
  const views = recipientViews(rows, deliveryByMessage(statuses), messages);
  const by = new Map<string, number>();
  for (const v of views) by.set(v.state, (by.get(v.state) ?? 0) + 1);
  const sentAll = views.filter((v) => ["sent", "delivered", "read", "replied"].includes(v.state)).length;
  const optout = chats.filter((c) => keys.has(phoneKey(c.phone)) && c.mode === "optout").length;
  const botReplied = new Set(chats.filter((c) => keys.has(phoneKey(c.phone)) && c.botReplies > 0).map((c) => phoneKey(c.phone))).size;
  const becameClients = mine.filter((l) => l.clientId);
  const clientIds = new Set(becameClients.map((l) => l.clientId));
  const clientPhones = new Set(clients.filter((c) => keys.has(phoneKey(c.phone))).map((c) => c.clientId));
  const ordersMine = orders.filter((o) => o.status !== ORDER_STATUSES.CANCELLED && (clientIds.has(o.clientId) || clientPhones.has(o.clientId) || keys.has(phoneKey(o.clientPhone))));
  const stages = new Map<string, number>();
  for (const l of mine) stages.set(l.stage, (stages.get(l.stage) ?? 0) + 1);

  console.log(`Кампания «${campaign}» на ${localDayKey()}: лидов ${mine.length}, рассылок ${bcs.length}`);
  for (const b of bcs) console.log(`  ${b.broadcastId} «${b.title}» · ${b.status} · с ${(b.startedAt || b.createdAt).slice(0, 10)}`);
  console.log(`Отправлено: ${sentAll} из ${rows.length} в очереди (${pct(sentAll, mine.length)} базы)`);
  for (const st of ["queued", "sent", "delivered", "read", "replied", "error", "skipped"] as const)
    if (by.get(st)) console.log(`  ${RECIPIENT_STATE_LABELS[st]}: ${by.get(st)}`);
  console.log(`Ответили: ${by.get("replied") ?? 0} (${pct(by.get("replied") ?? 0, sentAll)} от отправленных) · бот ответил в ${botReplied} чатах · отписались (СТОП): ${optout}`);
  console.log(`Стали клиентами: ${becameClients.length} · заявок: ${ordersMine.length} на ${money(ordersMine.reduce((s, o) => s + o.totalAmount, 0))}`);
  console.log("Стадии лидов: " + Array.from(stages).map(([s, n]) => `${stageLabel(s) || "Новый"} ${n}`).join(" · "));
  const replied = views.filter((v) => v.state === "replied").sort((a, b) => (a.replyAt < b.replyAt ? 1 : -1));
  if (replied.length) {
    console.log("\nОтветили:");
    for (const v of replied.slice(0, 40)) console.log(`  …${v.phone.slice(-4)} · ${v.replyAt.slice(0, 16).replace("T", " ")} · ${(v.replyText || "").slice(0, 90)}`);
  }

  const wb = new ExcelJS.Workbook();
  const s1 = wb.addWorksheet("Сводка");
  s1.columns = [{ width: 34 }, { width: 18 }];
  const add = (a: string, b: string | number) => s1.addRow([a, b]);
  add("Кампания", campaign);
  add("Дата", localDayKey());
  add("Лидов в базе", mine.length);
  add("Отправлено", sentAll);
  add("Доставлено", (by.get("delivered") ?? 0) + (by.get("read") ?? 0) + (by.get("replied") ?? 0));
  add("Прочитано", (by.get("read") ?? 0) + (by.get("replied") ?? 0));
  add("Ответили", by.get("replied") ?? 0);
  add("Доля ответивших от отправленных", pct(by.get("replied") ?? 0, sentAll));
  add("Отписались (СТОП)", optout);
  add("Ошибки доставки", by.get("error") ?? 0);
  add("В очереди", by.get("queued") ?? 0);
  add("Стали клиентами", becameClients.length);
  add("Заявок", ordersMine.length);
  add("Сумма заявок", ordersMine.reduce((s, o) => s + o.totalAmount, 0));
  s1.getRow(1).font = { bold: true };
  const s2 = wb.addWorksheet("По номерам");
  s2.columns = [
    { header: "Телефон", key: "phone", width: 16 },
    { header: "Лид", key: "name", width: 24 },
    { header: "Статус", key: "state", width: 14 },
    { header: "Отправлено", key: "sentAt", width: 18 },
    { header: "Ответ", key: "reply", width: 60 },
    { header: "Когда ответил", key: "replyAt", width: 18 },
    { header: "Стадия", key: "stage", width: 18 },
    { header: "Клиент", key: "client", width: 10 },
  ];
  s2.getRow(1).font = { bold: true };
  for (const v of views) {
    const l = leadByKey.get(phoneKey(v.phone));
    s2.addRow({
      phone: `+${v.phone}`,
      name: l?.name ?? "",
      state: RECIPIENT_STATE_LABELS[v.state],
      sentAt: v.sentAt ? v.sentAt.slice(0, 16).replace("T", " ") : "",
      reply: v.replyText,
      replyAt: v.replyAt ? v.replyAt.slice(0, 16).replace("T", " ") : "",
      stage: stageLabel(l?.stage ?? ""),
      client: l?.clientId ? "да" : "",
    });
  }
  const queuedKeys = new Set(rows.map((r) => phoneKey(r.phone)));
  for (const l of mine) if (!queuedKeys.has(phoneKey(l.phone))) s2.addRow({ phone: l.phone, name: l.name, state: "ещё не в рассылке", stage: stageLabel(l.stage) });
  s2.autoFilter = "A1:H1";
  await wb.xlsx.writeFile(out);
  console.log(`\nExcel: ${out}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
