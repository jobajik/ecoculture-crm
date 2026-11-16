/*
 * Доступна ли нашему ключу OpenAI «копия голоса по записи» (16.11.2026, владелец: «отправь мне и Данияру предложение,
 * сгенерированное голосом Эмиля»). Ничего не создаёт и не меняет: два запроса на чтение — список фраз согласия и список
 * своих голосов. Ключ не печатается. Печатает код ответа, русскую фразу согласия (её Эмиль должен будет произнести слово
 * в слово) и сколько голосов уже заведено.
 *
 *   npx tsx scripts/voice-access-check.ts
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

const BASE = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

async function get(path: string) {
  const res = await fetch(BASE + path, { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    // не JSON — покажем начало текста
  }
  return { status: res.status, data, text: text.slice(0, 400) };
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("Нет OPENAI_API_KEY в .env.local");
  const phrases = await get("/audio/consent_phrases");
  console.log(`Фразы согласия: ответ ${phrases.status}`);
  if (phrases.status === 200) {
    const list = (Array.isArray((phrases.data as { data?: unknown })?.data) ? (phrases.data as { data: unknown[] }).data : Array.isArray(phrases.data) ? (phrases.data as unknown[]) : []) as Record<string, unknown>[];
    console.log(`  языков: ${list.length}`);
    for (const p of list.filter((x) => /^(ru|kk|en)/i.test(String(x.language ?? x.locale ?? x.code ?? "")))) console.log(`  ${JSON.stringify(p).slice(0, 500)}`);
    if (list.length === 0) console.log(`  ${phrases.text}`);
  } else console.log(`  ${phrases.text.replace(/sk-[A-Za-z0-9_-]+/g, "***")}`);
  const voices = await get("/audio/voices");
  console.log(`Свои голоса: ответ ${voices.status}`);
  const vlist = (voices.data as { data?: unknown[] } | null)?.data;
  if (voices.status === 200 && Array.isArray(vlist)) {
    console.log(`  заведено: ${vlist.length}`);
    for (const v of vlist.slice(0, 10) as Record<string, unknown>[]) console.log(`  ${JSON.stringify({ id: v.id, name: v.name, type: v.type, status: v.status }).slice(0, 200)}`);
  } else console.log(`  ${voices.text.replace(/sk-[A-Za-z0-9_-]+/g, "***")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
