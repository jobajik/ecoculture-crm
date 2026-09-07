import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getFinanceSnapshot, type FinancePeriod } from "@/lib/finance";
import { buildFinanceReportWorkbook } from "@/lib/excel";

export const dynamic = "force-dynamic";

/** Выгрузка отчёта бухгалтера за день/неделю/месяц в .xlsx. */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Не авторизован", { status: 401 });
  if (session.user.role !== "accountant" && session.user.role !== "admin") {
    return new Response("Недостаточно прав", { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const periodParam = params.get("period");
  const period: FinancePeriod = (["day", "week", "month"] as const).includes(periodParam as FinancePeriod)
    ? (periodParam as FinancePeriod)
    : "month";

  const snapshot = await getFinanceSnapshot(period, params.get("date") ?? undefined);
  const buffer = await buildFinanceReportWorkbook(snapshot);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="otchet-oplaty-${period}-${snapshot.from}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
