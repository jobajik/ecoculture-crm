/*
 * Переписка номера менеджера с клиентами (по последним цифрам) — как её видит CRM. Ничего не меняет.
 * Запуск: npx tsx scripts/diag-line-chat.ts <код линии> [цифры …]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listWaMessages } from "../src/lib/repo/talks";
import { mergeMessages } from "../src/lib/whatsapp";

async function main() {
  const [code, ...tails] = process.argv.slice(2);
  const all = (await listWaMessages({ lines: "all" })).filter((m) => m.line === code);
  const byDay = new Map<string, { in: number; out: number }>();
  for (const m of all) {
    const d = m.at.slice(0, 10);
    const cur = byDay.get(d) ?? { in: 0, out: 0 };
    cur[m.direction] += 1;
    byDay.set(d, cur);
  }
  console.log(`Сообщений линии ${code}: ${all.length}, входящих ${all.filter((m) => m.direction === "in").length}`);
  for (const [d, c] of [...byDay.entries()].sort().slice(-12)) console.log(`  ${d}: вход ${c.in}, исход ${c.out}`);
  const sources = new Map<string, number>();
  for (const m of all) sources.set(`${m.source}/${m.direction}`, (sources.get(`${m.source}/${m.direction}`) ?? 0) + 1);
  console.log("Источники:", [...sources.entries()].map(([k, v]) => `${k} ${v}`).join(", "));
  for (const t of tails) {
    const chat = mergeMessages(all.filter((m) => m.phone.endsWith(t)));
    console.log(`\n=== …${t}: ${chat.length} ===`);
    for (const m of chat.slice(-25)) console.log(`${m.at.slice(0, 16)} ${m.direction === "in" ? "КЛИЕНТ" : "мы    "} [${m.type}/${m.source}] ${(m.text || "").replace(/\s+/g, " ").slice(0, 140)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
