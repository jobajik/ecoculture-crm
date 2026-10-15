import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setupLeadsLine } from "@/lib/leadsLineSetup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE = "https://www.crm-ecoculture.kz";

/**
 * Подключить номер Земфиры из браузера (только админ): открыть
 * https://www.crm-ecoculture.kz/api/whatsapp/leads-setup — проверит QR, пропишет
 * уведомления и дотянет переписку за 3 дня. Повторный запуск безопасен: уже записанные
 * сообщения не дублируются. Подробности — `setupLeadsLine`.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return text("Войдите в CRM под админом и откройте страницу снова.", 401);
  if (session.user.role !== "admin") return text("Только для админа.", 403);
  try {
    return text(["Номер Земфиры — подключение", "", ...(await setupLeadsLine(SITE, 3))].join("\n"));
  } catch (err) {
    return text(`Не получилось: ${err instanceof Error ? err.message : err}\nОбновите страницу через минуту.`, 500);
  }
}

function text(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
