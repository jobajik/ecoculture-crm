import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { MISSING_FARM_MESSAGE, missingFarm } from "@/lib/access";
import { getStockSnapshot } from "@/lib/stock";
import { isFarmBoundRole } from "@/lib/constants";

export const dynamic = "force-dynamic";

/** Свежие остатки для витрины на главной. Доступно всем авторизованным сотрудникам. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return Response.json({ error: "Не авторизован" }, { status: 401 });
  }

  // Без роли (уволен, строку стёрли) и склад без производства — ничего не видят.
  if (!session.user.role) return Response.json({ error: "Нет доступа" }, { status: 403 });
  if (missingFarm(session.user.role, session.user.farm)) {
    return Response.json({ error: MISSING_FARM_MESSAGE }, { status: 403 });
  }

  try {
    // Зав. складом и агроном видят остатки только своего производства — как на
    // самой главной (раньше агроном после обновления видел оба производства).
    const farm = isFarmBoundRole(session.user.role) ? session.user.farm ?? null : null;
    const snapshot = await getStockSnapshot(new Date(), undefined, farm);
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Не удалось получить остатки";
    return Response.json({ error: message }, { status: 500 });
  }
}
