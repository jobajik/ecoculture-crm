import { configureWebhook, getInstanceState, greenLeadsConfig } from "./greenApi";
import { parseHistoryItem } from "./whatsapp";
import { appendWaMessages, listWaMessages } from "./repo/talks";
import type { WaMessage } from "./types";

/**
 * Подключение номера Земфиры (второй инстанс Green API): проверить QR, прописать адрес
 * уведомлений `…/api/whatsapp/webhook?line=leads` с токеном рабочего номера и, по желанию,
 * дописать переписку за последние дни (до 3). Зовут скрипт `whatsapp-setup-leads.ts` (с ПК)
 * и страница `/api/whatsapp/leads-setup` (админ из браузера — 15.10.2026, владелец был не
 * дома: ключи вписал прямо в Vercel). Ключи не возвращает — только «есть / нет».
 */
export async function setupLeadsLine(site: string, importDays = 0): Promise<string[]> {
  const out: string[] = [];
  const cfg = greenLeadsConfig();
  if (!cfg) {
    out.push("Нет ключей номера Земфиры (GREENAPI_LEADS_INSTANCE и GREENAPI_LEADS_TOKEN).");
    return out;
  }
  if (cfg.instance === (process.env.GREENAPI_INSTANCE || "").trim()) {
    out.push("Это idInstance рабочего номера, а не Земфиры — проверьте ключи.");
    return out;
  }
  out.push(`Ключи номера Земфиры: есть (idInstance ${cfg.instance.length} цифр, адрес ${cfg.url}).`);

  const state = await getInstanceState(cfg);
  out.push(`Состояние номера: ${state}${state === "authorized" ? " — подключён" : " — отсканируйте QR-код телефоном Земфиры в кабинете Green API"}`);

  const token = (process.env.WHATSAPP_WEBHOOK_TOKEN || "").trim();
  if (!token) {
    out.push("Нет WHATSAPP_WEBHOOK_TOKEN — сначала рабочий номер.");
    return out;
  }
  await configureWebhook(cfg, `${site}/api/whatsapp/webhook?line=leads`, token);
  out.push(`Уведомления: ${site}/api/whatsapp/webhook?line=leads — прописано (заработает в течение 5 минут).`);

  const days = Math.min(3, Math.max(0, importDays));
  if (!days || state !== "authorized") return out;
  const minutes = days * 1440;
  const get = async (method: string) => {
    const res = await fetch(`${cfg.url}/waInstance${cfg.instance}/${method}/${cfg.token}?minutes=${minutes}`, {
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
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
  if (fresh.length) await appendWaMessages(fresh);
  out.push(`Переписка за ${days} дн.: в Green API ${items.length}, дописано в CRM ${fresh.length} (группы и служебные не берутся).`);
  return out;
}
