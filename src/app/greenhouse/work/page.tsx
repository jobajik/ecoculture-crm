import { movedTo } from "../moved";

export const dynamic = "force-dynamic";

/** Ввод выработки — теперь часть «Внести день» (29.10.2026). */
export default function Page({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  movedTo("/greenhouse/day", searchParams, { section: "people" }, ["area"]);
}
