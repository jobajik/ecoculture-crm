import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Все клиенты с номера менеджера — в CRM (21.10.2026, владелец про Салтанат, менеджера Астаны: «важно всех клиентов
 * Салтанат не потерять и хранить!»; решение — лидами все, с кем есть переписка). Берёт у Green API список чатов
 * номера (`getChats`, нет — `getContacts`), по каждому личному чату — последние сообщения: переписка дописывается в
 * WaMessages (видна в «Переписках» и карточке лида), а номер, которого нет ни у лида, ни у клиента, ни у сотрудника,
 * становится лидом менеджера номера тем же правилом, что вебхук (`autoLeadFromMessage`), с городом из
 * `ManagerProfiles`. Контакты телефонной книги без переписки лидами не становятся.
 *
 *   npx tsx scripts/line-import-all.ts <код линии> [--from N] [--max N] [--yes]
 *
 * История чата у Green API — не чаще раза в секунду, поэтому за запуск — до `--max` чатов (по умолчанию 250);
 * в конце печатается, с какого продолжить. Без --yes ничего не пишет. Ничего не удаляет и не меняет.
 */
import { listWaLines, managerLineConfig } from "../src/lib/repo/waLines";
import { createLeads, listLeads, type NewLead } from "../src/lib/repo/leads";
import { listClients } from "../src/lib/repo/clients";
import { listUsers } from "../src/lib/repo/users";
import { appendWaMessages, listWaMessages } from "../src/lib/repo/talks";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { fetchChatHistory } from "../src/lib/greenApi";
import { ourPhoneKeys } from "../src/lib/lineNotify";
import { phoneKey } from "../src/lib/leads";
import { autoLeadFromMessage } from "../src/lib/waAutoLead";
import { newClientName } from "../src/lib/botOrder";
import { genitiveName } from "../src/lib/waLines";
import { MANAGER_PROFILES_SETTING, parseManagerProfiles, profileOf } from "../src/lib/managerProfile";
import { localDayKey } from "../src/lib/timezone";
import { mergeMessages } from "../src/lib/whatsapp";
import type { WaMessage } from "../src/lib/types";

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) || def : def;
};

async function main() {
  const code = process.argv[2];
  const apply = process.argv.includes("--yes");
  const from = arg("--from", 0);
  const max = arg("--max", 250);
  const line = (await listWaLines({ fresh: true })).find((l) => l.code === code);
  if (!line) throw new Error(`номер ${code} не найден`);
  const cfg = managerLineConfig(line);
  if (!cfg) throw new Error("у номера нет ключей");

  type Chat = { phone: string; name: string };
  let chats: Chat[] = [];
  for (const method of ["getChats", "getContacts"]) {
    try {
      const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}`, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) {
        console.log(`${method}: ${res.status}`);
        continue;
      }
      const list = (await res.json()) as { id?: string; name?: string; contactName?: string }[];
      chats = (Array.isArray(list) ? list : [])
        .filter((c) => (c.id || "").endsWith("@c.us"))
        .map((c) => ({ phone: (c.id || "").replace(/@c\.us$/, ""), name: (c.contactName || c.name || "").trim() }));
      console.log(`${method}: личных чатов ${chats.length}`);
      if (chats.length) break;
    } catch (err) {
      console.log(`${method}: ${err instanceof Error ? err.message : err}`);
    }
  }
  const [leads, clients, users, all, map] = await Promise.all([
    listLeads({ fresh: true }),
    listClients(),
    listUsers(),
    listWaMessages({ lines: "all" }),
    settingsMap(),
  ]);
  const known = new Set<string>();
  for (const l of leads) if (phoneKey(l.phone)) known.add(phoneKey(l.phone));
  for (const c of clients) for (const p of [c.phone, c.messenger, c.kaspiPay1, c.kaspiPay2]) if (phoneKey(p)) known.add(phoneKey(p));
  const staff = await ourPhoneKeys(map);
  const profile = profileOf(parseManagerProfiles(map[MANAGER_PROFILES_SETTING]), line.managerEmail);
  const managerName = users.find((u) => u.email.toLowerCase() === line.managerEmail)?.name || line.label;
  console.log(`Номер ${code} · менеджер ${managerName} · город ${profile?.city || "—"}`);
  const have = new Set(all.map((m) => m.messageId));
  const lineMsgs = all.filter((m) => m.line === code);

  const part = chats.slice(from, from + max);
  const fresh: WaMessage[] = [];
  const out: NewLead[] = [];
  let skippedStaff = 0;
  let skippedKnown = 0;
  let empty = 0;
  for (const c of part) {
    const key = phoneKey(c.phone);
    if (!key) continue;
    if (staff.has(key)) {
      skippedStaff++;
      continue;
    }
    let history: WaMessage[] = [];
    try {
      history = await fetchChatHistory(cfg, c.phone, 40);
    } catch (err) {
      console.log(`  …${c.phone.slice(-4)}: ${err instanceof Error ? err.message : err}`);
    }
    await new Promise((r) => setTimeout(r, 1100));
    for (const m of history) {
      if (have.has(m.messageId)) continue;
      have.add(m.messageId);
      fresh.push({ ...m, line: code });
    }
    const msgs = mergeMessages([...lineMsgs.filter((m) => phoneKey(m.phone) === key), ...history.map((m) => ({ ...m, line: code }))]);
    if (!msgs.length) {
      empty++;
      continue;
    }
    if (known.has(key)) {
      skippedKnown++;
      continue;
    }
    const first = msgs[0];
    const base = autoLeadFromMessage(first, new Set(), line.managerEmail, localDayKey(new Date(first.at)), {
      whose: genitiveName(managerName),
      origin: "",
      incomingOnly: false,
      city: profile?.city || "",
    });
    if (!base) continue;
    const named = [...msgs].reverse().find((m) => m.direction === "in" && m.senderName);
    const name = c.name ? newClientName("", c.name, c.phone) : named ? newClientName("", named.senderName, c.phone) : base.name;
    known.add(key);
    out.push({ ...base, name, contactPerson: base.contactPerson || (c.name || named?.senderName || "").slice(0, 80) });
  }
  console.log(
    `Чаты ${from + 1}–${from + part.length} из ${chats.length}: без переписки ${empty}, сотрудники и наши ${skippedStaff}, уже в CRM ${skippedKnown}, ` +
      `новых лидов ${out.length}, сообщений дописать ${fresh.length}`
  );
  for (const l of out) console.log(`  …${l.phone.replace(/\D/g, "").slice(-4)} · ${l.name}`);
  if (from + part.length < chats.length) console.log(`Продолжить: --from ${from + part.length}`);
  if (!apply) return console.log("Только показ. Записать: --yes");
  if (fresh.length) await appendWaMessages(fresh);
  await createLeads(out, localDayKey());
  console.log(`Записано: лидов ${out.length}, сообщений ${fresh.length}.`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
