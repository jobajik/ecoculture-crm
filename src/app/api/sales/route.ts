import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getSalesSnapshot } from "@/lib/salesAnalytics";

export const dynamic = "force-dynamic";

/** Сводка продаж по менеджерам за выбранный месяц. Доступна менеджерам и администратору. */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (session.user.role !== "manager" && session.user.role !== "admin") {
    return Response.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const period = new URL(request.url).searchParams.get("period") ?? undefined;

  try {
    const snapshot = await getSalesSnapshot(period);
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось получить продажи";
    return Response.json({ error: message }, { status: 500 });
  }
}
