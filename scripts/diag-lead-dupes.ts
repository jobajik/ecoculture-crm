import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Лиды-двойники: несколько лидов на один телефон (последние 10 цифр). Печатает, кто, когда и откуда завёл каждый,
 * сколько у него касаний и есть ли карточка клиента. Ничего не меняет.
 *
 *   npx tsx scripts/diag-lead-dupes.ts [с какого дня ГГГГ-ММ-ДД]
 */
import { listLeads, listLeadTouches } from "../src/lib/repo/leads";
import { phoneKey } from "../src/lib/leads";

async function main() {
  const from = process.argv[2] || "";
  const [leads, touches] = await Promise.all([listLeads({ fresh: true }), listLeadTouches()]);
  const byKey = new Map<string, typeof leads>();
  for (const l of leads) {
    const k = phoneKey(l.phone);
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), l]);
  }
  const groups = Array.from(byKey.values()).filter((g) => g.length > 1 && (!from || g.some((l) => l.createdAt.slice(0, 10) >= from)));
  console.log(`Телефонов с несколькими лидами: ${groups.length}`);
  for (const g of groups) {
    console.log(`\n${g[0].phone}`);
    for (const l of g.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))) {
      const n = touches.filter((t) => t.leadId === l.leadId).length;
      console.log(
        `  ${l.leadId} · ${l.createdAt.slice(0, 16)} · «${l.name}» · завёл ${l.createdByEmail || "—"} · менеджер ${l.managerEmail || "—"} · ${l.stage} · источник ${l.source || "—"} · касаний ${n}${l.clientId ? ` · клиент ${l.clientId}` : ""} · ${(l.note || "").slice(0, 80)}`
      );
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
