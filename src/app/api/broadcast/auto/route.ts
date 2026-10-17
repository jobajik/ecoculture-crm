import { runBroadcastChain } from "@/lib/autoBroadcastRunner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Автопилот рассылок (17.10.2026): один шаг цепочки — собрать план дня (9:00), запустить его (10:00),
 * отправить следующее сообщение каждой идущей рассылки и, если ждать недолго, разбудить себя снова.
 * Будят: утренняя сводка, расписание раз в час, вебхуки WhatsApp (`kickBroadcast`) и сам шаг (`?token=`).
 * Один ведущий на весь сайт — замок в настройке `BroadcastChain`. Только с секретом CRON_SECRET.
 * Правила — `src/lib/autoBroadcast.ts`, работа — `src/lib/autoBroadcastRunner.ts`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  const url = new URL(request.url);
  const origin = (process.env.NEXTAUTH_URL || url.origin).replace(/\/+$/, "");
  const result = await runBroadcastChain({ token: url.searchParams.get("token") || "", origin });
  return Response.json(result);
}
