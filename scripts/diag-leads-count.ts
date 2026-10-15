import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/** Сколько строк во вкладке Leads и чем они заполнены (обзвон, реклама, без имени). Ничего не меняет. */
import { readTable, rowToRecord, SHEET_TABS } from "../src/lib/sheets";
import { listLeadTouches, listLeads } from "../src/lib/repo/leads";

async function main() {
  const t = await readTable(SHEET_TABS.LEADS, { fresh: true });
  const recs = t.rows.map((r) => rowToRecord(SHEET_TABS.LEADS, r));
  const count = (f: (r: Record<string, string>) => boolean) => recs.filter(f).length;
  console.log(`строк в Leads: ${recs.length}; с LeadID ${count((r) => !!r.LeadID)}; с именем ${count((r) => !!r.Name)}`);
  const by = (k: string) => {
    const m = new Map<string, number>();
    for (const r of recs) m.set(r[k] || "(пусто)", (m.get(r[k] || "(пусто)") ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([v, n]) => `${v}: ${n}`).join(" · ");
  };
  console.log(`Campaign: ${by("Campaign")}`);
  console.log(`Origin: ${by("Origin")}`);
  console.log(`Stage: ${by("Stage")}`);
  console.log(`Source: ${by("Source")}`);
  const days = new Map<string, number>();
  for (const r of recs) days.set((r.CreatedAt || "").slice(0, 10), (days.get((r.CreatedAt || "").slice(0, 10)) ?? 0) + 1);
  console.log(`по дням заведения: ${Array.from(days.entries()).sort().map(([d, n]) => `${d}: ${n}`).join(" · ")}`);
  const leads = await listLeads({ fresh: true });
  const touches = await listLeadTouches({ fresh: true });
  console.log(`listLeads: ${leads.length}; касаний всего ${touches.length}; со звонком (Outcome) ${touches.filter((x) => x.outcome).length}`);
  const known = new Set(leads.map((l) => l.leadId));
  console.log(`касаний к лидам, которых нет: ${touches.filter((x) => !known.has(x.leadId)).length}`);
  console.log(`заголовки таблицы (первые): ${(t.headers ?? []).slice(0, 30).join(", ")}`);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.stack || e.message : e);
  process.exit(1);
});
