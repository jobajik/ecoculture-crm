import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildShipmentPlanTemplate } from "@/lib/excel";
import { isValidPeriod, periodOf, periodLabel } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * Шаблон плана отгрузок на месяц: лист на цветок, строки — направления,
 * колонки — недели. Ровно тот же файл потом принимается обратно.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== "sales_head" && role !== "admin") {
    return NextResponse.json({ error: "Планы ставит руководитель отдела продаж" }, { status: 403 });
  }

  const asked = new URL(request.url).searchParams.get("period") ?? "";
  const month = isValidPeriod(asked) ? asked : periodOf(new Date());
  const buffer = await buildShipmentPlanTemplate(month);

  const name = `plan-otgruzok-${month}.xlsx`;
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(
        `План отгрузок — ${periodLabel(month)}.xlsx`
      )}`,
    },
  });
}
