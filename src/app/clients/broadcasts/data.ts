import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { listBroadcasts, listRecipients, listWaStatuses, optedOutKeys } from "@/lib/repo/broadcasts";
import { listWaMessages } from "@/lib/repo/talks";
import { mergeMessages } from "@/lib/whatsapp";
import { broadcastTotals, deliveryByMessage, recipientViews, type BroadcastTotals, type RecipientView } from "@/lib/broadcast";
import { listChannels, pickWhatsappChannel, wazzupConfigured } from "@/lib/wazzupApi";
import { CHANNEL_STATE_TEXT } from "@/lib/wazzup";
import type { Broadcast } from "@/lib/repo/broadcasts";

/** Всё для страниц рассылок — одним batchGet (грабли 1.17). */
export async function loadBroadcastData(): Promise<{
  broadcasts: (Broadcast & { totals: BroadcastTotals })[];
  views: RecipientView[];
  optedOut: Set<string>;
}> {
  await prefetchTables([
    SHEET_TABS.BROADCASTS,
    SHEET_TABS.BROADCAST_RECIPIENTS,
    SHEET_TABS.WA_STATUSES,
    SHEET_TABS.WA_MESSAGES,
    SHEET_TABS.BOT_CHATS,
  ]);
  const [broadcasts, recipients, statuses, messages, optedOut] = await Promise.all([
    listBroadcasts(),
    listRecipients(),
    listWaStatuses(),
    listWaMessages(),
    optedOutKeys(),
  ]);
  const views = recipientViews(recipients, deliveryByMessage(statuses), mergeMessages(messages));
  return {
    broadcasts: broadcasts.map((b) => ({
      ...b,
      totals: broadcastTotals(
        views.filter((v) => v.broadcastId === b.broadcastId),
        optedOut
      ),
    })),
    views,
    optedOut,
  };
}

export interface ChannelInfo {
  ok: boolean;
  text: string;
}

/** Состояние WhatsApp в Wazzup — одной строкой для шапки. Никогда не бросает. */
export async function channelInfo(): Promise<ChannelInfo> {
  if (!wazzupConfigured()) return { ok: false, text: "Wazzup не подключён — ключ вводится в wazzup-key.bat" };
  try {
    const channel = pickWhatsappChannel(await listChannels());
    if (!channel) return { ok: false, text: "В Wazzup нет канала WhatsApp" };
    if (channel.transport !== "whatsapp") return { ok: false, text: "Канал Wazzup — WABA: для рассылок нужны шаблоны, их пока не поддерживаем" };
    const phone = channel.plainId ? `+${channel.plainId}` : "";
    return channel.state === "active"
      ? { ok: true, text: `WhatsApp ${phone} работает` }
      : { ok: false, text: `WhatsApp ${phone}: ${CHANNEL_STATE_TEXT[channel.state] ?? channel.state}` };
  } catch (err) {
    return { ok: false, text: err instanceof Error ? err.message : "Wazzup не ответил" };
  }
}
