/*
 * Почему бот WhatsApp молчит. ТОЛЬКО ЧТЕНИЕ, ключей не печатает.
 * Печатает настройки бота, есть ли ключи, состояние номера и уведомлений Green
 * API, последние входящие сообщения и по каждому номеру — почему бот промолчал
 * бы сейчас (`botSilenceReason`, та же функция, что в вебхуке).
 *
 * Запуск: npx tsx scripts/diag-bot.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import "../src/lib/timezone";
import { greenConfig } from "../src/lib/greenApi";
import { listBotChats, settingsMap } from "../src/lib/repo/broadcasts";
import { listWaMessages } from "../src/lib/repo/talks";
import { botSettingsFrom, botSilenceReason } from "../src/lib/broadcast";
import { phoneKey } from "../src/lib/leads";

const mask = (p: string) => (p.length > 4 ? `…${p.slice(-4)}` : p);

async function green(method: string): Promise<Record<string, unknown> | string> {
  const cfg = greenConfig();
  if (!cfg) return "нет GREENAPI_*";
  try {
    const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}`, { signal: AbortSignal.timeout(20000) });
    const text = (await res.text()).split(cfg.token).join("***");
    if (!res.ok) return `${res.status} ${text.slice(0, 150)}`;
    return JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    return `ошибка: ${err instanceof Error ? err.message : err}`;
  }
}

async function main() {
  const map = await settingsMap(true);
  const s = botSettingsFrom(map);
  console.log("=== Настройки бота ===");
  console.log(`BotEnabled: «${map.BotEnabled ?? ""}» → включён: ${s.enabled}`);
  console.log(`BotScope: «${map.BotScope ?? ""}» → отвечает: ${s.scope === "all" ? "всем" : "только тем, кому писали рассылкой"}`);
  console.log(`BotHours: «${map.BotHours ?? ""}» → ${s.hours === "offhours" ? `только вне ${s.workFrom}:00–${s.workTo}:00` : "всегда"}`);
  console.log(`Указания боту: ${s.instructions.length} знаков`);
  console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? `есть (длина ${process.env.OPENAI_API_KEY.length})` : "НЕТ"}`);
  console.log(`GREENAPI: ${greenConfig() ? "есть" : "НЕТ"}`);

  console.log("\n=== Green API ===");
  const st = await green("getStateInstance");
  console.log(`состояние: ${typeof st === "string" ? st : String(st.stateInstance)}`);
  const wa = await green("getWaSettings");
  if (typeof wa !== "string") console.log(`номер: ${mask(String(wa.phone || wa.wid || ""))}`);
  const gs = await green("getSettings");
  if (typeof gs === "string") console.log(`getSettings: ${gs}`);
  else {
    const url = String(gs.webhookUrl || "");
    console.log(`webhookUrl: ${url.replace(/\?.*$/, "") || "(ПУСТО)"}`);
    console.log(`webhookUrlToken задан: ${gs.webhookUrlToken ? "да" : "нет"}`);
    for (const k of ["incomingWebhook", "outgoingWebhook", "outgoingMessageWebhook", "outgoingAPIMessageWebhook", "stateWebhook"]) {
      console.log(`${k}: ${String(gs[k] ?? "")}`);
    }
  }

  console.log("\n=== Последние входящие (что дошло до сайта) ===");
  const msgs = await listWaMessages();
  const incoming = msgs.filter((m) => m.direction === "in").sort((a, b) => (a.at < b.at ? 1 : -1));
  console.log(`всего входящих в таблице: ${incoming.length}; последнее: ${incoming[0]?.at ?? "никогда"}`);
  const chats = await listBotChats(true);
  const chatBy = new Map(chats.map((c) => [phoneKey(c.phone), c]));
  console.log(`чатов в памяти бота: ${chats.length}; из них после рассылки (есть наши сообщения): ${chats.filter((c) => c.ourIds.length > 0).length}`);
  const modes = new Map<string, number>();
  for (const c of chats) modes.set(c.mode || "(пусто)", (modes.get(c.mode || "(пусто)") ?? 0) + 1);
  console.log(`режимы чатов: ${Array.from(modes).map(([k, v]) => `${k} ${v}`).join(", ") || "-"}`);

  const seen = new Set<string>();
  const now = new Date();
  const hour = Number(now.toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Almaty" }));
  console.log("\nномер | последнее входящее | текст | бот молчит потому что");
  for (const m of incoming) {
    const key = phoneKey(m.phone);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const chat = chatBy.get(key) ?? null;
    const reason =
      botSilenceReason({ settings: s, chat, messageId: `${m.messageId}-x`, now, hour }) ||
      (!chat && !(s.enabled && s.scope === "all") ? "нет в памяти бота" : "ответил бы");
    console.log(`${mask(m.phone)} | ${m.at.slice(0, 16)} | ${(m.text || `[${m.type}]`).replace(/\s+/g, " ").slice(0, 40)} | ${reason}`);
    if (seen.size >= 15) break;
  }

  // Чаты, тронутые за последние сутки: что бот сказал и почему передал менеджеру.
  const since = Date.now() - 24 * 3600 * 1000;
  const recent = chats.filter((c) => Date.parse(c.updatedAt || "") >= since).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  console.log(`\n=== Чаты за сутки: ${recent.length} ===`);
  for (const c of recent.slice(0, 12)) {
    console.log(
      `\n${mask(c.phone)} · режим ${c.mode || "-"} · ответов бота ${c.botReplies} · передан ${c.handoffAt ? c.handoffAt.slice(0, 16) : "-"} «${c.handoffReason || ""}» · писал менеджер ${c.humanAt ? c.humanAt.slice(0, 16) : "-"}`
    );
    for (const line of c.context.slice(-5)) {
      console.log(`   ${line.at.slice(11, 16)} ${line.role === "us" ? "МЫ " : "КЛ "} ${line.text.replace(/\s+/g, " ").slice(0, 110)}`);
    }
  }
}

main().catch((err) => {
  console.error("ОШИБКА:", err instanceof Error ? err.message : err);
  process.exit(1);
});
