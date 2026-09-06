import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getStockSnapshot } from "@/lib/stock";

export const dynamic = "force-dynamic";

/** Свежие остатки для витрины на главной. Доступно всем авторизованным сотрудникам. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ error: "Не авторизован" }, { status: 401 });
  }

  try {
    // Зав. складом видит остатки только своего производства.
    const farm = session.user.role === "warehouse" ? session.user.farm ?? null : null;
    const snapshot = await getStockSnapshot(new Date(), undefined, farm);
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось получить остатки";
    return Response.json({ error: message }, { status: 500 });
  }
}
