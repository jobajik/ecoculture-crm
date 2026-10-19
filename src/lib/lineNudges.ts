import { listSellableBatches } from "./repo/sellable";
import { commitAtomic, prefetchTables, SHEET_TABS } from "./sheets";
import { listWaMessages } from "./repo/talks";
import { listAssistantLog, listWaLines, appendAssistantLog } from "./repo/waLines";
import { settingsMap } from "./repo/broadcasts";
import { getSettings, saveSettings } from "./repo/settings";
import { getCurrentPrices } from "./repo/prices";
import { listOrdersWithItems } from "./repo/orders";
import { loadPhotoContext } from "./botPhotoSend";
import { nudgePhotoQuestion, photoLabel, photoMessage, pickItemPhoto, type BotPhoto } from "./botPhotos";
import { photoFileUrl } from "./catalogFiles";
import { botPhotoSentWrite } from "./repo/botPhotos";
import { NUDGE_DECISION_SCHEMA, NUDGE_GAPS_HOURS, nudgeDecisionPrompt, nudgeText, parseNudgeDecision, pickNudgeOffers } from "./botNudge";
import { chatJson, openAiConfigured } from "./openai";
import { stockMap } from "./botKnowledge";
import { almatyHourOf, botStoreFor, inStore } from "./officeStore";
import { priceFor } from "./priceList";
import { parsePush, pushItemFor, SALES_PUSH_SETTING } from "./salesPush";
import { FLOWER_TYPE_LABELS, formatGrade, isLiquidGrade, ORDER_STATUSES } from "./constants";
import { phoneKey } from "./leads";
import { mergeMessages, messageText } from "./whatsapp";
import { ourPhoneKeys } from "./lineNotify";
import { lineNudgeStatus } from "./lineSellerRules";
import { sendLineNudge } from "./lineSeller";
import type { WaMessage } from "./types";

// ---------------------------------------------------------------------------
// Дожим молчащих на номере менеджера (19.10.2026, владелец выбрал для Ильяса «дожим молчащих клиентов»).
// Те же правила, что у бота основного номера (`botNudge.ts`): клиент проявлял интерес и замолчал — два
// касания, через 3 ч и назавтра, днём; писать ли — решает модель узким вопросом (по умолчанию — нет);
// текст и цены собирает код из склада и прайса; первое касание — с фото позиции, если оно есть.
// Только номера в режиме «продаёт сам». Не чаще раза в 20 минут (метка `LineNudgeLastRun`).
// ---------------------------------------------------------------------------

