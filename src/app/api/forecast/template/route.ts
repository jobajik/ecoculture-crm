import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildForecastTemplate } from "@/lib/excel";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { ROLES, isValidPeriod, periodOf } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Отдаёт .xlsx-шаблон прогноза срезки под производство агронома и выбранный месяц. */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response("Не авторизован", { status: 401 });
  }
  const role = session.user.role;
  if (role !== ROLES.AGRONOMIST && role !== ROLES.ADMIN) {
    return new Response("Недостаточно прав", { status: 403 });
  }

  // Агроном получает шаблон только по своему производству, админ — общий.
  const farm = role === ROLES.ADMIN ? null : session.user.farm ?? null;

  const requested = new URL(request.url).searchParams.get("period") ?? "";
  const period = isValidPeriod(requested) ? requested : periodOf(new Date());

  const varieties = await listVarietiesByType();
  const buffer = await buildForecastTemplate(varieties, farm, period);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="prognoz-srezki-${period}${farm ? "-" + farm : ""}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
