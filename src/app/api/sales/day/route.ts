import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDailySalesSnapshot } from "@/lib/dailySales";

export const dynamic = "force-dynamic";

/** Продажи за конкретный день — для дашборда в реальном времени. */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (session.user.role !== "manager" && session.user.role !== "admin") {
    return Response.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  const date = new URL(request.url).searchParams.get("date") ?? undefined;

  try {
    const snapshot = await getDailySalesSnapshot(date);
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось получить продажи";
    return Response.json({ error: message }, { status: 500 });
  }
}
