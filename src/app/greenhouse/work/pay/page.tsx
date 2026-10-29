import { movedTo } from "../../moved";

export const dynamic = "force-dynamic";

/** Оплата труда — во вкладке «Аналитика», вид «Оплата труда» (29.10.2026). */
export default function Page({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  movedTo("/greenhouse/analytics", searchParams, { view: "pay" });
}
