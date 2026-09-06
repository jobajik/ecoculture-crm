import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPicklist } from "@/lib/picklist";
import { buildPicklistWorkbook } from "@/lib/excel";

export const dynamic = "force-dynamic";

/** Выгружает сводную заявку склада на выбранную дату в .xlsx. */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Не авторизован", { status: 401 });
  if (session.user.role !== "warehouse" && session.user.role !== "admin") {
    return new Response("Недостаточно прав", { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const dateParam = params.get("date");
  const farmParam = params.get("farm");
  const farm = session.user.role === "admin" ? farmParam || null : session.user.farm ?? null;
  const now = new Date();
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const picklist = await getPicklist(date, new Date(), undefined, farm);
  const buffer = await buildPicklistWorkbook(picklist);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="zayavka-${farm ? farm + "-" : ""}${date}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
