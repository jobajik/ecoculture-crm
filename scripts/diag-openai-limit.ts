import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Почему OpenAI отвечает «подождите» (429): один крошечный запрос к модели бота и к быстрой модели, печать кода
 * ошибки и лимитов из заголовков (x-ratelimit-*). Ключ не печатается. Ничего не пишет.
 *   npx tsx scripts/diag-openai-limit.ts
 */
import { openAiKey } from "../src/lib/openai";

async function probe(model: string) {
  const key = openAiKey();
  const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "ok" }], max_tokens: 3 }),
  });
  const body = (await res.text()).split(key).join("***");
  const h = (n: string) => res.headers.get(n) ?? "—";
  console.log(`\n${model}: ${res.status}`);
  console.log(`  запросов в минуту: лимит ${h("x-ratelimit-limit-requests")}, осталось ${h("x-ratelimit-remaining-requests")}, сброс ${h("x-ratelimit-reset-requests")}`);
  console.log(`  токенов в минуту:  лимит ${h("x-ratelimit-limit-tokens")}, осталось ${h("x-ratelimit-remaining-tokens")}, сброс ${h("x-ratelimit-reset-tokens")}`);
  if (!res.ok) console.log(`  ответ: ${body.slice(0, 400)}`);
}

async function main() {
  for (const m of ["gpt-4.1", "gpt-4.1-mini", "gpt-5-mini"]) await probe(m).catch((e) => console.log(`${m}: ${e instanceof Error ? e.message : e}`));
}
main();
