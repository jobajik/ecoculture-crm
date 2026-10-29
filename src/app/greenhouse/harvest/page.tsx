import { renderLogPage } from "../logPage";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams?: { farm?: string; from?: string; to?: string; cycle?: string; block?: string } }) {
  return renderLogPage("harvest", searchParams);
}
