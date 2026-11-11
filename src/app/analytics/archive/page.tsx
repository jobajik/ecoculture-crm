import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import PageHeader from "@/components/PageHeader";
import { analyticsTabsFor, ARCHIVED_REPORTS } from "../tabs";

export const dynamic = "force-dynamic";

/**
 * «Архив отчётов» (12.11.2026, владелец: «CRM перегружена данными и аналитикой — уменьши шум»). Отчёты, которые
 * отвечали на тот же вопрос, что «Цифры за период», убраны из меню, но не удалены: здесь у каждого написано, что он
 * показывал и где это смотреть теперь, и он открывается одним нажатием. Список — `ARCHIVED_REPORTS` в `../tabs.ts`.
 */
export default async function ReportsArchivePage() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role ?? "";
  return (
    <div>
      <PageHeader area="analytics" title="Архив отчётов" subtitle="Отчёты, собранные в «Цифры за период». Они работают как раньше — просто не занимают меню." icon="list" tabs={analyticsTabsFor(role)} />
      <div className="card !p-0 overflow-hidden max-w-[980px]">
        {ARCHIVED_REPORTS.map((r) => (
          <Link key={r.href} href={r.href} className="flex items-start gap-4 px-4 sm:px-5 py-4 border-b border-line-hairline last:border-0 hover:bg-surface-plane/60">
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">{r.label}</div>
              <div className="text-[13px] text-ink-secondary mt-0.5">{r.was}</div>
              <div className="text-[13px] text-ink-muted mt-1">
                <span className="text-accent">Теперь:</span> {r.now}
              </div>
            </div>
            <span className="text-ink-muted text-sm mt-0.5 flex-none">Открыть →</span>
          </Link>
        ))}
      </div>
      <p className="text-xs text-ink-muted mt-4 max-w-[980px]">
        Если каким-то отчётом из архива вы пользуетесь каждый день — скажите, верну его в меню. Если за месяц сюда никто не заглянет, отчёты можно будет убрать совсем.
      </p>
    </div>
  );
}
