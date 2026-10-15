import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { pullLeadsHistory, setupLeadsLine } from "@/lib/leadsLineSetup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE = "https://www.crm-ecoculture.kz";

/**
 * Подключить номер Земфиры из браузера (только админ): открыть
 * https://www.crm-ecoculture.kz/api/whatsapp/leads-setup — проверит QR, пропишет
 * уведомления и дотянет переписку за 3 дня. Повторный запуск безопасен: уже записанные
 * сообщения не дублируются. Подробности — `setupLeadsLine`.
 */
export async function GET(request: Request) {
  // Админ из браузера — или скрипт с компьютера владельца с CRON_SECRET (как /api/broadcast/tick), чтобы
  // дотянуть историю без участия владельца (15.10.2026).
  const secret = process.env.CRON_SECRET;
  const byCron = !!secret && request.headers.get("authorization") === `Bearer ${secret}`;
  if (!byCron) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) return text("Войдите в CRM под админом и откройте страницу снова.", 401);
    if (session.user.role !== "admin") return text("Только для админа.", 403);
  }
  try {
    // ?history=1 — дотянуть полную переписку чатов (журнал Green API до подключения пуст).
    if (new URL(request.url).searchParams.get("history") === "1") {
      return text(["Номер Земфиры — история чатов", "", ...(await pullLeadsHistory(45000))].join("\n"));
    }
    return text(["Номер Земфиры — подключение", "", ...(await setupLeadsLine(SITE, 3))].join("\n"));
  } catch (err) {
    return text(`Не получилось: ${err instanceof Error ? err.message : err}\nОбновите страницу через минуту.`, 500);
  }
}

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
