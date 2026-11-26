import { assignPoolTalkers } from "@/lib/baseRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Общий пул «Базы»: кто из нетронутых сам написал нам — тому ставится менеджер (`assignPoolTalkers`). Зовёт часовой
 * проход `/api/bot/followup` (9:00–20:00). Без `send=1` — только показ, кого и кому отдал бы. Вызов — с CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  const send = new URL(request.url).searchParams.get("send") === "1";
  try {
    const r = await assignPoolTalkers({ send });
    return Response.json({ ok: true, send, assigned: r.assigned.length, left: r.left, list: r.assigned });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
