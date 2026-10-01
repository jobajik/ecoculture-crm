/**
 * Под каким «менеджером» бот оформляет заявки (владелец, 01.10.2026: «отдельный
 * „Бот“, без бонуса»). Почта не принадлежит человеку и в `Users` её нет: по ней
 * заявки бота видны отдельной строкой в рейтинге и сводке, а бонус по ним не
 * начисляется (`leaderboard.ts`).
 */
export const BOT_MANAGER_EMAIL = "bot@ecoculture.kz";
export const BOT_MANAGER_NAME = "Бот WhatsApp";

export function isBotEmail(email: string | null | undefined): boolean {
  return (email || "").trim().toLowerCase() === BOT_MANAGER_EMAIL;
}

/** Карта «почта → имя» страницы, дополненная именем бота. */
export function withBotName(map: Map<string, string>): Map<string, string> {
  map.set(BOT_MANAGER_EMAIL, BOT_MANAGER_NAME);
  return map;
}
