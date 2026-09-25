import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildLeadTemplate } from "@/lib/excel";
import { canManageLeads } from "@/lib/leads";

export const dynamic = "force-dynamic";

/** Шаблон файла для загрузки лидов: заголовки, которые узнаёт загрузка. */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!canManageLeads(session?.user?.role)) {
    return NextResponse.json({ error: "Базу лидов загружает РОП" }, { status: 403 });
  }
  const buffer = await buildLeadTemplate();
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("Шаблон лидов.xlsx")}`,
      "Cache-Control": "no-store",
    },
  });
}
