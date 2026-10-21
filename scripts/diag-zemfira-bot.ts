import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Что ИИ и рассылки писали с номера Земфиры за N дней (21.10.2026, её замечания: длинно, не здоровается, пишет
 * переданным Ильгару, выдумывает наличие, пишет отказавшимся, вываливает условия доставки). Печатает каждое наше
 * сообщение не с телефона: кто отправил (помощник / рассылка / CRM), лид и его стадия, передан ли менеджеру, что клиент
 * писал до этого последним. Ничего не меняет.
 *
 *   npx tsx scripts/diag-zemfira-bot.ts [дней]
 */
import { listWaMessages } from "../src/lib/repo/talks";
import { listLeads } from "../src/lib/repo/leads";
import { listClients } from "../src/lib/repo/clients";
import { listOrdersWithItems } from "../src/lib/repo/orders";
import { listAssistantLog } from "../src/lib/repo/waLines";
import { listRecipients } from "../src/lib/repo/broadcasts";
import { phoneKey } from "../src/lib/leads";
import { messageText } from "../src/lib/whatsapp";

async function main() {
  const days = Number(process.argv[2]) || 3;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [messages, leads, clients, orders, log, recipients] = await Promise.all([listWaMessages({ lines: "all" }), listLeads(), listClients(), listOrdersWithItems(), listAssistantLog(), listRecipients()]);
  const auto = new Map(log.filter((r) => r.messageId).map((r) => [r.messageId, r.kind]));
  const bc = new Set(recipients.filter((r) => r.messageId).map((r) => r.messageId));
  const leadByKey = new Map(leads.map((l) => [phoneKey(l.phone), l]));
  const clientByKey = new Map<string, (typeof clients)[number]>();
  for (const c of clients) for (const p of [c.phone, c.messenger]) if (phoneKey(p)) clientByKey.set(phoneKey(p), c);
  const ordersByClient = new Map<string, number>();
  for (const o of orders) ordersByClient.set(o.clientId, (ordersByClient.get(o.clientId) ?? 0) + 1);
  const ours = messages.filter((m) => m.line === "leads" && m.direction === "out" && m.at >= since && (auto.has(m.messageId) || bc.has(m.messageId) || m.source === "assistant" || m.source === "crm")).sort((a, b) => (a.at < b.at ? -1 : 1));
  console.log(`С номера Земфиры не с телефона за ${days} дн.: ${ours.length}`);
  for (const m of ours) {
    const k = phoneKey(m.phone);
    const l = leadByKey.get(k);
    const c = clientByKey.get(k);
    const prevIn = messages.filter((x) => phoneKey(x.phone) === k && x.direction === "in" && x.at < m.at).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    const who = auto.get(m.messageId) ?? (bc.has(m.messageId) ? "рассылка" : m.source);
    console.log(`\n--- ${m.at.slice(0, 16)} · …${k.slice(-4)} · ${who} · длина ${messageText(m).length}`);
    console.log(`  лид: ${l ? `${l.leadId} «${l.name}» ${l.stage} · менеджер ${l.managerEmail || "—"}${l.handedOverAt ? ` · ПЕРЕДАН ${l.handedOverAt.slice(0, 10)}` : ""}${l.clientId ? ` · карточка ${l.clientId}` : ""}` : "нет"}${c ? ` · клиент «${c.name}» (${c.managerEmail}, заявок ${ordersByClient.get(c.clientId) ?? 0})` : ""}`);
    if (prevIn) console.log(`  клиент до этого (${prevIn.at.slice(0, 16)}): ${messageText(prevIn).slice(0, 160)}`);
    console.log(`  мы: ${messageText(m).replace(/\n+/g, " | ").slice(0, 500)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
