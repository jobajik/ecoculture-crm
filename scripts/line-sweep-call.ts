/*
 * Позвать на сайте проход ИИ-помощника (как расписание) и сторожа номера — и напечатать ответ.
 * Это настоящий проход: если кто-то ждёт ответа, помощник ответит. Секрет не печатает.
 * Запуск: npx tsx scripts/line-sweep-call.ts [код линии для сторожа]
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const SITE = "https://www.crm-ecoculture.kz";

async function call(path: string) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) throw new Error("нет CRON_SECRET в .env.local");
  const started = Date.now();
  const res = await fetch(`${SITE}${path}`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(70000) });
  console.log(`${path}: ${res.status} за ${Math.round((Date.now() - started) / 1000)} с\n${(await res.text()).slice(0, 1500)}\n`);
}

async function main() {
  await call("/api/assistant/sweep?source=check");
  const code = process.argv[2];
  if (code) await call(`/api/assistant/sweep?watch=${encodeURIComponent(code)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
