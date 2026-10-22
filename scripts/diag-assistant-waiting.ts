import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

/**
 * Почему помощник не ответил тем, кто сейчас ждёт (22.10.2026, владелец: «бот сегодня не такой активный»).
 * По каждому номеру с помощником: чаты, где последним писал клиент сегодня, — сколько ждёт, что решил
 * `assistantVerdict` (тот же расчёт, что у прохода помощника), и последняя строка журнала помощника по чату.
 * На номере Земфиры передача и закрытие лида здесь не учитываются (их видит только проход). Ничего не меняет.
 *
 *   npx tsx scripts/diag-assistant-waiting.ts
 */
import { listWaMessages } from "../src/lib/repo/talks";
import { listAssistantLines, listAssistantLog } from "../src/lib/repo/waLines";
import { settingsMap } from "../src/lib/repo/broadcasts";
import { ourPhoneKeys } from "../src/lib/lineNotify";
import { phoneKey } from "../src/lib/leads";
import { assistantVerdict } from "../src/lib/waLines";
import { mergeMessages, messageText } from "../src/lib/whatsapp";
import { localDayKey } from "../src/lib/timezone";
import type { WaMessage } from "../src/lib/types";

async function main() {
  const lines = (await listAssistantLines()).filter((l) => l.active);
  const [messages, log, map] = await Promise.all([listWaMessages({ lines: "all", fresh: true }), listAssistantLog({ fresh: true }), settingsMap(true)]);
  const autoIds = new Set(log.filter((r) => r.kind === "auto" || r.kind === "nudge").map((r) => r.messageId));
  const staff = await ourPhoneKeys(map);
  const now = new Date();
  const today = localDayKey();
  for (const line of lines) {
    console.log(`\n${line.code || "основной"} · режим ${line.assistant}`);
    const byKey = new Map<string, WaMessage[]>();
    for (const m of messages) {
      if (m.line !== line.code) continue;
      const k = phoneKey(m.phone);
      if (k) byKey.set(k, [...(byKey.get(k) ?? []), m]);
    }
    let n = 0;
    for (const [key, raw] of Array.from(byKey.entries())) {
      const chat = mergeMessages(raw);
      const last = chat[chat.length - 1];
      if (!last || last.direction !== "in" || localDayKey(new Date(last.at)) !== today) continue;
      const waitMin = Math.round((now.getTime() - Date.parse(last.at)) / 60000);
      if (waitMin < 15) continue;
      n++;
      const v = assistantVerdict({ chat: raw, autoIds, now, staff: staff.has(key), mode: line.assistant });
      const mine = log.filter((r) => r.line === line.code && phoneKey(r.phone) === key).sort((a, b) => (a.at < b.at ? -1 : 1));
      const lastLog = mine[mine.length - 1];
      const t = new Date(last.at).toLocaleTimeString("ru-RU", { timeZone: "Asia/Almaty", hour: "2-digit", minute: "2-digit" });
      console.log(
        `  …${key.slice(-4)} · написал ${t} (${waitMin} мин) «${messageText(last).replace(/\s+/g, " ").slice(0, 60)}» → ${v.due ? "ПОРА ОТВЕЧАТЬ" : v.reason}` +
          (lastLog ? ` · журнал: ${lastLog.kind} ${lastLog.at.slice(11, 16)}Z ${(lastLog.note || lastLog.text || "").replace(/\s+/g, " ").slice(0, 70)}` : "")
      );
    }
    if (!n) console.log("  никто не ждёт");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
