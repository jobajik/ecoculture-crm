// ---------------------------------------------------------------------------
// Когда последний раз бот дожимал и напоминал (`/api/bot/followup`). Настройка
// `BotFollowupLastRun`: «2026-10-01T11:20:00.000Z · вебхук · дожато 2, …».
// Время — первым словом, по нему вебхук решает, пора ли звать снова.
// Чистые правила — их проверяет `check-bot-order`.
// ---------------------------------------------------------------------------

export const FOLLOWUP_LAST_RUN = "BotFollowupLastRun";
/** Вебхук зовёт дожим не чаще, чем раз в столько минут. */
export const FOLLOWUP_MIN_GAP_MINUTES = 25;

export function followupRunText(at: Date, source: string, result: string): string {
  return `${at.toISOString()} · ${source} · ${result}`.slice(0, 300);
}

/** Пора ли запускать снова: прошлого запуска нет или он был давно. */
export function followupRunDue(lastRun: string | undefined, now: Date): boolean {
  const at = Date.parse(String(lastRun || "").split(" · ")[0]);
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at >= FOLLOWUP_MIN_GAP_MINUTES * 60000;
}

/**
 * Вебхук: позвать дожим, не дожидаясь его. Не чаще раза в 10 минут на один
 * экземпляр сервера (чтобы не читать настройки на каждое уведомление), а
 * настоящий предел — 25 минут — проверяет сам `/api/bot/followup`. Запрос
 * обрывается через 1,5 с: дожим идёт своей функцией, вебхук не ждёт.
 */
export async function kickFollowup(origin: string): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret || !origin) return;
  const g = globalThis as unknown as { __botFollowupKick?: number };
  const now = Date.now();
  if (g.__botFollowupKick && now - g.__botFollowupKick < 10 * 60000) return;
  g.__botFollowupKick = now;
  try {
    await fetch(`${origin}/api/bot/followup?source=webhook`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    // Оборвали сами — так и задумано; дожим работает дальше без нас.
  }
}
