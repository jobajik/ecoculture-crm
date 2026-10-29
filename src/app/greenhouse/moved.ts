import { redirect } from "next/navigation";

/**
 * Старые адреса «Теплицы» (до 29.10.2026 — отдельные страницы срезки, черенкования, брака и выработки) ведут на новые:
 * «Внести день», «Записи» и «Аналитику». Закладки и ссылки из чатов продолжают работать.
 */
export function movedTo(path: string, searchParams: Record<string, string | undefined> | undefined, extra: Record<string, string> = {}, drop: string[] = []): never {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams ?? {})) if (v && !drop.includes(k)) q.set(k, v);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const s = q.toString();
  redirect(`${path}${s ? `?${s}` : ""}`);
}
