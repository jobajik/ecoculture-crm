import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildBatchesTemplate } from "@/lib/excel";
import { listVarietiesByType } from "@/lib/repo/varieties";

export const dynamic = "force-dynamic";

/** Отдаёт .xlsx-шаблон для заполнения приёмки на производстве. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response("Не авторизован", { status: 401 });
  }
  if (session.user.role !== "warehouse" && session.user.role !== "admin") {
    return new Response("Недостаточно прав", { status: 403 });
  }

  // Зав. складом получает шаблон только по своему производству, админ — общий.
  const farm = session.user.role === "admin" ? null : session.user.farm ?? null;

  const varieties = await listVarietiesByType();
  const buffer = await buildBatchesTemplate(varieties, farm);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="priemka-shablon${farm ? "-" + farm : ""}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
