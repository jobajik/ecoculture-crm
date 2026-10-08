import { sendNextBroadcastMessage } from "@/lib/broadcastSend";
import { listBroadcasts } from "@/lib/repo/broadcasts";
import { BROADCAST_STATUSES } from "@/lib/broadcast";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Один шаг рассылки без открытой страницы: отправить следующее сообщение по тем же
 * правилам, что и кнопка на странице (`broadcastSend.ts`), и сказать, сколько ждать.
 * `?id=` — рассылка; без него — самая ранняя из идущих. Зовёт по кругу
 * `scripts/broadcast-run.ts` с компьютера владельца. Только с секретом CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  let id = new URL(request.url).searchParams.get("id") || "";
  if (!id) {
    const sending = (await listBroadcasts(true)).filter((b) => b.status === BROADCAST_STATUSES.SENDING);
    sending.sort((a, b) => (a.startedAt || a.createdAt).localeCompare(b.startedAt || b.createdAt));
    if (sending.length === 0) return Response.json({ status: "none", remaining: 0, waitSeconds: 1800, note: "Нет идущих рассылок" });
    id = sending[0].broadcastId;
  }
  const step = await sendNextBroadcastMessage(id);
  return Response.json({ broadcastId: id, ...step });
}
