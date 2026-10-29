import { redirect } from "next/navigation";

/** Выработка переехала в раздел «Теплица» (29.10.2026) — старые ссылки и закладки ведут туда же. */
export default function Page({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams ?? {})) if (v) q.set(k, v);
  const s = q.toString();
  redirect(`/greenhouse/work${s ? `?${s}` : ""}`);
}
