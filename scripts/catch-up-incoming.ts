import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Номер был отвязан (блокировка, QR) — что клиенты написали за это время и чего нет в CRM. Пока
 * номер не авторизован, вебхук молчит, и такие сообщения не попадают ни в `WaMessages`, ни в память
 * бота: клиент ждёт ответа, а бот о нём не знает.
 *
 * Берёт `lastIncomingMessages` за N часов и историю чатов (`getChatHistory`, последние 15 сообщений)
 * у тех, кому мы писали рассылкой или ботом за эти часы, сравнивает с `WaMessages` по номеру
 * сообщения и печатает недостающие входящие и кто сейчас ждёт ответа (последним писал клиент).
 * С --yes дописывает недостающее в `WaMessages` (источник history) и в память бота (`BotChats`),
 * чтобы бот ответил с полной перепиской (`bot-answer-waiting.ts`). Ключ не печатается.
 *
 *   npx tsx scripts/catch-up-incoming.ts [часов=48] [--yes]
 *
 * 10.10.2026: номер сняли с блока и перепривязали; владелец: «ответь тем, кому должен».
 */
import { greenConfig, fetchChatHistory } from "../src/lib/greenApi";
import { parseHistoryItem } from "../src/lib/whatsapp";
import { appendWaMessages, listWaMessages } from "../src/lib/repo/talks";
import { botChatWrite, listBotChats, listRecipients, settingsMap } from "../src/lib/repo/broadcasts";
import { commitAtomic, type WriteOp } from "../src/lib/sheets";
import { withMissingIncoming } from "../src/lib/botTurn";
import { staffPhoneKeys } from "../src/lib/botSalesAlert";
import { phoneKey } from "../src/lib/leads";
import type { WaMessage } from "../src/lib/types";

const tail = (p: string) => `…${p.replace(/\D/g, "").slice(-4)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(method: string, query = ""): Promise<unknown> {
  const cfg = greenConfig();
  if (!cfg) throw new Error("нет ключей Green API");
  const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}${query}`, { signal: AbortSignal.timeout(30000) });
  const text = (await res.text()).split(cfg.token).join("***");
  if (!res.ok) throw new Error(`${method}: ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function main() {
  const hours = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 48);
  const apply = process.argv.includes("--yes");
  const cfg = greenConfig();
  if (!cfg) throw new Error("нет ключей Green API");
  const st = (await get("getStateInstance")) as { stateInstance?: string };
  console.log(`Номер: ${st.stateInstance}`);
  if (st.stateInstance !== "authorized") throw new Error("номер не авторизован — сначала QR в консоли Green API");

  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const known = await listWaMessages();
  const knownIds = new Set(known.map((m) => m.messageId));
  const found = new Map<string, WaMessage>();

  const journal = (await get("lastIncomingMessages", `?minutes=${hours * 60}`)) as unknown[];
  for (const item of Array.isArray(journal) ? journal : []) {
    const m = parseHistoryItem({ ...(item as object), type: "incoming" });
    if (m && !m.chatId.endsWith("@g.us")) found.set(m.messageId, m);
  }
  console.log(`Журнал входящих за ${hours} ч: ${found.size}`);

  // Кому мы писали за эти часы (рассылка, бот) — их чаты смотрим целиком: журнал входящих у Green API
  // не видит то, что пришло, пока номер был отвязан.
  const [recipients, chats, map] = await Promise.all([listRecipients(true), listBotChats(true), settingsMap(true)]);
  const staff = staffPhoneKeys(map);
  const phones = new Set<string>();
  for (const r of recipients) if (r.status === "sent" && r.sentAt >= since) phones.add(r.phone);
  for (const c of chats) if ((c.updatedAt || "") >= since) phones.add(c.phone);
  for (const m of known) if (m.at >= since) phones.add(m.phone);
  console.log(`Чатов проверяю по истории: ${phones.size}`);
  for (const phone of phones) {
    if (staff.has(phoneKey(phone))) continue;
    // Green API отвечает 429, если спрашивать историю чаще раза в секунду, — пауза и одна повторная попытка.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        for (const m of await fetchChatHistory(cfg, phone, 15)) if (m.direction === "in") found.set(m.messageId, m);
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (attempt === 1 && msg.includes("429")) {
          await sleep(6000);
          continue;
        }
        console.log(`  ${tail(phone)}: история не отдалась — ${msg.slice(0, 80)}`);
      }
    }
    await sleep(1500);
  }

  const missing = [...found.values()]
    .filter((m) => !knownIds.has(m.messageId) && m.at >= since && !staff.has(phoneKey(m.phone)))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  console.log(`\nНет в CRM: ${missing.length}`);
  for (const m of missing) console.log(`  ${m.at.slice(5, 16)} ${tail(m.phone)} ${m.senderName || ""} [${m.type}]: ${m.text.replace(/\s+/g, " ").slice(0, 120)}`);

  // Кто ждёт: последним в переписке (CRM + недостающее) писал клиент, за эти часы.
  const all = [...known, ...missing];
  const byPhone = new Map<string, WaMessage[]>();
  for (const m of all) {
    if (m.at < since) continue;
    const k = phoneKey(m.phone);
    byPhone.set(k, [...(byPhone.get(k) ?? []), m]);
  }
  console.log("\nЖдут ответа (последним писал клиент):");
  const waiting: string[] = [];
  for (const [k, list] of byPhone) {
    if (staff.has(k)) continue;
    list.sort((a, b) => (a.at < b.at ? -1 : 1));
    const last = list[list.length - 1];
    if (last.direction !== "in") continue;
    const chat = chats.find((c) => phoneKey(c.phone) === k);
    waiting.push(last.phone.slice(-7));
    console.log(`  ${last.at.slice(5, 16)} ${tail(last.phone)} · ${chat ? `память бота: ${chat.mode}` : "памяти бота нет"} · ${last.text.replace(/\s+/g, " ").slice(0, 100)}`);
  }
  console.log(`Номера для bot-answer-waiting: ${waiting.join(" ") || "—"}`);

  if (!apply || missing.length === 0) return console.log(apply ? "Дописывать нечего." : "\nТолько показ. Дописать в CRM и память бота: --yes");
  await appendWaMessages(missing.map((m) => ({ ...m, source: "history" })));
  const writes: WriteOp[] = [];
  for (const chat of chats) {
    const mine = missing.filter((m) => phoneKey(m.phone) === phoneKey(chat.phone));
    if (mine.length === 0) continue;
    const context = withMissingIncoming(
      chat.context,
      mine.map((m) => ({ messageId: m.messageId, phone: m.phone, direction: "in", at: m.at, text: m.text, type: m.type }))
    );
    const last = mine[mine.length - 1];
    writes.push(botChatWrite({ ...chat, context, nudge: { count: 0, at: "", done: false }, lastInMessageId: last.messageId }, chat.rowNumber));
  }
  if (writes.length) await commitAtomic(writes);
  console.log(`Дописано: сообщений ${missing.length}, чатов бота ${writes.length}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
