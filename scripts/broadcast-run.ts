import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Вести идущие рассылки без открытой страницы: по кругу просит сайт отправить следующее
 * сообщение (`/api/broadcast/tick`, CRON_SECRET) и ждёт, сколько сайт сказал. Все правила
 * осторожности (10:00–19:00, до 15 в час, перерывы, дневной предел, разогрев) — на сайте,
 * здесь только «спросить и подождать». Работает, пока окно открыто и компьютер не спит;
 * закрыли — запустить снова, рассылка продолжится с того же места.
 *
 *   npx tsx scripts/broadcast-run.ts [BC-… | --id-file <файл с номером рассылки>]
 *
 * Останавливается сам, когда идущих рассылок нет или рассылка встала на паузу (номер,
 * тариф) — продолжить после паузы можно только кнопкой «Продолжить» на странице рассылки.
 * 08.10.2026, владелец: «прогони по клиентской базе, 40 клиентов в день».
 */
import { readFileSync } from "node:fs";

const SITE = "https://www.crm-ecoculture.kz";

const stamp = () => new Date().toLocaleString("ru-RU", { timeZone: "Asia/Almaty" });
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

async function main() {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("Нет CRON_SECRET в .env.local");
  const args = process.argv.slice(2);
  const fileAt = args.indexOf("--id-file");
  const fromFile = fileAt >= 0 && args[fileAt + 1] ? readFileSync(args[fileAt + 1], "utf8").trim() : "";
  const id = fromFile || args.find((a) => a.startsWith("BC-")) || "";
  console.log(`${stamp()} · рассылка ${id || "(самая ранняя из идущих)"} · старт`);
  let failures = 0;
  for (;;) {
    let wait = 60;
    try {
      const res = await fetch(`${SITE}/api/broadcast/tick${id ? `?id=${encodeURIComponent(id)}` : ""}`, {
        headers: { authorization: `Bearer ${secret}` },
      });
      if (!res.ok) throw new Error(`сайт ответил ${res.status}`);
      const r = (await res.json()) as { status: string; remaining: number; waitSeconds: number; note: string; sentTo?: string; broadcastId?: string };
      failures = 0;
      if (r.sentTo) console.log(`${stamp()} · отправлено: ${r.sentTo} · осталось ${r.remaining}`);
      else if (r.note) console.log(`${stamp()} · ${r.note}`);
      if (r.status === "none") return console.log(`${stamp()} · идущих рассылок нет — выхожу`);
      if (r.status !== "sending") return console.log(`${stamp()} · рассылка ${r.broadcastId || id}: ${r.status}${r.note ? ` — ${r.note}` : ""} — выхожу`);
      wait = Math.max(5, Number(r.waitSeconds) || 60);
    } catch (e) {
      failures++;
      wait = Math.min(600, 60 * failures);
      console.log(`${stamp()} · сбой: ${e instanceof Error ? e.message : e} — повтор через ${wait} с`);
    }
    await sleep(wait);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
