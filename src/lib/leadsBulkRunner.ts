import { prefetchTables, SHEET_TABS } from "./sheets";
import { localDayKey } from "./timezone";
import { listWaMessages } from "./repo/talks";
import { listUsers } from "./repo/users";
import { listWaLines, managerLineConfig } from "./repo/waLines";
import { createBroadcast, optedOutKeys, settingsMap } from "./repo/broadcasts";
import { listSellableBatches } from "./repo/sellable";
import { getSettings } from "./repo/settings";
import { getCurrentPrices } from "./repo/prices";
import { greenConfig, greenLeadsConfig } from "./greenApi";
import { ourPhoneKeys } from "./lineNotify";
import { chatFacts, leadReminderText } from "./autoBroadcast";
import { BROADCAST_STATUSES, greetingName, waPhone } from "./broadcast";
import { phoneKey } from "./leads";
import { genitiveName, LEADS_LINE, isManagerLine } from "./waLines";
import { assistantAnswer } from "./lineAssistant";
import { startsWithGreeting } from "./assistantText";
import { mergeMessages, messageText } from "./whatsapp";
import { stockMap } from "./botKnowledge";
import { inStore } from "./officeStore";
import { priceFor } from "./priceList";
import { FLOWER_TYPE_LABELS, formatGrade, isLiquidGrade, ROLES } from "./constants";
import { parsePush, pushItemFor, SALES_PUSH_SETTING } from "./salesPush";
import { pickNudgeOffers, type NudgeOffer } from "./botNudge";
import { ROTATION_FILE } from "./botPhotos";
import { SITE } from "./broadcastSend";
import { kickBroadcast } from "./autoBroadcastRunner";
import { BULK_AI_MAX, BULK_AI_TASK, BULK_MAX, bulkName, bulkSendRefusal, lineTitle, pickSendLine, type BulkMode } from "./leadsBulk";
import type { Lead } from "./types";

// ---------------------------------------------------------------------------
// Массовое «написать выделенным» с доски лидов (`leadsBulk.ts`). Не шлёт само: собирает рассылку на каждый номер
// отправки (номер Земфиры, номер менеджера, рабочий) с личным текстом каждому и ставит её «идёт» — дальше её ведёт
// цепочка рассылок (темп, пределы, разогрев, «ответьте цифрой» бота). Текст: «ИИ» — помощник читает переписку лида и
// пишет одно короткое сообщение (нет переписки — текст кода с ценами); «Фото и цены» — текст кода: приветствие,
// две ходовые позиции (названная в переписке — первой) и вопрос; «Свой текст» — как написал человек, с {имя}.
// К каждому — фото из ротации (владелец, 20.10.2026: «мало шлёшь фоток»).
// ---------------------------------------------------------------------------

export interface BulkMessageResult {
  created: { broadcastId: string; title: string; count: number; line: string }[];
  skipped: { name: string; why: string }[];
  aiCount: number;
}

const label = (o: Pick<NudgeOffer, "flowerType" | "variety" | "grade">) => `${FLOWER_TYPE_LABELS[o.flowerType] ?? o.flowerType} ${o.variety}, ${formatGrade(o.grade)}`;
const firstName = (name: string) => (name || "").trim().split(/\s+/)[0] || "";

/** Что из цветов упоминали в переписке — чтобы первой предложить названную позицию. */
function mentionedIn(chat: { type: string; text: string }[]): string {
  return chat
    .map((m) => messageText(m))
    .join(" ")
    .slice(-1500);
}

