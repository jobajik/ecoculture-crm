import { reconcileKaspi } from "@/lib/kaspiReconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Сверка счетов Kaspi с ApiPay и итогов заявок с журналом платежей (`kaspiReconcile.ts`). Зовёт часовой проход
 * `/api/bot/followup`; вызов — с CRON_SECRET. Что сделано в последний раз — настройка `KaspiReconcileLastRun`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  try {
    return Response.json({ ok: true, ...(await reconcileKaspi()) });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
