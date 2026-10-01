import { digestResultText, recordDigestRun, sendMorningDigest } from "@/lib/morningDigestRunner";
import { remindBotInvoices } from "@/lib/botFollowUp";

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
  // Расписание Vercel представляется «vercel-cron»; остальное — ручной вызов (diag-crons).
  const source = /vercel-cron/i.test(request.headers.get("user-agent") || "") ? "расписание" : "вручную";
  // Утром бот напоминает об оплате по своим заявкам (не мешает сводке: ошибок не бросает).
  const reminders = await remindBotInvoices();
  try {
    const result = await sendMorningDigest();
    await recordDigestRun(source, digestResultText(result));
    return Response.json({ ok: true, sent: result.sent.length, failed: result.failed.length, note: result.note, reminders });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordDigestRun(source, `ошибка: ${message}`);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