export async function bulkMessageLeads(input: {
  leads: Lead[];
  mode: BulkMode;
  text: string;
  withPhoto: boolean;
  byEmail: string;
  role: string | null | undefined;
}): Promise<BulkMessageResult> {
  const result: BulkMessageResult = { created: [], skipped: [], aiCount: 0 };
  const max = input.mode === "ai" ? BULK_AI_MAX : BULK_MAX;
  const leads = input.leads.slice(0, max);
  for (const extra of input.leads.slice(max)) result.skipped.push({ name: bulkName(extra), why: `больше ${max} за раз — повторите для остальных` });
  if (leads.length === 0) return result;

  await prefetchTables([SHEET_TABS.WA_MESSAGES, SHEET_TABS.USERS, SHEET_TABS.WA_LINES, SHEET_TABS.SETTINGS, SHEET_TABS.BATCHES, SHEET_TABS.PRICE_HISTORY, SHEET_TABS.BOT_CHATS]).catch(() => undefined);
  const [messages, users, lines, map, optedOut, batches, shelf, prices] = await Promise.all([
    listWaMessages({ lines: "all" }),
    listUsers().catch(() => []),
    listWaLines().catch(() => []),
    settingsMap(),
    optedOutKeys(),
    listSellableBatches(),
    getSettings(),
    getCurrentPrices(localDayKey()),
  ]);
  const staff = await ourPhoneKeys(map);
  const facts = chatFacts(messages);
  const lineOf = new Map(lines.map((l) => [l.code, l]));
  const lineOk = (line: string) => (line === "" ? !!greenConfig() : line === LEADS_LINE ? !!greenLeadsConfig() : isManagerLine(line) ? !!managerLineConfig(lineOf.get(line)) : false);
  const managerLines = new Map(lines.filter((l) => l.active && l.managerEmail).map((l) => [l.managerEmail.toLowerCase(), l.code]));
  const nameOf = (email: string) => firstName(users.find((u) => u.email.toLowerCase() === (email || "").toLowerCase())?.name || "");
  const zemfira = users.find((u) => u.active && u.role === ROLES.LEADGEN);
  const managerOfLine = (line: string) => (line === LEADS_LINE ? firstName(zemfira?.name || "") : isManagerLine(line) ? nameOf(lineOf.get(line)?.managerEmail || "") : "");

  // Цены и склад — как у автопилота: основной склад, прайс клиента, «распродаём» — первым после спрошенного.
  const stock = Array.from(stockMap(inStore(batches, ""), shelf, new Date()).values());
  const push = parsePush(map[SALES_PUSH_SETTING]);
  const offersFor = (mentioned: string) =>
    pickNudgeOffers({ stock, priceOf: (f, v, g) => priceFor(prices, f, v, g), mentioned, isLiquid: isLiquidGrade, isPush: (f, g) => !!pushItemFor(push, f, g) }).slice(0, 2);

  type Planned = { lead: Lead; phone: string; line: string; chat: ReturnType<typeof mergeMessages> };
  const planned: Planned[] = [];
  const seen = new Set<string>();
  for (const lead of leads) {
    const phone = waPhone(lead.phone);
    const key = phoneKey(phone);
    const f = facts.get(key);
    const line = pickSendLine({ facts: f, lead, role: input.role, managerLines, lineOk });
    const why = bulkSendRefusal(lead, phone, line, { staff, optedOut, lineOk });
    if (why || seen.has(key)) {
      result.skipped.push({ name: bulkName(lead), why: why || "номер повторяется" });
      continue;
    }
    seen.add(key);
    planned.push({ lead, phone, line, chat: mergeMessages(messages.filter((m) => m.line === line && phoneKey(m.phone) === key)) });
  }

  // Текст каждому. ИИ — по четыре разом: серверное действие живёт минуту.
  const texts = new Map<string, string>();
  const codeText = (p: Planned) => leadReminderText({ draft: "", manager: managerOfLine(p.line), offers: offersFor(mentionedIn(p.chat)), label });
  if (input.mode === "text") {
    for (const p of planned) texts.set(p.lead.leadId, input.text.trim());
  } else if (input.mode === "offer") {
    for (const p of planned) texts.set(p.lead.leadId, codeText(p));
  } else {
    const queue = [...planned];
    const worker = async () => {
      for (;;) {
        const p = queue.shift();
        if (!p) return;
        if (p.chat.length === 0) {
          texts.set(p.lead.leadId, codeText(p));
          continue;
        }
        try {
          const a = await assistantAnswer(p.chat, p.phone, managerOfLine(p.line), BULK_AI_TASK, p.line);
          if (!a.silent && a.reply) {
            texts.set(p.lead.leadId, startsWithGreeting(a.reply) ? a.reply : `Здравствуйте! ${a.reply}`);
            result.aiCount++;
          } else texts.set(p.lead.leadId, codeText(p));
        } catch (err) {
          console.error("bulk ai:", err instanceof Error ? err.message : err);
          texts.set(p.lead.leadId, codeText(p));
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  // Рассылка на каждый номер отправки — сразу «идёт».
  const byLine = new Map<string, Planned[]>();
  for (const p of planned) byLine.set(p.line, [...(byLine.get(p.line) ?? []), p]);
  const today = localDayKey();
  const dmy = `${today.slice(8, 10)}.${today.slice(5, 7)}`;
  const modeTitle = input.mode === "ai" ? "ИИ" : input.mode === "offer" ? "фото и цены" : "текст";
  for (const [line, list] of Array.from(byLine.entries())) {
    const who = managerOfLine(line);
    const title = `Доска лидов · ${modeTitle} · ${lineTitle(line, who ? genitiveName(who) : "")} · ${dmy}`;
    const recipients = list.map((p) => ({
      phone: p.phone,
      name: /^Клиент WhatsApp/i.test(p.lead.name.trim()) ? "" : greetingName(p.lead.contactPerson, p.lead.name),
      kind: "lead",
      refId: p.lead.leadId,
      managerEmail: p.lead.managerEmail,
      text: texts.get(p.lead.leadId) || "",
    }));
    const id = await createBroadcast({
      createdByEmail: input.byEmail,
      title,
      text: recipients[0]?.text || "",
      fileId: input.withPhoto ? ROTATION_FILE : "",
      fileName: input.withPhoto ? "Фото из ротации" : "",
      audience: `С доски лидов: выделенные (${recipients.length})`,
      recipients,
      line,
      status: BROADCAST_STATUSES.SENDING,
    });
    result.created.push({ broadcastId: id, title, count: recipients.length, line });
  }
  if (result.created.length > 0) await kickBroadcast(SITE()).catch(() => undefined);
  return result;
}
