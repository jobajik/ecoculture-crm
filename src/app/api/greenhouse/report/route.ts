import { buildReport } from "@/lib/greenhouse/dashboard";
import { loadGreenhousePlan } from "@/lib/greenhouse/dashboardData";
import { buildGreenhouseReportWorkbook } from "@/lib/greenhouse/reportExcel";
import { reportRange } from "@/lib/greenhouse/reportPeriod";
import { greenhouseSession } from "@/lib/greenhouse/session";
import { loadGreenhouse } from "@/lib/repo/greenhouse";
import { localDayKey } from "@/lib/timezone";

export const dynamic = "force-dynamic";

/** Отчёт теплицы в .xlsx — тем, кому открыт раздел; компания — как на странице (закреплённая не меняется). */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const { scope, farm } = await greenhouseSession({ farm: params.get("farm") ?? undefined });
  if (!scope) return new Response("Раздел «Теплица» для вас закрыт", { status: 403 });
  const today = localDayKey();
  const range = reportRange({ period: params.get("period") ?? undefined, date: params.get("date") ?? undefined, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined }, today);
  const [data, plan] = await Promise.all([loadGreenhouse(farm), loadGreenhousePlan(farm)]);
  const rep = buildReport(data, plan, range.from, range.to);
  const buffer = await buildGreenhouseReportWorkbook(rep, farm, range.title);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="teplica-${farm}-${range.from}_${range.to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
