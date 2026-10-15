import { configureWebhook, fetchChatHistory, getInstanceState, greenLeadsConfig } from "./greenApi";
import { mergeMessages, parseHistoryItem } from "./whatsapp";
import { phoneKey } from "./leads";
import { listLeads, updateLeadsBatch } from "./repo/leads";
import { namedFromWhatsApp } from "./waAutoLead";
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

/**
 * Дотянуть ПОЛНУЮ переписку чатов Земфиры из Green API (`getChatHistory`). Журнал Green API
 * (`lastIncomingMessages`) пуст за время до подключения номера — 15.10.2026 из 540 подтянутых
 * сообщений входящих не было ни одного, и все 48 чатов выглядели «писала только она». Берёт чаты,
 * где ответов клиента ещё нет, по одному в 1,1 с (чаще Green API отвечает 429), пока не кончится
 * `budgetMs`; потом лидам с именем-заглушкой ставит имя из WhatsApp. Повторный запуск дотягивает
 * оставшееся, уже записанное не дублирует.
 */
export async function pullLeadsHistory(budgetMs = 45000, offset = 0): Promise<string[]> {
  const out: string[] = [];
  const cfg = greenLeadsConfig();
  if (!cfg) return ["Нет ключей номера Земфиры."];
  const started = Date.now();
  const all = await listWaMessages({ lines: "all" });
  const known = new Set(all.map((m) => m.messageId));
  const line = all.filter((m) => m.line === "leads");
  const byKey = new Map<string, { phone: string; hasIn: boolean }>();
  for (const m of line) {
    const key = phoneKey(m.phone);
    if (!key) continue;
    const cur = byKey.get(key) ?? { phone: m.phone, hasIn: false };
    if (m.direction === "in") cur.hasIn = true;
    byKey.set(key, cur);
  }
  // Чаты, где клиент так и не ответил, остаются в списке и после проверки — `offset` сдвигает начало, чтобы
  // следующий проход брал следующие чаты, а не те же 35 (15.10.2026: два прохода подряд проверили одни и те же).
  const todo = Array.from(byKey.values()).filter((c) => !c.hasIn).slice(Math.max(0, offset));
  const fresh: WaMessage[] = [];
  let done = 0;
  for (const chat of todo) {
    if (Date.now() - started > budgetMs) break;
    try {
      const history = await fetchChatHistory(cfg, chat.phone, 100);
      for (const m of history) {
        if (known.has(m.messageId)) continue;
        known.add(m.messageId);
        fresh.push({ ...m, line: "leads" });
      }
    } catch (err) {
      out.push(`Чат …${chat.phone.slice(-4)}: ${err instanceof Error ? err.message : err}`);
    }
    done++;
    await new Promise((r) => setTimeout(r, 1100));
  }
  if (fresh.length) await appendWaMessages(fresh);
  out.push(`История чатов: к проверке ${todo.length} (с ${offset + 1}-го), проверено ${done}, дописано сообщений ${fresh.length}.`);
  if (done < todo.length) out.push(`Осталось ${todo.length - done} чатов — откройте с &offset=${offset + done}.`);

  // Имена из WhatsApp лидам, заведённым до первого ответа клиента.
  const merged = [...line, ...fresh];
  const lastName = new Map<string, string>();
  for (const m of mergeMessages(merged)) if (m.direction === "in" && m.senderName) lastName.set(phoneKey(m.phone), m.senderName);
  const leads = await listLeads({ fresh: true });
  const renames = leads
    .map((l) => {
      const sender = lastName.get(phoneKey(l.phone));
      const named = sender ? namedFromWhatsApp(l, { direction: "in", senderName: sender }) : null;
      return named ? { leadId: l.leadId, changes: named } : null;
    })
    .filter((x): x is { leadId: string; changes: { Name: string; ContactPerson: string } } => !!x);
  const renamed = await updateLeadsBatch(renames);
  out.push(`Лидам с именем «Клиент WhatsApp …» поставлено имя из WhatsApp: ${renamed}.`);
  return out;
}
