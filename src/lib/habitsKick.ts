/** Запуск рассылок постоянникам своей функцией (`/api/habits`): будят сводка (weekly) и часовой проход (overdue). */
export const HABITS_LAST_RUN = "HabitsLastRun";

export async function kickHabits(origin: string, mode: "weekly" | "overdue"): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) return;
  try {
    await fetch(`${origin}/api/habits?mode=${mode}&send=1`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(1500) });
  } catch {
    // Оборвали сами — запуск идёт своей функцией.
  }
}
