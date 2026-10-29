import { movedTo } from "../../moved";

export const dynamic = "force-dynamic";

/** Журнал выработки — во вкладке «Записи» (29.10.2026). */
export default function Page({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  movedTo("/greenhouse/records", searchParams, { type: "work" });
}
