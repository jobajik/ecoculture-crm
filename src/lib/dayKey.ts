/**
 * День «ГГГГ-ММ-ДД» плюс N дней. Чистая арифметика над ключом дня — без часов
 * сервера или телефона, поэтому одинаково и в браузере, и на сервере. «Сегодня»
 * берётся снаружи: на сервере — `localDayKey()` (Алматы).
 */
export function addDaysToKey(dayKey: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey || "");
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}
