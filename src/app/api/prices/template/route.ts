import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildPriceTemplate } from "@/lib/excel";
import { getCurrentPrices } from "@/lib/repo/prices";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { priceMapForClient } from "@/lib/priceList";

export const dynamic = "force-dynamic";

/**
 * Шаблон прайс-листа: лист на цветок, строки — сорта, колонки — длины.
 * Выгружается УЖЕ с действующими ценами: правят обычно две-три строки, а не
 * набивают весь прайс заново.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== "sales_head" && role !== "admin") {
    return NextResponse.json(
      { error: "Прайс ведёт руководитель отдела продаж" },
      { status: 403 }
    );
  }

  const [varieties, prices] = await Promise.all([listVarietiesByType(), getCurrentPrices()]);
  const buffer = await buildPriceTemplate(varieties, priceMapForClient(prices));

  const today = new Date().toISOString().slice(0, 10);
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="price-${today}.xlsx"; filename*=UTF-8''${encodeURIComponent(
        `Прайс-лист — ${today}.xlsx`
      )}`,
    },
  });
}
