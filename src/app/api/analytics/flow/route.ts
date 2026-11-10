import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canOpen } from "@/lib/access";
import { localDayKey } from "@/lib/timezone";
import { cleanRange } from "@/lib/flowReport";
import { loadFlowReport } from "@/lib/repo/flowReport";
import { flowReportWorkbook } from "@/lib/flowReportExcel";
import { FARMS, flowerTypesForFarm } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** «Срез · продажи · списания» в Excel — тот же расчёт, что на странице `/analytics/flow`. */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Не авторизован", { status: 401 });
  if (!canOpen(session.user.role, "/analytics/flow")) return new Response("Недостаточно прав", { status: 403 });
  const url = new URL(request.url);
  const { from, to } = cleanRange(url.searchParams.get("from"), url.searchParams.get("to"), localDayKey());
  const f = url.searchParams.get("farm") ?? "";
  const farm = f === FARMS.ESENTAI || f === FARMS.ROSE_FARM ? f : "";
  const fl = url.searchParams.get("flower") ?? "";
  const flower = flowerTypesForFarm(farm || null).includes(fl) ? fl : "";
  const buffer = await flowReportWorkbook(await loadFlowReport(from, to, farm, flower));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="srez-prodazhi-${from}_${to}${farm ? "-" + farm : ""}${flower ? "-" + flower : ""}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
