import { refreshManagerStyles } from "@/lib/managerStyleRunner";
import { runClientHabits, runHabitOverdue } from "@/lib/clientHabitsRunner";
import { saveSettings } from "@/lib/repo/settings";
import { localDayKey } from "@/lib/timezone";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { HABITS_LAST_RUN } from "@/lib/habitsKick";

/**
 * Постоянники менеджеров — своей функцией, чтобы не отнимать минуту у сводки и дожима (`clientHabitsRunner.ts`):
 *  - `?mode=weekly` — утром из `/api/digest`: чей сегодня день; раз в неделю перед этим пересчитывает почерк менеджеров;
 *  - `?mode=overdue` — раз в час из `/api/bot/followup` (10–18): молчат дольше обычного, пишем сами.
 * Без `send=1` — только показ. Вызов только с секретом CRON_SECRET. Каждый запуск пишется в настройку `HabitsLastRun`.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Недостаточно прав", { status: 403 });
  }
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") === "overdue" ? "overdue" : "weekly";
  const send = url.searchParams.get("send") === "1";
  const started = Date.now();
  try {
    let styles: { code: string; messages: number; refreshed: boolean }[] = [];
    if (mode === "weekly") {
      // Понедельник (или профиля ещё нет) — пересчитать почерк; остальные дни профиль живёт неделю.
      styles = await refreshManagerStyles().catch(() => []);
    }
    const run = mode === "weekly" ? (await runClientHabits({ send })).results : (await runHabitOverdue({ send })).results;
    const summary = run.map((r) => `${r.manager}: ${r.sent.length}${r.broadcastId ? ` → ${r.broadcastId}` : ""}`).join("; ") || "никому";
    const note = `${new Date().toISOString()} · ${mode} · ${send ? "отправка" : "показ"} · ${summary} · ${Math.round((Date.now() - started) / 1000)} с`;
    await saveSettings({ [HABITS_LAST_RUN]: note }).catch(() => undefined);
    return Response.json({ ok: true, mode, send, today: localDayKey(), styles, results: run.map((r) => ({ manager: r.manager, line: r.line, mode: r.mode, sent: r.sent.map((s) => ({ name: s.name, source: s.source })), skipped: r.skipped.length, broadcastId: r.broadcastId })) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await saveSettings({ [HABITS_LAST_RUN]: `${new Date().toISOString()} · ${mode} · ошибка: ${message}` }).catch(() => undefined);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
