import { runAssistantSweep } from "@/lib/lineAssistant";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Проход ИИ-помощника по номерам менеджеров (16.10.2026): ответить там, где клиент ждёт дольше
 * 20 минут (или вечером). Будят вебхук WhatsApp (`kickAssistant`, не чаще раза в 3 мин) и
 * расписание раз в час (`/api/bot/followup`). Только с секретом CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  const q = new URL(request.url).searchParams;
  const line = q.get("line") || "";
  const phone = (q.get("phone") || "").replace(/\D/g, "");
  try {
    if (line && phone) {
      // Один чат вне рабочего времени: подождать, пока клиент допишет серию, и ответить ему.
      await new Promise((r) => setTimeout(r, 22000));
      const one = await runAssistantSweep({ only: { line, phone }, limit: 1, budgetMs: 30000, quick: true });
      return Response.json({ ok: true, ...one });
    }
    const result = await runAssistantSweep({ limit: 6, budgetMs: 30000 });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
