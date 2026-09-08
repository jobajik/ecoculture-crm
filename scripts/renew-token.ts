/**
 * Перевыпуск refresh-токена доступа к Google-таблице.
 *
 * Зачем: пока приложение было в режиме «Тестирование», Google выдавал токен на
 * СЕМЬ ДНЕЙ. По истечении срока сайт переставал читать таблицу — выглядело бы
 * это как внезапная поломка на ровном месте. Приложение переведено в
 * «Опубликовано», и токен нужно выпустить заново: старый доживает свой недельный
 * срок независимо от статуса приложения.
 *
 * Отличие от get-refresh-token.ts: тот ПЕЧАТАЕТ токен в консоль, а значит — в
 * лог-файл, из которого его может прочитать кто угодно, включая меня. Этот
 * вписывает токен прямо в .env.local и печатает только «готово» и длину строки.
 * Секрет владельца остаётся у владельца.
 *
 * Запуск: npx tsx scripts/renew-token.ts
 */
import * as dotenv from "dotenv";
import * as http from "http";
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { URL } from "url";
import { google } from "googleapis";

dotenv.config({ path: ".env.local" });
dotenv.config();

const PORT = 4321;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const ENV_FILE = ".env.local";
const KEY = "GOOGLE_OAUTH_REFRESH_TOKEN";

/** Вписывает значение в .env.local, сохранив всё остальное. */
function writeEnv(value: string) {
  if (!existsSync(ENV_FILE)) throw new Error(`Не нашёл ${ENV_FILE} рядом со скриптом`);

  // Копия на случай, если что-то пойдёт не так: .env.local восстановить неоткуда.
  copyFileSync(ENV_FILE, `${ENV_FILE}.bak`);

  const before = readFileSync(ENV_FILE, "utf8");
  const line = `${KEY}=${value}`;
  const replaced = before.match(new RegExp(`^${KEY}=.*$`, "m"))
    ? before.replace(new RegExp(`^${KEY}=.*$`, "m"), line)
    : `${before.replace(/\s*$/, "")}\n${line}\n`;
  writeFileSync(ENV_FILE, replaced, "utf8");
}

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(`В ${ENV_FILE} нет GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.`);
    process.exit(1);
    return;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    // prompt=consent обязателен: без него Google при повторном разрешении
    // возвращает только access-токен, а refresh-токена не даёт вовсе.
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  console.log("ССЫЛКА ДЛЯ РАЗРЕШЕНИЯ ДОСТУПА:");
  console.log(authUrl);
  console.log("Жду разрешения в браузере…");

  const server = http.createServer(async (req, res) => {
    // Без явной кодировки браузер читает кириллицу как «каракули»: страница
    // отдаётся в UTF-8, а без заголовка браузер угадывает Windows-1251.
    res.setHeader("Content-Type", "text/plain; charset=utf-8");

    const url = new URL(req.url ?? "", `http://localhost:${PORT}`);
    if (url.pathname !== "/oauth2callback") {
      res.end("Ожидаю ответ от Google…");
      return;
    }
    try {
      const code = url.searchParams.get("code");
      const errorParam = url.searchParams.get("error");
      if (errorParam || !code) {
        res.end("Доступ не выдан. Вкладку можно закрыть.");
        console.error(`Google вернул ошибку: ${errorParam ?? "нет кода"}`);
        server.close();
        process.exit(1);
        return;
      }

      const { tokens } = await oauth2Client.getToken(code);
      res.end("Готово! Токен получен и записан. Эту вкладку можно закрыть.");
      server.close();

      if (!tokens.refresh_token) {
        console.error(
          "Google не вернул refresh-токен. Зайдите на https://myaccount.google.com/permissions, " +
            "уберите доступ приложению flower-crm и запустите скрипт заново."
        );
        process.exit(1);
        return;
      }

      writeEnv(tokens.refresh_token);
      // Ни сам токен, ни его начало не печатаем — только подтверждение.
      console.log(`ГОТОВО: новый токен записан в ${ENV_FILE} (длина ${tokens.refresh_token.length}).`);
      console.log(`Старый файл сохранён как ${ENV_FILE}.bak`);
      console.log("Дальше запустите env-push.mjs, чтобы отправить его на Vercel.");
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.end("Ошибка: " + message);
      console.error("Ошибка при обмене кода на токен:", message);
      process.exit(1);
    }
  });

  server.listen(PORT);
}

main();
