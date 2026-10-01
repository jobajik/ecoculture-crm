import { remindBotInvoices, runBotNudges } from "@/lib/botFollowUp";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Раз в час днём: бот дожимает молчащих клиентов (`botNudge.ts`) и напоминает
 * об оплате своих счетов. Бесплатное расписание Vercel бывает только раз в
 * сутки, поэтому в `vercel.json` одиннадцать ежедневных записей — по одной на
 * час с 10:00 до 20:00 по Алматы (`?h=` только различает их). Вызов только с
 * секретом CRON_SECRET, как у сводки и резервной копии.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  const reminders = await remindBotInvoices();
  const nudges = await runBotNudges({ limit: 8, budgetMs: 40000 });
  return Response.json({ ok: true, reminders, nudges });
}
