import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { waybillSignatureOk } from "@/lib/waFileSign";
import { getWaybill } from "@/lib/repo/waybills";
import { sampleWaybillDoc, waybillFileName } from "@/lib/waybill";
import { loadWaybillFonts, renderWaybillJpeg, type WaybillFont } from "@/lib/waybillImage";
import { jpegSize, jpegToPdf } from "@/lib/jpegPdf";
import { localDayKey } from "@/lib/timezone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Накладная клиенту файлом: `/api/waybill/<номер строки>/<имя>.jpg|.pdf?t=<подпись>`. Открыта без входа (её скачивает
 * Green API), но только с подписью номера строки — без неё 404. Рисуется из СНИМКА в строке `Waybills`, а не из
 * заявки: документ, уже ушедший клиенту, от поздних правок не меняется. Имя с `.pdf` — тот же лист одним PDF.
 *
 * `/api/waybill/sample/obrazec.jpg` — образец с выдуманным клиентом (подписан «ОБРАЗЕЦ»), без подписи: для настроек
 * и проверки после выкладки.
 */
export async function GET(request: Request, { params }: { params: { id: string; name: string } }) {
  const url = new URL(request.url);
  const sample = params.id === "sample";
  if (!sample && !waybillSignatureOk(params.id, url.searchParams.get("t"))) return new NextResponse("Not found", { status: 404 });
  const doc = sample ? sampleWaybillDoc(localDayKey()) : (await getWaybill(params.id))?.doc ?? null;
  if (!doc || doc.lines.length === 0) return new NextResponse("Not found", { status: 404 });

  const jpg = await renderWaybillJpeg({ doc, logo: await logoData(), fonts: await fontsCached() });
  const pdf = /\.pdf$/i.test(params.name);
  const size = pdf ? jpegSize(jpg) : null;
  const body = pdf && size ? jpegToPdf(jpg, size.width, size.height) : jpg;
  const fileName = waybillFileName(doc).replace(/\.(jpg|pdf)$/, pdf && size ? ".pdf" : ".jpg");
  return new NextResponse(new Uint8Array(body), {
    status: 200,
    headers: {
      "Content-Type": pdf && size ? "application/pdf" : "image/jpeg",
      "Content-Length": String(body.length),
      "Content-Disposition": `${url.searchParams.get("download") ? "attachment" : "inline"}; filename="${fileName}"`,
      // Снимок не меняется — можно держать долго; образец с сегодняшней датой — недолго.
      "Cache-Control": sample ? "public, max-age=300, s-maxage=600" : "public, max-age=3600, s-maxage=86400",
    },
  });
}

let logoCache: Promise<string | null> | null = null;
function logoData(): Promise<string | null> {
  if (!logoCache) {
    logoCache = readFile(path.join(process.cwd(), "public/logo.png")).then(
      (buf) => `data:image/png;base64,${buf.toString("base64")}`,
      () => null
    );
  }
  return logoCache;
}

/** Шрифты — из node_modules (их кладёт в функцию `outputFileTracingIncludes`), нет рядом — те же файлы с jsDelivr. */
let fontCache: Promise<WaybillFont[]> | null = null;
function fontsCached(): Promise<WaybillFont[]> {
  if (!fontCache) {
    fontCache = loadWaybillFonts(async (p) => {
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
