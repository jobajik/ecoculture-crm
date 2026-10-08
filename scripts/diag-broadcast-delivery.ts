import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Дошли ли сообщения рассылки: что у нас записано (вкладка WaStatuses, её пишет вебхук) и что
 * говорит сам Green API (`lastOutgoingMessages` — статус каждого исходящего за сутки). Плюс
 * состояние номера, настройки уведомлений и ответы получателей. Ничего не меняет, ключей и
 * номеров целиком не печатает.
 *
 *   npx tsx scripts/diag-broadcast-delivery.ts [BC-… | --id-file <файл>]
 *
 * 08.10.2026, владелец: «почему в сегодняшней отправке никто не прочитал сообщения?»
 */
import { readFileSync } from "node:fs";
import { greenConfig } from "../src/lib/greenApi";
import { listRecipients, listWaStatuses } from "../src/lib/repo/broadcasts";
import { listWaMessages } from "../src/lib/repo/talks";
import { phoneKey } from "../src/lib/leads";

async function get(method: string, query = ""): Promise<unknown> {
  const cfg = greenConfig();
  if (!cfg) throw new Error("нет ключей Green API");
  const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}${query}`, { signal: AbortSignal.timeout(30000) });
  const text = (await res.text()).split(cfg.token).join("***");
  if (!res.ok) throw new Error(`${method}: ${res.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

const tail = (p: string) => `…${p.replace(/\D/g, "").slice(-4)}`;

async function main() {
  const args = process.argv.slice(2);
  const fi = args.indexOf("--id-file");
  const id = (fi >= 0 ? readFileSync(args[fi + 1], "utf8").trim() : "") || args.find((a) => a.startsWith("BC-")) || "";
  if (!id) throw new Error("Укажите рассылку");

  const st = (await get("getStateInstance")) as { stateInstance?: string };
  console.log(`Номер: ${st.stateInstance}`);
  const s = (await get("getSettings")) as Record<string, unknown>;
  for (const k of ["webhookUrl", "outgoingWebhook", "outgoingAPIMessageWebhook", "incomingWebhook"]) console.log(`  ${k}: ${String(s[k] ?? "")}`);

  const sent = (await listRecipients(true)).filter((r) => r.broadcastId === id && r.status === "sent");
  const errors = (await listRecipients()).filter((r) => r.broadcastId === id && r.status === "error");
  console.log(`\nРассылка ${id}: отправлено ${sent.length}, с ошибкой ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  ошибка ${tail(e.phone)}: ${e.error}`);

  const ours = new Map<string, string>();
  for (const w of await listWaStatuses()) ours.set(w.messageId, w.status);
  const byOurs = new Map<string, number>();
  for (const r of sent) {
    const k = ours.get(r.messageId) || "(нет статуса)";
    byOurs.set(k, (byOurs.get(k) ?? 0) + 1);
  }
  console.log("По нашей таблице (WaStatuses):");
  for (const [k, n] of byOurs) console.log(`  ${k}: ${n}`);

  try {
    const last = (await get("lastOutgoingMessages", "?minutes=1440")) as { idMessage: string; statusMessage?: string; chatId?: string; sendByApi?: boolean }[];
    const theirs = new Map(last.map((m) => [m.idMessage, m.statusMessage || "?"]));
    const byTheirs = new Map<string, number>();
    for (const r of sent) {
      const k = theirs.get(r.messageId) || "(нет в последних)";
      byTheirs.set(k, (byTheirs.get(k) ?? 0) + 1);
    }
    console.log("По Green API (lastOutgoingMessages):");
    for (const [k, n] of byTheirs) console.log(`  ${k}: ${n}`);
    console.log("Подробно:");
    for (const r of sent) console.log(`  ${tail(r.phone)} · ${r.sentAt.slice(11, 16)} · наш: ${ours.get(r.messageId) || "—"} · Green API: ${theirs.get(r.messageId) || "—"}`);
  } catch (e) {
    console.log(`lastOutgoingMessages: ${e instanceof Error ? e.message : e}`);
  }

  const keys = new Set(sent.map((r) => phoneKey(r.phone)));
  const since = sent.reduce((m, r) => (r.sentAt < m ? r.sentAt : m), "9999");
  const replies = (await listWaMessages()).filter((m) => m.direction === "in" && keys.has(phoneKey(m.phone)) && m.at >= since);
  console.log(`\nОтветили после рассылки: ${new Set(replies.map((m) => phoneKey(m.phone))).size} (сообщений ${replies.length})`);
  for (const m of replies.slice(0, 15)) console.log(`  ${tail(m.phone)} · ${m.at.slice(11, 16)} · ${m.text.slice(0, 60)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
