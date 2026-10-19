/*
 * Номер менеджера: куда Green API шлёт уведомления и что лежит в его журнале. Ничего не меняет,
 * токены не печатает. Запуск: npx tsx scripts/diag-line-hook.ts [код линии] [минут журнала]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { listWaLines, managerLineConfig } from "../src/lib/repo/waLines";

async function main() {
  const code = process.argv[2] || "";
  const minutes = Number(process.argv[3] || 1440);
  const lines = (await listWaLines({ fresh: true })).filter((l) => !code || l.code === code);
  for (const l of lines) {
    const cfg = managerLineConfig(l);
    console.log(`\n=== ${l.code} (${l.label}) ===`);
    if (!cfg) {
      console.log("нет ключей");
      continue;
    }
    const get = async (method: string, query = "") => {
      const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}${query}`, { signal: AbortSignal.timeout(30000) });
      const text = (await res.text()).split(cfg.token).join("***");
      if (!res.ok) throw new Error(`${method}: ${res.status} ${text.slice(0, 200)}`);
      return JSON.parse(text) as unknown;
    };
    try {
      const s = (await get("getSettings")) as Record<string, unknown>;
      const hook = String(s.webhookUrl || "");
      console.log(`webhookUrl: ${hook ? hook.replace(/\?.*$/, "") + (hook.includes("?") ? "?" + hook.split("?")[1] : "") : "ПУСТО"}`);
      console.log(`токен уведомлений: ${s.webhookUrlToken ? "есть" : "нет"}`);
      for (const k of ["incomingWebhook", "outgoingMessageWebhook", "outgoingAPIMessageWebhook", "outgoingWebhook", "markIncomingMessagesReaded"]) console.log(`${k}: ${s[k]}`);
    } catch (e) {
      console.log(`getSettings: ${e instanceof Error ? e.message : e}`);
    }
    for (const m of ["lastIncomingMessages", "lastOutgoingMessages"]) {
      try {
        const items = (await get(m, `?minutes=${minutes}`)) as { chatId?: string; timestamp?: number; typeMessage?: string }[];
        const chats = new Set(items.map((i) => i.chatId));
        const last = items.map((i) => i.timestamp || 0).sort((a, b) => b - a)[0];
        console.log(`${m} за ${minutes} мин: ${items.length} сообщ., чатов ${chats.size}${last ? `, последнее ${new Date(last * 1000).toISOString()}` : ""}`);
      } catch (e) {
        console.log(`${m}: ${e instanceof Error ? e.message : e}`);
      }
    }
    try {
      const chats = (await get("getChats")) as { id?: string }[];
      const personal = chats.filter((c) => String(c.id || "").endsWith("@c.us"));
      console.log(`getChats: всего ${chats.length}, личных ${personal.length}`);
    } catch (e) {
      console.log(`getChats: ${e instanceof Error ? e.message : e}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
