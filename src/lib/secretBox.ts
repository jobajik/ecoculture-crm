import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Токены Green API номеров менеджеров (16.10.2026) лежат во вкладке WaLines
// ЗАШИФРОВАННЫМИ: владелец вписывает ключ на сайте («Настройки → WhatsApp
// менеджеров»), а в таблице остаётся только шифр. Ключ шифра выводится из
// NEXTAUTH_SECRET, который живёт только на Vercel и на компьютере владельца —
// таблица без него ничего не даёт. AES-256-GCM: подделанная ячейка не
// расшифруется вовсе, а не превратится в чужой токен.
// ---------------------------------------------------------------------------

const PREFIX = "v1:";

function key(): Buffer {
  const secret = (process.env.NEXTAUTH_SECRET || "").trim();
  if (!secret) throw new Error("Нет NEXTAUTH_SECRET — нечем зашифровать ключ");
  return createHash("sha256").update(`wa-lines:${secret}`).digest();
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

/** Расшифровать. Не тот ключ, испорченная ячейка или пусто — "" (номер считается неподключённым). */
export function openSecret(sealed: string): string {
  const raw = (sealed || "").trim();
  if (!raw.startsWith(PREFIX)) return "";
  try {
    const buf = Buffer.from(raw.slice(PREFIX.length), "base64");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
