import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Подпись ссылки на файл рассылки. Wazzup скачивает файл сам, без входа в
 * CRM, поэтому ссылка открыта — но только с подписью: номер файла без неё
 * ничего не отдаёт. Ключ — NEXTAUTH_SECRET (он есть всегда и нигде не светится).
 */
function secret(): string {
  return (process.env.NEXTAUTH_SECRET || process.env.WAZZUP_WEBHOOK_TOKEN || "").trim();
}

export function signFileId(fileId: string): string {
  const key = secret();
  if (!key) return "";
  return createHmac("sha256", key).update(`wa-file:${fileId}`).digest("hex").slice(0, 32);
}

export function fileSignatureOk(fileId: string, given: string | null): boolean {
  const want = signFileId(fileId);
  const got = String(given || "").trim().toLowerCase();
  if (!want || got.length !== want.length || !/^[0-9a-f]+$/.test(got)) return false;
  return timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(want, "hex"));
}

/** Имя файла для адреса: латиница, цифры, точка и дефис — остальное «_». */
export function safeFileName(name: string): string {
  const cleaned = String(name || "file").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "file";
}

/** Публичная ссылка на файл для Wazzup. */
export function publicFileUrl(site: string, fileId: string, name: string): string {
  return `${site.replace(/\/+$/, "")}/api/wa-files/${encodeURIComponent(fileId)}/${safeFileName(name)}?t=${signFileId(fileId)}`;
}
