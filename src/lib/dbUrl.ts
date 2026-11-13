/**
 * Строки подключения к базе данных (PostgreSQL в Neon). Переезд с Google-таблицы, этап 1 (13.11.2026).
 *
 * Имена переменных — как их даёт кабинет Neon: `DATABASE_URL` (прямое соединение) и `DATABASE_URL_POOLED` (через пул
 * соединений — так ходит сайт: у Vercel каждая функция открывает своё соединение, и без пула они быстро кончаются).
 * Понимаем и `DATABASE_URL_UNPOOLED`: какая строка «с пулом», решает адрес (первая часть кончается на «-pooler»), а не
 * имя переменной. Сами строки — секрет: в журнал и в ответы уходят только признаки из `dbUrlFacts`.
 */

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function isPooledUrl(url: string): boolean {
  return hostOf(url).split(".")[0].endsWith("-pooler");
}

function candidates(): string[] {
  return [process.env.DATABASE_URL_POOLED, process.env.DATABASE_URL, process.env.DATABASE_URL_UNPOOLED]
    .map((v) => (v || "").trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/** Строка для сайта: с пулом, если такая есть; иначе любая заданная. */
export function pooledDbUrl(): string {
  const all = candidates();
  return all.find(isPooledUrl) || all[0] || "";
}

/** Строка для переноса данных и скриптов: прямое соединение, если есть; иначе любая заданная. */
export function directDbUrl(): string {
  const all = candidates();
  return all.find((u) => !isPooledUrl(u)) || all[0] || "";
}

export interface DbUrlFacts {
  set: boolean;
  pooled: boolean;
  neon: boolean;
  /** Регион из адреса («eu-central-1»), если узнаётся. */
  region: string;
}

/** Что можно сказать о строке вслух: задана ли, с пулом ли, чей адрес и какой регион. Ни имени, ни пароля, ни адреса. */
export function dbUrlFacts(url: string): DbUrlFacts {
  const host = hostOf(url);
  const region = host.match(/\.([a-z]+-[a-z]+-\d+)\./);
  return { set: Boolean(url), pooled: isPooledUrl(url), neon: host.endsWith("neon.tech"), region: region ? region[1] : "" };
}

/** Текст ошибки без строки подключения и пароля — на случай, если драйвер процитирует адрес. */
export function scrubDbError(err: unknown, url: string): string {
  let text = err instanceof Error ? err.message : String(err);
  if (url) text = text.split(url).join("***");
  try {
    const u = new URL(url);
    for (const part of [u.password, decodeURIComponent(u.password), u.username, u.hostname]) {
      if (part) text = text.split(part).join("***");
    }
  } catch {
    // строка не разбирается — вырезать нечего
  }
  return text.slice(0, 300);
}
