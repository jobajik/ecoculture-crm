import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildPriceTemplate } from "@/lib/excel";
import { getCurrentPrices } from "@/lib/repo/prices";
import { listVarietiesByType } from "@/lib/repo/varieties";
import { PRICE_KINDS, cleanPriceKind, priceMapForClient } from "@/lib/priceList";

export const dynamic = "force-dynamic";

/**
 * Шаблон прайс-листа: лист на цветок, строки — сорта, колонки — длины.
 * Выгружается УЖЕ с действующими ценами: правят обычно две-три строки, а не
 * набивают весь прайс заново.
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role;
  if (role !== "sales_head" && role !== "admin") {
    return NextResponse.json(
      { error: "Прайс ведёт руководитель отдела продаж" },
      { status: 403 }
    );
  }

  // Прайса два, и шаблон должен выгружаться с ценами ТОГО, который правят:
  // иначе РОП скачает клиентские цены, поправит две строки и зальёт их во
  // внутренний прайс целиком.
  const kind = cleanPriceKind(new URL(request.url).searchParams.get("kind"));
  const [varieties, prices] = await Promise.all([
    listVarietiesByType(),
    getCurrentPrices(undefined, kind),
  ]);
  const buffer = await buildPriceTemplate(varieties, priceMapForClient(prices));

  const today = new Date().toISOString().slice(0, 10);
  const title = kind === PRICE_KINDS.RETAIL ? "Внутренний прайс" : "Прайс-лист";
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="price-${
        kind === PRICE_KINDS.RETAIL ? "retail-" : ""
      }${today}.xlsx"; filename*=UTF-8''${encodeURIComponent(`${title} — ${today}.xlsx`)}`,
    },
  });
}
