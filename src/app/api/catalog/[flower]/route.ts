import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { catalogSignatureOk, publicFileUrl } from "@/lib/waFileSign";
import { prefetchTables, SHEET_TABS } from "@/lib/sheets";
import { getCurrentPrices } from "@/lib/repo/prices";
import { listBatches } from "@/lib/repo/batches";
import { getSettings } from "@/lib/repo/settings";
import { listBotPhotos } from "@/lib/repo/botPhotos";
import { stockMap } from "@/lib/botKnowledge";
import { catalogPage } from "@/lib/catalog";
import { catalogPhotos } from "@/lib/botPhotos";
import { loadCatalogFonts, renderCatalogJpeg, type CatalogFont } from "@/lib/catalogImage";
import { catalogFileName, siteUrl } from "@/lib/catalogFiles";
import { localDayKey } from "@/lib/timezone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Страница каталога JPEG по цветку (`catalog.ts`, рисует `catalogImage.tsx`):
 * `/api/catalog/<цветок>?t=<подпись>&v=<15-минутка>`. Без подписи — 404. Живая:
 * прайс и склад — на момент запроса; CDN держит 15 минут, Green API качает её
 * на каждого получателя. `download=1` — скачать файлом.
 */
export async function GET(request: Request, { params }: { params: { flower: string } }) {
  const url = new URL(request.url);
  const flower = params.flower;
  if (!catalogSignatureOk(flower, url.searchParams.get("t"))) return new NextResponse("Not found", { status: 404 });

  await prefetchTables([SHEET_TABS.PRICE_HISTORY, SHEET_TABS.BATCHES, SHEET_TABS.SETTINGS, SHEET_TABS.BOT_PHOTOS]);
  const now = new Date();
  const [prices, batches, settings, photos] = await Promise.all([getCurrentPrices(localDayKey(now)), listBatches(), getSettings(), listBotPhotos()]);
  const page = catalogPage({ flowerType: flower, prices, stock: Array.from(stockMap(batches, settings, now).values()) });
  if (!page) return new NextResponse("Not found", { status: 404 });

  const site = siteUrl();
  const pics = catalogPhotos(photos, flower);
  const [fonts, logo, ...images] = await Promise.all([
    fontsCached(),
    dataUri(`${site}/logo.png`),
    ...pics.map((p) => dataUri(publicFileUrl(site, p.fileId, p.fileName || "photo.jpg"))),
  ]);
  const shown = images.filter((x): x is string => !!x);
  const day = localDayKey(now);
  const jpg = await renderCatalogJpeg({
    page,
    dateText: `на ${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`,
    logo,
    hero: shown[0] ?? null,
    gallery: shown.slice(1, 4),
    fonts,
  });
  return new NextResponse(new Uint8Array(jpg), {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(jpg.length),
      "Content-Disposition": `${url.searchParams.get("download") ? "attachment" : "inline"}; filename="${catalogFileName(flower)}"`,
      "Cache-Control": "public, max-age=300, s-maxage=900",
    },
  });
}

/** Картинка по ссылке → data:… для Satori. Не скачалась — null (страница без неё). */
async function dataUri(href: string): Promise<string | null> {
  try {
    const res = await fetch(href, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/jpeg";
    if (!/^image\/(jpeg|png)/.test(type)) return null;
    return `data:${type.split(";")[0]};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Шрифты: из node_modules (в функцию их кладёт `outputFileTracingIncludes` в
 * `next.config.js`), а если файла рядом нет — те же файлы @fontsource с jsDelivr.
 */
let fontCache: Promise<CatalogFont[]> | null = null;
function fontsCached(): Promise<CatalogFont[]> {
  if (!fontCache) {
    fontCache = loadCatalogFonts(async (p) => {
      try {
        return await readFile(path.join(process.cwd(), p));
      } catch {
        const m = p.match(/@fontsource\/(\w+)\/files\/(.+)$/);
        const res = await fetch(`https://cdn.jsdelivr.net/npm/@fontsource/${m?.[1]}@5/files/${m?.[2]}`);
        if (!res.ok) throw new Error(`шрифт не загрузился: ${p}`);
        return Buffer.from(await res.arrayBuffer());
      }
    }).catch((err) => {
      fontCache = null;
      throw err;
    });
  }
  return fontCache;
}
