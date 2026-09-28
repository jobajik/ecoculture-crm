/*
 * Выгрузка переписки по рассылкам — для разбора «как клиенты ответили».
 * НИЧЕГО НЕ МЕНЯЕТ.
 *
 * В консоль (и в лог очереди) печатает только счётчики. Сами разговоры —
 * номера и тексты клиентов — пишет в файл, путь которого передаётся первым
 * аргументом. Кладите его ВНЕ папки проекта: репозиторий публичный.
 *
 * К сохранённому в таблице (WaMessages) добавляется история чата из Green API
 * после отправки рассылки — на случай, если уведомление не дошло.
 *
 * Запуск: npx tsx scripts/diag-broadcast-chats.ts ..\_private\broadcast-chats.json
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { prefetchTables, SHEET_TABS } from "../src/lib/sheets";
import { listBroadcasts, listRecipients, listWaStatuses } from "../src/lib/repo/broadcasts";
import { listWaMessages } from "../src/lib/repo/talks";
import { deliveryByMessage } from "../src/lib/broadcast";
import { mergeMessages } from "../src/lib/whatsapp";
import { fetchChatHistory, greenConfig } from "../src/lib/greenApi";
import { phoneKey } from "../src/lib/leads";
import type { WaMessage } from "../src/lib/types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const outFile = process.argv[2];
  if (!outFile) throw new Error("укажите файл для выгрузки (вне папки проекта)");
  const resolved = path.resolve(outFile);
  if (resolved.startsWith(path.resolve(".") + path.sep)) throw new Error("файл внутри папки проекта — нельзя, репозиторий публичный");

  await prefetchTables([SHEET_TABS.BROADCASTS, SHEET_TABS.BROADCAST_RECIPIENTS, SHEET_TABS.WA_STATUSES, SHEET_TABS.WA_MESSAGES]);
  const [broadcasts, recipients, statuses, stored] = await Promise.all([
    listBroadcasts(true),
    listRecipients(true),
    listWaStatuses(),
    listWaMessages(),
  ]);
  const delivery = deliveryByMessage(statuses);
  console.log(`Рассылок: ${broadcasts.length}, получателей всего: ${recipients.length}, сообщений в WaMessages: ${stored.length}`);

  const cfg = greenConfig();
  const out: unknown[] = [];
  for (const b of broadcasts) {
    const mine = recipients.filter((r) => r.broadcastId === b.broadcastId);
    const sent = mine.filter((r) => r.sentAt && r.status === "sent");
    let replied = 0;
    let fromHistory = 0;
    const people: unknown[] = [];
    for (const r of mine) {
      const key = phoneKey(r.phone);
      let msgs: WaMessage[] = stored.filter((m) => phoneKey(m.phone) === key);
      if (cfg && r.sentAt) {
        try {
          const hist = await fetchChatHistory(cfg, r.phone, 60);
          fromHistory += hist.length;
          msgs = mergeMessages([...msgs, ...hist]);
          await sleep(250);
        } catch (err) {
          console.log(`  история ${r.phone.slice(-4)}: ${err instanceof Error ? err.message.slice(0, 80) : err}`);
        }
      }
      const since = r.sentAt ? new Date(new Date(r.sentAt).getTime() - 60_000).toISOString() : "";
      const after = mergeMessages(msgs).filter((m) => !since || m.at >= since);
      const hasReply = r.sentAt ? after.some((m) => m.direction === "in" && m.at > r.sentAt) : false;
      if (hasReply) replied++;
      const d = r.messageId ? delivery.get(r.messageId) : undefined;
      people.push({
        phone: r.phone,
        name: r.name,
        kind: r.kind,
        managerEmail: r.managerEmail,
        status: r.status,
        delivery: d?.status || "",
        error: r.error || d?.error || "",
        sentAt: r.sentAt,
        replied: hasReply,
        messages: after.map((m) => ({ at: m.at, dir: m.direction, type: m.type, text: m.text })),
      });
    }
    console.log(`${b.broadcastId} · «${b.title}» · ${b.status} · получателей ${mine.length}, отправлено ${sent.length}, ответили ${replied}`);
    out.push({ ...b, recipients: people });
    if (fromHistory) console.log(`  из истории Green API подтянуто сообщений: ${fromHistory}`);
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(out, null, 1), "utf-8");
  console.log(`Выгружено в файл вне проекта (${out.length} рассылок).`);
}

main().catch((err) => {
  console.error("ОШИБКА:", err instanceof Error ? err.message : err);
  process.exit(1);
});
