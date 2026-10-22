import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Насколько активны бот, помощники и рассылки по дням (22.10.2026, владелец: «бот по ответам, рассылкам и менеджерам
 * сегодня не такой активный — почему?»). По каждому номеру и дню (Алматы): входящих от клиентов, наших исходящих,
 * ответов ИИ / дожимов / записок из журнала помощника, ушедших сообщений рассылок, и сколько чатов сегодня остались
 * без ответа (клиент написал последним больше 30 мин назад). Плюс последние запуски дожима и сводки. Ничего не меняет.
 *
 *   npx tsx scripts/diag-ai-activity.ts [дней=4]
 */
import { readTable, rowToRecord, SHEET_TABS } from "../src/lib/sheets";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { localDayKey } from "../src/lib/timezone";

const days = Number(process.argv[2]) || 4;
const dayOf = (iso: string) => (iso ? localDayKey(new Date(iso)) : "");

async function main() {
  const [wa, log, rec, map] = await Promise.all([
    readTable(SHEET_TABS.WA_MESSAGES, { fresh: true }),
    readTable(SHEET_TABS.ASSISTANT_LOG, { fresh: true }),
    readTable(SHEET_TABS.BROADCAST_RECIPIENTS, { fresh: true }),
    settingsMap(true),
  ]);
  const since = localDayKey(new Date(Date.now() - (days - 1) * 86400000));
  type Cell = { inMsg: number; inChats: Set<string>; out: number; auto: number; nudge: number; note: number; crm: number; bc: number };
  const grid = new Map<string, Cell>();
  const cell = (line: string, day: string) => {
    const k = `${line || "основной"}|${day}`;
    if (!grid.has(k)) grid.set(k, { inMsg: 0, inChats: new Set(), out: 0, auto: 0, nudge: 0, note: 0, crm: 0, bc: 0 });
    return grid.get(k)!;
  };
  const msgs = wa.rows.map((r) => rowToRecord(SHEET_TABS.WA_MESSAGES, r));
  for (const m of msgs) {
    const d = dayOf(m.At);
    if (!d || d < since) continue;
    const c = cell(m.Line || "", d);
    if (m.Direction === "in") {
      c.inMsg++;
      c.inChats.add(m.Phone);
    } else c.out++;
  }
  for (const r of log.rows.map((x) => rowToRecord(SHEET_TABS.ASSISTANT_LOG, x))) {
    const d = dayOf(r.At);
    if (!d || d < since) continue;
    const c = cell(r.Line || "", d);
    if (r.Kind === "auto") c.auto++;
    else if (r.Kind === "nudge") c.nudge++;
    else if (r.Kind === "note") c.note++;
    else if (r.Kind === "crm") c.crm++;
  }
  for (const r of rec.rows.map((x) => rowToRecord(SHEET_TABS.BROADCAST_RECIPIENTS, x))) {
    const d = dayOf(r.SentAt);
    if (!d || d < since || !r.MessageID) continue;
    cell("рассылки (все номера)", d).bc++;
  }
  console.log(`По дням с ${since} (Алматы). вх — сообщений клиентов (чатов), исх — всех наших; ИИ — ответы помощника, дожим, записки, из CRM; рассылки — ушло.`);
  for (const [k, c] of Array.from(grid.entries()).sort()) {
    const [line, day] = k.split("|");
    console.log(
      `  ${day} · ${line.padEnd(30)} вх ${String(c.inMsg).padStart(4)} (${c.inChats.size} чат.) · исх ${String(c.out).padStart(4)} · ИИ ${c.auto} · дожим ${c.nudge} · записки ${c.note} · CRM ${c.crm}${c.bc ? ` · рассылки ${c.bc}` : ""}`
    );
  }
  // Кто сегодня ждёт: последним писал клиент, больше 30 мин назад, днём.
  const today = localDayKey();
  const last = new Map<string, (typeof msgs)[number]>();
  for (const m of msgs) {
    const k = `${m.Line || ""}|${m.Phone}`;
    const prev = last.get(k);
    if (!prev || m.At > prev.At) last.set(k, m);
  }
  const waiting = new Map<string, number>();
  const now = Date.now();
  for (const [k, m] of Array.from(last.entries())) {
    if (m.Direction !== "in" || dayOf(m.At) !== today) continue;
    if (now - Date.parse(m.At) < 30 * 60000) continue;
    const line = k.split("|")[0] || "основной";
    waiting.set(line, (waiting.get(line) ?? 0) + 1);
  }
  console.log(`\nСегодня без ответа больше 30 мин (последним писал клиент; кивки и сотрудники тоже здесь):`);
  for (const [line, n] of Array.from(waiting.entries())) console.log(`  ${line}: ${n}`);
  console.log("\nПоследние запуски:");
  for (const key of ["BotFollowupLastRun", "DigestLastRun", "LineNudgeLastRun", "AutoBroadcastPlan", "BroadcastChain"]) {
    console.log(`  ${key}: ${(map[key] || "—").slice(0, 300)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