const LAST_RUN = "LineNudgeLastRun";
const GAP_MIN = 20;
const PER_RUN = 5;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runLineNudges(options: { budgetMs?: number } = {}): Promise<{ sent: number; closed: number; errors: number; note?: string }> {
  const out = { sent: 0, closed: 0, errors: 0 };
  const started = Date.now();
  const budget = options.budgetMs ?? 20000;
  if (!openAiConfigured()) return out;
  const lines = (await listWaLines()).filter((l) => l.active && l.assistant === "sell");
  if (lines.length === 0) return out;
  const now = new Date();
  const hour = almatyHourOf(now);
  if (hour < 9 || hour >= 20) return { ...out, note: "не рабочее время" };
  const map = await settingsMap(true);
  const lastRun = Date.parse((map[LAST_RUN] || "").slice(0, 24));
  if (Number.isFinite(lastRun) && now.getTime() - lastRun < GAP_MIN * 60000) return { ...out, note: "недавно" };
  await saveSettings({ [LAST_RUN]: now.toISOString() }).catch(() => undefined);

  await prefetchTables([SHEET_TABS.WA_MESSAGES, SHEET_TABS.ASSISTANT_LOG, SHEET_TABS.ORDERS, SHEET_TABS.ORDER_ITEMS, SHEET_TABS.CLIENTS]).catch(() => undefined);
  const [messages, log, orders, staff] = await Promise.all([listWaMessages({ lines: "all" }), listAssistantLog({ fresh: true }), listOrdersWithItems(), ourPhoneKeys(map)]);
  const orderAt = new Map<string, string[]>();
  for (const o of orders) {
    if (o.status === ORDER_STATUSES.CANCELLED) continue;
    const k = phoneKey(o.clientPhone);
    if (k) orderAt.set(k, [...(orderAt.get(k) ?? []), o.createdAt]);
  }

  type Due = { line: (typeof lines)[number]; phone: string; chat: WaMessage[]; attempt: number };
  const due: Due[] = [];
  for (const line of lines) {
    const byKey = new Map<string, WaMessage[]>();
    for (const m of messages) {
      if (m.line !== line.code) continue;
      const k = phoneKey(m.phone);
      if (k) byKey.set(k, [...(byKey.get(k) ?? []), m]);
    }
    for (const [k, chat] of Array.from(byKey.entries())) {
      const nudges = log
        .filter((r) => r.kind === "nudge" && r.line === line.code && phoneKey(r.phone) === k)
        .map((r) => ({ at: r.at, closed: !r.messageId && /^не писать/.test(r.note) }));
      const st = lineNudgeStatus({ chat, nudges, now, hour, staff: staff.has(k), orderAt: orderAt.get(k) });
      if (st.attempt > 0) due.push({ line, phone: chat[chat.length - 1].phone, chat: mergeMessages(chat), attempt: st.attempt });
    }
  }
  if (due.length === 0) return out;
  due.sort((a, b) => a.attempt - b.attempt);

  const [batches, shelf, prices] = await Promise.all([listSellableBatches(), getSettings(), getCurrentPrices()]);
  const push = parsePush(map[SALES_PUSH_SETTING]);
  const officeLive = stockMap(inStore(batches, "office"), shelf, now);
  const stock = Array.from((botStoreFor(hour, officeLive.size > 0) === "office" ? officeLive : stockMap(inStore(batches, ""), shelf, now)).values());
  const label = (o: { flowerType: string; variety: string; grade: string }) => `${FLOWER_TYPE_LABELS[o.flowerType] ?? o.flowerType} ${o.variety}, ${formatGrade(o.grade)}`;
  let photoCtx: Awaited<ReturnType<typeof loadPhotoContext>> | null = null;

  for (const d of due.slice(0, PER_RUN)) {
    if (Date.now() - started > budget) break;
    try {
      const transcriptText = d.chat
        .slice(-24)
        .map((m) => `${m.direction === "in" ? "Клиент" : "Мы"}: ${messageText(m)}`)
        .join("\n");
      const { data } = await chatJson(nudgeDecisionPrompt({ managerLine: true }), `Переписка:\n${transcriptText}`, "nudge_decision", NUDGE_DECISION_SCHEMA as unknown as Record<string, unknown>, {
        fast: true,
      });
      const decision = parseNudgeDecision(data);
      if (!decision.nudge) {
        await appendAssistantLog([{ at: new Date().toISOString(), line: d.line.code, phone: d.phone, kind: "nudge", messageId: "", text: "", note: `не писать: ${decision.reason}`.slice(0, 300), byEmail: "assistant" }]);
        out.closed += 1;
        continue;
      }
      const clientText = d.chat.filter((m) => m.direction === "in").map((m) => messageText(m)).join("\n");
      const offers = pickNudgeOffers({
        stock,
        priceOf: (f, v, g) => priceFor(prices, f, v, g),
        mentioned: transcriptText,
        isLiquid: isLiquidGrade,
        clientText,
        isPush: (f, g) => !!pushItemFor(push, f, g),
      });
      if (out.sent > 0) await pause(3000 + Math.floor(Math.random() * 4000));
      // Первое касание — фото той позиции, о которой шла речь, с ценой; нет фото — текст. Последнее — мягко.
      let file: { url: string; name: string; caption: string; memo: string } | undefined;
      if (d.attempt < NUDGE_GAPS_HOURS.length && offers.length) {
        photoCtx ??= await loadPhotoContext();
        const pic = pickItemPhoto(photoCtx.photos, offers[0], transcriptText, []);
        if (pic) {
          const caption = photoMessage({ caption: pic.caption, prices: offers.slice(0, 1).map((o) => ({ label: label(o), price: o.price })), question: nudgePhotoQuestion(d.attempt) });
          file = { url: photoFileUrl(pic), name: pic.fileName || "photo.jpg", caption, memo: `[фото: ${photoLabel(pic)}] ${caption}` };
          await commitAtomic([botPhotoSentWrite(pic as BotPhoto & { rowNumber: number })]).catch(() => undefined);
        }
      }
      await sendLineNudge(d.line, d.phone, file ? { text: "", file } : { text: nudgeText(d.attempt, offers, label) });
      out.sent += 1;
    } catch (err) {
      console.error("line nudge:", err instanceof Error ? err.message : err);
      out.errors += 1;
    }
  }
  return out;
}
