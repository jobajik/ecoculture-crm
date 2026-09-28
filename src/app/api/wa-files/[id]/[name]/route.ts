import { NextResponse } from "next/server";
import { fileSignatureOk } from "@/lib/waFileSign";
import { readWaFile } from "@/lib/repo/broadcasts";

export const dynamic = "force-dynamic";

/**
 * Файл рассылки для Wazzup (картинка, прайс PDF): `/api/wa-files/<id>/<имя>?t=<подпись>`.
 * Без верной подписи — 404, как будто файла нет. Ответ кэшируется на CDN
 * Vercel надолго: Wazzup качает файл на каждого получателя, а читать вкладку
 * с файлом на каждое скачивание — это лимит Google (грабли 1.17).
 */
export async function GET(request: Request, { params }: { params: { id: string; name: string } }) {
  const url = new URL(request.url);
  if (!fileSignatureOk(params.id, url.searchParams.get("t"))) {
    return new NextResponse("Not found", { status: 404 });
  }
  const file = await readWaFile(params.id);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(file.data), {
    status: 200,
    headers: {
      "Content-Type": file.mime,
      "Content-Length": String(file.data.length),
      "Content-Disposition": `inline; filename="${params.name.replace(/"/g, "")}"`,
      "Cache-Control": "public, max-age=86400, s-maxage=2592000, immutable",
    },
  });
}
