import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createBackup } from "@/lib/backup";
import { ROLES } from "@/lib/constants";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Ночная резервная копия таблицы. Вызывается двумя способами:
 *   — по расписанию Vercel (заголовок с секретом CRON_SECRET);
 *   — вручную администратором из браузера.
 *
 * Секрет обязателен для машинного вызова: адрес запускает создание файла, и
 * оставлять его открытым нельзя — любой прохожий мог бы наплодить копий.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const fromCron = Boolean(secret) && auth === `Bearer ${secret}`;

  if (!fromCron) {
    const session = await getServerSession(authOptions);
    if (session?.user?.role !== ROLES.ADMIN) {
      return new Response("Недостаточно прав", { status: 403 });
    }
  }

  try {
    const result = await createBackup();
    return Response.json({
      ok: true,
      title: result.title,
      url: result.url,
      tabs: result.tabs,
      rows: result.rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
