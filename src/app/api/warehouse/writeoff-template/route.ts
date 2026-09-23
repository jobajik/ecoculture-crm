import { localDayKey } from "@/lib/timezone";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { MISSING_FARM_MESSAGE, missingFarm } from "@/lib/access";
import { buildWriteoffTemplate } from "@/lib/excel";
import { listBatches } from "@/lib/repo/batches";
import { stockPositions } from "@/lib/writeoffPlan";

export const dynamic = "force-dynamic";

/** Шаблон списания: все позиции склада с остатком — осталось вписать, сколько списать. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Не авторизован", { status: 401 });
  if (session.user.role !== "warehouse" && session.user.role !== "admin") {
    return new Response("Недостаточно прав", { status: 403 });
  }
  if (missingFarm(session.user.role, session.user.farm)) return new Response(MISSING_FARM_MESSAGE, { status: 403 });

  const farm = session.user.role === "admin" ? null : session.user.farm ?? null;
  if (session.user.role === "warehouse" && !farm) {
    return new Response("У вас не указано производство", { status: 403 });
  }

  const positions = stockPositions(await listBatches(), farm);
  const buffer = await buildWriteoffTemplate(positions, farm);
  const day = localDayKey();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="spisanie-${day}${farm ? "-" + farm : ""}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
