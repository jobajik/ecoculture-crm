import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Что сотрудники писали на ОСНОВНОЙ номер (поручения боту) и кто такой клиент из поручения.
 * Печатает входящие на основной номер с номеров сотрудников за N дней, карточки клиентов и лидов по слову,
 * и переписку этих клиентов на всех номерах после поручения. Ничего не меняет.
 *
 *   npx tsx scripts/diag-staff-request.ts [дней] [слово… | @файл со словами]
 */
import { readFileSync } from "node:fs";
import { listWaMessages } from "../src/lib/repo/talks";
import { listClients } from "../src/lib/repo/clients";
import { listLeads } from "../src/lib/repo/leads";
import { listUsers } from "../src/lib/repo/users";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { ourPhoneKeys } from "../src/lib/lineNotify";
import { phoneKey } from "../src/lib/leads";
import { messageText } from "../src/lib/whatsapp";

async function main() {
  const [daysArg, ...rawWords] = process.argv.slice(2);
  // «@файл» — слова из файла (русские слова в .bat портятся кодировкой консоли).
  const words = rawWords.flatMap((w) => (w.startsWith("@") ? readFileSync(w.slice(1), "utf8").replace(/^\uFEFF/, "").split(/\s+/).filter(Boolean) : [w]));
  const days = Number(daysArg) || 2;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const [messages, clients, leads, users, map] = await Promise.all([listWaMessages({ lines: "all" }), listClients(), listLeads(), listUsers(), settingsMap()]);
  const staff = await ourPhoneKeys(map);
  const userByKey = new Map(users.filter((u) => u.phone).map((u) => [phoneKey(u.phone), u]));
  console.log(`Входящие на основной номер с номеров сотрудников за ${days} дн.:`);
  for (const m of messages.filter((x) => x.line === "" && x.direction === "in" && x.at >= since && staff.has(phoneKey(x.phone)))) {
    const u = userByKey.get(phoneKey(m.phone));
    console.log(`  ${m.at.slice(0, 16)} · +${m.phone} (${u ? u.name : "номер сводки/продаж"}) · ${messageText(m).slice(0, 300)}`);
  }
  if (!words.length) return;
  const re = new RegExp(words.join("|"), "i");
  const found: { name: string; phone: string; manager: string; kind: string }[] = [];
  for (const c of clients) if (re.test(`${c.name} ${c.contactPerson ?? ""}`)) found.push({ name: c.name, phone: c.phone, manager: c.managerEmail, kind: `клиент ${c.clientId}` });
  for (const l of leads) if (re.test(`${l.name} ${l.contactPerson ?? ""}`)) found.push({ name: l.name, phone: l.phone, manager: l.managerEmail, kind: `лид ${l.leadId} (${l.stage})` });
  console.log(`\nКарточки по «${words.join(" ")}»:`);
  for (const f of found) console.log(`  ${f.kind} · ${f.name} · ${f.phone || "без телефона"} · ${f.manager || "ничей"}`);
  const keys = new Set(found.map((f) => phoneKey(f.phone)).filter(Boolean));
  // Ещё — по имени в WhatsApp.
  for (const m of messages) if (m.senderName && re.test(m.senderName)) keys.add(phoneKey(m.phone));
  for (const k of Array.from(keys)) {
    const chat = messages.filter((m) => phoneKey(m.phone) === k && m.at >= since).sort((a, b) => (a.at < b.at ? -1 : 1));
    console.log(`\n=== …${k.slice(-4)} · сообщений за ${days} дн.: ${chat.length}`);
    for (const m of chat.slice(-25)) console.log(`  ${m.at.slice(0, 16)} [${m.line || "основной"}] ${m.direction === "in" ? "клиент" : "мы"} ${m.type}: ${messageText(m).slice(0, 160)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
