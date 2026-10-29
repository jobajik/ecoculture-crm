import { movedTo } from "@/app/greenhouse/moved";

/** Выработка переехала в раздел «Теплица» (29.10.2026) — старые ссылки и закладки ведут туда же. */
export default function Page({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  movedTo("/greenhouse/day", searchParams, { section: "people" }, ["area"]);
}
