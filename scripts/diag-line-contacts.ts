import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Кто в телефонной книге номера менеджера под таким именем (20.10.2026, владелец: «Разия Теплица у всех
 * менеджеров — зав. склада, Диана тоже, Нина — РОП»): Green API `getContacts` отдаёт контакты, как они
 * записаны в телефоне менеджера. Печатает имя, номер и кем этот номер числится в CRM (сотрудник, клиент,
 * лид, никто). Ничего не меняет, токены не печатает.
 *
 *   npx tsx scripts/diag-line-contacts.ts <код линии|all> <слово> [слово…]
 */
import { listWaLines, managerLineConfig } from "../src/lib/repo/waLines";
import { listUsers } from "../src/lib/repo/users";
import { listClients } from "../src/lib/repo/clients";
import { listLeads } from "../src/lib/repo/leads";
import { phoneKey } from "../src/lib/leads";

async function main() {
  const [codeArg, ...words] = process.argv.slice(2);
  if (!codeArg || words.length === 0) throw new Error("нужны код линии (или all) и хотя бы одно слово");
  const lines = (await listWaLines({ fresh: true })).filter((l) => l.active && (codeArg === "all" || l.code === codeArg));
  const [users, clients, leads] = await Promise.all([listUsers(), listClients(), listLeads()]);
  console.log("Сотрудники в CRM:");
  for (const u of users) console.log(`  ${u.name || "—"} · ${u.email} · ${u.role}${u.active ? "" : " · выключен"} · WhatsApp ${u.phone || "—"}`);
  const who = (phone: string): string => {
    const k = phoneKey(phone);
    if (!k) return "?";
    const u = users.find((x) => phoneKey(x.phone) === k);
    if (u) return `сотрудник ${u.name} (${u.role})`;
    const c = clients.find((x) => [x.phone, x.messenger, x.kaspiPay1, x.kaspiPay2].some((p) => phoneKey(p) === k));
    if (c) return `клиент «${c.name}»`;
    const l = leads.find((x) => phoneKey(x.phone) === k);
    if (l) return `лид «${l.name}» (${l.stage}${l.origin ? `, ${l.origin}` : ""})`;
    return "в CRM нет";
  };
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
  for (const l of lines) {
    const cfg = managerLineConfig(l);
    console.log(`\n=== ${l.code} (${l.label}) ===`);
    if (!cfg) {
      console.log("нет ключей");
      continue;
    }
    const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/getContacts/${cfg.token}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      console.log(`getContacts: ${res.status}`);
      continue;
    }
    const contacts = (await res.json()) as { id: string; name?: string; contactName?: string; type?: string }[];
    const personal = contacts.filter((c) => (c.id || "").endsWith("@c.us"));
    console.log(`контактов: ${contacts.length}, личных: ${personal.length}`);
    for (const c of personal) {
      const name = [c.contactName, c.name].filter(Boolean).join(" / ");
      if (!re.test(name)) continue;
      const phone = c.id.replace(/@c\.us$/, "");
      console.log(`  ${name} · +${phone} · ${who(phone)}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
