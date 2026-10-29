import { movedTo } from "../../moved";

export const dynamic = "force-dynamic";

/** Аналитика выработки — во вкладке «Аналитика», вид «Люди» (29.10.2026). */
export default function Page({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  movedTo("/greenhouse/analytics", searchParams, { view: "people" });
}
