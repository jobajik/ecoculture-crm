/*
 * Номер Земфиры (лиды с рекламы) в Green API — второй номер, только для переписки в CRM.
 * Запускает zemfira-whatsapp-key.bat после того, как владелец вписал ключи (GREENAPI_LEADS_*).
 *
 * Что делает:
 *   1. спрашивает у Green API, подключён ли номер (отсканирован ли QR-код);
 *   2. прописывает адрес уведомлений `…/api/whatsapp/webhook?line=leads` и тот же токен,
 *      что у рабочего номера (WHATSAPP_WEBHOOK_TOKEN);
 *   3. с `--import-days N` дописывает в CRM переписку за последние N дней (до 3), которой там
 *      ещё нет, — чтобы в карточках её лидов была история с первого дня.
 *
 * Ключи НЕ печатает — только «есть / нет» и длину. С номера ничего не отправляется.
 * Запуск: npx tsx scripts/whatsapp-setup-leads.ts [--import-days 3]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { configureWebhook, getInstanceState, greenLeadsConfig } from "../src/lib/greenApi";
import { parseHistoryItem } from "../src/lib/whatsapp";
import { appendWaMessages, listWaMessages } from "../src/lib/repo/talks";
import type { WaMessage } from "../src/lib/types";

const SITE = "https://www.crm-ecoculture.kz";
const len = (v?: string) => (v && v.trim() ? `есть (${v.trim().length} симв.)` : "НЕТ");

async function main() {
  console.log("=== Ключи номера Земфиры ===");
  console.log(`GREENAPI_LEADS_URL:      ${process.env.GREENAPI_LEADS_URL ? process.env.GREENAPI_LEADS_URL.trim() : "нет (будет https://api.green-api.com)"}`);
  console.log(`GREENAPI_LEADS_INSTANCE: ${len(process.env.GREENAPI_LEADS_INSTANCE)}`);
  console.log(`GREENAPI_LEADS_TOKEN:    ${len(process.env.GREENAPI_LEADS_TOKEN)}`);
  const cfg = greenLeadsConfig();
  if (!cfg) throw new Error("Нет GREENAPI_LEADS_INSTANCE или GREENAPI_LEADS_TOKEN — впишите их в zemfira-whatsapp-key.bat");
  if (cfg.instance === (process.env.GREENAPI_INSTANCE || "").trim()) throw new Error("Это номер рабочего WhatsApp, а не Земфиры — проверьте idInstance");

  const state = await getInstanceState(cfg);
  console.log(`\nСостояние номера: ${state}${state === "authorized" ? " — подключён" : " — отсканируйте QR-код телефоном Земфиры в кабинете Green API"}`);

  const token = (process.env.WHATSAPP_WEBHOOK_TOKEN || "").trim();
  if (!token) throw new Error("Нет WHATSAPP_WEBHOOK_TOKEN — сначала рабочий номер (whatsapp-key.bat)");
  await configureWebhook(cfg, `${SITE}/api/whatsapp/webhook?line=leads`, token);
  console.log(`Уведомления: ${SITE}/api/whatsapp/webhook?line=leads — прописано (применится в течение 5 минут).`);

  const at = process.argv.indexOf("--import-days");
  const days = at >= 0 ? Math.min(3, Math.max(0, Number(process.argv[at + 1]) || 0)) : 0;
  if (!days || state !== "authorized") return;
  const minutes = days * 1440;
  const get = async (method: string) => {
    const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}?minutes=${minutes}`, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`${method}: Green API ответил ${res.status}`);
    const body = (await res.json()) as unknown[];
    return Array.isArray(body) ? body : [];
  };
  const items = [
    ...(await get("lastIncomingMessages")).map((i) => ({ ...(i as object), type: "incoming" })),
    ...(await get("lastOutgoingMessages")).map((i) => ({ ...(i as object), type: "outgoing" })),
  ];
  const known = new Set((await listWaMessages({ lines: "all" })).map((m) => m.messageId));
  const fresh: WaMessage[] = items
    .map(parseHistoryItem)
    .filter((m): m is WaMessage => !!m && !known.has(m.messageId))
    .map((m) => ({ ...m, line: "leads" }));
  console.log(`\nПереписка за ${days} дн.: в Green API ${items.length}, новых для CRM ${fresh.length} (группы и служебные не берутся).`);
  if (fresh.length) await appendWaMessages(fresh);
  console.log("Записано.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
