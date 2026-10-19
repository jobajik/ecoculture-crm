import { kickLineWatch, runAssistantSweep, runLineWatch } from "@/lib/lineAssistant";
import { ensureLineWebhooks } from "@/lib/lineSeller";
import { runLineNudges } from "@/lib/lineNudges";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Проход ИИ-помощника по номерам менеджеров (16.10.2026): ответить там, где клиент ждёт дольше
 * 20 минут (или вечером). Будят вебхук WhatsApp (`kickAssistant`, не чаще раза в 3 мин) и
 * расписание раз в час (`/api/bot/followup`). Только с секретом CRON_SECRET.
 *
 * `?watch=<код>` — сторож номера «продаёт сам» (19.10.2026, `runLineWatch`): отвечает через 5 минут
 * молчания менеджера. Общий проход такие номера не трогает, а будит их сторожа; заодно — дожим
 * молчащих на этих номерах (`lineNudges.ts`, не чаще раза в 20 мин) и проверка адреса уведомлений.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  const url = new URL(request.url);
  const q = url.searchParams;
  const origin = (process.env.NEXTAUTH_URL || url.origin).replace(/\/+$/, "");
  const line = q.get("line") || "";
  const phone = (q.get("phone") || "").replace(/\D/g, "");
  const watch = q.get("watch") || "";
  try {
    if (watch) {
      const r = await runLineWatch(watch, origin, q.get("token") || "", Math.max(0, Number(q.get("hop")) || 0));
      return Response.json(r);
    }
    if (line && phone) {
      // Один чат вне рабочего времени: подождать, пока клиент допишет серию, и ответить ему.
      await new Promise((r) => setTimeout(r, 22000));
      const one = await runAssistantSweep({ only: { line, phone }, limit: 1, budgetMs: 30000, quick: true });
      return Response.json({ ok: true, ...one });
    }
    const hooks = await ensureLineWebhooks(origin).catch((e) => [String(e)]);
    const result = await runAssistantSweep({ limit: 6, budgetMs: 25000 });
    for (const code of result.watch ?? []) await kickLineWatch(origin, code);
    const nudges = await runLineNudges({ budgetMs: 20000 }).catch((e) => ({ sent: 0, closed: 0, errors: 1, note: String(e) }));
    return Response.json({ ok: true, ...result, hooks, nudges });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
