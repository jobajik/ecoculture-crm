/*
 * Номер Земфиры: с кем она переписывалась ДО включения авто-лидов (переписка, дотянутая за 3 дня) и
 * кого нет ни в лидах, ни в клиентах, — завести её лидами «с рекламы» тем же правилом, что вебхук
 * (`autoLeadFromMessage`), с касанием на сегодня. 15.10.2026, владелец: «со старыми лидами тоже
 * что-нибудь сделай».
 *
 * Без --yes только показывает (последние 4 цифры, имя, первое сообщение). Строки ДОПИСЫВАЮТСЯ
 * в Leads одним запросом — ничего не удаляет и не меняет.
 * Запуск: npx tsx scripts/leads-from-zemfira-inbox.ts [--yes]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { createLeads, listLeads, type NewLead } from "../src/lib/repo/leads";
import { listClients } from "../src/lib/repo/clients";
import { listUsers } from "../src/lib/repo/users";
import { listWaMessages } from "../src/lib/repo/talks";
import { phoneKey } from "../src/lib/leads";
import { mergeMessages } from "../src/lib/whatsapp";
import { autoLeadFromMessage, leadsLineOwner } from "../src/lib/waAutoLead";
import { newClientName } from "../src/lib/botOrder";
import { localDayKey } from "../src/lib/timezone";
import type { WaMessage } from "../src/lib/types";

async function main() {
  const apply = process.argv.includes("--yes");
  const [leads, clients, users, all] = await Promise.all([
    listLeads({ fresh: true }),
    listClients(),
    listUsers(),
    listWaMessages({ lines: "all" }),
  ]);
  const known = new Set<string>();
  for (const l of leads) if (phoneKey(l.phone)) known.add(phoneKey(l.phone));
  for (const c of clients) for (const p of [c.phone, c.messenger, c.kaspiPay1, c.kaspiPay2]) if (phoneKey(p)) known.add(phoneKey(p));
  const owner = leadsLineOwner(users);
  console.log(`Хозяйка линии: ${owner ? "Земфира есть" : "НЕТ — лиды будут ничьи"}`);

  const byKey = new Map<string, WaMessage[]>();
  for (const m of all) {
    if (m.line !== "leads") continue;
    const key = phoneKey(m.phone);
    if (!key || known.has(key)) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), m]);
  }

  const out: NewLead[] = [];
  for (const list of Array.from(byKey.values())) {
    const msgs = mergeMessages(list);
    const first = msgs[0];
    if (!first) continue;
    // Земфира почти всегда пишет первой — лид и тогда (`autoLeadFromMessage`), имя — из ответа клиента.
    const named = [...msgs].reverse().find((m) => m.direction === "in" && m.senderName);
    const base = autoLeadFromMessage(first, new Set(), owner, localDayKey(new Date(first.at)));
    if (!base) continue;
    const name = named ? newClientName("", named.senderName, first.phone) : base.name;
    out.push({ ...base, name, contactPerson: base.contactPerson || (named?.senderName ?? "").slice(0, 80) });
  }
  console.log(`Незнакомых номеров в её переписке: ${byKey.size}; лидов к заведению: ${out.length}\n`);
  for (const l of out) console.log(`…${l.phone.replace(/\D/g, "").slice(-4)} · ${l.name} · ${l.note.slice(0, 80)}`);

  if (!apply) {
    console.log("\nПросмотр. Завести: --yes");
    return;
  }
  await createLeads(out, localDayKey());
  console.log(`\nЗаведено лидов: ${out.length}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
