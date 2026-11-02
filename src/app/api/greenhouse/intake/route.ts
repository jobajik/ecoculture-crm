import { FARMS } from "@/lib/constants";
import { filterIntake, isIntakeFlower } from "@/lib/greenhouse/intake";
import { buildIntakeWorkbook } from "@/lib/greenhouse/intakeExcel";
import { previousRange } from "@/lib/greenhouse/insights";
import { reportRange } from "@/lib/greenhouse/reportPeriod";
import { greenhouseSession } from "@/lib/greenhouse/session";
import { loadIntake } from "@/lib/repo/greenhouse";
import { localDayKey } from "@/lib/timezone";

export const dynamic = "force-dynamic";

/** Приёмка Rose Farm в .xlsx — тем, кому открыт раздел; отбор — как на странице «Аналитика». */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const { scope, farm } = await greenhouseSession({ farm: params.get("farm") ?? undefined });
  if (!scope) return new Response("Раздел «Теплица» для вас закрыт", { status: 403 });
  if (farm !== FARMS.ROSE_FARM) return new Response("Приёмка по характеристикам ведётся только для Rose Farm", { status: 400 });
  const today = localDayKey();
  const range = reportRange({ period: params.get("period") ?? undefined, date: params.get("date") ?? undefined, from: params.get("from") ?? undefined, to: params.get("to") ?? undefined }, today);
  const f = params.get("flower");
  const flower = isIntakeFlower(f) ? f : "";
  const block = (params.get("block") ?? "").trim();
  const variety = (params.get("variety") ?? "").trim();
  const rows = await loadIntake(farm);
  const now = filterIntake(rows, { from: range.from, to: range.to, flower, block, variety });
  const prev = filterIntake(rows, { ...previousRange(range.from, range.to), flower, block, variety });
  const buffer = await buildIntakeWorkbook(now, prev, farm, range.title, range.from, range.to);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="priemka-${farm}-${range.from}_${range.to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
