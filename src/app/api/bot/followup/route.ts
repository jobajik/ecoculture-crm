import { remindBotInvoices, runBotNudges } from "@/lib/botFollowUp";
import { settingsMap } from "@/lib/repo/broadcasts";
import { saveSettings } from "@/lib/repo/settings";
import { FOLLOWUP_LAST_RUN, followupRunDue, followupRunText } from "@/lib/botFollowUpRun";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const almatyHour = (d: Date) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Almaty", hour: "numeric", hour12: false }).format(d)) % 24;

/**
 * Бот дожимает молчащих клиентов (`botNudge.ts`) и напоминает об оплате своих
 * счетов. Зовут двое:
 *
 * - расписание Vercel — раз в час с 10:00 до 20:00 по Алматы (бесплатное
 *   расписание бывает только раз в сутки, поэтому в `vercel.json` одиннадцать
 *   ежедневных записей, `?h=` только различает их; срабатывает в любую минуту часа);
 * - вебхук WhatsApp (`?source=webhook`) — на любом уведомлении днём, но не чаще
 *   раза в 25 минут (`followupRunDue`): так касание «через 1,5 ч» приходит
 *   вовремя, а не через два с половиной.
 *
 * Каждый запуск пишется в настройку `BotFollowupLastRun` — видно, работает ли.
 * Вызов только с секретом CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  const now = new Date();
  const fromWebhook = new URL(request.url).searchParams.get("source") === "webhook";
  if (fromWebhook) {
    const hour = almatyHour(now);
    if (hour < 9 || hour >= 20) return Response.json({ ok: true, skipped: "ночь" });
    const map = await settingsMap(true);
    if (!followupRunDue(map[FOLLOWUP_LAST_RUN], now)) return Response.json({ ok: true, skipped: "недавно" });
  }
  const source = fromWebhook ? "вебхук" : "расписание";
  // Отметка ДО работы: второй вебхук через секунду увидит её и не задвоит касания.
  await saveSettings({ [FOLLOWUP_LAST_RUN]: followupRunText(now, source, "идёт") }).catch(() => undefined);
  const reminders = await remindBotInvoices();
  const nudges = await runBotNudges({ limit: 8, budgetMs: 40000 });
  const result = `напоминаний ${reminders.sent}, дожато ${nudges.sent}, закрыто ${nudges.closed}, ошибок ${reminders.errors + nudges.errors}`;
  await saveSettings({ [FOLLOWUP_LAST_RUN]: followupRunText(now, source, result) }).catch(() => undefined);
  return Response.json({ ok: true, reminders, nudges });
}
