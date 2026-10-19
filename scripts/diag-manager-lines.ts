/*
 * Номера WhatsApp менеджеров — что подключено и как идёт переписка. Ничего не меняет, ключи не печатает.
 * Запуск: npx tsx scripts/diag-manager-lines.ts [дней]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { getInstanceState } from "../src/lib/greenApi";
import { listUsers } from "../src/lib/repo/users";
import { listWaMessages } from "../src/lib/repo/talks";
import { listAssistantLog, listWaLines, managerLineConfig } from "../src/lib/repo/waLines";
import { listClients } from "../src/lib/repo/clients";

const tail = (p: string) => "…" + p.slice(-4);
const short = (s: string, n = 70) => (s || "").replace(/\s+/g, " ").slice(0, n);

async function main() {
  const days = Number(process.argv[2] || 7);
  const since = Date.now() - days * 86400000;
  const [users, lines, msgs, log, clients] = await Promise.all([
    listUsers(),
    listWaLines({ fresh: true }),
    listWaMessages({ lines: "all" }),
    listAssistantLog({ fresh: true }),
    listClients(),
  ]);
  const nameOf = (e: string) => users.find((u) => u.email === e)?.name || e;

  console.log(`=== Номера менеджеров: ${lines.length} ===`);
  for (const l of lines) {
    const cfg = managerLineConfig(l);
    let state = "нет ключей";
    if (cfg) {
      try {
        state = await getInstanceState(cfg);
      } catch (e) {
        state = `не ответил: ${e instanceof Error ? e.message : e}`;
      }
    }
    const lm = msgs.filter((m) => m.line === l.code);
    const recent = lm.filter((m) => Date.parse(m.at) >= since);
    const myClients = clients.filter((c) => (c.managerEmail || "").toLowerCase() === l.managerEmail);
    console.log(
      `\n${l.code} · ${nameOf(l.managerEmail)} · активен ${l.active} · помощник ${l.assistant} · тел ${l.phone ? tail(l.phone) : "?"} · сейчас ${state} · в таблице ${l.state || "-"} ${l.stateAt || ""}`,
    );
    console.log(`  сообщений всего ${lm.length}, за ${days} дн. ${recent.length} (вход ${recent.filter((m) => m.direction === "in").length}, исход ${recent.filter((m) => m.direction === "out").length}), клиентов в базе у менеджера ${myClients.length}`);
    const byPhone = new Map<string, typeof lm>();
    for (const m of recent) byPhone.set(m.phone, [...(byPhone.get(m.phone) || []), m]);
    const chats = [...byPhone.entries()]
      .map(([phone, list]) => ({ phone, list: list.sort((a, b) => a.at.localeCompare(b.at)) }))
      .sort((a, b) => b.list[b.list.length - 1].at.localeCompare(a.list[a.list.length - 1].at));
    const known = new Set(clients.map((c) => (c.phone || "").replace(/\D/g, "").slice(-10)));
    console.log(`  чатов за ${days} дн.: ${chats.length}, из них последним писал клиент: ${chats.filter((c) => c.list[c.list.length - 1].direction === "in").length}`);
    for (const c of chats.slice(0, 25)) {
      const last = c.list[c.list.length - 1];
      console.log(
        `   ${tail(c.phone)} ${known.has(c.phone.slice(-10)) ? "[клиент]" : "       "} ${c.list.length} сообщ. · последнее ${last.at.slice(5, 16)} ${last.direction === "in" ? "КЛИЕНТ" : "мы"}: ${short(last.text)}`,
      );
    }
    const ll = log.filter((x) => x.line === l.code);
    console.log(`  журнал помощника: auto ${ll.filter((x) => x.kind === "auto").length}, crm ${ll.filter((x) => x.kind === "crm").length}, записок ${ll.filter((x) => x.kind === "note").length} (открытых ${ll.filter((x) => x.kind === "note" && !x.doneAt).length})`);
    for (const x of ll.slice(-8)) console.log(`   ${x.at.slice(5, 16)} ${x.kind} ${tail(x.phone)}: ${short(x.text || x.note, 90)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
