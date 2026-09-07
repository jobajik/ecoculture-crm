// Переносит переменные из .env.local в Vercel.
// Значения передаются процессу vercel напрямую через stdin и НИКУДА не печатаются:
// в журнал попадают только имя переменной и длина значения.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const SKIP = new Set([
  "NEXTAUTH_URL",                       // задаётся отдельно — адресом сайта на Vercel
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",       // не используется: доступ через refresh-токен
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
]);

const ENVS = ["production", "preview", "development"];
const log = [];
const text = readFileSync(".env.local", "utf8");

for (const raw of text.split(/\r?\n/)) {
  const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) continue;
  const key = m[1];
  let value = m[2].trim();
  if (value.length > 1 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
    value = value.slice(1, -1);
  }
  if (SKIP.has(key)) { log.push(`- ${key}: пропущено (по плану)`); continue; }
  if (!value) { log.push(`- ${key}: пропущено (пустое)`); continue; }

  for (const env of ENVS) {
    try {
      execFileSync("vercel", ["env", "add", key, env, "--force"], {
        input: value, stdio: ["pipe", "pipe", "pipe"], shell: true,
      });
      log.push(`+ ${key} -> ${env}: ok (${value.length} симв.)`);
    } catch (e) {
      // на всякий случай вырезаем значение из текста ошибки
      let msg = String(e.stderr || e.message).replace(/\s+/g, " ");
      msg = msg.split(value).join("***");
      log.push(`! ${key} -> ${env}: ${msg.slice(0, 160)}`);
    }
  }
}
console.log(log.join("\n"));
