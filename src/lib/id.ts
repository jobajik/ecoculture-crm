/** Простой человекочитаемый ID: ПРЕФИКС-ГГММДД-случайные символы. Уникальности через сортировку по времени + случайности достаточно для нашего объёма записей. */
export function generateId(prefix: string): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(2);
  const m = (now.getMonth() + 1).toString().padStart(2, "0");
  const d = now.getDate().toString().padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}-${y}${m}${d}-${rand}`;
}
