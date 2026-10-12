import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Уведомления WhatsApp без адреса уведомлений: забирать их у Green API самим и
 * передавать на сайт, в тот же `/api/whatsapp/webhook`.
 *
 * 12.10.2026: после перепривязки номера Green API стёр адрес уведомлений и не даёт
 * записать его обратно — `setSettings` отвечает «сохранено», а `webhookUrl` остаётся
 * пустым (`whatsapp-webhook-fix.ts`). Пока адрес пуст, Green API складывает
 * уведомления в очередь (хранит сутки) и отдаёт их по `receiveNotification`. Этот
 * скрипт по кругу берёт уведомление, отправляет его сайту с нашим токеном, как это
 * сделал бы сам Green API, и после ответа 2xx удаляет из очереди. Бот, CRM, статусы
 * рассылки работают как обычно — пока окно открыто и компьютер не спит.
 *
 *   npx tsx scripts/wa-poll.ts [--once]
 *
 * Сообщение старше `OLD_MINUTES` сайту НЕ передаётся: бот ответил бы на него, как на
 * свежее (через час «Здравствуйте» на вчерашний вопрос). Такие дописывает в CRM без
 * ответа `catch-up-incoming.ts`. Сайт не принял уведомление — повтор через 30 с,
 * после `MAX_TRIES` неудач оно снимается с очереди (иначе встала бы вся очередь).
 * `--once` — разобрать очередь и выйти. Когда адрес уведомлений снова появится в
 * Green API, очередь опустеет сама, и скрипт можно закрыть.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { greenConfig } from "../src/lib/greenApi";

const SITE = "https://www.crm-ecoculture.kz";
const OLD_MINUTES = 20;
const MAX_TRIES = 5;
const MESSAGE_TYPES = new Set(["incomingMessageReceived", "outgoingMessageReceived"]);

const stamp = () => new Date().toLocaleString("ru-RU", { timeZone: "Asia/Almaty" });
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

interface Notification {
  receiptId: number;
  body: { typeWebhook?: string; timestamp?: number; senderData?: { chatId?: string }; stateInstance?: string } & Record<string, unknown>;
}

function tail(body: Notification["body"]): string {
  const chat = String(body.senderData?.chatId || (body as { chatId?: string }).chatId || "");
  const digits = chat.replace(/\D/g, "");
  return digits ? `…${digits.slice(-4)}` : "";
}

async function main() {
  const cfg = greenConfig();
  if (!cfg) throw new Error("Нет ключей Green API в .env.local");
  const token = process.env.WHATSAPP_WEBHOOK_TOKEN;
  if (!token) throw new Error("Нет WHATSAPP_WEBHOOK_TOKEN в .env.local");
  const once = process.argv.includes("--once");
  const base = `${cfg.url}/waInstance${cfg.instance}`;
  const hide = (s: string) => s.split(cfg.token).join("***").split(token).join("***");
  // Второй экземпляр забирал бы те же уведомления, и бот ответил бы дважды.
  const lock = "../_private/wa-poll.lock";
  if (!once) {
    try {
      const [pid, at] = readFileSync(lock, "utf8").split(" ").map(Number);
      // Живой экземпляр обновляет замок на каждом круге (не реже раза в минуту).
      if (pid && pid !== process.pid && Date.now() - at < 120000) {
        process.kill(pid, 0);
        return console.log(`${stamp()} · уже работает (процесс ${pid}) — второй не запускаю`);
      }
    } catch {
      // замка нет или процесс уже закрыт — работаем
    }
  }
  const beat = () => {
    if (once) return;
    try {
      writeFileSync(lock, `${process.pid} ${Date.now()}`);
    } catch {
      // замок — только защита от второго окна
    }
  };
  const tries = new Map<number, number>();
  let failures = 0;
  let forwarded = 0;
  let skipped = 0;
  console.log(`${stamp()} · забираю уведомления WhatsApp и передаю сайту${once ? " (один проход)" : ""}`);

  beat();
  if (!once) setInterval(beat, 30000).unref();
  for (;;) {
    let n: Notification | null = null;
    try {
      const res = await fetch(`${base}/receiveNotification/${cfg.token}?receiveTimeout=20`, { signal: AbortSignal.timeout(35000) });
      if (!res.ok) throw new Error(`Green API ответил ${res.status}`);
      const text = await res.text();
      n = text && text.trim() !== "null" ? (JSON.parse(text) as Notification) : null;
      failures = 0;
    } catch (e) {
      failures++;
      const wait = Math.min(300, 15 * failures);
      console.log(`${stamp()} · Green API: ${hide(e instanceof Error ? e.message : String(e))} — повтор через ${wait} с`);
      await sleep(wait);
      continue;
    }
    if (!n) {
      if (once) break;
      continue; // длинный опрос уже подождал 20 с
    }

    const type = String(n.body.typeWebhook || "");
    const ageMin = n.body.timestamp ? (Date.now() - n.body.timestamp * 1000) / 60000 : 0;
    let drop = false;
    if (MESSAGE_TYPES.has(type) && ageMin > OLD_MINUTES) {
      skipped++;
      console.log(`${stamp()} · ${type} ${tail(n.body)}: старое (${Math.round(ageMin)} мин) — сайту не передаю, его допишет catch-up`);
      drop = true;
    } else {
      try {
        const res = await fetch(`${SITE}/api/whatsapp/webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify(n.body),
          signal: AbortSignal.timeout(90000),
        });
        if (!res.ok) throw new Error(`сайт ответил ${res.status}`);
        forwarded++;
        drop = true;
        if (type !== "outgoingMessageStatus") console.log(`${stamp()} · ${type} ${tail(n.body)}${type === "stateInstanceChanged" ? ` → ${n.body.stateInstance}` : ""} — передано`);
      } catch (e) {
        const count = (tries.get(n.receiptId) ?? 0) + 1;
        tries.set(n.receiptId, count);
        const why = hide(e instanceof Error ? e.message : String(e));
        if (count >= MAX_TRIES) {
          console.log(`${stamp()} · ${type} ${tail(n.body)}: сайт не принял ${count} раз (${why}) — снимаю с очереди`);
          drop = true;
        } else {
          console.log(`${stamp()} · ${type} ${tail(n.body)}: ${why} — повтор через 30 с`);
          await sleep(30);
        }
      }
    }
    if (drop) {
      try {
        const res = await fetch(`${base}/deleteNotification/${cfg.token}/${n.receiptId}`, { method: "DELETE", signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`Green API ответил ${res.status}`);
        tries.delete(n.receiptId);
      } catch (e) {
        console.log(`${stamp()} · не удалось снять уведомление с очереди: ${hide(e instanceof Error ? e.message : String(e))}`);
        await sleep(10);
      }
    }
  }
  console.log(`${stamp()} · очередь пуста · передано ${forwarded}, старых пропущено ${skipped}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
