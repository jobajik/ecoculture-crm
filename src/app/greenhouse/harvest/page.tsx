import { movedTo } from "../moved";

export const dynamic = "force-dynamic";

/** Журнал переехал во вкладку «Записи» (29.10.2026). */
export default function Page({ searchParams }: { searchParams?: Record<string, string | undefined> }) {
  movedTo("/greenhouse/records", searchParams, { type: "harvest" });
}
