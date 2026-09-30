import { sendMorningDigest } from "@/lib/morningDigestRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Утренняя сводка в WhatsApp — расписание Vercel (`vercel.json`, 9:00 по
 * Алматы). Вызов только с секретом CRON_SECRET, как у резервной копии.
 * Правила — `src/lib/morningDigest.ts`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  try {
    const result = await sendMorningDigest();
    return Response.json({ ok: true, sent: result.sent.length, failed: result.failed.length, note: result.note });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
