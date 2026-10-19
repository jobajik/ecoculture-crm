/*
 * Номер менеджера: доходят ли входящие. Что пришло в CRM вебхуком, что в журнале Green API за N минут
 * и есть ли уведомления в очереди Green API (смотрит одно, НЕ удаляет). Ничего не меняет.
 * Запуск: npx tsx scripts/diag-line-incoming.ts <код линии> [минут]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listWaLines, managerLineConfig } from "../src/lib/repo/waLines";
import { listWaMessages } from "../src/lib/repo/talks";

async function main() {
  const [code, min] = process.argv.slice(2);
  const minutes = Number(min || 30);
  const line = (await listWaLines({ fresh: true })).find((l) => l.code === code);
  const cfg = managerLineConfig(line);
  if (!line || !cfg) throw new Error("нет линии или ключа");
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const msgs = (await listWaMessages({ lines: "all" })).filter((m) => m.line === code && m.at >= since);
  console.log(`В CRM за ${minutes} мин: ${msgs.length} (вебхуком ${msgs.filter((m) => m.source === "webhook").length}, входящих ${msgs.filter((m) => m.direction === "in").length})`);
  for (const m of msgs.slice(-10)) console.log(`  ${m.at.slice(11, 19)} ${m.direction} ${m.source} …${m.phone.slice(-4)} ${(m.text || "").replace(/\s+/g, " ").slice(0, 60)}`);
  const get = async (method: string, q = "") => {
    const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}${q}`, { signal: AbortSignal.timeout(30000) });
    return (await res.text()).split(cfg.token).join("***");
  };
  const inc = JSON.parse(await get("lastIncomingMessages", `?minutes=${minutes}`)) as unknown[];
  const out = JSON.parse(await get("lastOutgoingMessages", `?minutes=${minutes}`)) as unknown[];
  console.log(`Журнал Green API за ${minutes} мин: входящих ${inc.length}, исходящих ${out.length}`);
  const s = JSON.parse(await get("getSettings")) as Record<string, unknown>;
  console.log(`Адрес уведомлений: ${s.webhookUrl ? "есть" : "ПУСТО"}, incoming=${s.incomingWebhook}`);
  const n = await get("receiveNotification", "?receiveTimeout=5");
  console.log(`Очередь уведомлений: ${n && n !== "null" ? "есть — " + n.replace(/"textMessage":"[^"]*"/g, '"textMessage":"…"').slice(0, 300) : "пусто"}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
