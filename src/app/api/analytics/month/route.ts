import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canOpen } from "@/lib/access";
import { localDayKey } from "@/lib/timezone";
import { cleanMonth } from "@/lib/monthReport";
import { loadMonthReport } from "@/lib/repo/monthReport";
import { monthReportWorkbook } from "@/lib/monthReportExcel";
import { FARMS } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** «Итоги месяца» в Excel — тот же расчёт, что на странице `/analytics/month`. */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Не авторизован", { status: 401 });
  if (!canOpen(session.user.role, "/analytics/month")) return new Response("Недостаточно прав", { status: 403 });
  const url = new URL(request.url);
  const month = cleanMonth(url.searchParams.get("month"), localDayKey());
  const f = url.searchParams.get("farm") ?? "";
  const farm = f === FARMS.ESENTAI || f === FARMS.ROSE_FARM ? f : "";
  const buffer = await monthReportWorkbook(await loadMonthReport(month, farm));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="itogi-${month}${farm ? "-" + farm : ""}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
