import { runWaybills } from "@/lib/waybillRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Отправка накладных клиентам после отгрузки (`waybillRunner.ts`). Зовут двое: действие склада сразу после отгрузки
 * (`kickWaybills`, с номером заявки) и расписание раз в час (`/api/bot/followup`) — оно подбирает частичные отгрузки,
 * которым вышло время тишины. Только с секретом CRON_SECRET.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  const orderId = new URL(request.url).searchParams.get("order") || "";
  try {
    return Response.json({ ok: true, ...(await runWaybills({ orderId })) });
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
