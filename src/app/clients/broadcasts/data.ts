import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { listBroadcasts, listRecipients, listWaStatuses, optedOutKeys } from "@/lib/repo/broadcasts";
import { listWaMessages } from "@/lib/repo/talks";
import { mergeMessages } from "@/lib/whatsapp";
import { broadcastTotals, deliveryByMessage, recipientViews, type BroadcastTotals, type RecipientView } from "@/lib/broadcast";
import { getInstanceState, greenConfig } from "@/lib/greenApi";
import { greenStateText } from "@/lib/greenOut";
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

/** Состояние WhatsApp в Green API — одной строкой для шапки. Никогда не бросает. */
export async function channelInfo(): Promise<ChannelInfo> {
  const cfg = greenConfig();
  if (!cfg) return { ok: false, text: "WhatsApp (Green API) не подключён — ключи вводятся в whatsapp-key.bat" };
  try {
    const state = await getInstanceState(cfg);
    return state === "authorized"
      ? { ok: true, text: "WhatsApp работает (Green API)" }
      : { ok: false, text: `WhatsApp: ${greenStateText(state)}` };
  } catch {
    return { ok: false, text: "Green API не ответил — обновите страницу через минуту" };
  }
}
