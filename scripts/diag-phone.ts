import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Кто это: последние цифры номера → сотрудник, наш номер (сводка, продажи бота, менеджеры), клиент, лид.
 * Ничего не меняет.  npx tsx scripts/diag-phone.ts <цифры> [ещё цифры]
 */
import { listUsers } from "../src/lib/repo/users";
import { listClients } from "../src/lib/repo/clients";
import { listLeads } from "../src/lib/repo/leads";
import { listWaLines } from "../src/lib/repo/waLines";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { ourPhoneKeys } from "../src/lib/lineNotify";
import { phoneKey } from "../src/lib/leads";

async function main() {
  const tails = process.argv.slice(2).map((t) => t.replace(/\D/g, "")).filter(Boolean);
  const [users, clients, leads, lines, map] = await Promise.all([listUsers(), listClients(), listLeads(), listWaLines(), settingsMap()]);
  const ours = await ourPhoneKeys(map);
  for (const t of tails) {
    console.log(`\n=== …${t} ===`);
    for (const k of Array.from(ours)) if (k.endsWith(t)) console.log(`  наш номер (сотрудники, сводка, продажи, линии): …${k.slice(-6)}`);
    for (const u of users) if (phoneKey(u.phone).endsWith(t)) console.log(`  сотрудник ${u.name} · ${u.role}`);
    for (const l of lines) if ((l.phone || "").endsWith(t)) console.log(`  номер WhatsApp ${l.code}`);
    for (const c of clients)
      if ([c.phone, c.messenger, c.kaspiPay1, c.kaspiPay2].some((p) => phoneKey(p).endsWith(t)))
        console.log(`  клиент «${c.name}» · ${c.city} · менеджер ${c.managerEmail}${c.active === false ? " · неактивен" : ""}`);
    for (const l of leads) if (phoneKey(l.phone).endsWith(t)) console.log(`  лид «${l.name}» · ${l.stage} · ${l.managerEmail}`);
    for (const [k, v] of Object.entries(map)) if (/Phones$/.test(k) && v.replace(/\D/g, "").includes(t)) console.log(`  в настройке ${k}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
