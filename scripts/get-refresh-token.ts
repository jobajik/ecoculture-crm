/**
 * Запасной способ подключить Google-таблицу — БЕЗ сервисного аккаунта и без
 * ключа. Используйте, если Google Cloud блокирует создание ключей сервисных
 * аккаунтов ошибкой «Service account key creation is disabled»
 * (org policy iam.disableServiceAccountKeyCreation) и вы не можете её снять.
 *
 * Что делает скрипт: один раз открывает окно входа Google в браузере, вы
 * входите тем аккаунтом, которому принадлежит (или к которому дан доступ)
 * ваша таблица, и разрешаете доступ. Скрипт получает "refresh token" —
 * долгоживущий пропуск, который сайт будет использовать вместо ключа.
 *
 * Перед запуском:
 *  1. В .env.local должны быть уже заполнены GOOGLE_CLIENT_ID и
 *     GOOGLE_CLIENT_SECRET (см. SETUP.md, Шаг 4 — это тот же клиент, что и
 *     для входа сотрудников).
 *  2. В Google Cloud Console: Credentials → тот же OAuth client → Authorized
 *     redirect URIs → добавьте:  http://localhost:4321/oauth2callback
 *
 * Запуск: npm run get-refresh-token
 */
import * as dotenv from "dotenv";
import * as http from "http";
import { URL } from "url";
import { google } from "googleapis";

dotenv.config({ path: ".env.local" });
dotenv.config();

const PORT = 4321;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      "\nВ .env.local не найдены GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.\n" +
        "Сначала заполните их (см. SETUP.md, Шаг 4), затем запустите снова: npm run get-refresh-token\n"
    );
    process.exit(1);
    return;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  console.log("\n============================================================");
  console.log("1. Проверьте, что в Google Cloud Console (Credentials → ваш");
  console.log("   OAuth client → Authorized redirect URIs) добавлен адрес:");
  console.log(`   ${REDIRECT_URI}`);
  console.log("");
  console.log("2. Откройте эту ссылку в браузере и войдите тем Google-");
  console.log("   аккаунтом, которому принадлежит (или доступна) таблица:");
  console.log("");
  console.log(authUrl);
  console.log("");
  console.log("   Если появится экран «Google не подтвердил это приложение» —");
  console.log("   это ожидаемо для собственного, ещё не проверенного Google");
  console.log("   инструмента. Нажмите «Дополнительные настройки» →");
  console.log("   «Перейти на flower-crm (небезопасно)» → «Продолжить».");
  console.log("============================================================\n");
  console.log("Жду, пока вы разрешите доступ в браузере…\n");

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "", `http://localhost:${PORT}`);
      if (url.pathname !== "/oauth2callback") {
        res.end("Ожидаю ответ от Google...");
        return;
      }

      const code = url.searchParams.get("code");
      const errorParam = url.searchParams.get("error");
      if (errorParam || !code) {
        res.end("Доступ не был предоставлен. Можно закрыть вкладку и попробовать снова.");
        console.error(`\nGoogle вернул ошибку: ${errorParam ?? "нет кода авторизации"}\n`);
        server.close();
        process.exit(1);
        return;
      }

      const { tokens } = await oauth2Client.getToken(code);
      res.end("Готово! Можно закрыть эту вкладку и вернуться в терминал.");
      server.close();

      if (!tokens.refresh_token) {
        console.error(
          "\nGoogle не вернул refresh_token. Обычно это значит, что вы уже разрешали доступ " +
            "этому приложению раньше.\nОткройте https://myaccount.google.com/permissions, " +
            "найдите приложение (по имени вашего OAuth client) и уберите доступ, затем " +
            "запустите скрипт заново: npm run get-refresh-token\n"
        );
        process.exit(1);
        return;
      }

      console.log("\n✅ Готово! Добавьте в .env.local (и позже — в переменные окружения Vercel) строку:\n");
      console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
      console.log(
        "\nЭту строку можно добавить ВМЕСТО GOOGLE_SERVICE_ACCOUNT_EMAIL и " +
          "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — они больше не нужны.\n" +
          "Не забудьте, что таблица (GOOGLE_SHEETS_SPREADSHEET_ID) должна принадлежать " +
          "или быть доступна на редактирование именно тому аккаунту, которым вы сейчас вошли.\n"
      );
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.end("Ошибка: " + message);
      console.error("\nОшибка при обмене кода на токен:", message, "\n");
      process.exit(1);
    }
  });

  server.listen(PORT);
}

main();
